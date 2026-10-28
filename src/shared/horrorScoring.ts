// HorrorGuessr — shared scoring and pacing math.
//
// Ported from `plans/horrorguessr-master-plan.md` (revision 4). Every formula
// here is reproduced by arithmetic from a Codex page (§0.3, §0.5, §1.5) and is
// asserted by the P1 unit tests (§8).
//
// This module is pure: no I/O, no randomness, no mutation. It is imported by
// both the server engine and the client HUD.

import type {
  HorrorBossRank,
  HorrorDay,
  HorrorDayModifier,
  HorrorDayType,
  HorrorDifficulty,
  HorrorRewardOdds,
  HorrorRewardTable,
} from "./horrorTypes";
import {
  HORROR_BIG_COUNTRIES,
  HORROR_BOSS_DAYS,
  HORROR_DAMAGE_DIVISOR,
  HORROR_DAY_FLOOR_S,
  HORROR_FINAL_BOSS_DAY,
  HORROR_HALF_LIFE_KM,
  HORROR_HIT_GROWTH,
  HORROR_LIGHTS_OUT_DAYS,
  HORROR_MAX_POINTS,
  HORROR_PACE,
  HORROR_PACE_DAY_OFFSET,
  HORROR_REWARD_GROWTH_AFTER_30,
  HORROR_RINGS,
  HORROR_SHADOW_REALM_DAYS,
  HORROR_STEP_TIME_FLOOR_S,
  HORROR_STRIDE_GROWTH_STEPS,
  HORROR_THRESHOLD,
  HORROR_EXTRA_DAY_MODIFIERS,
} from "./horrorCatalogue";

// ---------------------------------------------------------------------------
// Score curve (§0.3)
// ---------------------------------------------------------------------------

/**
 * score(d) = round(5000 · 2^(−d / 926)), d in km.
 *
 * This is the normative formula from §0.3, using the stated constant
 * `HORROR_HALF_LIFE_KM = 926` and `Math.round`.
 *
 * Note on the S1 witness: the plan's proof table prints `3117` for
 * `d = 631.630 km`, but the exact value is `5000 · 2^(−631.63/926) = 3116.27`,
 * which rounds to **3116**. The plan's `3117` (and its `2366` for the 1000 km
 * HUD row) are only reproducible with a half-life of ≈926.7 or a `ceil` rule,
 * neither of which matches the stated constant or the `round` in the formula.
 * The formula and constant are treated as normative here; the ±1 boundary is
 * documented rather than fudged.
 */
export function computeHorrorScore(distanceKm: number): number {
  return Math.round(HORROR_MAX_POINTS * Math.pow(2, -distanceKm / HORROR_HALF_LIFE_KM));
}

/**
 * damage(s) = round((5000 − s) / divisor), divisor 3 (Normal/Hard), 2 (Nightmare).
 *
 * Proof: s = 3117 → round(1883 / 3) = 628 (Normal, S1 exact);
 *        s = 3117 → round(1883 / 2) = 942 (Nightmare).
 * A perfect 5000 heals to full instead of dealing damage (§1.3) — that branch is
 * handled by the engine, not here.
 */
export function computeHorrorDamage(score: number, difficulty: HorrorDifficulty): number {
  const divisor = HORROR_DAMAGE_DIVISOR[difficulty];
  return Math.round((HORROR_MAX_POINTS - score) / divisor);
}

/**
 * The cost of the next 100 km, i.e. how much score is lost by being 100 km
 * further away: score(d) − score(d + 100), using the rounded scores.
 *
 * Computed values: next100KmCost(0) = 5000 − 4639 = **361** (the "OFF BY 100 KM"
 * card prints −360); next100KmCost(1000) = 2365 − 2195 = **170** (the live HUD
 * "NEXT 100 KM −170", S10 p.22 — exact); next100KmCost(2000) = 1119 − 1038 =
 * **81** (S4 — exact).
 *
 * The `0` case is the same ±1 boundary as `computeHorrorScore`: the plan's `360`
 * is `floor(5000 − 5000·2^(−100/926)) = floor(360.60)`, while the rounded-score
 * difference is `361`. Two of the three card values reproduce exactly; the third
 * is off by one at the boundary. The formula is kept normative.
 */
export function next100KmCost(distanceKm: number): number {
  return computeHorrorScore(distanceKm) - computeHorrorScore(distanceKm + 100);
}

/** The ring ladder shown on the point-system page (S4). */
export function ringLadder(): readonly number[] {
  return HORROR_RINGS;
}

// ---------------------------------------------------------------------------
// Guess threshold (§1.2, §4.3, C15†)
// ---------------------------------------------------------------------------

/**
 * threshold(day) = min(cap, start + perDay · (day − 1)). Day 1 IS the stated
 * starting value, so the ramp begins on day 2.
 *
 * Proof: Normal day 1 = 1500, day 3 = 1540, day 151 = 4500 (cap);
 *        Nightmare day 30 = 3900 + 15·29 = 4335.
 *
 * Items are a separate, applied layer — never baked into this base ramp (§4.3).
 * `effectiveThreshold = thresholdForDay(day, d) + Σ(item.threshold mods)`.
 */
export function thresholdForDay(day: number, difficulty: HorrorDifficulty): number {
  const { start, perDay, cap } = HORROR_THRESHOLD[difficulty];
  return Math.min(cap, start + perDay * (day - 1));
}

/**
 * The circle, in metres. Big countries get a doubled half-life, which is exactly
 * the effect of "twice as wide" on a 926 km curve (§4.3).
 *
 * Computed: ringRadiusM(1290, "us") = 1852 · log2(5000 / 1290) · 1000 =
 * 3 619 840 m ≈ 3619.8 km. S1 observed threshold_distance = 3 621 567 m
 * (3621.6 km), a difference of ~1.7 km. The §10 acceptance criterion allows
 * `3621 km ± 2`, so this is within tolerance; the plan's "exact" label is
 * slightly optimistic but the rule (doubled half-life) is correct.
 */
export function ringRadiusM(scoreGate: number, countryCode: string): number {
  const halfLifeKm = HORROR_BIG_COUNTRIES.includes(countryCode)
    ? HORROR_HALF_LIFE_KM * 2 // 1852 km
    : HORROR_HALF_LIFE_KM; // 926 km
  return halfLifeKm * Math.log2(HORROR_MAX_POINTS / scoreGate) * 1000;
}

// ---------------------------------------------------------------------------
// Monster pace (§0.5, §1.4)
// ---------------------------------------------------------------------------

/**
 * The day-start pace, in ms.
 *
 * `start(day) = day1S − perDayS · (day − 1)`, floored at 0.85 s from
 * `floorFromDay`. `paceDayOffset` shifts the origin: 0 is the documented Codex
 * convention, 1 reproduces S1's 2230 ms on Normal day 3.
 *
 * Proof: Normal day 1 = 2500 ms, day 3 = 2320 ms, day 19 = 850 ms;
 *        with paceDayOffset 1, day 3 = 2230 ms (S1 exact);
 *        Nightmare day 3 = 1880 ms.
 */
export function startPaceMs(
  day: number,
  difficulty: HorrorDifficulty,
  paceDayOffset: number = HORROR_PACE_DAY_OFFSET,
): number {
  const { day1S, perDayS, floorFromDay } = HORROR_PACE[difficulty];
  if (day >= floorFromDay) return HORROR_DAY_FLOOR_S * 1000; // 0.85 s
  const seconds = day1S - perDayS * (day - 1 + paceDayOffset);
  return seconds * 1000;
}

/**
 * Pace for step k of the day. Grouped decay from the day's starting pace: the
 * pace holds for `intraEverySteps` steps, then drops by `intraDayS`, clamped at
 * the 0.3 s step-time floor (§0.5).
 */
export function paceAtStep(startS: number, k: number, difficulty: HorrorDifficulty): number {
  const { intraDayS, intraEverySteps } = HORROR_PACE[difficulty];
  const group = Math.floor((k - 1) / intraEverySteps);
  return Math.max(HORROR_STEP_TIME_FLOOR_S, startS - intraDayS * group);
}

/**
 * Steps needed between stride-growth grants, by day and difficulty (§1.4).
 * Returns the value for the highest `fromDay` at or below `day`.
 *
 * Proof: Normal returns 30 / 26 / 22 / 18 / 14 / 10 / 6 / 3 at the eight
 * campaign breakpoints (days 1, 31, 36, 41, 46, 51, 56, 61).
 */
export function strideGrowth(day: number, difficulty: HorrorDifficulty): number {
  let value = HORROR_STRIDE_GROWTH_STEPS[0][difficulty];
  for (const row of HORROR_STRIDE_GROWTH_STEPS) {
    if (day >= row.fromDay) value = row[difficulty];
  }
  return value;
}

// ---------------------------------------------------------------------------
// Damage growth (§0.5, §1.5)
// ---------------------------------------------------------------------------

/**
 * The compounding damage multiplier for the day. 1 before the growth start.
 *
 * Proof: Normal day 36 = 1.25 → 167 · 1.25 = 208.75 → 209;
 *        Nightmare day 21 = 1.15 → 250 · 1.15 = 287.5 → 288.
 */
export function damageGrowthFor(day: number, difficulty: HorrorDifficulty): number {
  const { fromDay, factor } = HORROR_HIT_GROWTH[difficulty];
  if (day < fromDay) return 1;
  return Math.pow(factor, day - fromDay + 1);
}

// ---------------------------------------------------------------------------
// Bosses (§1.2, §5.4)
// ---------------------------------------------------------------------------

/** Rank is a function of day, not of the individual boss (S10 p.19). */
export function rankForDay(day: number): HorrorBossRank {
  if (day <= 10) return "Hangout";
  if (day <= 20) return "Prospect";
  if (day <= 25) return "Commander";
  return "Senior Associate Manager of the Primordial Darkness";
}

/**
 * The §5.4 odds matrix. Each row is `[uncommon, rare, mythic]` and sums to 100.
 * Days are the five rolled boss days; other days interpolate linearly, and days
 * after 30 grow by +0.4% Mythic and +1.5% Rare per day (non-compounding).
 */
const REWARD_MATRIX: Record<HorrorBossRank, { day: number; uncommon: number; rare: number; mythic: number }[]> = {
  Hangout: [
    { day: 5, uncommon: 50.4, rare: 45.6, mythic: 4 },
    { day: 10, uncommon: 42.3, rare: 51.7, mythic: 6 },
    { day: 15, uncommon: 34.5, rare: 57.5, mythic: 8 },
    { day: 20, uncommon: 27, rare: 63, mythic: 10 },
    { day: 25, uncommon: 19.8, rare: 68.2, mythic: 12 },
  ],
  Prospect: [
    { day: 5, uncommon: 44.2, rare: 50.8, mythic: 5 },
    { day: 10, uncommon: 36.3, rare: 56.7, mythic: 7 },
    { day: 15, uncommon: 28.7, rare: 62.3, mythic: 9 },
    { day: 20, uncommon: 21.4, rare: 67.6, mythic: 11 },
    { day: 25, uncommon: 14.4, rare: 72.6, mythic: 13 },
  ],
  Commander: [
    { day: 5, uncommon: 38.1, rare: 55.9, mythic: 6 },
    { day: 10, uncommon: 30.6, rare: 61.6, mythic: 8 },
    { day: 15, uncommon: 22.9, rare: 67, mythic: 10 },
    { day: 20, uncommon: 15.8, rare: 72.2, mythic: 12 },
    { day: 25, uncommon: 9.03, rare: 77, mythic: 14 },
  ],
  "Senior Associate Manager of the Primordial Darkness": [
    { day: 5, uncommon: 31.7, rare: 60.3, mythic: 8 },
    { day: 10, uncommon: 24.3, rare: 65.7, mythic: 10 },
    { day: 15, uncommon: 17.2, rare: 70.8, mythic: 12 },
    { day: 20, uncommon: 10.3, rare: 75.7, mythic: 14 },
    { day: 25, uncommon: 3.78, rare: 80.3, mythic: 16 },
  ],
};

/**
 * Boss reward odds for a day and rank. Never Common. Every row sums to 100 ± 0.1.
 */
export function bossRewardOdds(day: number, rank: HorrorBossRank): HorrorRewardOdds {
  const rows = REWARD_MATRIX[rank];
  const first = rows[0];
  const last = rows[rows.length - 1];

  let rare: number;
  let mythic: number;

  if (day <= first.day) {
    rare = first.rare;
    mythic = first.mythic;
  } else if (day >= last.day) {
    rare = last.rare;
    mythic = last.mythic;
  } else {
    let lo = first;
    let hi = last;
    for (let i = 0; i < rows.length - 1; i++) {
      if (day >= rows[i].day && day <= rows[i + 1].day) {
        lo = rows[i];
        hi = rows[i + 1];
        break;
      }
    }
    const t = (day - lo.day) / (hi.day - lo.day);
    rare = lo.rare + (hi.rare - lo.rare) * t;
    mythic = lo.mythic + (hi.mythic - lo.mythic) * t;
  }

  if (day > HORROR_FINAL_BOSS_DAY) {
    const extra = day - HORROR_FINAL_BOSS_DAY;
    mythic += HORROR_REWARD_GROWTH_AFTER_30.mythic * 100 * extra;
    rare += HORROR_REWARD_GROWTH_AFTER_30.rare * 100 * extra;
  }

  const uncommon = 100 - rare - mythic;
  return { uncommon, rare, mythic };
}

/** The reward table for a day, keyed by rank. */
export function rewardTableFor(day: number): HorrorRewardTable {
  return {
    byRank: {
      Hangout: bossRewardOdds(day, "Hangout"),
      Prospect: bossRewardOdds(day, "Prospect"),
      Commander: bossRewardOdds(day, "Commander"),
      "Senior Associate Manager of the Primordial Darkness": bossRewardOdds(
        day,
        "Senior Associate Manager of the Primordial Darkness",
      ),
    },
  };
}

// ---------------------------------------------------------------------------
// Day spec (§1.2)
// ---------------------------------------------------------------------------

function modifierForDay(index: number): HorrorDayModifier {
  if (HORROR_SHADOW_REALM_DAYS.includes(index)) return "shadowRealm";
  if (HORROR_LIGHTS_OUT_DAYS.includes(index)) return "lightsOut";
  if ((HORROR_EXTRA_DAY_MODIFIERS as readonly string[]).includes("darkPano")) {
    // [GAP] S6 proves the darkPano modifier exists (Beer Goggles bypasses it) but
    // not which days carry it. Empty until observed; Beer Goggles is a no-op.
  }
  return "none";
}

function typeForDay(index: number): HorrorDayType {
  if (index === HORROR_FINAL_BOSS_DAY) return "FinalBoss";
  if (HORROR_BOSS_DAYS.includes(index) || (index > HORROR_FINAL_BOSS_DAY && index % 5 === 0)) {
    return "Boss";
  }
  return "Chase";
}

/**
 * Build the full day spec from the Codex rules. Every field is computed, not
 * stored as an opaque constant.
 */
export function daySpec(
  index: number,
  difficulty: HorrorDifficulty,
  countryCode: string,
): HorrorDay {
  const type = typeForDay(index);
  const threshold = thresholdForDay(index, difficulty);
  return {
    index,
    type,
    modifier: modifierForDay(index),
    bossId: type === "Chase" ? null : "clown",
    bossRank: rankForDay(index),
    threshold,
    thresholdDistanceM: ringRadiusM(threshold, countryCode),
    monsterStartPaceMs: startPaceMs(index, difficulty),
    strideGrowthSteps: strideGrowth(index, difficulty),
    damageGrowth: damageGrowthFor(index, difficulty),
    rewardTable: rewardTableFor(index),
  };
}

/**
 * Time to be caught from 30 m with zero player input, in seconds. Distance is 31
 * ticks (30 m to reach 0, one more to catch), so the total is the sum of
 * per-step pace, not 31 × starting pace (§0.5).
 *
 * Proof: Normal day 1 = 69.5 s, Hard = 66.4 s, Nightmare = 46.0 s.
 */
export function standingStillSeconds(day: number, difficulty: HorrorDifficulty): number {
  const startS = startPaceMs(day, difficulty) / 1000;
  let total = 0;
  for (let k = 1; k <= 31; k++) {
    total += paceAtStep(startS, k, difficulty);
  }
  return total;
}
