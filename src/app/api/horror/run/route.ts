// HorrorGuessr — /api/horror/run route (P4 API, §7.3, §7.4).
//
// Handles creating a new run, resuming an existing run, or fetching the current
// state projection. Uses `horrorStore` for persistence. The response is a safe
// projection that NEVER exposes `seed`, true coordinates, or the boss's hidden
// answer.

import { NextRequest, NextResponse } from "next/server";
import { randomUUID } from "node:crypto";
import {
  createHorrorRun,
  getHorrorRun,
  hasHorrorRun,
  touchHorrorRun,
  horrorRunCount,
} from "@/server-logic/horrorStore";
import { beginHorrorDay, ensureHorrorDayStarted } from "@/server-logic/horrorEngine";
import { deriveHorrorEngineMods } from "@/server-logic/horrorEngine";
import { deriveHorrorItemMods } from "@/server-logic/horrorItems";
import { horrorThresholdAdjustment } from "@/server-logic/horrorItems";
import { effectiveThresholdFor } from "@/server-logic/horrorEngine";
import { getMerchantVisit, merchantOffersForClient } from "@/server-logic/horrorMerchant";
import { ensureDayTarget } from "@/server-logic/horrorBoss";
import type { HorrorDifficulty, HorrorRun } from "@/shared/horrorTypes";

// ---------------------------------------------------------------------------
// Safe projection — strips secrets before sending to client
// ---------------------------------------------------------------------------

interface HorrorRunProjection {
  runId: string;
  difficulty: HorrorDifficulty;
  day: number;
  health: number;
  maxHealth: number;
  gold: number;
  freeRerolls: number;
  rerollCost: number;
  equipment: (string | null)[];
  food: string[];
  itemStacks: Record<string, number>;
  spells: Record<string, number>;
  spellSlots: number;
  arrows: number;
  echoes: number;
  happyThoughtsReady: boolean;
  happyThoughtsCharges: number;
  puzzlePieces: number;
  dayModifier: string;
  monster: {
    distance: number;
    paceMs: number;
    strideBonusM: number;
    graceUntil: number;
  };
  boss: {
    id: string;
    name: { ru: string; en: string };
    health: number;
    maxHealth: number;
    responseMs: [number, number];
    duelTimerMs: number;
    phase: number;
    debuffs: Array<{ kind: string; until: number | null; value?: number }>;
  } | null;
  daySpec: {
    index: number;
    type: string;
    modifier: string;
    bossId: string | null;
    bossRank: string | null;
    threshold: number;
    effectiveThreshold: number;
    thresholdDistanceM: number;
    monsterStartPaceMs: number;
    strideGrowthSteps: number;
    damageGrowth: number;
  };
  counters: {
    stepCount: number;
    positions: number;
    fallCount: number;
    puzzleFailCount: number;
    jumpScares: number;
    mapDrops: number;
    happyThoughtsUsed: number;
    scryCast: number;
    scryHits: number;
    arrowCast: number;
    echoCast: number;
    omenCast: number;
    rejectedGuessCount: number;
    goldEarned: number;
  };
  mods: {
    distancePerStep: number;
    fallChance: number;
    healPerStep: number;
    doubleMoveChance: number;
    guessThresholdDelta: number;
    noJumpscareOnReject: boolean;
    ignoreLowHealthSlowdown: boolean;
    damageTakenMultiplier: number;
    bossDamageTaken: number;
    healthFloor: number | null;
    endDayAtDamage: number | null;
    ignoreThresholdChance: number;
    /** Day modifiers deleted by an equipped item (§4.4). */
    bypassedModifiers: string[];
  };
  itemMods: {
    foodPriceDelta: number;
    freeRerollsOnFullBuy: number;
    bossWinGoldPerRank: number;
    puzzleShape: string | null;
    puzzleUnlockUntilDayEnd: boolean;
    doubleCatchCost: boolean;
    pendingSkipDays: number;
  };
  serverTime: number;
  /** Panorama the client should display today. The coordinates stay server-side. */
  targetPanoId: string | null;
  /** The day's shop shelf, empty until the player opens the merchant. */
  merchantOffers: Array<{ itemId: string; rarity: string; price: number }>;
  actionResult?: {
    kind: string;
    ok: boolean;
    reason?: string;
    caught?: boolean;
    fell?: boolean;
    dead?: boolean;
    rejected?: boolean;
    fullHeal?: boolean;
    distanceKm?: number;
    score?: number;
    destroyed?: boolean;
    [key: string]: unknown;
  };
}

function projectRun(run: HorrorRun, dayStart: ReturnType<typeof beginHorrorDay>): HorrorRunProjection {
  ensureDayTarget(run);
  const engineMods = deriveHorrorEngineMods(run);
  const itemMods = deriveHorrorItemMods(run);
  const consumableThresholdAdj = horrorThresholdAdjustment(run);
  const effectiveThreshold = effectiveThresholdFor(run, run.day, consumableThresholdAdj);

  return {
    runId: run.runId,
    difficulty: run.difficulty,
    day: run.day,
    health: run.health,
    maxHealth: run.maxHealth,
    gold: run.gold,
    freeRerolls: run.freeRerolls,
    rerollCost: run.rerollCost,
    equipment: run.equipment,
    food: run.food,
    itemStacks: run.itemStacks,
    spells: run.spells,
    spellSlots: run.spellSlots,
    arrows: run.arrows,
    echoes: run.echoes,
    happyThoughtsReady: run.happyThoughtsReady,
    happyThoughtsCharges: run.happyThoughtsCharges,
    puzzlePieces: run.puzzlePieces,
    dayModifier: run.dayModifier,
    monster: {
      distance: run.monster.distance,
      paceMs: run.monster.paceMs,
      strideBonusM: run.monster.strideBonusM,
      graceUntil: run.monster.graceUntil,
    },
    boss: run.boss
      ? {
          id: run.boss.id,
          name: run.boss.name,
          health: run.boss.health,
          maxHealth: run.boss.maxHealth,
          responseMs: run.boss.responseMs,
          duelTimerMs: run.boss.duelTimerMs,
          phase: run.boss.phase,
          debuffs: run.boss.debuffs,
        }
      : null,
    daySpec: {
      index: dayStart.day.index,
      type: dayStart.day.type,
      modifier: dayStart.day.modifier,
      bossId: dayStart.day.bossId,
      bossRank: dayStart.day.bossRank,
      threshold: dayStart.threshold,
      effectiveThreshold,
      thresholdDistanceM: dayStart.day.thresholdDistanceM,
      monsterStartPaceMs: dayStart.monsterStartPaceMs,
      strideGrowthSteps: dayStart.day.strideGrowthSteps,
      damageGrowth: dayStart.day.damageGrowth,
    },
    counters: run.counters,
    mods: engineMods,
    itemMods,
    serverTime: Date.now(),
    targetPanoId:
      run.dayTarget && run.dayTargetDay === run.day
        ? run.dayTarget.panoId
        : null,
    merchantOffers: merchantOffersForClient(run.runId),
  };
}

// ---------------------------------------------------------------------------
// GET /api/horror/run?runId=... — fetch current state
// ---------------------------------------------------------------------------

export async function GET(request: NextRequest) {
  const { searchParams } = new URL(request.url);
  const runId = searchParams.get("runId");

  if (!runId) {
    return NextResponse.json(
      { ok: false, reason: "missing_runId" },
      { status: 400, headers: { "x-servertime": Date.now().toString() } },
    );
  }

  const run = getHorrorRun(runId);
  if (!run) {
    return NextResponse.json(
      { ok: false, reason: "not_found" },
      { status: 404, headers: { "x-servertime": Date.now().toString() } },
    );
  }

  touchHorrorRun(runId);
  // Idempotent: a plain state fetch must not reset the monster to 30 m.
  const dayStart = ensureHorrorDayStarted(run);
  const projection = projectRun(run, dayStart);

  return NextResponse.json(
    { ok: true, run: projection },
    { headers: { "x-servertime": Date.now().toString() } },
  );
}

// ---------------------------------------------------------------------------
// POST /api/horror/run — create a new run
// Body: { difficulty: "Normal" | "Hard" | "Nightmare", seed?: number, runId?: string }
// ---------------------------------------------------------------------------

export async function POST(request: NextRequest) {
  let body: { difficulty?: HorrorDifficulty; seed?: number; runId?: string };

  try {
    body = await request.json();
  } catch {
    return NextResponse.json(
      { ok: false, reason: "invalid_json" },
      { status: 400, headers: { "x-servertime": Date.now().toString() } },
    );
  }

  const { difficulty, seed, runId } = body;

  if (!difficulty || !["Normal", "Hard", "Nightmare"].includes(difficulty)) {
    return NextResponse.json(
      { ok: false, reason: "invalid_difficulty" },
      { status: 400, headers: { "x-servertime": Date.now().toString() } },
    );
  }

  // Generate a seed if not provided (deterministic for tests, random otherwise)
  const runSeed = typeof seed === "number" && Number.isFinite(seed) ? seed : Date.now() ^ Math.floor(Math.random() * 0x100000000);

  try {
    const run = createHorrorRun({ runId, seed: runSeed, difficulty });
    // `createHorrorRun` already applied day 1; use the idempotent entry point so
    // the monster is not reset a second time.
    const dayStart = ensureHorrorDayStarted(run);
    const projection = projectRun(run, dayStart);

    return NextResponse.json(
      { ok: true, run: projection },
      { status: 201, headers: { "x-servertime": Date.now().toString() } },
    );
  } catch (error) {
    const message = error instanceof Error ? error.message : "unknown_error";
    return NextResponse.json(
      { ok: false, reason: message },
      { status: 409, headers: { "x-servertime": Date.now().toString() } },
    );
  }
}

// ---------------------------------------------------------------------------
// PUT /api/horror/run — resume/refresh a run (recompute day start if needed)
// Body: { runId: string }
// ---------------------------------------------------------------------------

export async function PUT(request: NextRequest) {
  let body: { runId?: string };

  try {
    body = await request.json();
  } catch {
    return NextResponse.json(
      { ok: false, reason: "invalid_json" },
      { status: 400, headers: { "x-servertime": Date.now().toString() } },
    );
  }

  const { runId } = body;

  if (!runId) {
    return NextResponse.json(
      { ok: false, reason: "missing_runId" },
      { status: 400, headers: { "x-servertime": Date.now().toString() } },
    );
  }

  if (!hasHorrorRun(runId)) {
    return NextResponse.json(
      { ok: false, reason: "not_found" },
      { status: 404, headers: { "x-servertime": Date.now().toString() } },
    );
  }

  const run = getHorrorRun(runId)!;
  touchHorrorRun(runId);
  // Idempotent: resuming a run must not reset the monster to 30 m.
  const dayStart = ensureHorrorDayStarted(run);
  const projection = projectRun(run, dayStart);

  return NextResponse.json(
    { ok: true, run: projection },
    { headers: { "x-servertime": Date.now().toString() } },
  );
}