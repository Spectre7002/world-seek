"use client";

import { useEffect, useState } from "react";
import { getMusicSettings, setMusicSettings } from "@/lib/musicSettings";
import { useLanguage } from "@/lib/language";
import type { MusicSettings } from "@/lib/musicSettings";

export default function MusicControl() {
  const { t } = useLanguage();
  const [settings, setSettings] = useState<MusicSettings>({
    enabled: true,
    volume: 0.16,
  });

  useEffect(() => {
    setSettings(getMusicSettings());
  }, []);

  function update(next: MusicSettings) {
    setSettings(next);
    setMusicSettings(next);
  }

  return (
    <div className="stack music-settings" style={{ gap: 8 }}>
      <label className="chat-toggle-row">
        <span className="eyebrow">{t("Background music")}</span>
        <button
          type="button"
          className={`toggle-btn${settings.enabled ? " toggle-btn--on" : ""}`}
          onClick={() => update({ ...settings, enabled: !settings.enabled })}
          aria-pressed={settings.enabled}
        >
          {settings.enabled ? t("On") : t("Off")}
        </button>
      </label>
      <input
        type="range"
        className="volume-slider"
        min={0}
        max={0.4}
        step={0.01}
        value={settings.volume}
        disabled={!settings.enabled}
        onChange={(event) =>
          update({ ...settings, volume: Number(event.target.value) })
        }
        aria-label={t("Background music volume")}
      />
      <span className="muted music-hint">{t("Add your MP3 at public/music/background.mp3 (3–10 MB recommended).")}</span>
    </div>
  );
}
