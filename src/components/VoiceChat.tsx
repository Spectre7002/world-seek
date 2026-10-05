"use client";

import { useEffect, useRef, useState } from "react";
import type { VoiceMode, VoiceChatHook } from "@/lib/useVoiceChat";
import VoiceSettings from "./VoiceSettings";

interface Props extends VoiceChatHook {
  myId: string;
}

function modeIcon(mode: VoiceMode, pttActive: boolean, micReady: boolean): string {
  if (!micReady) return "🎙️";
  switch (mode) {
    case "always-on":
      return "🎤";
    case "push-to-talk":
      return pttActive ? "🎤" : "🔴";
    case "mute":
      return "🔇";
  }
}

export default function VoiceChat({
  myId,
  voiceMode,
  setVoiceMode,
  micDeviceId,
  changeMic,
  micError,
  micReady,
  pttActive,
  setPttActive,
  speakingIds,
  localAnalyserRef,
  getAudioCtx,
}: Props) {
  const [settingsOpen, setSettingsOpen] = useState(false);
  const btnRef = useRef<HTMLButtonElement>(null);
  const rafRef = useRef<number>(0);

  const isSpeaking = speakingIds.has(myId);
  const icon = modeIcon(voiceMode, pttActive, micReady);

  // Animate a green glow on the button in real-time based on actual mic level.
  // This runs independently of the 100ms speaking-detection timer so it feels
  // truly live (no perceptible lag).
  useEffect(() => {
    if (!micReady) return;

    function tick() {
      const analyser = localAnalyserRef.current;
      const btn = btnRef.current;
      if (!analyser || !btn) {
        rafRef.current = requestAnimationFrame(tick);
        return;
      }
      const buf = new Float32Array(analyser.fftSize);
      analyser.getFloatTimeDomainData(buf);
      let sum = 0;
      for (const v of buf) sum += v * v;
      const rms = Math.sqrt(sum / buf.length);
      const level = Math.min(1, rms * 30);
      if (level > 0.05) {
        const spread = Math.round(level * 7);
        const alpha = (level * 0.7).toFixed(2);
        btn.style.boxShadow = `0 0 0 ${spread}px rgba(169, 192, 122, ${alpha})`;
        btn.style.borderColor = "var(--good)";
      } else {
        btn.style.boxShadow = "";
        btn.style.borderColor = "";
      }
      rafRef.current = requestAnimationFrame(tick);
    }

    rafRef.current = requestAnimationFrame(tick);
    return () => {
      cancelAnimationFrame(rafRef.current);
      if (btnRef.current) {
        btnRef.current.style.boxShadow = "";
        btnRef.current.style.borderColor = "";
      }
    };
  }, [micReady, localAnalyserRef]);

  function onPttDown(e: React.MouseEvent | React.TouchEvent) {
    if (voiceMode !== "push-to-talk") return;
    e.preventDefault();
    setPttActive(true);
  }

  function onPttUp() {
    if (voiceMode !== "push-to-talk") return;
    setPttActive(false);
  }

  return (
    <>
      <div className="voice-strip">
        <button
          ref={btnRef}
          className={`voice-btn secondary${pttActive ? " voice-btn--active" : ""}${micError ? " voice-btn--error" : ""}`}
          title={micError ?? (voiceMode === "push-to-talk" ? "Hold to talk" : "Voice settings")}
          aria-label={`Voice chat — ${isSpeaking ? "speaking" : voiceMode}`}
          onClick={() => setSettingsOpen(true)}
          onMouseDown={onPttDown}
          onMouseUp={onPttUp}
          onMouseLeave={onPttUp}
          onTouchStart={onPttDown}
          onTouchEnd={onPttUp}
        >
          {icon}
        </button>
      </div>

      {settingsOpen && (
        <VoiceSettings
          voiceMode={voiceMode}
          onSetVoiceMode={setVoiceMode}
          micDeviceId={micDeviceId}
          onChangeMic={changeMic}
          micError={micError}
          micReady={micReady}
          localAnalyserRef={localAnalyserRef}
          getAudioCtx={getAudioCtx}
          onClose={() => setSettingsOpen(false)}
        />
      )}
    </>
  );
}
