import { readFileSync } from "node:fs";
import { join } from "node:path";

/**
 * Single source of truth for country polygon geometry.
 *
 * Two server modules used to load their own copy from different files:
 * `boundaries.ts` read `maps/country-boundaries.geojson` (173 features) while
 * `countryValidator.ts` read `maps/geojson/countries.geojson` (237). The same
 * country could therefore answer "inside" in one check and "outside" in the
 * other. Both now read the superset here, parsed once.
 *
 * The GeoJSON shape is declared locally rather than pulled from `geojson`
 * (`@types/geojson` was only present transitively via `@turf/*`, which is no
 * longer a dependency), so this module stays dependency-free.
 */
type Ring = number[][];
type PolygonCoords = Ring[];
type MultiPolygonCoords = Ring[][];
type Geometry =
  | { type: "Polygon"; coordinates: PolygonCoords }
  | { type: "MultiPolygon"; coordinates: MultiPolygonCoords }
  | { type: string; coordinates: unknown };

export interface CountryProperties {
  "ISO3166-1-Alpha-2"?: string;
  ISO_A2?: string;
  ISO_A2_EH?: string;
  name?: string;
}

export interface CountryFeature {
  type: "Feature";
  properties?: CountryProperties;
  geometry?: Geometry;
}

const COUNTRIES_PATH = join(process.cwd(), "maps", "geojson", "countries.geojson");

let features: CountryFeature[] = [];
const byIso2 = new Map<string, CountryFeature>();

/**
 * ISO codes whose boundary feature is labelled differently from the code itself
 * in the source file. Kept tiny and explicit rather than a fuzzy name match.
 */
const NAME_FALLBACK: Record<string, string> = {
  FR: "France",
  NO: "Norway",
  XK: "Kosovo",
};

try {
  const parsed = JSON.parse(readFileSync(COUNTRIES_PATH, "utf8")) as {
    features?: CountryFeature[];
  };
  features = (parsed.features ?? []).filter(
    (feature): feature is CountryFeature =>
      !!feature.geometry &&
      (feature.geometry.type === "Polygon" || feature.geometry.type === "MultiPolygon"),
  );
  for (const feature of features) {
    const properties = feature.properties;
    const code =
      properties?.["ISO3166-1-Alpha-2"] ?? properties?.ISO_A2 ?? properties?.ISO_A2_EH;
    if (typeof code === "string" && code.length > 0) {
      byIso2.set(code.toUpperCase(), feature);
    }
  }
  console.log(`[maps] Loaded ${features.length} country boundaries.`);
} catch (error) {
  console.error(`[maps] Could not load country boundaries from ${COUNTRIES_PATH}.`, error);
}

/** Every loaded country feature, in file order. */
export function countryFeatures(): CountryFeature[] {
  return features;
}

/**
 * Look up a country boundary by ISO 3166-1 alpha-2 code, falling back to the
 * display name for the few features the source labels differently.
 */
export function findCountryFeature(code: string): CountryFeature | undefined {
  const upper = code.toUpperCase();
  const exact = byIso2.get(upper);
  if (exact) return exact;
  const name = NAME_FALLBACK[upper];
  if (!name) return undefined;
  return features.find((feature) => feature.properties?.name === name);
}
