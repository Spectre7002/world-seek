import { readFileSync } from "node:fs";
import { join } from "node:path";
import type { MapId, RegionBounds } from "../shared/types";

type Ring = number[][];
type Polygon = Ring[];
type Geometry = { type: string; coordinates: Polygon | Polygon[] };

interface Feature {
  properties?: {
    "ISO3166-1-Alpha-2"?: string;
    ISO_A2?: string;
    ISO_A2_EH?: string;
  };
  geometry?: Geometry;
}

const CONTINENT_BOUNDS: Record<string, RegionBounds> = {
  africa: { north: 37.5, south: -35, west: -18, east: 52 },
  asia: { north: 81, south: -11, west: 25, east: 180 },
  europe: { north: 72, south: 34, west: -25, east: 45 },
  northamerica: { north: 84, south: 5, west: -170, east: -50 },
  southamerica: { north: 13, south: -56, west: -82, east: -34 },
  oceania: { north:  -8, south: -50, west: 110, east: 180 },
};

const boundariesPath = join(process.cwd(), "maps", "country-boundaries.geojson");
let features: Feature[] = [];
try {
  const data = JSON.parse(readFileSync(boundariesPath, "utf8")) as { features?: Feature[] };
  features = data.features ?? [];
} catch (error) {
  console.warn("[maps] Country boundaries unavailable; country restrictions disabled.", error);
}

function polygons(feature: Feature): Polygon[] {
  const geometry = feature.geometry;
  if (!geometry) return [];
  if (geometry.type === "Polygon") return [geometry.coordinates as Polygon];
  if (geometry.type === "MultiPolygon") return geometry.coordinates as Polygon[];
  return [];
}

function boundsForPolygons(polygonsToMeasure: Polygon[]): RegionBounds | null {
  const points = polygonsToMeasure.flat(2);
  if (points.length === 0) return null;
  return {
    north: Math.max(...points.map((p) => p[1])),
    south: Math.min(...points.map((p) => p[1])),
    east: Math.max(...points.map((p) => p[0])),
    west: Math.min(...points.map((p) => p[0])),
  };
}

function insideRing(lat: number, lng: number, ring: Ring): boolean {
  let inside = false;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    const xi = ring[i][0], yi = ring[i][1];
    const xj = ring[j][0], yj = ring[j][1];
    const intersects = yi > lat !== yj > lat &&
      lng < ((xj - xi) * (lat - yi)) / (yj - yi) + xi;
    if (intersects) inside = !inside;
  }
  return inside;
}

export function getRegionBounds(mapId: MapId): RegionBounds | null {
  if (mapId === "global") return null;
  const [kind, code] = mapId.split(":");
  if (kind === "continent") return CONTINENT_BOUNDS[code] ?? null;
  const feature = features.find(
    (item) => {
      const properties = item.properties;
      const upperCode = code.toUpperCase();
      return properties?.["ISO3166-1-Alpha-2"] === upperCode ||
        properties?.ISO_A2 === upperCode ||
        properties?.ISO_A2_EH === upperCode;
    },
  );
  return feature ? boundsForPolygons(polygons(feature)) : null;
}

export function isInsideRegion(mapId: MapId, lat: number, lng: number): boolean {
  if (mapId === "global") return true;
  const [kind, code] = mapId.split(":");
  if (kind === "continent") {
    const bounds = CONTINENT_BOUNDS[code];
    return !!bounds && lat >= bounds.south && lat <= bounds.north &&
      lng >= bounds.west && lng <= bounds.east;
  }
  const feature = features.find(
    (item) => {
      const properties = item.properties;
      const upperCode = code.toUpperCase();
      return properties?.["ISO3166-1-Alpha-2"] === upperCode ||
        properties?.ISO_A2 === upperCode ||
        properties?.ISO_A2_EH === upperCode;
    },
  );
  if (!feature) return false;
  return polygons(feature).some(([outerRing, ...holes]) =>
    insideRing(lat, lng, outerRing) &&
    !holes.some((hole) => insideRing(lat, lng, hole)),
  );
}
