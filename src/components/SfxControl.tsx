"use client";

import { useState } from "react";
import { getSfxSettings, setSfxEnabled, setSfxVolume } from "@/lib/sfx";

/**
 * Sound-effects toggle + volume slider. Always mounted behind a gate (a menu
 * panel or modal that starts closed), so reading localStorage in the lazy
 * useState initializer is safe — this markup never appears in the initial
 * server-rendered HTML, so there's nothing for hydration to mismatch against.
 */
export default function SfxControl() {
  const [settings, setSettings] = useState(() => getSfxSettings());

  return (
    <div className="stack" style={{ gap: 8 }}>
      <label className="chat-toggle-row">
        <span className="eyebrow">Sound effects</span>
        <button
          type="button"
          className={`toggle-btn${settings.enabled ? " toggle-btn--on" : ""}`}
          onClick={() => {
            const enabled = !settings.enabled;
            setSettings((s) => ({ ...s, enabled }));
            setSfxEnabled(enabled);
          }}
          aria-pressed={settings.enabled}
        >
          {settings.enabled ? "On" : "Off"}
        </button>
      </label>
      <input
        type="range"
        className="volume-slider"
        min={0}
        max={1}
        step={0.01}
        value={settings.volume}
        disabled={!settings.enabled}
        onChange={(e) => {
          const volume = Number(e.target.value);
          setSettings((s) => ({ ...s, volume }));
          setSfxVolume(volume);
        }}
        aria-label="Sound effects volume"
      />
    </div>
  );
}
