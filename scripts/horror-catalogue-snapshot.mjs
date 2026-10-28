#!/usr/bin/env node
// HorrorGuessr — P0.5 catalogue snapshot test.
//
// §8: "One test serializes `HORROR_ITEMS` and diffs it against a committed
// `horrorCatalogue.snapshot.json`. Any silent edit to a magnitude or a polarity
// fails CI. This exists because the entire value of the item pass is
// *traceability*: the catalogue is the only part of the port that is a verbatim
// reproduction of the game's own text, so a one-line drift is a fidelity
// regression, not a tweak."
//
// It also enforces the P0 exit table (§8) and acceptance 2h–2i (§10), because a
// snapshot alone cannot tell you that a *name* was mistyped — only that the
// bytes changed:
//
//   • 131 entries = 35 + 43 + 33 + 20                     (§3.9)
//   • 0 entries with `effects: []`                        (§8)
//   • 0 entries with `needsReview`                        (§8 — the field is retired)
//   • every `name` is present in plans/hars/items.txt     (§8, §10 2i)
//   • every items.txt name has an id                      (§8, §10 2i — both directions)
//   • every effect carries op + polarity                  (§10 2h)
//   • largest gold grant is 16 (Lobster), under the 160 ceiling (§2.3, §10 4)
//
// Usage:
//   npx tsx scripts/horror-catalogue-snapshot.mjs            # verify (CI mode)
//   npx tsx scripts/horror-catalogue-snapshot.mjs --update   # accept a change
//
// Exits non-zero on any drift or invariant failure.

import { readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

import {
  HORROR_GOLD_GRANT_CEILING,
  HORROR_ITEMS,
  HORROR_ITEM_ALIASES,
  HORROR_ITEM_COUNTS,
  HORROR_ITEM_COUNT_TOTAL,
  HORROR_MAX_ITEM_GOLD_GRANT,
} from "../src/shared/horrorCatalogue.ts";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(HERE, "..");
const SNAPSHOT_PATH = path.join(ROOT, "src", "shared", "horrorCatalogue.snapshot.json");
const REFERENCE_PATH = path.join(ROOT, "plans", "hars", "items.txt");

const UPDATE = process.argv.includes("--update");

// ---------------------------------------------------------------------------
// Canonical serialization
// ---------------------------------------------------------------------------
//
// Object key order in the source file is *not* semantic, so the snapshot must
// not depend on it: a reordered property would otherwise look like a fidelity
// change. Array order *is* semantic (`effects` compose in order, and the
// catalogue follows the reference's own English word order), so arrays are
// preserved verbatim.
//
// Every optional field of `HorrorEffect` is listed below in the same order as
// `src/shared/horrorTypes.ts`, so a new field is a visible snapshot diff rather
// than a silently ignored one.

const EFFECT_KEYS = [
  "op",
  "value",
  "polarity",
  "branches",
  "rarity",
  "kind",
  "itemId",
  "modifier",
  "family",
  "shape",
  "days",
  "target",
  "bossId",
  "everySteps",
  "withinMs",
  "minScore",
  "maxGuessMs",
  "chance",
  "belowFraction",
  "monsterWithinM",
  "perGold",
  "perHealth",
  "perStack",
  "sellOverride",
  "foodPriceDelta",
  "count",
  "charges",
  "spells",
  "skipDays",
  "slots",
  "puzzleSteps",
  "durationS",
  "healDelta",
  "reflectFraction",
  "ignoreChance",
  "reduction",
  "doubleMoveChance",
  "fallMultiplier",
  "maxHealthMultiplier",
  "healMultiplier",
  "bossDamageMultiplier",
  "damageTakenMultiplier",
  "bossDamageTaken",
  "bossDamageFromDamageDealt",
  "bossDamage",
  "maxHealth",
  "heal",
  "gold",
  "monsterDistance",
  "distancePerStep",
  "guessThreshold",
  "healthFloor",
  "cancelBossHitTo",
  "endDayAtDamage",
  "bossRewardGoldPerRank",
  "extraSlot",
  "freeReroll",
  "doubleCatchCost",
  "noJumpscareOnReject",
  "ignoreLowHealthSlowdown",
  "insideLocation",
  "restoreHappyThoughts",
  "freeHappyThoughts",
  "keepChargeChance",
  "destroyChance",
  "destroyChancePerStack",
  "sellPricePerDay",
  "sellPrice",
  "foodPrice",
  "puzzleUnlockUntilDayEnd",
  "skipBoss",
  "restoreDestroyed",
  "spawnEquipment",
  "spawnRarity",
  "destroyRandom",
  "omenChanceOnHappyThoughts",
  "never",
];

const ITEM_KEYS = [
  "id",
  "name",
  "nameRu",
  "rarity",
  "kind",
  "icon",
  "trigger",
  "effects",
  "stacks",
  "condition",
  "oncePerDay",
  "destroysSelf",
  "sellOverride",
  "minDay",
  "bossReward",
  "source",
];

function canonicalEffect(effect) {
  if (effect === null || typeof effect !== "object") return effect;
  const out = {};
  for (const key of EFFECT_KEYS) {
    const value = effect[key];
    if (value === undefined) continue;
    out[key] = key === "branches" ? value.map((branch) => branch.map(canonicalEffect)) : value;
  }
  // Any key the type grew but this list does not know about is surfaced as an
  // error instead of being dropped, so a new effect field can never slip past
  // the snapshot.
  const unknown = Object.keys(effect).filter((key) => !EFFECT_KEYS.includes(key));
  if (unknown.length > 0) {
    throw new Error(`unserialized effect field(s): ${unknown.join(", ")} in ${JSON.stringify(effect)}`);
  }
  return out;
}

function canonicalItem(item) {
  const out = {};
  for (const key of ITEM_KEYS) {
    const value = item[key];
    if (value === undefined) continue;
    if (key === "effects") {
      out.effects = value.map(canonicalEffect);
    } else if (key === "stacks" && value) {
      out.stacks = {
        key: value.key,
        perStack: value.perStack.map(canonicalEffect),
        ...(value.max === undefined ? {} : { max: value.max }),
      };
    } else if (key === "condition" && value) {
      out.condition = { kind: value.kind, value: value.value };
    } else {
      out[key] = value;
    }
  }
  const unknown = Object.keys(item).filter((key) => !ITEM_KEYS.includes(key));
  if (unknown.length > 0) {
    throw new Error(`unserialized item field(s) on "${item.id}": ${unknown.join(", ")}`);
  }
  return out;
}

function countRarities(items) {
  const counts = { Common: 0, Uncommon: 0, Rare: 0, Mythic: 0 };
  for (const item of items) {
    if (!(item.rarity in counts)) throw new Error(`unknown rarity "${item.rarity}" on "${item.id}"`);
    counts[item.rarity] += 1;
  }
  return counts;
}

function buildSnapshot() {
  const items = HORROR_ITEMS.map(canonicalItem);
  const counts = countRarities(HORROR_ITEMS);
  const aliases = Object.fromEntries(Object.entries(HORROR_ITEM_ALIASES).sort(([a], [b]) => a.localeCompare(b)));
  return {
    $comment:
      "Generated by scripts/horror-catalogue-snapshot.mjs from src/shared/horrorCatalogue.ts. " +
      "Do not hand-edit: a change here must be a change in the catalogue, and the catalogue must be a " +
      "change in plans/hars/items.txt (S6). Refresh with `npm run horror:catalogue:update`.",
    reference: "plans/hars/items.txt",
    total: items.length,
    counts,
    aliases,
    items,
  };
}

// ---------------------------------------------------------------------------
// Invariants (§8 exit table, §10 acceptance 2h–2i, §2.3)
// ---------------------------------------------------------------------------

function referenceNames(source) {
  const names = new Set();
  for (const line of source.split(/\r?\n/)) {
    const match = /^([^:]+):\s/.exec(line);
    if (!match) continue;
    names.add(match[1].trim());
  }
  return names;
}

function invariantFailures(referenceSource) {
  const failures = [];
  const check = (condition, message) => {
    if (!condition) failures.push(message);
  };

  // §8 / §3.9 — 131 = 35 + 43 + 33 + 20.
  const counts = countRarities(HORROR_ITEMS);
  for (const rarity of ["Common", "Uncommon", "Rare", "Mythic"]) {
    check(
      counts[rarity] === HORROR_ITEM_COUNTS[rarity],
      `rarity ${rarity}: catalogue has ${counts[rarity]}, HORROR_ITEM_COUNTS declares ${HORROR_ITEM_COUNTS[rarity]}`,
    );
  }
  check(
    HORROR_ITEMS.length === HORROR_ITEM_COUNT_TOTAL,
    `entry count is ${HORROR_ITEMS.length}, expected ${HORROR_ITEM_COUNT_TOTAL}`,
  );
  check(
    HORROR_ITEM_COUNT_TOTAL === 131,
    `HORROR_ITEM_COUNT_TOTAL is ${HORROR_ITEM_COUNT_TOTAL}, expected 131 (§3.9, C17)`,
  );

  // §8 — no empty effect list, no retired `needsReview`, explicit op/polarity.
  const ids = new Set();
  for (const item of HORROR_ITEMS) {
    check(!ids.has(item.id), `duplicate item id "${item.id}"`);
    ids.add(item.id);
    check(Array.isArray(item.effects) && item.effects.length > 0, `"${item.id}" has effects: []`);
    check(!("needsReview" in item), `"${item.id}" carries the retired needsReview field`);
    check(item.source === "s6", `"${item.id}" source is "${item.source}", expected "s6"`);
    for (const effect of item.effects) {
      check(
        typeof effect.op === "string" && effect.op.length > 0,
        `"${item.id}" has an effect without an op`,
      );
      check(
        effect.polarity === "add" ||
          effect.polarity === "multiply" ||
          effect.polarity === "set" ||
          effect.polarity === "prevent",
        `"${item.id}" effect "${effect.op}" has polarity "${effect.polarity}" (§3.4, C20)`,
      );
    }
    if (item.stacks) {
      for (const effect of item.stacks.perStack) {
        check(
          typeof effect.op === "string" && effect.op.length > 0,
          `"${item.id}" has a stacks effect without an op`,
        );
      }
    }
  }

  // §8 / §10 2i — two-directional set diff against the reference's own names.
  const reference = referenceNames(referenceSource);
  const catalogueNames = new Set(HORROR_ITEMS.map((item) => item.name));
  for (const name of catalogueNames) {
    check(reference.has(name), `catalogue name "${name}" is absent from plans/hars/items.txt`);
  }
  for (const name of reference) {
    check(catalogueNames.has(name), `items.txt name "${name}" has no catalogue id`);
  }
  check(
    reference.size === HORROR_ITEMS.length,
    `items.txt has ${reference.size} names, catalogue has ${HORROR_ITEMS.length} (C17: 131)`,
  );

  // §2.3 / §10 4 — the gold guard is an invariant, not a tripwire. A correct
  // catalogue can never exceed it; the observed maximum is Lobster's +16.
  let largestGrant = 0;
  let largestGrantId = null;
  for (const item of HORROR_ITEMS) {
    for (const effect of item.effects) {
      if (effect.op !== "gold" || effect.polarity !== "add") continue;
      if (effect.value > largestGrant) {
        largestGrant = effect.value;
        largestGrantId = item.id;
      }
    }
  }
  check(
    largestGrant <= HORROR_GOLD_GRANT_CEILING,
    `largest gold grant is ${largestGrant} (${largestGrantId}), above the ${HORROR_GOLD_GRANT_CEILING} ceiling`,
  );
  check(
    largestGrant === HORROR_MAX_ITEM_GOLD_GRANT,
    `largest gold grant is ${largestGrant} (${largestGrantId}), expected ${HORROR_MAX_ITEM_GOLD_GRANT} (Lobster)`,
  );

  // Aliases must resolve to real ids, and must never shadow a canonical id.
  for (const [alias, target] of Object.entries(HORROR_ITEM_ALIASES)) {
    check(ids.has(target), `alias "${alias}" points at "${target}", which is not a catalogue id`);
    check(!ids.has(alias), `alias "${alias}" collides with a canonical item id`);
  }
  // §3.11's prose says "26 aliases", but the code block it ships lists 22 renames
  // plus 3 duplicate-name collisions = 25. The catalogue transcribes the block
  // verbatim, so 25 is the code-truth and the prose is off by one. Pinning the
  // count keeps the discrepancy visible instead of letting it drift silently.
  const aliasCount = Object.keys(HORROR_ITEM_ALIASES).length;
  check(
    aliasCount === 25,
    `HORROR_ITEM_ALIASES has ${aliasCount} entries, expected 25 (§3.11 block; its prose says 26)`,
  );

  return failures;
}

// ---------------------------------------------------------------------------
// Diff
// ---------------------------------------------------------------------------

function indexBy(items) {
  const map = new Map();
  for (const item of items) map.set(item.id, item);
  return map;
}

function diffSnapshots(committed, generated) {
  const report = {
    added: [],
    removed: [],
    changed: [],
    meta: [],
    unchanged: 0,
  };

  const before = indexBy(committed.items ?? []);
  const after = indexBy(generated.items);

  for (const id of after.keys()) if (!before.has(id)) report.added.push(id);
  for (const id of before.keys()) if (!after.has(id)) report.removed.push(id);
  for (const [id, next] of after) {
    const prev = before.get(id);
    if (!prev) continue;
    if (JSON.stringify(prev) === JSON.stringify(next)) report.unchanged += 1;
    else report.changed.push(id);
  }

  if (committed.total !== generated.total) {
    report.meta.push(`total ${committed.total} -> ${generated.total}`);
  }
  for (const rarity of ["Common", "Uncommon", "Rare", "Mythic"]) {
    const prev = committed.counts?.[rarity];
    const next = generated.counts[rarity];
    if (prev !== next) report.meta.push(`${rarity} ${prev} -> ${next}`);
  }
  const prevAliases = committed.aliases ?? {};
  const nextAliases = generated.aliases;
  const aliasKeys = new Set([...Object.keys(prevAliases), ...Object.keys(nextAliases)]);
  for (const key of [...aliasKeys].sort()) {
    if (prevAliases[key] !== nextAliases[key]) {
      report.meta.push(`alias ${key}: ${prevAliases[key] ?? "(none)"} -> ${nextAliases[key] ?? "(none)"}`);
    }
  }

  return report;
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

async function main() {
  // Any effect/item field the canonicalizer does not know about throws here,
  // before a snapshot can be written without it.
  const generated = buildSnapshot();
  const serialized = `${JSON.stringify(generated, null, 2)}\n`;

  const referenceSource = await readFile(REFERENCE_PATH, "utf8");
  const failures = invariantFailures(referenceSource);

  if (UPDATE) {
    await writeFile(SNAPSHOT_PATH, serialized, "utf8");
    console.log(`✓ snapshot written: ${path.relative(ROOT, SNAPSHOT_PATH)}`);
    console.log(
      `  ${generated.total} items — Common ${generated.counts.Common}, Uncommon ${generated.counts.Uncommon}, ` +
        `Rare ${generated.counts.Rare}, Mythic ${generated.counts.Mythic}; ${Object.keys(generated.aliases).length} aliases`,
    );
  } else {
    let committedSource;
    try {
      committedSource = await readFile(SNAPSHOT_PATH, "utf8");
    } catch {
      failures.push(
        `${path.relative(ROOT, SNAPSHOT_PATH)} is missing — run with --update to create it`,
      );
      committedSource = null;
    }

    if (committedSource !== null) {
      if (committedSource === serialized) {
        console.log(`✓ catalogue matches ${path.relative(ROOT, SNAPSHOT_PATH)} (no drift)`);
      } else {
        let committed = null;
        try {
          committed = JSON.parse(committedSource);
        } catch (error) {
          failures.push(`snapshot is not valid JSON: ${error.message}`);
        }
        if (committed) {
          const report = diffSnapshots(committed, generated);
          failures.push(
            `catalogue drifted from the committed snapshot ` +
              `(+${report.added.length} / -${report.removed.length} / ~${report.changed.length} / =${report.unchanged})`,
          );
          for (const id of report.added) failures.push(`  added item: ${id}`);
          for (const id of report.removed) failures.push(`  removed item: ${id}`);
          for (const id of report.changed) failures.push(`  changed item: ${id}`);
          for (const line of report.meta) failures.push(`  ${line}`);
        }
      }
    }
  }

  if (failures.length > 0) {
    console.error(`\n✗ horror catalogue check failed (${failures.length}):`);
    for (const failure of failures) console.error(`  - ${failure}`);
    if (!UPDATE) {
      console.error(
        "\nIf the change is intentional, re-run with --update and review the resulting diff: " +
          "the catalogue is a verbatim reproduction of the game's own text (§8, P0.5).",
      );
    }
    process.exitCode = 1;
    return;
  }

  console.log(
    `✓ invariants: 131 entries, 0 empty effects, 0 needsReview, 0 phantom names, ` +
      `gold ceiling intact, ${Object.keys(generated.aliases).length} aliases resolve`,
  );
}

await main();