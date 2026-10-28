// HorrorGuessr — client-side view of a run projection (P5/P6).
//
// Mirrors the safe projection returned by /api/horror/run and /api/horror/act.
// Kept here (not in src/shared) because the projection is an API contract, not a
// domain type — the server never sends the full HorrorRun.

export interface HorrorRunView {
  runId: string;
  difficulty: string;
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
  monster: { distance: number; paceMs: number; strideBonusM: number; graceUntil: number };
  boss: {
    id: string;
    name: { ru: string; en: string };
    mechanic: string;
    health: number;
    maxHealth: number;
    responseMs: [number, number];
    duelTimerMs: number;
    phase: number;
    debuffs: Array<{ kind: string; until: number | null; value?: number }>;
  } | null;
  /** The live duel, when the day is a boss day (§5.1). */
  duel: {
    round: number;
    roundsWon: number;
    roundsLost: number;
    hexes: Array<{ kind: string; until: number | null; value?: number }>;
    screamUntil: number;
    laser: { x: number; y: number } | null;
    rewardGranted: boolean;
    finalReward: string | null;
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
  /** The day's shop shelf; empty until the merchant is opened. */
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