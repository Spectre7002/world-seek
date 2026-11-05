import type {
  CaseHintData,
  CaseMode,
  CaseTierKey,
} from "../src/shared/types";
import { CASE_PITY_MAX, CASE_TIER_KEYS } from "../src/shared/types";
import { SPELLS } from "../src/shared/spells";

export const RARITY_TIERS = {
  MIL_SPEC: { key: "MIL_SPEC", name: { ru: "Синее (Mil-Spec)", en: "Mil-Spec (Blue)" }, color: "#4b69ff", weights: { standard: 79.92, better_odds: 25.0 } },
  RESTRICTED: { key: "RESTRICTED", name: { ru: "Фиолетовое (Restricted)", en: "Restricted (Purple)" }, color: "#8847ff", weights: { standard: 15.98, better_odds: 40.0 } },
  CLASSIFIED: { key: "CLASSIFIED", name: { ru: "Розовое (Classified)", en: "Classified (Pink)" }, color: "#d32ce6", weights: { standard: 3.20, better_odds: 20.0 } },
  COVERT: { key: "COVERT", name: { ru: "Красное (Covert)", en: "Covert (Red)" }, color: "#eb4b4b", weights: { standard: 0.64, better_odds: 10.0 } },
  SPECIAL: { key: "SPECIAL", name: { ru: "Золото (Special)", en: "Special / Gold" }, color: "#ffd700", weights: { standard: 0.26, better_odds: 5.0 } }
} as const;

// Re-exported so callers that already import the engine do not need a second
// import; the value itself lives in shared types because the projection needs
// it too and must not depend on the server layer.
export { CASE_PITY_MAX };

function getHemisphere(lat: number, lng: number) {
  const ns = lat >= 0 ? { ru: "Северное", en: "Northern" } : { ru: "Южное", en: "Southern" };
  // Оставляем только северное/южное
  return {
    ru: `${ns.ru} полушарие`,
    en: `${ns.en} Hemisphere`
  };
}

function getContinent(lat: number, lng: number) {
  if (lat > 12 && lng >= -170 && lng <= -25) return { ru: "Северная Америка", en: "North America" };
  if (lat <= 12 && lng >= -90 && lng <= -30) return { ru: "Южная Америка", en: "South America" };
  if (lat >= 35 && lng >= -10 && lng <= 40) return { ru: "Европа", en: "Europe" };
  if (lat >= 0 && lng >= 40 && lng <= 180) return { ru: "Азия", en: "Asia" };
  if (lat >= -35 && lat <= 35 && lng >= -20 && lng <= 55) return { ru: "Африка", en: "Africa" };
  if (lat <= 10 && lng >= 110 && lng <= 180) return { ru: "Океания / Австралия", en: "Oceania / Australia" };
  return { ru: "Океания / Другой регион", en: "Oceania / Other" };
}

interface CaseItem {
  /** Stable id, used for duplicate protection. Never shown to the player. */
  key: string;
  tier: (typeof RARITY_TIERS)[CaseTierKey];
  itemName: { ru: string; en: string };
  generate: (lat: number, lng: number) => Partial<CaseHintData>;
}

const CLASSIC_CASE_ITEMS: CaseItem[] = [
  // --- СИНИЕ (MIL-SPEC) ---
  {
    key: "continent",
    tier: RARITY_TIERS.MIL_SPEC,
    itemName: { ru: "Континент", en: "Continent" },
    generate: (lat: number, lng: number): Partial<CaseHintData> => {
      const cont = getContinent(lat, lng);
      return { hintTitle: { ru: "Континент", en: "Continent" }, hintValue: cont };
    }
  },
  {
    key: "hemisphere",
    tier: RARITY_TIERS.MIL_SPEC,
    itemName: { ru: "Полушарие", en: "Hemisphere" },
    generate: (lat: number, lng: number): Partial<CaseHintData> => {
      const hemi = getHemisphere(lat, lng);
      return { hintTitle: { ru: "Полушарие", en: "Hemisphere" }, hintValue: hemi };
    }
  },
  {
    key: "circle-2500",
    tier: RARITY_TIERS.MIL_SPEC,
    itemName: { ru: "Круг 2500 км", en: "2500km Circle" },
    generate: (lat: number, lng: number): Partial<CaseHintData> => {
      const radiusMeters = 2500000;
      const angle = Math.random() * Math.PI * 2;
      const r = Math.random() * (radiusMeters * 0.5);
      const centerLat = lat + (r / 111320) * Math.cos(angle);
      const centerLng = lng + (r / (111320 * Math.cos(lat * (Math.PI / 180)))) * Math.sin(angle);
      return {
        hintTitle: { ru: "Зона поиска 2500 км", en: "Search Zone 2500 km" },
        hintValue: { ru: "Радиус 2500 км", en: "Radius 2500 km" },
        circle: { center: { lat: centerLat, lng: centerLng }, radiusMeters }
      };
    }
  },

  // --- ФИОЛЕТОВЫЕ (RESTRICTED) ---
  {
    key: "band-lat-10",
    tier: RARITY_TIERS.RESTRICTED,
    itemName: { ru: "Зона Широты (10°)", en: "Latitude Zone (10°)" },
    generate: (lat: number): Partial<CaseHintData> => {
      const min = Math.floor(lat / 10) * 10;
      const max = min + 10;
      return {
        hintTitle: { ru: "Полоса широты 10°", en: "10° Latitude Band" },
        hintValue: { ru: `От ${min}° до ${max}° с.ш./ю.ш.`, en: `From ${min}° to ${max}° Lat` },
        band: { min, max, axis: "lat" }
      };
    }
  },
  {
    key: "band-lng-15",
    tier: RARITY_TIERS.RESTRICTED,
    itemName: { ru: "Зона Долготы (15°)", en: "Longitude Zone (15°)" },
    generate: (_: number, lng: number): Partial<CaseHintData> => {
      const min = Math.floor(lng / 15) * 15;
      const max = min + 15;
      return {
        hintTitle: { ru: "Полоса долготы 15°", en: "15° Longitude Band" },
        hintValue: { ru: `От ${min}° до ${max}° в.д./з.д.`, en: `From ${min}° to ${max}° Lng` },
        band: { min, max, axis: "lng" }
      };
    }
  },
  {
    key: "circle-1500",
    tier: RARITY_TIERS.RESTRICTED,
    itemName: { ru: "Круг 1500 км", en: "1500km Circle" },
    generate: (lat: number, lng: number): Partial<CaseHintData> => {
      const radiusMeters = 1500000;
      const angle = Math.random() * Math.PI * 2;
      const r = Math.random() * (radiusMeters * 0.5);
      const centerLat = lat + (r / 111320) * Math.cos(angle);
      const centerLng = lng + (r / (111320 * Math.cos(lat * (Math.PI / 180)))) * Math.sin(angle);
      return {
        hintTitle: { ru: "Зона поиска 1500 км", en: "Search Zone 1500 km" },
        hintValue: { ru: "Радиус 1500 км", en: "Radius 1500 km" },
        circle: { center: { lat: centerLat, lng: centerLng }, radiusMeters }
      };
    }
  },
  {
    key: "spell-omen",
    tier: RARITY_TIERS.RESTRICTED,
    itemName: SPELLS.omen.name,
    generate: (lat: number, lng: number): Partial<CaseHintData> => ({
      hintTitle: { ru: "Заклинание", en: "Spell" },
      hintValue: { ru: "OMEN", en: "OMEN" },
      spell: "omen",
      spellTarget: { lat, lng }
    })
  },
  {
    key: "spell-compass",
    tier: RARITY_TIERS.RESTRICTED,
    itemName: SPELLS.compass.name,
    generate: (lat: number, lng: number): Partial<CaseHintData> => ({
      hintTitle: { ru: "Заклинание", en: "Spell" },
      hintValue: { ru: "COMPASS", en: "COMPASS" },
      spell: "compass",
      spellTarget: { lat, lng }
    })
  },

  // --- РОЗОВЫЕ (CLASSIFIED) ---
  {
    key: "circle-750",
    tier: RARITY_TIERS.CLASSIFIED,
    itemName: { ru: "Круг 750 км", en: "750km Circle" },
    generate: (lat: number, lng: number): Partial<CaseHintData> => {
      const radiusMeters = 750000;
      const angle = Math.random() * Math.PI * 2;
      const r = Math.random() * (radiusMeters * 0.5);
      const centerLat = lat + (r / 111320) * Math.cos(angle);
      const centerLng = lng + (r / (111320 * Math.cos(lat * (Math.PI / 180)))) * Math.sin(angle);
      return {
        hintTitle: { ru: "Узкий радиус 750 км", en: "Narrow Radius 750 km" },
        hintValue: { ru: "Радиус 750 км", en: "Radius 750 km" },
        circle: { center: { lat: centerLat, lng: centerLng }, radiusMeters }
      };
    }
  },
  {
    key: "exact-lat",
    tier: RARITY_TIERS.CLASSIFIED,
    itemName: { ru: "Точная Широта", en: "Exact Latitude" },
    generate: (lat: number): Partial<CaseHintData> => {
      return {
        hintTitle: { ru: "Точная Широта (Горизонталь)", en: "Exact Latitude (Horizontal)" },
        hintValue: { ru: `Широта: ${lat.toFixed(4)}°`, en: `Latitude: ${lat.toFixed(4)}°` },
        band: { min: lat - 0.001, max: lat + 0.001, axis: "lat" }
      };
    }
  },
  {
    key: "exact-lng",
    tier: RARITY_TIERS.CLASSIFIED,
    itemName: { ru: "Точная Долгота", en: "Exact Longitude" },
    generate: (_: number, lng: number): Partial<CaseHintData> => {
      return {
        hintTitle: { ru: "Точная Долгота (Вертикаль)", en: "Exact Longitude (Vertical)" },
        hintValue: { ru: `Долгота: ${lng.toFixed(4)}°`, en: `Longitude: ${lng.toFixed(4)}°` },
        band: { min: lng - 0.001, max: lng + 0.001, axis: "lng" }
      };
    }
  },
  {
    key: "spell-arrow",
    tier: RARITY_TIERS.CLASSIFIED,
    itemName: SPELLS.arrow.name,
    generate: (lat: number, lng: number): Partial<CaseHintData> => ({
      hintTitle: { ru: "Заклинание", en: "Spell" },
      hintValue: { ru: "ARROW", en: "ARROW" },
      spell: "arrow",
      spellTarget: { lat, lng }
    })
  },
  {
    key: "spell-scry",
    tier: RARITY_TIERS.CLASSIFIED,
    itemName: SPELLS.scry.name,
    generate: (lat: number, lng: number): Partial<CaseHintData> => ({
      hintTitle: { ru: "Заклинание", en: "Spell" },
      hintValue: { ru: "SCRY", en: "SCRY" },
      spell: "scry",
      spellTarget: { lat, lng }
    })
  },
  {
    key: "spell-echo",
    tier: RARITY_TIERS.CLASSIFIED,
    itemName: SPELLS.echo.name,
    generate: (lat: number, lng: number): Partial<CaseHintData> => ({
      hintTitle: { ru: "Заклинание", en: "Spell" },
      hintValue: { ru: "ECHO", en: "ECHO" },
      spell: "echo",
      spellTarget: { lat, lng }
    })
  },
  {
    key: "spell-heatmap",
    tier: RARITY_TIERS.CLASSIFIED,
    itemName: SPELLS.heatmap.name,
    generate: (lat: number, lng: number): Partial<CaseHintData> => ({
      hintTitle: { ru: "Заклинание", en: "Spell" },
      hintValue: { ru: "HEATMAP", en: "HEATMAP" },
      spell: "heatmap",
      spellTarget: { lat, lng }
    })
  },

// --- КРАСНЫЕ (COVERT) ---
  {
    key: "circle-250",
    tier: RARITY_TIERS.COVERT,
    itemName: { ru: "Круг 250 км", en: "250km Circle" },
    generate: (lat: number, lng: number): Partial<CaseHintData> => {
      const radiusMeters = 250000;
      const angle = Math.random() * Math.PI * 2;
      const r = Math.random() * (radiusMeters * 0.5);
      const centerLat = lat + (r / 111320) * Math.cos(angle);
      const centerLng = lng + (r / (111320 * Math.cos(lat * (Math.PI / 180)))) * Math.sin(angle);
      return {
        hintTitle: { ru: "Точный радиус 250 км", en: "Precise Radius 250 km" },
        hintValue: { ru: "Радиус 250 км", en: "Radius 250 km" },
        circle: { center: { lat: centerLat, lng: centerLng }, radiusMeters }
      };
    }
  },
  {
    key: "equator-mirror",
    tier: RARITY_TIERS.COVERT,
    itemName: { ru: "Зеркало экватора", en: "Equator Mirror" },
    generate: (lat: number, lng: number): Partial<CaseHintData> => {
      const mirrorLat = -lat;
      return {
        hintTitle: { ru: "Зеркальная точка относительно экватора", en: "Point Mirrored Across the Equator" },
        hintValue: { ru: `Широта: ${mirrorLat.toFixed(2)}°, долгота без изменений: ${lng.toFixed(2)}°`, en: `Latitude: ${mirrorLat.toFixed(2)}°, longitude unchanged: ${lng.toFixed(2)}°` },
        circle: { center: { lat: mirrorLat, lng }, radiusMeters: 100000 },
        exact: { lat: mirrorLat, lng }
      };
    }
  },
  {
    key: "spell-freeze",
    tier: RARITY_TIERS.COVERT,
    itemName: SPELLS.freeze.name,
    generate: (lat: number, lng: number): Partial<CaseHintData> => ({
      hintTitle: { ru: "Заклинание", en: "Spell" },
      hintValue: { ru: "FREEZE", en: "FREEZE" },
      spell: "freeze",
      spellTarget: { lat, lng }
    })
  },

  // --- ЗОЛОТО (SPECIAL) ---
  {
    key: "exact-5k",
    tier: RARITY_TIERS.SPECIAL,
    itemName: { ru: "Точные координаты (5K)", en: "Exact Coordinates (5K)" },
    generate: (lat: number, lng: number): Partial<CaseHintData> => {
      return {
        hintTitle: { ru: "Точные координаты (5K)", en: "Exact Coordinates (5K)" },
        hintValue: { ru: `${lat.toFixed(5)}, ${lng.toFixed(5)}`, en: `${lat.toFixed(5)}, ${lng.toFixed(5)}` },
        exact: { lat, lng }
      };
    }
  },
  {
    key: "spell-reroll",
    tier: RARITY_TIERS.SPECIAL,
    itemName: SPELLS.reroll.name,
    generate: (lat: number, lng: number): Partial<CaseHintData> => ({
      hintTitle: { ru: "Заклинание", en: "Spell" },
      hintValue: { ru: "REROLL", en: "REROLL" },
      spell: "reroll",
      spellTarget: { lat, lng }
    })
  }
];

export interface SpinOptions {
  /** Tiers the host allows. Empty / undefined means every tier. */
  enabledTiers?: CaseTierKey[];
  /** Consecutive MIL_SPEC rolls so far. At CASE_PITY_MAX the roll is boosted. */
  pity?: number;
  /** Key of the previous item, so the same item is not handed out twice in a row. */
  lastItem?: string | null;
}

/** Normalise a client-supplied tier list to known keys, preserving order. */
export function sanitizeCaseTiers(v: unknown): CaseTierKey[] {
  if (!Array.isArray(v)) return [...CASE_TIER_KEYS];
  const seen = new Set<CaseTierKey>();
  for (const raw of v) {
    if (typeof raw === "string" && (CASE_TIER_KEYS as string[]).includes(raw)) {
      seen.add(raw as CaseTierKey);
    }
  }
  // An empty selection would make the case unrollable, so fall back to all.
  return seen.size > 0 ? CASE_TIER_KEYS.filter((k) => seen.has(k)) : [...CASE_TIER_KEYS];
}

export function spinClassicCase(
  mode: CaseMode = "better_odds",
  targetLat: number,
  targetLng: number,
  options: SpinOptions = {},
): CaseHintData {
  // Roll the TIER first, then pick uniformly inside it.
  //
  // The previous version compared the roll against each *item's* tier weight,
  // but a tier's weight is shared by every item in it. That made the effective
  // probability `items_in_tier * tier_weight / total`, so tiers with more items
  // were over-represented and the rare tiers were far rarer than the table
  // claims (COVERT ~0.40% instead of 0.64%, SPECIAL ~0.08% instead of 0.26%).
  const enabled = options.enabledTiers && options.enabledTiers.length > 0
    ? options.enabledTiers
    : CASE_TIER_KEYS;
  const enabledSet = new Set(enabled);

  // Only tiers that are both enabled and actually have items can be rolled.
  const tiers = CASE_TIER_KEYS
    .filter((key) => enabledSet.has(key))
    .map((key) => RARITY_TIERS[key])
    .filter((tier) => CLASSIC_CASE_ITEMS.some((item) => item.tier.key === tier.key));

  // Pity timer: a long blue streak forces a better tier. The boost only applies
  // when a better tier is actually enabled, otherwise the case would be
  // unrollable in a "blues only" lobby.
  const pity = Math.max(0, Math.floor(options.pity ?? 0));
  const boosted = pity >= CASE_PITY_MAX
    ? tiers.filter((tier) => tier.key !== "MIL_SPEC")
    : [];
  const rollPool = boosted.length > 0 ? boosted : tiers;

  const totalWeight = rollPool.reduce((sum, tier) => sum + tier.weights[mode], 0);
  let random = Math.random() * totalWeight;
  let wonTier = rollPool[0];

  for (const tier of rollPool) {
    if (random < tier.weights[mode]) {
      wonTier = tier;
      break;
    }
    random -= tier.weights[mode];
  }

  const pool = CLASSIC_CASE_ITEMS.filter((item) => item.tier.key === wonTier.key);
  let wonItem = pool[Math.floor(Math.random() * pool.length)] ?? CLASSIC_CASE_ITEMS[0];

  // Duplicate protection: never hand out the same item twice in a row when the
  // tier has an alternative. A repeat feels like a wasted case even when the
  // tier is good.
  if (options.lastItem && wonItem.key === options.lastItem && pool.length > 1) {
    const alternatives = pool.filter((item) => item.key !== options.lastItem);
    wonItem = alternatives[Math.floor(Math.random() * alternatives.length)] ?? wonItem;
  }

  const generated = wonItem.generate(targetLat, targetLng);
  return {
    itemKey: wonItem.key,
    tierKey: wonItem.tier.key,
    tierName: wonItem.tier.name,
    tierColor: wonItem.tier.color,
    itemName: wonItem.itemName,
    hintTitle: generated.hintTitle || { ru: "", en: "" },
    hintValue: generated.hintValue || { ru: "", en: "" },
    ...generated
  };
}
