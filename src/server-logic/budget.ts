import { existsSync } from "node:fs";
import { join } from "node:path";
import { execFileSync } from "node:child_process";

// Informational Google Maps usage reporting.
//
// This module no longer gates anything. It used to keep a local monthly
// admission meter and refuse a game at the door, but that meter is disabled:
// Google Cloud Monitoring is the source of truth for quota visibility, and a
// silent local cutoff failed badly — maps just stopped rendering mid-round.
// What remains is a boot-time query that prints the month's actual API request
// counts so an operator sees usage without opening the Cloud console.

// --- configured accounting units -------------------------------------------
// Approximate billable events a full multiplayer game costs. Used only to turn
// the raw request counts into a friendlier "player-games left" figure.
//   hiding phase          1 map  + ~6 panoramas (the click, then walking)
//   9 rounds as hunter   27 maps + 9 panoramas
//   1 round as target     2 maps
const MAP_LOADS_PER_PLAYER_GAME = 150;
const PANO_LOADS_PER_PLAYER_GAME = 75;

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
