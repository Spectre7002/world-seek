import { existsSync, readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import type {
  Location,
  MapCatalog,
  MapCategory,
  MapId,
  MapOption,
  RegionBounds,
} from "../shared/types";
import { seededIndex } from "../shared/rng";
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

/**
 * True when a pool file exists and holds at least one usable location.
 *
 * The catalog used to list every `*-locations.json` it found, including the
 * twelve that are an empty `[]`. Those maps were offered in the lobby, and
 * `getLocations` then silently substituted the New York fallback — so picking
 * Egypt gave a Times Square panorama every round. Filtering at scan time keeps
 * a broken map out of the picker entirely.
 */
function poolHasLocations(filePath: string): boolean {
  try {
    const parsed: unknown = JSON.parse(readFileSync(filePath, "utf8"));
    return Array.isArray(parsed) && parsed.some(isLocation);
  } catch {
    return false;
  }
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
    // Drop pools that are empty or unreadable: they cannot produce a location,
    // so offering them only ever yields the fallback panorama.
    .filter((code) => poolHasLocations(join(countriesDir, code + "-locations.json")))
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

/**
 * Parsed location pools, keyed by map id.
 *
 * Bounded on purpose: the catalog has one pool per continent and per country,
 * and each pool is a full array of panoramas. Caching every visited map forever
 * meant a long-lived process kept every country a player had ever picked in
 * memory. A plain `Map` preserves insertion order, so the first key is the
 * least-recently-used one — `getLocations` re-inserts on a hit to keep that
 * true, and the oldest entry is evicted once the cap is exceeded.
 */
const POOL_CACHE_MAX = 24;
const poolCache = new Map<MapId, Location[]>();

function cachePool(mapId: MapId, pool: Location[]): void {
  poolCache.set(mapId, pool);
  while (poolCache.size > POOL_CACHE_MAX) {
    const oldest = poolCache.keys().next();
    if (oldest.done) break;
    poolCache.delete(oldest.value);
  }
}

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
  if (cached) {
    // Refresh recency: delete + re-insert moves the key to the end of the
    // iteration order, which is what the eviction above relies on.
    poolCache.delete(mapId);
    poolCache.set(mapId, cached);
    return cached;
  }
  const filePath = fileForMap(mapId);
  const locations = filePath ? readPool(filePath) : [];
  if (locations.length === 0) {
    console.warn("[maps] Map " + mapId + " is empty or unavailable; using fallback location.");
  }
  const pool = locations.length > 0 ? locations : fallbackPool();
  cachePool(mapId, pool);
  return pool;
}

/**
 * Bounding box of a map's own location pool, or null when the pool is empty.
 *
 * Used as a containment fallback for maps that have a pool but no polygon in
 * `maps/geojson/countries.geojson` (Réunion, for example). Without it those
 * maps reported "outside the region" for every point, so hiding was impossible.
 * Cached per map id because the projection asks for bounds on every broadcast.
 */
const poolBoundsCache = new Map<MapId, RegionBounds | null>();

export function getPoolBounds(mapId: MapId): RegionBounds | null {
  if (poolBoundsCache.has(mapId)) return poolBoundsCache.get(mapId) ?? null;
  // Check the file itself, not `getLocations`: that helper substitutes the New
  // York fallback for an empty pool, which would report the fallback's extent
  // as if it were this map's.
  const filePath = fileForMap(mapId);
  const pool = filePath && poolHasLocations(filePath) ? getLocations(mapId) : [];
  let bounds: RegionBounds | null = null;
  if (pool.length > 0) {
    let north = -90;
    let south = 90;
    let east = -180;
    let west = 180;
    for (const location of pool) {
      if (location.lat > north) north = location.lat;
      if (location.lat < south) south = location.lat;
      if (location.lng > east) east = location.lng;
      if (location.lng < west) west = location.lng;
    }
    bounds = { north, south, east, west };
  }
  poolBoundsCache.set(mapId, bounds);
  return bounds;
}

export function getRandomLocation(mapId: MapId = "global"): Location {
  const pool = getLocations(mapId);
  return pool[Math.floor(Math.random() * pool.length)] ?? FALLBACK_LOCATION;
}

/**
 * Deterministic counterpart of `getRandomLocation`.
 *
 * The same (seed, cursor) pair always returns the same location, so a seeded
 * game replays identically on every client and survives a server restart. The
 * cursor is stored on the room and advanced once per picked location, which
 * keeps the sequence stable even if a round is re-scored.
 */
export function getSeededLocation(
  mapId: MapId,
  seed: string,
  cursor: number,
): Location {
  const pool = getLocations(mapId);
  if (pool.length === 0) return FALLBACK_LOCATION;
  return pool[seededIndex(seed, cursor, pool.length)] ?? FALLBACK_LOCATION;
}

/**
 * Pick a location for a room: seeded when the room has a seed, random
 * otherwise. Every server-picked path (solo, HP, hide:auto, timer expiry) goes
 * through here so a seeded game cannot accidentally mix in a random location.
 */
export function pickLocation(
  mapId: MapId,
  seed: string | undefined,
  cursor: number,
): Location {
  if (seed && seed.length > 0) return getSeededLocation(mapId, seed, cursor);
  return getRandomLocation(mapId);
}

/**
 * Lat/lng grid over the global pool, so `/api/road-snap` does not scan the
 * entire pool linearly on every call. Each cell is `SPATIAL_CELL_DEG` degrees
 * on a side; a query expands a box outward until the nearest hit is provably
 * the global nearest, then stops.
 */
const SPATIAL_CELL_DEG = 2;
const KM_PER_DEG_LAT = 111;
/** Pools smaller than this are cheap enough to scan linearly. */
const SPATIAL_INDEX_MIN_POOL = 1024;

interface SpatialIndex {
  pool: Location[];
  cells: Map<string, Location[]>;
}

// Keyed to the pool reference: an evicted-and-reloaded pool builds a fresh
// index, and a cache hit reuses the one already built.
let globalIndex: SpatialIndex | null = null;

function cellKey(lat: number, lng: number): string {
  return Math.floor(lat / SPATIAL_CELL_DEG) + ":" + Math.floor(lng / SPATIAL_CELL_DEG);
}

function buildSpatialIndex(pool: Location[]): SpatialIndex {
  if (globalIndex && globalIndex.pool === pool) return globalIndex;
  const cells = new Map<string, Location[]>();
  for (const location of pool) {
    const key = cellKey(location.lat, location.lng);
    let bucket = cells.get(key);
    if (!bucket) {
      bucket = [];
      cells.set(key, bucket);
    }
    bucket.push(location);
  }
  globalIndex = { pool, cells };
  return globalIndex;
}

function nearestFromIndex(index: SpatialIndex, lat: number, lng: number): Location | null {
  const cosLat = Math.max(0.01, Math.cos((lat * Math.PI) / 180));
  let radiusKm = 25;
  // A sparse pool may need several expansions before a cell has anything in it.
  for (let attempt = 0; attempt < 12; attempt++) {
    const dLat = radiusKm / KM_PER_DEG_LAT;
    const dLng = Math.min(180, radiusKm / (KM_PER_DEG_LAT * cosLat));
    const minRow = Math.floor((lat - dLat) / SPATIAL_CELL_DEG);
    const maxRow = Math.floor((lat + dLat) / SPATIAL_CELL_DEG);
    const minCol = Math.floor((lng - dLng) / SPATIAL_CELL_DEG);
    const maxCol = Math.floor((lng + dLng) / SPATIAL_CELL_DEG);
    let best: Location | null = null;
    let bestDistance = Number.POSITIVE_INFINITY;
    for (let row = minRow; row <= maxRow; row++) {
      for (let col = minCol; col <= maxCol; col++) {
        const bucket = index.cells.get(row + ":" + col);
        if (!bucket) continue;
        for (const location of bucket) {
          const distance = distanceKm(location, lat, lng);
          if (distance < bestDistance) {
            best = location;
            bestDistance = distance;
          }
        }
      }
    }
    // The box spans ±radiusKm, so any point outside it is at least radiusKm
    // away — a candidate closer than that is therefore the global nearest.
    if (best && bestDistance <= radiusKm) return best;
    radiusKm *= 2;
  }
  return null;
}

export function getNearestLocation(
  lat: number,
  lng: number,
  mapId: MapId = "global",
): Location | null {
  const pool = getLocations(mapId);
  if (mapId === "global" && pool.length >= SPATIAL_INDEX_MIN_POOL) {
    const nearest = nearestFromIndex(buildSpatialIndex(pool), lat, lng);
    if (nearest) return nearest;
  }
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
