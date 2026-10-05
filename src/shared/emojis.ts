// Curated emoji avatars. Each player picks one as their map marker + roster avatar.
export interface EmojiDef {
  /** Stable id stored on the player + sent over the wire. */
  id: string;
  /** Name of the emoji avatar. */
  name: string;
  /** Filename under public/emojis/. */
  file: string;
}

export const EMOJIS: EmojiDef[] = [
  { id: "grinning", name: "Grinning", file: "grinning.svg" },
  { id: "cool", name: "Cool", file: "cool.svg" },
  { id: "nerd", name: "Nerd", file: "nerd.svg" },
  { id: "clown", name: "Clown", file: "clown.svg" },
  { id: "mind-blown", name: "Mind Blown", file: "mind-blown.svg" },
  { id: "ghost", name: "Ghost", file: "ghost.svg" },
  { id: "robot", name: "Robot", file: "robot.svg" },
  { id: "alien", name: "Alien", file: "alien.svg" },
  { id: "dog", name: "Dog", file: "dog.svg" },
  { id: "cat", name: "Cat", file: "cat.svg" },
  { id: "fox", name: "Fox", file: "fox.svg" },
  { id: "lion", name: "Lion", file: "lion.svg" },
  { id: "frog", name: "Frog", file: "frog.svg" },
  { id: "panda", name: "Panda", file: "panda.svg" },
  { id: "penguin", name: "Penguin", file: "penguin.svg" },
  { id: "unicorn", name: "Unicorn", file: "unicorn.svg" },
  { id: "dragon", name: "Dragon", file: "dragon.svg" },
  { id: "rocket", name: "Rocket", file: "rocket.svg" },
  { id: "fire", name: "Fire", file: "fire.svg" },
  { id: "mushroom", name: "Mushroom", file: "mushroom.svg" },
];

/** Экспорт EMOJI_LIST для совместимости с JoinForm и другими модулями */
export const EMOJI_LIST: EmojiDef[] = EMOJIS;

const BY_ID = new Map<string, EmojiDef>();
for (let i = 0; i < EMOJIS.length; i++) {
  BY_ID.set(EMOJIS[i].id, EMOJIS[i]);
}

export const DEFAULT_EMOJI: string = EMOJIS[0].id;

export function isValidEmoji(id: string): boolean {
  return BY_ID.has(id);
}

export function emojiUrl(id: string): string {
  const def = BY_ID.get(id) || BY_ID.get(DEFAULT_EMOJI)!;
  return "/emojis/" + def.file;
}