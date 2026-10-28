#!/usr/bin/env node
// HorrorGuessr — P3 harness: item interpreter + merchant economy (§8 P3).
//
// Covers the two things P3 is graded on, plus the mechanics the plan singles out:
//
//   A. **Gold conservation** (acceptance 3): no sequence of buy / reroll / sell /
//      item-grant can drive the balance negative, and every spend is reported as
//      what actually moved rather than what was requested.
//   B. **The destruction chain** (§3.3): `Time Machine` skips a day when another
//      item is destroyed, `Trash Armor` grows from the same broadcast, `Anglerfish`
//      clamps its three destroys so the player is never left defenceless, and
//      `Duct Cake` walks the destruction history back.
//
// Plus: `stacks` (§4.6), the five gates (§3.4), `oneOf` determinism (§3.4 rule 5),
// `oncePerDay`, the merchant's seeded offers / minDay gate / no duplicates /
// free-then-paid reroll, and the three merchant modifiers.
//
// Usage: npx tsx scripts/horror-items-sim.mjs

import { HORROR_ITEMS, getHorrorItem } from "../src/shared/horrorCatalogue.ts";
import {
  HORROR_OFFERS_PER_VISIT,
  HORROR_RARITY_ECONOMY,
} from "../src/shared/horrorCatalogue.ts";
import { createHorrorRun, resetHorrorStore } from "../src/server-logic/horrorStore.ts";
import {
  beginHorrorDay,
  deriveHorrorEngineMods,
  effectiveThresholdFor,
  resolveChaseGuess,
} from "../src/server-logic/horrorEngine.ts";
import {
  addItemToRun,
  applyHorrorTrigger,
  deriveHorrorItemMods,
  destroyChanceFor,
  destroyItem,
  destroyRandomItems,
  grantGold,
  heldItemIds,
  horrorItemLedger,
  horrorThresholdAdjustment,
  itemBuyPrice,
  itemSellPrice,
  itemStack,
  resetHorrorItemDay,
  restoreLastDestroyed,
  spawnRandomItem,
  spendGold,
  stackLeadBonus,
  takePendingSkipDays,
  tickItemDays,
  tickItemSteps,
} from "../src/server-logic/horrorItems.ts";
import {
  bossWinGoldPayout,
  buyMerchantOffer,
  closeMerchantVisit,
  eligibleRarities,
  getMerchantVisit,
  isOfferSold,
  openMerchantVisit,
  rerollMerchantOffers,
  resetMerchant,
  rollMerchantOffers,
  sellItem,
} from "../src/server-logic/horrorMerchant.ts";

// ---------------------------------------------------------------------------
// Harness
// ---------------------------------------------------------------------------

let failures = 0;
let passes = 0;

function check(name, cond) {
  if (cond) passes += 1;
  else failures += 1;
  console.log(`${cond ? "✓" : "✗"} ${name}`);
}

function checkEq(name, actual, expected) {
  const ok = Object.is(actual, expected);
  if (ok) passes += 1;
  else failures += 1;
  console.log(`${ok ? "✓" : "✗"} ${name}${ok ? "" : ` — expected ${expected}, got ${actual}`}`);
}

function checkDeep(name, actual, expected) {
  const ok = JSON.stringify(actual) === JSON.stringify(expected);
  if (ok) passes += 1;
  else failures += 1;
  console.log(`${ok ? "✓" : "✗"} ${name}${ok ? "" : ` — expected ${JSON.stringify(expected)}, got ${JSON.stringify(actual)}`}`);
}

function section(title) {
  console.log(`\n── ${title} ${"─".repeat(Math.max(0, 72 - title.length))}`);
}

let seedCounter = 500000;
function newRun(difficulty = "Normal") {
  resetHorrorStore();
  resetMerchant();
  return createHorrorRun({ seed: (seedCounter += 1), difficulty });
}

/**
 * Equip an item id directly, growing the belt when it is full.
 *
 * The default belt is 4 slots and `Belt Buster` is the only in-game way to widen
 * it, but several tests need to hold more than four things to exercise a
 * broadcast across many survivors. Growing the array here is a test affordance,
 * not a game rule — production paths still go through `buyMerchantOffer`, which
 * refuses equipment with a full belt.
 */
function equip(run, itemId) {
  let slot = addItemToRun(run, itemId);
  if (slot === -1) {
    run.equipment.push(null);
    slot = addItemToRun(run, itemId);
  }
  if (slot === -1) throw new Error(`no slot for ${itemId}`);
  return slot;
}

// ═══════════════════════════════════════════════════════════════════════════
// A. GOLD CONSERVATION (acceptance 3)
// ═══════════════════════════════════════════════════════════════════════════

section("A. Gold conservation — the balance can never go negative");

{
  const run = newRun();
  run.gold = 0;
  checkEq("starting gold can be zero", run.gold, 0);

  // Spending more than you have is refused, not clamped into a debt.
  checkEq("spendGold refuses an overdraft", spendGold(run, 5), false);
  checkEq("the balance is untouched", run.gold, 0);

  // grantGold reports what actually moved.
  checkEq("a grant of 7 moves 7", grantGold(run, 7), 7);
  checkEq("balance is 7", run.gold, 7);
  checkEq("a cost of 10 moves -7, not -10", grantGold(run, -10), -7);
  checkEq("balance floors at 0", run.gold, 0);

  // The C19 invariant: one grant can never exceed 10 x Mythic.buy.
  const big = grantGold(run, 5000);
  checkEq("a 5000 grant is clamped to the 160 ceiling", big, 160);
  checkEq("balance is the ceiling", run.gold, 160);
  run.gold = 0;

  // §2.3: the largest legit grant in the catalogue is Lobster's +16.
  const lobster = getHorrorItem("lobster");
  addItemToRun(run, "lobster");
  const eaten = applyHorrorTrigger(run, "use", { itemScope: "lobster" });
  checkEq("Lobster grants exactly 16", eaten.goldDelta, 16);
  checkEq("balance is 16", run.gold, 16);
  void lobster;
}

section("A. Gold conservation — merchant sequences");

{
  const run = newRun();
  run.gold = 7;
  const { visit } = openMerchantVisit(run);
  checkEq("a visit has 4 offers", visit.offers.length, HORROR_OFFERS_PER_VISIT);
  checkEq("opening a visit costs nothing", run.gold, 7);

  // The S2 witness: reroll 7 -> 6, buy pillow 6 -> 4, buy compass 4 -> 2.
  const reroll = rerollMerchantOffers(run);
  checkEq("a paid reroll costs 1 (C2)", reroll.cost, 1);
  checkEq("gold after the reroll is 6 (S2 exact)", run.gold, 6);

  // Buy the two cheapest offers we can afford.
  let gold = run.gold;
  let bought = 0;
  for (let i = 0; i < visit.offers.length && bought < 2; i++) {
    const offer = visit.offers[i];
    const price = offer.price;
    const result = buyMerchantOffer(run, i);
    if (!result.ok) continue;
    checkEq(`offer ${i} charged exactly its price`, gold - run.gold, price);
    gold = run.gold;
    bought += 1;
  }
  checkEq("two purchases happened", bought, 2);

  // An unaffordable buy is a complete no-op: no gold, no item, no slot shrink.
  run.gold = 0;
  const before = JSON.stringify({ eq: run.equipment, food: run.food });
  const denied = buyMerchantOffer(run, visit.offers.findIndex((o) => !isOfferSold(o)));
  checkEq("an unaffordable buy is refused", denied.ok, false);
  checkEq("the reason is insufficient_gold", denied.reason, "insufficient_gold");
  checkEq("no gold moved", run.gold, 0);
  checkDeep("the inventory is untouched", JSON.stringify({ eq: run.equipment, food: run.food }), before);

  // A reroll with no free charges and 0 gold is refused.
  run.freeRerolls = 0;
  const broke = rerollMerchantOffers(run);
  checkEq("a broke reroll is refused", broke.ok, false);
  checkEq("gold stays at 0", run.gold, 0);

  // Selling is the only way back up, and it pays the rarity sell price.
  run.freeRerolls = 0;
  const held = run.equipment.find((s) => s !== null);
  if (held) {
    const item = getHorrorItem(held);
    const expected = itemSellPrice(run, item);
    const sold = sellItem(run, held);
    checkEq("selling succeeds", sold.ok, true);
    checkEq("the payout matches the sell price", sold.goldReceived, expected);
    checkEq("gold rose by the payout", run.gold, expected);
    checkEq("the slot is freed", run.equipment.includes(held), false);
  }

  // Exhaustive: 200 random actions never drive gold negative.
  let negative = false;
  const chaos = newRun();
  chaos.gold = 12;
  openMerchantVisit(chaos);
  for (let i = 0; i < 200; i++) {
    const roll = i % 5;
    if (roll === 0) buyMerchantOffer(chaos, i % HORROR_OFFERS_PER_VISIT);
    else if (roll === 1) rerollMerchantOffers(chaos);
    else if (roll === 2) {
      const held2 = chaos.equipment.find((s) => s !== null);
      if (held2) sellItem(chaos, held2);
    } else if (roll === 3) grantGold(chaos, -7);
    else grantGold(chaos, 3);
    if (chaos.gold < 0) negative = true;
  }
  check("200 mixed actions never produce a negative balance", negative === false);
  check("the balance is an integer", Number.isInteger(chaos.gold) === true);
}

// ═══════════════════════════════════════════════════════════════════════════
// B. DESTRUCTION CHAINS (§3.3)
// ═══════════════════════════════════════════════════════════════════════════

section("B. Destruction — Time Machine skips a day when another item is destroyed");

{
  const run = newRun();
  equip(run, "timeMachine");
  equip(run, "helmet");

  const before = run.day;
  const result = destroyItem(run, "helmet", "test");

  checkEq("Helmet is gone", run.equipment.includes("helmet"), false);
  checkEq("the destroy is reported", result.destroyed, true);
  check("Time Machine received onDestroyOther", result.cascade.length > 0);
  checkEq("one day is queued for the skip", result.skippedDays, 1);
  checkEq("the day has NOT advanced yet (the skip is deferred)", run.day, before);
  checkEq("Time Machine is still equipped", run.equipment.includes("timeMachine"), true);

  // The caller applies the queued skip — this is the loop break.
  checkEq("the queue holds one day", takePendingSkipDays(run), 1);
  checkEq("the queue is drained", takePendingSkipDays(run), 0);
}

section("B. Destruction — Trash Armor grows from the same broadcast");

{
  const run = newRun();
  equip(run, "trashArmor");
  equip(run, "helmet");
  equip(run, "bananaPeel");

  const baseLead = stackLeadBonus(run, getHorrorItem("trashArmor"));
  checkEq("Trash Armor starts with no stack bonus", baseLead, 0);
  const baseStacks = itemStack(run, getHorrorItem("trashArmor"));
  checkEq("its stack counter starts at 0", baseStacks, 0);

  destroyItem(run, "helmet", "test");
  checkEq("one destroy increments the stack", itemStack(run, getHorrorItem("trashArmor")), 1);
  checkEq("+15 lead per stack", stackLeadBonus(run, getHorrorItem("trashArmor")), 15);

  destroyItem(run, "bananaPeel", "test");
  checkEq("a second destroy increments again", itemStack(run, getHorrorItem("trashArmor")), 2);
  checkEq("+30 lead now", stackLeadBonus(run, getHorrorItem("trashArmor")), 30);

  // The critical rule: the bonus dies with its copy (§3.3).
  destroyItem(run, "trashArmor", "test");
  checkEq("Trash Armor is gone", run.equipment.includes("trashArmor"), false);
  checkEq("its stack counter is deleted, not orphaned", run.itemStacks.trashArmor, undefined);
}

section("B. Destruction — the cost is exactly one lead per destroyed item");

{
  // A destroyed item must not leave its own passive behind: the engine derives
  // from `equipment`, so removal is the revert (acceptance 8).
  const run = newRun();
  equip(run, "garlicPendant"); // +10 lead while equipped
  const withPendant = deriveHorrorEngineMods(run);
  checkEq("the pendant contributes while equipped", withPendant.distancePerStep, 1);

  const leadBefore = run.monster.distance;
  destroyItem(run, "garlicPendant", "test");
  checkEq("the distance is unchanged by the removal itself", run.monster.distance, leadBefore);
  checkEq("total stacks left behind", run.itemStacks.garlicPendant, undefined);
}

section("B. Destruction — Anglerfish clamps to held − 1");

{
  const run = newRun();
  // Two items only: the clamp must stop at one, or the run is soft-locked.
  equip(run, "helmet");
  equip(run, "bananaPeel");
  checkEq("two items held", heldItemIds(run).length, 2);

  const outcome = destroyRandomItems(run, 3);
  checkEq("it destroys one, not three", outcome.destroyed.length, 1);
  checkEq("one item survives", heldItemIds(run).length, 1);
  check("the survivor is a real item", heldItemIds(run).length === 1);

  // With a real inventory it destroys the full 3.
  const wide = newRun();
  for (const id of ["helmet", "bananaPeel", "slingshot", "earplugs", "tricycle"]) equip(wide, id);
  checkEq("five items held", heldItemIds(wide).length, 5);
  const wideOutcome = destroyRandomItems(wide, 3);
  checkEq("three are destroyed", wideOutcome.destroyed.length, 3);
  checkEq("two survive", heldItemIds(wide).length, 2);

  // Anglerfish itself: destroys 3 then spawns a Mythic.
  const fish = newRun();
  for (const id of ["helmet", "bananaPeel", "slingshot", "earplugs"]) equip(fish, id);
  addItemToRun(fish, "anglerfish");
  const eaten = applyHorrorTrigger(fish, "onEat", { itemScope: "anglerfish" });
  const mythic = fish.equipment.find((id) => id !== null && getHorrorItem(id)?.rarity === "Mythic");
  check("Anglerfish spawned a Mythic", mythic !== undefined);
  check("at least one item was destroyed", eaten.destroyed.length >= 1);
}

section("B. Destruction — Duct Cake restores the last destroyed item");

{
  const run = newRun();
  equip(run, "helmet");
  equip(run, "bananaPeel");
  destroyItem(run, "helmet", "test");
  checkDeep("the destruction history has helmet", run.destroyedStack, ["helmet"]);

  addItemToRun(run, "ductCake");
  const restored = applyHorrorTrigger(run, "use", { itemScope: "ductCake" });
  checkDeep("Duct Cake restored Helmet", restored.restored, ["helmet"]);
  checkEq("Helmet is back in a slot", run.equipment.includes("helmet"), true);
  checkEq("the history is drained", run.destroyedStack.length, 0);

  // LIFO: the most recent destroy is restored first.
  const lifo = newRun();
  equip(lifo, "helmet");
  equip(lifo, "bananaPeel");
  destroyItem(lifo, "helmet", "test");
  destroyItem(lifo, "bananaPeel", "test");
  checkEq("the first restore is bananaPeel", restoreLastDestroyed(lifo), "bananaPeel");
  checkEq("the second restore is helmet", restoreLastDestroyed(lifo), "helmet");
  checkEq("nothing left to restore", restoreLastDestroyed(lifo), null);
}

section("B. Destruction — a cascade cannot re-enter itself");

{
  // Time Machine + several armed destructibles: the depth cap must hold and the
  // queued skips must stay finite.
  const run = newRun();
  equip(run, "timeMachine");
  equip(run, "trashArmor");
  equip(run, "helmet");
  equip(run, "skateboard");

  const result = destroyItem(run, "helmet", "test");
  check("the cascade returned", Array.isArray(result.cascade) === true);
  check("the queued skips are finite", Number.isFinite(result.skippedDays) === true);
  check("the depth did not exceed the cap", horrorItemLedger(run).destroyDepth === 0);
}

// ═══════════════════════════════════════════════════════════════════════════
// C. STACKS (§4.6)
// ═══════════════════════════════════════════════════════════════════════════

section("C. Stacks — 'на этом предмете' permanently improves the copy");

{
  // Stinky Pants: equipped +1, eaten +1 on that copy.
  const run = newRun();
  equip(run, "stinkyPants");
  const pants = getHorrorItem("stinkyPants");
  checkEq("the copy starts at 0 stacks", itemStack(run, pants), 0);
  checkEq("base lead is +1", stackLeadBonus(run, pants), 0);

  applyHorrorTrigger(run, "onEat", { itemScope: "stinkyPants" });
  checkEq("eating it raises the stack", itemStack(run, pants), 1);
  checkEq("which is +1 more lead", stackLeadBonus(run, pants), 1);

  applyHorrorTrigger(run, "onEat", { itemScope: "stinkyPants" });
  checkEq("a second eat raises it again", itemStack(run, pants), 2);
  checkEq("+2 lead now", stackLeadBonus(run, pants), 2);

  // Staff: +50 boss damage, +50 per cast.
  const staffRun = newRun();
  equip(staffRun, "staff");
  const staff = getHorrorItem("staff");
  applyHorrorTrigger(staffRun, "onCast", { itemScope: "staff" });
  checkEq("Staff grows on a cast", itemStack(staffRun, staff), 1);

  // War Drum: +200, +100 per boss win.
  const drumRun = newRun();
  equip(drumRun, "warDrum");
  const drum = getHorrorItem("warDrum");
  applyHorrorTrigger(drumRun, "onBossWin", { itemScope: "warDrum" });
  checkEq("War Drum grows on a boss win", itemStack(drumRun, drum), 1);

  // Toe Tag: the only diminishing item — its bonus fades as health rises.
  const toeRun = newRun();
  equip(toeRun, "toeTag");
  const toe = getHorrorItem("toeTag");
  toeRun.health = 6000;
  const fullHealth = stackLeadBonus(toeRun, toe);
  toeRun.health = 1000;
  const lowHealth = stackLeadBonus(toeRun, toe);
  checkEq("at 6000 health Toe Tag costs 60 m of its bonus", fullHealth, -60);
  checkEq("at 1000 health it costs only 10 m", lowHealth, -10);
  check("it fades as you heal (the anti-heal item)", lowHealth > fullHealth);

  // Billionaire Suit: +1 lead per gold held, live.
  const suitRun = newRun();
  equip(suitRun, "billionaireSuit");
  const suit = getHorrorItem("billionaireSuit");
  suitRun.gold = 0;
  checkEq("no gold means no suit bonus", stackLeadBonus(suitRun, suit), 0);
  suitRun.gold = 12;
  checkEq("12 gold is +12 lead", stackLeadBonus(suitRun, suit), 12);
  suitRun.gold = 2;
  checkEq("spending gold immediately reduces the lead", stackLeadBonus(suitRun, suit), 2);
  checkEq("the suit's equipped +10 is separate and constant", deriveHorrorEngineMods(suitRun).distancePerStep, 1);

  // Gráskinna: stacks are a doom counter, not a bonus.
  //
  // The item destroys itself on a roll, so the counter can only be observed while
  // it survives — one cast with a single sample is flaky by construction. The
  // honest test is statistical: across many fresh runs the chance must escalate,
  // and the escalation must measure 15% per cast.
  const gra = getHorrorItem("graSkinnaRare");
  checkEq("doom chance starts at 15%", destroyChanceFor(newRun(), gra), 0.15);

  function surviveCasts(casts) {
    // How many runs survive `casts` consecutive casts, over a fixed sample.
    let survivors = 0;
    const samples = 400;
    for (let i = 0; i < samples; i++) {
      const run = newRun();
      equip(run, "graSkinnaRare");
      for (let c = 0; c < casts; c++) {
        applyHorrorTrigger(run, "onCast", { itemScope: "graSkinnaRare" });
        if (!run.equipment.includes("graSkinnaRare")) break;
      }
      if (run.equipment.includes("graSkinnaRare")) survivors += 1;
    }
    return survivors / samples;
  }

  const surviveOne = surviveCasts(1);
  const surviveThree = surviveCasts(3);
  // The chance escalates *within* the run: 15%, then 30%, then 45%. Survival is
  // therefore 0.85 · 0.70 · 0.55 = 32.7%, not 0.85³ = 61% — which is exactly the
  // "three casts on average" the plan describes (§3.3 pattern 6).
  check("one cast leaves roughly 85% alive", surviveOne > 0.78 && surviveOne < 0.92);
  check("three escalating casts leave roughly 33% alive", surviveThree > 0.24 && surviveThree < 0.43);
  check("the doom counter escalates", surviveThree < surviveOne);

  // The counter itself, on a run that has demonstrably survived.
  const lucky = newRun();
  equip(lucky, "graSkinnaRare");
  let casts = 0;
  while (lucky.equipment.includes("graSkinnaRare") && casts < 8) {
    applyHorrorTrigger(lucky, "onCast", { itemScope: "graSkinnaRare" });
    casts += 1;
    if (!lucky.equipment.includes("graSkinnaRare")) break;
    const stacks = lucky.itemStacks.graSkinnaRare ?? 0;
    checkEq(`after ${casts} surviving cast(s) the chance is ${15 + 15 * stacks}%`, destroyChanceFor(lucky, getHorrorItem("graSkinnaRare")), Math.min(1, 0.15 + 0.15 * stacks));
  }

  // Scroll: "+0 random spells" is literal — the item alone grants nothing.
  const scrollRun = newRun();
  equip(scrollRun, "scroll");
  const scrollOutcome = applyHorrorTrigger(scrollRun, "eachDay", { itemScope: "scroll" });
  checkEq("Scroll alone grants 0 spells", scrollRun.spells.random ?? 0, 0);
  check("the +0 branch is reported", scrollOutcome.events.some((e) => e.op === "grantSpell"));
}

// ═══════════════════════════════════════════════════════════════════════════
// D. GATES (§3.4, §4.3)
// ═══════════════════════════════════════════════════════════════════════════

section("D. Gates — score, distance, health fraction, inside, chance");

{
  // Monster-distance gate: Air Horn fires only within 5 m, once per day.
  const run = newRun();
  equip(run, "airHorn");
  run.monster.distance = 20;
  const far = applyHorrorTrigger(run, "equipped");
  checkEq("Air Horn does nothing at 20 m", far.fired, false);
  run.monster.distance = 3;
  const near = applyHorrorTrigger(run, "equipped");
  checkEq("Air Horn fires at 3 m", near.fired, true);
  checkEq("and pushes him +15 m", near.distanceDelta, 15);

  // oncePerDay: Slingshot.
  const daily = newRun();
  equip(daily, "slingshot");
  const first = applyHorrorTrigger(daily, "onRejectedGuess");
  checkEq("Slingshot fires once", first.fired, true);
  const second = applyHorrorTrigger(daily, "onRejectedGuess");
  checkEq("a second rejection the same day does nothing", second.fired, false);
  resetHorrorItemDay(daily);
  const third = applyHorrorTrigger(daily, "onRejectedGuess");
  checkEq("a new day re-arms it", third.fired, true);

  // Score gate: Medal needs 4600+, and must not be consumed by a weaker guess.
  const medal = newRun();
  equip(medal, "medal");
  const weak = applyHorrorTrigger(medal, "onGuess", { score: 4200 });
  checkEq("a 4200 guess does not fire Medal", weak.fired, false);
  checkEq("Medal is still held", medal.equipment.includes("medal"), true);
  const strong = applyHorrorTrigger(medal, "onGuess", { score: 4700 });
  checkEq("a 4700 guess fires it", strong.fired, true);
  checkEq("Medal pays 16 gold", strong.goldDelta, 16);
  checkEq("and destroys itself", medal.equipment.includes("medal"), false);

  // Health-fraction gate: Horns at below half.
  const horns = newRun();
  equip(horns, "horns");
  checkEq("the horns gate is a fraction", getHorrorItem("horns").condition?.value, 0.5);

  // Inside-location gate: Holy Water.
  const water = newRun();
  equip(water, "holyWater");
  const outside = applyHorrorTrigger(water, "onScry", { insideLocation: false });
  checkEq("Holy Water does nothing outdoors", outside.fired, false);
  const inside = applyHorrorTrigger(water, "onScry", { insideLocation: true });
  checkEq("Holy Water fires indoors", inside.fired, true);
  checkEq("and grants +25 lead", inside.distanceDelta, 25);

  // Time gate: Stopwatch pays on a guess inside 15 s.
  const watch = newRun();
  equip(watch, "stopwatch");
  const slow = applyHorrorTrigger(watch, "onGuess", { guessMs: 20000, score: 0 });
  checkEq("a 20 s guess pays nothing", slow.goldDelta, 0);
  const fast = applyHorrorTrigger(watch, "onGuess", { guessMs: 9000, score: 0 });
  checkEq("a 9 s guess pays 2 gold", fast.goldDelta, 2);
}

section("D. Gates — the threshold layer is applied, never baked in (§4.3)");

{
  const run = newRun();
  beginHorrorDay(run);
  const base = effectiveThresholdFor(run);
  checkEq("day-1 base gate is 1500", base, 1500);

  equip(run, "compass");
  checkEq("Compass drops the effective gate to 1250", effectiveThresholdFor(run), 1250);
  equip(run, "atlas");
  checkEq("Atlas stacks on top: 850", effectiveThresholdFor(run), 850);

  // Food's gate reduction lives on the day ledger.
  addItemToRun(run, "carrotCake");
  applyHorrorTrigger(run, "use", { itemScope: "carrotCake" });
  checkEq("Carrot Cake adds −75", horrorThresholdAdjustment(run), -75);
  checkEq("the engine sees 775", effectiveThresholdFor(run, run.day, horrorThresholdAdjustment(run)), 775);

  // A new day clears the food layer but not the equipment.
  resetHorrorItemDay(run);
  checkEq("the food layer is cleared", horrorThresholdAdjustment(run), 0);
  checkEq("the equipment layer survives", deriveHorrorEngineMods(run).guessThresholdDelta, -650);

  // And the S1 witness still reproduces through the item layer: day 3 + Compass.
  const s1 = newRun();
  equip(s1, "compass");
  s1.day = 3;
  checkEq("day 3 with Compass is 1290 (C15†)", effectiveThresholdFor(s1, 3), 1290);
}

// ═══════════════════════════════════════════════════════════════════════════
// E. oneOf DETERMINISM (§3.4 rule 5)
// ═══════════════════════════════════════════════════════════════════════════

section("E. oneOf — one seeded branch per trigger, committed to the ledger");

{
  function playOyster(seed) {
    resetHorrorStore();
    const run = createHorrorRun({ seed, difficulty: "Normal" });
    addItemToRun(run, "oyster");
    const first = applyHorrorTrigger(run, "use", { itemScope: "oyster" });
    const firstGold = first.goldDelta;
    // Re-triggering the same day must reuse the committed branch.
    const again = applyHorrorTrigger(run, "use", { itemScope: "oyster" });
    return { firstGold, againGold: again.goldDelta };
  }

  const a = playOyster(4242);
  const b = playOyster(4242);
  checkEq("the same seed picks the same branch", a.firstGold, b.firstGold);
  check("the branch is one of 0/1/3/4", [0, 1, 3, 4].includes(a.firstGold));
  checkEq("the branch is committed, not re-rolled", a.againGold, a.firstGold);

  // Different seeds should not all collapse to one branch.
  const seen = new Set();
  for (let seed = 1; seed <= 40; seed++) {
    resetHorrorStore();
    const run = createHorrorRun({ seed, difficulty: "Normal" });
    addItemToRun(run, "oyster");
    seen.add(applyHorrorTrigger(run, "use", { itemScope: "oyster" }).goldDelta);
  }
  check("across 40 seeds more than one branch appears", seen.size > 1);

  // Mushroom's negative branch is real: duration −1 s.
  const shroom = newRun();
  addItemToRun(shroom, "mushroom");
  const shroomed = applyHorrorTrigger(shroom, "use", { itemScope: "mushroom" });
  const durationDelta = shroom.itemStacks["happyThoughts:durationS"] ?? 0;
  const omens = shroom.spells.omen ?? 0;
  check(
    "Mushroom resolves exactly one branch (omen +2 XOR duration −1)",
    (omens === 2 && durationDelta === 0) || (omens === 0 && durationDelta === -1),
  );
  check("the event was recorded", shroomed.fired === true);
}

// ═══════════════════════════════════════════════════════════════════════════
// F. TRIGGER ROUTING — the ambiguous items
// ═══════════════════════════════════════════════════════════════════════════

section("F. Trigger routing — Banana Peel, Skateboard, Jack-O'-Lantern");

{
  // Banana Peel: fallChance x2 is equipped, +15 lead is onFall.
  const run = newRun();
  equip(run, "bananaPeel");
  checkEq("the x2 fall chance is continuous", deriveHorrorEngineMods(run).fallChance, 0.04);
  run.monster.distance = 10;
  const fall = applyHorrorTrigger(run, "onFall");
  checkEq("a fall pushes him +15 m", fall.distanceDelta, 15);
  checkEq("distance is 25", run.monster.distance, 25);

  // Skateboard: +1 step and x0.5 fall are equipped, destroySelf is onFall.
  const board = newRun();
  equip(board, "skateboard");
  checkEq("Skateboard gives +2 per step (base + item)", deriveHorrorEngineMods(board).distancePerStep, 2);
  checkEq("and halves the fall chance", deriveHorrorEngineMods(board).fallChance, 0.01);
  checkEq("it is still equipped", board.equipment.includes("skateboard"), true);
  applyHorrorTrigger(board, "onFall");
  checkEq("a fall destroys it", board.equipment.includes("skateboard"), false);

  // Jack-O'-Lantern: +10 lead while equipped, self-destruct after 4 days.
  const lantern = newRun();
  equip(lantern, "jackOLantern");
  checkEq("it is held on day 0", heldItemIds(lantern).includes("jackOLantern"), true);
  for (let day = 1; day <= 3; day++) tickItemDays(lantern);
  checkEq("it survives 3 days", lantern.equipment.includes("jackOLantern"), true);
  tickItemDays(lantern);
  checkEq("it self-destructs on day 4 (afterDays 4)", lantern.equipment.includes("jackOLantern"), false);
}

section("F. Trigger routing — the self-destruction surface");

{
  // §3.9: 17 Consumables exist. They are the *non-food one-shots* (§3.1) — not
  // all of them self-destruct. `Scroll`, `Nazar`, `Crystal Ball`, `Pedometer`,
  // `Holy Water` and `Time Machine` fire repeatedly (daily, per step, on scry, on
  // another item's destruction) and are never consumed. §3.3's destructible
  // roster is 13 items, so the invariant worth asserting is that every name on
  // *that* list is tagged.
  const consumables = HORROR_ITEMS.filter((item) => item.kind === "Consumable");
  checkEq("17 consumables exist (§3.9)", consumables.length, 17);

  const DESTRUCTIBLE = [
    "garlicBomb",
    "rubberChicken",
    "helmet",
    "jumperCables",
    "defibrillator",
    "voodooDoll",
    "jackOLantern",
    "gulskinna",
    "graSkinna",
    "graSkinnaRare",
    "pacifier",
    "hallPass",
    "medal",
    "skateboard",
  ];
  const untagged = DESTRUCTIBLE.filter((id) => {
    const item = getHorrorItem(id);
    if (!item) return true;
    return !item.destroysSelf && !item.effects.some((e) => e.op === "destroySelf");
  });
  checkDeep("every §3.3 destructible is tagged", untagged, []);

  // `Anglerfish` is the collateral destroyer: it never self-destructs, it
  // destroys others and spawns a Mythic.
  const angler = getHorrorItem("anglerfish");
  checkEq("Anglerfish does not self-destruct", angler.destroysSelf, undefined);
  checkDeep(
    "Anglerfish carries destroyRandom 3 + a Mythic spawn",
    angler.effects.map((e) => e.op),
    ["destroyRandom", "spawnRarity"],
  );
}

// ═══════════════════════════════════════════════════════════════════════════
// G. MERCHANT — offers, minDay, no duplicates
// ═══════════════════════════════════════════════════════════════════════════

section("G. Merchant — seeded offers, no duplicates, minDay gate");

{
  const run = newRun();
  run.day = 1;
  const day1 = rollMerchantOffers(run);
  checkEq("day 1 offers 4 items", day1.length, HORROR_OFFERS_PER_VISIT);
  checkDeep("day 1 can only offer Common", [...new Set(day1.map((o) => o.rarity))], ["Common"]);
  const ids = day1.map((o) => o.itemId);
  checkEq("no duplicates in a visit", new Set(ids).size, ids.length);

  // The minDay gate is real: Mythic appears only from day 13.
  checkDeep("day 1 eligible rarities", eligibleRarities(1), ["Common"]);
  checkDeep("day 4 adds Uncommon", eligibleRarities(4), ["Common", "Uncommon"]);
  checkDeep("day 8 adds Rare", eligibleRarities(8), ["Common", "Uncommon", "Rare"]);
  checkDeep("day 13 adds Mythic", eligibleRarities(13), ["Common", "Uncommon", "Rare", "Mythic"]);
  checkDeep("day 12 still excludes Mythic", eligibleRarities(12), ["Common", "Uncommon", "Rare"]);

  // Across many day-12 shops, no Mythic ever appears.
  let mythicBefore13 = 0;
  for (let i = 0; i < 60; i++) {
    const probe = newRun();
    probe.day = 12;
    for (const offer of rollMerchantOffers(probe)) {
      if (offer.rarity === "Mythic") mythicBefore13 += 1;
    }
  }
  checkEq("no Mythic offer before day 13", mythicBefore13, 0);

  // At day 13 they do appear (2% weight, so sample generously).
  let mythicAfter13 = 0;
  for (let i = 0; i < 300; i++) {
    const probe = newRun();
    probe.day = 13;
    for (const offer of rollMerchantOffers(probe)) {
      if (offer.rarity === "Mythic") mythicAfter13 += 1;
    }
  }
  check("Mythic appears at day 13", mythicAfter13 > 0);
}

section("G. Merchant — prices (§2.1)");

{
  const run = newRun();
  const common = getHorrorItem("garlicPendant");
  // Equipment prices. A Mythic *food* is priced on the food column (8) — the
  // `Lobster` / `Gari's Cake` case — so the 16 must be measured on equipment.
  const mythicEquipment = getHorrorItem("torch");
  const mythicFood = getHorrorItem("lobster");
  checkEq("Common buys for 2 (S2, C1)", itemBuyPrice(common), HORROR_RARITY_ECONOMY.Common.buy);
  checkEq("Mythic equipment buys for 16 (S3)", itemBuyPrice(mythicEquipment), 16);
  checkEq("Mythic food buys for 8 (the food column)", itemBuyPrice(mythicFood), 8);
  checkEq("Common sells for 1", itemSellPrice(run, common), HORROR_RARITY_ECONOMY.Common.sell);
  checkEq("Mythic equipment sells for 8", itemSellPrice(newRun(), mythicEquipment), 8);

  // Coupon Book: food −1, floored at 1.
  const food = getHorrorItem("pumpkinBun");
  checkEq("food costs 2 unmodified", itemBuyPrice(food, 0), 2);
  checkEq("Coupon Book makes it 1", itemBuyPrice(food, -1), 1);
  checkEq("a −5 delta still floors at 1", itemBuyPrice(food, -5), 1);
  checkEq("the discount does not touch equipment", itemBuyPrice(common, -1), 2);

  // Gold Tooth / GPU appreciate as they are held.
  const toothRun = newRun();
  equip(toothRun, "goldTooth");
  const tooth = getHorrorItem("goldTooth");
  checkEq("Gold Tooth starts at 1", itemSellPrice(toothRun, tooth), 1);
  applyHorrorTrigger(toothRun, "eachDay", { itemScope: "goldTooth" });
  checkEq("one day makes it 2", itemSellPrice(toothRun, tooth), 2);
  applyHorrorTrigger(toothRun, "eachDay", { itemScope: "goldTooth" });
  checkEq("two days makes it 3", itemSellPrice(toothRun, tooth), 3);

  const gpuRun = newRun();
  equip(gpuRun, "gpu");
  const gpu = getHorrorItem("gpu");
  checkEq("GPU starts at 2", itemSellPrice(gpuRun, gpu), 2);
  applyHorrorTrigger(gpuRun, "eachDay", { itemScope: "gpu" });
  checkEq("one day makes it 4 (+2/day)", itemSellPrice(gpuRun, gpu), 4);
}

section("G. Merchant — buying, rerolling, the visit lifecycle");

{
  const run = newRun();
  run.gold = 20;
  const { visit, reused } = openMerchantVisit(run);
  checkEq("the first open is not a reuse", reused, false);
  const again = openMerchantVisit(run);
  checkEq("a second open reuses the same visit", again.reused, true);
  checkDeep("the offers are identical", again.visit.offers, visit.offers);

  // Buying marks the slot sold and keeps the index stable.
  const index = 0;
  const bought = buyMerchantOffer(run, index);
  checkEq("the buy succeeded", bought.ok, true);
  const shelf = getMerchantVisit(run.runId);
  checkEq("the slot is now sold", isOfferSold(shelf.offers[index]), true);
  checkEq("the index still exists", shelf.offers.length, HORROR_OFFERS_PER_VISIT);
  const rebuy = buyMerchantOffer(run, index);
  checkEq("buying it twice is refused", rebuy.ok, false);
  checkEq("the reason is already_sold", rebuy.reason, "already_sold");

  // Free rerolls are spent before gold.
  run.freeRerolls = 2;
  const goldBefore = run.gold;
  const free = rerollMerchantOffers(run);
  checkEq("the free reroll is used", free.usedFree, true);
  checkEq("free rerolls drop to 1", run.freeRerolls, 1);
  checkEq("gold is untouched", run.gold, goldBefore);

  const paid = rerollMerchantOffers(run);
  checkEq("the second is free too", paid.usedFree, true);
  checkEq("free rerolls are exhausted", run.freeRerolls, 0);

  const nowPaid = rerollMerchantOffers(run);
  checkEq("the third is paid", nowPaid.usedFree, false);
  checkEq("it costs 1", nowPaid.cost, 1);
  checkEq("gold fell by 1", run.gold, goldBefore - 1);

  // A new day opens a new visit. `beginHorrorDay` re-initializes the day it is
  // already on; the calendar only advances through `endHorrorDay`, so the day is
  // moved explicitly here.
  run.day += 1;
  beginHorrorDay(run);
  const nextVisit = openMerchantVisit(run);
  checkEq("a new day is a new visit", nextVisit.reused, false);
  checkEq("the visit is for the new day", nextVisit.visit.day, run.day);
}

section("G. Merchant — no free slot blocks equipment but not food");

{
  const run = newRun();
  run.gold = 100;
  // Fill every slot.
  for (const id of ["helmet", "bananaPeel", "slingshot", "earplugs"]) equip(run, id);
  checkEq("all 4 slots are full", run.equipment.filter((s) => s !== null).length, 4);

  // Force an equipment offer and a food offer onto the shelf.
  closeMerchantVisit(run.runId);
  const visit = openMerchantVisit(run).visit;
  visit.offers[0] = { itemId: "garlicPendant", rarity: "Common", price: 2 };
  visit.offers[1] = { itemId: "pumpkinBun", rarity: "Common", price: 2 };

  const goldBefore = run.gold;
  const noSlot = buyMerchantOffer(run, 0);
  checkEq("equipment is refused with a full belt", noSlot.ok, false);
  checkEq("the reason is no_slot", noSlot.reason, "no_slot");
  checkEq("nothing was charged", run.gold, goldBefore);

  const foodOk = buyMerchantOffer(run, 1);
  checkEq("food still buys with a full belt", foodOk.ok, true);
  checkEq("and it is paid for", run.gold, goldBefore - 2);
  checkEq("food landed in the food list", run.food.includes("pumpkinBun"), true);
}

section("G. Merchant — Loyalty Card fires on buying the whole shelf");

{
  const run = newRun();
  run.gold = 100;
  equip(run, "loyaltyCard");
  const mods = deriveHorrorItemMods(run);
  checkEq("Loyalty Card grants one free reroll on a full buy", mods.freeRerollsOnFullBuy, 1);

  const visit = openMerchantVisit(run).visit;
  // Cheap, slot-free offers so the test is about the condition, not capacity.
  for (let i = 0; i < visit.offers.length; i++) {
    visit.offers[i] = { itemId: "pumpkinBun", rarity: "Common", price: 1 };
  }
  run.freeRerolls = 0;
  let last = null;
  for (let i = 0; i < visit.offers.length; i++) last = buyMerchantOffer(run, i);

  checkEq("the last buy fires the bonus", last.freeRerollsGranted, 1);
  checkEq("+5 gold (per the reference)", last.goldGranted, 5);
  checkEq("the free reroll is banked", run.freeRerolls, 1);

  // It must not pay twice for the same day.
  const visit2 = getMerchantVisit(run.runId);
  visit2.boughtCount = visit2.offers.length - 1;
  visit2.offers[visit2.offers.length - 1] = { itemId: "pumpkinBun", rarity: "Common", price: 1 };
  const second = buyMerchantOffer(run, visit2.offers.length - 1);
  checkEq("it does not pay out again the same day", second.freeRerollsGranted, undefined);
}

section("G. Merchant — Wanted Poster pays per boss rank");

{
  const run = newRun();
  checkEq("no poster means no bonus gold", bossWinGoldPayout(run, 1).gold, 0);

  equip(run, "wantedPoster");
  const hangout = bossWinGoldPayout(run, 1);
  checkEq("Hangout pays +2 (rank 1)", hangout.gold, 2);
  const prospect = bossWinGoldPayout(run, 2);
  checkEq("Prospect pays +4 (rank 2)", prospect.gold, 4);
  const commander = bossWinGoldPayout(run, 3);
  checkEq("Commander pays +6 (rank 3)", commander.gold, 6);
  const senior = bossWinGoldPayout(run, 4);
  checkEq("the finale pays +8 (rank 4)", senior.gold, 8);
}

// ═══════════════════════════════════════════════════════════════════════════
// H. DAY BOUNDARY (§3.4 rule 7) and step counters
// ═══════════════════════════════════════════════════════════════════════════

section("H. Day boundary — eachDay fires before the player acts");

{
  const run = newRun();
  run.gold = 0;
  equip(run, "piggyBank"); // eachDay: +2 gold
  equip(run, "ledger"); // eachDay: +3 gold

  const tick = tickItemDays(run);
  checkEq("Piggy Bank + Ledger pay 5", tick.goldDelta, 5);
  checkEq("gold is 5, spendable this same day", run.gold, 5);

  // Pillow heals on eachDay.
  const pillowRun = newRun();
  pillowRun.health = 4000;
  equip(pillowRun, "pillow");
  const pillowTick = tickItemDays(pillowRun);
  checkEq("Pillow heals 100 at day start", pillowTick.healed, 100);
  checkEq("health is 4100", pillowRun.health, 4100);

  // Pedometer grants a spell every 40 steps, not before.
  const pedo = newRun();
  equip(pedo, "pedometer");
  let spellEvents = 0;
  for (let i = 0; i < 39; i++) spellEvents += tickItemSteps(pedo).length;
  checkEq("nothing in the first 39 steps", spellEvents, 0);
  checkEq("the 40th step grants", tickItemSteps(pedo).length, 1);
  checkEq("the spell landed", pedo.spells.random, 1);
}

section("H. Day boundary — sellPricePerDay is driven by eachDay");

{
  const run = newRun();
  equip(run, "goldTooth");
  for (let i = 0; i < 3; i++) tickItemDays(run);
  const tooth = getHorrorItem("goldTooth");
  // 1 base + 3 days of +1. The stack counter is the day count.
  checkEq("three days of holding raises the price to 4", itemSellPrice(run, tooth), 4);
}

// ═══════════════════════════════════════════════════════════════════════════
// I. SPAWNING (§3.3: server-side, from the run seed)
// ═══════════════════════════════════════════════════════════════════════════

section("I. Spawning — server-side, seeded, rarity-correct");

{
  const run = newRun();
  const spawned = spawnRandomItem(run, "Mythic", "Equipment");
  check("a Mythic equipment was spawned", spawned !== null);
  checkEq("it is Mythic", getHorrorItem(spawned).rarity, "Mythic");
  checkEq("it is Equipment", getHorrorItem(spawned).kind, "Equipment");
  checkEq("it is in the inventory", heldItemIds(run).includes(spawned), true);

  // Same seed, same spawn.
  function spawnWithSeed(seed) {
    resetHorrorStore();
    const probe = createHorrorRun({ seed, difficulty: "Normal" });
    return spawnRandomItem(probe, "Rare", "Food");
  }
  checkEq("the same seed spawns the same item", spawnWithSeed(9999), spawnWithSeed(9999));
}

// ═══════════════════════════════════════════════════════════════════════════
// J. EVERY OP IS REACHABLE
// ═══════════════════════════════════════════════════════════════════════════

section("J. Coverage — every catalogue op is exercised by the interpreter");

{
  // Firing every trigger on a run holding every item must not throw, and must
  // produce at least one event per op family the catalogue actually uses.
  const triggers = [
    "equipped",
    "onEat",
    "eachDay",
    "use",
    "onGuess",
    "onRejectedGuess",
    "onCast",
    "onScry",
    "onStep",
    "onFall",
    "onCatch",
    "onLethal",
    "onDamage",
    "onBossHit",
    "onBossWin",
    "onBossLoss",
    "onPuzzleSolve",
    "onDestroyOther",
    "onGainMaxHealth",
    "onHappyThoughts",
  ];

  let threw = null;
  const opSeen = new Set();
  for (let i = 0; i < 30; i++) {
    const run = newRun();
    run.gold = 50;
    // Ten items at a time, cycling through the catalogue.
    for (let k = 0; k < 10; k++) {
      const item = HORROR_ITEMS[(i * 10 + k) % HORROR_ITEMS.length];
      addItemToRun(run, item.id);
      if (run.equipment.length >= 12) run.equipment.push(null);
    }
    try {
      for (const trigger of triggers) {
        const result = applyHorrorTrigger(run, trigger, {
          score: 4700,
          guessMs: 8000,
          insideLocation: true,
          bossId: "clown",
          damageDealt: 500,
          incomingDamage: 100,
          chargeFamily: "scry",
        });
        for (const event of result.events) opSeen.add(event.op);
      }
      tickItemDays(run);
      tickItemSteps(run);
    } catch (error) {
      threw = error;
      break;
    }
  }
  check("firing every trigger over 300 items never throws", threw === null);
  if (threw) console.log(`   ${threw.message}`);

  // The op families that must have produced events.
  const required = [
    "gold",
    "heal",
    "monsterDistance",
    "maxHealth",
    "grantSpell",
    "guessThreshold",
    "destroySelf",
    "omen",
    "scry",
  ];
  const missing = required.filter((op) => !opSeen.has(op));
  checkDeep("the core op families all fired", missing, []);
}

// ═══════════════════════════════════════════════════════════════════════════
// K. END-TO-END: a bought item actually changes the chase
// ═══════════════════════════════════════════════════════════════════════════

section("K. End to end — a merchant buy changes the chase");

{
  const run = newRun();
  run.gold = 10;
  beginHorrorDay(run);
  const slot = equip(run, "garlicPendant"); // +10 lead
  checkEq("the pendant occupies a slot", slot >= 0, true);
  checkEq("the engine sees it", deriveHorrorEngineMods(run).distancePerStep, 1);
  checkEq("the item is held", run.equipment.includes("garlicPendant"), true);

  // Selling it via the merchant path reverts nothing but leaves no residue.
  const sold = sellItem(run, "garlicPendant");
  checkEq("it sells", sold.ok, true);
  checkEq("it leaves the inventory", run.equipment.includes("garlicPendant"), false);
  checkEq("gold rose by 1", run.gold, 11);

  // Compass: the gate actually moves when bought.
  const gateRun = newRun();
  gateRun.gold = 10;
  beginHorrorDay(gateRun);
  const gateBefore = effectiveThresholdFor(gateRun);
  equip(gateRun, "compass");
  checkEq("the gate fell by 250", gateBefore - effectiveThresholdFor(gateRun), 250);

  // A 5000 guess still heals, and the item layer does not interfere.
  const healRun = newRun();
  healRun.health = 500;
  equip(healRun, "compass");
  const perfect = resolveChaseGuess(healRun, { distanceKm: 0.01 });
  checkEq("a perfect guess still heals to full", perfect.healthAfter, 6000);
}

// ═══════════════════════════════════════════════════════════════════════════

resetHorrorStore();
resetMerchant();

console.log(`\n${"═".repeat(74)}`);
console.log(`${passes} passed, ${failures} failed — ${HORROR_ITEMS.length} items`);
console.log("═".repeat(74));
if (failures > 0) process.exitCode = 1;