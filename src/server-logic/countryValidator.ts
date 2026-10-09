import { readFileSync } from "node:fs";
import { join } from "node:path";
import booleanPointInPolygon from "@turf/boolean-point-in-polygon";
import { point } from "@turf/helpers";
import type { Feature, FeatureCollection, MultiPolygon, Polygon } from "geojson";

type CountryFeature = Feature<Polygon | MultiPolygon, {
  "ISO3166-1-Alpha-2"?: string;
  name?: string;
}>;

const CONTINENT_BOUNDS: Record<string, { north: number; south: number; east: number; west: number }> = {
  africa: { north: 37.5, south: -35, east: 52, west: -18 },
  asia: { north: 81, south: -11, east: 180, west: 25 },
  europe: { north: 72, south: 34, east: 45, west: -25 },
  northamerica: { north: 84, south: 5, east: -50, west: -170 },
  southamerica: { north: 13, south: -56, east: -34, west: -82 },
  oceania: { north: -8, south: -50, east: 180, west: 110 },
};

const COUNTRIES_PATH = join(process.cwd(), "maps", "geojson", "countries.geojson");
let countries: CountryFeature[] = [];

try {
  const parsed = JSON.parse(readFileSync(COUNTRIES_PATH, "utf8")) as FeatureCollection<
    Polygon | MultiPolygon,
    { "ISO3166-1-Alpha-2"?: string; name?: string }
  >;
  countries = (parsed.features ?? []).filter(
    (feature): feature is CountryFeature =>
      !!feature.geometry &&
      (feature.geometry.type === "Polygon" || feature.geometry.type === "MultiPolygon"),
  );
  console.log(`[maps] Loaded ${countries.length} country boundaries.`);
} catch (error) {
  console.error(`[maps] Could not load country boundaries from ${COUNTRIES_PATH}.`, error);
}

export function isInsideSelectedRegion(
  lat: number,
  lng: number,
  selectedMap: string,
): boolean {
  if (selectedMap === "global") return true;
  if (selectedMap.startsWith("continent:")) {
    const bounds = CONTINENT_BOUNDS[selectedMap.slice("continent:".length).toLowerCase()];
    return !!bounds &&
      lat >= bounds.south && lat <= bounds.north &&
      lng >= bounds.west && lng <= bounds.east;
  }
  if (!selectedMap.startsWith("country:")) return false;

  const countryCode = selectedMap.slice("country:".length).toUpperCase();
  const exceptionalNames: Record<string, string> = {
    FR: "France",
    NO: "Norway",
    XK: "Kosovo",
  };
  const country = countries.find(
    (feature) =>
      feature.properties?.["ISO3166-1-Alpha-2"]?.toUpperCase() === countryCode ||
      feature.properties?.name === exceptionalNames[countryCode],
  );
  if (!country) return false;

  return booleanPointInPolygon(point([lng, lat]), country);
}
