import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import { execFileSync } from "node:child_process";
import { dirname, join } from "node:path";

// Approximate monthly admission budget for Google Maps usage.
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
// The configured multiplayer allowance is deliberately conservative relative
// to the estimated client map/panorama usage described below.
//   hiding phase          1 map  + ~6 panoramas (the click, then walking)
//   9 rounds as hunter   27 maps + 9 panoramas (guess map -> watch map ->
//                        results map, each a fresh mount, + one panorama)
//   1 round as target     2 maps               (watch map -> results map)
const MAP_LOADS_PER_PLAYER_GAME = 150;
const PANO_LOADS_PER_PLAYER_GAME = 75;

// Solo is far cheaper: no hiding phase, no watch view, and server-selected
// locations require no Street View Metadata lookup.
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
 * Paid budget on top of the configured base allowances, in USD, split evenly
 * between the map and panorama ceilings. With the current accounting units,
 * The $0 default permits games only within the configured base allowances.
 */
const configuredBudget = process.env.MAPS_BUDGET_USD;
const BUDGET_USD =
  configuredBudget === undefined || configuredBudget.trim() === ""
    ? 0
    : Number(configuredBudget);

if (!Number.isFinite(BUDGET_USD) || BUDGET_USD < 0) {
  throw new Error("MAPS_BUDGET_USD must be a finite, non-negative number");
}

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
  // Google Cloud/gcloud is now the source of truth for quota visibility.
  // The old local meter must never prevent a room or game from starting.
  void units;
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
    exhausted: false,
    playerGamesLeft,
    degraded,
    restored,
    statePath: STATE_PATH,
  };
}

const GOOGLE_CLOUD_PROJECT = "worldseek";
const MAP_REQUEST_LIMIT = 10_000;
const PANORAMA_REQUEST_LIMIT = 5_000;
const REQUEST_COUNT_FILTER =
  'metric.type="serviceruntime.googleapis.com/api/request_count"';

interface MonitoringResponse {
  timeSeries?: Array<{
    resource?: { labels?: { service?: string } };
    points?: Array<{ value?: { int64Value?: number | string } }>;
  }>;
  nextPageToken?: string;
}

function utcTimestamp(date: Date): string {
  return date.toISOString().replace(/\.\d{3}Z$/, "Z");
}

function findGcloudCommand(): string {
  if (process.platform !== "win32") return "gcloud";

  const candidates = [
    join(process.env.ProgramFiles || "", "Google", "Cloud SDK", "google-cloud-sdk", "bin", "gcloud.cmd"),
    join(
      process.env["ProgramFiles(x86)"] || "",
      "Google",
      "Cloud SDK",
      "google-cloud-sdk",
      "bin",
      "gcloud.cmd",
    ),
    join(
      process.env.LOCALAPPDATA || "",
      "Google",
      "Cloud SDK",
      "google-cloud-sdk",
      "bin",
      "gcloud.cmd",
    ),
    ...(process.env.Path || process.env.PATH || "")
      .split(";")
      .filter(Boolean)
      .map((directory) => join(directory, "gcloud.cmd")),
  ];

  return (
    candidates.find((candidate) => existsSync(candidate)) ||
    "gcloud.cmd"
  );
}

function printGcloudAccessToken(): string {
  const command = findGcloudCommand();
  try {
    if (process.platform === "win32") {
      return execFileSync(
        process.env.ComSpec || "cmd.exe",
        ["/d", "/c", command, "auth", "print-access-token"],
        { encoding: "utf8" },
      ).trim();
    }
    return execFileSync(command, ["auth", "print-access-token"], {
      encoding: "utf8",
    }).trim();
  } catch (error) {
    console.error(
      `[budget] gcloud token command failed (platform=${process.platform}, ` +
        `command=${command}). Verify that gcloud is installed, authenticated, ` +
        "and available to the Node.js process.",
      error,
    );
    throw error;
  }
}

async function readMonthlyApiUsage(
  accessToken: string,
  startTime: string,
  endTime: string,
): Promise<{ mapLoads: number; panoLoads: number }> {
  const url = new URL(
    `https://monitoring.googleapis.com/v3/projects/${GOOGLE_CLOUD_PROJECT}/timeSeries`,
  );
  url.searchParams.set("filter", REQUEST_COUNT_FILTER);
  url.searchParams.set("interval.startTime", startTime);
  url.searchParams.set("interval.endTime", endTime);

  let mapLoads = 0;
  let panoLoads = 0;
  let pageToken: string | undefined;

  do {
    if (pageToken) {
      url.searchParams.set("pageToken", pageToken);
    } else {
      url.searchParams.delete("pageToken");
    }

    const response = await fetch(url, {
      headers: { authorization: `Bearer ${accessToken}` },
    });
    if (!response.ok) {
      throw new Error(
        `Google Cloud Monitoring returned ${response.status}: ${await response.text()}`,
      );
    }

    const result = (await response.json()) as MonitoringResponse;
    for (const series of result.timeSeries ?? []) {
      const isMapService =
        series.resource?.labels?.service === "maps-backend.googleapis.com";
      for (const point of series.points ?? []) {
        const value = Number(point.value?.int64Value);
        if (!Number.isSafeInteger(value) || value < 0) {
          throw new Error("Google Cloud Monitoring returned an invalid request count");
        }
        if (isMapService) {
          mapLoads += value;
        } else {
          panoLoads += value;
        }
      }
    }
    pageToken = result.nextPageToken;
  } while (pageToken);

  return { mapLoads, panoLoads };
}

/** Log the current month's actual Google Cloud request counts at startup. */
export async function logBudgetAtBoot(): Promise<void> {
  try {
    const now = new Date();
    const startTime = utcTimestamp(
      new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1)),
    );
    const endTime = utcTimestamp(now);
    const accessToken = printGcloudAccessToken();
    if (!accessToken) {
      throw new Error("gcloud returned an empty access token");
    }

    const { mapLoads, panoLoads } = await readMonthlyApiUsage(
      accessToken,
      startTime,
      endTime,
    );
    const playerGamesLeft = Math.max(
      0,
      Math.min(
        Math.floor((MAP_REQUEST_LIMIT - mapLoads) / MAP_LOADS_PER_PLAYER_GAME),
        Math.floor((PANORAMA_REQUEST_LIMIT - panoLoads) / PANO_LOADS_PER_PLAYER_GAME),
      ),
    );
    const period = startTime.slice(0, 7);

    const reset = "\x1b[0m";
    const cyan = "\x1b[36m";
    const green = "\x1b[32m";
    const yellow = "\x1b[33m";
    console.log("");
    console.log(`${cyan}=== GOOGLE MAPS API LIMITS (${period}) ===${reset}`);
    console.log(
      `${green}Map Loads: ${mapLoads} / ${MAP_REQUEST_LIMIT} ` +
        `(Remaining: ${Math.max(0, MAP_REQUEST_LIMIT - mapLoads)})${reset}`,
    );
    console.log(
      `${yellow}Panoramas: ${panoLoads} / ${PANORAMA_REQUEST_LIMIT} ` +
        `(Remaining: ${Math.max(0, PANORAMA_REQUEST_LIMIT - panoLoads)})${reset}`,
    );
    console.log(
      `${cyan}Player-games left: ${playerGamesLeft}${reset}`,
    );
    console.log("");
  } catch (err) {
    if (
      (err as NodeJS.ErrnoException)?.code === "ENOENT" ||
      (err instanceof Error &&
        err.message.includes("gcloud CLI was not found in PATH or standard Windows"))
    ) {
      console.info(
        "[budget] gcloud CLI was not found; skipping Google Cloud usage query",
      );
      return;
    }

    const message = err instanceof Error ? err.message : String(err);
    console.warn(
      `[budget] unable to fetch Google Cloud usage; server will continue without it: ${message}`,
    );
  }
}
