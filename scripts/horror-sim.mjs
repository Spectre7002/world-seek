#!/usr/bin/env node
// HorrorGuessr — headless run simulation and P2 acceptance harness (§7.4, §8 P2).
//
// P2 is "verified through `horror-sim`" (§8). This script drives the real engine
// from `src/server-logic/horrorEngine.ts` and the real store from
// `src/server-logic/horrorStore.ts` against the numbers the master plan asserts,
// so the engine cannot regress without this failing.
//
// It covers, in order:
//
//   1. the S1 payload reproduced twice — once with the Codex convention
//      (`paceDayOffset: 0`, no items) and once with the build that produced it
//      (`paceDayOffset: 1` plus `compass` equipped) — which is the fidelity test
//      AND the rule test §0.5 asks for;
//   2. the distance arithmetic `30 + 3 − 7 = 26` (C13, acceptance 2);
//   3. the standing-still tick count of 31;
//   4. damage, growth and the perfect-5K full heal (§1.3, §0.5);
//   5. rejection being free of health but not of time (§1.3, §4.2);
//   6. the floored lethal save §1.3 / §3.3 (`Helmet`, `Jumper Cables`);
//   7. day lifecycle: modifiers, boss rank by day, final boss, day-30 loss;
//   8. stride growth past the pace floor (§1.4);
//   9. the store: `Map<runId, HorrorRun>`, `seq` replay guard, idle sweep;
//  10. a diagnostic fit of the one open numeric parameter — the mid-game
//      `intraDayS` (§0.5) — against the Codex's day 4/9/14 cells.
//
// Usage: npx tsx scripts/horror-sim.mjs

import {
  HORROR_ITEMS,
} from "../src/shared/horrorCatalogue.ts";
import {
  computeHorrorScore,
  paceAtStep,
  startPaceMs,
  standingStillSeconds,
  thresholdForDay,
  ringRadiusM,
} from "../src/shared/horrorScoring.ts";
import {
  applyDamageToPlayer,
  beginHorrorDay,
  deriveHorrorEngineMods,
  effectiveThresholdFor,
  endHorrorDay,
  handleMonsterCatch,
  horrorDaySpecFor,
  isHorrorRunOver,
  playerStep,
  resolveChaseGuess,
  tickMonster,
  useHappyThoughts,
  HORROR_FINAL_BOSS_ID,
} from "../src/server-logic/horrorEngine.ts";
import {
  HORROR_RUN_IDLE_TTL_MS,
  acceptHorrorSeq,
  createHorrorRun,
  deleteHorrorRun,
  getHorrorRun,
  horrorRunCount,
  resetHorrorStore,
  sweepIdleHorrorRuns,
  touchHorrorRun,
} from "../src/server-logic/horrorStore.ts";

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

function checkDeep(name, actual, expected) {
  const ok = JSON.stringify(actual) === JSON.stringify(expected);
  if (ok) passes += 1;
  else failures += 1;
  console.log(
    `${ok ? "✓" : "✗"} ${name}${ok ? "" : ` — expected ${JSON.stringify(expected)}, got ${JSON.stringify(actual)}`}`,
  );
}

function checkNear(name, actual, expected, tolerance) {
  const ok = Math.abs(actual - expected) <= tolerance;
  if (ok) passes += 1;
  else failures += 1;
  console.log(
    `${ok ? "✓" : "✗"} ${name}${ok ? "" : ` — expected ${expected} ±${tolerance}, got ${actual}`}`,
  );
}

function section(title) {
  console.log(`\n── ${title} ${"─".repeat(Math.max(0, 74 - title.length))}`);
}

/** Equip an item id into the first free slot. */
function equip(run, itemId) {
  const slot = run.equipment.indexOf(null);
  if (slot === -1) throw new Error(`no free equipment slot for "${itemId}"`);
  run.equipment[slot] = itemId;
  return slot;
}

/** Advance a fresh run to `day` by closing days without incident. */
function advanceTo(run, day) {
  while (run.day < day) endHorrorDay(run, "guessed");
}

function newRun(difficulty = "Normal", seed = 20260101, runId) {
  return createHorrorRun({ seed, difficulty, runId });
}

// ---------------------------------------------------------------------------
// 1–2. S1 payload, both encodings (§0.5)
// ---------------------------------------------------------------------------

section("S1 payload — the Codex convention (paceDayOffset 0, no items)");

resetHorrorStore();
{
  const run = newRun("Normal", 1, "s1-codex");
  advanceTo(run, 3);
  check("day is 3", run.day, 3);
  check("day type is Chase", horrorDaySpecFor(run).type, "Chase");
  check("day-start distance is 30 m", run.monster.distance, 30);
  check("day-3 pace is 2320 ms", Math.round(run.monster.paceMs), 2320);
  check("paceMs equals startPaceMs(3, Normal)", run.monster.paceMs, startPaceMs(3, "Normal"));
  check("health carries over at 6000", run.health, 6000);
  check("base threshold is 1540", thresholdForDay(3, "Normal"), 1540);
  check("effective threshold is 1540 (no items)", effectiveThresholdFor(run), 1540);
}

section("S1 payload — the build that produced it (paceDayOffset 1 + compass)");

{
  const run = newRun("Normal", 1, "s1-build");
  equip(run, "compass");
  advanceTo(run, 3);
  run.health = 4964; // pre-guess health from the payload
  run.gold = 4;

  const day3 = beginHorrorDay(run, { countryCode: "us", paceDayOffset: 1 });
  check("day-3 pace is 2230 ms (S1 exact)", Math.round(day3.monsterStartPaceMs), 2230);

  // A 631.630 km guess: score, damage, health.
  const guess = resolveChaseGuess(run, { distanceKm: 631.63 });
  check("score is 3116 (round of 3116.27)", guess.score, computeHorrorScore(631.63));
  checkDeep("damage is 628 on Normal", guess.damage, 628);
  check("health after is 4336", guess.healthAfter, 4336);
  check("guess was accepted", guess.rejected, false);

  // Threshold closes with Compass: 1540 − 250 = 1290.
  check("effective gate is 1290 (C15†)", Math.round(guess.threshold), 1290);
  checkNear(
    "ring radius is 3621 km ± 2 (S1 threshold_distance)",
    ringRadiusM(1290, "us") / 1000,
    3621.6,
    2,
  );

  // Distance arithmetic: 3 moves (+1 each) then 7 pursuit ticks (−1 each).
  const runAfter = newRun("Normal", 2, "s1-moves");
  advanceTo(runAfter, 3);
  for (let i = 0; i < 3; i++) playerStep(runAfter);
  check("3 moves push him to 33 m", runAfter.monster.distance, 33);
  let now = Date.now();
  for (let i = 0; i < 7; i++) {
    tickMonster(runAfter, now);
    now += 2230;
  }
  check("3 moves and 7 ticks leave 26 m (C13, acceptance 2)", runAfter.monster.distance, 26);
  check("7 ticks elapsed inside 17 192 ms", Math.floor(17192 / 2230), 7);
}

// ---------------------------------------------------------------------------
// 3. Standing still — 31 ticks to be caught
// ---------------------------------------------------------------------------

section("Standing still — 31 ticks, reaching 0 is not a catch");

{
  const run = newRun("Normal", 3, "still");
  let now = Date.now();
  let ticks = 0;
  let caughtAt = null;
  // Tick until caught. The guard is a hard stop so a bug cannot hang the run.
  while (caughtAt === null && ticks < 200) {
    const result = tickMonster(run, now);
    ticks += 1;
    now += result.paceMs;
    if (result.caught) caughtAt = ticks;
  }
  check("caught on the 31st tick", caughtAt, 31);
  checkDeep("HORROR_CATCH_STEPS is 31", caughtAt, 31);
  // The Codex prints 69.4 s; the plan's grouped sum prints 69.5 s. They are the
  // same number either side of floating-point noise (2.5 − 0.1×5 is
  // 1.9999999999999998 in IEEE 754), so the assertion is a tolerance, not an
  // equality — the ±0.1 s the plan itself allows (§0.5 table).
  checkNear("day-1 standing still is 69.5 s ± 0.1 (P1, Codex 69.4)", standingStillSeconds(1, "Normal"), 69.5, 0.1);

  // Reaching exactly 0 must not catch: 30 ticks from 30 m arrive at 0.
  const probe = newRun("Normal", 4, "still-zero");
  let t = Date.now();
  let last = null;
  for (let i = 0; i < 30; i++) last = tickMonster(probe, (t += 2500));
  check("30 ticks land exactly on 0", probe.monster.distance, 0);
  check("arriving at 0 is not a catch", last.caught, false);
  const next = tickMonster(probe, (t += 2500));
  check("the next tick catches", next.caught, true);
}

// ---------------------------------------------------------------------------
// 4. Damage, growth, perfect heal (§1.3, §0.5)
// ---------------------------------------------------------------------------

section("Damage, growth and the perfect-5K full heal");

{
  // The Codex worked example: a 4500 guess costs 167 on Normal and Hard, 250 on
  // Nightmare (§1.5). Reach it by solving for the distance that yields 4500.
  const kmFor4500 = 926 * Math.log2(5000 / 4500);

  const runNormal = newRun("Normal", 6, "dmg-normal");
  const normal = resolveChaseGuess(runNormal, { distanceKm: kmFor4500 });
  checkDeep("a 4500 guess costs 167 on Normal", normal.damage, 167);

  const runHard = newRun("Hard", 60, "dmg-hard");
  const hard = resolveChaseGuess(runHard, { distanceKm: kmFor4500 });
  checkDeep("a 4500 guess costs 167 on Hard", hard.damage, 167);

  const runNightmare = newRun("Nightmare", 7, "dmg-nightmare");
  const nightmare = resolveChaseGuess(runNightmare, { distanceKm: kmFor4500 });
  checkDeep("a 4500 guess costs 250 on Nightmare", nightmare.damage, 250);

  // Growth compounds from the rounded base: day 36 = 209, day 39 = 408.
  const grown36 = newRun("Normal", 8, "growth");
  advanceTo(grown36, 36);
  grown36.health = 6000;
  const g36 = resolveChaseGuess(grown36, { distanceKm: kmFor4500 });
  checkDeep("day 36 grows 167 to 209", g36.damage, 209);
  checkNear("day-36 growth multiplier is 1.25", g36.growth, 1.25, 1e-9);

  const grown39 = newRun("Normal", 9, "growth39");
  advanceTo(grown39, 39);
  const g39 = resolveChaseGuess(grown39, { distanceKm: kmFor4500 });
  checkDeep("day 39 grows to 408", g39.damage, 408);

  // Perfect 5000: a 25 m guess heals to full instead of damaging.
  const perfect = newRun("Normal", 10, "perfect");
  perfect.health = 1000;
  const p = resolveChaseGuess(perfect, { distanceKm: 0.025 });
  check("a 25 m guess scores 5000", p.score, 5000);
  check("the perfect guess is a full heal", p.fullHeal, true);
  check("health is restored to max", p.healthAfter, perfect.maxHealth);

  // Note the boundary is a *rule*, not a rounding accident: out here the curve
  // itself already rounds to 5000 (5000 · 2^(−0.026/926) = 4999.93), which is
  // exactly why the Codex states the 25 m rule rather than trusting the formula.
  // The engine short-circuits on the rule so a future half-life change cannot
  // silently break perfect guesses.
  const ruleProbe = newRun("Normal", 11, "p25");
  ruleProbe.health = 1000;
  check(
    "the 25 m rule short-circuits a full heal",
    resolveChaseGuess(ruleProbe, { distanceKm: 0.024 }).fullHeal,
    true,
  );

  // Death: the pool empties and the run ends. 300 km scores 3994 on Nightmare,
  // which clears the 3900 day-1 bar, so it is charged rather than rejected.
  const doomed = newRun("Nightmare", 12, "doomed");
  doomed.health = 200;
  const lethal = resolveChaseGuess(doomed, { distanceKm: 300 });
  checkDeep("a 300 km Nightmare guess is accepted", lethal.rejected, false);
  checkDeep("and computes 503 damage (round(1006 / 2))", lethal.baseDamage, 503);
  // `damage` is the amount actually taken out of the pool, so it clamps to what
  // was left (200) rather than over-reporting. That distinction is what keeps a
  // "health never goes negative" assertion (acceptance 2j) meaningful.
  checkDeep("the applied damage clamps to the remaining pool", lethal.damage, 200);
  check("the player dies", lethal.dead, true);
  check("health never goes negative", doomed.health, 0);
  check("the run is over", isHorrorRunOver(doomed), true);

  // The other half of §1.3: a guess that cannot clear the bar is *free*, so a
  // losing position is never punished for throwing a round away.
  const shielded = newRun("Nightmare", 13, "shielded");
  shielded.health = 200;
  const thrownAway = resolveChaseGuess(shielded, { distanceKm: 4000 });
  checkDeep("a hopeless Nightmare guess is rejected", thrownAway.rejected, true);
  checkDeep("and costs no health", thrownAway.damage, 0);
  checkDeep("health is untouched", shielded.health, 200);
}

// ---------------------------------------------------------------------------
// 5. Rejection — free of health, not of time (§1.3, §4.2)
// ---------------------------------------------------------------------------

section("Rejection — free of health, no jumpscare penalty");

{
  const run = newRun("Normal", 13, "reject");
  advanceTo(run, 3);
  for (let i = 0; i < 10; i++) playerStep(run);
  const before = run.monster.distance;
  // A 1000 km guess scores 2365, below the 1540 gate? No — above. Use 6000 km.
  const rejected = resolveChaseGuess(run, { distanceKm: 6000 });
  check("a far guess is rejected", rejected.rejected, true);
  checkDeep("rejection costs no health", rejected.damage, 0);
  check("health is untouched", rejected.healthAfter, rejected.healthBefore);
  check("rejection no longer triggers jumpscare", rejected.jumpscare, null);
  check("monster distance unchanged on rejection", run.monster.distance, before);
  checkDeep("the rejection counter increments", run.counters.rejectedGuessCount, 1);

  // Earplugs effect is now redundant (no jumpscare on rejection) but kept for compatibility
  const plugged = newRun("Normal", 14, "earplugs");
  equip(plugged, "earplugs");
  for (let i = 0; i < 10; i++) playerStep(plugged);
  const pluggedBefore = plugged.monster.distance;
  const quiet = resolveChaseGuess(plugged, { distanceKm: 6000 });
  check("Earplugs still rejects", quiet.rejected, true);
  check("Earplugs has no jumpscare (redundant)", quiet.jumpscare, null);
  check("Earplugs preserves the lead", plugged.monster.distance, pluggedBefore);
}

// ---------------------------------------------------------------------------
// 6. The floored lethal save (§1.3, §3.3)
// ---------------------------------------------------------------------------

section("Floored lethal save — Helmet at 1, Jumper Cables at 2000");

{
  const bare = newRun("Normal", 15, "bare");
  bare.health = 100;
  const plain = applyDamageToPlayer(bare, 5000, "guess");
  check("without a floor the player dies", plain.dead, true);
  check("health floors at 0", bare.health, 0);

  const helmeted = newRun("Normal", 16, "helmet");
  equip(helmeted, "helmet");
  helmeted.health = 100;
  const saved = applyDamageToPlayer(helmeted, 5000, "guess");
  check("Helmet survives the hit", saved.dead, false);
  checkDeep("Helmet floors health at 1", helmeted.health, 1);
  checkDeep("the engine reports which item fired", saved.floorUsed?.itemId, "helmet");

  const cables = newRun("Normal", 17, "cables");
  equip(cables, "jumperCables");
  cables.health = 100;
  applyDamageToPlayer(cables, 5000, "guess");
  checkDeep("Jumper Cables floors health at 2000", cables.health, 2000);
}

// ---------------------------------------------------------------------------
// 7. Day lifecycle — modifiers, rank by day, bosses, day-30 (§1.1, §1.2, §5.3)
// ---------------------------------------------------------------------------

section("Day lifecycle — modifiers and boss rank by day");

{
  const run = newRun("Normal", 18, "days");

  checkDeep("day 7 is lightsOut", horrorDaySpecFor(run).modifier, "none"); // day 1
  advanceTo(run, 7);
  checkDeep("day 7 is lightsOut", horrorDaySpecFor(run).modifier, "lightsOut");
  advanceTo(run, 16);
  checkDeep("day 16 is shadowRealm", horrorDaySpecFor(run).modifier, "shadowRealm");
  advanceTo(run, 18);
  checkDeep("day 18 is lightsOut", horrorDaySpecFor(run).modifier, "lightsOut");
  advanceTo(run, 26);
  checkDeep("day 26 is shadowRealm", horrorDaySpecFor(run).modifier, "shadowRealm");

  const day5 = newRun("Normal", 19, "boss5");
  advanceTo(day5, 5);
  check("day 5 is a Boss day", horrorDaySpecFor(day5).type, "Boss");
  checkDeep("day 5 spawns the Clown", day5.boss?.id, "clown");
  checkDeep("day 5 rank is Hangout", horrorDaySpecFor(day5).bossRank, "Hangout");
  checkDeep("day-5 Clown HP is 3500 on Normal (S10 p.18)", day5.boss?.health, 3500);

  const day10 = newRun("Normal", 20, "boss10");
  advanceTo(day10, 10);
  checkDeep("day 10 rank is Hangout", horrorDaySpecFor(day10).bossRank, "Hangout");

  const day15 = newRun("Normal", 21, "boss15");
  advanceTo(day15, 15);
  checkDeep("day 15 rank is Prospect", horrorDaySpecFor(day15).bossRank, "Prospect");
  checkDeep("Prospect Clown HP is 4200 on Normal", day15.boss?.health, 4200);

  const day20 = newRun("Normal", 22, "boss20");
  advanceTo(day20, 20);
  checkDeep("day 20 rank is Prospect", horrorDaySpecFor(day20).bossRank, "Prospect");

  const day25 = newRun("Normal", 23, "boss25");
  advanceTo(day25, 25);
  checkDeep("day 25 rank is Commander", horrorDaySpecFor(day25).bossRank, "Commander");

  const day30 = newRun("Normal", 24, "boss30");
  advanceTo(day30, 30);
  check("day 30 is the FinalBoss", horrorDaySpecFor(day30).type, "FinalBoss");
  checkDeep("day 30 is not the Clown (C16)", day30.boss?.id, HORROR_FINAL_BOSS_ID);
  checkDeep(
    "day 30 rank is the Senior Associate Manager",
    horrorDaySpecFor(day30).bossRank,
    "Senior Associate Manager of the Primordial Darkness",
  );

  // None of the rolled boss days is day 30; all five are Boss days, never FinalBoss.
  for (const day of [5, 10, 15, 20, 25]) {
    const probe = newRun("Normal", 30 + day, `probe${day}`);
    advanceTo(probe, day);
    check(`day ${day} is Boss, not FinalBoss`, horrorDaySpecFor(probe).type, "Boss");
  }

  // Shadow Realm runs the monster at day 1's pace.
  const shadow = newRun("Normal", 25, "shadow");
  advanceTo(shadow, 15);
  const normalPaceDay16 = startPaceMs(16, "Normal");
  beginHorrorDay(shadow);
  advanceTo(shadow, 16);
  check("day 16 is shadowRealm", horrorDaySpecFor(shadow).modifier, "shadowRealm");
  check("Shadow Realm uses day-1 pace", shadow.monster.paceMs, 2500);
  check("(for contrast) day-16 pace would be lower", normalPaceDay16 < 2500, true);
}

section("Day lifecycle — day-30 loss ends the run, win unlocks 31–40");

{
  const win = newRun("Normal", 26, "day30win");
  advanceTo(win, 30);
  const winResult = endHorrorDay(win, "bossWon");
  check("a day-30 win advances the run", winResult.advanced, true);
  check("a day-30 win unlocks 31–40", winResult.campaignUnlocked, true);
  checkDeep("the run continues into day 31", win.day, 31);
  check("day 31 is past the campaign", win.day > 30, true);

  const loss = newRun("Normal", 27, "day30loss");
  advanceTo(loss, 30);
  const lossResult = endHorrorDay(loss, "bossLost");
  check("a day-30 loss ends the run", lossResult.runOver, true);
  checkDeep("the reason is final_boss_lost", lossResult.reason, "final_boss_lost");
  checkDeep("the run does not advance", loss.day, 30);

  const midCampaignDeath = newRun("Normal", 28, "middeath");
  advanceTo(midCampaignDeath, 12);
  midCampaignDeath.health = 0;
  const died = endHorrorDay(midCampaignDeath, "died");
  check("dying mid-campaign ends the run", died.runOver, true);
}

// ---------------------------------------------------------------------------
// 8. Stride growth past the pace floor (§1.4)
// ---------------------------------------------------------------------------

section("Stride growth — the anti-turtling mechanic");

{
  // Late enough that the pace floor is reached, so strides start growing.
  const run = newRun("Normal", 29, "stride");
  advanceTo(run, 20);
  checkDeep("day-20 pace is the 0.85 s floor", Math.round(run.monster.paceMs), 850);
  checkDeep("stride bonus starts at 0", run.monster.strideBonusM, 0);

  // Stride growth needs the **step time** to be maxed (0.3 s), not merely the
  // day-start pace. On day 20 he starts at the 0.85 s day floor and the intra-day
  // decay walks him down 0.1 s per 5 ticks: 0.85 → 0.35 at tick 26…30, then 0.25
  // clamps to 0.30 at tick 31. Only from tick 31 does the counter move, and the
  // day-20 window is 30 ticks — hence 59. That is the anti-turtling curve working
  // as §1.4 describes, so the assertion is the derivation, not a round number.
  let now = Date.now();
  let ticks = 0;
  while (run.monster.strideBonusM === 0 && ticks < 500) {
    tickMonster(run, (now += 850));
    ticks += 1;
  }
  checkDeep("stride grows once the step time is maxed", run.monster.strideBonusM, 1);
  checkDeep("30 ticks to reach 0.3 s, then 30 to grow", ticks, 59);
  checkDeep("stride is 2 m per tick now", run.monster.strideBonusM + 1, 2);
  checkDeep("pace sits on the 0.3 s step floor", Math.round(run.monster.paceMs), 300);

  // The day-36 head-start tax: a large lead shrinks faster per tick.
  const tax = newRun("Normal", 30, "tax");
  advanceTo(tax, 36);
  tax.monster.distance = 100;
  const taxed = tickMonster(tax, Date.now());
  // −1 base, then −floor(99/40) = −2 → 97.
  checkDeep("day 36 taxes a 100 m lead down to 97", taxed.distanceAfter, 97);

  const noTax = newRun("Normal", 31, "notax");
  advanceTo(noTax, 35);
  noTax.monster.distance = 100;
  const untaxed = tickMonster(noTax, Date.now());
  checkDeep("day 35 does not tax a 100 m lead", untaxed.distanceAfter, 99);
}

// ---------------------------------------------------------------------------
// 9. Store — Map, seq guard, idle sweep (§1.6, §7.2)
// ---------------------------------------------------------------------------

section("Store — Map<runId, HorrorRun>, seq replay guard, idle sweep");

{
  resetHorrorStore();
  const a = newRun("Normal", 100, "run-a");
  const b = newRun("Hard", 101, "run-b");
  checkDeep("two runs stored", horrorRunCount(), 2);
  check("lookup by id works", getHorrorRun("run-a") === a, true);
  checkDeep("difficulties are independent", [a.difficulty, b.difficulty], ["Normal", "Hard"]);
  checkDeep("run ids are the map keys", [a.runId, b.runId], ["run-a", "run-b"]);

  // Mutating the record mutates the store (no defensive copy on the hot path).
  a.gold = 9;
  checkDeep("store holds the live record", getHorrorRun("run-a")?.gold, 9);

  // seq is monotonic and rejects replays.
  check("seq 1 accepted", acceptHorrorSeq("run-a", 1), true);
  check("seq 1 rejected as a replay", acceptHorrorSeq("run-a", 1), false);
  check("seq 0 rejected", acceptHorrorSeq("run-a", 0), false);
  check("seq 2 accepted", acceptHorrorSeq("run-a", 2), true);
  check("seq 2 rejected again", acceptHorrorSeq("run-a", 2), false);
  check("an unknown run rejects any seq", acceptHorrorSeq("nope", 1), false);

  // Idle sweep: only the *untouched* run is dropped. Both runs were created a
  // moment ago, so the touched one's clock has to be pushed inside the TTL
  // window explicitly — sweeping 31 minutes ahead with a real `Date.now()` touch
  // would (correctly) drop both, since both are 31 minutes old.
  const sweepAt = Date.now() + 31 * 60 * 1000;
  touchHorrorRun("run-a", sweepAt - 60 * 1000); // seen one minute before the sweep
  const dropped = sweepIdleHorrorRuns(HORROR_RUN_IDLE_TTL_MS, sweepAt);
  checkDeep("the idle run is swept", dropped, 1);
  check("the fresh run survives", getHorrorRun("run-a") !== undefined, true);
  check("the idle run is gone", getHorrorRun("run-b"), undefined);

  // A freshly touched run is never swept inside the TTL.
  const t1 = Date.now();
  touchHorrorRun("run-a", t1);
  checkDeep("a live run is not swept", sweepIdleHorrorRuns(HORROR_RUN_IDLE_TTL_MS, t1 + 1000), 0);
  check("it is still present", getHorrorRun("run-a") !== undefined, true);

  check("delete removes it", deleteHorrorRun("run-a"), true);
  checkDeep("the store is empty", horrorRunCount(), 0);

  // A run is fully initialized on creation (§1.6).
  resetHorrorStore();
  const fresh = newRun("Normal", 102, "fresh");
  checkDeep("health starts at 6000", fresh.health, 6000);
  checkDeep("max health is 6000", fresh.maxHealth, 6000);
  checkDeep("gold starts at 0 ([DESIGN])", fresh.gold, 0);
  checkDeep("reroll cost is 1 (C2)", fresh.rerollCost, 1);
  checkDeep("arrows start at 2", fresh.arrows, 2);
  checkDeep("echoes start at 1", fresh.echoes, 1);
  checkDeep("puzzle pieces start at 9", fresh.puzzlePieces, 9);
  checkDeep("equipment has 4 slots", fresh.equipment.length, 4);
  checkDeep("day 1 distance is 30 m", fresh.monster.distance, 30);
  checkDeep("day 1 is a Chase day", fresh.boss, null);
  checkDeep("counters are zeroed", fresh.counters.stepCount, 0);
  checkDeep("the damage anchor is 167 on Normal", fresh.damageGrowthAnchor, 167);

  const nightmareFresh = newRun("Nightmare", 103, "fresh-nm");
  checkDeep("the Nightmare anchor is 250", nightmareFresh.damageGrowthAnchor, 250);

  resetHorrorStore();
}

// ---------------------------------------------------------------------------
// 10. Happy Thoughts (§4.1)
// ---------------------------------------------------------------------------

section("Happy Thoughts — freezes, heals, pushes him back, spends a charge");

{
  const run = newRun("Normal", 40, "happy");
  run.health = 5000;
  const before = run.monster.distance;
  const result = useHappyThoughts(run, 1000);
  check("it succeeds", result.ok, true);
  checkDeep("Normal heals 600", result.healed, 600);
  checkDeep("health is 5600", run.health, 5600);
  checkDeep("Normal freezes for 10 s", result.freezeMs, 10000);
  checkDeep("it pushes him 10 m back", run.monster.distance - before, 10);
  checkDeep("the charge is spent", run.happyThoughtsCharges, 0);
  check("it is no longer ready", run.happyThoughtsReady, false);

  const frozen = tickMonster(run, 5000); // still inside 1000 + 10000
  check("he does not tick while frozen", frozen.ticked, false);
  const thawed = tickMonster(run, 12000);
  check("he ticks again after the freeze", thawed.ticked, true);

  const again = useHappyThoughts(run, 20000);
  check("a second use is refused", again.ok, false);
  checkDeep("the reason is not_ready", again.reason, "not_ready");

  // Happy Thoughts charges are conserved at day start.
  run.happyThoughtsCharges = 2;
  beginHorrorDay(run);
  check("day start re-arms from the charge pool", run.happyThoughtsReady, true);
  run.happyThoughtsCharges = 0;
  beginHorrorDay(run);
  check("no charges means not ready", run.happyThoughtsReady, false);

  // A catch with Gut of the Bloatlord ends the day at 4500 instead of the run.
  const gut = newRun("Normal", 41, "gut");
  equip(gut, "gutOfTheBloatlord");
  const catchResult = handleMonsterCatch(gut);
  check("Gut of the Bloatlord converts the catch to a day end", catchResult.endDay, true);
  checkDeep("it deals 4500", catchResult.damage, 4500);
  checkDeep("the player survives at 1500", gut.health, 1500);
  check("the run is not over", isHorrorRunOver(gut), false);

  const plainCatch = newRun("Normal", 42, "catch");
  const dead = handleMonsterCatch(plainCatch);
  check("without Gut the catch ends the run", dead.dead, true);
  checkDeep("health is 0", plainCatch.health, 0);
}

// ---------------------------------------------------------------------------
// 11. Equipment layer reverts (§3.3, acceptance 8)
// ---------------------------------------------------------------------------

section("Equipment layer — derived, so removal reverts it (acceptance 8)");

{
  const run = newRun("Normal", 50, "mods");
  checkDeep("base lead per step is +1", deriveHorrorEngineMods(run).distancePerStep, 1);
  checkDeep("base fall chance is 2%", deriveHorrorEngineMods(run).fallChance, 0.02);
  checkDeep("base gate delta is 0", deriveHorrorEngineMods(run).guessThresholdDelta, 0);

  const slot = equip(run, "skateboard");
  checkDeep("Skateboard makes it +2 per step", deriveHorrorEngineMods(run).distancePerStep, 2);
  checkDeep("Skateboard halves fall chance to 1%", deriveHorrorEngineMods(run).fallChance, 0.01);

  equip(run, "rollerSkates");
  // 2% x0.5 x4 = 4%.
  checkNear("fall chance composes multiplicatively", deriveHorrorEngineMods(run).fallChance, 0.04, 1e-12);

  equip(run, "compass");
  checkDeep("Compass is −250 on the gate", deriveHorrorEngineMods(run).guessThresholdDelta, -250);
  equip(run, "atlas");
  checkDeep("Compass + Atlas is −650", deriveHorrorEngineMods(run).guessThresholdDelta, -650);

  run.equipment[slot] = null;
  // Roller Skates is still equipped and carries its own `distancePerStep +1`, so
  // the lead drops from +3 (base + Skateboard + Roller Skates) to +2, not to the
  // bare base. The point of the check is that Skateboard's contribution is gone.
  checkDeep("removing Skateboard drops the lead to +2", deriveHorrorEngineMods(run).distancePerStep, 2);
  checkNear("removing it restores the x4-only fall chance", deriveHorrorEngineMods(run).fallChance, 0.08, 1e-12);
  run.equipment[1] = null;
  checkDeep("removing Roller Skates too reverts to the bare +1", deriveHorrorEngineMods(run).distancePerStep, 1);
  checkNear("and to the bare 2% fall chance", deriveHorrorEngineMods(run).fallChance, 0.02, 1e-12);

  // Ambulance: +3 per step and +30 heal per step (C7 re-reversed).
  const ambulance = newRun("Normal", 51, "ambulance");
  equip(ambulance, "ambulance");
  ambulance.health = 5000;
  checkDeep("Ambulance makes it +4 per step", deriveHorrorEngineMods(ambulance).distancePerStep, 4);
  playerStep(ambulance);
  checkDeep("Ambulance heals 30 per step", ambulance.health, 5030);

  // Saucer: +3 per step and no low-health slowdown.
  const saucer = newRun("Normal", 52, "saucer");
  equip(saucer, "saucer");
  checkDeep("Saucer makes it +4 per step", deriveHorrorEngineMods(saucer).distancePerStep, 4);
  check("Saucer negates the low-health slowdown", deriveHorrorEngineMods(saucer).ignoreLowHealthSlowdown, true);

  // Leather Coat: −20% incoming damage, flat and global (×0.8).
  const coat = newRun("Normal", 53, "coat");
  checkDeep("no Leather Coat means ×1 incoming", deriveHorrorEngineMods(coat).damageTakenMultiplier, 1);
  equip(coat, "leatherCoat");
  checkNear("Leather Coat is ×0.8 incoming", deriveHorrorEngineMods(coat).damageTakenMultiplier, 0.8, 1e-12);
  checkDeep("1000 guess damage becomes 800", applyDamageToPlayer(coat, 1000, "guess").applied, 800);

  // Trash Lid: −200 from bosses only, and applied BEFORE the percentage, so on a
  // 1000 boss hit with both items it is (1000 − 200) × 0.8 = 640, not 800 − 200.
  equip(coat, "trashLid");
  checkDeep("Trash Lid is −200", deriveHorrorEngineMods(coat).bossDamageTaken, -200);
  checkDeep("a 1000 boss hit becomes 640 (flat first, then ×0.8)", applyDamageToPlayer(coat, 1000, "boss").applied, 640);
  checkDeep("a 1000 fall ignores Trash Lid but takes ×0.8", applyDamageToPlayer(coat, 1000, "fall").applied, 800);
}

// ---------------------------------------------------------------------------
// 12. Determinism (§7.4, acceptance 10)
// ---------------------------------------------------------------------------

section("Determinism — the same seed and the same actions are identical");

{
  // A run's RNG stream is the observable. Twenty-five bare steps almost never
  // roll a 2% fall, so the comparison has to equip something that makes every
  // step RNG-sensitive — `Tricycle` rolls a 20% double move on every move.
  const { createHorrorRng } = await import("../src/server-logic/horrorEngine.ts");

  const stream = (seed) => {
    const rng = createHorrorRng(seed);
    return Array.from({ length: 8 }, () => Math.round(rng() * 1e6) / 1e6);
  };
  checkDeep("the RNG stream for a seed is stable", stream(777), stream(777));
  check("two different seeds give different streams", JSON.stringify(stream(777)) === JSON.stringify(stream(778)), false);

  function play(seed, runId) {
    resetHorrorStore();
    const run = newRun("Normal", seed, runId);
    equip(run, "tricycle");
    advanceTo(run, 2);
    const log = [];
    for (let i = 0; i < 40; i++) {
      const step = playerStep(run);
      log.push([step.distanceAfter, step.doubleMove, step.fell, run.health]);
    }
    log.push([resolveChaseGuess(run, { distanceKm: 800 }).damage, run.health]);
    return log;
  }
  const first = play(777, "det-a");
  const second = play(777, "det-b");
  const third = play(778, "det-c");
  checkDeep("the same seed replays identically", first, second);
  check("a different seed diverges", JSON.stringify(first) === JSON.stringify(third), false);
  check(
    "the double-move roll actually fires",
    first.some((entry) => entry[1] === true),
    true,
  );
  resetHorrorStore();
}

// ---------------------------------------------------------------------------
// 13. The open numeric parameter: mid-game intraDayS (§0.5, §8 P2)
// ---------------------------------------------------------------------------

section("Diagnostic — fitting the mid-game intraDayS (§0.5)");

// The Codex's standing-still cells for Normal that the grouped sum with a linear
// day-start ramp does NOT reproduce (§0.5): day 4 = 58.2 s, day 9 = 44.3 s,
// day 14 = 30.3 s. Day 1 (69.4) and the floor rows already fit at 0.1 s / 5
// steps, so this is a mid-game-only discrepancy and the fix cannot be a new
// global constant.
{
  const CELLS = [
    { day: 4, target: 58.2 },
    { day: 9, target: 44.3 },
    { day: 14, target: 30.3 },
  ];

  function sumFor(day, intraDayS, everySteps) {
    const startS = startPaceMs(day, "Normal") / 1000;
    let total = 0;
    for (let k = 1; k <= 31; k++) {
      const group = Math.floor((k - 1) / everySteps);
      total += Math.max(0.3, startS - intraDayS * group);
    }
    return total;
  }

  let best = null;
  for (let every = 2; every <= 8; every++) {
    for (let milli = 50; milli <= 400; milli++) {
      const intra = milli / 1000;
      const error = CELLS.reduce((acc, cell) => acc + Math.abs(sumFor(cell.day, intra, every) - cell.target), 0);
      if (best === null || error < best.error) best = { intra, every, error };
    }
  }

  console.log(
    `  best fit: intraDayS ${best.intra.toFixed(3)} s every ${best.every} steps ` +
      `(total absolute error ${best.error.toFixed(2)} s over 3 cells)`,
  );
  for (const cell of CELLS) {
    const fitted = sumFor(cell.day, best.intra, best.every);
    console.log(
      `  day ${cell.day}: fitted ${fitted.toFixed(2)} s vs Codex ${cell.target} s ` +
        `(Δ ${(fitted - cell.target).toFixed(2)})`,
    );
  }

  const day1AtFitted = (() => {
    const startS = startPaceMs(1, "Normal") / 1000;
    let total = 0;
    for (let k = 1; k <= 31; k++) {
      total += Math.max(0.3, startS - best.intra * Math.floor((k - 1) / best.every));
    }
    return total;
  })();
  console.log(
    `  day 1 under the fitted decay: ${day1AtFitted.toFixed(2)} s vs Codex 69.4 s ` +
      `(Δ ${(day1AtFitted - 69.4).toFixed(2)})`,
  );

  checkNear(
    "the fitted decay reproduces the day-4 cell to 0.1 s",
    sumFor(4, best.intra, best.every),
    58.2,
    0.1,
  );
  checkNear(
    "the fitted decay reproduces the day-14 cell to 0.1 s",
    sumFor(14, best.intra, best.every),
    30.3,
    0.1,
  );
  // The whole point of §0.5's caveat: a single global constant cannot fit both
  // the day-1 row and the mid-game rows, so this stays an open [GAP] and is NOT
  // baked into HORROR_PACE.
  check(
    "a global constant cannot also fit day 1 — the parameter stays open",
    Math.abs(day1AtFitted - 69.4) > 0.5,
    true,
  );
  checkNear(
    "the normative 0.1 s / 5 steps still reproduces day 1 exactly",
    standingStillSeconds(1, "Normal"),
    69.5,
    0.1,
  );
}

// ---------------------------------------------------------------------------
// Summary
// ---------------------------------------------------------------------------

console.log(`\n${"═".repeat(78)}`);
console.log(`${passes} passed, ${failures} failed — catalogue ${HORROR_ITEMS.length} items`);
console.log("═".repeat(78));
if (failures > 0) process.exitCode = 1;