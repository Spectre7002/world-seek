import assert from "node:assert/strict";
import { CASE_PITY_MAX, spinClassicCase } from "../server/caseEngine";
import {
  addOneSpellEach,
  emptySpellCounts,
  MAP_SPELL_IDS,
  SERVER_SPELL_IDS,
  SPELL_IDS,
  spellScoreRange,
  totalSpells,
  type SpellId,
} from "../src/shared/spells";

// OMEN buckets, including the edges.
assert.equal(spellScoreRange(0), "0-1000");
assert.equal(spellScoreRange(999), "0-1000");
assert.equal(spellScoreRange(1000), "1000-2000");
assert.equal(spellScoreRange(4999), "4000-5000");
assert.equal(spellScoreRange(5000), "4000-5000");

const boosted = addOneSpellEach(emptySpellCounts());
assert.equal(totalSpells(boosted), SPELL_IDS.length);
assert.equal(boosted.scry, 1);
assert.equal(boosted.arrow, 1);
assert.equal(boosted.echo, 1);
assert.equal(boosted.omen, 1);
assert.equal(boosted.compass, 1);
assert.equal(boosted.heatmap, 1);
assert.equal(boosted.freeze, 1);
assert.equal(boosted.reroll, 1);

// Every spell is either a map spell or a server spell, never both.
assert.equal(MAP_SPELL_IDS.length + SERVER_SPELL_IDS.length, SPELL_IDS.length);
assert.deepEqual([...MAP_SPELL_IDS, ...SERVER_SPELL_IDS].sort(), [...SPELL_IDS].sort());

// Every spell must be reachable from the lootbox and carry the target coords.
const expectedTier: Record<SpellId, string> = {
  omen: "RESTRICTED",
  compass: "RESTRICTED",
  arrow: "CLASSIFIED",
  scry: "CLASSIFIED",
  echo: "CLASSIFIED",
  heatmap: "CLASSIFIED",
  freeze: "COVERT",
  reroll: "SPECIAL",
};
const seen = new Set<SpellId>();
for (let i = 0; i < 40000; i++) {
  const hint = spinClassicCase("better_odds", 12.34, -56.78);
  assert.ok(hint.itemKey, "every case item carries a stable key");
  if (!hint.spell) continue;
  seen.add(hint.spell);
  assert.equal(hint.tierKey, expectedTier[hint.spell]);
  assert.deepEqual(hint.spellTarget, { lat: 12.34, lng: -56.78 });
}
assert.deepEqual([...seen].sort(), [...SPELL_IDS].sort());

// --- tier filtering -------------------------------------------------------
// A "gold only" lobby must never hand out a blue.
for (let i = 0; i < 2000; i++) {
  const hint = spinClassicCase("standard", 0, 0, { enabledTiers: ["SPECIAL"] });
  assert.equal(hint.tierKey, "SPECIAL");
}
// Two enabled tiers must only ever produce those two.
for (let i = 0; i < 2000; i++) {
  const hint = spinClassicCase("standard", 0, 0, {
    enabledTiers: ["COVERT", "SPECIAL"],
  });
  assert.ok(hint.tierKey === "COVERT" || hint.tierKey === "SPECIAL");
}
// An empty list falls back to every tier rather than making the case unrollable.
for (let i = 0; i < 200; i++) {
  const hint = spinClassicCase("standard", 0, 0, { enabledTiers: [] });
  assert.ok(hint.tierKey);
}

// --- pity timer -----------------------------------------------------------
// At the pity cap the roll must never be MIL_SPEC again.
for (let i = 0; i < 2000; i++) {
  const hint = spinClassicCase("standard", 0, 0, { pity: CASE_PITY_MAX });
  assert.notEqual(hint.tierKey, "MIL_SPEC");
}
// Below the cap, blues are still possible (the boost is not always on).
let sawBlue = false;
for (let i = 0; i < 2000; i++) {
  if (spinClassicCase("standard", 0, 0, { pity: CASE_PITY_MAX - 1 }).tierKey === "MIL_SPEC") {
    sawBlue = true;
    break;
  }
}
assert.ok(sawBlue, "pity below the cap must not force a better tier");

// A "blues only" lobby cannot be boosted, so the case still rolls.
for (let i = 0; i < 200; i++) {
  const hint = spinClassicCase("standard", 0, 0, {
    enabledTiers: ["MIL_SPEC"],
    pity: CASE_PITY_MAX,
  });
  assert.equal(hint.tierKey, "MIL_SPEC");
}

// --- duplicate protection -------------------------------------------------
// The same item must not be handed out twice in a row when the tier has an
// alternative. Force a single-tier pool so the check is deterministic.
let repeats = 0;
let previous: string | null = null;
for (let i = 0; i < 5000; i++) {
  const hint = spinClassicCase("standard", 0, 0, {
    enabledTiers: ["MIL_SPEC"],
    lastItem: previous,
  });
  if (previous && hint.itemKey === previous) repeats++;
  previous = hint.itemKey;
}
assert.equal(repeats, 0, "duplicate protection must prevent back-to-back repeats");

// A single-item tier has no alternative, so a repeat is allowed there.
const single = spinClassicCase("standard", 0, 0, {
  enabledTiers: ["SPECIAL"],
  lastItem: "exact-5k",
});
assert.ok(single.itemKey);

console.log("spell checks passed");
