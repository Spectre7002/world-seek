// HorrorGuessr — the item catalogue and every constant it depends on.
//
// Ported from `plans/horrorguessr-master-plan.md` (revision 4). The catalogue is
// a **verbatim transcription** of the game's own Items reference
// (`plans/hars/items.txt`, S6), which is authoritative for every item question
// (§0.1). Every row carries an explicit `op`, `polarity` and `source: "s6"`.
//
// Counts (§3.9): Common 35, Uncommon 43, Rare 33, Mythic 20 = 131.
// The 61 phantom rows of revision 3 are deleted (§3.11); 26 aliases are kept for
// migration only.

import type {
  HorrorDifficulty,
  HorrorItem,
  HorrorRarity,
} from "./horrorTypes";

// ===========================================================================
// Constants (Appendix B)
// ===========================================================================

// ── [CODEX]: rendered in the in-game Codex (S10) ──
export const HORROR_MAX_POINTS = 5000;
export const HORROR_HALF_LIFE_KM = 926;
export const HORROR_PERFECT_RADIUS_M = 25;
export const HORROR_HEAL_ON_PERFECT = "full"; // a 5000 heals you to full

// The divisor is not universal: Nightmare divides by 2. (S10, pages 4 and 21)
export const HORROR_DAMAGE_DIVISOR: Record<HorrorDifficulty, number> = {
  Normal: 3,
  Hard: 3,
  Nightmare: 2,
};

// Compounding damage growth. Day 36 is the first grown day on Normal and Hard.
export const HORROR_HIT_GROWTH: Record<HorrorDifficulty, { fromDay: number; factor: number }> = {
  Normal: { fromDay: 36, factor: 1.25 },
  Hard: { fromDay: 36, factor: 1.25 },
  Nightmare: { fromDay: 21, factor: 1.15 },
};

// threshold(day) = clamp(start + perDay x (day - 1), 0, cap). (S10, pages 5 and 21)
export const HORROR_THRESHOLD: Record<
  HorrorDifficulty,
  { start: number; perDay: number; cap: number }
> = {
  Normal: { start: 1500, perDay: 20, cap: 4500 },
  Hard: { start: 2000, perDay: 20, cap: 4500 },
  Nightmare: { start: 3900, perDay: 15, cap: 4500 },
};
export const HORROR_BIG_COUNTRIES = ["us", "ca", "br", "ru", "au"]; // radius x2

export const HORROR_MAX_HEALTH = 6000; // identical on all three difficulties

// ── [CODEX]: the monster (S10, pages 1-3) ──
export const HORROR_START_DISTANCE_M = 30;
export const HORROR_STEP_PUSH_BACK_M = 1; // every player move pushes him back
export const HORROR_STRIDE_M = 1; // every pursuit tick closes 1 m
export const HORROR_CATCH_STEPS = 31; // 30 steps to reach 0, one more catches
export const HORROR_STEP_TIME_FLOOR_S = 0.3; // past this his strides grow instead
export const HORROR_DAY_FLOOR_S = 0.85; // day-start pace floor

export const HORROR_PACE: Record<
  HorrorDifficulty,
  { day1S: number; perDayS: number; floorFromDay: number; intraDayS: number; intraEverySteps: number }
> = {
  Normal: { day1S: 2.5, perDayS: 0.09, floorFromDay: 19, intraDayS: 0.1, intraEverySteps: 5 },
  Hard: { day1S: 2.4, perDayS: 0.09, floorFromDay: 18, intraDayS: 0.1, intraEverySteps: 5 },
  Nightmare: { day1S: 2.0, perDayS: 0.06, floorFromDay: 20, intraDayS: 0.2, intraEverySteps: 5 },
};
// 0 = the documented convention, pace counts from day 1 and holds.
// 1 = applies the decrement from day 1, which reproduces S1's 2230 ms on Normal day 3.
export const HORROR_PACE_DAY_OFFSET = 0;

// +1 m to every step, once his step time is maxed. Steps needed between grants.
export const HORROR_STRIDE_GROWTH_STEPS: {
  fromDay: number;
  Normal: number;
  Hard: number;
  Nightmare: number;
}[] = [
  { fromDay: 1, Normal: 30, Hard: 25, Nightmare: 20 },
  { fromDay: 31, Normal: 26, Hard: 21, Nightmare: 16 },
  { fromDay: 36, Normal: 22, Hard: 17, Nightmare: 12 },
  { fromDay: 41, Normal: 18, Hard: 13, Nightmare: 8 },
  { fromDay: 46, Normal: 14, Hard: 9, Nightmare: 4 },
  { fromDay: 51, Normal: 10, Hard: 5, Nightmare: 3 },
  { fromDay: 56, Normal: 6, Hard: 3, Nightmare: 3 },
  { fromDay: 61, Normal: 3, Hard: 3, Nightmare: 3 },
];
export const HORROR_LATE_STRIDE_FROM_DAY = 36; // +1 m per 40 m of gap, per step
export const HORROR_LATE_STRIDE_GAP_M = 40;

// Happy Thoughts BOTH freezes and heals, and costs the monster 10 steps. (S10 p.1, p.21)
export const HORROR_HAPPY_THOUGHTS: Record<
  HorrorDifficulty,
  { freezeMs: number; heal: number; costsSteps: number }
> = {
  Normal: { freezeMs: 10000, heal: 600, costsSteps: 10 },
  Hard: { freezeMs: 10000, heal: 400, costsSteps: 10 },
  Nightmare: { freezeMs: 8000, heal: 300, costsSteps: 10 },
};
export const HORROR_HAPPY_THOUGHTS_COSTS_STEPS = 10;
export const HORROR_JUMPSCARE_COSTS_STEPS = 20; // S10 p.1
export const HORROR_FALLS = { chancePerStep: 0.02, damage: 50 };

// ── [CODEX]: bosses (S10, pages 18-21) ──
export const HORROR_BOSS_DAYS = [5, 10, 15, 20, 25]; // day 30 belongs to the final boss
export const HORROR_FINAL_BOSS_DAY = 30;
export const HORROR_BOSS_RANKS = [
  "Hangout",
  "Prospect",
  "Commander",
  "Senior Associate Manager of the Primordial Darkness",
] as const;
export const HORROR_BOSS_SCORE = {
  typical: [1300, 2300],
  blunderChance: 0.1,
  blunder: [0, 1000],
  average: 1670,
};
export const HORROR_BOSS_RESPONSE_S = [30, 50];
export const HORROR_REWARD_GROWTH_AFTER_30 = { mythic: 0.004, rare: 0.015 };
export const HORROR_FINAL_BOSS_REWARDS = ["fullHeal", "mythicEquipment", "fiveRareFoods"] as const;

// ── Tier 2: observed in runtime ──
export const HORROR_OFFERS_PER_VISIT = 4;
export const HORROR_INVENTORY_SLOTS = 4;
export const HORROR_PAID_REROLL_COST = 1; // S2 wins over S5 (C2)
export const HORROR_COMMON_BUY = 2; // S2 wins over S5 (C1)
export const HORROR_PUZZLE_PIECES = 9;
export const HORROR_MYTHIC_ECONOMY = { buy: 16, sell: 8, food: 8, minDay: 13 };

// ── [CODEX S6]: the Items reference, plans/hars/items.txt ──
export const HORROR_ITEM_COUNTS: Record<HorrorRarity, number> = {
  Common: 35,
  Uncommon: 43,
  Rare: 33,
  Mythic: 20,
};
export const HORROR_ITEM_COUNT_TOTAL = 131; // C17: supersedes 129 and 121

// Threshold modifiers are in the 75-400 band, not the 4-40 band rev 2 assumed.
export const HORROR_THRESHOLD_ITEM_MOD: Record<string, number> = {
  compass: -250,
  carrotCake: -75,
  spongeCake: -125,
  candyCorn: -250,
  atlas: -400,
};

// Fall chance composes multiplicatively across equipped items.
export const HORROR_FALL_CHANCE_MULT: Record<string, number> = {
  luckyHorseshoe: 0.2,
  skateboard: 0.5,
  bananaPeel: 2,
  beerGoggles: 2,
  rollerSkates: 4,
};

// Low-health movement slowdown. Attested by two items that negate it (Saucer,
// Smelling Salts); the magnitude itself is [DESIGN]. Applies to the PLAYER's step
// cadence only — never to monster pace.
export const HORROR_LOW_HEALTH_SLOWDOWN = {
  belowFraction: 0.25, // at or under 25% health
  stepTimeMultiplier: 1.5, // player movement 50% slower
};
export const HORROR_SLOWDOWN_IMMUNE_ITEMS = ["saucer", "smellingSalts"] as const;

// A second day modifier the old catalogue did not know about: a permanently
// dimmed panorama. Beer Goggles equips a bypass for it.
export const HORROR_EXTRA_DAY_MODIFIERS = ["darkPano"] as const;

export const HORROR_GOLD_GRANT_CEILING = 160; // 10 x Mythic.buy; a correct catalogue can never trip it
export const HORROR_MAX_ITEM_GOLD_GRANT = 16; // observed maximum in S6 (Lobster)
export const HORROR_SLOT_GRANTS: Record<string, number> = { beltBuster: 1 };

// The item instance carries a mutable stack counter; "на этом предмете" effects
// increment it.
export const HORROR_ITEM_STACK_EFFECTS = [
  "stinkyPants",
  "wizardHat",
  "compostBin",
  "staff",
  "cleaver",
  "binoculars",
  "trashArmor",
  "toeTag",
  "pillow",
  "billionaireSuit",
  "goldTooth",
  "gpu",
  "graSkinna",
  "scroll",
  "warDrum",
] as const;

// ── Tier 3: transcriptions ──
export const HORROR_CAMPAIGN_DAYS = 40;
export const HORROR_LIGHTS_OUT_DAYS = [7, 13, 18, 24, 29, 35, 40];
export const HORROR_SHADOW_REALM_DAYS = [16, 26];
export const HORROR_RINGS = [4500, 4000, 3500, 3000, 2500, 2000, 1500, 1000];
export const HORROR_DUEL_TIMER_MS = 15000; // S5 only, absent from every S10 page

// ── Economy (§2.1) ──
export const HORROR_RARITY_ECONOMY: Record<
  HorrorRarity,
  { buy: number; sell: number; food: number; minDay: number; weight: number }
> = {
  Common: { buy: 2, sell: 1, food: 2, minDay: 1, weight: 70 }, // buy [OBSERVED S2]
  Uncommon: { buy: 2, sell: 1, food: 2, minDay: 4, weight: 20 }, // [TRANSCRIBED] C3
  Rare: { buy: 4, sell: 2, food: 4, minDay: 8, weight: 8 }, // [TRANSCRIBED] C3
  Mythic: { buy: 16, sell: 8, food: 8, minDay: 13, weight: 2 }, // [OBSERVED S3]
};
export const HORROR_REROLL_COST = 1; // [OBSERVED] S2 — overrides S5's 2

// ── Difficulty matrix (§1.5) ──
export const HORROR_DIFFICULTIES = {
  Normal: {
    label: "You are a beginner",
    maxHealth: 6000,
    threshold: { start: 1500, perDay: 20, cap: 4500 },
    damageDivisor: 3,
    growth: { fromDay: 36, factor: 1.25 },
    arrowsToStart: 2,
    echoesToStart: 1,
    happyThoughtsHeal: 600,
    happyThoughtsFreezeMs: 10000,
    fallChance: 0.02,
    fallDamage: 50,
    pace: { day1S: 2.5, perDayS: 0.09, floorFromDay: 19, intraDayS: 0.1 },
  },
  Hard: {
    label: "You know a few clues and metas",
    maxHealth: 6000,
    threshold: { start: 2000, perDay: 20, cap: 4500 },
    damageDivisor: 3,
    growth: { fromDay: 36, factor: 1.25 },
    arrowsToStart: 2,
    echoesToStart: 1,
    happyThoughtsHeal: 400,
    happyThoughtsFreezeMs: 10000,
    fallChance: 0.02,
    fallDamage: 50,
    pace: { day1S: 2.4, perDayS: 0.09, floorFromDay: 18, intraDayS: 0.1 },
  },
  Nightmare: {
    label: "You are a pro",
    maxHealth: 6000,
    threshold: { start: 3900, perDay: 15, cap: 4500 },
    damageDivisor: 2,
    growth: { fromDay: 21, factor: 1.15 },
    arrowsToStart: 2,
    echoesToStart: 1,
    happyThoughtsHeal: 300,
    happyThoughtsFreezeMs: 8000,
    fallChance: 0.02,
    fallDamage: 50,
    pace: { day1S: 2.0, perDayS: 0.06, floorFromDay: 20, intraDayS: 0.2 },
  },
} as const;

// ── Clown (§5.3) ──
export const HORROR_CLOWN = {
  hp: { Normal: 3500, Hard: 4000, Nightmare: 4800 },
  responseS: [30, 50],
  drawnOn: [5, 10, 15, 20, 25],
  rank: "Hangout",
  score: { typical: [1300, 2300], blunderChance: 0.1, blunder: [0, 1000], average: 1670 },
  mechanic: "creamPieWipe",
} as const;

// Boss HP is a rank-scaled family, not a Clown constant. Only Hangout is [CODEX];
// the rest are [INFERRED] at +20% per rank.
export const HORROR_BOSS_HP_BY_RANK = {
  Hangout: { Normal: 3500, Hard: 4000, Nightmare: 4800 },
  Prospect: { Normal: 4200, Hard: 4800, Nightmare: 5600 },
  Commander: { Normal: 5000, Hard: 5700, Nightmare: 6700 },
  "Senior Associate Manager of the Primordial Darkness": {
    Normal: 6000,
    Hard: 6800,
    Nightmare: 8000,
  },
} as const;

// ── Keywords (§6.4) ──
export const HORROR_KEYWORDS = {
  spells: "Cast from the bar at the bottom of the screen. Helps pin the location.",
  happyThoughts: "A panic button. Freezes the monster and heals you.",
  jumpscare: "Blocks your map and gives him 20 steps of ground.",
  monsterDistance:
    "Your lead, in metres. Higher is safer: moving pushes him back, time closes him in.",
  bossDamage: "Extra damage dealt to a boss in a duel.",
  threshold: "The score a guess must reach to survive the day.",
  minus: "Loses health, but never below your last threshold.",
  food: "Eaten automatically when you refill, heal, or take a break.",
  equipment: "Works while it sits in a slot.",
  lightsOut: "The panorama goes dark. Reveal it with your cursor.",
  shadowRealm: "Colour is gone. Colour clues will not help you.",
  wait: "A duration in days before the effect fires, counted from when you took the item.",
  stack:
    "A per-item counter. Eating, winning or falling raises it, and it never resets on that copy.",
  freeReroll: "A reroll that costs no gold. Spent before paid rerolls.",
} as const;

// ===========================================================================
// Aliases for migration only (§3.11). [DESIGN], scheduled for removal once P3 ships.
// ===========================================================================

export const HORROR_ITEM_ALIASES: Record<string, string> = {
  // renames
  garlic: "garlicPendant",
  sturdyPants: "stinkyPants",
  spaceSpice: "spaceRock",
  trashbag: "trashLid",
  thickMilk: "warmMilk",
  goldenSkates: "rollerSkates",
  camera: "beerGoggles",
  clover: "finbarrsClover",
  monsterPoster: "wantedPoster",
  crown: "cursedCrown",
  glasses: "binoculars",
  beefMeat: "bushMeat",
  redDevilMask: "shiinasOniMask",
  leatherCap: "leatherCoat",
  bloodVial: "bloodWand",
  copperCables: "jumperCables",
  blinder: "blankie",
  dustCake: "ductCake",
  fairyCake: "garisCake",
  cloverSnake: "gummiSnake",
  leviathanStone: "leviathanSteak",
  hotButter: "beltBuster",
  // duplicate-name collisions the old plan split into two ids
  soulEater: "anglerfish", // C12
  garlicHalo: "garlicBomb", // C9
  ufo: "saucer", // C8
};

// ===========================================================================
// The catalogue — 131 entries (§3.5–§3.8)
// ===========================================================================

export const HORROR_ITEMS: HorrorItem[] = [
  // -------------------------------------------------------------------------
  // COMMON — 35 entries (§3.5)
  // -------------------------------------------------------------------------
  {
    id: "beggarsHat",
    name: "Beggar's Hat",
    nameRu: "Beggar's Hat",
    rarity: "Common",
    kind: "Equipment",
    icon: "beggarsHat",
    trigger: ["equipped"],
    effects: [{ op: "gold", value: 1, polarity: "add" }],
    source: "s6",
  },
  {
    id: "garlicPendant",
    name: "Garlic Pendant",
    nameRu: "Garlic Pendant",
    rarity: "Common",
    kind: "Equipment",
    icon: "garlicPendant",
    trigger: ["equipped"],
    effects: [{ op: "monsterDistance", value: 10, polarity: "add" }],
    source: "s6",
  },
  {
    id: "stinkyPants",
    name: "Stinky Pants",
    nameRu: "Stinky Pants",
    rarity: "Common",
    kind: "Equipment",
    icon: "stinkyPants",
    trigger: ["equipped", "onEat"],
    effects: [{ op: "monsterDistance", value: 1, polarity: "add" }],
    stacks: { key: "stinkyPants", perStack: [{ op: "monsterDistance", value: 1, polarity: "add" }] },
    source: "s6",
  },
  {
    id: "luckyHorseshoe",
    name: "Lucky Horseshoe",
    nameRu: "Lucky Horseshoe",
    rarity: "Common",
    kind: "Equipment",
    icon: "luckyHorseshoe",
    trigger: ["equipped"],
    effects: [{ op: "fallChance", value: 0.2, polarity: "multiply" }],
    source: "s6",
  },
  {
    id: "wizardHat",
    name: "Wizard Hat",
    nameRu: "Wizard Hat",
    rarity: "Common",
    kind: "Equipment",
    icon: "wizardHat",
    trigger: ["onCast"],
    effects: [{ op: "heal", value: 100, polarity: "add" }],
    stacks: { key: "wizardHat", perStack: [{ op: "heal", value: 20, polarity: "add" }] },
    source: "s6",
  },
  {
    id: "tricycle",
    name: "Tricycle",
    nameRu: "Tricycle",
    rarity: "Common",
    kind: "Equipment",
    icon: "tricycle",
    trigger: ["equipped"],
    effects: [{ op: "doubleMoveChance", value: 0.2, polarity: "add" }],
    source: "s6",
  },
  {
    id: "compass",
    name: "Compass",
    nameRu: "Compass",
    rarity: "Common",
    kind: "Equipment",
    icon: "compass",
    trigger: ["equipped"],
    effects: [{ op: "guessThreshold", value: -250, polarity: "add" }],
    source: "s6",
  },
  {
    id: "puzzleBox",
    name: "Puzzle Box",
    nameRu: "Puzzle Box",
    rarity: "Common",
    kind: "Equipment",
    icon: "puzzleBox",
    trigger: ["equipped"],
    effects: [{ op: "puzzleStep", value: -1, polarity: "add" }],
    source: "s6",
  },
  {
    id: "stressBall",
    name: "Stress Ball",
    nameRu: "Stress Ball",
    rarity: "Common",
    kind: "Equipment",
    icon: "stressBall",
    trigger: ["equipped"],
    effects: [
      { op: "happyThoughts", value: 2, polarity: "add", durationS: 2 },
      { op: "happyThoughts", value: 400, polarity: "add", healDelta: 400 },
    ],
    source: "s6",
  },
  {
    id: "pacifier",
    name: "Pacifier",
    nameRu: "Pacifier",
    rarity: "Common",
    kind: "Consumable",
    icon: "pacifier",
    trigger: ["use"],
    effects: [
      { op: "freeHappyThoughts", value: 1, polarity: "add" },
      { op: "destroySelf", value: 1, polarity: "add" },
    ],
    condition: { kind: "monsterWithinM", value: 3 },
    destroysSelf: true,
    source: "s6",
  },
  {
    id: "spaceRock",
    name: "Space Rock",
    nameRu: "Space Rock",
    rarity: "Common",
    kind: "Consumable",
    icon: "spaceRock",
    trigger: ["onBossWin"],
    effects: [
      { op: "destroySelf", value: 1, polarity: "add" },
      { op: "spawnEquipment", value: 1, polarity: "add", itemId: "saucer" },
      { op: "heal", value: 500, polarity: "add" },
    ],
    destroysSelf: true,
    source: "s6",
  },
  {
    id: "scroll",
    name: "Scroll",
    nameRu: "Scroll",
    rarity: "Common",
    kind: "Consumable",
    icon: "scroll",
    trigger: ["eachDay", "onBossWin"],
    effects: [
      { op: "grantSpell", value: 0, polarity: "add", spells: 0 },
      { op: "grantSpell", value: 1, polarity: "add", spells: 1, bossId: "witch" },
    ],
    stacks: { key: "scroll", perStack: [{ op: "grantSpell", value: 1, polarity: "add", spells: 1 }] },
    source: "s6",
  },
  {
    id: "nazar",
    name: "Nazar",
    nameRu: "Nazar",
    rarity: "Common",
    kind: "Consumable",
    icon: "nazar",
    trigger: ["eachDay"],
    effects: [
      {
        op: "oneOf",
        value: 1,
        polarity: "add",
        branches: [
          [{ op: "omen", value: 1, polarity: "add" }],
          [{ op: "heal", value: 50, polarity: "add" }],
        ],
      },
    ],
    source: "s6",
  },
  {
    id: "pillow",
    name: "Pillow",
    nameRu: "Pillow",
    rarity: "Common",
    kind: "Equipment",
    icon: "pillow",
    trigger: ["eachDay", "onHappyThoughts"],
    effects: [{ op: "heal", value: 100, polarity: "add" }],
    stacks: { key: "pillow", perStack: [{ op: "heal", value: 25, polarity: "add" }] },
    source: "s6",
  },
  {
    id: "trashLid",
    name: "Trash Lid",
    nameRu: "Trash Lid",
    rarity: "Common",
    kind: "Equipment",
    icon: "trashLid",
    trigger: ["equipped"],
    effects: [{ op: "bossDamageTaken", value: -200, polarity: "add" }],
    source: "s6",
  },
  {
    id: "bananaPeel",
    name: "Banana Peel",
    nameRu: "Banana Peel",
    rarity: "Common",
    kind: "Equipment",
    icon: "bananaPeel",
    trigger: ["equipped", "onFall"],
    effects: [
      { op: "fallChance", value: 2, polarity: "multiply" },
      { op: "monsterDistance", value: 15, polarity: "add" },
    ],
    source: "s6",
  },
  {
    id: "slingshot",
    name: "Slingshot",
    nameRu: "Slingshot",
    rarity: "Common",
    kind: "Equipment",
    icon: "slingshot",
    trigger: ["onRejectedGuess"],
    effects: [{ op: "monsterDistance", value: 15, polarity: "add" }],
    oncePerDay: true,
    source: "s6",
  },
  {
    id: "earplugs",
    name: "Earplugs",
    nameRu: "Earplugs",
    rarity: "Common",
    kind: "Equipment",
    icon: "earplugs",
    trigger: ["equipped"],
    effects: [
      { op: "noJumpscareOnReject", value: 1, polarity: "add", noJumpscareOnReject: true },
      { op: "rejectBlockReduction", value: 0.5, polarity: "add", reduction: 0.5 },
    ],
    source: "s6",
  },
  {
    id: "goldTooth",
    name: "Gold Tooth",
    nameRu: "Gold Tooth",
    rarity: "Common",
    kind: "Equipment",
    icon: "goldTooth",
    trigger: ["equipped", "eachDay"],
    effects: [
      { op: "sellPrice", value: 1, polarity: "set", sellOverride: 1 },
      { op: "sellPricePerDay", value: 1, polarity: "add", sellPricePerDay: 1 },
    ],
    sellOverride: 1,
    stacks: { key: "goldTooth", perStack: [{ op: "sellPricePerDay", value: 1, polarity: "add", sellPricePerDay: 1 }] },
    source: "s6",
  },
  {
    id: "stopwatch",
    name: "Stopwatch",
    nameRu: "Stopwatch",
    rarity: "Common",
    kind: "Equipment",
    icon: "stopwatch",
    trigger: ["onGuess"],
    effects: [{ op: "gold", value: 2, polarity: "add", maxGuessMs: 15000 }],
    source: "s6",
  },
  {
    id: "sweatband",
    name: "Sweatband",
    nameRu: "Sweatband",
    rarity: "Common",
    kind: "Equipment",
    icon: "sweatband",
    trigger: ["equipped"],
    effects: [{ op: "distancePerStep", value: 1, polarity: "add" }],
    condition: { kind: "monsterWithinM", value: 10 },
    source: "s6",
  },
  {
    id: "dartboard",
    name: "Dartboard",
    nameRu: "Dartboard",
    rarity: "Common",
    kind: "Equipment",
    icon: "dartboard",
    trigger: ["onGuess"],
    effects: [{ op: "gold", value: 1, polarity: "add", minScore: 4000 }],
    source: "s6",
  },
  {
    id: "skateboard",
    name: "Skateboard",
    nameRu: "Skateboard",
    rarity: "Common",
    kind: "Equipment",
    icon: "skateboard",
    trigger: ["equipped", "onFall"],
    effects: [
      { op: "distancePerStep", value: 1, polarity: "add" },
      { op: "fallChance", value: 0.5, polarity: "multiply" },
      { op: "destroySelf", value: 1, polarity: "add" },
    ],
    destroysSelf: true,
    source: "s6",
  },
  {
    id: "jackOLantern",
    name: "Jack-O'-Lantern",
    nameRu: "Jack-O'-Lantern",
    rarity: "Common",
    kind: "Equipment",
    icon: "jackOLantern",
    trigger: ["equipped", "afterDays"],
    effects: [
      { op: "monsterDistance", value: 10, polarity: "add" },
      { op: "destroySelf", value: 1, polarity: "add", days: 4 },
    ],
    destroysSelf: true,
    source: "s6",
  },
  {
    id: "gulskinna",
    name: "Gulskinna",
    nameRu: "Gulskinna",
    rarity: "Common",
    kind: "Equipment",
    icon: "gulskinna",
    trigger: ["onBossWin", "onHappyThoughts"],
    effects: [
      { op: "grantSpell", value: 1, polarity: "add", spells: 1 },
      { op: "destroySelf", value: 1, polarity: "add" },
    ],
    destroysSelf: true,
    source: "s6",
  },
  {
    id: "pumpkinBun",
    name: "Pumpkin Bun",
    nameRu: "Pumpkin Bun",
    rarity: "Common",
    kind: "Food",
    icon: "pumpkinBun",
    trigger: ["use"],
    effects: [{ op: "heal", value: 250, polarity: "add" }],
    source: "s6",
  },
  {
    id: "garlicToast",
    name: "Garlic Toast",
    nameRu: "Garlic Toast",
    rarity: "Common",
    kind: "Food",
    icon: "garlicToast",
    trigger: ["use"],
    effects: [{ op: "monsterDistance", value: 2, polarity: "add" }],
    source: "s6",
  },
  {
    id: "potato",
    name: "Potato",
    nameRu: "Potato",
    rarity: "Common",
    kind: "Food",
    icon: "potato",
    trigger: ["use"],
    effects: [{ op: "maxHealth", value: 150, polarity: "add" }],
    source: "s6",
  },
  {
    id: "gasStationPill",
    name: "Gas Station Pill",
    nameRu: "Gas Station Pill",
    rarity: "Common",
    kind: "Food",
    icon: "gasStationPill",
    trigger: ["use"],
    effects: [{ op: "puzzleStep", value: -1, polarity: "add", chance: 0.25 }],
    source: "s6",
  },
  {
    id: "jellyEyeball",
    name: "Jelly Eyeball",
    nameRu: "Jelly Eyeball",
    rarity: "Common",
    kind: "Food",
    icon: "jellyEyeball",
    trigger: ["use"],
    effects: [{ op: "omen", value: 1, polarity: "add" }],
    source: "s6",
  },
  {
    id: "carrotCake",
    name: "Carrot Cake",
    nameRu: "Carrot Cake",
    rarity: "Common",
    kind: "Food",
    icon: "carrotCake",
    trigger: ["use"],
    effects: [{ op: "guessThreshold", value: -75, polarity: "add" }],
    source: "s6",
  },
  {
    id: "sausage",
    name: "Sausage",
    nameRu: "Sausage",
    rarity: "Common",
    kind: "Food",
    icon: "sausage",
    trigger: ["use"],
    effects: [{ op: "bossDamage", value: 100, polarity: "add" }],
    source: "s6",
  },
  {
    id: "fortuneCookie",
    name: "Fortune Cookie",
    nameRu: "Fortune Cookie",
    rarity: "Common",
    kind: "Food",
    icon: "fortuneCookie",
    trigger: ["use"],
    effects: [
      {
        op: "oneOf",
        value: 1,
        polarity: "add",
        branches: [
          [{ op: "gold", value: 2, polarity: "add" }],
          [{ op: "monsterDistance", value: -1, polarity: "add" }],
        ],
      },
    ],
    source: "s6",
  },
  {
    id: "warmMilk",
    name: "Warm Milk",
    nameRu: "Warm Milk",
    rarity: "Common",
    kind: "Food",
    icon: "warmMilk",
    trigger: ["use"],
    effects: [{ op: "happyThoughts", value: 2, polarity: "add", durationS: 2 }],
    source: "s6",
  },
  {
    id: "mushroom",
    name: "Mushroom",
    nameRu: "Mushroom",
    rarity: "Common",
    kind: "Food",
    icon: "mushroom",
    trigger: ["use"],
    effects: [
      {
        op: "oneOf",
        value: 1,
        polarity: "add",
        branches: [
          [{ op: "omen", value: 2, polarity: "add" }],
          [{ op: "happyThoughts", value: -1, polarity: "add", durationS: -1 }],
        ],
      },
    ],
    source: "s6",
  },

  // -------------------------------------------------------------------------
  // UNCOMMON — 43 entries (§3.6)
  // -------------------------------------------------------------------------
  {
    id: "rollerSkates",
    name: "Roller Skates",
    nameRu: "Roller Skates",
    rarity: "Uncommon",
    kind: "Equipment",
    icon: "rollerSkates",
    trigger: ["equipped"],
    effects: [
      { op: "distancePerStep", value: 1, polarity: "add" },
      { op: "fallChance", value: 4, polarity: "multiply" },
    ],
    source: "s6",
  },
  {
    id: "piggyBank",
    name: "Piggy Bank",
    nameRu: "Piggy Bank",
    rarity: "Uncommon",
    kind: "Equipment",
    icon: "piggyBank",
    trigger: ["eachDay"],
    effects: [{ op: "gold", value: 2, polarity: "add" }],
    source: "s6",
  },
  {
    id: "gpu",
    name: "GPU",
    nameRu: "GPU",
    rarity: "Uncommon",
    kind: "Equipment",
    icon: "gpu",
    trigger: ["equipped", "eachDay"],
    effects: [
      { op: "sellPrice", value: 2, polarity: "set", sellOverride: 2 },
      { op: "sellPricePerDay", value: 2, polarity: "add", sellPricePerDay: 2 },
    ],
    sellOverride: 2,
    stacks: { key: "gpu", perStack: [{ op: "sellPricePerDay", value: 2, polarity: "add", sellPricePerDay: 2 }] },
    source: "s6",
  },
  {
    id: "beerGoggles",
    name: "Beer Goggles",
    nameRu: "Beer Goggles",
    rarity: "Uncommon",
    kind: "Equipment",
    icon: "beerGoggles",
    trigger: ["equipped"],
    effects: [
      { op: "bypassModifier", value: 1, polarity: "add", modifier: "darkPano" },
      { op: "fallChance", value: 2, polarity: "multiply" },
    ],
    source: "s6",
  },
  {
    id: "garlicWreath",
    name: "Garlic Wreath",
    nameRu: "Garlic Wreath",
    rarity: "Uncommon",
    kind: "Equipment",
    icon: "garlicWreath",
    trigger: ["equipped"],
    effects: [{ op: "monsterDistance", value: 20, polarity: "add" }],
    source: "s6",
  },
  {
    id: "atlas",
    name: "Atlas",
    nameRu: "Atlas",
    rarity: "Uncommon",
    kind: "Equipment",
    icon: "atlas",
    trigger: ["equipped"],
    effects: [{ op: "guessThreshold", value: -400, polarity: "add" }],
    source: "s6",
  },
  {
    id: "compostBin",
    name: "Compost Bin",
    nameRu: "Compost Bin",
    rarity: "Uncommon",
    kind: "Equipment",
    icon: "compostBin",
    trigger: ["equipped", "onEat"],
    effects: [{ op: "maxHealth", value: 200, polarity: "add" }],
    stacks: {
      key: "compostBin",
      perStack: [
        { op: "maxHealth", value: 200, polarity: "add" },
        { op: "heal", value: 200, polarity: "add" },
      ],
    },
    source: "s6",
  },
  {
    id: "crystalBall",
    name: "Crystal Ball",
    nameRu: "Crystal Ball",
    rarity: "Uncommon",
    kind: "Consumable",
    icon: "crystalBall",
    trigger: ["eachDay"],
    effects: [
      {
        op: "oneOf",
        value: 1,
        polarity: "add",
        branches: [
          [{ op: "scry", value: 1, polarity: "add" }],
          [{ op: "maxHealth", value: 100, polarity: "add" }],
        ],
      },
    ],
    source: "s6",
  },
  {
    id: "staff",
    name: "Staff",
    nameRu: "Staff",
    rarity: "Uncommon",
    kind: "Equipment",
    icon: "staff",
    trigger: ["equipped", "onCast"],
    effects: [{ op: "bossDamage", value: 50, polarity: "add" }],
    stacks: { key: "staff", perStack: [{ op: "bossDamage", value: 50, polarity: "add" }] },
    source: "s6",
  },
  {
    id: "helmet",
    name: "Helmet",
    nameRu: "Helmet",
    rarity: "Uncommon",
    kind: "Consumable",
    icon: "helmet",
    trigger: ["onLethal"],
    effects: [
      { op: "healthFloor", value: 1, polarity: "set", healthFloor: 1 },
      { op: "destroySelf", value: 1, polarity: "add" },
    ],
    destroysSelf: true,
    source: "s6",
  },
  {
    id: "teddyBear",
    name: "Teddy Bear",
    nameRu: "Teddy Bear",
    rarity: "Uncommon",
    kind: "Equipment",
    icon: "teddyBear",
    trigger: ["onHappyThoughts"],
    effects: [
      { op: "monsterDistance", value: 20, polarity: "add" },
      { op: "omen", value: 1, polarity: "add" },
    ],
    source: "s6",
  },
  {
    id: "crowbar",
    name: "Crowbar",
    nameRu: "Crowbar",
    rarity: "Uncommon",
    kind: "Equipment",
    icon: "crowbar",
    trigger: ["onPuzzleSolve"],
    effects: [{ op: "monsterDistance", value: 5, polarity: "add" }],
    source: "s6",
  },
  {
    id: "pedometer",
    name: "Pedometer",
    nameRu: "Pedometer",
    rarity: "Uncommon",
    kind: "Consumable",
    icon: "pedometer",
    trigger: ["onStep"],
    effects: [{ op: "grantSpell", value: 1, polarity: "add", spells: 1, everySteps: 40 }],
    source: "s6",
  },
  {
    id: "airHorn",
    name: "Air Horn",
    nameRu: "Air Horn",
    rarity: "Uncommon",
    kind: "Equipment",
    icon: "airHorn",
    trigger: ["equipped"],
    effects: [{ op: "monsterDistance", value: 15, polarity: "add" }],
    condition: { kind: "monsterWithinM", value: 5 },
    oncePerDay: true,
    source: "s6",
  },
  {
    id: "holyWater",
    name: "Holy Water",
    nameRu: "Holy Water",
    rarity: "Uncommon",
    kind: "Consumable",
    icon: "holyWater",
    trigger: ["onScry"],
    effects: [{ op: "monsterDistance", value: 25, polarity: "add", insideLocation: true }],
    condition: { kind: "insideLocation", value: 1 },
    source: "s6",
  },
  {
    id: "rubberChicken",
    name: "Rubber Chicken",
    nameRu: "Rubber Chicken",
    rarity: "Uncommon",
    kind: "Equipment",
    icon: "rubberChicken",
    trigger: ["onCatch"],
    effects: [
      { op: "monsterDistanceTo", value: 15, polarity: "set", target: 15, chance: 0.5 },
      { op: "destroySelf", value: 1, polarity: "add" },
    ],
    destroysSelf: true,
    source: "s6",
  },
  {
    id: "rabbitsFoot",
    name: "Rabbit's Foot",
    nameRu: "Rabbit's Foot",
    rarity: "Uncommon",
    kind: "Equipment",
    icon: "rabbitsFoot",
    trigger: ["onGuess"],
    effects: [{ op: "ignoreThresholdChance", value: 0.2, polarity: "add", ignoreChance: 0.2 }],
    source: "s6",
  },
  {
    id: "smellingSalts",
    name: "Smelling Salts",
    nameRu: "Smelling Salts",
    rarity: "Uncommon",
    kind: "Equipment",
    icon: "smellingSalts",
    trigger: ["equipped"],
    effects: [
      { op: "ignoreLowHealthSlowdown", value: 1, polarity: "add", ignoreLowHealthSlowdown: true },
    ],
    source: "s6",
  },
  {
    id: "razor",
    name: "Razor",
    nameRu: "Razor",
    rarity: "Uncommon",
    kind: "Equipment",
    icon: "razor",
    trigger: ["onGuess"],
    effects: [{ op: "gold", value: 3, polarity: "add" }],
    condition: { kind: "monsterWithinM", value: 4 },
    source: "s6",
  },
  {
    id: "wantedPoster",
    name: "Wanted Poster",
    nameRu: "Wanted Poster",
    rarity: "Uncommon",
    kind: "Equipment",
    icon: "wantedPoster",
    trigger: ["onBossWin"],
    effects: [
      { op: "bossRewardGoldPerRank", value: 2, polarity: "add", bossRewardGoldPerRank: 2 },
    ],
    source: "s6",
  },
  {
    id: "couponBook",
    name: "Coupon Book",
    nameRu: "Coupon Book",
    rarity: "Uncommon",
    kind: "Equipment",
    icon: "couponBook",
    trigger: ["equipped"],
    effects: [{ op: "foodPrice", value: -1, polarity: "add", foodPriceDelta: -1 }],
    source: "s6",
  },
  {
    id: "loyaltyCard",
    name: "Loyalty Card",
    nameRu: "Loyalty Card",
    rarity: "Uncommon",
    kind: "Equipment",
    icon: "loyaltyCard",
    trigger: ["use"],
    effects: [
      { op: "freeReroll", value: 1, polarity: "add", freeReroll: 1 },
      { op: "gold", value: 5, polarity: "add" },
    ],
    source: "s6",
  },
  {
    id: "horns",
    name: "Horns",
    nameRu: "Horns",
    rarity: "Uncommon",
    kind: "Equipment",
    icon: "horns",
    trigger: ["equipped"],
    effects: [{ op: "bossDamage", value: 600, polarity: "add" }],
    condition: { kind: "healthBelowFraction", value: 0.5 },
    source: "s6",
  },
  {
    id: "handMirror",
    name: "Hand Mirror",
    nameRu: "Hand Mirror",
    rarity: "Uncommon",
    kind: "Equipment",
    icon: "handMirror",
    trigger: ["onBossLoss"],
    effects: [{ op: "reflectBossHit", value: 0.3, polarity: "add", reflectFraction: 0.3 }],
    source: "s6",
  },
  {
    id: "cleaver",
    name: "Cleaver",
    nameRu: "Cleaver",
    rarity: "Uncommon",
    kind: "Equipment",
    icon: "cleaver",
    trigger: ["equipped", "onEat"],
    effects: [{ op: "bossDamage", value: 30, polarity: "add" }],
    stacks: { key: "cleaver", perStack: [{ op: "bossDamage", value: 30, polarity: "add" }] },
    source: "s6",
  },
  {
    id: "lunchbox",
    name: "Lunchbox",
    nameRu: "Lunchbox",
    rarity: "Uncommon",
    kind: "Food",
    icon: "lunchbox",
    trigger: ["onEat"],
    effects: [{ op: "grantSpell", value: 1, polarity: "add", spells: 1, chance: 0.3 }],
    source: "s6",
  },
  {
    id: "binoculars",
    name: "Binoculars",
    nameRu: "Binoculars",
    rarity: "Uncommon",
    kind: "Equipment",
    icon: "binoculars",
    trigger: ["equipped", "onGuess"],
    effects: [{ op: "monsterDistance", value: 2, polarity: "add" }],
    stacks: { key: "binoculars", perStack: [{ op: "monsterDistance", value: 2, polarity: "add" }] },
    source: "s6",
  },
  {
    id: "paperMap",
    name: "Paper Map",
    nameRu: "Paper Map",
    rarity: "Uncommon",
    kind: "Equipment",
    icon: "paperMap",
    trigger: ["equipped"],
    effects: [{ op: "puzzleShape", value: 1, polarity: "set", shape: "map2x2" }],
    source: "s6",
  },
  {
    id: "mapCase",
    name: "Map Case",
    nameRu: "Map Case",
    rarity: "Uncommon",
    kind: "Equipment",
    icon: "mapCase",
    trigger: ["equipped", "onPuzzleSolve"],
    effects: [
      { op: "puzzleShape", value: 1, polarity: "set", shape: "zipper" },
      { op: "monsterDistance", value: 10, polarity: "add" },
      { op: "puzzleUnlockUntilDayEnd", value: 1, polarity: "add", puzzleUnlockUntilDayEnd: true },
    ],
    source: "s6",
  },
  {
    id: "metalDetector",
    name: "Metal Detector",
    nameRu: "Metal Detector",
    rarity: "Uncommon",
    kind: "Equipment",
    icon: "metalDetector",
    trigger: ["eachDay"],
    effects: [
      {
        op: "oneOf",
        value: 1,
        polarity: "add",
        branches: [
          [{ op: "spawnRarity", value: 1, polarity: "add", rarity: "Common", kind: "Equipment" }],
          [{ op: "spawnRarity", value: 1, polarity: "add", rarity: "Uncommon", kind: "Equipment" }],
        ],
      },
    ],
    source: "s6",
  },
  {
    id: "magnifyingGlass",
    name: "Magnifying Glass",
    nameRu: "Magnifying Glass",
    rarity: "Uncommon",
    kind: "Equipment",
    icon: "magnifyingGlass",
    trigger: ["onFall"],
    effects: [
      {
        op: "oneOf",
        value: 1,
        polarity: "add",
        branches: [
          [{ op: "heal", value: 150, polarity: "add" }],
          [{ op: "gold", value: 1, polarity: "add" }],
        ],
      },
    ],
    source: "s6",
  },
  {
    id: "graSkinna",
    name: "Græskinna",
    nameRu: "Græskinna",
    rarity: "Uncommon",
    kind: "Consumable",
    icon: "graSkinna",
    trigger: ["eachDay"],
    effects: [
      {
        op: "oneOf",
        value: 1,
        polarity: "add",
        branches: [
          [{ op: "gold", value: 1, polarity: "add" }],
          [{ op: "grantSpell", value: 1, polarity: "add", spells: 1 }],
          [{ op: "destroySelf", value: 1, polarity: "add" }],
        ],
      },
    ],
    destroysSelf: true,
    source: "s6",
  },
  {
    id: "nowlosTenguMask",
    name: "Nowlo's Tengu Mask",
    nameRu: "Nowlo's Tengu Mask",
    rarity: "Uncommon",
    kind: "Equipment",
    icon: "nowlosTenguMask",
    trigger: ["onGainMaxHealth"],
    effects: [{ op: "heal", value: 1, polarity: "add" }],
    source: "s6",
  },
  {
    id: "garlicBulb",
    name: "Garlic Bulb",
    nameRu: "Garlic Bulb",
    rarity: "Uncommon",
    kind: "Food",
    icon: "garlicBulb",
    trigger: ["use"],
    effects: [{ op: "monsterDistance", value: 4, polarity: "add" }],
    source: "s6",
  },
  {
    id: "cupcake",
    name: "Cupcake",
    nameRu: "Cupcake",
    rarity: "Uncommon",
    kind: "Food",
    icon: "cupcake",
    trigger: ["use"],
    effects: [{ op: "heal", value: 500, polarity: "add" }],
    source: "s6",
  },
  {
    id: "bushMeat",
    name: "Bush Meat",
    nameRu: "Bush Meat",
    rarity: "Uncommon",
    kind: "Food",
    icon: "bushMeat",
    trigger: ["use"],
    effects: [
      {
        op: "oneOf",
        value: 1,
        polarity: "add",
        branches: [
          [{ op: "heal", value: -300, polarity: "add" }],
          [{ op: "heal", value: 800, polarity: "add" }],
        ],
      },
    ],
    source: "s6",
  },
  {
    id: "spongeCake",
    name: "Sponge Cake",
    nameRu: "Sponge Cake",
    rarity: "Uncommon",
    kind: "Food",
    icon: "spongeCake",
    trigger: ["use"],
    effects: [{ op: "guessThreshold", value: -125, polarity: "add" }],
    source: "s6",
  },
  {
    id: "meatball",
    name: "Meatball",
    nameRu: "Meatball",
    rarity: "Uncommon",
    kind: "Food",
    icon: "meatball",
    trigger: ["use"],
    effects: [{ op: "bossDamage", value: 200, polarity: "add" }],
    source: "s6",
  },
  {
    id: "chewingGum",
    name: "Chewing Gum",
    nameRu: "Chewing Gum",
    rarity: "Uncommon",
    kind: "Food",
    icon: "chewingGum",
    trigger: ["use"],
    effects: [{ op: "grantSpell", value: 1, polarity: "add", spells: 1 }],
    source: "s6",
  },
  {
    id: "cocoa",
    name: "Cocoa",
    nameRu: "Cocoa",
    rarity: "Uncommon",
    kind: "Food",
    icon: "cocoa",
    trigger: ["use"],
    effects: [{ op: "happyThoughts", value: 1, polarity: "add", restoreHappyThoughts: true }],
    source: "s6",
  },
  {
    id: "energyDrink",
    name: "Energy Drink",
    nameRu: "Energy Drink",
    rarity: "Uncommon",
    kind: "Food",
    icon: "energyDrink",
    trigger: ["use"],
    effects: [
      {
        op: "oneOf",
        value: 1,
        polarity: "add",
        branches: [
          [{ op: "puzzleStep", value: -1, polarity: "add" }],
          [{ op: "scry", value: 1, polarity: "add" }],
        ],
      },
    ],
    source: "s6",
  },
  {
    id: "turnip",
    name: "Turnip",
    nameRu: "Turnip",
    rarity: "Uncommon",
    kind: "Food",
    icon: "turnip",
    trigger: ["use"],
    effects: [{ op: "maxHealth", value: 600, polarity: "add" }],
    source: "s6",
  },
  {
    id: "oyster",
    name: "Oyster",
    nameRu: "Oyster",
    rarity: "Uncommon",
    kind: "Food",
    icon: "oyster",
    trigger: ["use"],
    effects: [
      {
        op: "oneOf",
        value: 1,
        polarity: "add",
        branches: [
          [{ op: "gold", value: 0, polarity: "add" }],
          [{ op: "gold", value: 1, polarity: "add" }],
          [{ op: "gold", value: 3, polarity: "add" }],
          [{ op: "gold", value: 4, polarity: "add" }],
        ],
      },
    ],
    source: "s6",
  },

  // -------------------------------------------------------------------------
  // RARE — 33 entries (§3.7)
  // -------------------------------------------------------------------------
  {
    id: "ledger",
    name: "Ledger",
    nameRu: "Ledger",
    rarity: "Rare",
    kind: "Equipment",
    icon: "ledger",
    trigger: ["eachDay"],
    effects: [{ op: "gold", value: 3, polarity: "add" }],
    source: "s6",
  },
  {
    id: "broom",
    name: "Broom",
    nameRu: "Broom",
    rarity: "Rare",
    kind: "Equipment",
    icon: "broom",
    trigger: ["onCast"],
    effects: [{ op: "monsterDistance", value: 20, polarity: "add" }],
    source: "s6",
  },
  {
    id: "lockpick",
    name: "Lockpick",
    nameRu: "Lockpick",
    rarity: "Rare",
    kind: "Equipment",
    icon: "lockpick",
    trigger: ["equipped", "onPuzzleSolve"],
    effects: [
      { op: "puzzleShape", value: 1, polarity: "set", shape: "twoStep" },
      { op: "puzzleUnlockUntilDayEnd", value: 1, polarity: "add", puzzleUnlockUntilDayEnd: true },
    ],
    source: "s6",
  },
  {
    id: "chest",
    name: "Chest",
    nameRu: "Chest",
    rarity: "Rare",
    kind: "Equipment",
    icon: "chest",
    trigger: ["equipped", "onPuzzleSolve"],
    effects: [
      { op: "puzzleShape", value: 1, polarity: "set", shape: "picklock" },
      { op: "gold", value: 3, polarity: "add" },
      { op: "heal", value: 150, polarity: "add" },
    ],
    source: "s6",
  },
  {
    id: "shiinasOniMask",
    name: "Shiina's Oni Mask",
    nameRu: "Shiina's Oni Mask",
    rarity: "Rare",
    kind: "Equipment",
    icon: "shiinasOniMask",
    trigger: ["onBossHit"],
    effects: [
      { op: "bossDamageFromDamageDealt", value: 1, polarity: "add", bossDamageFromDamageDealt: 1 },
    ],
    source: "s6",
  },
  {
    id: "leatherCoat",
    name: "Leather Coat",
    nameRu: "Leather Coat",
    rarity: "Rare",
    kind: "Equipment",
    icon: "leatherCoat",
    trigger: ["equipped"],
    effects: [
      { op: "damageTakenMultiplier", value: 0.8, polarity: "multiply", damageTakenMultiplier: 0.8 },
    ],
    source: "s6",
  },
  {
    id: "bloodWand",
    name: "Blood Wand",
    nameRu: "Blood Wand",
    rarity: "Rare",
    kind: "Equipment",
    icon: "bloodWand",
    trigger: ["onCast"],
    effects: [
      { op: "heal", value: -50, polarity: "add" },
      { op: "gold", value: 2, polarity: "add" },
    ],
    source: "s6",
  },
  {
    id: "thirdEye",
    name: "Third Eye",
    nameRu: "Third Eye",
    rarity: "Rare",
    kind: "Equipment",
    icon: "thirdEye",
    trigger: ["onScry"],
    effects: [{ op: "grantSpell", value: 1, polarity: "add", spells: 1, insideLocation: true }],
    condition: { kind: "insideLocation", value: 1 },
    source: "s6",
  },
  {
    id: "hearse",
    name: "Hearse",
    nameRu: "Hearse",
    rarity: "Rare",
    kind: "Equipment",
    icon: "hearse",
    trigger: ["equipped"],
    effects: [
      { op: "distancePerStep", value: 2, polarity: "add" },
      { op: "monsterDistance", value: -10, polarity: "add" },
    ],
    source: "s6",
  },
  {
    id: "hushMoney",
    name: "Hush Money",
    nameRu: "Hush Money",
    rarity: "Rare",
    kind: "Equipment",
    icon: "hushMoney",
    trigger: ["onCatch"],
    effects: [
      { op: "gold", value: -2, polarity: "add" },
      { op: "doubleCatchCost", value: 1, polarity: "add", doubleCatchCost: true },
      { op: "monsterDistanceTo", value: 30, polarity: "set", target: 30 },
    ],
    source: "s6",
  },
  {
    id: "jumperCables",
    name: "Jumper Cables",
    nameRu: "Jumper Cables",
    rarity: "Rare",
    kind: "Consumable",
    icon: "jumperCables",
    trigger: ["onLethal"],
    effects: [
      { op: "healthFloor", value: 2000, polarity: "set", healthFloor: 2000 },
      { op: "destroySelf", value: 1, polarity: "add" },
    ],
    destroysSelf: true,
    source: "s6",
  },
  {
    id: "defibrillator",
    name: "Defibrillator",
    nameRu: "Defibrillator",
    rarity: "Rare",
    kind: "Consumable",
    icon: "defibrillator",
    trigger: ["onBossHit"],
    effects: [
      { op: "cancelBossHitTo", value: 1500, polarity: "set", cancelBossHitTo: 1500 },
      { op: "destroySelf", value: 1, polarity: "add" },
    ],
    destroysSelf: true,
    source: "s6",
  },
  {
    id: "voodooDoll",
    name: "Voodoo Doll",
    nameRu: "Voodoo Doll",
    rarity: "Rare",
    kind: "Consumable",
    icon: "voodooDoll",
    trigger: ["onDamage"],
    effects: [
      { op: "heal", value: 1, polarity: "add" },
      { op: "maxHealth", value: 1, polarity: "add" },
      { op: "destroySelf", value: 1, polarity: "add" },
    ],
    destroysSelf: true,
    source: "s6",
  },
  {
    id: "ouijaBoard",
    name: "Ouija Board",
    nameRu: "Ouija Board",
    rarity: "Rare",
    kind: "Equipment",
    icon: "ouijaBoard",
    trigger: ["eachDay"],
    effects: [{ op: "grantSpell", value: 1, polarity: "add", spells: 1 }],
    source: "s6",
  },
  {
    id: "graSkinnaRare",
    name: "Gráskinna",
    nameRu: "Gráskinna",
    rarity: "Rare",
    kind: "Consumable",
    icon: "graSkinnaRare",
    trigger: ["onCast"],
    effects: [
      { op: "grantSpell", value: 1, polarity: "add", spells: 1 },
      { op: "destroySelf", value: 1, polarity: "add", destroyChance: 0.15, destroyChancePerStack: 0.15 },
    ],
    stacks: {
      key: "graSkinnaRare",
      perStack: [{ op: "destroySelf", value: 1, polarity: "add", destroyChancePerStack: 0.15 }],
    },
    destroysSelf: true,
    source: "s6",
  },
  {
    id: "blankie",
    name: "Blankie",
    nameRu: "Blankie",
    rarity: "Rare",
    kind: "Equipment",
    icon: "blankie",
    trigger: ["onBossWin"],
    effects: [{ op: "happyThoughts", value: 1, polarity: "add", restoreHappyThoughts: true }],
    source: "s6",
  },
  {
    id: "hallPass",
    name: "Hall Pass",
    nameRu: "Hall Pass",
    rarity: "Rare",
    kind: "Consumable",
    icon: "hallPass",
    trigger: ["equipped"],
    effects: [
      { op: "skipBoss", value: 1, polarity: "add", skipBoss: true },
      { op: "destroySelf", value: 1, polarity: "add" },
    ],
    destroysSelf: true,
    source: "s6",
  },
  {
    id: "warDrum",
    name: "War Drum",
    nameRu: "War Drum",
    rarity: "Rare",
    kind: "Equipment",
    icon: "warDrum",
    trigger: ["equipped", "onBossWin"],
    effects: [{ op: "bossDamage", value: 200, polarity: "add" }],
    stacks: { key: "warDrum", perStack: [{ op: "bossDamage", value: 100, polarity: "add" }] },
    source: "s6",
  },
  {
    id: "sniperScope",
    name: "Sniper Scope",
    nameRu: "Sniper Scope",
    rarity: "Rare",
    kind: "Equipment",
    icon: "sniperScope",
    trigger: ["onBossHit"],
    effects: [{ op: "bossDamage", value: 2000, polarity: "add", minScore: 4500 }],
    source: "s6",
  },
  {
    id: "medal",
    name: "Medal",
    nameRu: "Medal",
    rarity: "Rare",
    kind: "Consumable",
    icon: "medal",
    trigger: ["onGuess"],
    effects: [
      { op: "gold", value: 16, polarity: "add", minScore: 4600 },
      { op: "heal", value: 800, polarity: "add", minScore: 4600 },
      { op: "destroySelf", value: 1, polarity: "add" },
    ],
    destroysSelf: true,
    source: "s6",
  },
  {
    id: "cursedCrown",
    name: "Cursed Crown",
    nameRu: "Cursed Crown",
    rarity: "Rare",
    kind: "Equipment",
    icon: "cursedCrown",
    trigger: ["equipped"],
    effects: [
      { op: "monsterDistance", value: 30, polarity: "add" },
      { op: "maxHealth", value: -2000, polarity: "add" },
    ],
    source: "s6",
  },
  {
    id: "toeTag",
    name: "Toe Tag",
    nameRu: "Toe Tag",
    rarity: "Rare",
    kind: "Equipment",
    icon: "toeTag",
    trigger: ["equipped"],
    effects: [{ op: "monsterDistance", value: 60, polarity: "add" }],
    stacks: {
      key: "toeTag",
      perStack: [{ op: "monsterDistance", value: -1, polarity: "add", perHealth: 100 }],
    },
    source: "s6",
  },
  {
    id: "trashArmor",
    name: "Trash Armor",
    nameRu: "Trash Armor",
    rarity: "Rare",
    kind: "Equipment",
    icon: "trashArmor",
    trigger: ["equipped", "onDestroyOther"],
    effects: [{ op: "monsterDistance", value: 10, polarity: "add" }],
    stacks: { key: "trashArmor", perStack: [{ op: "monsterDistance", value: 15, polarity: "add" }] },
    source: "s6",
  },
  {
    id: "garlicConfit",
    name: "Garlic Confit",
    nameRu: "Garlic Confit",
    rarity: "Rare",
    kind: "Food",
    icon: "garlicConfit",
    trigger: ["use"],
    effects: [{ op: "monsterDistance", value: 6, polarity: "add" }],
    source: "s6",
  },
  {
    id: "seersSouffle",
    name: "Seer's Soufflé",
    nameRu: "Seer's Soufflé",
    rarity: "Rare",
    kind: "Food",
    icon: "seersSouffle",
    trigger: ["use"],
    effects: [{ op: "scry", value: 2, polarity: "add" }],
    source: "s6",
  },
  {
    id: "ductCake",
    name: "Duct Cake",
    nameRu: "Duct Cake",
    rarity: "Rare",
    kind: "Food",
    icon: "ductCake",
    trigger: ["use"],
    effects: [{ op: "restoreDestroyed", value: 1, polarity: "add", restoreDestroyed: true }],
    source: "s6",
  },
  {
    id: "gummiBear",
    name: "Gummi Bear",
    nameRu: "Gummi Bear",
    rarity: "Rare",
    kind: "Food",
    icon: "gummiBear",
    trigger: ["use"],
    effects: [{ op: "grantSpell", value: 2, polarity: "add", spells: 2 }],
    source: "s6",
  },
  {
    id: "goulash",
    name: "Goulash",
    nameRu: "Goulash",
    rarity: "Rare",
    kind: "Food",
    icon: "goulash",
    trigger: ["use"],
    effects: [{ op: "distancePerStep", value: 1, polarity: "add" }],
    source: "s6",
  },
  {
    id: "candyCorn",
    name: "Candy Corn",
    nameRu: "Candy Corn",
    rarity: "Rare",
    kind: "Food",
    icon: "candyCorn",
    trigger: ["use"],
    effects: [{ op: "guessThreshold", value: -250, polarity: "add" }],
    source: "s6",
  },
  {
    id: "applePie",
    name: "Apple Pie",
    nameRu: "Apple Pie",
    rarity: "Rare",
    kind: "Food",
    icon: "applePie",
    trigger: ["use"],
    effects: [{ op: "heal", value: 1500, polarity: "add" }],
    source: "s6",
  },
  {
    id: "giantPumpkin",
    name: "Giant Pumpkin",
    nameRu: "Giant Pumpkin",
    rarity: "Rare",
    kind: "Food",
    icon: "giantPumpkin",
    trigger: ["use"],
    effects: [{ op: "maxHealth", value: 1000, polarity: "add" }],
    source: "s6",
  },
  {
    id: "beefJerky",
    name: "Beef Jerky",
    nameRu: "Beef Jerky",
    rarity: "Rare",
    kind: "Food",
    icon: "beefJerky",
    trigger: ["use"],
    effects: [{ op: "bossDamage", value: 400, polarity: "add" }],
    source: "s6",
  },
  {
    id: "anglerfish",
    name: "Anglerfish",
    nameRu: "Anglerfish",
    rarity: "Rare",
    kind: "Food",
    icon: "anglerfish",
    trigger: ["onEat"],
    effects: [
      { op: "destroyRandom", value: 3, polarity: "add", destroyRandom: 3 },
      { op: "spawnRarity", value: 1, polarity: "add", rarity: "Mythic", kind: "Equipment" },
    ],
    source: "s6",
  },

  // -------------------------------------------------------------------------
  // MYTHIC — 20 entries (§3.8)
  // -------------------------------------------------------------------------
  {
    id: "garlicBomb",
    name: "Garlic Bomb",
    nameRu: "Garlic Bomb",
    rarity: "Mythic",
    kind: "Consumable",
    icon: "garlicBomb",
    trigger: ["onCatch"],
    effects: [
      { op: "monsterDistanceTo", value: 50, polarity: "set", target: 50 },
      { op: "destroySelf", value: 1, polarity: "add" },
    ],
    destroysSelf: true,
    source: "s6",
  },
  {
    id: "finbarrsClover",
    name: "Finbarr's Clover",
    nameRu: "Finbarr's Clover",
    rarity: "Mythic",
    kind: "Equipment",
    icon: "finbarrsClover",
    trigger: ["eachDay"],
    effects: [
      {
        op: "oneOf",
        value: 1,
        polarity: "add",
        branches: [
          [{ op: "gold", value: 8, polarity: "add" }],
          [{ op: "heal", value: 1500, polarity: "add" }],
          [{ op: "happyThoughts", value: 1, polarity: "add", restoreHappyThoughts: true }],
        ],
      },
    ],
    source: "s6",
  },
  {
    id: "billionaireSuit",
    name: "Billionaire Suit",
    nameRu: "Billionaire Suit",
    rarity: "Mythic",
    kind: "Equipment",
    icon: "billionaireSuit",
    trigger: ["equipped"],
    effects: [{ op: "monsterDistance", value: 10, polarity: "add" }],
    stacks: {
      key: "billionaireSuit",
      perStack: [{ op: "monsterDistance", value: 1, polarity: "add", perGold: 1 }],
    },
    source: "s6",
  },
  {
    id: "ambulance",
    name: "Ambulance",
    nameRu: "Ambulance",
    rarity: "Mythic",
    kind: "Equipment",
    icon: "ambulance",
    trigger: ["equipped"],
    effects: [
      { op: "distancePerStep", value: 3, polarity: "add" },
      { op: "healPerStep", value: 30, polarity: "add" },
    ],
    source: "s6",
  },
  {
    id: "saucer",
    name: "Saucer",
    nameRu: "Saucer",
    rarity: "Mythic",
    kind: "Equipment",
    icon: "saucer",
    trigger: ["equipped", "onBossWin"],
    effects: [
      { op: "distancePerStep", value: 3, polarity: "add" },
      { op: "ignoreLowHealthSlowdown", value: 1, polarity: "add", ignoreLowHealthSlowdown: true },
      { op: "skipDay", value: 7, polarity: "add", skipDays: 7, bossId: "meepMoorp" },
    ],
    source: "s6",
  },
  {
    id: "gutOfTheBloatlord",
    name: "Gut of the Bloatlord",
    nameRu: "Gut of the Bloatlord",
    rarity: "Mythic",
    kind: "Equipment",
    icon: "gutOfTheBloatlord",
    trigger: ["onCatch"],
    effects: [{ op: "endDayAtDamage", value: 4500, polarity: "set", endDayAtDamage: 4500 }],
    source: "s6",
  },
  {
    id: "rauðskinna",
    name: "Rauðskinna",
    nameRu: "Rauðskinna",
    rarity: "Mythic",
    kind: "Equipment",
    icon: "rauðskinna",
    trigger: ["eachDay", "onCast"],
    effects: [
      { op: "grantSpell", value: 2, polarity: "add", spells: 2 },
      { op: "monsterDistance", value: 15, polarity: "add" },
    ],
    source: "s6",
  },
  {
    id: "hammock",
    name: "Hammock",
    nameRu: "Hammock",
    rarity: "Mythic",
    kind: "Equipment",
    icon: "hammock",
    trigger: ["eachDay"],
    effects: [{ op: "happyThoughts", value: 1, polarity: "add", restoreHappyThoughts: true }],
    source: "s6",
  },
  {
    id: "moonstone",
    name: "Moonstone",
    nameRu: "Moonstone",
    rarity: "Mythic",
    kind: "Equipment",
    icon: "moonstone",
    trigger: ["onCast"],
    effects: [{ op: "grantCharges", value: 1, polarity: "add", keepChargeChance: 0.5 }],
    source: "s6",
  },
  {
    id: "scythe",
    name: "Scythe",
    nameRu: "Scythe",
    rarity: "Mythic",
    kind: "Equipment",
    icon: "scythe",
    trigger: ["equipped"],
    effects: [
      { op: "bossDamageMultiplier", value: 0.5, polarity: "add", bossDamageMultiplier: 0.5 },
    ],
    source: "s6",
  },
  {
    id: "torch",
    name: "Torch",
    nameRu: "Torch",
    rarity: "Mythic",
    kind: "Equipment",
    icon: "torch",
    trigger: ["equipped"],
    effects: [{ op: "bypassModifier", value: 1, polarity: "add", modifier: "lightsOut" }],
    source: "s6",
  },
  {
    id: "timeMachine",
    name: "Time Machine",
    nameRu: "Time Machine",
    rarity: "Mythic",
    kind: "Consumable",
    icon: "timeMachine",
    trigger: ["onDestroyOther"],
    effects: [{ op: "skipDay", value: 1, polarity: "add", skipDays: 1 }],
    source: "s6",
  },
  {
    id: "garisCake",
    name: "Gari's Cake",
    nameRu: "Gari's Cake",
    rarity: "Mythic",
    kind: "Food",
    icon: "garisCake",
    trigger: ["use"],
    effects: [{ op: "heal", value: 999999, polarity: "set" }],
    source: "s6",
  },
  {
    id: "lobster",
    name: "Lobster",
    nameRu: "Lobster",
    rarity: "Mythic",
    kind: "Food",
    icon: "lobster",
    trigger: ["use"],
    effects: [{ op: "gold", value: 16, polarity: "add" }],
    source: "s6",
  },
  {
    id: "gummiSnake",
    name: "Gummi Snake",
    nameRu: "Gummi Snake",
    rarity: "Mythic",
    kind: "Food",
    icon: "gummiSnake",
    trigger: ["use"],
    effects: [{ op: "grantSpell", value: 4, polarity: "add", spells: 4 }],
    source: "s6",
  },
  {
    id: "watermelon",
    name: "Watermelon",
    nameRu: "Watermelon",
    rarity: "Mythic",
    kind: "Food",
    icon: "watermelon",
    trigger: ["use"],
    effects: [
      { op: "healMultiplier", value: 0.5, polarity: "add", healMultiplier: 0.5 },
      { op: "maxHealthMultiplier", value: 0.5, polarity: "add", maxHealthMultiplier: 0.5 },
    ],
    source: "s6",
  },
  {
    id: "leviathanSteak",
    name: "Leviathan Steak",
    nameRu: "Leviathan Steak",
    rarity: "Mythic",
    kind: "Food",
    icon: "leviathanSteak",
    trigger: ["use"],
    effects: [{ op: "bossDamage", value: 1000, polarity: "add" }],
    source: "s6",
  },
  {
    id: "dragonEgg",
    name: "Dragon Egg",
    nameRu: "Dragon Egg",
    rarity: "Mythic",
    kind: "Food",
    icon: "dragonEgg",
    trigger: ["use"],
    effects: [{ op: "spawnRarity", value: 1, polarity: "add", rarity: "Mythic", kind: "Equipment" }],
    source: "s6",
  },
  {
    id: "hopium",
    name: "Hopium",
    nameRu: "Hopium",
    rarity: "Mythic",
    kind: "Food",
    icon: "hopium",
    trigger: ["use"],
    effects: [
      { op: "happyThoughts", value: 1, polarity: "add", restoreHappyThoughts: true },
      { op: "happyThoughts", value: 4, polarity: "add", durationS: 4 },
      { op: "happyThoughts", value: 600, polarity: "add", healDelta: 600 },
    ],
    source: "s6",
  },
  {
    id: "beltBuster",
    name: "Belt Buster",
    nameRu: "Belt Buster",
    rarity: "Mythic",
    kind: "Food",
    icon: "beltBuster",
    trigger: ["use"],
    effects: [{ op: "extraSlot", value: 1, polarity: "add", extraSlot: 1 }],
    source: "s6",
  },
];

// ===========================================================================
// Lookup helpers
// ===========================================================================

const ITEM_BY_ID: Map<string, HorrorItem> = new Map(HORROR_ITEMS.map((it) => [it.id, it]));

/** Resolve an id (canonical or alias) to a catalogue entry. */
export function getHorrorItem(id: string): HorrorItem | undefined {
  const canonical = HORROR_ITEM_ALIASES[id] ?? id;
  return ITEM_BY_ID.get(canonical);
}

/** All items of a given rarity. */
export function horrorItemsByRarity(rarity: HorrorRarity): HorrorItem[] {
  return HORROR_ITEMS.filter((it) => it.rarity === rarity);
}
