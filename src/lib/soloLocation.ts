"use client";

import { loadGoogleMaps } from "./mapsLoader";
import type { HidingSpot, LatLng } from "@/shared/types";

// Sample small areas around dense road grids, then only accept linked OUTDOOR
// panoramas so solo rounds always start on a navigable road.

interface Region {
  /** [south, west, north, east] bounding box, degrees. */
  box: [number, number, number, number];
  /** Relative sampling weight (higher = more likely). */
  weight: number;
}

// Sample urban road grids. Each accepted target is a real OUTDOOR panorama
// with at least one connected Street View link, not an arbitrary map coordinate.
const REGIONS: Region[] = [
  { box: [40.68, -74.03, 40.82, -73.91], weight: 5 }, // New York
  { box: [48.81, 2.25, 48.89, 2.42], weight: 5 }, // Paris
  { box: [51.48, -0.19, 51.55, -0.06], weight: 3 }, // London
  { box: [52.49, 13.35, 52.54, 13.44], weight: 3 }, // Berlin
  { box: [35.63, 139.67, 35.70, 139.75], weight: 4 }, // Tokyo
  { box: [-33.89, 151.18, -33.84, 151.24], weight: 3 }, // Sydney
  { box: [37.75, -122.45, 37.80, -122.39], weight: 3 }, // San Francisco
  { box: [41.87, 12.47, 41.92, 12.53], weight: 2 }, // Rome
  { box: [43.62, -79.41, 43.67, -79.36], weight: 2 }, // Toronto
  { box: [-23.0, -43.25, -22.93, -43.18], weight: 2 }, // Rio de Janeiro
  { box: [19.38, -99.17, 19.46, -99.11], weight: 3 }, // Mexico City
  { box: [41.36, 2.13, 41.41, 2.19], weight: 2 }, // Barcelona
  { box: [37.54, 126.96, 37.59, 127.03], weight: 3 }, // Seoul
  { box: [13.72, 100.49, 13.77, 100.55], weight: 2 }, // Bangkok
  { box: [-37.84, 144.95, -37.79, 145.0], weight: 2 }, // Melbourne
  { box: [-33.95, 18.39, -33.90, 18.44], weight: 1 }, // Cape Town
];

const REGION_RADIUS_M = 4_000;
const MAX_ATTEMPTS = 24;
const recentPanoIds = new Set<string>();

// Guaranteed-covered landmarks. Last-resort only, so generation never fails.
const FALLBACK_SEEDS: LatLng[] = [
  { lat: 40.758, lng: -73.9855 }, // Times Square
  { lat: 48.8584, lng: 2.2945 }, // Eiffel Tower
  { lat: 51.5007, lng: -0.1246 }, // Westminster
  { lat: 35.6595, lng: 139.7005 }, // Shibuya
  { lat: -33.8568, lng: 151.2153 }, // Sydney Opera House
  { lat: 43.6426, lng: -79.3871 }, // Toronto (CN Tower)
  { lat: 52.5163, lng: 13.3777 }, // Brandenburg Gate
  { lat: 41.8902, lng: 12.4922 }, // Colosseum
  { lat: -22.9519, lng: -43.2105 }, // Rio (Christ the Redeemer)
  { lat: -33.9249, lng: 18.4241 }, // Cape Town
];

function pickWeighted(regions: Region[]): Region {
  const total = regions.reduce((sum, r) => sum + r.weight, 0);
  let roll = Math.random() * total;
  for (const r of regions) {
    roll -= r.weight;
    if (roll <= 0) return r;
  }
  return regions[regions.length - 1];
}

function randomPointIn([s, w, n, e]: Region["box"]): LatLng {
  return {
    lat: s + Math.random() * (n - s),
    lng: w + Math.random() * (e - w),
  };
}

function resolvePano(
  google: typeof globalThis.google,
  location: LatLng,
  radius: number,
): Promise<HidingSpot | null> {
  const sv = new google.maps.StreetViewService();
  return new Promise((resolve) => {
    sv.getPanorama(
      {
        location,
        radius,
        preference: google.maps.StreetViewPreference.NEAREST,
        // OUTDOOR only — official imagery, never user photospheres (which are
        // often indoor/broken and render black).
        source: google.maps.StreetViewSource.OUTDOOR,
      },
      (data, status) => {
        const pos = data?.location?.latLng;
        const hasRoadLinks = (data?.links || []).some(function (link) {
          return Boolean(link.pano && link.heading != null);
        });
        if (
          status === google.maps.StreetViewStatus.OK &&
          data?.location?.pano &&
          pos &&
          hasRoadLinks
        ) {
          resolve({ panoId: data.location.pano, lat: pos.lat(), lng: pos.lng() });
        } else {
          resolve(null);
        }
      },
    );
  });
}

/**
 * Resolve a unique connected-road panorama for one solo round. Samples city
 * street grids first, then uses compact landmark areas as a last resort.
 */
export async function generateSoloTarget(): Promise<HidingSpot> {
  const google = await loadGoogleMaps();
  if (recentPanoIds.size >= 200) recentPanoIds.clear();

  for (let i = 0; i < MAX_ATTEMPTS; i++) {
    const point = randomPointIn(pickWeighted(REGIONS).box);
    const pano = await resolvePano(google, point, REGION_RADIUS_M);
    if (pano && !recentPanoIds.has(pano.panoId)) {
      recentPanoIds.add(pano.panoId);
      return pano;
    }
  }

  // Fallback: shuffle the landmark seeds and snap the first that resolves.
  const seeds = [...FALLBACK_SEEDS].sort(() => Math.random() - 0.5);
  for (const seed of seeds) {
    const jitteredSeed = {
      lat: seed.lat + (Math.random() - 0.5) * 0.025,
      lng: seed.lng + (Math.random() - 0.5) * 0.025,
    };
    const pano = await resolvePano(google, jitteredSeed, 2_000);
    if (pano && !recentPanoIds.has(pano.panoId)) {
      recentPanoIds.add(pano.panoId);
      return pano;
    }
  }

  throw new Error("Could not find a Street View location");
}
