// HorrorGuessr — day-modifier presentation metadata (P7, §4.4, §4.5, §6.2).
//
// The engine owns *which* modifier a day carries (`HorrorDayModifier`, §1.2);
// this module owns how each one is *presented* — its badge label, icon, colour
// and the single item that deletes it. Keeping the two apart means the visual
// layer never re-derives a rule: it reads the modifier the server already
// computed and looks up its face here.
//
// The bypass pairs are verbatim from the reference (§4.4):
//   - `Torch`        → `bypassModifier("lightsOut")`  — "no flashlight days"
//   - `Beer Goggles` → `bypassModifier("darkPano")`   — "no dark-panorama filter"
// Shadow Realm has **no** item counter and no Codex page (§4.5), so its
// `bypassItemId` is null and it is flagged as the first thing to re-verify.

import type { HorrorDayModifier } from "@/shared/horrorTypes";

export interface HorrorModifierMeta {
  id: HorrorDayModifier;
  /** i18n key for the badge label. */
  label: string;
  /** i18n key for the tooltip description. */
  description: string;
  /** A single glyph, so the badge needs no art asset (§6.2: no GeoGuessr art). */
  icon: string;
  /** Accent colour for the badge frame. */
  color: string;
  /** The item that deletes this modifier, or null when nothing counters it. */
  bypassItemId: string | null;
}

export const HORROR_MODIFIER_META: Record<HorrorDayModifier, HorrorModifierMeta> = {
  none: {
    id: "none",
    label: "Clear",
    description: "No day modifier is active.",
    icon: "☀️",
    color: "#a897b3",
    bypassItemId: null,
  },
  lightsOut: {
    id: "lightsOut",
    label: "Lights Out",
    description: "The panorama goes dark. Reveal it with your cursor.",
    icon: "🔦",
    color: "#000000",
    bypassItemId: "torch",
  },
  shadowRealm: {
    id: "shadowRealm",
    label: "Shadow Realm",
    description: "Colour is gone. Colour clues will not help you.",
    icon: "🌑",
    color: "#1b2f6b",
    bypassItemId: null,
  },
  darkPano: {
    id: "darkPano",
    label: "Dark Panorama",
    description: "The panorama is permanently dimmed.",
    icon: "🌫️",
    color: "#2a2a2a",
    bypassItemId: "beerGoggles",
  },
};

/** Resolve a raw modifier string (from the projection) to its presentation. */
export function horrorModifierMeta(modifier: string): HorrorModifierMeta {
  return HORROR_MODIFIER_META[modifier as HorrorDayModifier] ?? HORROR_MODIFIER_META.none;
}
