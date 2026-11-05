import type { MapId } from "../shared/types";
import { isInsideRegion } from "./boundaries";

/**
 * Whether a point lies inside the region a room is playing on.
 *
 * This used to be a second, independent implementation: it loaded its own
 * country polygons from `maps/geojson/countries.geojson` and ran a turf
 * point-in-polygon, while the transition layer used `boundaries.ts` over
 * `maps/country-boundaries.geojson`. Two geometry sources meant the same spot
 * could pass one hide check and fail another. Both now answer through the
 * single check in `boundaries.ts`, which reads one parsed feature set.
 *
 * `selectedMap` is expected to be a validated map id (callers guard with
 * `isAvailableMap`); anything unknown simply reports "outside".
 */
export function isInsideSelectedRegion(
  lat: number,
  lng: number,
  selectedMap: string,
): boolean {
  return isInsideRegion(selectedMap as MapId, lat, lng);
}
