"use client";

import { loadGoogleMaps } from "./mapsLoader";
import type { HidingSpot, LatLng } from "@/shared/types";

// Picking a random spot that actually has Street View is the brittle part of solo
// mode: a uniform point on the globe is ~71% ocean and most land has no coverage.
// So we sample from curated bounding boxes over well-covered countries, snap to the
// nearest OUTDOOR panorama within a generous radius, and retry; if every attempt
// somehow misses we fall back to a list of guaranteed-covered landmarks so the
// game can never hang on a blank screen.

interface Region {
  /** [south, west, north, east] bounding box, degrees. */
  box: [number, number, number, number];
  /** Relative sampling weight (higher = more likely). */
  weight: number;
}

// Boxes are kept inside densely-covered areas so a random point almost always
// finds a road within REGION_RADIUS_M. Weights bias toward the densest coverage.
const REGIONS: Region[] = [
  { box: [33, -120, 47, -75], weight: 5 }, // continental US
  { box: [43, -5, 54, 12], weight: 5 }, // western Europe (FR/DE/BE/NL)
  { box: [51, -6, 57, 1], weight: 2 }, // UK & Ireland
  { box: [36, -9, 43, 3], weight: 2 }, // Iberia
  { box: [37, 7, 45, 18], weight: 2 }, // Italy
  { box: [33, 130, 41, 141], weight: 3 }, // Japan
  { box: [-38, 144, -27, 153], weight: 2 }, // SE Australia
  { box: [-46, 167, -36, 178], weight: 1 }, // New Zealand
  { box: [-30, -52, -20, -43], weight: 2 }, // SE Brazil
  { box: [-34, 18, -26, 31], weight: 1 }, // South Africa
  { box: [43, -123, 50, -75], weight: 2 }, // southern Canada
];

// Snap radius for a random sample: wide on purpose — we just want *any* nearby
// coverage (unlike precise hiding, which snaps tightly to a clicked street).
const REGION_RADIUS_M = 100_000;
const MAX_ATTEMPTS = 25;

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
        if (status === google.maps.StreetViewStatus.OK && data?.location?.pano && pos) {
          resolve({ panoId: data.location.pano, lat: pos.lat(), lng: pos.lng() });
        } else {
          resolve(null);
        }
      },
    );
  });
}

/**
 * Resolve a random, Street-View-covered location for one solo round. Tries curated
 * regions first, then guaranteed landmarks. Throws only if even the landmarks fail
 * (e.g. a bad API key), which the caller surfaces as a retryable error.
 */
export async function generateSoloTarget(): Promise<HidingSpot> {
  const google = await loadGoogleMaps();

  for (let i = 0; i < MAX_ATTEMPTS; i++) {
    const point = randomPointIn(pickWeighted(REGIONS).box);
    const pano = await resolvePano(google, point, REGION_RADIUS_M);
    if (pano) return pano;
  }

  // Fallback: shuffle the landmark seeds and snap the first that resolves.
  const seeds = [...FALLBACK_SEEDS].sort(() => Math.random() - 0.5);
  for (const seed of seeds) {
    const pano = await resolvePano(google, seed, 1_000);
    if (pano) return pano;
  }

  throw new Error("Could not find a Street View location");
}
