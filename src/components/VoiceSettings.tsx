"use client";

import { useEffect, useRef, useState } from "react";
import type { VoiceMode } from "@/lib/useVoiceChat";

interface Props {
  voiceMode: VoiceMode;
  onSetVoiceMode: (mode: VoiceMode) => void;
  micDeviceId: string | undefined;
  onChangeMic: (deviceId: string) => Promise<void>;
  micError: string | null;
  micReady: boolean;
  localAnalyserRef: React.RefObject<AnalyserNode | null>;
  getAudioCtx: () => AudioContext;
  onClose: () => void;
}

const MODES: { value: VoiceMode; label: string; desc: string }[] = [
  { value: "always-on", label: "Always on", desc: "Mic is always transmitting" },
  { value: "push-to-talk", label: "Push to talk", desc: "Hold Space (or button) to speak" },
  { value: "mute", label: "Mute", desc: "No audio transmitted" },
];

export default function VoiceSettings({
  voiceMode,
  onSetVoiceMode,
  micDeviceId,
  onChangeMic,
  micError,
  micReady,
  localAnalyserRef,
  getAudioCtx,
  onClose,
}: Props) {
  const [devices, setDevices] = useState<MediaDeviceInfo[]>([]);
  const [devicesLoaded, setDevicesLoaded] = useState(false);
  const meterRef = useRef<HTMLDivElement>(null);
  const rafRef = useRef<number>(0);

  // Enumerate devices — labels are available once getUserMedia has been granted.
  useEffect(() => {
    if (!navigator.mediaDevices) return;
    navigator.mediaDevices
      .enumerateDevices()
      .then((list) => {
        setDevices(list.filter((d) => d.kind === "audioinput"));
        setDevicesLoaded(true);
      })
      .catch(() => {});
  }, [micReady]); // re-enumerate after permission is granted

  // Live volume meter using the local analyser.
  useEffect(() => {
    if (!micReady || !meterRef.current) return;

    function tick() {
      const analyser = localAnalyserRef.current;
      const el = meterRef.current;
      if (!analyser || !el) return;
      const buf = new Float32Array(analyser.fftSize);
      analyser.getFloatTimeDomainData(buf);
      let sum = 0;
      for (const v of buf) sum += v * v;
      const rms = Math.sqrt(sum / buf.length);
      const level = Math.min(1, rms * 20); // scale 0..1
      el.style.width = `${Math.round(level * 100)}%`;
      rafRef.current = requestAnimationFrame(tick);
    }

    rafRef.current = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(rafRef.current);
  }, [micReady, localAnalyserRef]);

  // Resume AudioContext if needed (user gesture happening here in the modal).
  useEffect(() => {
    if (micReady) getAudioCtx();
  }, [micReady, getAudioCtx]);

  return (
    <div className="modal-backdrop" onClick={onClose}>
      <div
        className="modal stack"
        style={{ width: 440, gap: 20 }}
        onClick={(e) => e.stopPropagation()}
      >
        <button className="ghost modal-x" onClick={onClose} aria-label="Close">
          ✕
        </button>
        <h2 className="title" style={{ fontSize: 22 }}>
          Voice Settings
        </h2>

        {micError && (
          <div className="voice-error">
            <span className="muted" style={{ fontSize: 23 }}>
              {micError}
            </span>
          </div>
        )}

        {/* Microphone selector */}
        <div className="stack" style={{ gap: 8 }}>
          <span className="eyebrow">Microphone</span>
          {!devicesLoaded ? (
            <span className="muted" style={{ fontSize: 23 }}>
              Loading…
            </span>
          ) : devices.length === 0 ? (
            <span className="muted" style={{ fontSize: 23 }}>
              No microphones found.
            </span>
          ) : (
            <select
              className="voice-select"
              value={micDeviceId ?? ""}
              onChange={(e) => onChangeMic(e.target.value)}
            >
              {devices.map((d) => (
                <option key={d.deviceId} value={d.deviceId}>
                  {d.label || `Microphone ${d.deviceId.slice(0, 6)}`}
                </option>
              ))}
            </select>
          )}
        </div>

        {/* Volume meter */}
        <div className="stack" style={{ gap: 8 }}>
          <span className="eyebrow">Mic level</span>
          <div className="vol-meter-track">
            <div ref={meterRef} className="vol-meter-fill" />
          </div>
          {!micReady && (
            <span className="muted" style={{ fontSize: 21 }}>
              {micError ? "Mic unavailable" : "Requesting mic access…"}
            </span>
          )}
        </div>

        {/* Voice mode */}
        <div className="stack" style={{ gap: 8 }}>
          <span className="eyebrow">Voice mode</span>
          <div className="voice-mode-group">
            {MODES.map((m) => (
              <button
                key={m.value}
                className={`voice-mode-btn${voiceMode === m.value ? " voice-mode-btn--active" : ""}`}
                onClick={() => onSetVoiceMode(m.value)}
              >
                <strong>{m.label}</strong>
                <span className="muted" style={{ fontSize: 20 }}>
                  {m.desc}
                </span>
              </button>
            ))}
          </div>
        </div>

        <div style={{ display: "flex", justifyContent: "flex-end" }}>
          <button className="secondary" onClick={onClose}>
            Done
          </button>
        </div>
      </div>
    </div>
  );
}
