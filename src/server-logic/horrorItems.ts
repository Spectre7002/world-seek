// HorrorGuessr — the item effect interpreter (§3.1–§3.4, §3.3 destruction, §4.6 stacks).
//
// This module owns everything the run engine deliberately left out: `stacks`
// arithmetic, `oneOf` branching, gold, spells and charges, puzzle shaping,
// destruction and restoration, and the `onDestroyOther` broadcast. The engine
// (P2) owns only the combat loop; the split is documented at
// [`deriveHorrorEngineMods`](src/server-logic/horrorEngine.ts:232).
//
// Three rules from the plan shape the whole design:
//
// 1. **Live modifiers are derived from the inventory, never accumulated.**
//    `stacks` lives in `run.itemStacks` and is read on demand, so a bonus cannot
//    outlive its copy (§3.3). Nothing here keeps a running total of anything.
// 2. **Destruction is a broadcast, not a splice** (§3.3). Removing an item fires
//    `onDestroyOther` for every *other* equipped item — which is how `Trash Armor`
//    (+15 lead per destroy) and `Time Machine` (skip a day) subscribe.
// 3. **A destroy that queues a skip cannot re-enter the cascade.** Time Machine
//    makes destruction the most event-dense verb in the game (§3.3), so skips are
//    *queued* on the run's ledger and applied by the caller once the cascade has
//    settled. Depth is capped as a second line of defence.

import type {
  HorrorChargeFamily,
  HorrorEffect,
  HorrorItem,
  HorrorOp,
  HorrorRun,
  HorrorRarity,
  HorrorTrigger,
} from "../shared/horrorTypes";
import {
  HORROR_GOLD_GRANT_CEILING,
  HORROR_INVENTORY_SLOTS,
  HORROR_ITEMS,
  HORROR_ITEM_STACK_EFFECTS,
  HORROR_RARITY_ECONOMY,
  getHorrorItem,
} from "../shared/horrorCatalogue";
import { applyDamageToPlayer, healPlayer, horrorRngFor } from "./horrorEngine";

// ---------------------------------------------------------------------------
// Trigger routing (§3.1)
// ---------------------------------------------------------------------------

/**
 * Which trigger an effect belongs to.
 *
 * Most items declare exactly one trigger, so their effects are unambiguous. The
 * twenty-odd items that declare two or three need an explicit route, because
 * their `effects` array is consumed by different triggers:
 * `Banana Peel` has `equipped: fallChance ×2` and `onFall: monsterDistance +15`,
 * and no amount of inspecting the op can tell you that `monsterDistance` there is
 * the fall, not the equipment. An explicit table is the only honest encoding —
 * guessing by op would silently move a bonus to the wrong trigger.
 *
 * `effects` is index-aligned with `item.effects`. `stackTrigger` is the trigger
 * that increments the `stacks` counter for "на этом предмете" items (§4.6).
 */
interface TriggerRouting {
  effects: HorrorTrigger[];
  stackTrigger?: HorrorTrigger;
  /**
   * `onGuess` stack increments that the reference gates by score
   * (`Binoculars`: "ПРИ ДОГАДКЕ 4000+: +2 на этом предмете"). The catalogue
   * records the `minScore` on the `onGuess` effects, not on the stack entry, so
   * the gate is restated here rather than invented at runtime.
   */
  stackMinScore?: number;
}

const TRIGGER_ROUTING: Record<string, TriggerRouting> = {
  stinkyPants: { effects: ["equipped"], stackTrigger: "onEat" },
  scroll: { effects: ["eachDay", "onBossWin"], stackTrigger: "onBossWin" },
  pillow: { effects: ["eachDay"], stackTrigger: "onHappyThoughts" },
  bananaPeel: { effects: ["equipped", "onFall"] },
  goldTooth: { effects: ["equipped", "eachDay"] },
  skateboard: { effects: ["equipped", "equipped", "onFall"] },
  jackOLantern: { effects: ["equipped", "afterDays"] },
  gulskinna: { effects: ["onBossWin", "onHappyThoughts"] },
  gpu: { effects: ["equipped", "eachDay"] },
  compostBin: { effects: ["equipped"], stackTrigger: "onEat" },
  staff: { effects: ["equipped"], stackTrigger: "onCast" },
  cleaver: { effects: ["equipped"], stackTrigger: "onEat" },
  binoculars: { effects: ["equipped"], stackTrigger: "onGuess", stackMinScore: 4000 },
  mapCase: { effects: ["equipped", "equipped", "onPuzzleSolve"] },
  lockpick: { effects: ["equipped", "onPuzzleSolve"] },
  chest: { effects: ["equipped", "onPuzzleSolve", "onPuzzleSolve"] },
  warDrum: { effects: ["equipped"], stackTrigger: "onBossWin" },
  trashArmor: { effects: ["equipped"], stackTrigger: "onDestroyOther" },
  saucer: { effects: ["equipped", "equipped", "onBossWin"] },
  rauðskinna: { effects: ["eachDay", "onCast"] },
};

/**
 * `Rubber Chicken`'s `destroySelf` rides on its own 50% branch (§3.3 pattern 1):
 * "on catch: 50% chance distance becomes 15, destroy this item". The catalogue
 * cannot express "this destroy is conditional on the preceding chance effect", so
 * the coupling is declared here rather than by making every `destroySelf`
 * conditional.
 */
const CHANCE_GATED_DESTROY = new Set(["rubberChicken"]);

/** Effects belonging to `trigger` for `item`, in catalogue order. */
export function effectsForTrigger(item: HorrorItem, trigger: HorrorTrigger): HorrorEffect[] {
  const routing = TRIGGER_ROUTING[item.id];
  if (!routing) {
    // Single-trigger item, or a multi-trigger item the table does not list:
    // the whole effect list belongs to every declared trigger. Every listed item
    // is above, so this branch only sees the unambiguous majority.
    return item.trigger.includes(trigger) ? item.effects : [];
  }
  const out: HorrorEffect[] = [];
  for (let i = 0; i < item.effects.length; i++) {
    if (routing.effects[i] === trigger) out.push(item.effects[i]);
  }
  return out;
}

/** The trigger that increments this item's stack counter, if any. */
function stackTriggerFor(item: HorrorItem): HorrorTrigger | undefined {
  if (!item.stacks) return undefined;
  const routing = TRIGGER_ROUTING[item.id];
  if (routing?.stackTrigger) return routing.stackTrigger;
  // Unrouted stack items increment on their only non-equipped trigger.
  const candidates = item.trigger.filter((t) => t !== "equipped");
  return candidates.length === 1 ? candidates[0] : candidates[0];
}

// ---------------------------------------------------------------------------
// Per-run item ledger
// ---------------------------------------------------------------------------

/**
 * Item-layer bookkeeping that is not part of the `HorrorRun` contract (§1.6).
 *
 * Kept in a `WeakMap` keyed by the run object, exactly like the engine's RNG
 * stream, so the persisted contract stays clean and a rebuilt run starts with a
 * clean ledger. Nothing here is a modifier — modifiers are always derived.
 */
export interface HorrorItemLedger {
  /** `oncePerDay` keys already spent today. */
  usedToday: Set<string>;
  /** `oneOf` branch already committed, keyed by item+trigger+day. */
  oneOfChoices: Map<string, number>;
  /** Day-scoped `guessThreshold` from consumed food (`Carrot Cake −75`, ...). */
  thresholdDelta: number;
  /** `doubleCatchCost` flags (`Hush Money`). */
  doubleCatchCost: Set<string>;
  /** Active puzzle shape (`Paper Map` 2x2, `Lockpick` twoStep, ...). */
  puzzleShape: string | null;
  /** `Lockpick` / `Map Case` / `Chest`: puzzle stays solved until day end. */
  puzzleUnlockUntilDayEnd: boolean;
  /** Days a `skipDay` item has queued but the caller has not applied yet. */
  pendingSkipDays: number;
  /** `Pedometer` step counters, keyed by item id. */
  stepCounters: Map<string, number>;
  /** `Jack-O'-Lantern`-style `afterDays` counters, keyed by item id. */
  daysHeld: Map<string, number>;
  /** Free Happy Thoughts uses owed by `Pacifier`. */
  freeHappyThoughts: number;
  /** Guard against a destruction cascade re-entering itself (§3.3). */
  destroyDepth: number;
}

const g = globalThis as unknown as {
  __horrorItemLedgers?: WeakMap<HorrorRun, HorrorItemLedger>;
};
const ledgers = (g.__horrorItemLedgers ??= new WeakMap<HorrorRun, HorrorItemLedger>());

export function horrorItemLedger(run: HorrorRun): HorrorItemLedger {
  let ledger = ledgers.get(run);
  if (!ledger) {
    ledger = {
      usedToday: new Set(),
      oneOfChoices: new Map(),
      thresholdDelta: 0,
      doubleCatchCost: new Set(),
      puzzleShape: null,
      puzzleUnlockUntilDayEnd: false,
      pendingSkipDays: 0,
      stepCounters: new Map(),
      daysHeld: new Map(),
      freeHappyThoughts: 0,
      destroyDepth: 0,
    };
    ledgers.set(run, ledger);
  }
  return ledger;
}

/**
 * Reset the day-scoped half of the ledger. Called by the act handler when a day
 * begins, next to `beginHorrorDay`.
 *
 * `thresholdDelta` clears because a food's gate reduction lasts the day (§4.3
 * treats items as an applied layer, and food is eaten within a day). Puzzle
 * unlocks clear because the reference says "until the end of day". `daysHeld`
 * deliberately survives: `afterDays 4` counts from when the item was taken.
 */
export function resetHorrorItemDay(run: HorrorRun): void {
  const ledger = horrorItemLedger(run);
  ledger.usedToday.clear();
  ledger.oneOfChoices.clear();
  ledger.thresholdDelta = 0;
  ledger.puzzleUnlockUntilDayEnd = false;
  ledger.freeHappyThoughts = 0;
  ledger.pendingSkipDays = 0;
  ledger.stepCounters.clear();
}

/** The `guessThreshold` adjustment the item layer contributes today (§4.3). */
export function horrorThresholdAdjustment(run: HorrorRun): number {
  return horrorItemLedger(run).thresholdDelta;
}

/** Queued `skipDay` days that the caller must still apply. */
export function takePendingSkipDays(run: HorrorRun): number {
  const ledger = horrorItemLedger(run);
  const days = ledger.pendingSkipDays;
  ledger.pendingSkipDays = 0;
  return days;
}

// ---------------------------------------------------------------------------
// Trigger context and result
// ---------------------------------------------------------------------------

export interface HorrorItemContext {
  /** Guess score, for `onGuess` / `onBossHit` gates. */
  score?: number;
  /** Guess duration in ms, for `Stopwatch`'s 15 s window. */
  guessMs?: number;
  /** Whether the panorama is indoors, for `Holy Water` / `Third Eye`. */
  insideLocation?: boolean;
  /** Boss id, for `onBossWin` gates (`scroll`, `saucer`). */
  bossId?: string;
  /** The item that was destroyed, for `onDestroyOther`. */
  destroyedItemId?: string;
  /** Charge family being spent, for `Moonstone`. */
  chargeFamily?: HorrorChargeFamily;
  /** Damage dealt, for `Shiina's Oni Mask`. */
  damageDealt?: number;
  /** Damage about to be taken, for `Voodoo Doll` / `Defibrillator`. */
  incomingDamage?: number;
  /** Clock, for deterministic tests. */
  now?: number;
}

export interface HorrorItemEvent {
  itemId: string;
  op: HorrorOp;
  value: number;
  /** Extra detail for the P4 ledger and the P6 UI. */
  detail?: Record<string, unknown>;
}

export interface HorrorTriggerResult {
  trigger: HorrorTrigger;
  events: HorrorItemEvent[];
  /** Item ids destroyed during this trigger, in order. */
  destroyed: string[];
  /** Item ids restored (`Duct Cake`). */
  restored: string[];
  /** Actual gold change (always within the pool). */
  goldDelta: number;
  /** Health actually restored. */
  healed: number;
  /** Health actually lost to `minus`/`heal −N` effects. */
  healthLost: number;
  /** Metres of lead gained (negative = lost). */
  distanceDelta: number;
  /** Days queued for the caller to skip. */
  skippedDays: number;
  /** True when `skipBoss` fired (`Hall Pass`). */
  bossSkipped: boolean;
  /** Effects that fired, for assertions. */
  fired: boolean;
}

function emptyResult(trigger: HorrorTrigger): HorrorTriggerResult {
  return {
    trigger,
    events: [],
    destroyed: [],
    restored: [],
    goldDelta: 0,
    healed: 0,
    healthLost: 0,
    distanceDelta: 0,
    skippedDays: 0,
    bossSkipped: false,
    fired: false,
  };
}

// ---------------------------------------------------------------------------
// Inventory primitives
// ---------------------------------------------------------------------------

/** Every item id the run currently holds: equipment slots then food. */
export function heldItemIds(run: HorrorRun): string[] {
  const ids: string[] = [];
  for (const slot of run.equipment) if (slot !== null) ids.push(slot);
  for (const id of run.food) ids.push(id);
  return ids;
}

export function isEquipped(run: HorrorRun, itemId: string): boolean {
  return run.equipment.includes(itemId);
}

/** The stack counter for an item, keyed by the catalogue's own `stacks.key`. */
export function itemStack(run: HorrorRun, item: HorrorItem): number {
  if (!item.stacks) return 0;
  return run.itemStacks[item.stacks.key] ?? 0;
}

/** Free equipment slot index, or -1. */
export function freeEquipmentSlot(run: HorrorRun): number {
  return run.equipment.indexOf(null);
}

/**
 * Put an item into the run. Equipment takes a free slot; food goes to the food
 * list; a Consumable that is not food goes to a slot too, because S1 shows
 * consumables living in `equipment` (`"defibrillator,pillow,compass"`).
 *
 * Returns the slot index, or -1 when there is no room.
 */
export function addItemToRun(run: HorrorRun, itemId: string): number {
  const item = getHorrorItem(itemId);
  if (!item) throw new Error(`unknown horror item "${itemId}"`);

  if (item.kind === "Food") {
    run.food.push(item.id);
    return -1;
  }
  const slot = freeEquipmentSlot(run);
  if (slot === -1) return -1;
  run.equipment[slot] = item.id;
  if (item.sellOverride !== undefined) {
    // `Gold Tooth` / `GPU` record their base sell value on the copy.
    run.itemStacks[`sellOverride:${item.id}`] = item.sellOverride;
  }
  return slot;
}

export interface EquipResult {
  ok: boolean;
  reason?: string;
  slot: number;
  events: HorrorItemEvent[];
  goldDelta: number;
}

/**
 * Equip an item into a specific slot (or the first free one).
 *
 * `Beggar's Hat` is "НАДЕТО: +1 золото" — granted **once per copy on equip**, not
 * per re-equip (§3.4 rule 1), which is why the grant is tracked on the copy's
 * stack namespace rather than recomputed.
 */
export function equipItem(run: HorrorRun, itemId: string, slot?: number): EquipResult {
  const item = getHorrorItem(itemId);
  if (!item) return { ok: false, reason: "unknown_item", slot: -1, events: [], goldDelta: 0 };
  if (item.kind === "Food") return { ok: false, reason: "is_food", slot: -1, events: [], goldDelta: 0 };

  const target = slot ?? freeEquipmentSlot(run);
  if (target < 0 || target >= run.equipment.length) {
    return { ok: false, reason: "no_slot", slot: -1, events: [], goldDelta: 0 };
  }
  if (run.equipment[target] !== null) {
    return { ok: false, reason: "slot_occupied", slot: target, events: [], goldDelta: 0 };
  }

  // Remove a matching food entry if this item was held as food.
  const foodIndex = run.food.indexOf(item.id);
  if (foodIndex !== -1) run.food.splice(foodIndex, 1);

  run.equipment[target] = item.id;
  const events: HorrorItemEvent[] = [];
  let goldDelta = 0;

  // Once-per-copy equip grants.
  const equipKey = `equipGrant:${item.id}`;
  if (run.itemStacks[equipKey] === undefined) {
    run.itemStacks[equipKey] = 1;
    for (const effect of effectsForTrigger(item, "equipped")) {
      if (effect.op === "gold") {
        goldDelta += grantGold(run, effect.value);
        events.push({ itemId: item.id, op: "gold", value: effect.value });
      }
      if (effect.op === "sellPrice") {
        run.itemStacks[`sellOverride:${item.id}`] = effect.sellOverride ?? effect.value;
        events.push({ itemId: item.id, op: "sellPrice", value: effect.sellOverride ?? effect.value });
      }
    }
  }

  return { ok: true, slot: target, events, goldDelta };
}

/** Remove an item from a slot without firing destruction subscriptions. */
export function unequipItem(run: HorrorRun, slot: number): string | null {
  if (slot < 0 || slot >= run.equipment.length) return null;
  const itemId = run.equipment[slot];
  run.equipment[slot] = null;
  return itemId;
}

// ---------------------------------------------------------------------------
// Gold — conservation is an invariant, not a convention (acceptance 3)
// ---------------------------------------------------------------------------

/**
 * Apply a signed gold change, clamped so the balance can never go negative.
 * Returns the change **actually applied**, which is what callers must log: an
 * item that costs 2 when the player has 1 moves 1, it does not move 2.
 */
export function grantGold(run: HorrorRun, delta: number): number {
  if (!Number.isFinite(delta)) return 0;
  const before = run.gold;
  // Guards the C19 invariant: no single grant may exceed 10 x Mythic.buy.
  const requested = delta > 0 ? Math.min(delta, HORROR_GOLD_GRANT_CEILING) : delta;
  run.gold = Math.max(0, before + requested);
  return run.gold - before;
}

/** Spend gold if affordable. Never lets the balance go below zero. */
export function spendGold(run: HorrorRun, amount: number): boolean {
  if (amount < 0) return false;
  if (run.gold < amount) return false;
  run.gold -= amount;
  return true;
}

// ---------------------------------------------------------------------------
// Destruction (§3.3)
// ---------------------------------------------------------------------------

export interface DestroyResult {
  destroyed: boolean;
  itemId: string | null;
  /** Effects fired by the destruction itself (the item's own trigger). */
  events: HorrorItemEvent[];
  /** `onDestroyOther` cascade from the surviving inventory. */
  cascade: HorrorTriggerResult[];
  /** Days queued by `Time Machine`, accumulated across the cascade. */
  skippedDays: number;
  reason: string;
}

const MAX_DESTROY_DEPTH = 8;

/**
 * Destroy a copy of `itemId`.
 *
 * Removal is a **broadcast** (§3.3): after the copy leaves the inventory, every
 * *other* equipped item receives `onDestroyOther`. That is the single mechanism
 * behind `Trash Armor` (`+15` lead per destroy), `Time Machine` (skip a day) and
 * `Græskinna`'s self-roll, and it is why destruction cannot be a bare `splice`.
 *
 * `skipDay` is queued, never applied inline: a destroy that skips a day that
 * destroys something else is exactly the loop §3.3 warns about, so the cascade
 * is depth-capped **and** the skip is deferred to the caller.
 */
export function destroyItem(run: HorrorRun, itemId: string, reason = "effect"): DestroyResult {
  const ledger = horrorItemLedger(run);
  const result: DestroyResult = {
    destroyed: false,
    itemId: null,
    events: [],
    cascade: [],
    skippedDays: 0,
    reason,
  };

  if (ledger.destroyDepth >= MAX_DESTROY_DEPTH) {
    return { ...result, reason: "depth_limit" };
  }

  const slot = run.equipment.indexOf(itemId);
  const foodIndex = run.food.indexOf(itemId);
  if (slot === -1 && foodIndex === -1) return result;

  ledger.destroyDepth += 1;
  try {
    if (slot !== -1) {
      run.equipment[slot] = null;
    } else {
      run.food.splice(foodIndex, 1);
    }

    const item = getHorrorItem(itemId);
    if (item?.stacks) delete run.itemStacks[item.stacks.key];
    delete run.itemStacks[`equipGrant:${itemId}`];
    delete run.itemStacks[`sellOverride:${itemId}`];
    ledger.daysHeld.delete(itemId);
    ledger.stepCounters.delete(itemId);

    run.destroyedStack.push(itemId);
    result.destroyed = true;
    result.itemId = itemId;
    result.events.push({ itemId, op: "destroySelf", value: 1, detail: { reason } });

    // Broadcast to survivors.
    for (const survivorId of [...run.equipment]) {
      if (survivorId === null || survivorId === itemId) continue;
      const survivor = getHorrorItem(survivorId);
      if (!survivor || !survivor.trigger.includes("onDestroyOther")) continue;
      const sub = applyHorrorTrigger(run, "onDestroyOther", {
        destroyedItemId: itemId,
        itemScope: survivorId,
      } as HorrorItemContext & { itemScope?: string });
      result.cascade.push(sub);
      result.skippedDays += sub.skippedDays;
    }
  } finally {
    ledger.destroyDepth -= 1;
  }

  return result;
}

/**
 * Destroy `count` random *other* items (`Anglerfish` destroys 3).
 *
 * The count clamps to `held − 1` so the player can never be left defenceless and
 * soft-locked (§3.3). On a two-item inventory `Anglerfish` therefore destroys one
 * item, not three — the clamp is load-bearing, not theoretical.
 */
export function destroyRandomItems(
  run: HorrorRun,
  count: number,
): { destroyed: string[]; cascade: HorrorTriggerResult[]; skippedDays: number } {
  const rng = horrorRngFor(run);
  const destroyed: string[] = [];
  const cascade: HorrorTriggerResult[] = [];
  let skippedDays = 0;

  const held = heldItemIds(run);
  const maxDestroyable = Math.max(0, held.length - 1);
  const targets = Math.min(Math.max(0, Math.floor(count)), maxDestroyable);

  const pool = [...held];
  for (let i = 0; i < targets && pool.length > 0; i++) {
    const index = Math.floor(rng() * pool.length) % pool.length;
    const [chosen] = pool.splice(index, 1);
    const result = destroyItem(run, chosen, "destroyRandom");
    if (!result.destroyed) continue;
    destroyed.push(chosen);
    cascade.push(...result.cascade);
    skippedDays += result.skippedDays;
  }

  return { destroyed, cascade, skippedDays };
}

/**
 * Restore the most recently destroyed item (`Duct Cake`).
 *
 * `run.destroyedStack` is a stack, so repeated cakes walk backwards through the
 * destruction history. Restoration puts the item back into a free slot (or the
 * food list) and **does not** re-fire `onDestroyOther` — nothing was destroyed.
 */
export function restoreLastDestroyed(run: HorrorRun): string | null {
  while (run.destroyedStack.length > 0) {
    const itemId = run.destroyedStack.pop() as string;
    const item = getHorrorItem(itemId);
    if (!item) continue;
    if (item.kind === "Food") {
      run.food.push(item.id);
      return item.id;
    }
    const slot = freeEquipmentSlot(run);
    if (slot === -1) {
      // No room: put it back on the stack so the next cake can try again rather
      // than silently swallowing the item.
      run.destroyedStack.push(item.id);
      return null;
    }
    run.equipment[slot] = item.id;
    return item.id;
  }
  return null;
}

// ---------------------------------------------------------------------------
// Gates (§3.4 rule 5, §4.3)
// ---------------------------------------------------------------------------

interface GateContext extends HorrorItemContext {
  /** Restricts evaluation to a single item id (used by the destroy broadcast). */
  itemScope?: string;
}

/**
 * Does a single effect's gate pass?
 *
 * Every gate in the catalogue is one of five predicates, and they all live here
 * so a gate can never be honoured on one trigger and forgotten on another.
 */
function effectGatePasses(effect: HorrorEffect, run: HorrorRun, ctx: GateContext): boolean {
  if (effect.minScore !== undefined && (ctx.score ?? 0) < effect.minScore) return false;
  if (effect.maxGuessMs !== undefined && (ctx.guessMs ?? Number.NEGATIVE_INFINITY) > effect.maxGuessMs) {
    return false;
  }
  if (effect.monsterWithinM !== undefined && run.monster.distance > effect.monsterWithinM) return false;
  if (effect.insideLocation === true && ctx.insideLocation !== true) return false;
  if (effect.belowFraction !== undefined) {
    if (run.maxHealth <= 0) return false;
    if (run.health / run.maxHealth > effect.belowFraction) return false;
  }
  if (effect.chance !== undefined && effect.chance < 1) {
    if (horrorRngFor(run)() >= effect.chance) return false;
  }
  return true;
}

/**
 * The item-level gate, from `item.condition` plus its own effect gates.
 *
 * An item with **any** score-gated effect only fires when every gate passes —
 * otherwise `Medal` would consume itself on a 4000-point guess because its
 * `destroySelf` carries no `minScore` of its own.
 */
function itemGatePasses(item: HorrorItem, run: HorrorRun, ctx: GateContext, trigger: HorrorTrigger): boolean {
  const condition = item.condition;
  if (condition) {
    if (condition.kind === "monsterWithinM" && run.monster.distance > condition.value) return false;
    if (condition.kind === "healthBelowFraction") {
      if (run.maxHealth <= 0) return false;
      if (run.health / run.maxHealth > condition.value) return false;
    }
    if (condition.kind === "guessAtLeast" && (ctx.score ?? 0) < condition.value) return false;
    if (condition.kind === "insideLocation" && ctx.insideLocation !== true) return false;
    // `monsterWithinGoldGuess` is a Razor-style composite that the catalogue
    // expresses as `condition.monsterWithinM`, so it cannot reach here today.
  }

  const effects = effectsForTrigger(item, trigger);
  const gated = effects.filter(
    (e) =>
      e.minScore !== undefined ||
      e.maxGuessMs !== undefined ||
      e.monsterWithinM !== undefined ||
      e.insideLocation === true ||
      e.belowFraction !== undefined,
  );
  if (gated.length === 0) return true;
  return gated.every((effect) => effectGatePasses(effect, run, ctx));
}

/** `oncePerDay` spend. Returns false when already used today. */
function consumeOncePerDay(run: HorrorRun, item: HorrorItem, trigger: HorrorTrigger): boolean {
  if (!item.oncePerDay) return true;
  const key = `${item.id}:${trigger}`;
  const ledger = horrorItemLedger(run);
  if (ledger.usedToday.has(key)) return false;
  ledger.usedToday.add(key);
  return true;
}

/** Which equipment slot an item id occupies, or -1. */
function slotOf(run: HorrorRun, itemId: string): number {
  return run.equipment.indexOf(itemId);
}

// ---------------------------------------------------------------------------
// The interpreter
// ---------------------------------------------------------------------------

/**
 * Run every effect an item exposes for `trigger`.
 *
 * Effects resolve in catalogue order, which matters: `Space Rock` destroys itself
 * *before* spawning the Saucer and healing, and `Anglerfish` destroys three items
 * before spawning a Mythic. Ordering is data, not implementation detail.
 */
export function applyHorrorTrigger(
  run: HorrorRun,
  trigger: HorrorTrigger,
  ctx: GateContext = {},
): HorrorTriggerResult {
  const result = emptyResult(trigger);
  const ledger = horrorItemLedger(run);

  for (const itemId of heldItemIds(run)) {
    if (ctx.itemScope !== undefined && itemId !== ctx.itemScope) continue;
    const item = getHorrorItem(itemId);
    if (!item) continue;
    if (!item.trigger.includes(trigger)) continue;

    const stackTrigger = stackTriggerFor(item);
    const effects = effectsForTrigger(item, trigger);
    const isStackTrigger = stackTrigger === trigger;

    // An item may only contribute a stack increment, with no direct effects.
    if (effects.length === 0 && !isStackTrigger) continue;
    if (!itemGatePasses(item, run, ctx, trigger)) continue;
    if (!consumeOncePerDay(run, item, trigger)) continue;

    // `Rubber Chicken`: the destroy rides on the same roll as the effect.
    let chanceRollPassed = true;

    for (const effect of effects) {
      if (effect.op === "oneOf") {
        result.fired = true;
        const branch = chooseOneOfBranch(run, item, trigger, effect);
        for (const inner of branch) {
          applyEffect(run, item, trigger, inner, ctx, result);
        }
        continue;
      }

      // A `destroySelf` that is coupled to a failed chance does not fire.
      if (effect.op === "destroySelf" && CHANCE_GATED_DESTROY.has(item.id) && !chanceRollPassed) continue;

      if (effect.chance !== undefined && effect.chance < 1) {
        // Rolled once per effect; a failure cancels this effect only.
        if (horrorRngFor(run)() >= effect.chance) {
          if (CHANCE_GATED_DESTROY.has(item.id)) chanceRollPassed = false;
          continue;
        }
        chanceRollPassed = true;
        result.fired = true;
        applyEffect(run, item, trigger, effect, ctx, result);
        continue;
      }

      result.fired = true;
      applyEffect(run, item, trigger, effect, ctx, result);
    }

    if (isStackTrigger) {
      // `Gráskinna`'s destroy can fire on the very cast that would increment it,
      // so the counter must not be re-created for a copy that is already gone
      // (§3.3: "a `stacks` bonus must die with its copy").
      if (heldItemIds(run).includes(item.id)) incrementStack(run, item, ctx, result);
    }
  }

  // `Rubber Chicken`'s destroy is declared as its own effect, so handle the
  // coupled case explicitly after the loop rather than relying on ordering.
  if (CHANCE_GATED_DESTROY.has("rubberChicken") && result.events.some((e) => e.itemId === "rubberChicken" && e.op === "monsterDistanceTo")) {
    // The distance was set, so the roll passed: the destroy already ran in order.
  }

  // `Anglerfish`-style spawns and destroys are handled by `applyEffect`.
  return result;
}

/** A `oneOf` branch is committed to the ledger so a reconnect cannot re-roll it. */
function chooseOneOfBranch(
  run: HorrorRun,
  item: HorrorItem,
  trigger: HorrorTrigger,
  effect: HorrorEffect,
): HorrorEffect[] {
  const branches = effect.branches ?? [];
  if (branches.length === 0) return [];
  const ledger = horrorItemLedger(run);
  const key = `${item.id}:${trigger}:${run.day}`;
  const committed = ledger.oneOfChoices.get(key);
  if (committed !== undefined && committed < branches.length) return branches[committed];
  const index = Math.floor(horrorRngFor(run)() * branches.length) % branches.length;
  ledger.oneOfChoices.set(key, index);
  return branches[index];
}

/** Add one to the copy's stack counter and fire the per-stack effects (§4.6). */
function incrementStack(
  run: HorrorRun,
  item: HorrorItem,
  ctx: GateContext,
  result: HorrorTriggerResult,
): void {
  if (!item.stacks) return;
  const routing = TRIGGER_ROUTING[item.id];
  if (routing?.stackMinScore !== undefined && (ctx.score ?? 0) < routing.stackMinScore) return;

  const current = itemStack(run, item);
  const next = item.stacks.max === undefined ? current + 1 : Math.min(item.stacks.max, current + 1);
  if (next === current) return;

  // `Gráskinna` uses the counter as a *doom* counter, not a bonus: its stack
  // effects must not be applied as damage/lead. Only its destroy chance grows,
  // and that is read at cast time by `destroyChanceFor`.
  if (item.id === "graSkinnaRare") {
    run.itemStacks[item.stacks.key] = next;
    result.events.push({
      itemId: item.id,
      op: "destroySelf",
      value: 0,
      detail: { doomCounter: next },
    });
    return;
  }

  run.itemStacks[item.stacks.key] = next;
  // The first stack is the copy's base contribution; each stack beyond the first
  // adds one `perStack` grant (§4.6: "this copy gets permanently better").
  for (const effect of item.stacks.perStack) {
    applyEffect(run, item, stackTriggerFor(item) ?? "equipped", effect, ctx, result);
  }
  result.events.push({ itemId: item.id, op: "monsterDistance", value: next, detail: { stacks: next } });
}

/**
 * Total lead contributed by an item's stack counter.
 *
 * Two items scale against a run statistic instead of a plain increment:
 * `Billionaire Suit` (`+1 per gold held`) and `Toe Tag` (`−1 per 100 health`).
 * Both are `perGold` / `perHealth` on the stack effect, and both are evaluated
 * here rather than accumulated, so spending gold or healing immediately changes
 * the lead with no cleanup code.
 */
export function stackLeadBonus(run: HorrorRun, item: HorrorItem): number {
  if (!item.stacks) return 0;
  const stacks = run.itemStacks[item.stacks.key] ?? 0;

  let total = 0;
  for (const effect of item.stacks.perStack) {
    if (effect.op !== "monsterDistance") continue;
    if (effect.perGold !== undefined) {
      // `Billionaire Suit`: the operand is the *run statistic*, not an
      // increment — "ЗА КАЖДОЕ ИМЕЮЩЕЕСЯ ЗОЛОТО: +1" is live while the suit is
      // held, so it must not be gated on a stack count that never grows. This is
      // exactly why gold is a defensive stat (§2.3) and why spending can cost
      // safety.
      total += Math.max(0, Math.floor(run.gold / Math.max(1, effect.perGold))) * effect.value;
    } else if (effect.perHealth !== undefined) {
      // `Toe Tag` is the mirror: its bonus *shrinks* as health rises, which makes
      // it anti-synergistic with every heal item (§3.7).
      total += Math.floor(Math.max(0, run.health) / effect.perHealth) * effect.value;
    } else if (stacks > 0) {
      // Ordinary "на этом предмете" growth: one increment per stack.
      total += effect.value * stacks;
    }
  }
  return total;
}

/** The stack-driven destroy chance for `Gráskinna` (§3.3 pattern 6). */
export function destroyChanceFor(run: HorrorRun, item: HorrorItem): number {
  if (!item.stacks) return 0;
  const stacks = run.itemStacks[item.stacks.key] ?? 0;
  const base = item.effects.find((e) => e.destroyChance !== undefined)?.destroyChance ?? 0;
  const perStack =
    item.effects.find((e) => e.destroyChancePerStack !== undefined)?.destroyChancePerStack ?? 0;
  return Math.min(1, base + perStack * stacks);
}

// ---------------------------------------------------------------------------
// One effect
// ---------------------------------------------------------------------------

function applyEffect(
  run: HorrorRun,
  item: HorrorItem,
  trigger: HorrorTrigger,
  effect: HorrorEffect,
  ctx: GateContext,
  result: HorrorTriggerResult,
): void {
  const ledger = horrorItemLedger(run);
  const record = (detail?: Record<string, unknown>) =>
    result.events.push({ itemId: item.id, op: effect.op, value: effect.value, detail });

  switch (effect.op) {
    // ── Lead and movement ────────────────────────────────────────────────────
    case "monsterDistance": {
      // The reference's signs are already correct and must not be inverted
      // (§3.4, C20): `+N` is more lead, `−N` is less.
      const delta = effect.value;
      run.monster.distance = Math.max(0, run.monster.distance + delta);
      result.distanceDelta += delta;
      record();
      return;
    }
    case "monsterDistanceTo": {
      // An absolute set is not a delta and never composes (§3.4 rule 4).
      const before = run.monster.distance;
      run.monster.distance = Math.max(0, effect.target ?? effect.value);
      result.distanceDelta += run.monster.distance - before;
      record({ before, after: run.monster.distance });
      return;
    }
    case "distancePerStep":
    case "healPerStep":
    case "doubleMoveChance":
    case "fallChance":
    case "ignoreLowHealthSlowdown":
      // Continuous, derived by the engine from `run.equipment`
      // (`deriveHorrorEngineMods`). Recording the event keeps the P4 ledger
      // complete without duplicating the derivation.
      record();
      return;

    // ── Health ───────────────────────────────────────────────────────────────
    case "heal": {
      const amount = effect.value;
      if (amount >= 0) {
        const healed = healPlayer(run, amount);
        result.healed += healed;
        record({ healed });
      } else {
        const applied = applyDamageToPlayer(run, -amount, "item");
        result.healthLost += applied.applied;
        record({ lost: applied.applied });
      }
      return;
    }
    case "healMultiplier":
    case "maxHealthMultiplier":
    case "bossDamageMultiplier":
    case "damageTakenMultiplier":
    case "bossDamageTaken":
    case "bossDamage":
    case "reflectBossHit":
    case "bossDamageFromDamageDealt":
    case "bossRewardGoldPerRank":
      // Combat-frame modifiers: the boss layer (P8) reads them via
      // `horrorCombatMods`. Recording here keeps the ledger complete.
      record();
      return;
    case "maxHealth": {
      const before = run.maxHealth;
      run.maxHealth = Math.max(1, run.maxHealth + effect.value);
      // Health can never exceed the cap; `Cursed Crown`'s −2000 therefore bites.
      run.health = Math.min(run.health, run.maxHealth);
      // `Nowlo's Tengu Mask` mirrors every max-health gain as healing (§3.6).
      if (run.maxHealth > before) {
        applyHorrorTrigger(run, "onGainMaxHealth", { ...ctx, score: ctx.score });
      }
      record({ before, after: run.maxHealth });
      return;
    }
    case "healthFloor":
      // Consumed by the engine's lethal check.
      record();
      return;
    case "cancelBossHitTo": {
      const floor = effect.cancelBossHitTo ?? effect.value;
      if (run.health <= 0) return;
      if ((ctx.incomingDamage ?? 0) >= run.health) {
        run.health = Math.max(0, Math.min(run.maxHealth, floor));
        record({ rescueTo: run.health });
        destroyItem(run, item.id, "onLethalBossHit");
      }
      return;
    }
    case "endDayAtDamage":
      // Consumed by `handleMonsterCatch` in the engine.
      record();
      return;

    // ── Gate ─────────────────────────────────────────────────────────────────
    case "guessThreshold": {
      // Items are an applied layer on the base ramp (§4.3): the delta is stored
      // on the day ledger and read by `horrorThresholdAdjustment`, never baked
      // into `thresholdForDay`.
      ledger.thresholdDelta += effect.value;
      record({ thresholdDelta: ledger.thresholdDelta });
      return;
    }
    case "ignoreThresholdChance":
      // Derived by the engine.
      record();
      return;

    // ── Economy ──────────────────────────────────────────────────────────────
    case "gold": {
      const applied = grantGold(run, effect.value);
      result.goldDelta += applied;
      if (applied > 0) run.counters.goldEarned += applied;
      record({ applied });
      return;
    }
    case "sellPrice":
    case "sellPricePerDay":
    case "foodPrice":
    case "freeReroll": {
      // `sellPrice` establishes the copy's base; `sellPricePerDay` is the stack
      // increment handled by `incrementStack`. Both are read by the merchant.
      if (effect.op === "sellPrice") {
        run.itemStacks[`sellOverride:${item.id}`] = effect.sellOverride ?? effect.value;
      }
      if (effect.op === "freeReroll") {
        run.freeRerolls += effect.freeReroll ?? effect.value;
      }
      record();
      return;
    }
    case "doubleCatchCost":
      ledger.doubleCatchCost.add(item.id);
      record();
      return;

    // ── Spells and charges ───────────────────────────────────────────────────
    case "grantSpell": {
      const count = effect.spells ?? effect.value;
      if (count === 0) {
        // `Scroll`'s `+0` is literal: the item alone grants nothing (§3.5).
        record({ granted: 0 });
        return;
      }
      // Nothing grants a *named* spell, so charges accumulate in one family and
      // the spell bar draws them from the run seed (§3.10).
      run.spells.random = (run.spells.random ?? 0) + count;
      record({ granted: count, total: run.spells.random });
      return;
    }
    case "grantCharges": {
      // `Moonstone`: 50% chance to keep the charge that was just spent.
      const family = ctx.chargeFamily;
      if (family === undefined) {
        record({ kept: false, reason: "no_family" });
        return;
      }
      const keep = effect.keepChargeChance ?? 1;
      if (horrorRngFor(run)() < keep) {
        const key = `charge:${family}`;
        run.itemStacks[key] = (run.itemStacks[key] ?? 0) + 1;
        record({ kept: true, family });
      } else {
        record({ kept: false, family });
      }
      return;
    }
    case "omen":
      run.counters.omenCast += effect.value;
      run.spells.omen = (run.spells.omen ?? 0) + effect.value;
      record();
      return;
    case "scry":
      run.spells.scry = (run.spells.scry ?? 0) + effect.value;
      record();
      return;

    // ── Happy Thoughts ───────────────────────────────────────────────────────
    case "happyThoughts": {
      if (effect.restoreHappyThoughts) {
        // Charges are conserved: restore re-arms from the pool and tops it up by
        // one if it was empty, which is what "restores Happy Thoughts" means.
        run.happyThoughtsCharges = Math.max(1, run.happyThoughtsCharges);
        run.happyThoughtsReady = true;
        record({ restored: true });
        return;
      }
      if (effect.durationS !== undefined) {
        run.itemStacks["happyThoughts:durationS"] =
          (run.itemStacks["happyThoughts:durationS"] ?? 0) + effect.durationS;
        record({ durationDelta: effect.durationS });
        return;
      }
      if (effect.healDelta !== undefined) {
        run.itemStacks["happyThoughts:healDelta"] =
          (run.itemStacks["happyThoughts:healDelta"] ?? 0) + effect.healDelta;
        record({ healDelta: effect.healDelta });
        return;
      }
      record();
      return;
    }
    case "freeHappyThoughts":
      // "Free use only — it does not grant a charge" (§3.5).
      ledger.freeHappyThoughts += 1;
      run.happyThoughtsReady = true;
      record();
      return;
    case "omenChanceOnHappyThoughts":
      run.spells.omen = (run.spells.omen ?? 0) + (effect.omenChanceOnHappyThoughts ?? 1);
      record();
      return;

    // ── Calendar ─────────────────────────────────────────────────────────────
    case "skipDay": {
      const days = effect.skipDays ?? effect.value;
      // Queued, never applied inline: a skip inside a destruction cascade is the
      // loop §3.3 warns about.
      ledger.pendingSkipDays += days;
      result.skippedDays += days;
      record({ days });
      return;
    }
    case "skipBoss":
      result.bossSkipped = true;
      record();
      return;
    case "waitDays":
      // `Jack-O'-Lantern`: counted from when the item was taken, tracked by
      // `tickItemDays`. `afterDays` is the *trigger*, not an op.
      record({ days: effect.days ?? effect.value });
      return;

    // ── Puzzle (§4.7) ────────────────────────────────────────────────────────
    case "puzzleStep": {
      run.puzzlePieces = Math.max(1, run.puzzlePieces + effect.value);
      record({ pieces: run.puzzlePieces });
      return;
    }
    case "puzzleShape": {
      // Only one shape may be active, and `Chest` beats `Lockpick` (§4.7).
      const shape = effect.shape ?? null;
      if (shape === "picklock" || ledger.puzzleShape === null || ledger.puzzleShape !== "picklock") {
        ledger.puzzleShape = shape;
      }
      record({ shape: ledger.puzzleShape });
      return;
    }
    case "puzzleUnlockUntilDayEnd":
      ledger.puzzleUnlockUntilDayEnd = true;
      record();
      return;

    // ── Inventory ────────────────────────────────────────────────────────────
    case "extraSlot":
      run.equipment.push(null);
      record({ slots: run.equipment.length });
      return;
    case "spawnRarity": {
      const spawned = spawnRandomItem(run, effect.rarity ?? "Common", effect.kind);
      record({ spawned });
      return;
    }
    case "spawnEquipment": {
      const itemId = effect.itemId ?? effect.spawnEquipment;
      if (!itemId) return;
      const slot = addItemToRun(run, itemId);
      record({ spawned: itemId, slot });
      return;
    }
    case "destroyRandom": {
      const outcome = destroyRandomItems(run, effect.destroyRandom ?? effect.value);
      result.destroyed.push(...outcome.destroyed);
      result.skippedDays += outcome.skippedDays;
      record({ destroyed: outcome.destroyed });
      return;
    }
    case "restoreDestroyed": {
      const restored = restoreLastDestroyed(run);
      if (restored) result.restored.push(restored);
      record({ restored });
      return;
    }
    case "destroySelf": {
      // `Gráskinna`'s destroy is probabilistic and grows with its stack counter.
      if (effect.destroyChance !== undefined) {
        const chance = destroyChanceFor(run, item);
        if (horrorRngFor(run)() >= chance) {
          record({ destroyed: false, chance });
          return;
        }
      }
      const outcome = destroyItem(run, item.id, "destroySelf");
      if (outcome.destroyed) result.destroyed.push(item.id);
      result.skippedDays += outcome.skippedDays;
      record({ destroyed: outcome.destroyed });
      return;
    }

    // ── Presentation ─────────────────────────────────────────────────────────
    case "bypassModifier":
      run.itemStacks[`bypass:${effect.modifier ?? "unknown"}`] = 1;
      record({ modifier: effect.modifier });
      return;
    case "noJumpscareOnReject":
    case "rejectBlockReduction":
      // Derived by the engine.
      record();
      return;
    case "insideLocationBonus":
      record();
      return;
    case "never":
      record({ granted: 0 });
      return;

    default:
      // Every `HorrorOp` in the vocabulary is handled above; an unreachable op
      // would be a type error, so this is only defence against a hand-edited run.
      record({ unhandled: true });
      return;
  }
}

// ---------------------------------------------------------------------------
// Spawning (§3.3: resolved server-side from the run seed)
// ---------------------------------------------------------------------------

/**
 * Grant a random item of `rarity` (and `kind`, when given).
 *
 * Resolved from the run seed so a disconnect cannot reroll a Mythic (§3.3).
 * Returns the spawned id, or null when the rarity/kind combination is empty.
 */
export function spawnRandomItem(
  run: HorrorRun,
  rarity: HorrorRarity,
  kind?: "Equipment" | "Food" | "Consumable",
): string | null {
  // Imported lazily through the catalogue map to keep the hot path allocation-free.
  const pool = horrorSpawnPool(rarity, kind);
  if (pool.length === 0) return null;
  const rng = horrorRngFor(run);
  const chosen = pool[Math.floor(rng() * pool.length) % pool.length];
  addItemToRun(run, chosen);
  return chosen;
}

const spawnPools = new Map<string, string[]>();

function horrorSpawnPool(
  rarity: HorrorRarity,
  kind?: "Equipment" | "Food" | "Consumable",
): string[] {
  const key = `${rarity}:${kind ?? "*"}`;
  const cached = spawnPools.get(key);
  if (cached) return cached;
  // Populated on first use from the live catalogue, so a catalogue edit cannot
  // leave a stale spawn table behind.
  const pool: string[] = [];
  for (const id of allCatalogueIds()) {
    const item = getHorrorItem(id);
    if (!item) continue;
    if (item.rarity !== rarity) continue;
    if (kind !== undefined && item.kind !== kind) continue;
    pool.push(item.id);
  }
  spawnPools.set(key, pool);
  return pool;
}

let catalogueIds: string[] | null = null;
function allCatalogueIds(): string[] {
  if (catalogueIds === null) {
    // The catalogue's own id list, obtained through the lookup helper so the
    // module never needs a direct import of `HORROR_ITEMS` (which would create a
    // larger surface than this module needs).
    catalogueIds = horrorCatalogueIds();
  }
  return catalogueIds;
}

// ---------------------------------------------------------------------------
// Pricing (§2.4) — one definition, used by the merchant
// ---------------------------------------------------------------------------

/**
 * The price of an item at the merchant, with `Coupon Book` applied to food.
 *
 * `foodPriceDelta` is negative (`Coupon Book −1`) and floored at **1**: an item
 * that costs nothing would let `Loyalty Card`'s "buy all four" bonus be farmed.
 */
export function itemBuyPrice(item: HorrorItem, foodPriceDelta = 0): number {
  const economy = HORROR_RARITY_ECONOMY[item.rarity];
  const base = item.kind === "Food" ? economy.food : economy.buy;
  return Math.max(1, base + (item.kind === "Food" ? foodPriceDelta : 0));
}

/**
 * The sell price of a copy.
 *
 * `Gold Tooth` and `GPU` are the game's only appreciating assets: their base is
 * `sellOverride` and each day held raises it by `sellPricePerDay`, which is
 * exactly the stack counter (§2.4).
 */
export function itemSellPrice(run: HorrorRun, item: HorrorItem): number {
  if (item.sellOverride !== undefined) {
    const base = run.itemStacks[`sellOverride:${item.id}`] ?? item.sellOverride;
    const stacks = item.stacks ? run.itemStacks[item.stacks.key] ?? 0 : 0;
    const perDay = item.stacks?.perStack.find((e) => e.sellPricePerDay !== undefined)?.sellPricePerDay ?? 0;
    return Math.max(0, base + perDay * stacks);
  }
  if (item.sellOverride !== undefined) return item.sellOverride;
  return HORROR_RARITY_ECONOMY[item.rarity].sell;
}

// ---------------------------------------------------------------------------
// Day-boundary bookkeeping (§1.2, §3.3, §4.6)
// ---------------------------------------------------------------------------

export interface HorrorItemDayTickResult {
  events: HorrorItemEvent[];
  destroyed: string[];
  skippedDays: number;
  goldDelta: number;
  healed: number;
}

/**
 * Advance the item layer by one day **before** the player acts (§3.4 rule 7).
 *
 * `eachDay` items fire here, so their gold is spendable on that day's merchant
 * visit. Two extra mechanics also land here:
 *
 * - `afterDays` counters (`Jack-O'-Lantern` self-destructs after 4 days held);
 * - the `sellPricePerDay` increments are already expressed as stack growth, which
 *   `Gold Tooth` / `GPU` drive from their own `eachDay` stack trigger.
 */
export function tickItemDays(run: HorrorRun): HorrorItemDayTickResult {
  const result: HorrorItemDayTickResult = {
    events: [],
    destroyed: [],
    skippedDays: 0,
    goldDelta: 0,
    healed: 0,
  };
  const ledger = horrorItemLedger(run);

  // `afterDays` first: an item that is about to expire should not also pay out.
  for (const itemId of [...run.equipment]) {
    if (itemId === null) continue;
    const item = getHorrorItem(itemId);
    if (!item) continue;
    const expiry = item.effects.find((e) => e.op === "destroySelf" && e.days !== undefined);
    if (!expiry || !item.trigger.includes("afterDays")) continue;
    const held = (ledger.daysHeld.get(itemId) ?? 0) + 1;
    ledger.daysHeld.set(itemId, held);
    if (held >= (expiry.days ?? 0)) {
      const outcome = destroyItem(run, itemId, "afterDays");
      if (outcome.destroyed) result.destroyed.push(itemId);
      result.skippedDays += outcome.skippedDays;
    }
  }

  const day = applyHorrorTrigger(run, "eachDay", {});
  result.events.push(...day.events);
  result.destroyed.push(...day.destroyed);
  result.skippedDays += day.skippedDays;
  result.goldDelta += day.goldDelta;
  result.healed += day.healed;

  return result;
}

/**
 * Advance per-step item counters (`Pedometer` grants a spell every 40 steps).
 * Returns the events so the caller can log them; gold/heal changes land on `run`.
 */
export function tickItemSteps(run: HorrorRun): HorrorItemEvent[] {
  const events: HorrorItemEvent[] = [];
  const ledger = horrorItemLedger(run);

  for (const itemId of [...run.equipment]) {
    if (itemId === null) continue;
    const item = getHorrorItem(itemId);
    if (!item || !item.trigger.includes("onStep")) continue;
    const every = item.effects.find((e) => e.everySteps !== undefined)?.everySteps;
    if (every === undefined) continue;
    const steps = (ledger.stepCounters.get(itemId) ?? 0) + 1;
    if (steps >= every) {
      ledger.stepCounters.set(itemId, 0);
      const outcome = applyHorrorTrigger(run, "onStep", { itemScope: itemId });
      events.push(...outcome.events);
    } else {
      ledger.stepCounters.set(itemId, steps);
    }
  }

  return events;
}

// ---------------------------------------------------------------------------
// Derived item-layer state the rest of the server reads
// ---------------------------------------------------------------------------

export interface HorrorItemMods {
  /** Sum of equipped `foodPrice` deltas (`Coupon Book −1`). */
  foodPriceDelta: number;
  /** `Loyalty Card`: free rerolls granted on buying all four offers. */
  freeRerollsOnFullBuy: number;
  /** `Wanted Poster`: gold per boss rank on a win. */
  bossWinGoldPerRank: number;
  /** Active puzzle shape, or null. */
  puzzleShape: string | null;
  /** Puzzle stays solved until the end of the day. */
  puzzleUnlockUntilDayEnd: boolean;
  /** `Hush Money`: the next catch costs double. */
  doubleCatchCost: boolean;
  /** Days an item has queued for the caller to skip. */
  pendingSkipDays: number;
}

/** Derive the item-layer modifiers the merchant and act handler need. */
export function deriveHorrorItemMods(run: HorrorRun): HorrorItemMods {
  const ledger = horrorItemLedger(run);
  let foodPriceDelta = 0;
  let freeRerollsOnFullBuy = 0;
  let bossWinGoldPerRank = 0;

  for (const itemId of run.equipment) {
    if (itemId === null) continue;
    const item = getHorrorItem(itemId);
    if (!item) continue;
    for (const effect of item.effects) {
      if (effect.op === "foodPrice") foodPriceDelta += effect.foodPriceDelta ?? effect.value;
      if (effect.op === "freeReroll") freeRerollsOnFullBuy += effect.freeReroll ?? effect.value;
      if (effect.op === "bossRewardGoldPerRank") {
        bossWinGoldPerRank += effect.bossRewardGoldPerRank ?? effect.value;
      }
    }
  }

  return {
    foodPriceDelta,
    freeRerollsOnFullBuy,
    bossWinGoldPerRank,
    puzzleShape: ledger.puzzleShape,
    puzzleUnlockUntilDayEnd: ledger.puzzleUnlockUntilDayEnd,
    doubleCatchCost: ledger.doubleCatchCost.size > 0,
    pendingSkipDays: ledger.pendingSkipDays,
  };
}

/** All items that increment a stack counter, for P10's coverage test. */
export function stackItemIds(): readonly string[] {
  return HORROR_ITEM_STACK_EFFECTS;
}

/**
 * Whether an item is currently equipped and therefore contributing continuous
 * modifiers. Exposed because the merchant must not sell a second copy of a
 * one-of (the `Chest` / `Lockpick` family is the only case that matters today).
 */
export function isItemHeld(run: HorrorRun, itemId: string): boolean {
  return heldItemIds(run).includes(itemId);
}

/** Slot count including `Belt Buster` gains. */
export function equipmentSlotCount(run: HorrorRun): number {
  return Math.max(HORROR_INVENTORY_SLOTS, run.equipment.length);
}

/** The slot index an equipped item occupies, or -1 (exported for the API). */
export function equipmentSlotOf(run: HorrorRun, itemId: string): number {
  return slotOf(run, itemId);
}

function horrorCatalogueIds(): string[] {
  return HORROR_ITEMS.map((item) => item.id);
}