/**
 * The map spells. Shared by the lootbox engine, the UI and the map.
 *
 * Two families:
 *   - map spells (scry, arrow, echo, omen, compass, heatmap) are cast by
 *     clicking the guess map; the server only spends the charge, the effect is
 *     drawn client-side from `spellTarget`.
 *   - server spells (freeze, reroll) change room state, so the server applies
 *     them and the client just renders the result.
 */
export const SPELLS = {
  scry: {
    name: { ru: "SCRY", en: "SCRY" },
    label: "SCRY",
    kind: "map",
    description: {
      ru: "Круг: цель внутри или снаружи",
      en: "Circle: is the target inside or outside?",
    },
  },
  arrow: {
    name: { ru: "ARROW", en: "ARROW" },
    label: "ARROW",
    kind: "map",
    description: { ru: "Стрелка на цель", en: "Arrow pointing at the target" },
  },
  echo: {
    name: { ru: "ECHO", en: "ECHO" },
    label: "ECHO",
    kind: "map",
    description: { ru: "Точное расстояние", en: "Exact distance" },
  },
  omen: {
    name: { ru: "OMEN", en: "OMEN" },
    label: "OMEN",
    kind: "map",
    description: { ru: "Очки с точностью до 1000", en: "Score within 1000 points" },
  },
  compass: {
    name: { ru: "COMPASS", en: "COMPASS" },
    label: "COMPASS",
    kind: "map",
    description: { ru: "Только азимут, без стрелки", en: "Bearing only, no arrow" },
  },
  heatmap: {
    name: { ru: "HEATMAP", en: "HEATMAP" },
    label: "HEATMAP",
    kind: "map",
    description: {
      ru: "Сетка 3×3: где теплее",
      en: "3×3 grid: which cell is warmer",
    },
  },
  freeze: {
    name: { ru: "FREEZE", en: "FREEZE" },
    label: "FREEZE",
    kind: "server",
    description: {
      ru: "Блокирует догадку лидера на 20 с",
      en: "Blocks the leader's guess for 20s",
    },
  },
  reroll: {
    name: { ru: "REROLL", en: "REROLL" },
    label: "REROLL",
    kind: "server",
    description: { ru: "Перебросить кейс", en: "Re-roll the current case" },
  },
} as const;

export type SpellId = keyof typeof SPELLS;
export type SpellCounts = Record<SpellId, number>;
export type SpellKind = (typeof SPELLS)[SpellId]["kind"];

export const SPELL_IDS: SpellId[] = [
  "scry",
  "arrow",
  "echo",
  "omen",
  "compass",
  "heatmap",
  "freeze",
  "reroll",
];

/** Spells cast by clicking the guess map (the server only spends the charge). */
export const MAP_SPELL_IDS: SpellId[] = SPELL_IDS.filter(
  (id) => SPELLS[id].kind === "map",
);

/** Spells the server applies to room state. */
export const SERVER_SPELL_IDS: SpellId[] = SPELL_IDS.filter(
  (id) => SPELLS[id].kind === "server",
);

export function isSpellId(v: unknown): v is SpellId {
  return typeof v === "string" && (SPELL_IDS as string[]).includes(v);
}

export function emptySpellCounts(): SpellCounts {
  return {
    scry: 0,
    arrow: 0,
    echo: 0,
    omen: 0,
    compass: 0,
    heatmap: 0,
    freeze: 0,
    reroll: 0,
  };
}

export function totalSpells(counts: SpellCounts): number {
  return SPELL_IDS.reduce((sum, id) => sum + counts[id], 0);
}

export function addOneSpellEach(counts: SpellCounts): SpellCounts {
  const next = { ...counts };
  for (const id of SPELL_IDS) next[id] += 1;
  return next;
}

/** OMEN answers with a 1000-point bucket instead of the exact score. */
export function spellScoreRange(points: number): string {
  const start = Math.min(4000, Math.max(0, Math.floor(points / 1000) * 1000));
  return `${start}-${start + 1000}`;
}

/** FREEZE duration in ms. */
export const FREEZE_DURATION_MS = 20_000;
