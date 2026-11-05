// Achievement definitions, shared by the server (which awards them) and the
// client (which renders the labels). Keeping the table in one place means an
// achievement can never be awarded under an id the UI does not know about.

export interface AchievementDef {
  id: string;
  /** Localized label + one-line description. */
  name: { en: string; ru: string };
  description: { en: string; ru: string };
  /** Emoji shown next to the badge. */
  icon: string;
}

/**
 * A guess this close counts as "perfect" for the perfect-guess achievements.
 * 25 m is roughly the width of a Street View panorama's own position error, so
 * anything tighter would be luck rather than skill.
 */
export const PERFECT_DISTANCE_KM = 0.025;

/** Wins needed for the "veteran" achievement. */
export const WINS_FOR_VETERAN = 10;

/** Distinct maps needed for the "globetrotter" achievement. */
export const MAPS_FOR_GLOBETROTTER = 10;

/** Score needed for the solo "ace" achievement. */
export const SOLO_ACE_SCORE = 4500;

export const ACHIEVEMENTS: AchievementDef[] = [
  {
    id: "first_game",
    name: { en: "First steps", ru: "Первые шаги" },
    description: { en: "Finish your first game.", ru: "Завершите первую игру." },
    icon: "🌱",
  },
  {
    id: "first_perfect",
    name: { en: "Bullseye", ru: "В яблочко" },
    description: {
      en: "Land a guess within 25 m of the target.",
      ru: "Угадайте место с точностью до 25 м.",
    },
    icon: "🎯",
  },
  {
    id: "sharpshooter",
    name: { en: "Sharpshooter", ru: "Снайпер" },
    description: { en: "Land five perfect guesses.", ru: "Пять точных попаданий." },
    icon: "🏹",
  },
  {
    id: "first_win",
    name: { en: "Winner", ru: "Победитель" },
    description: { en: "Win a game.", ru: "Выиграйте игру." },
    icon: "🥇",
  },
  {
    id: "veteran",
    name: { en: "Veteran", ru: "Ветеран" },
    description: {
      en: `Win ${WINS_FOR_VETERAN} games.`,
      ru: `Выиграйте ${WINS_FOR_VETERAN} игр.`,
    },
    icon: "🎖️",
  },
  {
    id: "globetrotter",
    name: { en: "Globetrotter", ru: "Путешественник" },
    description: {
      en: `Play on ${MAPS_FOR_GLOBETROTTER} different maps.`,
      ru: `Сыграйте на ${MAPS_FOR_GLOBETROTTER} разных картах.`,
    },
    icon: "🌍",
  },
  {
    id: "continental",
    name: { en: "Continental", ru: "Континентальный" },
    description: {
      en: "Win on every continent.",
      ru: "Победите на каждом континенте.",
    },
    icon: "🗺️",
  },
  {
    id: "hp_survivor",
    name: { en: "Survivor", ru: "Выживший" },
    description: { en: "Win an HP match.", ru: "Выиграйте матч в режиме HP." },
    icon: "❤️",
  },
  {
    id: "solo_ace",
    name: { en: "Solo ace", ru: "Одиночный ас" },
    description: {
      en: `Score ${SOLO_ACE_SCORE.toLocaleString()} in a solo game.`,
      ru: `Наберите ${SOLO_ACE_SCORE.toLocaleString()} очков в одиночной игре.`,
    },
    icon: "⭐",
  },
];

const BY_ID = new Map<string, AchievementDef>();
for (let i = 0; i < ACHIEVEMENTS.length; i++) {
  BY_ID.set(ACHIEVEMENTS[i].id, ACHIEVEMENTS[i]);
}

export function achievementById(id: string): AchievementDef | undefined {
  return BY_ID.get(id);
}

/** Every continent code the game ships a pool for. */
export const CONTINENT_CODES = [
  "africa",
  "asia",
  "europe",
  "northamerica",
  "oceania",
  "southamerica",
];
