import { existsSync, readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import type {
  Location,
  MapCatalog,
  MapCategory,
  MapId,
  MapOption,
} from "../shared/types";
import { isInsideRegion } from "./boundaries";
export type { MapCatalog, MapId } from "../shared/types";

const MAPS_DIR = join(process.cwd(), "maps");
const FALLBACK_LOCATION: Location = {
  lat: 40.7587,
  lng: -73.9851,
  heading: 43,
  pitch: 0,
  panoId: "qwn9ImTEwPXJ-ikDTdl8sA",
};

const CONTINENT_NAMES: Record<string, string> = {
  africa: "Africa",
  asia: "Asia",
  europe: "Europe",
  northamerica: "North America",
  oceania: "Oceania",
  southamerica: "South America",
};

const COUNTRY_NAMES: Record<string, string> = {
  FR: "France",
  US: "United States",
  UA: "Ukraine",
  GB: "United Kingdom",
  DE: "Germany",
  ES: "Spain",
  IT: "Italy",
  CA: "Canada",
  AU: "Australia",
  JP: "Japan",
};

const regionNames = new Intl.DisplayNames(["en"], { type: "region" });

function titleFromCode(code: string): string {
  return code
    .split(/[-_]/)
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join(" ");
}

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

function readPool(filePath: string): Location[] {
  try {
    const parsed: unknown = JSON.parse(readFileSync(filePath, "utf8"));
    if (!Array.isArray(parsed)) return [];
    return parsed
      .filter(isLocation)
      .map((entry) => ({
        lat: entry.lat,
        lng: entry.lng,
        heading: entry.heading,
        pitch: entry.pitch ?? 0,
        panoId: entry.panoId,
      }));
  } catch (error) {
    console.warn("[maps] Could not load " + filePath + ".", error);
    return [];
  }
}

function scanCatalog(): MapCatalog {
  const continentsDir = join(MAPS_DIR, "continents");
  const countriesDir = join(MAPS_DIR, "countries");
  const continentFiles = existsSync(continentsDir) ? readdirSync(continentsDir) : [];
  const countryFiles = existsSync(countriesDir) ? readdirSync(countriesDir) : [];

  const continents = continentFiles
    .filter((file) => file.endsWith("-locations.json"))
    .map((file) => file.slice(0, -"-locations.json".length))
    .sort()
    .map((code) => ({
      id: ("continent:" + code) as MapId,
      category: "continents" as MapCategory,
      code,
      name: CONTINENT_NAMES[code] ?? titleFromCode(code),
    }));
  const countries = countryFiles
    .filter((file) => file.endsWith("-locations.json"))
    .map((file) => file.slice(0, -"-locations.json".length).toUpperCase())
    .sort()
    .map((code) => ({
      id: ("country:" + code) as MapId,
      category: "countries" as MapCategory,
      code,
      name: COUNTRY_NAMES[code] ?? regionNames.of(code) ?? code,
    }));

  return {
    global: { id: "global", category: "global", code: "global", name: "Whole world" },
    continents,
    countries,
  };
}

export const mapCatalog = scanCatalog();
const poolCache = new Map<MapId, Location[]>();

function fileForMap(mapId: MapId): string | null {
  if (mapId === "global") return join(MAPS_DIR, "global-roads-only-locations.json");
  if (mapId.startsWith("continent:")) {
    return join(MAPS_DIR, "continents", mapId.slice("continent:".length) + "-locations.json");
  }
  if (mapId.startsWith("country:")) {
    return join(MAPS_DIR, "countries", mapId.slice("country:".length).toUpperCase() + "-locations.json");
  }
  return null;
}

function fallbackPool(): Location[] {
  return [FALLBACK_LOCATION];
}

export function isAvailableMap(mapId: string): mapId is MapId {
  if (mapId === "global") return true;
  return [...mapCatalog.continents, ...mapCatalog.countries].some((map) => map.id === mapId);
}

export function getLocations(mapId: MapId): Location[] {
  const cached = poolCache.get(mapId);
  if (cached) return cached;
  const filePath = fileForMap(mapId);
  const locations = filePath ? readPool(filePath) : [];
  if (locations.length === 0) {
    console.warn("[maps] Map " + mapId + " is empty or unavailable; using fallback location.");
  }
  const pool = locations.length > 0 ? locations : fallbackPool();
  poolCache.set(mapId, pool);
  return pool;
}

export function getRandomLocation(mapId: MapId = "global"): Location {
  const pool = getLocations(mapId);
  return pool[Math.floor(Math.random() * pool.length)] ?? FALLBACK_LOCATION;
}

export function getNearestLocation(
  lat: number,
  lng: number,
  mapId: MapId = "global",
): Location | null {
  const pool = getLocations(mapId);
  let nearest: Location | null = null;
  let nearestDistance = Number.POSITIVE_INFINITY;
  for (const location of pool) {
    const distance = distanceKm(location, lat, lng);
    if (distance < nearestDistance) {
      nearest = location;
      nearestDistance = distance;
    }
  }
  return nearest;
}

function distanceKm(a: Location, lat: number, lng: number): number {
  const earthRadius = 6371;
  const dLat = ((lat - a.lat) * Math.PI) / 180;
  const dLng = ((lng - a.lng) * Math.PI) / 180;
  const lat1 = (a.lat * Math.PI) / 180;
  const lat2 = (lat * Math.PI) / 180;
  const h =
    Math.sin(dLat / 2) ** 2 +
    Math.sin(dLng / 2) ** 2 * Math.cos(lat1) * Math.cos(lat2);
  return 2 * earthRadius * Math.asin(Math.sqrt(h));
}

export type HideValidation =
  | { ok: true; location: Location }
  | { ok: false; reason: "outside_map" | "not_official_road" };

export function validateHideLocation(
  mapId: MapId,
  lat: number,
  lng: number,
  panoId: string,
  allowUnofficialCoverage = false,
): HideValidation {
  if (!isInsideRegion(mapId, lat, lng)) return { ok: false, reason: "outside_map" };
  const nearest = getNearestLocation(lat, lng, mapId);
  if (!nearest) return { ok: false, reason: "outside_map" };
  // The browser resolves the clicked road to the nearest official panorama,
  // which is often a different pano from the generated pool entry. Snap to
  // the pool location instead of requiring an exact pano id.
  return { ok: true, location: nearest };
}
