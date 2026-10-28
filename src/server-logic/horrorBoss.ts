// HorrorGuessr — bosses and the duel model (§5.1–§5.4, §8 P8).
//
// This module owns everything boss-shaped that the run engine deliberately left
// out: the 13-boss roster, the **duel resolver** (a score comparison, not a
// damage race — §5.1), the reward odds roll (§5.4), the final-boss pick-one-of-
// three, and the four interactive minigames the roster's mechanics dispatch to
// (Meep Moorp's laser lock, the Clown's cream-pie wipe, the Banshee's scream
// penalty, the Witch's hexes).
//
// Three rules from the plan shape the whole design:
//
// 1. **A boss day is a score comparison** (§5.1). The loser loses the *exact*
//    score delta as health. There is no damage pool to drain; `resolveDuel` is
//    the whole model, and it is pure.
// 2. **Rank is a function of day, not of the boss** (§1.2, C16). The Clown is a
//    *perennial* drawn on every rolled boss day at whatever rank that day
//    carries; day 30 belongs to a separate final boss whose rewards are chosen.
// 3. **Rewards are rolled, never Common** (§5.4), and are idempotent per
//    `(runId, bossId, day)`. The final boss rolls nothing.
//
// All randomness derives from `run.seed` (§7.4), so a duel is reproducible and a
// disconnect cannot reroll a Mythic.

import type { LatLng } from "../shared/types";
import type {
  BossDebuff,
  BossRewardRoll,
  HorrorBossDefinition,
  HorrorBossMechanic,
  HorrorBossRank,
  HorrorBossState,
  HorrorDifficulty,
  HorrorDuelRoundResult,
  HorrorDuelState,
  HorrorFinalBossReward,
  HorrorRewardOdds,
  HorrorRun,
  HorrorRarity,
} from "../shared/horrorTypes";
import {
  HORROR_BOSS_HP_BY_RANK,
  HORROR_BOSS_RESPONSE_S,
  HORROR_BOSS_SCORE,
  HORROR_DUEL_TIMER_MS,
  HORROR_FINAL_BOSS_DAY,
  HORROR_FINAL_BOSS_REWARDS,
  HORROR_ITEMS,
  HORROR_RARITY_ECONOMY,
  getHorrorItem,
} from "../shared/horrorCatalogue";
import { bossRewardOdds, rankForDay } from "../shared/horrorScoring";
import { haversineKm } from "../shared/scoring";
import { applyDamageToPlayer, horrorRngFor } from "./horrorEngine";
import { addItemToRun, grantGold } from "./horrorItems";
import { getRandomLocation } from "./locations";

// ---------------------------------------------------------------------------
// The roster (§5.2) — a pool of mechanics keyed by rank
// ---------------------------------------------------------------------------

/**
 * The shared per-round score distribution (S10 p.18): usually 1300–2300, a 10%
 * chance of a blunder in 0–1000, average 1670. Declared as a typed constant so
 * every roster entry shares one literal with the tuple types the interface wants.
 */
const BOSS_SCORE: HorrorBossDefinition["score"] = {
  typical: [HORROR_BOSS_SCORE.typical[0], HORROR_BOSS_SCORE.typical[1]],
  blunderChance: HORROR_BOSS_SCORE.blunderChance,
  blunder: [HORROR_BOSS_SCORE.blunder[0], HORROR_BOSS_SCORE.blunder[1]],
  average: HORROR_BOSS_SCORE.average,
};

/**
 * The 13 named bosses of §5.2. S7's day assignments are **not** reliable (C16),
 * so this is a *pool of mechanics* rather than a fixed one-boss-per-day
 * calendar: the engine draws a boss for a rolled day, and the day's rank decides
 * its HP. `drawnOn` is advisory (which days a boss is thematically tied to) and
 * is only consulted by `bossForDay` as a preference, never as a hard gate.
 */
export const HORROR_BOSSES: HorrorBossDefinition[] = [
  {
    id: "draculaanbaatar",
    name: { ru: "Граф Дракулаанбаатар", en: "Count Draculaanbaatar" },
    mechanic: "lifesteal",
    rank: "Hangout",
    drawnOn: [5],
    hp: null,
    responseS: [30, 50],
    score: BOSS_SCORE,
    lifesteal: true,
  },
  {
    id: "witch",
    name: { ru: "Ведьма", en: "The Witch" },
    mechanic: "hexes",
    rank: "Hangout",
    drawnOn: [10],
    hp: null,
    responseS: [30, 50],
    score: BOSS_SCORE,
  },
  {
    id: "meepMoorp",
    name: { ru: "Мип Мурп", en: "Meep Moorp the Alien" },
    mechanic: "laserLock",
    rank: "Prospect",
    drawnOn: [15],
    hp: null,
    responseS: [30, 50],
    score: BOSS_SCORE,
  },
  {
    id: "banshee",
    name: { ru: "Баньши", en: "The Banshee" },
    mechanic: "screamPenalty",
    rank: "Prospect",
    drawnOn: [20],
    hp: null,
    responseS: [30, 50],
    score: BOSS_SCORE,
  },
  {
    id: "mummy",
    name: { ru: "Мумия", en: "The Mummy" },
    mechanic: "timeDrain",
    rank: "Commander",
    drawnOn: [25],
    hp: null,
    responseS: [30, 50],
    score: BOSS_SCORE,
  },
  {
    id: "clown",
    name: { ru: "Клоун", en: "The Clown" },
    mechanic: "rngChaos",
    // The Clown escalates with the day, so its rank is day-derived (C16).
    rank: null,
    drawnOn: [5, 10, 15, 20, 25],
    hp: null,
    responseS: [30, 50],
    score: BOSS_SCORE,
  },
  {
    id: "finalBoss",
    name: { ru: "Финальный босс", en: "The Final Boss" },
    mechanic: "chosenRewards",
    rank: "Senior Associate Manager of the Primordial Darkness",
    drawnOn: [HORROR_FINAL_BOSS_DAY],
    hp: null,
    responseS: [30, 50],
    score: BOSS_SCORE,
    final: true,
  },
  // ── Endless bosses (days 35–100+) ──
  {
    id: "blackPano",
    name: { ru: "Чёрное Пано", en: "The Black Pano" },
    mechanic: "shortAttack",
    rank: null,
    drawnOn: [],
    hp: null,
    responseS: [30, 50],
    score: BOSS_SCORE,
    damageMultiplier: 2.5,
  },
  {
    id: "shadowDracula",
    name: { ru: "Тень Дракулаанбаатара", en: "Shadow Dracula" },
    mechanic: "shadowVampirism",
    rank: null,
    drawnOn: [],
    hp: null,
    responseS: [30, 50],
    score: BOSS_SCORE,
    lifesteal: true,
  },
  {
    id: "voidWitch",
    name: { ru: "Ведьма Пустоты", en: "Void Witch" },
    mechanic: "stackedHexes",
    rank: null,
    drawnOn: [],
    hp: null,
    responseS: [30, 50],
    score: BOSS_SCORE,
  },
  {
    id: "meepMoorpOverdrive",
    name: { ru: "Мип Мурп: Перегрузка", en: "Meep Moorp Overdrive" },
    mechanic: "laserOverdrive",
    rank: null,
    drawnOn: [],
    hp: null,
    responseS: [30, 50],
    score: BOSS_SCORE,
  },
  {
    id: "echoBanshee",
    name: { ru: "Эхо Баньши", en: "Echo Banshee" },
    mechanic: "echoScream",
    rank: null,
    drawnOn: [],
    hp: null,
    responseS: [30, 50],
    score: BOSS_SCORE,
  },
  {
    id: "decayedMummy",
    name: { ru: "Истлевшая Мумия", en: "Decayed Mummy" },
    mechanic: "decayedTime",
    rank: null,
    drawnOn: [],
    hp: null,
    responseS: [30, 50],
    score: BOSS_SCORE,
  },
  {
    id: "archClown",
    name: { ru: "Абсолютный Кошмар", en: "The Arch-Clown" },
    mechanic: "archClown",
    rank: null,
    drawnOn: [],
    hp: null,
    responseS: [30, 50],
    score: BOSS_SCORE,
  },
];

const BOSS_BY_ID: Map<string, HorrorBossDefinition> = new Map(
  HORROR_BOSSES.map((boss) => [boss.id, boss]),
);

export function getHorrorBoss(id: string): HorrorBossDefinition | undefined {
  return BOSS_BY_ID.get(id);
}

/** The Clown is the perennial drawn on every rolled boss day (C16). */
export const HORROR_PERENNIAL_BOSS_ID = "clown";

/**
 * Which boss a day draws.
 *
 * Day 30 is the finale. A rolled boss day (5/10/15/20/25) draws the Clown, the
 * perennial (C16). A post-campaign boss day (every 5th day after 30) draws from
 * the endless roster, seeded so a run is reproducible.
 */
export function bossForDay(run: HorrorRun, day: number): HorrorBossDefinition {
  if (day === HORROR_FINAL_BOSS_DAY) {
    return BOSS_BY_ID.get("finalBoss") as HorrorBossDefinition;
  }
  if (day <= HORROR_FINAL_BOSS_DAY) {
    return BOSS_BY_ID.get(HORROR_PERENNIAL_BOSS_ID) as HorrorBossDefinition;
  }
  // Endless: draw from the post-campaign roster, seeded.
  const endless = HORROR_BOSSES.filter((boss) => boss.drawnOn.length === 0 && !boss.final);
  if (endless.length === 0) return BOSS_BY_ID.get(HORROR_PERENNIAL_BOSS_ID) as HorrorBossDefinition;
  const rng = horrorRngFor(run);
  return endless[Math.floor(rng() * endless.length) % endless.length];
}

// ---------------------------------------------------------------------------
// Boss HP (§5.3)
// ---------------------------------------------------------------------------

/**
 * Boss HP by rank and difficulty.
 *
 * Only the `Hangout` row is [CODEX] (S10 p.18: 3500/4000/4800). The other three
 * are interpolated at +20% per rank and are tunable. A boss that carries its own
 * `hp` table (none do today) overrides the rank family.
 */
export function bossHealthFor(
  rank: HorrorBossRank,
  difficulty: HorrorDifficulty,
  boss?: HorrorBossDefinition,
): number {
  if (boss?.hp) return boss.hp[difficulty];
  return HORROR_BOSS_HP_BY_RANK[rank][difficulty];
}

/** Build the live `HorrorBossState` for a day. */
export function createBossStateFor(
  run: HorrorRun,
  day: number,
  difficulty: HorrorDifficulty,
): HorrorBossState {
  const boss = bossForDay(run, day);
  const rank = boss.rank ?? rankForDay(day);
  const hp = bossHealthFor(rank, difficulty, boss);
  return {
    id: boss.id,
    name: boss.name,
    mechanic: boss.mechanic,
    health: hp,
    maxHealth: hp,
    responseMs: [boss.responseS[0] * 1000, boss.responseS[1] * 1000],
    duelTimerMs: HORROR_DUEL_TIMER_MS,
    phase: 1,
    debuffs: [],
    playerLockedAt: null,
    bossLockedAt: null,
    bossAnswer: null,
  };
}

// ---------------------------------------------------------------------------
// The duel resolver (§5.1) — a score comparison, not a damage race
// ---------------------------------------------------------------------------

/**
 * Resolve one duel round.
 *
 * The loser loses the **exact** score delta as health (§5.1). A tie is a player
 * win with zero delta — the boss does not out-score the player, so it takes no
 * damage and deals none. Vampirism (`lifesteal`) heals the boss by the damage it
 * deals, capped at its max health.
 *
 * `damageMultiplier` (Black Pano) scales the damage the player takes, and is
 * applied to the delta before the boss's own health is touched — the boss's
 * offence is harsher, not its defence.
 */
export function resolveDuel(
  playerScore: number,
  bossScore: number,
  boss: HorrorBossState,
  options?: { lifesteal?: boolean; damageMultiplier?: number; playerDamageBonus?: number },
): HorrorDuelRoundResult {
  const delta = Math.abs(playerScore - bossScore);
  const playerWon = playerScore >= bossScore;

  if (playerWon) {
    // `bossDamage` items (`Sausage +100`, `Scythe +50%`) add to the damage dealt
    // (§3.2). The bonus is applied to the delta, never to the comparison.
    const damageToBoss = delta + Math.max(0, options?.playerDamageBonus ?? 0);
    boss.health = Math.max(0, boss.health - damageToBoss);
    return {
      playerScore,
      bossScore,
      delta,
      playerWon: true,
      damageToBoss,
      damageToPlayer: 0,
      lifesteal: 0,
      bossDefeated: boss.health <= 0,
      playerDefeated: false,
      bossAnswer: boss.bossAnswer,
    };
  }

  const multiplier = options?.damageMultiplier ?? 1;
  const damageToPlayer = Math.round(delta * multiplier);
  let lifesteal = 0;
  if (options?.lifesteal) {
    lifesteal = Math.min(damageToPlayer, boss.maxHealth - boss.health);
    boss.health = Math.min(boss.maxHealth, boss.health + lifesteal);
  }

  return {
    playerScore,
    bossScore,
    delta,
    playerWon: false,
    damageToBoss: 0,
    damageToPlayer,
    lifesteal,
    bossDefeated: false,
    playerDefeated: false,
    bossAnswer: boss.bossAnswer,
  };
}

// ---------------------------------------------------------------------------
// The boss's own answer (§5.3)
// ---------------------------------------------------------------------------

/**
 * Roll the boss's score for a round.
 *
 * The Codex gives the Clown's distribution (S10 p.18): usually 1300–2300, with a
 * 10% chance of a blunder in 0–1000. The boss's *answer* is a coordinate, but
 * only its score is ever compared, so the answer is derived from the score by
 * inverting the 926 km curve at a seeded bearing — which keeps the reveal
 * plausible without ever exposing the true location.
 */
export function rollBossScore(
  run: HorrorRun,
  score: HorrorBossDefinition["score"],
): number {
  const rng = horrorRngFor(run);
  const { typical, blunderChance, blunder } = score;
  if (rng() < blunderChance) {
    return Math.round(blunder[0] + rng() * (blunder[1] - blunder[0]));
  }
  return Math.round(typical[0] + rng() * (typical[1] - typical[0]));
}

/**
 * A plausible coordinate for a boss score, seeded. The score is inverted through
 * the 926 km curve to a distance, then placed on a seeded bearing from the true
 * location. Server-only until the round resolves (§7.3).
 */
export function bossAnswerFor(
  run: HorrorRun,
  score: number,
  target: LatLng,
): LatLng {
  const rng = horrorRngFor(run);
  const clamped = Math.max(1, Math.min(4999, score));
  // score = 5000 · 2^(−d/926)  ⇒  d = 926 · log2(5000 / score)
  const distanceKm = 926 * Math.log2(5000 / clamped);
  const bearing = rng() * Math.PI * 2;
  const kmPerDegLat = 111.32;
  const dLat = (distanceKm * Math.cos(bearing)) / kmPerDegLat;
  const cosLat = Math.max(0.01, Math.cos((target.lat * Math.PI) / 180));
  const dLng = (distanceKm * Math.sin(bearing)) / (kmPerDegLat * cosLat);
  return {
    lat: Math.max(-85, Math.min(85, target.lat + dLat)),
    lng: ((target.lng + dLng + 540) % 360) - 180,
  };
}

/**
 * A deterministic unit value from the run seed and a salt, **without consuming
 * the shared RNG stream**. The duel needs a stable "true location" for the day
 * that does not desync the seeded offer/answer stream, so it hashes instead of
 * drawing.
 */
function seededUnit(seed: number, salt: number): number {
  let t = (seed ^ Math.imul(salt, 0x9e3779b9)) >>> 0;
  t = Math.imul(t ^ (t >>> 15), t | 1);
  t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
  return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
}

/**
 * The day's true location.
 *
 * Picked server-side from the same map pool solo mode uses (`/maps`), so the
 * horror mode shows real, road-valid panoramas instead of sampling Street View
 * from a fixed city list. Chosen once per day; the coordinates never leave the
 * server (the projection only carries the panorama id).
 */
export function ensureDayTarget(run: HorrorRun): void {
  if (run.dayTarget?.panoId && run.dayTargetDay === run.day) return;
  run.dayTarget = getRandomLocation("global");
  run.dayTargetDay = run.day;
}

export function dayTargetFor(run: HorrorRun): LatLng {
  if (run.dayTarget && run.dayTargetDay === run.day) return run.dayTarget;
  return {
    lat: seededUnit(run.seed, run.day * 2 + 1) * 140 - 70,
    lng: seededUnit(run.seed, run.day * 2 + 2) * 360 - 180,
  };
}

/** The player's score for a guess, against the day's seeded target. */
export function playerScoreForGuess(run: HorrorRun, guess: LatLng): number {
  const target = dayTargetFor(run);
  const distanceKm = haversineKm(guess, target);
  if (distanceKm * 1000 <= 25) return 5000;
  return Math.round(5000 * Math.pow(2, -distanceKm / 926));
}

/**
 * The flat + percentage boss-damage bonus from the equipped inventory (§3.2).
 *
 * `bossDamage` items (`Sausage +100`, `Horns +600`, `Leviathan Steak +1000`) sum
 * as absolutes; `bossDamageMultiplier` (`Scythe +50%`) resolves last, against the
 * summed absolute (§3.4 rule 6). Derived from the inventory, never accumulated,
 * so destroying a copy reverts its bonus (§3.3).
 */
export function bossDamageBonus(run: HorrorRun): number {
  let flat = 0;
  let multiplier = 1;
  for (const slot of run.equipment) {
    if (slot === null) continue;
    const item = getHorrorItem(slot);
    if (!item) continue;
    for (const effect of item.effects) {
      if (effect.op === "bossDamage") flat += effect.bossDamage ?? effect.value;
      if (effect.op === "bossDamageMultiplier") {
        multiplier += effect.bossDamageMultiplier ?? effect.value;
      }
    }
  }
  return Math.round(flat * multiplier);
}

// ---------------------------------------------------------------------------
// Duel state (§5.1) — kept beside the run, like the RNG and the item ledger
// ---------------------------------------------------------------------------

const g = globalThis as unknown as {
  __horrorDuels?: WeakMap<HorrorRun, HorrorDuelState>;
};
const duels = (g.__horrorDuels ??= new WeakMap<HorrorRun, HorrorDuelState>());

/** The live duel for a run, or undefined when the day is not a boss day. */
export function getDuel(run: HorrorRun): HorrorDuelState | undefined {
  return duels.get(run);
}

/**
 * Open (or re-open) the duel for the run's current boss day.
 *
 * Idempotent per `(runId, day)`: reconnecting must not reroll the boss's answer
 * or reset its health, so a live duel for the same day is returned as-is.
 */
export function openDuel(run: HorrorRun): HorrorDuelState | null {
  if (!run.boss) return null;
  // Post-campaign days draw from the endless roster, which the engine does not
  // know about (it only builds the Clown / finale). Re-derive the boss here so
  // the roster stays authoritative for days 35+.
  if (run.day > HORROR_FINAL_BOSS_DAY) {
    run.boss = createBossStateFor(run, run.day, run.difficulty);
  }
  const existing = duels.get(run);
  if (existing && existing.day === run.day && existing.bossId === run.boss.id) {
    return existing;
  }
  const duel: HorrorDuelState = {
    bossId: run.boss.id,
    day: run.day,
    round: 1,
    playerScore: null,
    bossScore: null,
    playerLockedAt: null,
    bossLockedAt: null,
    bossAnswer: null,
    hexes: [],
    laser: null,
    screamUntil: 0,
    roundsWon: 0,
    roundsLost: 0,
    rewardGranted: false,
    finalReward: null,
  };
  duels.set(run, duel);
  return duel;
}

/** Clear the duel (day boundary / run over). */
export function closeDuel(run: HorrorRun): void {
  duels.delete(run);
}

// ---------------------------------------------------------------------------
// Hexes (§5.2, §5.3) — the Witch's view transforms
// ---------------------------------------------------------------------------

/** The three hexes the Witch can cast, verbatim from S7. */
export const HORROR_HEXES = ["mirrorPano", "shrinkMap", "upsideDown"] as const;
export type HorrorHex = (typeof HORROR_HEXES)[number];

/**
 * Cast a hex 3–5 s into the round (§5.2). `stackedHexes` (Void Witch) casts two
 * at once — "inverted screen **and** tiny map simultaneously". `spellLock` rides
 * on `shrinkMap`, which is the hex that "blocks your spells".
 */
export function castHexes(
  run: HorrorRun,
  duel: HorrorDuelState,
  mechanic: HorrorBossMechanic,
  now: number,
): BossDebuff[] {
  const rng = horrorRngFor(run);
  const count = mechanic === "stackedHexes" ? 2 : 1;
  const pool = [...HORROR_HEXES];
  const cast: BossDebuff[] = [];
  for (let i = 0; i < count && pool.length > 0; i++) {
    const index = Math.floor(rng() * pool.length) % pool.length;
    const [hex] = pool.splice(index, 1);
    const until = now + 5000 + Math.round(rng() * 5000);
    cast.push({ kind: hex, until });
    if (hex === "shrinkMap") cast.push({ kind: "spellLock", until });
  }
  duel.hexes = cast;
  return cast;
}

/** Clear every active hex (`hexClear` action). */
export function clearHexes(duel: HorrorDuelState): number {
  const cleared = duel.hexes.length;
  duel.hexes = [];
  return cleared;
}

// ---------------------------------------------------------------------------
// The Banshee's scream (§5.2)
// ---------------------------------------------------------------------------

/**
 * Open a scream window. Any input during it costs instant damage ("You moved!").
 * `echoScream` (Echo Banshee) screams longer and leaves shorter safe windows.
 */
export function openScream(
  run: HorrorRun,
  duel: HorrorDuelState,
  mechanic: HorrorBossMechanic,
  now: number,
): number {
  const rng = horrorRngFor(run);
  const base = mechanic === "echoScream" ? 4000 : 2500;
  const spread = mechanic === "echoScream" ? 3000 : 1500;
  const duration = base + Math.round(rng() * spread);
  duel.screamUntil = now + duration;
  return duration;
}

/** True while a scream is active. */
export function isScreaming(duel: HorrorDuelState, now: number): boolean {
  return now < duel.screamUntil;
}

// ---------------------------------------------------------------------------
// Meep Moorp's laser lock (§5.2)
// ---------------------------------------------------------------------------

/**
 * The laser minigame's difficulty. `laserOverdrive` doubles the scan speed and
 * finds a perfect 5K much faster.
 */
export function laserConfig(mechanic: HorrorBossMechanic): {
  scanSpeed: number;
  perfectChancePerSecond: number;
} {
  if (mechanic === "laserOverdrive") {
    return { scanSpeed: 2, perfectChancePerSecond: 0.2 };
  }
  return { scanSpeed: 1, perfectChancePerSecond: 0.1 };
}

/**
 * Record a laser lock. The lock is a normalised `(x, y)` in 0..1; the closer to
 * the true country the higher the resulting score. The score is derived from the
 * lock's distance to a seeded target point, so the minigame is deterministic.
 */
export function resolveLaserLock(
  run: HorrorRun,
  duel: HorrorDuelState,
  x: number,
  y: number,
): { score: number; x: number; y: number } {
  const rng = horrorRngFor(run);
  // A seeded target in the unit square; the lock's accuracy is its proximity.
  const targetX = rng();
  const targetY = rng();
  const dx = x - targetX;
  const dy = y - targetY;
  const distance = Math.sqrt(dx * dx + dy * dy); // 0..~1.41
  const accuracy = Math.max(0, 1 - distance / 0.5);
  const score = Math.round(accuracy * 5000);
  duel.laser = { x, y };
  duel.playerLockedAt = Date.now();
  return { score, x, y };
}

// ---------------------------------------------------------------------------
// The Clown's cream-pie wipe (§5.3)
// ---------------------------------------------------------------------------

/**
 * The wipe layer is cosmetic and rate-limited (§7.3): the server only
 * acknowledges it, but it clamps the amount so a client cannot claim to have
 * wiped more than the layer holds. The splat layout itself is seeded client-side
 * from the run seed (§5.3: "Splat placement is seeded for reproducibility").
 */
export function clampWipeAmount(amount: number): number {
  if (!Number.isFinite(amount)) return 0;
  return Math.max(0, Math.min(100, Math.round(amount)));
}

// ---------------------------------------------------------------------------
// Rewards (§5.4)
// ---------------------------------------------------------------------------

/** Rank as a 1-based index, for `Wanted Poster`'s `+2 gold per rank`. */
export function bossRankIndex(rank: HorrorBossRank): number {
  const order: HorrorBossRank[] = [
    "Hangout",
    "Prospect",
    "Commander",
    "Senior Associate Manager of the Primordial Darkness",
  ];
  return Math.max(1, order.indexOf(rank) + 1);
}

/** Pick a rarity from the odds, seeded. Never Common. */
function rollRarityFromOdds(odds: HorrorRewardOdds, rng: () => number): Exclude<HorrorRarity, "Common"> {
  const roll = rng() * 100;
  if (roll < odds.mythic) return "Mythic";
  if (roll < odds.mythic + odds.rare) return "Rare";
  return "Uncommon";
}

/** Item ids of a rarity that are legal boss rewards (never Common). */
function rewardPool(rarity: Exclude<HorrorRarity, "Common">, kind?: "Equipment" | "Food"): string[] {
  const pool: string[] = [];
  for (const item of HORROR_ITEMS) {
    if (item.rarity !== rarity) continue;
    if (kind !== undefined && item.kind !== kind) continue;
    pool.push(item.id);
  }
  return pool;
}

/**
 * Roll a boss reward: one equipment and three foods, each rolled on its own
 * (§5.4 rule 1: "Equipment rolls once; each food rolls on its own"). Never
 * Common. Seeded from the run so a disconnect cannot reroll a Mythic.
 */
export function rollBossReward(run: HorrorRun, day: number, rank: HorrorBossRank): BossRewardRoll {
  const rng = horrorRngFor(run);
  const odds = bossRewardOdds(day, rank);

  const equipmentRarity = rollRarityFromOdds(odds, rng);
  const equipmentPool = rewardPool(equipmentRarity, "Equipment");
  const equipmentId =
    equipmentPool.length > 0
      ? equipmentPool[Math.floor(rng() * equipmentPool.length) % equipmentPool.length]
      : "garlicPendant";

  const foods: { rarity: Exclude<HorrorRarity, "Common"> }[] = [];
  for (let i = 0; i < 3; i++) {
    const rarity = rollRarityFromOdds(odds, rng);
    foods.push({ rarity });
  }

  return {
    equipment: { rarity: equipmentRarity },
    foods,
  };
}

export interface BossRewardGrant {
  /** Item ids actually added to the run. */
  granted: string[];
  /** Gold paid by `Wanted Poster` (post-roll, §5.4). */
  gold: number;
  /** The rolled equipment rarity. */
  equipmentRarity: Exclude<HorrorRarity, "Common">;
  /** The rolled food rarities. */
  foodRarities: Exclude<HorrorRarity, "Common">[];
}

/**
 * Grant a boss reward, idempotently per `(runId, bossId, day)`.
 *
 * The roll is `rollBossReward`; the grant adds the equipment and three foods to
 * the run. `Wanted Poster`'s `+2 gold per rank` is a **post-roll** addition
 * (§5.4), applied here so it stays idempotent with the rest of the reward.
 */
export function grantBossReward(
  run: HorrorRun,
  duel: HorrorDuelState,
  day: number,
  rank: HorrorBossRank,
): BossRewardGrant {
  if (duel.rewardGranted) {
    return { granted: [], gold: 0, equipmentRarity: "Uncommon", foodRarities: [] };
  }
  duel.rewardGranted = true;

  const rng = horrorRngFor(run);
  const roll = rollBossReward(run, day, rank);
  const granted: string[] = [];

  const equipmentPool = rewardPool(roll.equipment.rarity, "Equipment");
  if (equipmentPool.length > 0) {
    const id = equipmentPool[Math.floor(rng() * equipmentPool.length) % equipmentPool.length];
    addItemToRun(run, id);
    granted.push(id);
  }

  const foodRarities: Exclude<HorrorRarity, "Common">[] = [];
  for (const food of roll.foods) {
    foodRarities.push(food.rarity);
    const pool = rewardPool(food.rarity, "Food");
    if (pool.length === 0) continue;
    const id = pool[Math.floor(rng() * pool.length) % pool.length];
    addItemToRun(run, id);
    granted.push(id);
  }

  // `Wanted Poster`: +2 gold per boss rank, post-roll (§5.4).
  const wantedPoster = run.equipment.some((slot) => slot === "wantedPoster");
  const gold = wantedPoster ? grantGold(run, 2 * bossRankIndex(rank)) : 0;

  return {
    granted,
    gold,
    equipmentRarity: roll.equipment.rarity,
    foodRarities,
  };
}

// ---------------------------------------------------------------------------
// The final boss's chosen reward (§5.4)
// ---------------------------------------------------------------------------

export interface FinalBossRewardGrant {
  choice: HorrorFinalBossReward;
  /** Item ids granted (mythicEquipment / fiveRareFoods). */
  granted: string[];
  /** Health restored (fullHeal). */
  healed: number;
}

/**
 * Grant the day-30 finale's pick-one-of-three (§5.4). The reward is **chosen**,
 * not rolled, and is irreversible — the UI must show the trade-off before
 * committing. Idempotent per duel.
 */
export function grantFinalBossReward(
  run: HorrorRun,
  duel: HorrorDuelState,
  choice: HorrorFinalBossReward,
): FinalBossRewardGrant {
  if (duel.finalReward !== null) {
    return { choice: duel.finalReward, granted: [], healed: 0 };
  }
  duel.finalReward = choice;

  const rng = horrorRngFor(run);
  const granted: string[] = [];
  let healed = 0;

  if (choice === "fullHeal") {
    healed = run.maxHealth - run.health;
    run.health = run.maxHealth;
  } else if (choice === "mythicEquipment") {
    const pool = rewardPool("Mythic", "Equipment");
    if (pool.length > 0) {
      const id = pool[Math.floor(rng() * pool.length) % pool.length];
      addItemToRun(run, id);
      granted.push(id);
    }
  } else if (choice === "fiveRareFoods") {
    const pool = rewardPool("Rare", "Food");
    for (let i = 0; i < 5 && pool.length > 0; i++) {
      const id = pool[Math.floor(rng() * pool.length) % pool.length];
      addItemToRun(run, id);
      granted.push(id);
    }
  }

  return { choice, granted, healed };
}

/** The three final-boss options, for the UI. */
export function finalBossRewardOptions(): readonly HorrorFinalBossReward[] {
  return HORROR_FINAL_BOSS_REWARDS;
}

// ---------------------------------------------------------------------------
// One duel round, end to end (§5.1)
// ---------------------------------------------------------------------------

export interface BossRoundOutcome extends HorrorDuelRoundResult {
  /** Health the player actually lost (after equipment reduction). */
  playerDamageApplied: number;
  /** True when the player's health reached 0. */
  playerDead: boolean;
  /** The boss's mechanic, for the client minigame. */
  mechanic: HorrorBossMechanic;
  /** The duel round number this resolved. */
  round: number;
}

/**
 * Resolve one duel round from the player's score.
 *
 * The boss's score is rolled from its distribution (§5.3), its answer is derived
 * from that score (§7.3: server-only until reveal), and `resolveDuel` compares
 * the two. Damage to the player goes through the engine's `applyDamageToPlayer`
 * so `Trash Lid` / `Leather Coat` reductions and the `healthFloor` save all
 * apply exactly as they do on a Chase day.
 */
export function resolveBossRound(
  run: HorrorRun,
  duel: HorrorDuelState,
  playerScore: number,
): BossRoundOutcome {
  const boss = run.boss;
  if (!boss) {
    throw new Error("resolveBossRound called on a non-boss day");
  }
  const definition = getHorrorBoss(boss.id);
  const target = dayTargetFor(run);

  // Every day-1..30 boss is in the roster, so `definition` is present; the score
  // distribution is read off it and falls back to the shared one only for a
  // hand-built boss state (e.g. a test fixture).
  const bossScore = rollBossScore(run, definition?.score ?? BOSS_SCORE);
  boss.bossAnswer = bossAnswerFor(run, bossScore, target);
  duel.bossScore = bossScore;
  duel.playerScore = playerScore;
  duel.bossLockedAt = Date.now();

  const result = resolveDuel(playerScore, bossScore, boss, {
    lifesteal: definition?.lifesteal ?? false,
    damageMultiplier: definition?.damageMultiplier ?? 1,
    playerDamageBonus: bossDamageBonus(run),
  });

  let playerDamageApplied = 0;
  let playerDead = false;
  if (result.damageToPlayer > 0) {
    const applied = applyDamageToPlayer(run, result.damageToPlayer, "boss");
    playerDamageApplied = applied.applied;
    playerDead = applied.dead;
  }

  if (result.playerWon) duel.roundsWon += 1;
  else duel.roundsLost += 1;
  duel.round += 1;

  return {
    ...result,
    playerDamageApplied,
    playerDead,
    mechanic: boss.mechanic,
    round: duel.round - 1,
  };
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** The economy entry for a rarity, for the reward UI. */
export function rewardRarityEconomy(rarity: HorrorRarity) {
  return HORROR_RARITY_ECONOMY[rarity];
}

/** Resolve a boss id to its definition, or undefined. */
export function bossDefinition(id: string): HorrorBossDefinition | undefined {
  return getHorrorBoss(id);
}

/** The item name for a reward id, for the UI. */
export function rewardItemName(id: string): string {
  return getHorrorItem(id)?.name ?? id;
}

/** The default response window, in ms, for a boss with no override. */
export function defaultResponseMs(): [number, number] {
  return [HORROR_BOSS_RESPONSE_S[0] * 1000, HORROR_BOSS_RESPONSE_S[1] * 1000];
}
