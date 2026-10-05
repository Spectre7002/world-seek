import { mkdirSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";

// Monthly spend cap for the Google Maps APIs.
//
// The API key here serves exactly one site, so the bill is entirely a function
// of how much the game is played. Google's own quota page can't cap this on its
// own: the Maps JavaScript API only exposes quotas for map loads, so Street View
// panoramas (about half the spend) are uncappable there, and a quota cutoff
// fails badly — maps just silently stop rendering mid-round. So we meter it here
// and refuse cleanly at the door instead.
//
// The unit is a *player-game*, not a game: a 2-player game costs a fifth of a
// 10-player one, so a flat game counter would be off by 5x depending on who
// shows up. Charging per connected player self-balances across group sizes.

// --- what a game costs, in billable Google events --------------------------
// Per player, per full multiplayer game, from where the client actually
// instantiates map/panorama objects (MapPicker, StreetView):
//   hiding phase          1 map  + ~6 panoramas (the click, then walking)
//   9 rounds as hunter   27 maps + 9 panoramas (guess map -> watch map ->
//                        results map, each a fresh mount, + one panorama)
//   1 round as target     2 maps               (watch map -> results map)
const MAP_LOADS_PER_PLAYER_GAME = 150;
const PANO_LOADS_PER_PLAYER_GAME = 75;

// Solo is far cheaper: no hiding phase, no watch view, and generateSoloTarget's
// StreetViewService lookups bill under Street View Metadata, which is free.
// Each round is a finding map + a results map + one panorama.
const MAP_LOADS_PER_SOLO_ROUND = 2;
const PANO_LOADS_PER_SOLO_ROUND = 1;

// --- Google's pricing (2025 SKU model) -------------------------------------
// Dynamic Maps is an Essentials SKU: 10,000 free events/month, then $7 per 1000.
// Dynamic Street View is a *Pro* SKU: only 5,000 free, and double the price.
const FREE_MAP_LOADS = 10_000;
const FREE_PANO_LOADS = 5_000;
const USD_PER_MAP_LOAD = 0.007;
const USD_PER_PANO_LOAD = 0.014;

/**
 * Paid budget on top of the free tiers, in USD. Split evenly between the two
 * SKUs, which is how the spend actually lands (a player-game costs $0.21 of
 * maps and $0.21 of panoramas). At the $20 default both ceilings work out to
 * ~380 player-games/month — 38 ten-person games, or 190 two-player games.
 */
const BUDGET_USD = 0

const MAP_CEILING = FREE_MAP_LOADS + Math.floor(BUDGET_USD / 2 / USD_PER_MAP_LOAD);
const PANO_CEILING = FREE_PANO_LOADS + Math.floor(BUDGET_USD / 2 / USD_PER_PANO_LOAD);

// Where the running total lives. Must be on a persistent volume, or the meter
// silently resets to zero on every redeploy — i.e. stops working exactly when
// you're relying on it.
const STATE_PATH = process.env.BUDGET_STATE_PATH || "/data/budget.json";

export interface LoadUnits {
  maps: number;
  panos: number;
}

interface BudgetState {
  /** "YYYY-MM" — a mismatch against the current month resets the counters. */
  period: string;
  mapLoads: number;
  panoLoads: number;
}

/** Current billing period key. Rolling over resets the counters for free. */
function currentPeriod(): string {
  return new Date().toISOString().slice(0, 7);
}

function emptyState(): BudgetState {
  return { period: currentPeriod(), mapLoads: 0, panoLoads: 0 };
}

// Set once if the state file turns out to be unusable, so the warning is logged
// a single time rather than on every charge.
let degraded = false;
// Whether we picked up an existing counter for this month at boot. False after a
// genuine first run of the month — but also after a redeploy that threw away a
// non-persistent /data, which is the failure this flag exists to expose.
let restored = false;

function degrade(action: string, err: unknown): void {
  if (degraded) return;
  degraded = true;
  console.error(
    `[budget] cannot ${action} ${STATE_PATH} — the Maps budget is now counted ` +
      `IN MEMORY ONLY and will reset on restart. Mount a writable volume and ` +
      `set BUDGET_STATE_PATH.`,
    err,
  );
}

function load(): BudgetState {
  try {
    const raw = JSON.parse(readFileSync(STATE_PATH, "utf8")) as Partial<BudgetState>;
    if (
      typeof raw?.period !== "string" ||
      typeof raw.mapLoads !== "number" ||
      typeof raw.panoLoads !== "number"
    ) {
      return emptyState();
    }
    // A stale period means we've rolled into a new month since the last write.
    if (raw.period !== currentPeriod()) return emptyState();
    restored = true;
    return { period: raw.period, mapLoads: raw.mapLoads, panoLoads: raw.panoLoads };
  } catch (err) {
    // A missing file on first boot is normal, not a degradation.
    if ((err as NodeJS.ErrnoException)?.code !== "ENOENT") degrade("read", err);
    return emptyState();
  }
}

/**
 * Persist synchronously and atomically (write a sibling temp file, then rename,
 * so a crash mid-write can never leave a truncated file). Charges happen once
 * per game start — a handful of times a day — so there's no reason to batch
 * this, and writing immediately means a SIGTERM can't lose a charge.
 */
function save(state: BudgetState): void {
  const tmp = `${STATE_PATH}.tmp`;
  try {
    mkdirSync(dirname(STATE_PATH), { recursive: true });
    writeFileSync(tmp, JSON.stringify(state), "utf8");
    renameSync(tmp, STATE_PATH);
  } catch (err) {
    // Fail soft: a disk problem must never take the game down. We keep counting
    // in memory, which still caps a single long-lived container.
    degrade("write", err);
  }
}

let state = load();

/** Reset in place if we've crossed into a new month since the last charge. */
function rollPeriod(): void {
  const period = currentPeriod();
  if (state.period !== period) state = { period, mapLoads: 0, panoLoads: 0 };
}

/** Billable events one full multiplayer game costs, for `players` players. */
export function multiplayerUnits(players: number): LoadUnits {
  return {
    maps: players * MAP_LOADS_PER_PLAYER_GAME,
    panos: players * PANO_LOADS_PER_PLAYER_GAME,
  };
}

/** Billable events one solo session costs, over `rounds` rounds. */
export function soloUnits(rounds: number): LoadUnits {
  return {
    maps: rounds * MAP_LOADS_PER_SOLO_ROUND,
    panos: rounds * PANO_LOADS_PER_SOLO_ROUND,
  };
}

/**
 * Charge a game against this month's budget. Returns false and charges nothing
 * if either SKU would go over its ceiling — callers must not start the game.
 * Both counters move together, so a refusal on one blocks the whole game.
 */
export function chargeIfAffordable(units: LoadUnits): boolean {
  rollPeriod();
  if (
    state.mapLoads + units.maps > MAP_CEILING ||
    state.panoLoads + units.panos > PANO_CEILING
  ) {
    return false;
  }
  state.mapLoads += units.maps;
  state.panoLoads += units.panos;
  save(state);
  return true;
}

export interface BudgetStatus {
  period: string;
  mapLoads: number;
  panoLoads: number;
  mapCeiling: number;
  panoCeiling: number;
  budgetUsd: number;
  /** True once there isn't room for even a single additional player-game. */
  exhausted: boolean;
  /** Whole player-games still affordable — the binding SKU wins. */
  playerGamesLeft: number;
  /** True if the counters aren't being persisted (see the degrade warning). */
  degraded: boolean;
  /** True if this month's counter was picked up from disk at boot. */
  restored: boolean;
  statePath: string;
}

export function budgetStatus(): BudgetStatus {
  rollPeriod();
  const playerGamesLeft = Math.max(
    0,
    Math.min(
      Math.floor((MAP_CEILING - state.mapLoads) / MAP_LOADS_PER_PLAYER_GAME),
      Math.floor((PANO_CEILING - state.panoLoads) / PANO_LOADS_PER_PLAYER_GAME),
    ),
  );
  return {
    period: state.period,
    mapLoads: state.mapLoads,
    panoLoads: state.panoLoads,
    mapCeiling: MAP_CEILING,
    panoCeiling: PANO_CEILING,
    budgetUsd: BUDGET_USD,
    exhausted: playerGamesLeft < 1,
    playerGamesLeft,
    degraded,
    restored,
    statePath: STATE_PATH,
  };
}

/**
 * Log where the budget stands at startup. Worth doing loudly: a counter sitting
 * on a non-persistent path resets on every redeploy, and unlike an unwritable
 * path that failure is completely silent — the file writes fine, it just isn't
 * the same file next time. Seeing "no saved counter" after every deploy is the
 * tell that the cap isn't actually capping anything.
 */
export function logBudgetAtBoot(): void {
  const s = budgetStatus();
  console.log(
    `[budget] ${s.period}: ${s.mapLoads}/${s.mapCeiling} map loads, ` +
      `${s.panoLoads}/${s.panoCeiling} panoramas — ${s.playerGamesLeft} ` +
      `player-games left on a $${s.budgetUsd} cap`,
  );
  if (!s.restored && !s.degraded) {
    console.log(
      `[budget] no saved counter at ${s.statePath} — starting this month at zero. ` +
        `Normal on the 1st or on a first deploy. If you see this after EVERY ` +
        `deploy, ${s.statePath} is not on a persistent volume and the spend cap ` +
        `is not working.`,
    );
  }
}
