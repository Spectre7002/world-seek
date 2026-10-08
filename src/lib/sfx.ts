const LS_ENABLED_KEY = "ws-sfx-enabled";
const LS_VOLUME_KEY = "ws-sfx-volume";
const DEFAULT_VOLUME = 0.2;

export interface SfxSettings {
  enabled: boolean;
  volume: number; // 0..1
}

export function isSfxEnabled(): boolean {
  try {
    return localStorage.getItem(LS_ENABLED_KEY) !== "off";
  } catch {
    return true;
  }
}

export function getSfxVolume(): number {
  try {
    const raw = parseFloat(localStorage.getItem(LS_VOLUME_KEY) ?? "");
    return Number.isFinite(raw) ? Math.min(1, Math.max(0, raw)) : DEFAULT_VOLUME;
  } catch {
    return DEFAULT_VOLUME;
  }
}

export function getSfxSettings(): SfxSettings {
  return { enabled: isSfxEnabled(), volume: getSfxVolume() };
}

export function setSfxEnabled(enabled: boolean): void {
  try {
    localStorage.setItem(LS_ENABLED_KEY, enabled ? "on" : "off");
  } catch {}
}

export function setSfxVolume(volume: number): void {
  const clamped = Math.min(1, Math.max(0, volume));
  try {
    localStorage.setItem(LS_VOLUME_KEY, String(clamped));
  } catch {}
}

// Web Audio API playback: sounds are fetched + decoded into an in-memory
// AudioBuffer once, then played via a fresh AudioBufferSourceNode each time.
// This avoids the per-play latency HTMLAudioElement.play() has on mobile,
// where the OS has to wake/re-init the audio session on every call.
let audioCtx: AudioContext | null = null;

function getAudioCtx(): AudioContext | null {
  if (typeof window === "undefined" || typeof AudioContext === "undefined") return null;
  if (!audioCtx) audioCtx = new AudioContext();
  if (audioCtx.state === "suspended") void audioCtx.resume();
  return audioCtx;
}

const bufferCache = new Map<string, AudioBuffer>();
const bufferLoading = new Map<string, Promise<AudioBuffer | null>>();

function loadBuffer(ctx: AudioContext, src: string): Promise<AudioBuffer | null> {
  const cached = bufferCache.get(src);
  if (cached) return Promise.resolve(cached);
  let loading = bufferLoading.get(src);
  if (!loading) {
    loading = fetch(src)
      .then((res) => res.arrayBuffer())
      .then((data) => ctx.decodeAudioData(data))
      .then((buf) => {
        bufferCache.set(src, buf);
        return buf;
      })
      .catch(() => null);
    bufferLoading.set(src, loading);
  }
  return loading;
}

/** Fetches + decodes a sound effect ahead of time so the first play is instant. */
export function preloadSfx(src: string): void {
  const ctx = getAudioCtx();
  if (!ctx) return;
  void loadBuffer(ctx, src);
}

// Fallback path (Web Audio unavailable, or buffer not decoded yet) — one
// shared <audio> element per sound effect, reused across plays.
const audioCache = new Map<string, HTMLAudioElement>();

function playFallback(src: string): void {
  let audio = audioCache.get(src);
  if (!audio) {
    audio = new Audio(src);
    audioCache.set(src, audio);
  }
  audio.currentTime = 0;
  audio.volume = getSfxVolume();
  audio.play().catch(() => {});
}

/** Plays a sound effect from /public, respecting the enabled + volume settings. */
export function playSfx(src: string): void {
  if (!isSfxEnabled()) return;
  const ctx = getAudioCtx();
  if (!ctx) {
    playFallback(src);
    return;
  }
  const buffer = bufferCache.get(src);
  if (!buffer) {
    // Not decoded yet — play the fallback for this call and let the
    // now-in-flight decode populate the cache for subsequent plays.
    void loadBuffer(ctx, src);
    playFallback(src);
    return;
  }
  const gain = ctx.createGain();
  gain.gain.value = getSfxVolume();
  const source = ctx.createBufferSource();
  source.buffer = buffer;
  source.connect(gain).connect(ctx.destination);
  source.start(0);
}

function playTone(
  freq: number,
  durationSec: number,
  type: OscillatorType,
  when = 0,
  volumeMultiplier = 1,
): void {
  if (!isSfxEnabled()) return;
  const ctx = getAudioCtx();
  if (!ctx) return;
  const start = ctx.currentTime + when;
  const osc = ctx.createOscillator();
  const gain = ctx.createGain();
  osc.type = type;
  osc.frequency.value = freq;
  const vol = getSfxVolume() * 0.22 * volumeMultiplier;
  gain.gain.setValueAtTime(vol, start);
  gain.gain.exponentialRampToValueAtTime(0.001, start + durationSec);
  osc.connect(gain).connect(ctx.destination);
  osc.start(start);
  osc.stop(start + durationSec);
}

export function playRoundStartSfx(): void {
  playTone(523, 0.12, "square", 0, 0.5);
  playTone(784, 0.2, "square", 0.12, 0.5);
}

export function playTimeTickSfx(urgent: boolean): void {
  if (urgent) {
    playTone(920, 0.09, "square", 0);
    playTone(620, 0.09, "square", 0.1);
  } else {
    playTone(780, 0.07, "square", 0);
  }
}
