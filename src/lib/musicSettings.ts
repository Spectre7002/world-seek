"use client";

export interface MusicSettings {
  enabled: boolean;
  volume: number;
}

const STORAGE_KEY = "world-seek-music-settings";
export const MUSIC_SETTINGS_EVENT = "world-seek-music-settings";

const DEFAULT_SETTINGS: MusicSettings = { enabled: true, volume: 0.16 };

export function getMusicSettings(): MusicSettings {
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    if (!raw) return DEFAULT_SETTINGS;
    const parsed: unknown = JSON.parse(raw);
    if (typeof parsed !== "object" || parsed === null) return DEFAULT_SETTINGS;
    const value = parsed as Record<string, unknown>;
    return {
      enabled: typeof value.enabled === "boolean" ? value.enabled : DEFAULT_SETTINGS.enabled,
      volume: typeof value.volume === "number" && Number.isFinite(value.volume)
        ? Math.max(0, Math.min(1, value.volume))
        : DEFAULT_SETTINGS.volume,
    };
  } catch {
    return DEFAULT_SETTINGS;
  }
}

export function setMusicSettings(settings: MusicSettings): void {
  try {
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(settings));
    window.dispatchEvent(new Event(MUSIC_SETTINGS_EVENT));
  } catch (error) {
    console.error("Unable to save music settings.", error);
  }
}
