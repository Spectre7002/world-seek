// Input validation for untrusted socket payloads.
import { DEFAULT_SETTINGS, type HidingSpot, type LatLng, type Settings } from "./types";

/** Coerce any value to a trimmed, length-capped string (never throws). */
export function toSafeString(v: unknown, maxLen: number): string {
  if (typeof v !== "string") return "";
  return v.slice(0, maxLen);
}

/** True only for a real, finite number in [min, max]. */
function isFiniteInRange(v: unknown, min: number, max: number): v is number {
  return typeof v === "number" && Number.isFinite(v) && v >= min && v <= max;
}

/** Validate a lat/lng pair is real, finite, and within Earth's bounds. */
export function isValidLatLng(v: unknown): v is LatLng {
  if (typeof v !== "object" || v === null) return false;
  const o = v as Record<string, unknown>;
  return isFiniteInRange(o.lat, -90, 90) && isFiniteInRange(o.lng, -180, 180);
}

export function isValidLiveView(
  v: unknown,
): v is { panoId: string; heading: number; pitch: number; zoom: number } {
  if (typeof v !== "object" || v === null) return false;
  const o = v as Record<string, unknown>;
  return (
    typeof o.panoId === "string" &&
    o.panoId.length > 0 &&
    o.panoId.length <= 256 &&
    isFiniteInRange(o.heading, -720, 720) &&
    isFiniteInRange(o.pitch, -90, 90) &&
    isFiniteInRange(o.zoom, 0, 5)
  );
}

export function pickLiveView(v: {
  panoId: string;
  heading: number;
  pitch: number;
  zoom: number;
}): { panoId: string; heading: number; pitch: number; zoom: number } {
  return {
    panoId: v.panoId,
    heading: v.heading,
    pitch: v.pitch,
    zoom: v.zoom,
  };
}

/** Validate a hiding spot: valid coords + a bounded, non-empty panoId string. */
export function isValidHidingSpot(v: unknown): v is HidingSpot {
  if (!isValidLatLng(v)) return false;
  const pano = (v as unknown as Record<string, unknown>).panoId;
  return typeof pano === "string" && pano.length > 0 && pano.length <= 256;
}

/** Extract a clean {lat,lng} (drops any extra attacker-supplied keys). */
export function pickLatLng(v: LatLng): LatLng {
  return { lat: v.lat, lng: v.lng };
}

/** Extract a clean hiding spot (only the fields the game uses). */
export function pickHidingSpot(v: HidingSpot): HidingSpot {
  return { lat: v.lat, lng: v.lng, panoId: v.panoId };
}

/**
 * Whitelist + clamp client-supplied settings.
 */
export function sanitizeSettings(v: unknown): Partial<Settings> {
  if (typeof v !== "object" || v === null) return {};
  const o = v as Record<string, unknown>;
  const out: Partial<Settings> = {};

  if (isFiniteInRange(o.maxPoints, 1, 1_000_000)) {
    out.maxPoints = Math.round(o.maxPoints);
  }
  if (isFiniteInRange(o.scoreScaleKm, 1, 40_000)) {
    out.scoreScaleKm = o.scoreScaleKm;
  }
  if (isFiniteInRange(o.soloRounds, 1, 20)) {
    out.soloRounds = Math.round(o.soloRounds);
  }
  // Добавлена валидация новых параметров
  if (isFiniteInRange(o.multiplayerCycles, 1, 10)) {
    out.multiplayerCycles = Math.round(o.multiplayerCycles);
  }
  if (isFiniteInRange(o.hidingTimeLimit, 0, 300)) {
    out.hidingTimeLimit = Math.round(o.hidingTimeLimit);
  }
  if (isFiniteInRange(o.findingTimeLimit, 0, 300)) {
    out.findingTimeLimit = Math.round(o.findingTimeLimit);
  }
  if (typeof o.textChat === "boolean") out.textChat = o.textChat;
  if (typeof o.voiceChat === "boolean") out.voiceChat = o.voiceChat;
  if (typeof o.allowUnofficialCoverage === "boolean") {
    out.allowUnofficialCoverage = o.allowUnofficialCoverage;
  }
  if (typeof o.selectedMap === "string" && o.selectedMap.length <= 80) {
    out.selectedMap = o.selectedMap;
  }

  return out;
}

export { DEFAULT_SETTINGS };