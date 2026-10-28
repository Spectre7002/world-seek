// HorrorGuessr — boss presentation metadata (P8, §5.2, §5.3, §6.2).
//
// The server owns *which* boss a day draws and *what* mechanic it brings
// (`HorrorBossMechanic`, §5.2); this module owns how each mechanic is
// *presented* — its label, glyph, accent colour and the minigame component the
// duel shell mounts. Keeping the two apart means the client never re-derives a
// rule: it reads the mechanic the server already computed and looks up its face
// here.
//
// The glyphs are emoji, not art assets, so nothing GeoGuessr ships is copied
// (§6.2, acceptance 14).

import type { HorrorBossMechanic } from "@/shared/horrorTypes";

export interface HorrorBossMeta {
  id: HorrorBossMechanic;
  /** i18n key for the mechanic's name. */
  label: string;
  /** i18n key for the one-line description. */
  description: string;
  /** A single glyph, so the badge needs no art asset. */
  icon: string;
  /** Accent colour for the boss frame. */
  color: string;
  /**
   * The minigame the duel shell mounts for this mechanic, or null for a plain
   * score duel. One of: "laser" | "wipe" | "scream" | "hex" | null.
   */
  minigame: "laser" | "wipe" | "scream" | "hex" | null;
}

export const HORROR_BOSS_META: Record<HorrorBossMechanic, HorrorBossMeta> = {
  lifesteal: {
    id: "lifesteal",
    label: "Vampirism",
    description: "When the boss out-scores you, it damages you and heals itself by the same amount.",
    icon: "🧛",
    color: "#d31730",
    minigame: null,
  },
  hexes: {
    id: "hexes",
    label: "Hexes",
    description: "Random curses: a mirrored panorama, a tiny map with spells locked, or an upside-down screen.",
    icon: "🧙",
    color: "#8b5cf6",
    minigame: "hex",
  },
  laserLock: {
    id: "laserLock",
    label: "Orbital Laser",
    description: "No map. Stop two running laser lines on the right country to return fire.",
    icon: "👽",
    color: "#38e07a",
    minigame: "laser",
  },
  screamPenalty: {
    id: "screamPenalty",
    label: "Scream Penalty",
    description: "During each scream, any input costs instant damage. Wait it out with your hands down.",
    icon: "👻",
    color: "#2f7dff",
    minigame: "scream",
  },
  timeDrain: {
    id: "timeDrain",
    label: "Time Drain",
    description: "Every second of hesitation cuts your max health or damage.",
    icon: "🧆",
    color: "#ffc23d",
    minigame: null,
  },
  rngChaos: {
    id: "rngChaos",
    label: "RNG Chaos",
    description: "Cream pies cover the screen and the map. Wipe them with the mouse.",
    icon: "🤡",
    color: "#ff2d55",
    minigame: "wipe",
  },
  chosenRewards: {
    id: "chosenRewards",
    label: "Final Confrontation",
    description: "The finale rolls nothing. Win, then choose one of three rewards.",
    icon: "🎭",
    color: "#ffc23d",
    minigame: null,
  },
  shortAttack: {
    id: "shortAttack",
    label: "Short Attack",
    description: "Errors deal near-one-shot damage. Do not miss the continent.",
    icon: "👁️",
    color: "#d31730",
    minigame: null,
  },
  shadowVampirism: {
    id: "shadowVampirism",
    label: "Shadow Vampirism",
    description: "Vampirism inside the Shadow Realm, where colour clues are erased.",
    icon: "🌑",
    color: "#1b2f6b",
    minigame: null,
  },
  stackedHexes: {
    id: "stackedHexes",
    label: "Stacked Hexes",
    description: "An inverted screen and a tiny map at once, with healing and freeze spells blocked.",
    icon: "🌫️",
    color: "#8b5cf6",
    minigame: "hex",
  },
  laserOverdrive: {
    id: "laserOverdrive",
    label: "Laser Overdrive",
    description: "The laser scans twice as fast and finds a perfect 5K much sooner.",
    icon: "🚨",
    color: "#38e07a",
    minigame: "laser",
  },
  echoScream: {
    id: "echoScream",
    label: "Echo Scream",
    description: "Longer screams, shorter safe windows, and huge blurry countries.",
    icon: "📣",
    color: "#2f7dff",
    minigame: "scream",
  },
  decayedTime: {
    id: "decayedTime",
    label: "Decayed Time",
    description: "Thinking time is near zero; health drains before you click.",
    icon: "⏳",
    color: "#ffc23d",
    minigame: null,
  },
  archClown: {
    id: "archClown",
    label: "Arch-Clown",
    description: "Clown chaos plus Lights Out: the panorama is pitch black and your mouse is a torch.",
    icon: "🎭",
    color: "#ff2d55",
    minigame: "wipe",
  },
};

/** Resolve a raw mechanic string (from the projection) to its presentation. */
export function horrorBossMeta(mechanic: string): HorrorBossMeta {
  return HORROR_BOSS_META[mechanic as HorrorBossMechanic] ?? HORROR_BOSS_META.rngChaos;
}
