// HorrorGuessr — the headless run engine (§1.2, §1.4, §1.5, §4.1, §4.3, §8 P2).
//
// Pure server-side logic, no I/O and no transport concerns: it mutates a
// `HorrorRun` record and returns a result describing what happened. Persistence
// lives in [`src/server-logic/horrorStore.ts`](src/server-logic/horrorStore.ts),
// item interpretation in `horrorItems.ts` (P3), the API in P4. Nothing here reads
// or writes `Room`, `Player` or `Phase` (§7.2, acceptance 11).
//
// **Single source of math.** Every number the engine reports is produced by a
// function from [`src/shared/horrorScoring.ts`](src/shared/horrorScoring.ts) —
// `computeHorrorScore`, `computeHorrorDamage`, `thresholdForDay`, `ringRadiusM`,
// `startPaceMs`, `paceAtStep`, `strideGrowth`, `damageGrowthFor`, `rankForDay`,
// `daySpec`, `bossRewardOdds`. The engine never re-derives a curve, so a P1 test
// that pins `2230 ms` or `628` damage also pins the engine.
//
// **The one thing the engine does own** is the *state machine* the scoring module
// deliberately omits: when a day starts, what resets, which monster fields move
// on a step versus a tick, and when a run is over. That split is why
// `paceAtStep` takes a step index instead of reading monster state.

import type { LatLng } from "../shared/types";
import type {
  HorrorBossRank,
  HorrorBossState,
  HorrorDay,
  HorrorDayCounters,
  HorrorDifficulty,
  HorrorEffect,
  HorrorItem,
  HorrorRun,
} from "../shared/horrorTypes";
import {
  HORROR_BOSS_HP_BY_RANK,
  HORROR_BOSS_RESPONSE_S,
  HORROR_DUEL_TIMER_MS,
  HORROR_FALLS,
  HORROR_FINAL_BOSS_DAY,
  HORROR_JUMPSCARE_COSTS_STEPS,
  HORROR_LATE_STRIDE_FROM_DAY,
  HORROR_LATE_STRIDE_GAP_M,
  HORROR_LOW_HEALTH_SLOWDOWN,
  HORROR_MAX_POINTS,
  HORROR_PACE_DAY_OFFSET,
  HORROR_PERFECT_RADIUS_M,
  HORROR_START_DISTANCE_M,
  HORROR_STEP_PUSH_BACK_M,
  HORROR_STEP_TIME_FLOOR_S,
  HORROR_STRIDE_M,
  HORROR_HAPPY_THOUGHTS,
  HORROR_HAPPY_THOUGHTS_COSTS_STEPS,
  HORROR_DIFFICULTIES,
  getHorrorItem,
} from "../shared/horrorCatalogue";
import {
  computeHorrorDamage,
  computeHorrorScore,
  damageGrowthFor,
  daySpec,
  paceAtStep,
  rankForDay,
  startPaceMs,
  strideGrowth,
  thresholdForDay,
} from "../shared/horrorScoring";
import { haversineKm } from "../shared/scoring";

// ---------------------------------------------------------------------------
// Determinism (§7.4)
// ---------------------------------------------------------------------------

/**
 * mulberry32 — a 32-bit seeded generator. Small, fast, and identical on every
 * platform, which is what "same seed + same actions ⇒ identical ledger"
 * (acceptance 10) requires. All randomness in a run draws from one stream so the
 * order of rolls is the order of actions.
 */
export function createHorrorRng(seed: number): () => number {
  let state = seed >>> 0;
  return () => {
    state = (state + 0x6d2b79f5) >>> 0;
    let t = state;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/**
 * The live RNG for a run. Kept beside the run rather than on it so the persisted
 * contract (§1.6) carries no generator closure. Because it is keyed by the run
 * object, replaying the same actions against a rebuilt run reproduces the same
 * rolls.
 */
const g = globalThis as unknown as {
  __horrorRngByRun?: WeakMap<HorrorRun, () => number>;
};
const rngByRun = (g.__horrorRngByRun ??= new WeakMap<HorrorRun, () => number>());

export function horrorRngFor(run: HorrorRun): () => number {
  let rng = rngByRun.get(run);
  if (!rng) {
    rng = createHorrorRng(run.seed);
    rngByRun.set(run, rng);
  }
  return rng;
}

// ---------------------------------------------------------------------------
// Boss identity (§1.2, §5.1, §5.3)
// ---------------------------------------------------------------------------

/**
 * `daySpec` labels every non-Chase day `"clown"` because the Clown is the
 * *rolled* boss on days 5/10/15/20/25 (C16). Day 30 belongs to a separate final
 * boss (§5.4: "Day 30's final boss rolls nothing"), so the engine overrides the
 * id there. The full roster and the duel model live in
 * [`src/server-logic/horrorBoss.ts`](src/server-logic/horrorBoss.ts) (P8); the
 * engine only needs a boss state to hang the day on, and it builds that state
 * here rather than importing the boss module — the boss module imports the
 * engine's RNG, so a reverse import would be a cycle.
 */
export const HORROR_FINAL_BOSS_ID = "finalBoss";

const BOSS_NAMES: Record<string, { ru: string; en: string }> = {
  clown: { ru: "Клоун", en: "The Clown" },
  [HORROR_FINAL_BOSS_ID]: { ru: "Финальный босс", en: "The Final Boss" },
};

function bossNameFor(bossId: string): { ru: string; en: string } {
  return BOSS_NAMES[bossId] ?? { ru: bossId, en: bossId };
}

/**
 * Boss HP by rank, read from the rank-scaled family (§5.3). Only the `Hangout`
 * row is [CODEX]; the rest are interpolated at +20% per rank and are tunable.
 */
export function bossHealthFor(rank: HorrorBossRank, difficulty: HorrorDifficulty): number {
  return HORROR_BOSS_HP_BY_RANK[rank][difficulty];
}

/**
 * Build the day's boss state.
 *
 * The engine only needs an id, a name, a mechanic and HP to hang the day on; the
 * P8 roster in [`horrorBoss.ts`](src/server-logic/horrorBoss.ts) owns the full
 * definitions and the duel model. Days 1–30 are the Clown (perennial, C16) and
 * the day-30 finale; the endless roster is drawn by the boss layer, which
 * re-derives the boss from the run when a post-campaign day opens.
 */
function createBossState(day: HorrorDay, difficulty: HorrorDifficulty): HorrorBossState {
  const bossId = day.type === "FinalBoss" ? HORROR_FINAL_BOSS_ID : "clown";
  const rank = day.bossRank ?? rankForDay(day.index);
  const hp = bossHealthFor(rank, difficulty);
  return {
    id: bossId,
    name: bossNameFor(bossId),
    mechanic: day.type === "FinalBoss" ? "chosenRewards" : "rngChaos",
    health: hp,
    maxHealth: hp,
    responseMs: [HORROR_BOSS_RESPONSE_S[0] * 1000, HORROR_BOSS_RESPONSE_S[1] * 1000],
    duelTimerMs: HORROR_DUEL_TIMER_MS,
    phase: 1,
    debuffs: [],
    playerLockedAt: null,
    bossLockedAt: null,
    bossAnswer: null,
  };
}

// ---------------------------------------------------------------------------
// The equipment layer the engine consumes
// ---------------------------------------------------------------------------

/**
 * The subset of item effects the engine itself reads.
 *
 * This is **not** the effect interpreter (§7.2 assigns that to
 * `horrorItems.ts`, P3): it is the projection the day/monster/damage loops need
 * in order to be correct on their own. It reads only `equipment`, which S1
 * confirms holds consumables too (`"defibrillator,pillow,compass"`).
 *
 * Every field is *derived*, never accumulated into the run, so destroying an item
 * cannot leak a buff (§3.3).
 */
export interface HorrorEngineMods {
  /** Metres of lead gained per player move. Base +1 (S10 p.1, C13). */
  distancePerStep: number;
  /** Effective fall chance per step, 0..1. Base 2% (S10 p.21). */
  fallChance: number;
  /** Health lost on a fall. Always 50: no item changes it (§4.8). */
  fallDamage: number;
  /** Health restored per move (`Ambulance +30`). */
  healPerStep: number;
  /** Chance a move counts twice (`Tricycle` 20%). */
  doubleMoveChance: number;
  /** Sum of equipped `guessThreshold` mods (`Compass −250`, `Atlas −400`). */
  guessThresholdDelta: number;
  /** `Earplugs`: a rejected guess does not trigger a jumpscare. */
  noJumpscareOnReject: boolean;
  /** `Saucer` / `Smelling Salts`: no low-health movement slowdown. */
  ignoreLowHealthSlowdown: boolean;
  /**
   * Multiplier on all incoming damage (`Leather Coat` ×0.8). Percentages
   * compose last, against the summed absolute (§3.4 rule 6).
   */
  damageTakenMultiplier: number;
  /**
   * Flat reduction on **boss** damage only (`Trash Lid −200`), applied before the
   * multiplier. Distinct from `damageTakenMultiplier` because the Codex states
   * them as different ops: one is boss-scoped and flat, the other global and
   * proportional.
   */
  bossDamageTaken: number;
  /** Largest equipped `healthFloor`, or null. `Helmet` 1, `Jumper Cables` 2000. */
  healthFloor: number | null;
  /** The item that owns `healthFloor`, so P3 can destroy exactly that copy. */
  healthFloorItemId: string | null;
  /** `Gut of the Bloatlord`: end the day at this damage instead of losing. */
  endDayAtDamage: number | null;
  /** `Gut of the Bloatlord` item id. */
  endDayAtDamageItemId: string | null;
  /** Chance to ignore the day's gate (`Rabbit's Foot` 20%). */
  ignoreThresholdChance: number;
  /**
   * Day modifiers deleted by an equipped item (§4.4): `Torch` → `lightsOut`,
   * `Beer Goggles` → `darkPano`. The visual layer reads this so a bypassed
   * modifier renders as `none` without the client re-deriving the rule.
   */
  bypassedModifiers: string[];
}

export function equippedHorrorItems(run: HorrorRun): HorrorItem[] {
  const items: HorrorItem[] = [];
  for (const slot of run.equipment) {
    if (slot === null) continue;
    const item = getHorrorItem(slot);
    if (item) items.push(item);
  }
  return items;
}

/**
 * An effect paired with the item that owns it, so a caller can tell *why* a
 * modifier exists — which item to destroy, which slot to blame.
 */
interface OwnedEffect {
  item: HorrorItem;
  effect: HorrorEffect;
}

/**
 * Every effect in `items` whose op matches and whose **owning item** declares the
 * `equipped` trigger.
 *
 * The trigger gate matters: `Gulskinna` has `onBossWin` and `onHappyThoughts`
 * effects and no `equipped` ones, so it must contribute nothing continuous, while
 * `Skateboard` mixes an `equipped` pair with an `onFall` destroy and must
 * contribute only the pair. Matching is done per item during the walk, so two
 * items carrying identical effect objects cannot be confused for one another.
 */
function equippedEffects(items: HorrorItem[], op: string): OwnedEffect[] {
  const out: OwnedEffect[] = [];
  for (const item of items) {
    if (!item.trigger.includes("equipped")) continue;
    for (const effect of item.effects) {
      if (effect.op === op) out.push({ item, effect });
    }
  }
  return out;
}

/** Every effect with `op`, regardless of trigger. For reactive ops. */
function anyEffects(items: HorrorItem[], op: string): OwnedEffect[] {
  const out: OwnedEffect[] = [];
  for (const item of items) {
    for (const effect of item.effects) {
      if (effect.op === op) out.push({ item, effect });
    }
  }
  return out;
}

function sumEffectValues(entries: OwnedEffect[]): number {
  return entries.reduce((total, entry) => total + entry.effect.value, 0);
}

function clamp01(value: number): number {
  return Math.min(1, Math.max(0, value));
}

/**
 * Derive every modifier the engine reads from the equipped inventory.
 *
 * Nothing is accumulated into the run: this is a projection of `run.equipment`,
 * recomputed on demand. That single design choice is what makes "removing an
 * equipped item fully reverts its modifiers" (acceptance 8) and "a `stacks` bonus
 * must die with its copy" (§3.3) true by construction rather than by cleanup code.
 *
 * **What the engine reads vs what P3 reads.** The engine only needs the combat
 * loop: lead per step, falls, the gate, the floored lethal save, and the
 * catch-to-day-end conversion. Everything else — `stacks` maths, `oneOf` branches,
 * gold, spells, merchant mods, destruction — belongs to the interpreter in
 * `horrorItems.ts` (P3), which owns `itemStacks`. Keeping the split explicit is
 * why this function has nine fields and not ninety.
 */
export function deriveHorrorEngineMods(run: HorrorRun): HorrorEngineMods {
  const items = equippedHorrorItems(run);

  // Fall chance composes multiplicatively across equipped items (§4.8): a x4 item
  // on a 2% base is 8%, and a x0.2 on top cancels most of it.
  let fallChance = HORROR_FALLS.chancePerStep;
  for (const { effect } of equippedEffects(items, "fallChance")) {
    fallChance *= effect.fallMultiplier ?? effect.value;
  }

  // The strongest floored save wins: `Jumper Cables` (2000) over `Helmet` (1).
  let healthFloor: number | null = null;
  let healthFloorItemId: string | null = null;
  for (const { item, effect } of anyEffects(items, "healthFloor")) {
    const value = effect.healthFloor ?? effect.value;
    if (value > 0 && (healthFloor === null || value > healthFloor)) {
      healthFloor = value;
      healthFloorItemId = item.id;
    }
  }

  // `Gut of the Bloatlord`: the only catch-to-day-end conversion in the game.
  let endDayAtDamage: number | null = null;
  let endDayAtDamageItemId: string | null = null;
  for (const { item, effect } of anyEffects(items, "endDayAtDamage")) {
    const value = effect.endDayAtDamage ?? effect.value;
    if (value > 0 && (endDayAtDamage === null || value > endDayAtDamage)) {
      endDayAtDamage = value;
      endDayAtDamageItemId = item.id;
    }
  }

  const doubleMoveChance = clamp01(
    anyEffects(items, "doubleMoveChance").reduce(
      (total, { effect }) => total + (effect.doubleMoveChance ?? effect.value),
      0,
    ),
  );

  const ignoreThresholdChance = clamp01(
    anyEffects(items, "ignoreThresholdChance").reduce(
      (total, { effect }) => total + (effect.ignoreChance ?? effect.value),
      0,
    ),
  );

  const hasFlag = (op: string) =>
    items.some((item) =>
      item.effects.some((effect) => effect.op === op && Boolean(effect[op as keyof HorrorEffect])),
    );

  // `Leather Coat` is the only `damageTakenMultiplier` in the catalogue (−20%, so
  // ×0.8). The op carries the *resulting* multiplier, so multiple sources would
  // compose by multiplication; there is exactly one, and multiplying is what
  // §3.4 rule 6 ("percentages resolve last") means.
  let damageTakenMultiplier = 1;
  for (const { effect } of anyEffects(items, "damageTakenMultiplier")) {
    damageTakenMultiplier *= effect.damageTakenMultiplier ?? effect.value;
  }

  // `Torch` deletes Lights Out, `Beer Goggles` deletes Dark Panorama (§4.4).
  // Shadow Realm has no counter, so it never appears here.
  const bypassedModifiers = anyEffects(items, "bypassModifier")
    .map(({ effect }) => effect.modifier)
    .filter((modifier): modifier is NonNullable<typeof modifier> => Boolean(modifier));

  return {
    // C13 / S10 p.1: the BASE is +1 and it pushes him AWAY. Items add to it
    // (`Skateboard +1`, `Hearse +2`, `Ambulance +3`, `Saucer +3`), so an equipped
    // Skateboard is +2 m of lead per move.
    distancePerStep: HORROR_STEP_PUSH_BACK_M + sumEffectValues(equippedEffects(items, "distancePerStep")),
    fallChance: clamp01(fallChance),
    // No item changes the 50 (§4.8), so this is never item-derived.
    fallDamage: HORROR_FALLS.damage,
    healPerStep: sumEffectValues(equippedEffects(items, "healPerStep")),
    doubleMoveChance,
    // Items are an applied layer on the base ramp, never baked in (§4.3).
    guessThresholdDelta: sumEffectValues(equippedEffects(items, "guessThreshold")),
    noJumpscareOnReject: hasFlag("noJumpscareOnReject"),
    ignoreLowHealthSlowdown: hasFlag("ignoreLowHealthSlowdown"),
    damageTakenMultiplier: Math.max(0, damageTakenMultiplier),
    bossDamageTaken: sumEffectValues(anyEffects(items, "bossDamageTaken")),
    healthFloor,
    healthFloorItemId,
    endDayAtDamage,
    endDayAtDamageItemId,
    ignoreThresholdChance,
    bypassedModifiers,
  };
}

// ---------------------------------------------------------------------------
// Threshold (§4.3, C15†)
// ---------------------------------------------------------------------------

/**
 * `effectiveThreshold = baseThreshold(day) + equipment mods + consumable mods`.
 *
 * The base ramp is a pure function of day and difficulty (§1.2); items are an
 * applied layer and are **never** baked into it (§4.3 ruling 1). Equipment mods
 * are derived here; `consumableAdjustment` carries one-shot food deltas
 * (`Carrot Cake −75`, `Sponge Cake −125`, `Candy Corn −250`) which P3's
 * interpreter accumulates, because a consumed item leaves no trace in
 * `equipment`.
 *
 * S1 witness (§4.3): `thresholdForDay(3, "Normal") + Compass(−250) = 1290`, the
 * exact observed gate. `ringRadiusM(1290, "us")` is then the observed
 * `3 621 567 m` ring.
 */
export function effectiveThresholdFor(
  run: HorrorRun,
  day: number = run.day,
  consumableAdjustment = 0,
): number {
  const base = thresholdForDay(day, run.difficulty);
  const mods = deriveHorrorEngineMods(run).guessThresholdDelta;
  return Math.max(0, base + mods + consumableAdjustment);
}

// ---------------------------------------------------------------------------
// Day lifecycle (§1.2, §8 P2)
// ---------------------------------------------------------------------------

export interface HorrorDayOptions {
  /** Two-letter country of the day's location; scales the ring (§4.3). */
  countryCode?: string;
  /**
   * §0.5 fidelity switch. `0` is the documented Codex convention; `1`
   * reproduces S1's `2230 ms` on Normal day 3. Kept as a parameter so both
   * encodings can be tested without bending the rule.
   */
  paceDayOffset?: number;
}

export interface HorrorDayStart {
  /** The full computed day spec. */
  day: HorrorDay;
  /** Base gate, before the item layer. */
  threshold: number;
  /** Gate actually enforced, item layer applied. */
  effectiveThreshold: number;
  /** The boss for this day, or null on a Chase day. */
  boss: HorrorBossState | null;
  /** Day-start pace in ms, after the Shadow Realm override. */
  monsterStartPaceMs: number;
}

function resetDayCounters(): HorrorDayCounters {
  return {
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
  };
}

/**
 * Build the spec for the run's current day without mutating anything.
 *
 * `daySpec` (P1) hardcodes the documented `paceDayOffset: 0` convention, so when
 * a caller asks for the S1 fidelity variant this function recomputes the single
 * field that differs. At offset 0 the two agree exactly — there is one rule, not
 * two.
 */
export function horrorDaySpecFor(run: HorrorRun, options?: HorrorDayOptions): HorrorDay {
  const spec = daySpec(run.day, run.difficulty, options?.countryCode ?? "");
  const offset = options?.paceDayOffset ?? HORROR_PACE_DAY_OFFSET;
  if (offset === HORROR_PACE_DAY_OFFSET) return spec;
  return {
    ...spec,
    monsterStartPaceMs: startPaceMs(run.day, run.difficulty, offset),
  };
}

/**
 * Start (or restart) the run's current day.
 *
 * Everything here is a reset, and each reset is a Codex rule:
 *
 * - the monster returns to **30 m** every day (S10 p.1), at the day's start pace;
 * - intra-day state (`ticksToday`, `stridesSinceGrowth`, `strideBonusM`) clears,
 *   because the stride table is indexed by day (§1.4);
 * - the day's modifier is selected from the calendar (§1.2);
 * - a Boss / FinalBoss day spawns a boss with rank derived from the day and HP
 *   from the rank family (§5.3);
 * - `damageGrowthAnchor` is set to the **rounded** reference damage, so growth
 *   compounds from the base the game uses rather than from a raw curve (§0.5).
 */
export function beginHorrorDay(run: HorrorRun, options?: HorrorDayOptions): HorrorDayStart {
  const spec = horrorDaySpecFor(run, options);
  const mods = deriveHorrorEngineMods(run);

  // Shadow Realm runs the monster at day 1's pace (§1.4).
  const basePaceMs =
    spec.modifier === "shadowRealm"
      ? startPaceMs(1, run.difficulty, options?.paceDayOffset ?? HORROR_PACE_DAY_OFFSET)
      : spec.monsterStartPaceMs;

  run.dayModifier = spec.modifier;
  run.monster = {
    distance: HORROR_START_DISTANCE_M,
    paceMs: basePaceMs,
    ticksToday: 0,
    stridesSinceGrowth: 0,
    strideBonusM: 0,
    graceUntil: 0,
  };
  run.boss = spec.type === "Chase" ? null : createBossState(spec, run.difficulty);
  run.happyThoughtsReady = run.happyThoughtsCharges > 0;
  // §0.5: damage growth compounds from a rounded anchor. The reference guess is
  // a 4500 — the Codex's own worked example — so the anchor is 167 on Normal and
  // Hard and 250 on Nightmare, and `167 · 1.25^(day−35)` reproduces every
  // Normal row of the growth table.
  run.damageGrowthAnchor = computeHorrorDamage(4500, run.difficulty);

  return {
    day: spec,
    threshold: thresholdForDay(run.day, run.difficulty),
    effectiveThreshold: Math.max(0, thresholdForDay(run.day, run.difficulty) + mods.guessThresholdDelta),
    boss: run.boss,
    monsterStartPaceMs: basePaceMs,
  };
}

/**
 * Start the run's current day **only if it has not been started yet**.
 *
 * `beginHorrorDay` is a reset: it puts the monster back at 30 m and clears the
 * intra-day counters. The transport routes need a day to exist on every request,
 * but calling the reset on every request would erase every tick and step the
 * player has earned — which is exactly why the monster used to sit frozen at
 * 30 m. This wrapper is the idempotent entry point the routes should use: it
 * applies the reset once per day and is a no-op afterwards.
 *
 * `beginHorrorDay` itself keeps its reset semantics, because the engine's own
 * tests and `endHorrorDay` rely on it restarting a day unconditionally.
 */
export function ensureHorrorDayStarted(run: HorrorRun, options?: HorrorDayOptions): HorrorDayStart {
  // Check for active session: dayStarted must be set and match current day
  // This prevents resetting distance to 30m on every action when session is valid
  if (run.dayStarted !== null && run.dayStarted === run.day) {
    const spec = horrorDaySpecFor(run, options);
    const mods = deriveHorrorEngineMods(run);
    return {
      day: spec,
      threshold: thresholdForDay(run.day, run.difficulty),
      effectiveThreshold: Math.max(0, thresholdForDay(run.day, run.difficulty) + mods.guessThresholdDelta),
      boss: run.boss,
      monsterStartPaceMs: run.monster.paceMs,
    };
  }
  const start = beginHorrorDay(run, options);
  run.dayStarted = run.day;
  return start;
}

export type HorrorDayOutcome =
  | "guessed"
  | "caught"
  | "died"
  | "bossWon"
  | "bossLost"
  | "skipped";

export interface HorrorDayEndOptions extends HorrorDayOptions {
  /** Days to advance (default 1). `Saucer` skips 7, `Time Machine` skips 1. */
  advanceDays?: number;
}

export interface HorrorDayEndResult {
  outcome: HorrorDayOutcome;
  /** False when the run ended on this day. */
  advanced: boolean;
  runOver: boolean;
  /** True when the day-30 final boss was beaten, unlocking 31–40 (§1.1). */
  campaignUnlocked: boolean;
  nextDayStart: HorrorDayStart | null;
  reason: string | null;
}

/**
 * Close the current day and open the next one.
 *
 * Acceptance 9: a loss on day 30 ends the run; a win unlocks days 31–40. Dying at
 * any point ends the run regardless of the day. Counters are day-scoped and reset
 * here rather than in `beginHorrorDay`, so a caller that inspects them after a day
 * still sees that day's totals.
 */
export function endHorrorDay(
  run: HorrorRun,
  outcome: HorrorDayOutcome,
  options?: HorrorDayEndOptions,
): HorrorDayEndResult {
  const wasFinalBossDay = run.day === HORROR_FINAL_BOSS_DAY;
  const campaignUnlocked = wasFinalBossDay && outcome === "bossWon";

  const runOver =
    outcome === "died" ||
    run.health <= 0 ||
    (wasFinalBossDay && (outcome === "bossLost" || outcome === "caught"));

  if (runOver) {
    run.health = Math.max(0, run.health);
    run.boss = null;
    return {
      outcome,
      advanced: false,
      runOver: true,
      campaignUnlocked: false,
      nextDayStart: null,
      reason: wasFinalBossDay ? "final_boss_lost" : "run_over",
    };
  }

  run.day += Math.max(1, options?.advanceDays ?? 1);
  run.counters = resetDayCounters();
  const nextDayStart = beginHorrorDay(run, options);
  // A genuinely new day: record it so the routes' idempotent
  // `ensureHorrorDayStarted` treats the reset as already applied.
  run.dayStarted = run.day;

  return {
    outcome,
    advanced: true,
    runOver: false,
    campaignUnlocked,
    nextDayStart,
    reason: null,
  };
}

// ---------------------------------------------------------------------------
// Monster (§1.4) — movement is what keeps him away, time is what kills you
// ---------------------------------------------------------------------------

/** Effective metres he closes per pursuit tick: base 1 m plus stride growth. */
export function monsterStrideM(run: HorrorRun): number {
  return HORROR_STRIDE_M + run.monster.strideBonusM;
}

/**
 * Register `steps` steps against the stride-growth counter (§1.4).
 *
 * Growth only accrues **once the step time is maxed** (`paceMs <= 0.3 s`), which
 * is the anti-turtling mechanic: at the floor, distance is what decays and the
 * only thing that shortens survival further is stride. Used by ticks and by the
 * jumpscare, which "grows his stride as if those steps were taken".
 */
function accrueStrideGrowth(run: HorrorRun, steps: number): void {
  if (run.monster.paceMs > HORROR_STEP_TIME_FLOOR_S * 1000) return;
  const needed = Math.max(1, strideGrowth(run.day, run.difficulty));
  run.monster.stridesSinceGrowth += steps;
  while (run.monster.stridesSinceGrowth >= needed) {
    run.monster.stridesSinceGrowth -= needed;
    run.monster.strideBonusM += 1;
  }
}

/** Day-start pace in seconds, which is what `paceAtStep` expects. */
function dayStartPaceSeconds(run: HorrorRun, paceDayOffset = HORROR_PACE_DAY_OFFSET): number {
  const startMs =
    run.dayModifier === "shadowRealm"
      ? startPaceMs(1, run.difficulty, paceDayOffset)
      : startPaceMs(run.day, run.difficulty, paceDayOffset);
  return startMs / 1000;
}

export interface MonsterTickResult {
  /** False while Happy Thoughts is freezing him. */
  ticked: boolean;
  distanceBefore: number;
  distanceAfter: number;
  /** True only when a tick would take him past 0 — reaching 0 is not a catch. */
  caught: boolean;
  strideBonusM: number;
  paceMs: number;
}

/**
 * One pursuit tick: `−1 m` per tick, plus the late-campaign head-start tax.
 *
 * The catch rule is Codex-exact (S10 p.1): **reaching 0 m is not a catch, the next
 * step catches**. From a 30 m start that is 31 ticks — 30 to arrive at 0 and one
 * more to catch — which is exactly `HORROR_CATCH_STEPS` and exactly the 31 terms
 * the standing-still table sums (§0.5). So `caught` is `distance would go < 0`,
 * and `distance` is floored at 0.
 *
 * The intra-day pace decay is grouped (§0.5): `paceAtStep` holds for
 * `intraEverySteps` ticks, then drops by `intraDayS`, clamped at 0.3 s. That is
 * why `ticksToday` is state.
 */
export function tickMonster(run: HorrorRun, now: number): MonsterTickResult {
  const distanceBefore = run.monster.distance;

  if (now < run.monster.graceUntil) {
    return {
      ticked: false,
      distanceBefore,
      distanceAfter: distanceBefore,
      caught: false,
      strideBonusM: run.monster.strideBonusM,
      paceMs: run.monster.paceMs,
    };
  }

  // Base stride closes 1 m (S10 p.2).
  let distance = distanceBefore - monsterStrideM(run);

  // Late-campaign head-start tax: from day 36 a large lead actively shrinks,
  // +1 m per 40 m of gap, per step (S10 p.2, §1.4).
  if (run.day >= HORROR_LATE_STRIDE_FROM_DAY) {
    distance -= Math.floor(Math.max(0, distance) / HORROR_LATE_STRIDE_GAP_M);
  }

  const caught = distance < 0;
  run.monster.distance = Math.max(0, distance);

  run.monster.ticksToday += 1;
  const paceSeconds = paceAtStep(dayStartPaceSeconds(run), run.monster.ticksToday + 1, run.difficulty);
  run.monster.paceMs = paceSeconds * 1000;

  accrueStrideGrowth(run, 1);

  return {
    ticked: true,
    distanceBefore,
    distanceAfter: run.monster.distance,
    caught,
    strideBonusM: run.monster.strideBonusM,
    paceMs: run.monster.paceMs,
  };
}

export interface PlayerStepResult {
  distanceAfter: number;
  /** True when the move counted twice (`Tricycle`). */
  doubleMove: boolean;
  /** Metres of lead gained. */
  gainedM: number;
  fell: boolean;
  fallDamage: number;
  healed: number;
  /** Set when the step's fall was lethal. */
  dead: boolean;
  /** True when the step itself pushed him to 0 or beyond — never a catch. */
  monsterAtZero: boolean;
}

/**
 * A player move: `+1 m` of lead per step (C13), the opposite sign to a tick.
 *
 * Also rolls the 2%/step fall (§4.8). A fall costs 50 damage **and** a jumpscare
 * of 20 steps — the jumpscare is the real cost, twenty times the health — so the
 * fall applies both. `healPerStep` (`Ambulance +30`) heals on the move.
 */
export function playerStep(run: HorrorRun): PlayerStepResult {
  const mods = deriveHorrorEngineMods(run);
  const rng = horrorRngFor(run);

  const doubleMove = mods.doubleMoveChance > 0 && rng() < mods.doubleMoveChance;
  const gainedM = mods.distancePerStep * (doubleMove ? 2 : 1);
  run.monster.distance += gainedM;
  run.counters.stepCount += 1;
  run.counters.positions += 1;

  let healed = 0;
  if (mods.healPerStep > 0) {
    const before = run.health;
    run.health = Math.min(run.maxHealth, run.health + mods.healPerStep);
    healed = run.health - before;
  }

  let fell = false;
  let fallDamage = 0;
  let dead = false;
  if (mods.fallChance > 0 && rng() < mods.fallChance) {
    fell = true;
    run.counters.fallCount += 1;
    const result = applyDamageToPlayer(run, mods.fallDamage, "fall");
    fallDamage = result.applied;
    dead = result.dead;
    // Fall no longer triggers a jumpscare (20-step penalty removed)
  }

  return {
    distanceAfter: run.monster.distance,
    doubleMove,
    gainedM,
    fell,
    fallDamage,
    healed,
    dead,
    monsterAtZero: run.monster.distance <= 0,
  };
}

export interface JumpscareResult {
  stepsStolen: number;
  metresLost: number;
  distanceAfter: number;
  caught: boolean;
}

/**
 * A jumpscare costs **20 steps' worth of progress** and grows his stride as
 * though those steps were taken (S10 p.1, §4.2). It is a teleport toward the
 * player, not a speed buff — so it mutates `distance` and the stride counter, and
 * never `paceMs`.
 */
export function applyJumpscare(run: HorrorRun): JumpscareResult {
  const stride = monsterStrideM(run);
  const metresLost = HORROR_JUMPSCARE_COSTS_STEPS * stride;
  run.monster.distance = Math.max(0, run.monster.distance - metresLost);
  run.counters.jumpScares += 1;
  accrueStrideGrowth(run, HORROR_JUMPSCARE_COSTS_STEPS);
  return {
    stepsStolen: HORROR_JUMPSCARE_COSTS_STEPS,
    metresLost,
    distanceAfter: run.monster.distance,
    // A jumpscare can bring him to you but cannot itself land the catch; the next
    // tick does that (S10 p.1).
    caught: run.monster.distance <= 0,
  };
}

/**
 * Player step cadence multiplier from low health (§4.8).
 *
 * Low-health slowdown is real — two items negate it, so the mechanic exists — but
 * it is a **player** penalty, never a monster-pace term, which keeps §0.5's
 * reproduced pace numbers untouched.
 */
export function playerStepTimeMultiplier(run: HorrorRun): number {
  const mods = deriveHorrorEngineMods(run);
  if (mods.ignoreLowHealthSlowdown) return 1;
  if (run.maxHealth <= 0) return 1;
  if (run.health > run.maxHealth * HORROR_LOW_HEALTH_SLOWDOWN.belowFraction) return 1;
  return HORROR_LOW_HEALTH_SLOWDOWN.stepTimeMultiplier;
}

// ---------------------------------------------------------------------------
// Damage and death (§1.3, §1.5)
// ---------------------------------------------------------------------------

export type HorrorDamageSource = "guess" | "fall" | "boss" | "item";

export interface HorrorDamageResult {
  requested: number;
  applied: number;
  healthBefore: number;
  healthAfter: number;
  dead: boolean;
  /** Set when a `healthFloor` item saved the player (`Helmet`, `Jumper Cables`). */
  floorUsed: { itemId: string; floor: number } | null;
}

/**
 * Subtract health, honouring the `minus` flooring rule from §1.3.
 *
 * Two Codex mechanics live here:
 *
 * 1. Health is an integer pool and damage subtracts directly (`4964 − 628 = 4336`).
 * 2. Incoming damage is reduced by the equipment layer, **absolutes before
 *    percentages** (§3.4 rule 6): `Trash Lid −200` applies only to boss hits, then
 *    `Leather Coat ×0.8` scales whatever is left. Order matters — a flat −200
 *    applied after a ×0.8 would be worth only 160.
 * 3. A lethal hit is survivable once if a `healthFloor` item is equipped —
 *    `Helmet` at 1, `Jumper Cables` at 2000. Those items are destroyed by their
 *    own effect; the engine reports which copy fired so P3's destruction path can
 *    remove exactly that one (§3.3: a stack bonus must die with its copy).
 *
 * `source` is load-bearing: it decides whether the boss-scoped flat reduction is
 * eligible. `fall` / `guess` / `item` damage never sees `Trash Lid`.
 */
export function applyDamageToPlayer(
  run: HorrorRun,
  amount: number,
  source: HorrorDamageSource = "guess",
): HorrorDamageResult {
  const healthBefore = run.health;
  const mods = deriveHorrorEngineMods(run);

  let requested = Math.max(0, amount);
  // Flat, boss-scoped, before the percentage: `Trash Lid −200`.
  if (source === "boss") requested = Math.max(0, requested + mods.bossDamageTaken);
  // Proportional, global: `Leather Coat ×0.8`.
  requested = Math.max(0, Math.round(requested * mods.damageTakenMultiplier));

  if (requested === 0) {
    return {
      requested,
      applied: 0,
      healthBefore,
      healthAfter: healthBefore,
      dead: healthBefore <= 0,
      floorUsed: null,
    };
  }

  const wouldBeLethal = healthBefore - requested <= 0;

  if (wouldBeLethal && mods.healthFloor !== null && mods.healthFloorItemId !== null) {
    const floor = Math.min(mods.healthFloor, run.maxHealth);
    run.health = Math.max(0, floor);
    return {
      requested,
      applied: Math.max(0, healthBefore - run.health),
      healthBefore,
      healthAfter: run.health,
      dead: false,
      floorUsed: { itemId: mods.healthFloorItemId, floor },
    };
  }

  run.health = Math.max(0, healthBefore - requested);
  return {
    requested,
    applied: healthBefore - run.health,
    healthBefore,
    healthAfter: run.health,
    dead: run.health <= 0,
    floorUsed: null,
  };
}

/** Restore health, capped at the current maximum. Returns what was restored. */
export function healPlayer(run: HorrorRun, amount: number): number {
  if (amount <= 0) return 0;
  const before = run.health;
  run.health = Math.min(run.maxHealth, run.health + Math.round(amount));
  return run.health - before;
}

/** True when the run is over: the pool is empty (§1.3). */
export function isHorrorRunOver(run: HorrorRun): boolean {
  return run.health <= 0;
}

export interface MonsterCatchResult {
  /** `Gut of the Bloatlord` converts the catch into an ended day. */
  endDay: boolean;
  damage: number;
  dead: boolean;
  itemId: string | null;
}

/**
 * He caught you.
 *
 * Normally that ends the run. `Gut of the Bloatlord` (`onCatch: endDayAtDamage
 * 4500`) instead ends the **day** at a fixed cost — "takes 4500 instead of losing
 * the run" (§3.8) — so it is a catch handler, not a damage reducer.
 */
export function handleMonsterCatch(run: HorrorRun): MonsterCatchResult {
  const mods = deriveHorrorEngineMods(run);
  if (mods.endDayAtDamage !== null) {
    const result = applyDamageToPlayer(run, mods.endDayAtDamage, "item");
    return {
      endDay: true,
      damage: result.applied,
      dead: result.dead,
      itemId: mods.endDayAtDamageItemId,
    };
  }

  run.health = 0;
  return { endDay: false, damage: run.maxHealth, dead: true, itemId: null };
}

// ---------------------------------------------------------------------------
// Guess resolution (§0.3, §1.3, §4.3)
// ---------------------------------------------------------------------------

export interface HorrorGuessInput {
  /** Either a distance in km… */
  distanceKm?: number;
  /** …or a guess plus the true location, resolved with the shared haversine. */
  guess?: LatLng;
  target?: LatLng;
}

export interface HorrorGuessResult {
  distanceKm: number;
  score: number;
  /** The base ramp, before items. */
  baseThreshold: number;
  /** The gate actually enforced (`Compass` applied). */
  threshold: number;
  /** True when the guess at or below the gate — free of health (§1.3). */
  rejected: boolean;
  /** True when `Rabbit's Foot` bypassed the gate. */
  thresholdIgnored: boolean;
  /** Damage after the difficulty divisor and the day's growth. */
  damage: number;
  /** Damage before growth, i.e. what `damageGrowthAnchor` models. */
  baseDamage: number;
  growth: number;
  /** True when the guess was a perfect 5000 and healed to full (§1.3). */
  fullHeal: boolean;
  healed: number;
  healthBefore: number;
  healthAfter: number;
  dead: boolean;
  jumpscare: JumpscareResult | null;
}

/**
 * Resolve a Chase-day guess end to end.
 *
 * The five Codex rules this encodes:
 *
 * 1. `score = 5000 · 2^(−d/926)`, with the 25 m rule making near-perfect guesses
 *    a literal 5000 rather than 4999 (§0.3).
 * 2. A guess **at or below** the gate is rejected and costs **no health** — the
 *    gate is a shield, so throwing away a bad guess is correct play (§1.3).
 * 3. Rejection still costs a jumpscare (20 steps of lead) unless `Earplugs`,
 *    because a rejection is free of health, not free of time (§4.2).
 * 4. An accepted guess costs `(5000 − score) / divisor`, then compounds by the
 *    day's growth multiplier (§0.5, §1.5).
 * 5. A perfect 5000 **heals to full** instead of dealing damage (§1.3).
 */
export function resolveChaseGuess(
  run: HorrorRun,
  input: HorrorGuessInput,
  consumableThresholdAdjustment = 0,
): HorrorGuessResult {
  const distanceKm = resolveDistanceKm(input);
  const baseThreshold = thresholdForDay(run.day, run.difficulty);
  const threshold = effectiveThresholdFor(run, run.day, consumableThresholdAdjustment);
  const mods = deriveHorrorEngineMods(run);

  // The 25 m rule: "5K = d ≤ 25 m, by rule not by formula" (§0.3).
  const score =
    distanceKm * 1000 <= HORROR_PERFECT_RADIUS_M ? HORROR_MAX_POINTS : computeHorrorScore(distanceKm);

  const healthBefore = run.health;
  let thresholdIgnored = false;
  if (score <= threshold && mods.ignoreThresholdChance > 0) {
    thresholdIgnored = horrorRngFor(run)() < mods.ignoreThresholdChance;
  }

  const rejected = score <= threshold && !thresholdIgnored;

  if (rejected) {
    run.counters.rejectedGuessCount += 1;
    // Rejected guess no longer triggers a jumpscare (20-step penalty removed)
    // Earplugs effect is now redundant but kept for compatibility
    return {
      distanceKm,
      score,
      baseThreshold,
      threshold,
      rejected: true,
      thresholdIgnored: false,
      damage: 0,
      baseDamage: 0,
      growth: 1,
      fullHeal: false,
      healed: 0,
      healthBefore,
      healthAfter: run.health,
      dead: run.health <= 0,
      jumpscare: null,
    };
  }

  if (score >= HORROR_MAX_POINTS) {
    const healed = healPlayer(run, run.maxHealth);
    return {
      distanceKm,
      score,
      baseThreshold,
      threshold,
      rejected: false,
      thresholdIgnored,
      damage: 0,
      baseDamage: 0,
      growth: 1,
      fullHeal: true,
      healed,
      healthBefore,
      healthAfter: run.health,
      dead: false,
      jumpscare: null,
    };
  }

  const baseDamage = computeHorrorDamage(score, run.difficulty);
  const growth = damageGrowthFor(run.day, run.difficulty);
  // Growth compounds off the rounded base (§0.5), never off the raw curve.
  const damage = Math.round(baseDamage * growth);
  const applied = applyDamageToPlayer(run, damage, "guess");

  return {
    distanceKm,
    score,
    baseThreshold,
    threshold,
    rejected: false,
    thresholdIgnored,
    damage: applied.applied,
    baseDamage,
    growth,
    fullHeal: false,
    healed: 0,
    healthBefore,
    healthAfter: run.health,
    dead: applied.dead,
    jumpscare: null,
  };
}

function resolveDistanceKm(input: HorrorGuessInput): number {
  if (typeof input.distanceKm === "number") {
    if (!Number.isFinite(input.distanceKm) || input.distanceKm < 0) {
      throw new Error("guess distanceKm must be a finite, non-negative number");
    }
    return input.distanceKm;
  }
  if (input.guess && input.target) return haversineKm(input.guess, input.target);
  throw new Error("resolveChaseGuess needs either distanceKm or both guess and target");
}

// ---------------------------------------------------------------------------
// Happy Thoughts (§4.1)
// ---------------------------------------------------------------------------

export interface HappyThoughtsResult {
  ok: boolean;
  reason?: string;
  healed: number;
  freezeMs: number;
  metresGained: number;
  distanceAfter: number;
  chargesLeft: number;
}

/**
 * Happy Thoughts does **two** things (§4.1): it freezes him and it heals, and it
 * costs him 10 steps of lead. It is a routine resource, not only a panic button —
 * eight items restore or extend it.
 *
 * Charges are conserved: using it spends one, and a charge only comes back from
 * an item (`Hammock` daily, `Cocoa`, `Hopium`, `Blankie` on a boss win). Day start
 * therefore re-arms from the pool rather than granting a fresh charge.
 */
export function useHappyThoughts(run: HorrorRun, now: number = Date.now()): HappyThoughtsResult {
  if (!run.happyThoughtsReady) {
    return {
      ok: false,
      reason: "not_ready",
      healed: 0,
      freezeMs: 0,
      metresGained: 0,
      distanceAfter: run.monster.distance,
      chargesLeft: run.happyThoughtsCharges,
    };
  }

  const config = HORROR_HAPPY_THOUGHTS[run.difficulty];
  run.monster.graceUntil = now + config.freezeMs;

  const healed = healPlayer(run, config.heal);
  const metresGained = HORROR_HAPPY_THOUGHTS_COSTS_STEPS * monsterStrideM(run);
  run.monster.distance += metresGained;

  run.happyThoughtsCharges = Math.max(0, run.happyThoughtsCharges - 1);
  run.happyThoughtsReady = run.happyThoughtsCharges > 0;
  run.counters.happyThoughtsUsed += 1;

  return {
    ok: true,
    healed,
    freezeMs: config.freezeMs,
    metresGained,
    distanceAfter: run.monster.distance,
    chargesLeft: run.happyThoughtsCharges,
  };
}

// ---------------------------------------------------------------------------
// Re-exports the callers need with the engine, one import instead of three
// ---------------------------------------------------------------------------

export { HORROR_DIFFICULTIES };