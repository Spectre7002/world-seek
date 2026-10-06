"use client";

import { useEffect, useRef, useState } from "react";
import {
  getMusicSettings,
  MUSIC_SETTINGS_EVENT,
  type MusicSettings,
} from "@/lib/musicSettings";

export default function AmbientMusic(props: { active: boolean }) {
  const [settings, setSettings] = useState<MusicSettings>({ enabled: true, volume: 0.16 });
  const audioRef = useRef<HTMLAudioElement>(null);
  const enabled = settings.enabled;

  async function play() {
    const audio = audioRef.current;
    if (!audio || !audio.paused) return;
    try {
      await audio.play();
    } catch (error) {
      if (!(error instanceof DOMException && error.name === "NotAllowedError")) {
        console.error("Unable to play background music.", error);
      }
    }
  }

  useEffect(() => {
    function syncSettings() {
      const nextSettings = getMusicSettings();
      setSettings(nextSettings);
      const audio = audioRef.current;
      if (!audio) return;
      audio.volume = nextSettings.volume;
      if (props.active && nextSettings.enabled) void play();
    }
    syncSettings();
    window.addEventListener(MUSIC_SETTINGS_EVENT, syncSettings);
    return () => window.removeEventListener(MUSIC_SETTINGS_EVENT, syncSettings);
  }, [props.active]);

  useEffect(() => {
    const audio = audioRef.current;
    if (!audio) return;
    audio.volume = settings.volume;

    if (!props.active) {
      audio.pause();
    } else if (!enabled) {
      audio.pause();
    } else {
      void play();
    }
  }, [props.active, enabled, settings.volume]);

  if (!props.active) return null;

  return (
    <audio
      className="ambient-audio"
      ref={audioRef}
      src="/music/background.mp3"
      loop
      preload="none"
      onError={() => console.error("Background music file is missing or unreadable at public/music/background.mp3.")}
    />
  );
}
