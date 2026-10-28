// HorrorGuessr — in-memory run store (§1.6, §7.2).
//
// Scope boundary, enforced by this file's import list: horror mode is
// **single-player** and owns a run-scoped pool. This module must never import or
// mutate `Room`, `Player` or `Phase` (§1.6, §7.2 "Never add horror fields to
// Room, Player, or Phase", acceptance 11). The only shared modules it reads are
// the horror type surface and the headless engine, both of which are horror-only.
//
// Storage shape: `Map<runId, HorrorRun>`, lost on restart — the same trade-off as
// [`src/server-logic/store.ts`](src/server-logic/store.ts:3). The idle sweep
// mirrors the room sweep there: a run whose player has gone away is dropped after
// `HORROR_RUN_IDLE_TTL_MS` so abandoned sessions cannot leak memory.
//
// Activity is kept in a *parallel* map rather than on `HorrorRun` for two
// reasons: the run record is the shared contract from §1.6 and must not grow
// non-gameplay bookkeeping, and `lastSeenAt` / `lastSeq` are transport concerns
// (P4's `/act` replay guard) rather than run state.

import { randomUUID } from "node:crypto";

import type { HorrorDifficulty, HorrorRun } from "../shared/horrorTypes";
import {
  HORROR_DIFFICULTIES,
  HORROR_INVENTORY_SLOTS,
  HORROR_PUZZLE_PIECES,
  HORROR_REROLL_COST,
} from "../shared/horrorCatalogue";
import { beginHorrorDay } from "./horrorEngine";

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

/**
 * How long a run survives with no activity. 30 minutes is deliberately longer
 * than a boss duel and a merchant visit combined, so a player who alt-tabs is
 * never swept mid-decision, and short enough that a crashed tab is reclaimed
 * within one session.
 */
export const HORROR_RUN_IDLE_TTL_MS = 30 * 60 * 1000;

/** Default cadence for the background sweep: 5 minutes. */
export const HORROR_RUN_SWEEP_INTERVAL_MS = 5 * 60 * 1000;

/**
 * Starting gold. Nothing in the Codex or the HAR fixes this: S1's day-3 payload
 * reports `gold: 4` after two purchases and one paid reroll from 7, i.e. the run
 * had earned/spent its way there, and no `day_started` from day 1 is retained.
 * `0` is therefore **[DESIGN]**, and P3's economy tests adjust it if telemetry
 * shows otherwise.
 */
export const HORROR_STARTING_GOLD = 0;

// ---------------------------------------------------------------------------
// Module state
// ---------------------------------------------------------------------------

/** Transport-level bookkeeping, keyed by runId (§7.3 `seq` replay guard). */
interface HorrorRunActivity {
  createdAt: number;
  lastSeenAt: number;
  /** Highest accepted `seq`. 0 means "nothing accepted yet". */
  lastSeq: number;
}

// `next dev` can load a route module in more than one module instance (route
// isolation, HMR), so run state must live on `globalThis`: a module-level Map
// would be re-created and `/act` would not find a run created by `/run`.
const g = globalThis as unknown as {
  __horrorRuns?: Map<string, HorrorRun>;
  __horrorActivity?: Map<string, HorrorRunActivity>;
  __horrorSweeper?: ReturnType<typeof setInterval> | null;
};
const runs = (g.__horrorRuns ??= new Map<string, HorrorRun>());
const activity = (g.__horrorActivity ??= new Map<string, HorrorRunActivity>());

// ---------------------------------------------------------------------------
// Creation
// ---------------------------------------------------------------------------

export interface CreateHorrorRunInput {
  /** Supplied for deterministic tests; generated otherwise. */
  runId?: string;
  /** All randomness derives from this (§7.4). */
  seed: number;
  difficulty: HorrorDifficulty;
}

/**
 * Build a fully initialized day-1 run and put it in the store.
 *
 * Every starting value is taken from §1.5 / §1.6 or a named constant: health and
 * max health are 6000 on all three difficulties, arrows 2, echoes 1, puzzle
 * pieces 9, reroll cost 1. The day-1 monster, day modifier, boss slot and damage
 * anchor are produced by `beginHorrorDay` so there is exactly one definition of
 * what a day looks like — a second copy here would drift from the engine.
 */
export function createHorrorRun(input: CreateHorrorRunInput): HorrorRun {
  const { difficulty } = input;
  if (!(difficulty in HORROR_DIFFICULTIES)) {
    throw new Error(`unknown horror difficulty: ${difficulty}`);
  }
  if (!Number.isFinite(input.seed)) {
    throw new Error("horror run seed must be a finite number");
  }

  const runId = input.runId ?? randomUUID();
  if (runs.has(runId)) {
    throw new Error(`horror run "${runId}" already exists`);
  }

  const config = HORROR_DIFFICULTIES[difficulty];

  const run: HorrorRun = {
    runId,
    seed: input.seed,
    difficulty,
    day: 1,
    // No day has been applied yet; `beginHorrorDay` below sets this to 1.
    dayStarted: null,
    health: config.maxHealth,
    maxHealth: config.maxHealth,
    gold: HORROR_STARTING_GOLD,
    freeRerolls: 0,
    rerollCost: HORROR_REROLL_COST,
    // §1.5 / S1: inventory starts at 4 slots; `Belt Buster` is the only item that
    // raises it, and it raises the array length at eat time (P3). Read from the
    // constant so the store and the merchant cannot disagree about "all four
    // cards" (`Loyalty Card`).
    equipment: new Array<string | null>(HORROR_INVENTORY_SLOTS).fill(null),
    food: [],
    itemStacks: {},
    spells: {},
    // No item grants a spell slot (S6, §3.10), so this starts at 0.
    spellSlots: 0,
    arrows: config.arrowsToStart,
    echoes: config.echoesToStart,
    // S1 day-start shows `happy_thoughts_ready: 1`; the charge pool is what is
    // conserved (`Hammock`/`Cocoa`/`Hopium` restore it), so one charge is armed
    // and `beginHorrorDay` re-arms from the pool. [DESIGN] starting charge.
    happyThoughtsReady: true,
    happyThoughtsCharges: 1,
    puzzlePieces: HORROR_PUZZLE_PIECES,
    boss: null,
    // No target has been set for this day yet; `setTarget` fills it in.
    dayTargetDay: 0,
    // Replaced below by `beginHorrorDay`; present so the record satisfies the
    // contract even if that call throws.
    monster: {
      distance: 0,
      paceMs: 0,
      ticksToday: 0,
      stridesSinceGrowth: 0,
      strideBonusM: 0,
      graceUntil: 0,
    },
    dayModifier: "none",
    damageGrowthAnchor: 0,
    counters: {
      stepCount: 0,
      positions: 0,
      fallCount: 0,
      puzzleFailCount: 0,
      jumpScares: 0,
      mapDrops: 0,
      happyThoughtsUsed: 0,
      scryCast: 0,
      scryHits: 0,
      arrowCast: 0,
      echoCast: 0,
      omenCast: 0,
      rejectedGuessCount: 0,
      goldEarned: 0,
    },
    destroyedStack: [],
  };

  beginHorrorDay(run);
  // Record that day 1 has been applied, so the transport routes' idempotent
  // `ensureHorrorDayStarted` does not reset the monster on the first request.
  run.dayStarted = run.day;

  const now = Date.now();
  runs.set(runId, run);
  activity.set(runId, { createdAt: now, lastSeenAt: now, lastSeq: 0 });
  return run;
}

// ---------------------------------------------------------------------------
// Read / write
// ---------------------------------------------------------------------------

/** The live run record, or undefined. Mutating it mutates the store. */
export function getHorrorRun(runId: string): HorrorRun | undefined {
  return runs.get(runId);
}

export function hasHorrorRun(runId: string): boolean {
  return runs.has(runId);
}

/**
 * Insert or replace a run. Used by P4 when a handler rebuilds a run it created
 * outside the store; ordinary mutation needs only `touchHorrorRun`.
 */
export function saveHorrorRun(run: HorrorRun, now: number = Date.now()): void {
  runs.set(run.runId, run);
  const existing = activity.get(run.runId);
  activity.set(run.runId, {
    createdAt: existing?.createdAt ?? now,
    lastSeenAt: now,
    lastSeq: existing?.lastSeq ?? 0,
  });
}

/** Mark a run as active so the idle sweep leaves it alone. */
export function touchHorrorRun(runId: string, now: number = Date.now()): boolean {
  const entry = activity.get(runId);
  if (!entry) return false;
  entry.lastSeenAt = now;
  return true;
}

export function deleteHorrorRun(runId: string): boolean {
  activity.delete(runId);
  return runs.delete(runId);
}

/** Number of live runs (for capacity checks and tests). */
export function horrorRunCount(): number {
  return runs.size;
}

/** Live run ids, sorted for a stable projection (§7.4 determinism). */
export function horrorRunIds(): string[] {
  return [...runs.keys()].sort();
}

export interface HorrorRunActivitySnapshot {
  runId: string;
  createdAt: number;
  lastSeenAt: number;
  lastSeq: number;
}

export function getHorrorRunActivity(runId: string): HorrorRunActivitySnapshot | undefined {
  const entry = activity.get(runId);
  if (!entry) return undefined;
  return {
    runId,
    createdAt: entry.createdAt,
    lastSeenAt: entry.lastSeenAt,
    lastSeq: entry.lastSeq,
  };
}

// ---------------------------------------------------------------------------
// Replay guard (§7.3: `seq` is monotonic and rejects replays)
// ---------------------------------------------------------------------------

/**
 * Accept `seq` only if it is strictly greater than the last accepted value.
 * Returns false for a replay or an out-of-order request, in which case the
 * caller must reject the action without touching the run.
 *
 * Accepting does **not** touch the idle timer on its own — a rejected sequence
 * should not keep a dead run alive, so callers persist and then `touchHorrorRun`
 * only when they actually apply the action.
 */
export function acceptHorrorSeq(runId: string, seq: number): boolean {
  const entry = activity.get(runId);
  if (!entry) return false;
  if (!Number.isInteger(seq) || seq <= entry.lastSeq) return false;
  entry.lastSeq = seq;
  return true;
}

// ---------------------------------------------------------------------------
// Idle sweep
// ---------------------------------------------------------------------------

/**
 * Drop runs idle for at least `ttlMs`. Returns the number removed.
 *
 * Deliberately time-injected (`now`) so a test can sweep an hour forward without
 * sleeping, exactly like `sweepIdleRooms` is called on an interval by the server
 * bootstrap. This is the horror store's own sweep — it does not touch the room
 * store and they cannot evict each other.
 */
export function sweepIdleHorrorRuns(
  ttlMs: number = HORROR_RUN_IDLE_TTL_MS,
  now: number = Date.now(),
): number {
  let dropped = 0;
  for (const [runId, entry] of activity) {
    if (now - entry.lastSeenAt < ttlMs) continue;
    activity.delete(runId);
    runs.delete(runId);
    dropped += 1;
  }
  // Defensive: a run must never outlive its activity record, or the sweep can
  // never see it again.
  for (const runId of runs.keys()) {
    if (!activity.has(runId)) {
      runs.delete(runId);
      dropped += 1;
    }
  }
  return dropped;
}

/**
 * Start the background sweep. Opt-in rather than module-side-effect, so importing
 * the store in a test or a Next route does not spawn a timer. The interval is
 * `unref()`'d so it never keeps the process alive on its own.
 *
 * Returns a stop function; calling it twice is safe.
 */
export function startHorrorRunSweeper(options?: {
  ttlMs?: number;
  intervalMs?: number;
}): () => void {
  stopHorrorRunSweeper();
  const ttlMs = options?.ttlMs ?? HORROR_RUN_IDLE_TTL_MS;
  const intervalMs = options?.intervalMs ?? HORROR_RUN_SWEEP_INTERVAL_MS;
  const timer = setInterval(() => {
    sweepIdleHorrorRuns(ttlMs);
  }, intervalMs);
  if (typeof timer.unref === "function") timer.unref();
  g.__horrorSweeper = timer;
  return stopHorrorRunSweeper;
}

export function stopHorrorRunSweeper(): void {
  const timer = g.__horrorSweeper;
  if (!timer) return;
  clearInterval(timer);
  g.__horrorSweeper = null;
}

/**
 * Clear the store. Tests only: a horror run is otherwise only removed by the
 * idle sweep or by ending.
 */
export function resetHorrorStore(): void {
  runs.clear();
  activity.clear();
}