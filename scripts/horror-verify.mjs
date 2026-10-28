#!/usr/bin/env node
// Verification for the two horror-mode bug fixes.
// Run: npx tsx scripts/horror-verify.mjs

import { createHorrorRun } from "../src/server-logic/horrorStore.ts";
import {
  beginHorrorDay,
  ensureHorrorDayStarted,
  endHorrorDay,
  tickMonster,
  playerStep,
  resolveChaseGuess,
} from "../src/server-logic/horrorEngine.ts";
import { dayTargetFor } from "../src/server-logic/horrorBoss.ts";

let failures = 0;
function check(label, actual, expected) {
  const ok = actual === expected;
  if (!ok) failures += 1;
  console.log(`${ok ? "PASS" : "FAIL"}  ${label}: ${actual}${ok ? "" : ` (expected ${expected})`}`);
}

console.log("=== FIX A: monster must not reset to 30 m ===");
const run = createHorrorRun({ seed: 12345, difficulty: "Normal" });
check("day 1 start distance", run.monster.distance, 30);
check("dayStarted marker set by createHorrorRun", run.dayStarted, 1);

// The act route calls ensureHorrorDayStarted before AND after every action.
ensureHorrorDayStarted(run);
const t1 = tickMonster(run, Date.now());
check("after 1 tick", t1.distanceAfter, 29);

ensureHorrorDayStarted(run); // post-action call — must be a no-op now
check("after post-action ensureHorrorDayStarted", run.monster.distance, 29);

// Ten more ticks must keep closing in, not snap back.
for (let i = 0; i < 10; i++) {
  ensureHorrorDayStarted(run);
  tickMonster(run, Date.now());
  ensureHorrorDayStarted(run);
}
check("after 11 total ticks", run.monster.distance, 19);

// A step pushes him back and survives the post-action call.
ensureHorrorDayStarted(run);
playerStep(run);
tickMonster(run, Date.now());
ensureHorrorDayStarted(run);
check("after step + tick", run.monster.distance, 19);

// A real day change must still reset.
const dayEnd = endHorrorDay(run, "guessed", { advanceDays: 1 });
check("day advanced", dayEnd.advanced, true);
check("new day resets distance", run.monster.distance, 30);
check("new day marker", run.dayStarted, 2);

// `beginHorrorDay` keeps its unconditional reset contract (engine tests rely on it).
beginHorrorDay(run);
check("beginHorrorDay still resets unconditionally", run.monster.distance, 30);

console.log("\n=== FIX B: guess must score against the seeded target ===");
const run2 = createHorrorRun({ seed: 12345, difficulty: "Normal" });
const target = dayTargetFor(run2);
console.log("seeded target:", target);

// A guess exactly on the target is a perfect 5000 and heals to full.
const perfect = resolveChaseGuess(run2, { guess: target, target });
check("perfect guess score", perfect.score, 5000);
check("perfect guess fullHeal", perfect.fullHeal, true);
check("perfect guess rejected", perfect.rejected, false);

// A guess ~100 km away must be accepted (above the day-1 gate of 1500).
const near = { lat: target.lat + 0.9, lng: target.lng };
const nearRes = resolveChaseGuess(run2, { guess: near, target });
console.log(`~100 km guess: distanceKm=${nearRes.distanceKm.toFixed(1)} score=${nearRes.score} rejected=${nearRes.rejected}`);
check("near guess accepted", nearRes.rejected, false);

// The old placeholder target must NOT be what we score against.
const oldStyle = resolveChaseGuess(run2, { guess: target, target: { lat: 0, lng: 0 } });
check("old placeholder would reject a perfect guess", oldStyle.rejected, true);

console.log("\n=== FIX C: a client-set day target is used for scoring ===");
const run3 = createHorrorRun({ seed: 777, difficulty: "Normal" });
const savedTarget = { lat: 48.8584, lng: 2.2945 };
const beforeSet = dayTargetFor(run3);
check(
  "unset target is not the saved one",
  beforeSet.lat !== savedTarget.lat || beforeSet.lng !== savedTarget.lng,
  true,
);

// The route stores the target for the day it belongs to (`dayTargetDay`).
run3.dayTarget = savedTarget;
run3.dayTargetDay = run3.day;
check("saved target used on its own day", dayTargetFor(run3), savedTarget);

// A target from a previous day must not leak into the current day.
run3.dayTargetDay = run3.day - 1;
check("stale target ignored on another day", dayTargetFor(run3) === savedTarget, false);
run3.dayTargetDay = run3.day;

// A guess exactly on the saved target scores a perfect 5000 and is accepted.
const savedRes = resolveChaseGuess(run3, {
  guess: savedTarget,
  target: dayTargetFor(run3),
});
check("saved-target guess distance (m)", Math.round(savedRes.distanceKm * 1000), 0);
check("saved-target guess rejected", savedRes.rejected, false);
check("saved-target guess score", savedRes.score, 5000);
check("saved-target guess fullHeal", savedRes.fullHeal, true);

console.log(`\n${failures === 0 ? "ALL CHECKS PASSED" : `${failures} CHECK(S) FAILED`}`);
process.exit(failures === 0 ? 0 : 1);
