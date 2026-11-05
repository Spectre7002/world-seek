"use client";

import { useEffect, useRef, useState } from "react";
import type { PublicPlayer } from "@/shared/types";
import { emojiUrl } from "@/shared/emojis";
import { pttKeyLabel, type PeerAudio, type VoiceMode } from "@/lib/useVoiceChat";
import { useLanguage } from "@/lib/language";
import { useDialog } from "@/lib/useDialog";

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
  /** Everyone else in the room, for the per-player volume list. */
  players: PublicPlayer[];
  myId: string;
  peerAudio: Record<string, PeerAudio>;
  onSetPeerVolume: (playerId: string, volume: number) => void;
  onTogglePeerMute: (playerId: string) => void;
  pttKey: string;
  onSetPttKey: (code: string) => void;
}

const MODES: { value: VoiceMode; label: string; desc: string }[] = [
  { value: "always-on", label: "Always on", desc: "Mic is always transmitting" },
  { value: "push-to-talk", label: "Push to talk", desc: "Hold the bound key (or button) to speak" },
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
  players,
  myId,
  peerAudio,
  onSetPeerVolume,
  onTogglePeerMute,
  pttKey,
  onSetPttKey,
}: Props) {
  const { t } = useLanguage();
  const [devices, setDevices] = useState<MediaDeviceInfo[]>([]);
  const [devicesLoaded, setDevicesLoaded] = useState(false);
  const [capturingKey, setCapturingKey] = useState(false);
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

  // Capture the next key press as the push-to-talk binding. Escape cancels, so
  // there is always a way out without binding Escape itself.
  useEffect(() => {
    if (!capturingKey) return;
    function onKey(e: KeyboardEvent) {
      e.preventDefault();
      e.stopPropagation();
      if (e.code === "Escape") {
        setCapturingKey(false);
        return;
      }
      onSetPttKey(e.code);
      setCapturingKey(false);
    }
    window.addEventListener("keydown", onKey, true);
    return () => window.removeEventListener("keydown", onKey, true);
  }, [capturingKey, onSetPttKey]);

  // Everyone except the viewer, and only players who are actually connected.
  const others = players.filter((p) => p.id !== myId && p.connected);
  const dialogRef = useDialog<HTMLDivElement>(onClose);

  return (
    <div className="modal-backdrop" onClick={onClose}>
      <div
        ref={dialogRef}
        role="dialog"
        aria-modal="true"
        aria-label={t("Voice Settings")}
        className="modal stack"
        style={{ width: 460, gap: 20, maxHeight: "85vh", overflowY: "auto" }}
        onClick={(e) => e.stopPropagation()}
      >
        <button className="ghost modal-x" onClick={onClose} aria-label={t("Close")}>
          ✕
        </button>
        <h2 className="title" style={{ fontSize: 22 }}>
          {t("Voice Settings")}
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
          <span className="eyebrow">{t("Microphone")}</span>
          {!devicesLoaded ? (
            <span className="muted" style={{ fontSize: 23 }}>
              {t("Loading...")}
            </span>
          ) : devices.length === 0 ? (
            <span className="muted" style={{ fontSize: 23 }}>
              {t("No microphones found.")}
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
          <span className="eyebrow">{t("Mic level")}</span>
          <div className="vol-meter-track">
            <div ref={meterRef} className="vol-meter-fill" />
          </div>
          {!micReady && (
            <span className="muted" style={{ fontSize: 21 }}>
              {micError ? t("Mic unavailable") : t("Requesting mic access...")}
            </span>
          )}
        </div>

        {/* Voice mode */}
        <div className="stack" style={{ gap: 8 }}>
          <span className="eyebrow">{t("Voice mode")}</span>
          <div className="voice-mode-group">
            {MODES.map((m) => (
              <button
                key={m.value}
                className={`voice-mode-btn${voiceMode === m.value ? " voice-mode-btn--active" : ""}`}
                onClick={() => onSetVoiceMode(m.value)}
              >
                <strong>{t(m.label)}</strong>
                <span className="muted" style={{ fontSize: 20 }}>
                  {t(m.desc)}
                </span>
              </button>
            ))}
          </div>
        </div>

        {/* Push-to-talk key binding */}
        {voiceMode === "push-to-talk" && (
          <div className="stack" style={{ gap: 8 }}>
            <span className="eyebrow">{t("Push-to-talk key")}</span>
            <div className="row" style={{ gap: 10, alignItems: "center" }}>
              <button
                type="button"
                className={`secondary ptt-key-btn${capturingKey ? " is-capturing" : ""}`}
                onClick={() => setCapturingKey(true)}
                aria-live="polite"
              >
                {capturingKey ? t("Press a key...") : pttKeyLabel(pttKey)}
              </button>
              {pttKey !== "Space" && (
                <button
                  type="button"
                  className="ghost"
                  onClick={() => onSetPttKey("Space")}
                >
                  {t("Reset to Space")}
                </button>
              )}
            </div>
            <span className="muted" style={{ fontSize: 20 }}>
              {t("Click the button, then press the key you want to hold to talk.")}
            </span>
          </div>
        )}

        {/* Per-player volume and mute */}
        <div className="stack" style={{ gap: 8 }}>
          <span className="eyebrow">{t("Players")}</span>
          {others.length === 0 ? (
            <span className="muted" style={{ fontSize: 21 }}>
              {t("Nobody else is connected right now.")}
            </span>
          ) : (
            <div className="peer-audio-list">
              {others.map((p) => {
                const audio = peerAudio[p.id] ?? { volume: 1, muted: false };
                return (
                  <div key={p.id} className="peer-audio-row">
                    <span className="peer-audio-name">
                      <img className="emoji-img" src={emojiUrl(p.emoji)} alt="" />
                      {p.name}
                    </span>
                    <input
                      className="peer-audio-slider"
                      type="range"
                      min={0}
                      max={100}
                      value={Math.round(audio.volume * 100)}
                      disabled={audio.muted}
                      aria-label={`${p.name} — ${t("Volume")}`}
                      onChange={(e) => onSetPeerVolume(p.id, Number(e.target.value) / 100)}
                    />
                    <button
                      type="button"
                      className={`ghost peer-audio-mute${audio.muted ? " is-muted" : ""}`}
                      onClick={() => onTogglePeerMute(p.id)}
                      aria-pressed={audio.muted}
                      aria-label={`${audio.muted ? t("Unmute") : t("Mute")} ${p.name}`}
                    >
                      {audio.muted ? "🔇" : "🔊"}
                    </button>
                  </div>
                );
              })}
            </div>
          )}
        </div>

        <div style={{ display: "flex", justifyContent: "flex-end" }}>
          <button className="secondary" onClick={onClose}>
            {t("Done")}
          </button>
        </div>
      </div>
    </div>
  );
}
