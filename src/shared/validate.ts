// Input validation for untrusted socket payloads.
//
// Payload *shape* validation (coordinates, pano ids, live views, hiding spots)
// now lives in `schemas.ts` as zod schemas — they strip unknown keys and are
// applied at the socket boundary. What remains here is the two helpers that are
// not expressed as schemas: a string coercer and the settings whitelist.
import {
  CASE_TIER_KEYS,
  DEFAULT_SETTINGS,
  MOVEMENT_MODES,
  type CaseTierKey,
  type MovementMode,
  type Settings,
} from "./types";

/** Coerce any value to a trimmed, length-capped string (never throws). */
export function toSafeString(v: unknown, maxLen: number): string {
  if (typeof v !== "string") return "";
  return v.slice(0, maxLen);
}

/** True only for a real, finite number in [min, max]. */
function isFiniteInRange(v: unknown, min: number, max: number): v is number {
  return typeof v === "number" && Number.isFinite(v) && v >= min && v <= max;
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
  // Seed: a short opaque string. "daily" is resolved to a dated seed by the
  // settings handler, so it is accepted here and normalised there.
  if (typeof o.seed === "string" && o.seed.length <= 40) {
    out.seed = o.seed;
  }
  if (o.gameMode === "classic" || o.gameMode === "hp") {
    out.gameMode = o.gameMode;
  }
  // Movement rule: whitelisted, because an arbitrary string would leave the
  // client with no lock to apply and silently behave as "free".
  if (typeof o.movementMode === "string" && (MOVEMENT_MODES as string[]).includes(o.movementMode)) {
    out.movementMode = o.movementMode as MovementMode;
  }
  if (typeof o.cheatsEnabled === "boolean") out.cheatsEnabled = o.cheatsEnabled;
  if (typeof o.caseEnabled === "boolean") out.caseEnabled = o.caseEnabled;
  // Whitelisted: an arbitrary string made `weights[mode]` undefined and broke
  // the case roll.
  if (o.caseOddsMode === "standard" || o.caseOddsMode === "better_odds") {
    out.caseOddsMode = o.caseOddsMode;
  }
  // Case tiers: keep only known keys, in canonical order. An empty or fully
  // invalid list falls back to every tier, because an empty pool would make the
  // case unrollable.
  if (Array.isArray(o.caseTiers)) {
    const wanted = new Set<CaseTierKey>();
    for (const raw of o.caseTiers) {
      if (typeof raw === "string" && (CASE_TIER_KEYS as string[]).includes(raw)) {
        wanted.add(raw as CaseTierKey);
      }
    }
    out.caseTiers =
      wanted.size > 0 ? CASE_TIER_KEYS.filter((k) => wanted.has(k)) : [...CASE_TIER_KEYS];
  }
  // `is1v1` is intentionally NOT accepted: it is derived in projectFor from the
  // game mode and the connected player count.

  return out;
}

export { DEFAULT_SETTINGS };
