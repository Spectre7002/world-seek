import type { CaseHintData, CaseMode, LatLng } from "../src/shared/types";

const RARITY_TIERS = {
  MIL_SPEC: { name: 'Mil-Spec', color: '#4b69ff', weights: { standard: 79.92, better_odds: 25.0 } },
  RESTRICTED: { name: 'Restricted', color: '#8847ff', weights: { standard: 15.98, better_odds: 40.0 } },
  CLASSIFIED: { name: 'Classified', color: '#d32ce6', weights: { standard: 3.20, better_odds: 20.0 } },
  COVERT: { name: 'Covert', color: '#eb4b4b', weights: { standard: 0.64, better_odds: 10.0 } },
  SPECIAL: { name: 'Special / Gold', color: '#ffd700', weights: { standard: 0.26, better_odds: 5.0 } }
};

const CLASSIC_CASE_ITEMS = [
  // Mil-Spec
  {
    tier: RARITY_TIERS.MIL_SPEC,
    generateHint: (lat: number, lng: number): Partial<CaseHintData> => ({
      hintTitle: 'Полушарие',
      hintValue: `${lat >= 0 ? 'Северное' : 'Южное'} и ${lng >= 0 ? 'Восточное' : 'Западное'}`
    })
  },
  // Restricted
  {
    tier: RARITY_TIERS.RESTRICTED,
    generateHint: (lat: number, lng: number): Partial<CaseHintData> => ({
      hintTitle: 'Зона поиска 2500 км', hintValue: 'Смотрите на карту',
      circle: { center: { lat, lng }, radiusMeters: 2500000 }
    })
  },
  // Classified
  {
    tier: RARITY_TIERS.CLASSIFIED,
    generateHint: (lat: number, lng: number): Partial<CaseHintData> => ({
      hintTitle: 'Узкий радиус 500 км', hintValue: 'Смотрите на карту',
      circle: { center: { lat, lng }, radiusMeters: 500000 }
    })
  },
  // Covert
  {
    tier: RARITY_TIERS.COVERT,
    generateHint: (lat: number, lng: number): Partial<CaseHintData> => ({
      hintTitle: 'Точная зона 250 км', hintValue: 'Смотрите на карту',
      circle: { center: { lat, lng }, radiusMeters: 250000 }
    })
  },
  // Special
  {
    tier: RARITY_TIERS.SPECIAL,
    generateHint: (lat: number, lng: number): Partial<CaseHintData> => ({
      hintTitle: 'Точные координаты (5K)', hintValue: `${lat.toFixed(5)}, ${lng.toFixed(5)}`,
      exact: { lat, lng }
    })
  }
];

export function spinClassicCase(mode: CaseMode = "better_odds", targetLat: number, targetLng: number): CaseHintData {
  const totalWeight = CLASSIC_CASE_ITEMS.reduce((sum, item) => sum + item.tier.weights[mode], 0);
  let random = Math.random() * totalWeight;
  let wonItem = CLASSIC_CASE_ITEMS[0];

  for (const item of CLASSIC_CASE_ITEMS) {
    if (random < item.tier.weights[mode]) { wonItem = item; break; }
    random -= item.tier.weights[mode];
  }

  const generated = wonItem.generateHint(targetLat, targetLng);
  return {
    tierName: wonItem.tier.name,
    tierColor: wonItem.tier.color,
    hintTitle: generated.hintTitle || "",
    hintValue: generated.hintValue || "",
    ...generated
  };
}