#!/usr/bin/env node
// HorrorGuessr — the P8 acceptance harness for bosses and duels (§5.1–§5.4, §8 P8).
//
// P8 is "duel resolver, 13 boss definitions, Clown wipe layer, Meep Moorp laser
// minigame, Banshee input-freeze, Witch hex transforms" (§8). This script drives
// the real boss module from `src/server-logic/horrorBoss.ts` against the numbers
// and rules the master plan asserts, so the phase cannot regress without this
// failing.
//
// It covers:
//
//   1. the roster: 13 bosses, the Clown on the five rolled days, the finale on
//      day 30 (acceptance 2e, §5.2, C16);
//   2. boss HP: the Hangout row is 3500/4000/4800 (acceptance 2e, [CODEX]);
//   3. the duel resolver: the loser loses the **exact** score delta
//      (acceptance 6, §5.1), a tie is a zero-delta player win;
//   4. vampirism: the boss heals itself by the damage it deals (§5.2);
//   5. rewards: never Common, every odds row sums to 100 ± 0.1 (acceptance 2f),
//      idempotent per duel (acceptance 7);
//   6. the final boss: rolls nothing, pick-one-of-three (§5.4);
//   7. determinism: same seed ⇒ same boss answer and the same rolls (§7.4);
//   8. the minigames: laser lock is deterministic, wipe is clamped, hexes clear.
//
// Usage: npx tsx scripts/horror-boss-sim.mjs

import {
  HORROR_BOSSES,
  HORROR_PERENNIAL_BOSS_ID,
  bossForDay,
  bossHealthFor,
  resolveDuel,
  rollBossReward,
  grantBossReward,
  grantFinalBossReward,
  finalBossRewardOptions,
  resolveLaserLock,
  clampWipeAmount,
  castHexes,
  clearHexes,
  openDuel,
  openScream,
  isScreaming,
  playerScoreForGuess,
  bossDamageBonus,
  dayTargetFor,
  getHorrorBoss,
} from "../src/server-logic/horrorBoss.ts";
import { bossRewardOdds, rankForDay } from "../src/shared/horrorScoring.ts";
import { createHorrorRun, resetHorrorStore } from "../src/server-logic/horrorStore.ts";
import { HORROR_FINAL_BOSS_DAY } from "../src/shared/horrorCatalogue.ts";
import { horrorRngFor } from "../src/server-logic/horrorEngine.ts";

// ---------------------------------------------------------------------------
// Harness
// ---------------------------------------------------------------------------

let failures = 0;
let passes = 0;

function check(name, actual, expected) {
  const ok = Object.is(actual, expected);
  if (ok) passes += 1;
  else failures += 1;
  console.log(`${ok ? "✓" : "✗"} ${name}${ok ? "" : ` — expected ${expected}, got ${actual}`}`);
}

function checkNear(name, actual, expected, tolerance) {
  const ok = Math.abs(actual - expected) <= tolerance;
  if (ok) passes += 1;
  else failures += 1;
  console.log(
    `${ok ? "✓" : "✗"} ${name}${ok ? "" : ` — expected ${expected} ± ${tolerance}, got ${actual}`}`,
  );
}

function checkTrue(name, value) {
  check(name, Boolean(value), true);
}

function section(title) {
  console.log(`\n── ${title} ─────────────────────────────────────────────`);
}

function freshRun(seed = 1234, difficulty = "Normal") {
  resetHorrorStore();
  return createHorrorRun({ seed, difficulty });
}

// ---------------------------------------------------------------------------
// 1. The roster (§5.2, C16)
// ---------------------------------------------------------------------------

section("1. The roster (§5.2, C16)");

// §5.2 lists the roster across two tables whose `#7` is double-numbered: the
// campaign table's #7 is the day-30 finale and the endless table's #7 is the
// Black Pano. C16 makes the finale a *separate* entity from the rolled bosses,
// so the roster is 13 rolled bosses + exactly one finale. Asserting that split,
// rather than a bare length, is what keeps the count honest.
const FINAL_BOSSES = HORROR_BOSSES.filter((boss) => boss.final === true);
const ROLLED_BOSSES = HORROR_BOSSES.filter((boss) => boss.final !== true);
check("13 rolled bosses", ROLLED_BOSSES.length, 13);
check("exactly one finale", FINAL_BOSSES.length, 1);
checkTrue(
  "every boss declares a mechanic",
  HORROR_BOSSES.every((boss) => typeof boss.mechanic === "string" && boss.mechanic.length > 0),
);
checkTrue(
  "every boss carries a bilingual name",
  HORROR_BOSSES.every((boss) => Boolean(boss.name.ru && boss.name.en)),
);
checkTrue(
  "boss ids are unique",
  new Set(HORROR_BOSSES.map((boss) => boss.id)).size === HORROR_BOSSES.length,
);

{
  const run = freshRun();
  check("day 5 draws the Clown", bossForDay(run, 5).id, HORROR_PERENNIAL_BOSS_ID);
  check("day 10 draws the Clown", bossForDay(run, 10).id, HORROR_PERENNIAL_BOSS_ID);
  check("day 15 draws the Clown", bossForDay(run, 15).id, HORROR_PERENNIAL_BOSS_ID);
  check("day 20 draws the Clown", bossForDay(run, 20).id, HORROR_PERENNIAL_BOSS_ID);
  check("day 25 draws the Clown", bossForDay(run, 25).id, HORROR_PERENNIAL_BOSS_ID);
  check("day 30 is NOT the Clown (C16)", bossForDay(run, HORROR_FINAL_BOSS_DAY).id === HORROR_PERENNIAL_BOSS_ID, false);
  check("day 30 is the finale", bossForDay(run, HORROR_FINAL_BOSS_DAY).id, "finalBoss");
  checkTrue("day 30 is flagged final", bossForDay(run, HORROR_FINAL_BOSS_DAY).final === true);

  // Days 35+ draw from the endless roster, deterministically.
  const endlessA = bossForDay(run, 35).id;
  const endlessB = bossForDay(freshRun(), 35).id;
  check("endless draw is seeded", endlessA, endlessB);
  checkTrue("endless draw is not the Clown", endlessA !== HORROR_PERENNIAL_BOSS_ID);
}

// ---------------------------------------------------------------------------
// 2. Boss HP (§5.3, acceptance 2e)
// ---------------------------------------------------------------------------

section("2. Boss HP (§5.3, acceptance 2e)");

check("Hangout Normal HP", bossHealthFor("Hangout", "Normal"), 3500);
check("Hangout Hard HP", bossHealthFor("Hangout", "Hard"), 4000);
check("Hangout Nightmare HP", bossHealthFor("Hangout", "Nightmare"), 4800);
checkTrue("HP rises with rank", bossHealthFor("Commander", "Normal") > bossHealthFor("Hangout", "Normal"));

// ---------------------------------------------------------------------------
// 3. The duel resolver (§5.1, acceptance 6)
// ---------------------------------------------------------------------------

section("3. The duel resolver (§5.1, acceptance 6)");

{
  const boss = { health: 3500, maxHealth: 3500, bossAnswer: null };
  const win = resolveDuel(3200, 1670, boss);
  check("player win: exact delta to boss", win.damageToBoss, 1530);
  check("player win: no damage to player", win.damageToPlayer, 0);
  check("player win: boss health reduced", boss.health, 1970);
  check("player win: playerWon", win.playerWon, true);
  check("player win: not defeated yet", win.bossDefeated, false);

  const lossBoss = { health: 3500, maxHealth: 3500, bossAnswer: null };
  const loss = resolveDuel(1200, 2300, lossBoss);
  check("player loss: exact delta to player", loss.damageToPlayer, 1100);
  check("player loss: no damage to boss", loss.damageToBoss, 0);
  check("player loss: boss untouched", lossBoss.health, 3500);
  check("player loss: playerWon", loss.playerWon, false);

  const tieBoss = { health: 3500, maxHealth: 3500, bossAnswer: null };
  const tie = resolveDuel(2000, 2000, tieBoss);
  check("tie is a player win", tie.playerWon, true);
  check("tie deals zero damage", tie.damageToBoss, 0);
  check("tie takes zero damage", tie.damageToPlayer, 0);

  // A decisive hit that empties the boss.
  const killBoss = { health: 500, maxHealth: 3500, bossAnswer: null };
  const kill = resolveDuel(4000, 1000, killBoss);
  check("boss can be defeated", kill.bossDefeated, true);
  check("boss health floors at 0", killBoss.health, 0);
}

// ---------------------------------------------------------------------------
// 4. Vampirism (§5.2)
// ---------------------------------------------------------------------------

section("4. Vampirism (§5.2)");

{
  const boss = { health: 1000, maxHealth: 3500, bossAnswer: null };
  const result = resolveDuel(1000, 2000, boss, { lifesteal: true });
  check("vampire deals the delta", result.damageToPlayer, 1000);
  check("vampire heals by the same amount", result.lifesteal, 1000);
  check("vampire health restored", boss.health, 2000);

  // The heal is capped at max health.
  const cappedBoss = { health: 3400, maxHealth: 3500, bossAnswer: null };
  const capped = resolveDuel(1000, 2000, cappedBoss, { lifesteal: true });
  check("vampire heal caps at max health", capped.lifesteal, 100);
  check("vampire health never exceeds max", cappedBoss.health, 3500);

  // Black Pano's damage multiplier.
  const harsh = { health: 3500, maxHealth: 3500, bossAnswer: null };
  const harshResult = resolveDuel(1000, 2000, harsh, { damageMultiplier: 2.5 });
  check("damage multiplier scales the delta", harshResult.damageToPlayer, 2500);
}

// ---------------------------------------------------------------------------
// 5. Rewards (§5.4, acceptance 2f, 7)
// ---------------------------------------------------------------------------

section("5. Rewards (§5.4, acceptance 2f, 7)");

{
  // Every odds row sums to 100 ± 0.1 and never includes Common.
  const ranks = [
    "Hangout",
    "Prospect",
    "Commander",
    "Senior Associate Manager of the Primordial Darkness",
  ];
  let allSum = true;
  for (const rank of ranks) {
    for (const day of [5, 10, 15, 20, 25]) {
      const odds = bossRewardOdds(day, rank);
      const sum = odds.uncommon + odds.rare + odds.mythic;
      if (Math.abs(sum - 100) > 0.1) allSum = false;
      if (odds.uncommon <= 0 && odds.rare <= 0 && odds.mythic <= 0) allSum = false;
    }
  }
  checkTrue("every reward row sums to 100 ± 0.1", allSum);

  const run = freshRun(99);
  // Roll many rewards and assert Common never appears.
  let sawCommon = false;
  for (let i = 0; i < 200; i++) {
    const roll = rollBossReward(run, 10, rankForDay(10));
    if (roll.equipment.rarity === "Common") sawCommon = true;
    for (const food of roll.foods) if (food.rarity === "Common") sawCommon = true;
  }
  check("rewards never roll Common", sawCommon, false);

  // Idempotency: a grant is paid once per duel.
  const run2 = freshRun(7);
  run2.boss = null;
  const duel = {
    bossId: "clown",
    day: run2.day,
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
  const first = grantBossReward(run2, duel, run2.day, "Hangout");
  const second = grantBossReward(run2, duel, run2.day, "Hangout");
  checkTrue("first grant pays out", first.granted.length > 0);
  check("second grant is a no-op", second.granted.length, 0);
  check("reward flag set", duel.rewardGranted, true);
}

// ---------------------------------------------------------------------------
// 6. The final boss (§5.4)
// ---------------------------------------------------------------------------

section("6. The final boss (§5.4)");

{
  check("three final-boss options", finalBossRewardOptions().length, 3);
  checkTrue(
    "options are fullHeal / mythicEquipment / fiveRareFoods",
    JSON.stringify([...finalBossRewardOptions()].sort()) ===
      JSON.stringify(["fiveRareFoods", "fullHeal", "mythicEquipment"].sort()),
  );

  // fullHeal restores to full.
  const run = freshRun(11);
  run.health = 100;
  const duel = {
    bossId: "finalBoss",
    day: 30,
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
  const healGrant = grantFinalBossReward(run, duel, "fullHeal");
  check("full heal restores the pool", run.health, run.maxHealth);
  check("full heal reports the amount", healGrant.healed, run.maxHealth - 100);

  // The choice is irreversible: a second call is a no-op.
  const again = grantFinalBossReward(run, duel, "mythicEquipment");
  check("a second choice is refused", again.granted.length, 0);
  check("the first choice sticks", duel.finalReward, "fullHeal");
}

// ---------------------------------------------------------------------------
// 7. Determinism (§7.4, acceptance 10)
// ---------------------------------------------------------------------------

section("7. Determinism (§7.4, acceptance 10)");

{
  const a = freshRun(424242);
  const b = freshRun(424242);
  const rollA = rollBossReward(a, 15, "Prospect");
  const rollB = rollBossReward(b, 15, "Prospect");
  check("same seed ⇒ same equipment rarity", rollA.equipment.rarity, rollB.equipment.rarity);
  check(
    "same seed ⇒ same food rarities",
    JSON.stringify(rollA.foods),
    JSON.stringify(rollB.foods),
  );

  const targetA = dayTargetFor(a);
  const targetB = dayTargetFor(b);
  check("same seed ⇒ same day target lat", targetA.lat, targetB.lat);
  check("same seed ⇒ same day target lng", targetA.lng, targetB.lng);

  const scoreA = playerScoreForGuess(a, { lat: 10, lng: 20 });
  const scoreB = playerScoreForGuess(b, { lat: 10, lng: 20 });
  check("same seed ⇒ same player score", scoreA, scoreB);
}

// ---------------------------------------------------------------------------
// 8. The minigames (§5.2, §5.3)
// ---------------------------------------------------------------------------

section("8. The minigames (§5.2, §5.3)");

{
  // Laser lock is deterministic and bounded.
  const run = freshRun(555);
  const duel = {
    bossId: "meepMoorp",
    day: 15,
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
  const lock = resolveLaserLock(run, duel, 0.5, 0.5);
  checkTrue("laser score is 0..5000", lock.score >= 0 && lock.score <= 5000);
  check("laser lock is recorded", duel.laser !== null, true);
  check("laser lock preserves x", duel.laser.x, 0.5);

  const perfect = resolveLaserLock(freshRun(555), { ...duel, laser: null }, 0.5, 0.5);
  check("laser lock is deterministic", perfect.score, lock.score);

  // Wipe clamping (§5.3, §7.3).
  check("wipe clamps negatives", clampWipeAmount(-40), 0);
  check("wipe clamps huge claims", clampWipeAmount(99999), 100);
  check("wipe rounds", clampWipeAmount(12.7), 13);
  check("wipe rejects NaN", clampWipeAmount(Number.NaN), 0);

  // Hexes (§5.2).
  const hexRun = freshRun(777);
  const hexDuel = { ...duel, hexes: [] };
  const cast = castHexes(hexRun, hexDuel, "hexes", Date.now());
  checkTrue("a hex is cast", cast.length >= 1);
  checkTrue("the hex is recorded on the duel", hexDuel.hexes.length >= 1);
  const cleared = clearHexes(hexDuel);
  checkTrue("hexes can be cleared", cleared >= 1);
  check("clearing empties the list", hexDuel.hexes.length, 0);

  // Void Witch casts two at once.
  const voidDuel = { ...duel, hexes: [] };
  const stacked = castHexes(freshRun(778), voidDuel, "stackedHexes", Date.now());
  checkTrue("stacked hexes cast at least two", stacked.length >= 2);

  // Scream window (§5.2).
  const screamDuel = { ...duel, screamUntil: 0 };
  const now = Date.now();
  const duration = openScream(freshRun(779), screamDuel, "screamPenalty", now);
  checkTrue("a scream has a positive duration", duration > 0);
  check("screaming right after the scream", isScreaming(screamDuel, now + 1), true);
  check("not screaming after it ends", isScreaming(screamDuel, now + duration + 1), false);
}

// ---------------------------------------------------------------------------
// 9. Item-driven boss damage (§3.2, §3.4 rule 6)
// ---------------------------------------------------------------------------

section("9. Item-driven boss damage (§3.2)");

{
  const run = freshRun(321);
  check("no boss damage without items", bossDamageBonus(run), 0);
  run.equipment[0] = "sausage" === "sausage" ? "beefJerky" : null; // +400 flat
  const flat = bossDamageBonus(run);
  check("flat boss damage applies", flat, 400);
  run.equipment[1] = "scythe"; // +50%
  const withMultiplier = bossDamageBonus(run);
  check("percentage resolves last", withMultiplier, 600);
  // Derived, not accumulated: removing the item reverts it.
  run.equipment[1] = null;
  check("removing the item reverts its bonus", bossDamageBonus(run), 400);
}

// ---------------------------------------------------------------------------
// Verdict
// ---------------------------------------------------------------------------

console.log(`\n${failures === 0 ? "✓" : "✗"} ${passes} passed, ${failures} failed`);
if (failures > 0) {
  console.error("\nP8 acceptance harness FAILED.");
  process.exit(1);
}
console.log("P8 acceptance harness passed.");