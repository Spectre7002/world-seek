"use client";

import { Loader } from "@googlemaps/js-api-loader";

let promise: Promise<typeof google> | null = null;

/**
 * iOS Safari pops a "Motion & Orientation Access" permission prompt whenever
 * something calls DeviceOrientationEvent/DeviceMotionEvent.requestPermission().
 * The Google Street View SDK calls these on mobile to power its gyroscope
 * "motion tracking" feature — looking around a panorama by physically tilting
 * the phone. This game never uses device tilt (Street View is panned by
 * touch/drag only, and we already pass motionTracking:false), so the prompt is
 * pure noise. Neutralize the request here, before the SDK loads, by resolving
 * it to "denied" without ever surfacing the native dialog.
 */
function suppressMotionPermissionPrompt() {
  if (typeof window === "undefined") return;
  for (const Ctor of [
    (window as unknown as Record<string, { requestPermission?: unknown }>)
      .DeviceOrientationEvent,
    (window as unknown as Record<string, { requestPermission?: unknown }>)
      .DeviceMotionEvent,
  ]) {
    if (Ctor && typeof Ctor.requestPermission === "function") {
      Ctor.requestPermission = () => Promise.resolve("denied");
    }
  }
}

export function loadGoogleMaps(): Promise<typeof google> {
  if (!promise) {
    suppressMotionPermissionPrompt();
    const loader = new Loader({
      apiKey: process.env.NEXT_PUBLIC_GOOGLE_MAPS_API_KEY || "",
      version: "weekly",
      libraries: ["maps", "streetView", "geometry"],
    });
    promise = loader.load();
  }
  return promise;
}
