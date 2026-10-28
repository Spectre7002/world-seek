// HorrorGuessr — /api/horror/act route (P4 API, §7.3, §7.4).
//
// The action dispatcher. Supports all action kinds from HorrorActRequest.
// Strict replay protection via monotonic `seq` — every request must contain a
// strictly increasing sequence number to prevent double-spends and replay attacks.
// Responses carry `x-servertime` header. The returned state is a safe projection
// that NEVER exposes `seed`, true coordinates, or the boss's hidden answer.

import { NextRequest, NextResponse } from "next/server";
import {
  getHorrorRun,
  touchHorrorRun,
  acceptHorrorSeq,
} from "@/server-logic/horrorStore";
import {
  ensureHorrorDayStarted,
  endHorrorDay,
  playerStep,
  tickMonster,
  resolveChaseGuess,
  useHappyThoughts,
  applyJumpscare,
  handleMonsterCatch,
  applyDamageToPlayer,
  healPlayer,
  horrorRngFor,
  deriveHorrorEngineMods,
  effectiveThresholdFor,
  HorrorDayOutcome,
  HorrorDayStart,
} from "@/server-logic/horrorEngine";
import {
  applyHorrorTrigger,
  tickItemDays,
  tickItemSteps,
  addItemToRun,
  equipItem,
  unequipItem,
  destroyItem,
  grantGold,
  spendGold,
  horrorItemLedger,
  resetHorrorItemDay,
  deriveHorrorItemMods,
  horrorThresholdAdjustment,
  takePendingSkipDays,
  itemBuyPrice,
  itemSellPrice,
} from "@/server-logic/horrorItems";
import {
  openMerchantVisit,
  buyMerchantOffer,
  rerollMerchantOffers,
  getMerchantVisit,
  closeMerchantVisit,
  merchantOffersForClient,
  HorrorBuyResult,
  HorrorRerollResult,
  HorrorSellResult,
  bossWinGoldPayout,
} from "@/server-logic/horrorMerchant";
import {
  openDuel,
  closeDuel,
  getDuel,
  resolveBossRound,
  resolveLaserLock,
  castHexes,
  clearHexes,
  openScream,
  isScreaming,
  clampWipeAmount,
  grantBossReward,
  grantFinalBossReward,
  playerScoreForGuess,
  bossRankIndex,
  dayTargetFor,
  ensureDayTarget,
  getHorrorBoss,
} from "@/server-logic/horrorBoss";
import { rankForDay } from "@/shared/horrorScoring";
import type {
  HorrorRun,
  HorrorAction,
  HorrorActRequest,
  HorrorDifficulty,
} from "@/shared/horrorTypes";
import { LatLng } from "@/shared/types";

// ---------------------------------------------------------------------------
// Safe projection (same as /run route)
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

function projectRun(run: HorrorRun, dayStart: HorrorDayStart): HorrorRunProjection {
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
          mechanic: run.boss.mechanic,
          health: run.boss.health,
          maxHealth: run.boss.maxHealth,
          responseMs: run.boss.responseMs,
          duelTimerMs: run.boss.duelTimerMs,
          phase: run.boss.phase,
          debuffs: run.boss.debuffs,
        }
      : null,
    duel: (() => {
      const duel = getDuel(run);
      if (!duel) return null;
      return {
        round: duel.round,
        roundsWon: duel.roundsWon,
        roundsLost: duel.roundsLost,
        hexes: duel.hexes,
        screamUntil: duel.screamUntil,
        laser: duel.laser,
        rewardGranted: duel.rewardGranted,
        finalReward: duel.finalReward,
      };
    })(),
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
// Action handlers
// ---------------------------------------------------------------------------

async function handleStep(run: HorrorRun, action: Extract<HorrorAction, { kind: "step" }>): Promise<{ ok: boolean; reason?: string; [key: string]: unknown }> {
  // A step advances the player and ticks the monster
  const stepResult = playerStep(run);
  
  // Also tick the monster once per step (pursuit happens continuously)
  const now = Date.now();
  const tickResult = tickMonster(run, now);
  
  // Check if caught
  if (tickResult.caught || stepResult.monsterAtZero) {
    const catchResult = handleMonsterCatch(run);
    if (catchResult.endDay) {
      const dayEndResult = endHorrorDay(run, "caught", { advanceDays: 1 });
      if (dayEndResult.runOver) {
        return { ok: true, kind: "step", caught: true, runOver: true, stepDistanceAfter: stepResult.distanceAfter, doubleMove: stepResult.doubleMove, gainedM: stepResult.gainedM, fell: stepResult.fell, fallDamage: stepResult.fallDamage, healed: stepResult.healed, ticked: tickResult.ticked, tickDistanceBefore: tickResult.distanceBefore, tickDistanceAfter: tickResult.distanceAfter, strideBonusM: tickResult.strideBonusM, paceMs: tickResult.paceMs, endDay: catchResult.endDay, damage: catchResult.damage, dead: catchResult.dead, itemId: catchResult.itemId };
      }
      return { ok: true, kind: "step", caught: true, dayAdvanced: true, stepDistanceAfter: stepResult.distanceAfter, doubleMove: stepResult.doubleMove, gainedM: stepResult.gainedM, fell: stepResult.fell, fallDamage: stepResult.fallDamage, healed: stepResult.healed, ticked: tickResult.ticked, tickDistanceBefore: tickResult.distanceBefore, tickDistanceAfter: tickResult.distanceAfter, strideBonusM: tickResult.strideBonusM, paceMs: tickResult.paceMs, endDay: catchResult.endDay, damage: catchResult.damage, dead: catchResult.dead, itemId: catchResult.itemId };
    }
    return { ok: true, kind: "step", caught: true, runOver: true, stepDistanceAfter: stepResult.distanceAfter, doubleMove: stepResult.doubleMove, gainedM: stepResult.gainedM, fell: stepResult.fell, fallDamage: stepResult.fallDamage, healed: stepResult.healed, ticked: tickResult.ticked, tickDistanceBefore: tickResult.distanceBefore, tickDistanceAfter: tickResult.distanceAfter, strideBonusM: tickResult.strideBonusM, paceMs: tickResult.paceMs, endDay: catchResult.endDay, damage: catchResult.damage, dead: catchResult.dead, itemId: catchResult.itemId };
  }

  // Check if dead from fall
  if (stepResult.dead) {
    endHorrorDay(run, "died");
    return { ok: true, kind: "step", dead: true, runOver: true, stepDistanceAfter: stepResult.distanceAfter, doubleMove: stepResult.doubleMove, gainedM: stepResult.gainedM, fell: stepResult.fell, fallDamage: stepResult.fallDamage, healed: stepResult.healed, ticked: tickResult.ticked, tickDistanceBefore: tickResult.distanceBefore, tickDistanceAfter: tickResult.distanceAfter, strideBonusM: tickResult.strideBonusM, paceMs: tickResult.paceMs };
  }

  // Apply onFall item triggers (e.g., Banana Peel +15m, Skateboard destruction)
  let fallTriggerEvents: unknown[] = [];
  if (stepResult.fell) {
    const fallTrigger = applyHorrorTrigger(run, "onFall", {});
    fallTriggerEvents = fallTrigger.events;
  }

  return { ok: true, kind: "step", stepDistanceAfter: stepResult.distanceAfter, doubleMove: stepResult.doubleMove, gainedM: stepResult.gainedM, fell: stepResult.fell, fallDamage: stepResult.fallDamage, healed: stepResult.healed, dead: stepResult.dead, monsterAtZero: stepResult.monsterAtZero, ticked: tickResult.ticked, tickDistanceBefore: tickResult.distanceBefore, tickDistanceAfter: tickResult.distanceAfter, strideBonusM: tickResult.strideBonusM, paceMs: tickResult.paceMs, caught: tickResult.caught, fallEvents: fallTriggerEvents };
}

async function handleTick(run: HorrorRun): Promise<{ ok: boolean; reason?: string; [key: string]: unknown }> {
  // A tick advances the monster without player movement
  const now = Date.now();
  const tickResult = tickMonster(run, now);
  
  // Check if caught
  if (tickResult.caught) {
    const catchResult = handleMonsterCatch(run);
    if (catchResult.endDay) {
      const dayEndResult = endHorrorDay(run, "caught", { advanceDays: 1 });
      if (dayEndResult.runOver) {
        return { ok: true, kind: "tick", caught: true, runOver: true, tickDistanceBefore: tickResult.distanceBefore, tickDistanceAfter: tickResult.distanceAfter, strideBonusM: tickResult.strideBonusM, paceMs: tickResult.paceMs, endDay: catchResult.endDay, damage: catchResult.damage, dead: catchResult.dead, itemId: catchResult.itemId };
      }
      return { ok: true, kind: "tick", caught: true, dayAdvanced: true, tickDistanceBefore: tickResult.distanceBefore, tickDistanceAfter: tickResult.distanceAfter, strideBonusM: tickResult.strideBonusM, paceMs: tickResult.paceMs, endDay: catchResult.endDay, damage: catchResult.damage, dead: catchResult.dead, itemId: catchResult.itemId };
    }
    return { ok: true, kind: "tick", caught: true, runOver: true, tickDistanceBefore: tickResult.distanceBefore, tickDistanceAfter: tickResult.distanceAfter, strideBonusM: tickResult.strideBonusM, paceMs: tickResult.paceMs, endDay: catchResult.endDay, damage: catchResult.damage, dead: catchResult.dead, itemId: catchResult.itemId };
  }
  
  return { ok: true, kind: "tick", ticked: tickResult.ticked, tickDistanceBefore: tickResult.distanceBefore, tickDistanceAfter: tickResult.distanceAfter, strideBonusM: tickResult.strideBonusM, paceMs: tickResult.paceMs, caught: tickResult.caught };
}
/**
 * Target selection is server-owned now (`ensureDayTarget` picks from the map
 * pool). The action is kept as a no-op so older clients get a clear answer
 * instead of corrupting the day's location.
 */
async function handleSetTarget(
  run: HorrorRun,
  action: Extract<HorrorAction, { kind: "setTarget" }>,
): Promise<{ ok: boolean; reason?: string; [key: string]: unknown }> {
  return { ok: false, kind: "setTarget", reason: "server_managed_target" };
}

async function handleGuess(run: HorrorRun, action: Extract<HorrorAction, { kind: "guess" }>): Promise<{ ok: boolean; reason?: string; [key: string]: unknown }> {
  // A boss day replaces the normal round with a duel (§5.1), so the guess is a
  // duel round, not a Chase guess.
  if (run.boss) {
    return handleBossGuess(run, { lat: action.lat, lng: action.lng });
  }

  // Score the guess against the day's real seeded target. Passing a placeholder
  // here (the old `{ lat: 0, lng: 0 }`) measured every guess against a point in
  // the Gulf of Guinea, so every guess scored ~0 and was rejected — which is why
  // the Guess button appeared to do nothing.
  const target = dayTargetFor(run);
  const reveal = { day: run.day, target: { lat: target.lat, lng: target.lng } };
  const guessResult = resolveChaseGuess(run, {
    guess: { lat: action.lat, lng: action.lng },
    target,
  }, horrorThresholdAdjustment(run));

  
  if (guessResult.dead) {
    endHorrorDay(run, "died");
    return { ok: true, kind: "guess", dead: true, runOver: true, ...reveal, distanceKm: guessResult.distanceKm, score: guessResult.score, baseThreshold: guessResult.baseThreshold, threshold: guessResult.threshold, rejected: guessResult.rejected, thresholdIgnored: guessResult.thresholdIgnored, damage: guessResult.damage, baseDamage: guessResult.baseDamage, growth: guessResult.growth, fullHeal: guessResult.fullHeal, healed: guessResult.healed, healthBefore: guessResult.healthBefore, healthAfter: guessResult.healthAfter, jumpscare: guessResult.jumpscare };
  }

  if (guessResult.rejected) {
    // Rejected guess - no health cost, but jumpscare unless Earplugs
    return { ok: true, kind: "guess", rejected: true, distanceKm: guessResult.distanceKm, score: guessResult.score, baseThreshold: guessResult.baseThreshold, threshold: guessResult.threshold, thresholdIgnored: guessResult.thresholdIgnored, damage: guessResult.damage, baseDamage: guessResult.baseDamage, growth: guessResult.growth, fullHeal: guessResult.fullHeal, healed: guessResult.healed, healthBefore: guessResult.healthBefore, healthAfter: guessResult.healthAfter, jumpscare: guessResult.jumpscare };
  }

  if (guessResult.fullHeal) {
    // Perfect guess - day ends successfully
    const dayEndResult = endHorrorDay(run, "guessed", { advanceDays: 1 });
    if (dayEndResult.runOver) {
      return { ok: true, kind: "guess", fullHeal: true, runOver: true, ...reveal, distanceKm: guessResult.distanceKm, score: guessResult.score, baseThreshold: guessResult.baseThreshold, threshold: guessResult.threshold, rejected: guessResult.rejected, thresholdIgnored: guessResult.thresholdIgnored, damage: guessResult.damage, baseDamage: guessResult.baseDamage, growth: guessResult.growth, healed: guessResult.healed, healthBefore: guessResult.healthBefore, healthAfter: guessResult.healthAfter, jumpscare: guessResult.jumpscare };
    }
    return { ok: true, kind: "guess", fullHeal: true, dayAdvanced: true, ...reveal, distanceKm: guessResult.distanceKm, score: guessResult.score, baseThreshold: guessResult.baseThreshold, threshold: guessResult.threshold, rejected: guessResult.rejected, thresholdIgnored: guessResult.thresholdIgnored, damage: guessResult.damage, baseDamage: guessResult.baseDamage, growth: guessResult.growth, healed: guessResult.healed, healthBefore: guessResult.healthBefore, healthAfter: guessResult.healthAfter, jumpscare: guessResult.jumpscare };
  }

  // A non-rejected Chase guess ends the day (S1 `day_ended` outcome "Guessed").
  // `ensureHorrorDayStarted` is idempotent, so this never re-resets the monster.
  ensureHorrorDayStarted(run);
  const dayEndResult = endHorrorDay(run, "guessed", { advanceDays: 1 });
  if (dayEndResult.runOver) {
    return { ok: true, kind: "guess", runOver: true, ...reveal, distanceKm: guessResult.distanceKm, score: guessResult.score, baseThreshold: guessResult.baseThreshold, threshold: guessResult.threshold, rejected: guessResult.rejected, thresholdIgnored: guessResult.thresholdIgnored, damage: guessResult.damage, baseDamage: guessResult.baseDamage, growth: guessResult.growth, fullHeal: guessResult.fullHeal, healed: guessResult.healed, healthBefore: guessResult.healthBefore, healthAfter: guessResult.healthAfter, jumpscare: guessResult.jumpscare };
  }
  return { ok: true, kind: "guess", dayAdvanced: true, ...reveal, distanceKm: guessResult.distanceKm, score: guessResult.score, baseThreshold: guessResult.baseThreshold, threshold: guessResult.threshold, rejected: guessResult.rejected, thresholdIgnored: guessResult.thresholdIgnored, damage: guessResult.damage, baseDamage: guessResult.baseDamage, growth: guessResult.growth, fullHeal: guessResult.fullHeal, healed: guessResult.healed, healthBefore: guessResult.healthBefore, healthAfter: guessResult.healthAfter, jumpscare: guessResult.jumpscare };
}

/**
 * One duel round (§5.1).
 *
 * The player's guess is scored against the day's seeded target, the boss rolls
 * its own score (§5.3), and `resolveBossRound` compares them. A boss win grants
 * the rolled reward (§5.4) exactly once; a boss loss that empties the player's
 * health ends the run. The final boss (day 30) grants nothing on a win — its
 * reward is *chosen* afterwards via `finalBossReward`.
 */
async function handleBossGuess(
  run: HorrorRun,
  guess: { lat: number; lng: number },
): Promise<{ ok: boolean; reason?: string; [key: string]: unknown }> {
  const duel = openDuel(run);
  if (!duel || !run.boss) {
    return { ok: false, kind: "bossGuess", reason: "not_boss_day" };
  }
  const playerScore = playerScoreForGuess(run, guess);
  return finishBossRound(run, duel, playerScore, "bossGuess");
}

/**
 * Resolve a duel round and apply its consequences.
 *
 * Shared by `bossGuess` (a normal map guess) and `laserLock` (Meep Moorp's
 * minigame), because both produce a player score and both must run the same
 * reward / death / item-trigger logic. A boss win grants the rolled reward once
 * (§5.4); a boss loss that empties the player's health ends the run; the finale
 * grants nothing on a win because its reward is *chosen* afterwards.
 */
async function finishBossRound(
  run: HorrorRun,
  duel: NonNullable<ReturnType<typeof getDuel>>,
  playerScore: number,
  kind: string,
): Promise<{ ok: boolean; reason?: string; [key: string]: unknown }> {
  if (!run.boss) return { ok: false, kind, reason: "not_boss_day" };
  const outcome = resolveBossRound(run, duel, playerScore);
  const definition = getHorrorBoss(run.boss.id);
  const rank = definition?.rank ?? rankForDay(run.day);

  // A won duel: grant the reward once and open the next day (or the finale's
  // pick-one-of-three on day 30).
  if (outcome.bossDefeated) {
    let reward: unknown = null;
    if (definition?.final) {
      // Day 30 rolls nothing; the reward is chosen (§5.4).
      reward = { kind: "chosen", options: ["fullHeal", "mythicEquipment", "fiveRareFoods"] };
    } else {
      reward = grantBossReward(run, duel, run.day, rank);
      bossWinGoldPayout(run, bossRankIndex(rank));
    }
    // `Space Rock`, `Gulskinna`, `Saucer` and `Blankie` subscribe to a boss win.
    const winTrigger = applyHorrorTrigger(run, "onBossWin", {
      bossId: run.boss.id,
      score: playerScore,
    });
    if (definition?.final) {
      // The finale's day only advances after the reward is chosen.
      return {
        ok: true,
        kind,
        bossDefeated: true,
        final: true,
        playerScore,
        bossScore: outcome.bossScore,
        reward,
        events: winTrigger.events,
        bossAnswer: outcome.bossAnswer,
      };
    }
    closeDuel(run);
    const dayEnd = endHorrorDay(run, "bossWon", { advanceDays: 1 });
    return {
      ok: true,
      kind,
      bossDefeated: true,
      runOver: dayEnd.runOver,
      campaignUnlocked: dayEnd.campaignUnlocked,
      dayAdvanced: dayEnd.advanced,
      playerScore,
      bossScore: outcome.bossScore,
      damageToBoss: outcome.damageToBoss,
      reward,
      gold: reward && typeof reward === "object" && "gold" in reward ? (reward as { gold: number }).gold : 0,
      events: winTrigger.events,
      bossAnswer: outcome.bossAnswer,
    };
  }

  // A lost round: the player takes the delta as health, unless a `healthFloor`
  // save or `Defibrillator` cancels it. A loss that empties the pool ends the run.
  if (outcome.playerDead) {
    closeDuel(run);
    endHorrorDay(run, "died");
    return {
      ok: true,
      kind,
      playerDead: true,
      runOver: true,
      playerScore,
      bossScore: outcome.bossScore,
      damageToBoss: outcome.damageToBoss,
      damageToPlayer: outcome.playerDamageApplied,
      lifesteal: outcome.lifesteal,
      bossAnswer: outcome.bossAnswer,
    };
  }

  // `Hand Mirror` reflects part of a lost round back (§3.7).
  const lossTrigger = applyHorrorTrigger(run, "onBossLoss", {
    bossId: run.boss.id,
    score: playerScore,
  });

  return {
    ok: true,
    kind,
    playerWon: outcome.playerWon,
    playerScore,
    bossScore: outcome.bossScore,
    delta: outcome.delta,
    damageToBoss: outcome.damageToBoss,
    damageToPlayer: outcome.playerDamageApplied,
    lifesteal: outcome.lifesteal,
    bossHealth: run.boss.health,
    bossMaxHealth: run.boss.maxHealth,
    round: outcome.round,
    mechanic: outcome.mechanic,
    bossAnswer: outcome.bossAnswer,
    events: lossTrigger.events,
  };
}

/**
 * The day-30 finale's pick-one-of-three (§5.4). Irreversible: the choice is
 * committed to the duel, granted once, and only then does the day advance.
 */
async function handleFinalBossReward(
  run: HorrorRun,
  choice: Extract<HorrorAction, { kind: "finalBossReward" }>["choice"],
): Promise<{ ok: boolean; reason?: string; [key: string]: unknown }> {
  const duel = getDuel(run);
  if (!duel || !run.boss) {
    return { ok: false, kind: "finalBossReward", reason: "not_boss_day" };
  }
  const definition = getHorrorBoss(run.boss.id);
  if (!definition?.final) {
    return { ok: false, kind: "finalBossReward", reason: "not_final_boss" };
  }
  if (duel.finalReward !== null) {
    return { ok: false, kind: "finalBossReward", reason: "already_chosen", choice: duel.finalReward };
  }

  const grant = grantFinalBossReward(run, duel, choice);
  closeDuel(run);
  const dayEnd = endHorrorDay(run, "bossWon", { advanceDays: 1 });
  return {
    ok: true,
    kind: "finalBossReward",
    choice: grant.choice,
    granted: grant.granted,
    healed: grant.healed,
    runOver: dayEnd.runOver,
    campaignUnlocked: dayEnd.campaignUnlocked,
    dayAdvanced: dayEnd.advanced,
    nextDay: run.day,
  };
}

async function handleBuy(run: HorrorRun, action: Extract<HorrorAction, { kind: "buy" }>): Promise<{ ok: boolean; reason?: string; [key: string]: unknown }> {
  const result = buyMerchantOffer(run, action.offerIndex);
  const { ok, ...rest } = result;
  return { ok, kind: "buy", ...rest };
}

async function handleReroll(run: HorrorRun): Promise<{ ok: boolean; reason?: string; [key: string]: unknown }> {
  const result = rerollMerchantOffers(run);
  const { ok, ...rest } = result;
  return { ok, kind: "reroll", ...rest };
}

/**
 * Open (or re-open) the day's shop. Free and idempotent: the same shelf is
 * returned until a reroll, and the projection already carries `merchantOffers`.
 */
async function handleOpenMerchant(run: HorrorRun): Promise<{ ok: boolean; reason?: string; [key: string]: unknown }> {
  openMerchantVisit(run);
  return { ok: true, kind: "openMerchant" };
}

async function handleSell(run: HorrorRun, action: Extract<HorrorAction, { kind: "sell" }>): Promise<{ ok: boolean; reason?: string; [key: string]: unknown }> {
  // sellItem is from horrorMerchant, not horrorItems
  const { sellItem } = await import("@/server-logic/horrorMerchant");
  const result = sellItem(run, action.itemId);
  const { ok, ...rest } = result;
  return { ok, kind: "sell", ...rest };
}

async function handleEat(run: HorrorRun, action: Extract<HorrorAction, { kind: "eat" }>): Promise<{ ok: boolean; reason?: string; [key: string]: unknown }> {
  const itemId = action.itemId;
  const itemIndex = run.food.indexOf(itemId);
  if (itemIndex === -1) {
    return { ok: false, kind: "eat", reason: "not_in_food" };
  }

  // Remove from food list
  run.food.splice(itemIndex, 1);
  
  // Apply onEat trigger
  const result = applyHorrorTrigger(run, "onEat", { itemScope: itemId });
  
  // Check for destruction
  const destroyed = result.destroyed.includes(itemId);
  
  return { 
    ok: true, 
    kind: "eat", 
    itemId, 
    destroyed,
    events: result.events,
    goldDelta: result.goldDelta,
    healed: result.healed,
    healthLost: result.healthLost,
    distanceDelta: result.distanceDelta,
    skippedDays: result.skippedDays,
    bossSkipped: result.bossSkipped,
  };
}

async function handleCast(run: HorrorRun, action: Extract<HorrorAction, { kind: "cast" }>): Promise<{ ok: boolean; reason?: string; [key: string]: unknown }> {
  const { spellId, target } = action;
  
  // Check if player has the spell
  const charges = run.spells[spellId] ?? 0;
  if (charges <= 0) {
    return { ok: false, kind: "cast", reason: "no_charges" };
  }

  // Spend a charge
  run.spells[spellId] = charges - 1;
  run.counters.scryCast += 1; // or appropriate counter based on spell family

  // Apply onCast trigger for items
  const result = applyHorrorTrigger(run, "onCast", { 
    chargeFamily: "spell" as const,
    // target would be used by spell resolution
  });

  // TODO: Actually resolve the spell effect (spell resolution is in horrorSpells.ts)
  // For now, just return the item trigger results
  
  return { 
    ok: true, 
    kind: "cast", 
    spellId, 
    chargesLeft: run.spells[spellId],
    events: result.events,
    goldDelta: result.goldDelta,
    healed: result.healed,
    healthLost: result.healthLost,
    distanceDelta: result.distanceDelta,
  };
}

async function handleHappyThoughts(run: HorrorRun): Promise<{ ok: boolean; reason?: string; [key: string]: unknown }> {
  const now = Date.now();
  const result = useHappyThoughts(run, now);
  
  // Also apply onHappyThoughts item triggers
  const itemResult = applyHorrorTrigger(run, "onHappyThoughts", { now });
  
  return { 
    ok: result.ok, 
    kind: "happyThoughts", 
    reason: result.reason,
    healed: result.healed,
    freezeMs: result.freezeMs,
    metresGained: result.metresGained,
    distanceAfter: result.distanceAfter,
    chargesLeft: result.chargesLeft,
    itemEvents: itemResult.events,
  };
}

/**
 * The Clown's cream-pie wipe layer (§5.3). Cosmetic and rate-limited: the server
 * only clamps the amount so a client cannot claim to have wiped more than the
 * layer holds. The splat layout is seeded client-side from the run seed.
 */
async function handleWipe(run: HorrorRun, action: Extract<HorrorAction, { kind: "wipe" }>): Promise<{ ok: boolean; reason?: string; [key: string]: unknown }> {
  const duel = getDuel(run);
  if (!duel) return { ok: false, kind: "wipe", reason: "not_boss_day" };
  return { ok: true, kind: "wipe", amount: clampWipeAmount(action.amount) };
}

/**
 * Meep Moorp's laser lock (§5.2). The lock is a normalised `(x, y)`; the score
 * is derived from its proximity to a seeded target, so the minigame is
 * deterministic. The lock is recorded on the duel and resolved as the round's
 * player score.
 */
async function handleLaserLock(run: HorrorRun, action: Extract<HorrorAction, { kind: "laserLock" }>): Promise<{ ok: boolean; reason?: string; [key: string]: unknown }> {
  const duel = getDuel(run);
  if (!duel || !run.boss) {
    return { ok: false, kind: "laserLock", reason: "not_boss_day" };
  }
  const mechanic = run.boss.mechanic;
  if (mechanic !== "laserLock" && mechanic !== "laserOverdrive") {
    return { ok: false, kind: "laserLock", reason: "not_laser_boss" };
  }
  const lock = resolveLaserLock(run, duel, action.x, action.y);
  // The lock is the round's player score, so it resolves the duel exactly like a
  // map guess would (§5.2: "stop two running laser lines ... to return fire").
  const round = await finishBossRound(run, duel, lock.score, "laserLock");
  return { ...round, x: lock.x, y: lock.y, score: lock.score };
}

/**
 * The Witch's hexes (§5.2). Cast 3–5 s into the round; `hexClear` removes them.
 * The cast is seeded, so a reconnect reproduces the same hexes.
 */
async function handleHexClear(run: HorrorRun): Promise<{ ok: boolean; reason?: string; [key: string]: unknown }> {
  const duel = getDuel(run);
  if (!duel) return { ok: false, kind: "hexClear", reason: "not_boss_day" };
  const cleared = clearHexes(duel);
  return { ok: true, kind: "hexClear", cleared };
}

/**
 * The Banshee's scream penalty (§5.2). Any input during the scream costs instant
 * damage ("You moved!"). The client reports the violation; the server applies the
 * damage so it cannot be dodged by a modified client.
 */
async function handleScreamPenalty(run: HorrorRun): Promise<{ ok: boolean; reason?: string; [key: string]: unknown }> {
  const duel = getDuel(run);
  if (!duel || !run.boss) {
    return { ok: false, kind: "screamPenalty", reason: "not_boss_day" };
  }
  const now = Date.now();
  if (!isScreaming(duel, now)) {
    return { ok: false, kind: "screamPenalty", reason: "not_screaming" };
  }
  const applied = applyDamageToPlayer(run, 250, "boss");
  return {
    ok: true,
    kind: "screamPenalty",
    damage: applied.applied,
    dead: applied.dead,
    health: run.health,
  };
}

async function handleContinue(run: HorrorRun): Promise<{ ok: boolean; reason?: string; [key: string]: unknown }> {
  // Continue to next day (used after boss win, merchant close, etc.)
  // Check if there are pending skip days from items
  const pendingSkips = takePendingSkipDays(run);
  const advanceDays = Math.max(1, pendingSkips);
  
  const dayEndResult = endHorrorDay(run, "guessed", { advanceDays });
  
  if (dayEndResult.runOver) {
    return { ok: true, kind: "continue", runOver: true, advanced: false };
  }
  
  return { 
    ok: true, 
    kind: "continue", 
    advanced: dayEndResult.advanced, 
    campaignUnlocked: dayEndResult.campaignUnlocked,
    nextDay: run.day,
  };
}

// ---------------------------------------------------------------------------
// Main POST handler
// ---------------------------------------------------------------------------

export async function POST(request: NextRequest) {
  const serverTime = Date.now();
  const headers = { "x-servertime": serverTime.toString() };

  let body: HorrorActRequest;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json(
      { ok: false, reason: "invalid_json" },
      { status: 400, headers },
    );
  }

  const { runId, seq, action } = body;

  // Validate required fields
  if (!runId || typeof runId !== "string") {
    return NextResponse.json(
      { ok: false, reason: "missing_runId" },
      { status: 400, headers },
    );
  }

  if (typeof seq !== "number" || !Number.isInteger(seq) || seq <= 0) {
    return NextResponse.json(
      { ok: false, reason: "invalid_seq" },
      { status: 400, headers },
    );
  }

  if (!action || typeof action.kind !== "string") {
    return NextResponse.json(
      { ok: false, reason: "invalid_action" },
      { status: 400, headers },
    );
  }

  // Get the run
  const run = getHorrorRun(runId);
  if (!run) {
    return NextResponse.json(
      { ok: false, reason: "not_found" },
      { status: 404, headers },
    );
  }

  // STRICT REPLAY PROTECTION (§7.3): seq must be strictly increasing
  if (!acceptHorrorSeq(runId, seq)) {
    return NextResponse.json(
      { ok: false, reason: "replay_detected" },
      { status: 409, headers },
    );
  }

  // Mark run as touched (updates lastSeenAt for idle sweep)
  touchHorrorRun(runId, serverTime);

  // Ensure day is started (in case of fresh run or day boundary). This is the
  // idempotent entry point: it resets the monster to 30 m only on a genuinely
  // new day, so a tick or step is never undone by the call itself.
  let dayStart = ensureHorrorDayStarted(run);

  // A boss day opens a duel (§5.1). Idempotent per `(runId, day)`, so a
  // reconnect never rerolls the boss's answer or resets its health.
  if (run.boss) openDuel(run);

  let actionResult: { ok: boolean; reason?: string; [key: string]: unknown } = { ok: false, reason: "unknown_action" };

  try {
    switch (action.kind) {
      case "step":
        actionResult = await handleStep(run, action);
        break;
      case "setTarget":
        actionResult = await handleSetTarget(run, action);
        break;
      case "guess":
        actionResult = await handleGuess(run, action);
        break;
      case "tick":
        actionResult = await handleTick(run);
        break;
      case "buy":
        actionResult = await handleBuy(run, action);
        break;
      case "reroll":
        actionResult = await handleReroll(run);
        break;
      case "openMerchant":
        actionResult = await handleOpenMerchant(run);
        break;
      case "sell":
        actionResult = await handleSell(run, action);
        break;
      case "eat":
        actionResult = await handleEat(run, action);
        break;
      case "cast":
        actionResult = await handleCast(run, action);
        break;
      case "happyThoughts":
        actionResult = await handleHappyThoughts(run);
        break;
      case "wipe":
        actionResult = await handleWipe(run, action);
        break;
      case "laserLock":
        actionResult = await handleLaserLock(run, action);
        break;
      case "bossGuess":
        actionResult = await handleBossGuess(run, action);
        break;
      case "finalBossReward":
        actionResult = await handleFinalBossReward(run, action.choice);
        break;
      case "hexClear":
        actionResult = await handleHexClear(run);
        break;
      case "screamPenalty":
        actionResult = await handleScreamPenalty(run);
        break;
      case "continue":
        actionResult = await handleContinue(run);
        // After continue, we need to re-fetch dayStart for the new day
        dayStart = ensureHorrorDayStarted(run);
        break;
      default:
        actionResult = { ok: false, reason: "unknown_action_kind" };
    }
  } catch (error) {
    const message = error instanceof Error ? error.message : "internal_error";
    actionResult = { ok: false, reason: message };
  }

  // Re-project after action. `ensureHorrorDayStarted` is a no-op on the same
  // day, so this cannot undo the tick or step that just happened.
  dayStart = ensureHorrorDayStarted(run);
  const projection = projectRun(run, dayStart);
  const { ok: actionOk, reason, ...actionRest } = actionResult;
  projection.actionResult = { kind: action.kind, ok: actionOk, reason, ...actionRest };

  return NextResponse.json(
    { ok: actionOk, run: projection },
    { headers },
  );
}