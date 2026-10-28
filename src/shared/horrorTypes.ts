// HorrorGuessr — shared type surface.
//
// Ported from `plans/horrorguessr-master-plan.md` (revision 4). This module is
// the single source of truth for the horror roguelike mode's data shapes and is
// imported by BOTH the server engine and the React client.
//
// Fidelity: every type below is fixed by §3.1 (taxonomy), §3.2 (op vocabulary),
// §3.4 (polarity model) and §1.6 (run state) of the master plan. Nothing here
// touches the existing `Room` / `Player` / `Phase` model — horror mode is a
// separate, single-player run store (§1.6, §7.2).

import type { LatLng, LocalizedText, Location } from "./types";

// ---------------------------------------------------------------------------
// Difficulty
// ---------------------------------------------------------------------------

export type HorrorDifficulty = "Normal" | "Hard" | "Nightmare";

// ---------------------------------------------------------------------------
// Day state machine (§1.2)
// ---------------------------------------------------------------------------

export type HorrorDayType = "Chase" | "Boss" | "FinalBoss";

/**
 * "darkPano" is new in revision 4: Beer Goggles equips a bypass for a dimmed
 * panorama, so the modifier must exist as its own state rather than a
 * lights-out variant (§4.4).
 */
export type HorrorDayModifier = "none" | "lightsOut" | "shadowRealm" | "darkPano";

// ---------------------------------------------------------------------------
// Bosses (§5.1, §5.3, §5.4)
// ---------------------------------------------------------------------------

export type HorrorBossRank =
  | "Hangout"
  | "Prospect"
  | "Commander"
  | "Senior Associate Manager of the Primordial Darkness";

/**
 * The mechanic a boss brings to the duel (§5.2). The roster is a *pool of
 * mechanics keyed by rank* (C16), so the mechanic — not the boss's name — is
 * what the duel resolver and the client minigame dispatch on.
 *
 * - `lifesteal` / `shadowVampirism` — the boss heals itself by the damage it deals.
 * - `hexes` / `stackedHexes` — the Witch's view-transform curses.
 * - `laserLock` / `laserOverdrive` — Meep Moorp's orbital-laser minigame.
 * - `screamPenalty` / `echoScream` — the Banshee's input-freeze window.
 * - `timeDrain` / `decayedTime` — the Mummy's health/damage decay.
 * - `rngChaos` / `archClown` — the Clown's cream-pie wipe and rule inversion.
 * - `shortAttack` — the Black Pano's near-one-shot damage.
 * - `chosenRewards` — the day-30 finale, whose rewards are picked, not rolled.
 */
export type HorrorBossMechanic =
  | "lifesteal"
  | "hexes"
  | "laserLock"
  | "screamPenalty"
  | "timeDrain"
  | "rngChaos"
  | "chosenRewards"
  | "shortAttack"
  | "shadowVampirism"
  | "stackedHexes"
  | "laserOverdrive"
  | "echoScream"
  | "decayedTime"
  | "archClown";

export interface BossDebuff {
  /** e.g. "mirrorPano" | "shrinkMap" | "spellLock" | "upsideDown" | "inputFreeze" */
  kind: string;
  /** ms timestamp when the debuff expires, or null for the whole round. */
  until: number | null;
  /** Optional magnitude (e.g. map shrink factor). */
  value?: number;
}

export interface HorrorBossState {
  id: string;
  name: LocalizedText;
  /** The duel mechanic this boss brings (§5.2). */
  mechanic: HorrorBossMechanic;
  health: number;
  maxHealth: number;
  /** [min, max] response window in ms, e.g. [30000, 50000]. */
  responseMs: [number, number];
  /** Timer after the first lock-in, ms (15000). */
  duelTimerMs: number;
  phase: number;
  debuffs: BossDebuff[];
  playerLockedAt: number | null;
  bossLockedAt: number | null;
  /** Server-only until reveal. */
  bossAnswer: LatLng | null;
}

export type HorrorFinalBossReward = "fullHeal" | "mythicEquipment" | "fiveRareFoods";

export interface BossRewardRoll {
  equipment: { rarity: Exclude<HorrorRarity, "Common"> };
  foods: { rarity: Exclude<HorrorRarity, "Common"> }[];
}

/** One row of the §5.4 odds matrix. Percentages sum to 100 ± 0.1. */
export interface HorrorRewardOdds {
  uncommon: number;
  rare: number;
  mythic: number;
}

export interface HorrorRewardTable {
  /** Keyed by rank; each entry is the odds for a given day. */
  byRank: Record<HorrorBossRank, HorrorRewardOdds>;
}

/**
 * A boss definition from the §5.2 roster. Pure data — the engine reads `id`,
 * `name`, `mechanic` and `hp`; the boss layer reads `mechanic`, `score` and the
 * damage flags. `rank` is the rank the boss is *drawn at* when the day does not
 * already fix one (the Clown escalates with the day, so its `rank` is null).
 */
export interface HorrorBossDefinition {
  id: string;
  name: LocalizedText;
  mechanic: HorrorBossMechanic;
  /** The rank this boss is drawn at, or null when rank is day-derived. */
  rank: HorrorBossRank | null;
  /** Days this boss can be drawn on. Empty means "any rolled boss day". */
  drawnOn: number[];
  /** HP by difficulty, or null to use the rank-scaled family (§5.3). */
  hp: Record<HorrorDifficulty, number> | null;
  /** [min, max] response window in seconds. */
  responseS: [number, number];
  /** The boss's per-round score distribution (§5.3). */
  score: {
    typical: [number, number];
    blunderChance: number;
    blunder: [number, number];
    average: number;
  };
  /** Multiplier on the damage the player takes (Black Pano). */
  damageMultiplier?: number;
  /** The boss heals itself by the damage it deals (vampirism). */
  lifesteal?: boolean;
  /** True for the day-30 finale, whose rewards are chosen rather than rolled. */
  final?: boolean;
}

/**
 * The live duel state for a boss day. Kept in a `WeakMap` keyed by the run
 * object (like the engine's RNG and the item ledger), so the §1.6 run contract
 * does not grow a duel record and a rebuilt run starts a clean duel.
 */
export interface HorrorDuelState {
  bossId: string;
  day: number;
  /** 1-based duel round. */
  round: number;
  playerScore: number | null;
  bossScore: number | null;
  playerLockedAt: number | null;
  bossLockedAt: number | null;
  /** The boss's hidden answer, server-only until reveal. */
  bossAnswer: LatLng | null;
  /** Active hexes (Witch / Void Witch). */
  hexes: BossDebuff[];
  /** Laser lock coordinates (Meep Moorp), normalised 0..1. */
  laser: { x: number; y: number } | null;
  /** Banshee scream window end (ms timestamp). */
  screamUntil: number;
  /** Rounds the player won / lost. */
  roundsWon: number;
  roundsLost: number;
  /** True once the reward has been granted (idempotency, §5.4). */
  rewardGranted: boolean;
  /** The final-boss reward the player chose, or null. */
  finalReward: HorrorFinalBossReward | null;
}

/** The outcome of one duel round. */
export interface HorrorDuelRoundResult {
  playerScore: number;
  bossScore: number;
  delta: number;
  playerWon: boolean;
  damageToBoss: number;
  damageToPlayer: number;
  /** Health the boss restored to itself (vampirism). */
  lifesteal: number;
  bossDefeated: boolean;
  playerDefeated: boolean;
  /** The boss's revealed answer, once the round resolves. */
  bossAnswer: LatLng | null;
}

// ---------------------------------------------------------------------------
// Items (§3.1, §3.2, §3.4)
// ---------------------------------------------------------------------------

export type HorrorRarity = "Common" | "Uncommon" | "Rare" | "Mythic";
export type HorrorKind = "Equipment" | "Food" | "Consumable";

/**
 * The reference's six fixed capitalised prefixes, mirrored one-for-one (§3.1).
 * `monsterWithinN` is a *condition* on a zone, not a trigger of its own, so it
 * is modelled via `HorrorItem.condition` rather than here.
 */
export type HorrorTrigger =
  | "equipped" // НАДЕТО
  | "onEat" // ПРИ СЪЕДЕНИИ
  | "eachDay" // КАЖДЫЙ ДЕНЬ
  | "use" // unconditional effect of eating / triggering
  | "onGuess" // ПРИ ДОГАДКЕ
  | "onRejectedGuess" // ПРИ ОТКЛОНЕННОЙ ДОГАДКЕ
  | "onCast" // ПРИ ИСПОЛЬЗОВАНИИ / ПРИМЕНЕНИИ ЗАКЛИНАНИЯ
  | "onScry" // ПРИ ПРЕДВИДЕНИИ
  | "onStep" // ПРИ ДВИЖЕНИИ / ЗА КАЖДЫЕ N ШАГОВ
  | "onFall" // ПРИ ПАДЕНИИ
  | "onCatch" // ПРИ ПОИМКЕ МОНСТРОМ
  | "onLethal" // ПРИ СМЕРТЕЛЬНОМ УРОНЕ
  | "onDamage" // ПРИ ПОЛУЧЕНИИ УРОНА
  | "onBossHit" // ПРИ УДАРЕ ПО БОССУ
  | "onBossWin" // ПРИ ПОБЕДЕ НАД БОССОМ / В РАУНДЕ С БОССОМ
  | "onBossLoss" // ПРИ ПРОИГРАННОМ РАУНДЕ С БОССОМ
  | "onPuzzleSolve" // ПРИ РЕШЕНИИ ГОЛОВОЛОМКИ
  | "onDestroyOther" // ПРИ УНИЧТОЖЕНИИ ДРУГОГО ПРЕДМЕТА
  | "onGainMaxHealth" // ПРИ ПОЛУЧЕНИИ МАКС. ЗДОРОВЬЯ
  | "onHappyThoughts" // ПРИ СЧАСТЛИВЫХ МЫСЛЯХ
  | "afterDays"; // ЧЕРЕЗ N ДНЯ

/**
 * The complete op vocabulary required by the reference (§3.2). Every op is used
 * by at least one item; nothing is speculative. Ops revision 3 carried that the
 * reference does not support (`monsterPace`, `reduceTraces`, `revealMap`,
 * `revealPuzzle`, `dodgeDamage`, `clearBossDebuff`, `feedPet`, `stumble`,
 * `endureAt`, `preventKnockout`, `spellSlot`) are retired and absent here.
 */
export type HorrorOp =
  | "monsterDistance"
  | "monsterDistanceTo"
  | "distancePerStep"
  | "doubleMoveChance"
  | "fallChance"
  | "maxHealth"
  | "maxHealthMultiplier"
  | "heal"
  | "healPerStep"
  | "healMultiplier"
  | "healthFloor"
  | "cancelBossHitTo"
  | "endDayAtDamage"
  | "bossDamage"
  | "bossDamageMultiplier"
  | "bossDamageTaken"
  | "damageTakenMultiplier"
  | "bossDamageFromDamageDealt"
  | "reflectBossHit"
  | "bossRewardGoldPerRank"
  | "guessThreshold"
  | "ignoreThresholdChance"
  | "gold"
  | "sellPrice"
  | "sellPricePerDay"
  | "foodPrice"
  | "freeReroll"
  | "grantSpell"
  | "grantCharges"
  | "happyThoughts"
  | "freeHappyThoughts"
  | "skipDay"
  | "skipBoss"
  | "puzzleStep"
  | "puzzleShape"
  | "puzzleUnlockUntilDayEnd"
  | "destroySelf"
  | "destroyRandom"
  | "spawnRarity"
  | "spawnEquipment"
  | "restoreDestroyed"
  | "bypassModifier"
  | "ignoreLowHealthSlowdown"
  | "noJumpscareOnReject"
  | "rejectBlockReduction"
  | "omenChanceOnHappyThoughts"
  | "extraSlot"
  | "waitDays"
  | "omen"
  | "scry"
  | "insideLocationBonus"
  | "doubleCatchCost"
  | "oneOf"
  | "never";

/**
 * Polarity is explicit and never inferred (§3.4, C20). The reference's own
 * signs are already correct and must not be inverted.
 */
export type HorrorPolarity = "add" | "multiply" | "set" | "prevent";

/** The three castable charge families plus the two starting stocks (§3.10). */
export type HorrorChargeFamily = "spell" | "omen" | "scry" | "arrow" | "echo";

/** A single normalized effect. */
export interface HorrorEffect {
  op: HorrorOp;
  /** Numeric magnitude. `0` is meaningful (e.g. `Scroll`'s `grantSpell +0`). */
  value: number;
  polarity: HorrorPolarity;
  /** For `oneOf`: the seeded branches, each a list of effects. */
  branches?: HorrorEffect[][];
  /** For `spawnRarity` / `spawnEquipment` / `bypassModifier` / `grantCharges`. */
  rarity?: HorrorRarity;
  kind?: HorrorKind;
  itemId?: string;
  modifier?: HorrorDayModifier;
  family?: HorrorChargeFamily;
  /** For `puzzleShape`: "map2x2" | "twoStep" | "picklock" | "zipper". */
  shape?: string;
  /** For `waitDays` / `afterDays`: the delay in days. */
  days?: number;
  /** For `monsterDistanceTo` / `healthFloor` / `cancelBossHitTo` / `endDayAtDamage`. */
  target?: number;
  /** For `grantSpell`: the boss that gates the grant (e.g. "witch", "meepMoorp"). */
  bossId?: string;
  /** For `grantSpell`: the number of steps between grants (Pedometer). */
  everySteps?: number;
  /** For `grantSpell`: the guess-time window in ms (Stopwatch-style gates). */
  withinMs?: number;
  /** For `grantSpell`: the minimum score gate (Dartboard, Binoculars, Medal). */
  minScore?: number;
  /** For `grantSpell`: the minimum guess time in ms (Stopwatch). */
  maxGuessMs?: number;
  /** For `grantSpell`: the chance the effect fires (0..1). */
  chance?: number;
  /** For `grantSpell`: the health fraction gate (Horns). */
  belowFraction?: number;
  /** For `grantSpell`: the monster-distance gate (Sweatband, Air Horn, Razor). */
  monsterWithinM?: number;
  /** For `grantSpell`: the gold-held scaling (Billionaire Suit). */
  perGold?: number;
  /** For `grantSpell`: the health-step scaling (Toe Tag). */
  perHealth?: number;
  /** For `grantSpell`: the stack increment (Stinky Pants, Staff, ...). */
  perStack?: number;
  /** For `grantSpell`: the sell-value override (Gold Tooth, GPU). */
  sellOverride?: number;
  /** For `grantSpell`: the food-price delta (Coupon Book). */
  foodPriceDelta?: number;
  /** For `grantSpell`: the number of random items destroyed (Anglerfish). */
  count?: number;
  /** For `grantSpell`: the number of charges granted (Jelly Eyeball, ...). */
  charges?: number;
  /** For `grantSpell`: the number of spells granted (Scroll, Gummi Bear, ...). */
  spells?: number;
  /** For `grantSpell`: the number of days skipped (Time Machine, Saucer). */
  skipDays?: number;
  /** For `grantSpell`: the number of equipment slots granted (Belt Buster). */
  slots?: number;
  /** For `grantSpell`: the number of puzzle steps reduced (Puzzle Box, ...). */
  puzzleSteps?: number;
  /** For `grantSpell`: the duration delta in seconds (Stress Ball, Warm Milk). */
  durationS?: number;
  /** For `grantSpell`: the heal delta (Stress Ball, Hopium). */
  healDelta?: number;
  /** For `grantSpell`: the reflect fraction (Hand Mirror). */
  reflectFraction?: number;
  /** For `grantSpell`: the ignore-threshold chance (Rabbit's Foot). */
  ignoreChance?: number;
  /** For `grantSpell`: the reject-block reduction fraction (Earplugs). */
  reduction?: number;
  /** For `grantSpell`: the double-move chance (Tricycle). */
  doubleMoveChance?: number;
  /** For `grantSpell`: the fall-chance multiplier (Lucky Horseshoe, ...). */
  fallMultiplier?: number;
  /** For `grantSpell`: the max-health multiplier (Watermelon). */
  maxHealthMultiplier?: number;
  /** For `grantSpell`: the heal multiplier (Watermelon). */
  healMultiplier?: number;
  /** For `grantSpell`: the boss-damage multiplier (Scythe). */
  bossDamageMultiplier?: number;
  /** For `grantSpell`: the damage-taken multiplier (Leather Coat). */
  damageTakenMultiplier?: number;
  /** For `grantSpell`: the boss-damage-taken delta (Trash Lid). */
  bossDamageTaken?: number;
  /** For `bossDamageFromDamageDealt`: convert dealt damage into max health (Shiina's Oni Mask). */
  bossDamageFromDamageDealt?: number;
  /** For `grantSpell`: the boss-damage delta (Sausage, Horns, ...). */
  bossDamage?: number;
  /** For `grantSpell`: the max-health delta (Potato, Turnip, ...). */
  maxHealth?: number;
  /** For `grantSpell`: the heal delta (Apple Pie, Cupcake, ...). */
  heal?: number;
  /** For `grantSpell`: the gold delta (Beggar's Hat, Lobster, ...). */
  gold?: number;
  /** For `grantSpell`: the monster-distance delta (Garlic Pendant, ...). */
  monsterDistance?: number;
  /** For `grantSpell`: the distance-per-step delta (Skateboard, ...). */
  distancePerStep?: number;
  /** For `grantSpell`: the guess-threshold delta (Compass, Atlas, ...). */
  guessThreshold?: number;
  /** For `grantSpell`: the health floor (Helmet, Jumper Cables). */
  healthFloor?: number;
  /** For `grantSpell`: the boss-hit cancel target (Defibrillator). */
  cancelBossHitTo?: number;
  /** For `grantSpell`: the end-day damage (Gut of the Bloatlord). */
  endDayAtDamage?: number;
  /** For `grantSpell`: the boss-reward gold per rank (Wanted Poster). */
  bossRewardGoldPerRank?: number;
  /** For `grantSpell`: the extra equipment slots (Belt Buster). */
  extraSlot?: number;
  /** For `grantSpell`: the free-reroll count (Loyalty Card). */
  freeReroll?: number;
  /** For `grantSpell`: the double-catch-cost flag (Hush Money). */
  doubleCatchCost?: boolean;
  /** For `grantSpell`: the no-jumpscare flag (Earplugs). */
  noJumpscareOnReject?: boolean;
  /** For `grantSpell`: the low-health-slowdown immunity flag (Saucer, ...). */
  ignoreLowHealthSlowdown?: boolean;
  /** For `grantSpell`: the inside-location flag (Holy Water, Third Eye). */
  insideLocation?: boolean;
  /** For `grantSpell`: the "restore Happy Thoughts" flag (Cocoa, Hammock, ...). */
  restoreHappyThoughts?: boolean;
  /** For `grantSpell`: the "free Happy Thoughts" flag (Pacifier). */
  freeHappyThoughts?: boolean;
  /** For `grantSpell`: the "keep charge" chance (Moonstone). */
  keepChargeChance?: number;
  /** For `grantSpell`: the "destroy chance" (Gráskinna). */
  destroyChance?: number;
  /** For `grantSpell`: the "destroy chance per stack" (Gráskinna). */
  destroyChancePerStack?: number;
  /** For `grantSpell`: the "sell value per day" (Gold Tooth, GPU). */
  sellPricePerDay?: number;
  /** For `grantSpell`: the "sell value" (Gold Tooth, GPU). */
  sellPrice?: number;
  /** For `grantSpell`: the "food price" delta (Coupon Book). */
  foodPrice?: number;
  /** For `grantSpell`: the "puzzle unlock until day end" flag (Lockpick, ...). */
  puzzleUnlockUntilDayEnd?: boolean;
  /** For `grantSpell`: the "skip boss" flag (Hall Pass). */
  skipBoss?: boolean;
  /** For `grantSpell`: the "restore destroyed" flag (Duct Cake). */
  restoreDestroyed?: boolean;
  /** For `grantSpell`: the "spawn equipment" id (Space Rock → Saucer). */
  spawnEquipment?: string;
  /** For `grantSpell`: the "spawn rarity" (Dragon Egg, Anglerfish, ...). */
  spawnRarity?: HorrorRarity;
  /** For `grantSpell`: the "destroy random" count (Anglerfish). */
  destroyRandom?: number;
  /** For `grantSpell`: the "omen chance on Happy Thoughts" (Teddy Bear). */
  omenChanceOnHappyThoughts?: number;
  /** For `grantSpell`: the "never" dial (Scroll +0). */
  never?: boolean;
}

/** A conditional prefix, e.g. МОНСТР В ПРЕДЕЛАХ 3 (§3.1). */
export interface HorrorItemCondition {
  kind:
    | "monsterWithinM"
    | "healthBelowFraction"
    | "monsterWithinGoldGuess"
    | "guessAtLeast"
    | "insideLocation";
  value: number;
}

/** "на этом предмете": the effect scales with the instance's stack counter. */
export interface HorrorItemStacks {
  key: string;
  perStack: HorrorEffect[];
  max?: number;
}

export interface HorrorItem {
  id: string;
  /** Canonical English name from items.txt; LocalizedText in i18n. */
  name: string;
  /** The reference's own spelling, verbatim. */
  nameRu: string;
  rarity: HorrorRarity;
  kind: HorrorKind;
  icon: string;
  trigger: HorrorTrigger[];
  effects: HorrorEffect[];
  /** "на этом предмете": the effect scales with the instance's stack counter. */
  stacks?: HorrorItemStacks;
  /** Conditional prefix, e.g. МОНСТР В ПРЕДЕЛАХ 3. */
  condition?: HorrorItemCondition;
  /** "Один раз в день" / spell-cast counters. */
  oncePerDay?: boolean;
  destroysSelf?: boolean;
  sellOverride?: number;
  minDay?: number;
  bossReward?: boolean;
  /** Always "s6": plans/hars/items.txt is the sole authoritative source. */
  source: "s6";
}

// ---------------------------------------------------------------------------
// Spells (§3.10)
// ---------------------------------------------------------------------------

export type SpellResult =
  | { kind: "circle"; center: LatLng; radiusMeters: number }
  | { kind: "band"; min: number; max: number; axis: "lat" | "lng" }
  | { kind: "bearing"; degrees: number; tolerance: number }
  | { kind: "reveal"; panoId: string }
  | { kind: "coins"; options: [LatLng, LatLng] } // 50/50
  | { kind: "hit" }
  | { kind: "miss" };

export interface HorrorSpell {
  id: string;
  name: LocalizedText;
  family: HorrorChargeFamily;
  charges: number;
  resolve(run: HorrorRun, target: LatLng): SpellResult;
}

// ---------------------------------------------------------------------------
// Monster (§1.4)
// ---------------------------------------------------------------------------

export interface MonsterState {
  /** 30 m at day start; 0 = next step catches. */
  distance: number;
  /** Current step interval, intra-day. */
  paceMs: number;
  /**
   * Pursuit ticks completed today. The intra-day pace decay is a grouped
   * function of the tick index (§0.5 `paceAtStep(startS, k, d)`: every
   * `intraEverySteps` ticks the pace drops by `intraDayS`), so the index has to
   * be part of the monster state — it cannot be recovered from `paceMs`, which
   * is a step function of `k` and therefore not invertible.
   */
  ticksToday: number;
  stridesSinceGrowth: number;
  /** +1 per completed growth window. */
  strideBonusM: number;
  /** Happy Thoughts freeze expiry (ms timestamp). */
  graceUntil: number;
}

/** Live modifiers derived from the inventory (§3.3). */
export interface MonsterMods {
  /** Base is +1: movement pushes the monster AWAY (C13, S10 p.1). */
  distancePerStep: number;
  /** 2% per step (S10 p.21). */
  fallChance: number;
  /** 50 (S10 p.21). */
  fallDamage: number;
  /** Seeded RNG for fall rolls. */
  rng: () => number;
}

// ---------------------------------------------------------------------------
// Run state (§1.6)
// ---------------------------------------------------------------------------

export interface HorrorDayCounters {
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
}

export interface HorrorRun {
  runId: string;
  seed: number;
  difficulty: HorrorDifficulty;
  day: number;
  /**
   * The day index whose start has already been applied to this run.
   *
   * `beginHorrorDay` is a *reset* (monster back to 30 m, counters cleared), so it
   * must run exactly once per day. The act/run routes call it on every request to
   * guarantee a day exists; without this marker each call would snap the monster
   * back to 30 m and erase all intra-day progress. `null` means "no day started
   * yet" and is only true for a freshly constructed record.
   */
  dayStarted: number | null;
  health: number;
  /** Always 6000 (S10 p.21). */
  maxHealth: number;
  gold: number;
  freeRerolls: number;
  /** C2: 1 per S2. */
  rerollCost: number;
  /** Slots; +1 per Belt Buster eaten. */
  equipment: (string | null)[];
  food: string[];
  /**
   * Per-instance mutable counter for "на этом предмете" effects (§4.6).
   * Keyed by equipment slot.
   */
  itemStacks: Record<string, number>;
  spells: Record<string, number>;
  /** No item grants a spell slot (S6); kept for spells earned elsewhere. */
  spellSlots: number;
  /** Starts at 2 (S10 p.21). */
  arrows: number;
  /** Starts at 1 (S10 p.21). */
  echoes: number;
  happyThoughtsReady: boolean;
  happyThoughtsCharges: number;
  /** 9 observed. */
  puzzlePieces: number;
  boss: HorrorBossState | null;
  /**
   * The day's true target, picked server-side from the same map pool solo mode
   * uses. Its coordinates are never included in the API projection — only the
   * panorama id the client needs to render.
   */
  dayTarget?: Location;
  /** Day index the target belongs to; a target is valid only for that day. */
  dayTargetDay?: number;
  monster: MonsterState;
  dayModifier: HorrorDayModifier;
  /** Damage BEFORE growth at the current day. */
  damageGrowthAnchor: number;
  counters: HorrorDayCounters;
  /** The last destroyed item, for `Duct Cake` (§3.3). */
  destroyedStack: string[];
}

// ---------------------------------------------------------------------------
// Day spec (§1.2)
// ---------------------------------------------------------------------------

export interface HorrorDay {
  /** 1..∞ */
  index: number;
  type: HorrorDayType;
  modifier: HorrorDayModifier;
  bossId: string | null;
  /** Derived from index, S10 p.19. */
  bossRank: HorrorBossRank | null;
  /** Derived, S10 p.5 / p.21. */
  threshold: number;
  /** Derived, S10 p.5, country-scaled. */
  thresholdDistanceM: number;
  /** Derived, S10 p.1. */
  monsterStartPaceMs: number;
  /** Derived, S10 p.2. */
  strideGrowthSteps: number;
  /** Derived, S10 p.4. */
  damageGrowth: number;
  rewardTable: HorrorRewardTable;
}

// ---------------------------------------------------------------------------
// Merchant (§2.4)
// ---------------------------------------------------------------------------

export interface MerchantMods {
  foodPriceDelta: number;
  freeRerollsOnFullBuy: number;
  bossWinGoldPerRank: number;
}

export interface MerchantOffer {
  itemId: string;
  rarity: HorrorRarity;
  price: number;
}

export interface MerchantState {
  day: number;
  offers: MerchantOffer[];
  boughtCount: number;
  rerolledCount: number;
}

// ---------------------------------------------------------------------------
// API (§7.3)
// ---------------------------------------------------------------------------

export type HorrorAction =
  | { kind: "step"; panoId: string; heading: number; pitch: number }
  | { kind: "guess"; lat: number; lng: number }
  | { kind: "setTarget"; lat: number; lng: number }
  | { kind: "buy"; offerIndex: number }
  | { kind: "reroll" }
  | { kind: "sell"; itemId: string }
  | { kind: "eat"; itemId: string }
  | { kind: "cast"; spellId: string; target: LatLng }
  | { kind: "happyThoughts" }
  | { kind: "wipe"; amount: number }
  | { kind: "laserLock"; x: number; y: number }
  | { kind: "bossGuess"; lat: number; lng: number }
  | { kind: "finalBossReward"; choice: HorrorFinalBossReward }
  | { kind: "hexClear" }
  | { kind: "screamPenalty" }
  | { kind: "openMerchant" }
  | { kind: "continue" }
  | { kind: "tick" };

export interface HorrorActRequest {
  runId: string;
  /** Monotonic; rejects replays. */
  seq: number;
  action: HorrorAction;
}

export interface ActionResult {
  ok: boolean;
  reason?: string;
}
