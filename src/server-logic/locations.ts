import { readFileSync } from "node:fs";
import { join } from "node:path";
import type { Location } from "../shared/types";

const LOCATIONS_PATH = join(process.cwd(), "maps", "global-roads-only-locations.json");

const FALLBACK_LOCATION: Location = {
  lat: 40.7587,
  lng: -73.9851,
  heading: 43,
  pitch: 0,
  panoId: "qwn9ImTEwPXJ-ikDTdl8sA",
};

function isLocation(value: unknown): value is Location {
  if (typeof value !== "object" || value === null) return false;
  const candidate = value as Record<string, unknown>;
  return (
    typeof candidate.lat === "number" &&
    Number.isFinite(candidate.lat) &&
    candidate.lat >= -90 &&
    candidate.lat <= 90 &&
    typeof candidate.lng === "number" &&
    Number.isFinite(candidate.lng) &&
    candidate.lng >= -180 &&
    candidate.lng <= 180 &&
    typeof candidate.heading === "number" &&
    Number.isFinite(candidate.heading) &&
    (candidate.pitch === undefined ||
      (typeof candidate.pitch === "number" && Number.isFinite(candidate.pitch))) &&
    typeof candidate.panoId === "string" &&
    candidate.panoId.length > 0
  );
}

function loadLocations(): Location[] {
  try {
    const raw = readFileSync(LOCATIONS_PATH, "utf8");
    const parsed: unknown = JSON.parse(raw);
    if (!Array.isArray(parsed) || parsed.length === 0) {
      console.warn("[locations] Location pool is missing or empty; using fallback location.");
      return [FALLBACK_LOCATION];
    }

    const locations = parsed
      .map(function (entry): Location | null {
        if (!isLocation(entry)) return null;
        return {
          lat: entry.lat,
          lng: entry.lng,
          heading: entry.heading,
          pitch: entry.pitch ?? 0,
          panoId: entry.panoId,
        };
      })
      .filter(function (entry): entry is Location {
        return entry !== null;
      });

    if (locations.length === 0) {
      console.warn("[locations] Location pool contains no valid entries; using fallback location.");
      return [FALLBACK_LOCATION];
    }
    return locations;
  } catch (error) {
    console.warn("[locations] Could not load location pool; using fallback location.", error);
    return [FALLBACK_LOCATION];
  }
}

const locations = loadLocations();

export function getRandomLocation(): Location {
  return locations[Math.floor(Math.random() * locations.length)] ?? FALLBACK_LOCATION;
}
