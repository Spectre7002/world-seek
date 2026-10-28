// HorrorGuessr — the merchant (§2.1–§2.4, §8 P3).
//
// Seeded offers, buy / reroll / sell, and the three merchant modifiers the
// reference actually attests. Everything here is derived from `run.seed`, so a
// visit is reproducible and a disconnect cannot reroll a Mythic (§7.4).
//
// **The economy's shape, from the evidence:**
// - 4 offers per visit, no duplicates (§2.2, `HORROR_OFFERS_PER_VISIT`).
// - Common 2, Uncommon 2, Rare 4, Mythic 16 to buy; Mythic gated to day 13 (§2.1).
// - A paid reroll costs exactly **1** gold (S2 `cost:1`, C2) and free rerolls are
//   consumed first (§2.4).
// - Gold comes only from items: `gold_earned: 0` on a successful Chase day (S1),
//   and the largest grant anywhere is `Lobster +16` (§2.3).
// - Gold is also a **defensive stat**, because `Billionaire Suit` converts held
//   gold into lead — so every spend here can reduce safety, which is why the
//   run's existing lead is never recomputed by the merchant.

import type {
  HorrorItem,
  HorrorRarity,
  HorrorRun,
  MerchantOffer,
  MerchantState,
} from "../shared/horrorTypes";
import {
  HORROR_ITEMS,
  HORROR_OFFERS_PER_VISIT,
  HORROR_RARITY_ECONOMY,
  HORROR_REROLL_COST,
  getHorrorItem,
} from "../shared/horrorCatalogue";
import { horrorRngFor } from "./horrorEngine";
import {
  addItemToRun,
  deriveHorrorItemMods,
  destroyItem,
  freeEquipmentSlot,
  grantGold,
  horrorItemLedger,
  itemBuyPrice,
  itemSellPrice,
} from "./horrorItems";

// ---------------------------------------------------------------------------
// Merchant state
// ---------------------------------------------------------------------------

export interface HorrorMerchantVisit extends MerchantState {
  /** Free rerolls the run had when the visit opened. */
  freeRerollsAtOpen: number;
}

/**
 * Open visits, keyed by runId. Kept out of `HorrorRun` so the §1.6 contract does
 * not grow a shop: a merchant visit is scoped to one day and is discarded by
 * `closeMerchantVisit`. Held on `globalThis` so every route module instance
 * (dev route isolation, HMR) sees the same visits.
 */
const g = globalThis as unknown as {
  __horrorMerchantVisits?: Map<string, HorrorMerchantVisit>;
};
const visits = (g.__horrorMerchantVisits ??= new Map<string, HorrorMerchantVisit>());

export function getMerchantVisit(runId: string): HorrorMerchantVisit | undefined {
  return visits.get(runId);
}

export function closeMerchantVisit(runId: string): void {
  visits.delete(runId);
}

/** Clear all visits. Tests only. */
export function resetMerchant(): void {
  visits.clear();
}

// ---------------------------------------------------------------------------
// Offer generation (§2.4)
// ---------------------------------------------------------------------------

/**
 * Rarities eligible on `day`.
 *
 * `minDay` is the only gate: Uncommon from day 4, Rare from day 8, Mythic from
 * day 13 (S3: "the visit after day 12"). Mythic's gate is the one the plan states
 * explicitly and the one that matters — a day-12 shop cannot contain one.
 */
export function eligibleRarities(day: number): HorrorRarity[] {
  const out: HorrorRarity[] = [];
  for (const rarity of ["Common", "Uncommon", "Rare", "Mythic"] as HorrorRarity[]) {
    if (day >= HORROR_RARITY_ECONOMY[rarity].minDay) out.push(rarity);
  }
  return out;
}

/** Item ids of a rarity that are legal on `day`. */
function poolForRarity(rarity: HorrorRarity, day: number): string[] {
  const pool: string[] = [];
  for (const item of horrorCatalogue()) {
    if (item.rarity !== rarity) continue;
    if (day < HORROR_RARITY_ECONOMY[rarity].minDay) continue;
    if (item.minDay !== undefined && day < item.minDay) continue;
    if (item.bossReward) continue; // boss rewards are rolled, never sold
    pool.push(item.id);
  }
  return pool;
}

/**
 * Weighted rarity draw. Weights are Common 70 / Uncommon 20 / Rare 8 / Mythic 2
 * (§2.1), renormalised over the rarities currently eligible so an early shop
 * still produces four offers rather than four failed draws.
 */
function drawRarity(day: number, rng: () => number): HorrorRarity {
  const eligible = eligibleRarities(day);
  const total = eligible.reduce((sum, r) => sum + HORROR_RARITY_ECONOMY[r].weight, 0);
  let roll = rng() * total;
  for (const rarity of eligible) {
    roll -= HORROR_RARITY_ECONOMY[rarity].weight;
    if (roll <= 0) return rarity;
  }
  return eligible[eligible.length - 1];
}

export interface HorrorOfferOptions {
  /** Overrides the seeded stream, for a deterministic test. */
  rng?: () => number;
}

/**
 * Generate one visit's offers.
 *
 * **No duplicates in one visit** (§2.4) is enforced across rarities, not within
 * one, because the same item cannot appear twice regardless of which rarity slot
 * it was drawn for. A draw that only finds already-offered items falls back to
 * the cheapest eligible rarity and then to any un-offered item, so a nearly
 * exhausted pool degrades to a short offer list only when the pool itself is
 * short — never to a duplicate.
 */
export function rollMerchantOffers(
  run: HorrorRun,
  options?: HorrorOfferOptions,
): MerchantOffer[] {
  const rng = options?.rng ?? horrorRngFor(run);
  const offers: MerchantOffer[] = [];
  const taken = new Set<string>();
  const foodPriceDelta = deriveHorrorItemMods(run).foodPriceDelta;

  for (let i = 0; i < HORROR_OFFERS_PER_VISIT; i++) {
    const rarity = drawRarity(run.day, rng);
    const itemId = pickFromPool(poolForRarity(rarity, run.day), taken, rng);
    if (itemId === null) {
      // Pool exhausted for this rarity: try every eligible rarity before giving
      // up, so a visit is short only when the catalogue genuinely is.
      const fallback = pickAnyEligible(run.day, taken, rng);
      if (fallback === null) break;
      const item = getHorrorItem(fallback);
      if (!item) break;
      taken.add(fallback);
      offers.push({
        itemId: fallback,
        rarity: item.rarity,
        price: itemBuyPrice(item, foodPriceDelta),
      });
      continue;
    }
    const item = getHorrorItem(itemId);
    if (!item) continue;
    taken.add(itemId);
    offers.push({
      itemId,
      rarity: item.rarity,
      price: itemBuyPrice(item, foodPriceDelta),
    });
  }

  return offers;
}

function pickFromPool(pool: string[], taken: Set<string>, rng: () => number): string | null {
  const available = pool.filter((id) => !taken.has(id));
  if (available.length === 0) return null;
  return available[Math.floor(rng() * available.length) % available.length];
}

function pickAnyEligible(day: number, taken: Set<string>, rng: () => number): string | null {
  const available: string[] = [];
  for (const rarity of eligibleRarities(day)) {
    for (const id of poolForRarity(rarity, day)) {
      if (!taken.has(id)) available.push(id);
    }
  }
  if (available.length === 0) return null;
  return available[Math.floor(rng() * available.length) % available.length];
}

// ---------------------------------------------------------------------------
// Opening a visit
// ---------------------------------------------------------------------------

export interface OpenVisitResult {
  visit: HorrorMerchantVisit;
  reused: boolean;
}

/**
 * Open (or re-open) the day's visit.
 *
 * Idempotent per day: reconnecting must not reroll the shop, so a live visit for
 * the same day is returned as-is. Rerolls are the *only* way the offer list
 * changes, and each costs gold or a free reroll.
 */
export function openMerchantVisit(run: HorrorRun): OpenVisitResult {
  const existing = visits.get(run.runId);
  if (existing && existing.day === run.day) {
    return { visit: existing, reused: true };
  }
  const visit: HorrorMerchantVisit = {
    day: run.day,
    offers: rollMerchantOffers(run),
    boughtCount: 0,
    rerolledCount: 0,
    freeRerollsAtOpen: run.freeRerolls,
  };
  visits.set(run.runId, visit);
  return { visit, reused: false };
}

// ---------------------------------------------------------------------------
// Buying (§2.2, §2.4)
// ---------------------------------------------------------------------------

export interface HorrorBuyResult {
  ok: boolean;
  reason?: string;
  itemId?: string;
  pricePaid?: number;
  slot?: number;
  /** `Loyalty Card`: free reroll granted for buying all four offers. */
  freeRerollsGranted?: number;
  goldGranted?: number;
  gold?: number;
}

/**
 * Buy one offer.
 *
 * Rules, in order:
 * 1. The visit must be open for today.
 * 2. The offer must still be on the shelf (`bought` is tracked on the visit).
 * 3. Gold must cover the price — a purchase can never overdraw (acceptance 3).
 * 4. Equipment/consumables need a free slot; **food does not**, so a full-slot
 *    run can still buy food. A failed slot check must refund nothing because
 *    nothing was charged yet.
 * 5. `Loyalty Card`'s "on buying all four offers: free reroll, +5 gold" fires
 *    once, when `boughtCount` reaches the number of offers (§2.4).
 */
export function buyMerchantOffer(run: HorrorRun, offerIndex: number): HorrorBuyResult {
  const visit = visits.get(run.runId);
  if (!visit || visit.day !== run.day) return { ok: false, reason: "no_visit" };
  const offer = visit.offers[offerIndex];
  if (!offer) return { ok: false, reason: "no_offer" };
  if (offer.itemId === SOLD) return { ok: false, reason: "already_sold" };

  const item = getHorrorItem(offer.itemId);
  if (!item) return { ok: false, reason: "unknown_item" };

  // Slot check before charging, so a failed buy is a no-op.
  if (item.kind !== "Food" && freeEquipmentSlot(run) === -1) {
    return { ok: false, reason: "no_slot", itemId: item.id };
  }

  const price = offer.price;
  if (run.gold < price) return { ok: false, reason: "insufficient_gold", itemId: item.id, pricePaid: 0 };

  run.gold -= price;
  const slot = addItemToRun(run, item.id);
  visit.offers[offerIndex] = { ...offer, itemId: SOLD };
  visit.boughtCount += 1;

  const result: HorrorBuyResult = {
    ok: true,
    itemId: item.id,
    pricePaid: price,
    slot,
    gold: run.gold,
  };

  // `Loyalty Card` listens for "bought all four cards" — literal in the
  // reference, so it is the offer count, not a fixed 4 (§2.4).
  const mods = deriveHorrorItemMods(run);
  if (mods.freeRerollsOnFullBuy > 0 && visit.boughtCount === visit.offers.length) {
    const key = `loyalty:${run.day}`;
    const ledger = horrorItemLedger(run);
    if (!ledger.usedToday.has(key)) {
      ledger.usedToday.add(key);
      const free = mods.freeRerollsOnFullBuy;
      run.freeRerolls += free;
      const grantedGold = grantGold(run, LOYALTY_FULL_BUY_GOLD);
      result.freeRerollsGranted = free;
      result.goldGranted = grantedGold;
      result.gold = run.gold;
    }
  }

  return result;
}

/**
 * The `Loyalty Card` payout. The catalogue carries `freeReroll 1` and `gold 5` on
 * the item, and the "all four" condition lives in the reference text rather than
 * the effect, so the gold is restated here as a named constant.
 */
const LOYALTY_FULL_BUY_GOLD = 5;

/**
 * Sentinel written into a bought offer slot.
 *
 * A NUL prefix cannot collide with a real item id (all catalogue ids are
 * camelCase ASCII), and keeping the slot rather than splicing means `offerIndex`
 * stays stable for the client between renders.
 */
const SOLD = "\u0000sold";

export function isOfferSold(offer: MerchantOffer): boolean {
  return offer.itemId === SOLD;
}

// ---------------------------------------------------------------------------
// Rerolling (§2.2, §2.4)
// ---------------------------------------------------------------------------

export interface HorrorRerollResult {
  ok: boolean;
  reason?: string;
  /** True when a free reroll was spent instead of gold. */
  usedFree: boolean;
  cost: number;
  offers?: MerchantOffer[];
  gold?: number;
  freeRerolls?: number;
}

/**
 * Reroll the shelf.
 *
 * `free_rerolls` are consumed **before** paid rerolls (§2.4), and a paid reroll
 * costs `HORROR_REROLL_COST` = 1 (S2, C2). The S2 sequence is the exact witness:
 * `merchant_rerolled { cost: 1, gold: 7 → 6 }`.
 *
 * A reroll with no free charges and less than 1 gold is rejected rather than
 * silently free — the conservation test depends on that.
 */
export function rerollMerchantOffers(run: HorrorRun): HorrorRerollResult {
  const visit = visits.get(run.runId);
  if (!visit || visit.day !== run.day) return { ok: false, reason: "no_visit", usedFree: false, cost: 0 };

  let usedFree = false;
  let cost = 0;

  if (run.freeRerolls > 0) {
    run.freeRerolls -= 1;
    usedFree = true;
  } else {
    cost = HORROR_REROLL_COST;
    if (run.gold < cost) {
      return {
        ok: false,
        reason: "insufficient_gold",
        usedFree: false,
        cost,
        gold: run.gold,
        freeRerolls: run.freeRerolls,
      };
    }
    run.gold -= cost;
  }

  visit.offers = rollMerchantOffers(run);
  visit.rerolledCount += 1;
  // A reroll resets the "bought all four" progress: the shelf is new, and the
  // count must describe *this* shelf or `Loyalty Card` would double-pay.
  visit.boughtCount = 0;

  return {
    ok: true,
    usedFree,
    cost,
    offers: visit.offers,
    gold: run.gold,
    freeRerolls: run.freeRerolls,
  };
}

// ---------------------------------------------------------------------------
// Selling (§2.4)
// ---------------------------------------------------------------------------

export interface HorrorSellResult {
  ok: boolean;
  reason?: string;
  itemId?: string;
  goldReceived?: number;
  gold?: number;
  slotsFreed?: number;
}

/**
 * Sell a held copy.
 *
 * Price is `itemSellPrice`, which honours `sellOverride` and the appreciating
 * `sellPricePerDay` on `Gold Tooth` / `GPU` (§2.4). Selling goes through
 * `destroyItem` deliberately: it is the same removal path, so `onDestroyOther`
 * subscribers (`Trash Armor`, `Time Machine`) fire and no buff outlives the copy.
 */
export function sellItem(run: HorrorRun, itemId: string): HorrorSellResult {
  const item = getHorrorItem(itemId);
  if (!item) return { ok: false, reason: "unknown_item" };

  const inEquipment = run.equipment.includes(item.id);
  const inFood = run.food.includes(item.id);
  if (!inEquipment && !inFood) return { ok: false, reason: "not_held", itemId: item.id };

  const price = itemSellPrice(run, item);
  const beforeSlots = run.equipment.filter((s) => s !== null).length;
  const outcome = destroyItem(run, item.id, "sold");
  if (!outcome.destroyed) return { ok: false, reason: "not_held", itemId: item.id };

  const received = grantGold(run, price);
  if (received > 0) run.counters.goldEarned += received;

  return {
    ok: true,
    itemId: item.id,
    goldReceived: received,
    gold: run.gold,
    slotsFreed: beforeSlots - run.equipment.filter((s) => s !== null).length,
  };
}

// ---------------------------------------------------------------------------
// The boss-win payout (§2.4, §5.4)
// ---------------------------------------------------------------------------

export interface BossWinPayout {
  gold: number;
  /** `Wanted Poster`'s contribution. */
  fromWantedPoster: number;
}

/**
 * Gold paid by a boss win, before the reward roll.
 *
 * `Wanted Poster` is `+2 gold per boss rank` (§3.6) — a **post-roll** addition,
 * not an odds change, which is why it lives here and not in the reward table. Rank
 * is 1-based (`Hangout` 1 … `Senior Associate Manager` 4) so a Hangout win pays 2
 * and the day-30 finale pays 8.
 */
export function bossWinGoldPayout(run: HorrorRun, bossRankIndex: number): BossWinPayout {
  const mods = deriveHorrorItemMods(run);
  const rank = Math.max(1, Math.floor(bossRankIndex));
  const fromWantedPoster = mods.bossWinGoldPerRank * rank;
  const granted = grantGold(run, fromWantedPoster);
  if (granted > 0) run.counters.goldEarned += granted;
  return { gold: granted, fromWantedPoster };
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function horrorCatalogue(): HorrorItem[] {
  return HORROR_ITEMS;
}

/** Current shelf, or [] when no visit is open. */
export function merchantOffers(runId: string): MerchantOffer[] {
  return visits.get(runId)?.offers ?? [];
}

/**
 * The shelf as the client sees it. A bought slot is kept (so `offerIndex` stays
 * stable) but its item id becomes the client's sold sentinel.
 */
export function merchantOffersForClient(runId: string): MerchantOffer[] {
  return merchantOffers(runId).map((offer) =>
    isOfferSold(offer) ? { ...offer, itemId: "__sold__" } : offer,
  );
}