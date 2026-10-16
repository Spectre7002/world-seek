import type { CaseHintData, CaseMode, LatLng } from "../src/shared/types";

export const RARITY_TIERS = {
  MIL_SPEC: { key: "MIL_SPEC", name: { ru: "Синее (Mil-Spec)", en: "Mil-Spec (Blue)" }, color: "#4b69ff", weights: { standard: 79.92, better_odds: 25.0 } },
  RESTRICTED: { key: "RESTRICTED", name: { ru: "Фиолетовое (Restricted)", en: "Restricted (Purple)" }, color: "#8847ff", weights: { standard: 15.98, better_odds: 40.0 } },
  CLASSIFIED: { key: "CLASSIFIED", name: { ru: "Розовое (Classified)", en: "Classified (Pink)" }, color: "#d32ce6", weights: { standard: 3.20, better_odds: 20.0 } },
  COVERT: { key: "COVERT", name: { ru: "Красное (Covert)", en: "Covert (Red)" }, color: "#eb4b4b", weights: { standard: 0.64, better_odds: 10.0 } },
  SPECIAL: { key: "SPECIAL", name: { ru: "Золото (Special)", en: "Special / Gold" }, color: "#ffd700", weights: { standard: 0.26, better_odds: 5.0 } }
};

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

const CLASSIC_CASE_ITEMS = [
  // --- СИНИЕ (MIL-SPEC) ---
  {
    tier: RARITY_TIERS.MIL_SPEC,
    itemName: { ru: "Континент", en: "Continent" },
    generate: (lat: number, lng: number): Partial<CaseHintData> => {
      const cont = getContinent(lat, lng);
      return { hintTitle: { ru: "Континент", en: "Continent" }, hintValue: cont };
    }
  },
  {
    tier: RARITY_TIERS.MIL_SPEC,
    itemName: { ru: "Полушарие", en: "Hemisphere" },
    generate: (lat: number, lng: number): Partial<CaseHintData> => {
      const hemi = getHemisphere(lat, lng);
      return { hintTitle: { ru: "Полушарие", en: "Hemisphere" }, hintValue: hemi };
    }
  },
  {
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

  // --- РОЗОВЫЕ (CLASSIFIED) ---
  {
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

// --- КРАСНЫЕ (COVERT) ---
  {
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
    tier: RARITY_TIERS.COVERT,
    itemName: { ru: "Антипод (Противоположная точка)", en: "Antipode (Opposite Point)" },
    generate: (lat: number, lng: number): Partial<CaseHintData> => {
      const antiLat = -lat;
      const antiLng = lng > 0 ? lng - 180 : lng + 180;
      return {
        hintTitle: { ru: "Антипод земного шара", en: "Globe Antipode" },
        hintValue: { ru: `Противоположная точка: ${antiLat.toFixed(2)}°, ${antiLng.toFixed(2)}°`, en: `Antipode: ${antiLat.toFixed(2)}°, ${antiLng.toFixed(2)}°` },
        circle: { center: { lat: antiLat, lng: antiLng }, radiusMeters: 100000 },
        exact: { lat: antiLat, lng: antiLng }
      };
    }
  },

  // --- ЗОЛОТО (SPECIAL) ---
  {
    tier: RARITY_TIERS.SPECIAL,
    itemName: { ru: "5K Pinpoint (Точные Координаты)", en: "5K Pinpoint (Exact Coords)" },
    generate: (lat: number, lng: number): Partial<CaseHintData> => {
      return {
        hintTitle: { ru: "Точные Координаты (5K)", en: "Exact Location (5K)" },
        hintValue: { ru: `${lat.toFixed(5)}, ${lng.toFixed(5)}`, en: `${lat.toFixed(5)}, ${lng.toFixed(5)}` },
        exact: { lat, lng }
      };
    }
  }
];

export function spinClassicCase(mode: CaseMode = "better_odds", targetLat: number, targetLng: number): CaseHintData {
  const totalWeight = CLASSIC_CASE_ITEMS.reduce((sum, item) => sum + item.tier.weights[mode], 0);
  let random = Math.random() * totalWeight;
  let wonItem = CLASSIC_CASE_ITEMS[0];

  for (const item of CLASSIC_CASE_ITEMS) {
    if (random < item.tier.weights[mode]) {
      wonItem = item;
      break;
    }
    random -= item.tier.weights[mode];
  }

  const generated = wonItem.generate(targetLat, targetLng);
  return {
    tierKey: wonItem.tier.key,
    tierName: wonItem.tier.name,
    tierColor: wonItem.tier.color,
    itemName: wonItem.itemName,
    hintTitle: generated.hintTitle || { ru: "", en: "" },
    hintValue: generated.hintValue || { ru: "", en: "" },
    ...generated
  };
}