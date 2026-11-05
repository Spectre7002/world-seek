import test from "node:test";
import assert from "node:assert/strict";
import { RARITY_TIERS, sanitizeCaseTiers, spinClassicCase } from "../server/caseEngine";
import { CASE_PITY_MAX, CASE_TIER_KEYS } from "../src/shared/types";

test("sanitizeCaseTiers falls back to every tier for junk input", () => {
  assert.deepEqual(sanitizeCaseTiers(null), [...CASE_TIER_KEYS]);
  assert.deepEqual(sanitizeCaseTiers([]), [...CASE_TIER_KEYS]);
  assert.deepEqual(sanitizeCaseTiers(["nope"]), [...CASE_TIER_KEYS]);
});

test("sanitizeCaseTiers keeps known keys in canonical order", () => {
  assert.deepEqual(sanitizeCaseTiers(["COVERT", "MIL_SPEC"]), ["MIL_SPEC", "COVERT"]);
});

test("a spin returns a well-formed hint", () => {
  const hint = spinClassicCase("standard", 48.85, 2.35);
  assert.ok(typeof hint.itemKey === "string" && hint.itemKey.length > 0);
  assert.ok(CASE_TIER_KEYS.includes(hint.tierKey as (typeof CASE_TIER_KEYS)[number]));
  assert.ok(hint.tierColor === RARITY_TIERS[hint.tierKey as keyof typeof RARITY_TIERS].color);
});

test("only enabled tiers can be rolled", () => {
  for (let i = 0; i < 200; i++) {
    const hint = spinClassicCase("better_odds", 0, 0, { enabledTiers: ["MIL_SPEC"] });
    assert.equal(hint.tierKey, "MIL_SPEC");
  }
});

test("the pity timer forces a non-MIL_SPEC tier when one is available", () => {
  for (let i = 0; i < 200; i++) {
    const hint = spinClassicCase("standard", 0, 0, { pity: CASE_PITY_MAX });
    assert.notEqual(hint.tierKey, "MIL_SPEC");
  }
});

test("pity is a no-op when only MIL_SPEC is enabled (still rollable)", () => {
  const hint = spinClassicCase("standard", 0, 0, {
    enabledTiers: ["MIL_SPEC"],
    pity: CASE_PITY_MAX,
  });
  assert.equal(hint.tierKey, "MIL_SPEC");
});

test("duplicate protection avoids handing out the same item twice in a row", () => {
  // MIL_SPEC has more than one item, so a repeat of the previous item must be
  // swapped for an alternative.
  const first = spinClassicCase("standard", 0, 0, { enabledTiers: ["MIL_SPEC"] });
  for (let i = 0; i < 200; i++) {
    const again = spinClassicCase("standard", 0, 0, {
      enabledTiers: ["MIL_SPEC"],
      lastItem: first.itemKey,
    });
    assert.notEqual(again.itemKey, first.itemKey);
  }
});
