"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import type { PublicPlayer } from "@/shared/types";
import { getSocket } from "./socket";

export type VoiceMode = "always-on" | "push-to-talk" | "mute";

function buildIceServers(): RTCIceServer[] {
  const url = process.env.NEXT_PUBLIC_TURN_URL;
  const username = process.env.NEXT_PUBLIC_TURN_USERNAME;
  const credential = process.env.NEXT_PUBLIC_TURN_CREDENTIAL;
  if (url && username && credential) {
    return [
      { urls: "stun:stun.l.google.com:19302" },
      { urls: [url, `${url}?transport=tcp`], username, credential },
    ];
  }
  // Open Relay Project — free public TURN, handles symmetric NAT.
  // Replace with private TURN via the env vars above for higher-traffic use.
  return [
    { urls: "stun:stun.l.google.com:19302" },
    {
      urls: [
        "turn:openrelay.metered.ca:80",
        "turn:openrelay.metered.ca:443",
        "turn:openrelay.metered.ca:443?transport=tcp",
        "turn:openrelay.metered.ca:80?transport=tcp",
      ],
      username: "openrelayproject",
      credential: "openrelayproject",
    },
  ];
}
const LS_VOICE_MODE = "ws-voice-mode";
const LS_MIC_DEVICE = "ws-mic-device";
const LS_PTT_KEY = "ws-ptt-key";
const LS_PEER_VOLUMES = "ws-peer-volumes";
const SPEAK_THRESHOLD = 0.01;
const SPEAK_INTERVAL_MS = 100;

/**
 * Per-peer playback settings. `volume` is 0..1 and `muted` is a hard off, kept
 * separate from volume so unmuting restores the previous level instead of
 * jumping to full.
 */
export interface PeerAudio {
  volume: number;
  muted: boolean;
}

const DEFAULT_PEER_AUDIO: PeerAudio = { volume: 1, muted: false };

function loadPeerAudio(): Record<string, PeerAudio> {
  try {
    const raw = localStorage.getItem(LS_PEER_VOLUMES);
    if (!raw) return {};
    const parsed: unknown = JSON.parse(raw);
    if (typeof parsed !== "object" || parsed === null) return {};
    const out: Record<string, PeerAudio> = {};
    for (const [id, value] of Object.entries(parsed as Record<string, unknown>)) {
      if (typeof value !== "object" || value === null) continue;
      const v = value as Record<string, unknown>;
      const volume = typeof v.volume === "number" && Number.isFinite(v.volume)
        ? Math.max(0, Math.min(1, v.volume))
        : 1;
      out[id] = { volume: volume, muted: v.muted === true };
    }
    return out;
  } catch {
    return {};
  }
}

function savePeerAudio(map: Record<string, PeerAudio>): void {
  try {
    localStorage.setItem(LS_PEER_VOLUMES, JSON.stringify(map));
  } catch {}
}

/**
 * The push-to-talk key, stored as a `KeyboardEvent.code` (e.g. "Space",
 * "KeyV", "ShiftLeft"). `code` rather than `key` so the binding survives
 * keyboard layouts.
 */
function loadPttKey(): string {
  try {
    const v = localStorage.getItem(LS_PTT_KEY);
    if (v && v.length > 0 && v.length <= 32) return v;
  } catch {}
  return "Space";
}

/** Human-readable label for a `KeyboardEvent.code`. */
export function pttKeyLabel(code: string): string {
  if (code === "Space") return "Space";
  if (code.startsWith("Key")) return code.slice(3);
  if (code.startsWith("Digit")) return code.slice(5);
  if (code.startsWith("Numpad")) return "Num " + code.slice(6);
  if (code.startsWith("Arrow")) return code.slice(5);
  if (code === "ShiftLeft") return "L-Shift";
  if (code === "ShiftRight") return "R-Shift";
  if (code === "ControlLeft") return "L-Ctrl";
  if (code === "ControlRight") return "R-Ctrl";
  if (code === "AltLeft") return "L-Alt";
  if (code === "AltRight") return "R-Alt";
  return code;
}

function loadMode(): VoiceMode {
  try {
    const v = localStorage.getItem(LS_VOICE_MODE);
    if (v === "always-on" || v === "push-to-talk" || v === "mute") return v as VoiceMode;
  } catch {}
  return "always-on";
}

function loadMicDevice(): string | undefined {
  try {
    return localStorage.getItem(LS_MIC_DEVICE) ?? undefined;
  } catch {}
}

export interface VoiceChatHook {
  voiceMode: VoiceMode;
  setVoiceMode: (mode: VoiceMode) => void;
  micDeviceId: string | undefined;
  changeMic: (deviceId: string) => Promise<void>;
  speakingIds: Set<string>;
  micError: string | null;
  micReady: boolean;
  pttActive: boolean;
  setPttActive: (active: boolean) => void;
  localAnalyserRef: React.RefObject<AnalyserNode | null>;
  getAudioCtx: () => AudioContext;
  acquireMic: (deviceId?: string) => Promise<void>;
  /** Per-player playback settings, keyed by player id. */
  peerAudio: Record<string, PeerAudio>;
  setPeerVolume: (playerId: string, volume: number) => void;
  togglePeerMute: (playerId: string) => void;
  /** The `KeyboardEvent.code` bound to push-to-talk. */
  pttKey: string;
  setPttKey: (code: string) => void;
}

export function useVoiceChat(
  enabled: boolean,
  players: PublicPlayer[],
  myId: string,
): VoiceChatHook {
  const [voiceMode, _setVoiceMode] = useState<VoiceMode>(loadMode);
  const [micDeviceId, _setMicDeviceId] = useState<string | undefined>(loadMicDevice);
  const [speakingIds, setSpeakingIds] = useState<Set<string>>(new Set());
  const [micError, setMicError] = useState<string | null>(null);
  const [micReady, setMicReady] = useState(false);
  const [pttActive, _setPttActive] = useState(false);
  const [peerAudio, setPeerAudio] = useState<Record<string, PeerAudio>>(loadPeerAudio);
  const [pttKey, _setPttKey] = useState<string>(loadPttKey);
  const pttKeyRef = useRef(pttKey);
  pttKeyRef.current = pttKey;
  const peerAudioRef = useRef(peerAudio);
  peerAudioRef.current = peerAudio;

  // Refs that power the real-time logic without triggering re-renders.
  const voiceModeRef = useRef(voiceMode);
  const pttActiveRef = useRef(false);
  const micReadyRef = useRef(false);
  const myIdRef = useRef(myId);
  myIdRef.current = myId;

  const peersRef = useRef(new Map<string, RTCPeerConnection>());
  const remoteAnalysersRef = useRef(new Map<string, AnalyserNode>());
  // Persistent references to Audio elements — must be kept alive so the GC
  // doesn't collect them and silently stop playback.
  const audioElemsRef = useRef(new Map<string, HTMLAudioElement>());
  const localAnalyserRef = useRef<AnalyserNode | null>(null);
  const localStreamRef = useRef<MediaStream | null>(null);
  const audioCtxRef = useRef<AudioContext | null>(null);
  const pendingOffersRef = useRef<Array<{ from: string; sdp: RTCSessionDescriptionInit }>>([]);

  useEffect(() => { voiceModeRef.current = voiceMode; }, [voiceMode]);

  // Expose a stable AudioContext, resuming it if it suspended (autoplay policy).
  const getAudioCtx = useCallback((): AudioContext => {
    if (!audioCtxRef.current) {
      audioCtxRef.current = new AudioContext();
    }
    if (audioCtxRef.current.state === "suspended") {
      void audioCtxRef.current.resume();
    }
    return audioCtxRef.current;
  }, []);

  function applyMute() {
    const stream = localStreamRef.current;
    if (!stream) return;
    const mode = voiceModeRef.current;
    const ptt = pttActiveRef.current;
    const shouldTransmit = mode === "always-on" || (mode === "push-to-talk" && ptt);
    for (const track of stream.getAudioTracks()) {
      track.enabled = shouldTransmit;
    }
  }

  /**
   * Apply the stored per-peer volume/mute to every live audio element.
   *
   * Playback is a plain `<audio>` element per peer, so this is just a property
   * write — no renegotiation, no track replacement. That is why per-player
   * volume is a client-only feature: the audio never leaves the browser.
   */
  function applyPeerAudio() {
    const settings = peerAudioRef.current;
    for (const [peerId, audio] of audioElemsRef.current) {
      const s = settings[peerId] ?? DEFAULT_PEER_AUDIO;
      audio.volume = s.muted ? 0 : s.volume;
      audio.muted = s.muted;
    }
  }

  function createPeer(peerId: string, isInitiator: boolean): RTCPeerConnection {
    const existing = peersRef.current.get(peerId);
    if (existing) return existing;

    const pc = new RTCPeerConnection({ iceServers: buildIceServers() });
    peersRef.current.set(peerId, pc);

    const localStream = localStreamRef.current;
    if (localStream) {
      for (const track of localStream.getAudioTracks()) {
        pc.addTrack(track, localStream);
      }
    }

    pc.onicecandidate = (e) => {
      if (e.candidate) {
        getSocket().emit("voice:ice", { to: peerId, candidate: e.candidate.toJSON() });
      }
    };

    pc.ontrack = (e) => {
      const stream = e.streams[0];
      if (!stream) return;
      // Attach analyser for speaking detection
      const ctx = getAudioCtx();
      const src = ctx.createMediaStreamSource(stream);
      const analyser = ctx.createAnalyser();
      analyser.fftSize = 512;
      src.connect(analyser);
      remoteAnalysersRef.current.set(peerId, analyser);
      // Store the Audio element in a ref — a local variable would be GC'd,
      // silently killing playback.
      const audio = new Audio();
      audio.srcObject = stream;
      // Apply any saved volume/mute before the first frame plays, so a muted
      // peer never leaks a syllable.
      const saved = peerAudioRef.current[peerId] ?? DEFAULT_PEER_AUDIO;
      audio.volume = saved.muted ? 0 : saved.volume;
      audio.muted = saved.muted;
      audioElemsRef.current.set(peerId, audio);
      audio.play().catch((err) => console.warn("[voice] autoplay blocked for peer", peerId, err));
    };

    pc.onconnectionstatechange = () => {
      const state = pc.connectionState;
      console.log(`[voice] peer ${peerId} → ${state}`);
      if (state === "failed" || state === "closed") {
        peersRef.current.delete(peerId);
        remoteAnalysersRef.current.delete(peerId);
        const audio = audioElemsRef.current.get(peerId);
        if (audio) { audio.srcObject = null; audioElemsRef.current.delete(peerId); }
      }
    };

    if (isInitiator) {
      pc.createOffer()
        .then((offer) => pc.setLocalDescription(offer))
        .then(() => {
          if (pc.localDescription) {
            getSocket().emit("voice:offer", { to: peerId, sdp: pc.localDescription });
          }
        })
        .catch((err) => console.warn("[voice] offer failed for peer", peerId, err));
    }

    return pc;
  }

  function processOffer(from: string, sdp: RTCSessionDescriptionInit) {
    const pc = createPeer(from, false);
    pc.setRemoteDescription(new RTCSessionDescription(sdp))
      .then(() => pc.createAnswer())
      .then((ans) => pc.setLocalDescription(ans))
      .then(() => {
        if (pc.localDescription) {
          getSocket().emit("voice:answer", { to: from, sdp: pc.localDescription });
        }
      })
      .catch((err) => console.warn("[voice] answer failed for peer", from, err));
  }

  const acquireMic = useCallback(async (deviceId?: string): Promise<void> => {
    if (!navigator.mediaDevices) {
      setMicError("Voice chat requires a secure context (HTTPS or localhost).");
      return;
    }
    try {
      const constraints: MediaStreamConstraints = {
        audio: deviceId ? { deviceId: { exact: deviceId } } : true,
        video: false,
      };
      const stream = await navigator.mediaDevices.getUserMedia(constraints);

      // Replace tracks on existing connections before stopping old ones.
      const newTrack = stream.getAudioTracks()[0];
      if (localStreamRef.current && newTrack) {
        for (const [, pc] of peersRef.current) {
          for (const sender of pc.getSenders()) {
            if (sender.track?.kind === "audio") {
              sender.replaceTrack(newTrack).catch(() => {});
            }
          }
        }
        localStreamRef.current.getTracks().forEach((t) => t.stop());
      }

      localStreamRef.current = stream;

      // Local analyser for self-speaking indicator.
      const ctx = getAudioCtx();
      const src = ctx.createMediaStreamSource(stream);
      const analyser = ctx.createAnalyser();
      analyser.fftSize = 512;
      src.connect(analyser);
      localAnalyserRef.current = analyser;

      applyMute();
      micReadyRef.current = true;
      setMicReady(true);
      setMicError(null);

      // Drain any offers that arrived before the mic was ready.
      const pending = pendingOffersRef.current.splice(0);
      for (const { from, sdp } of pending) {
        processOffer(from, sdp);
      }
    } catch (err) {
      setMicError(err instanceof Error ? err.message : "Microphone access denied.");
      setMicReady(false);
      micReadyRef.current = false;
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [getAudioCtx]);

  // Speaking detection loop.
  useEffect(() => {
    if (!enabled) return;
    const id = setInterval(() => {
      const speaking = new Set<string>();
      for (const [pid, analyser] of remoteAnalysersRef.current) {
        const buf = new Float32Array(analyser.fftSize);
        analyser.getFloatTimeDomainData(buf);
        let sum = 0;
        for (const v of buf) sum += v * v;
        if (Math.sqrt(sum / buf.length) > SPEAK_THRESHOLD) speaking.add(pid);
      }
      if (localAnalyserRef.current && voiceModeRef.current !== "mute") {
        const analyser = localAnalyserRef.current;
        const buf = new Float32Array(analyser.fftSize);
        analyser.getFloatTimeDomainData(buf);
        let sum = 0;
        for (const v of buf) sum += v * v;
        if (Math.sqrt(sum / buf.length) > SPEAK_THRESHOLD) speaking.add(myIdRef.current);
      }
      setSpeakingIds((prev) => {
        if (prev.size === speaking.size && [...prev].every((id) => speaking.has(id))) return prev;
        return speaking;
      });
    }, SPEAK_INTERVAL_MS);
    return () => clearInterval(id);
  }, [enabled]);

  // WebRTC signal handling.
  useEffect(() => {
    if (!enabled) return;
    const socket = getSocket();

    const onOffer = ({ from, sdp }: { from: string; sdp: RTCSessionDescriptionInit }) => {
      if (!micReadyRef.current) {
        pendingOffersRef.current.push({ from, sdp });
      } else {
        processOffer(from, sdp);
      }
    };

    const onAnswer = ({ from, sdp }: { from: string; sdp: RTCSessionDescriptionInit }) => {
      const pc = peersRef.current.get(from);
      if (!pc) return;
      pc.setRemoteDescription(new RTCSessionDescription(sdp)).catch((err) =>
        console.warn("[voice] setRemoteDesc answer failed:", from, err),
      );
    };

    const onIce = ({ from, candidate }: { from: string; candidate: RTCIceCandidateInit }) => {
      const pc = peersRef.current.get(from);
      if (!pc) return;
      pc.addIceCandidate(new RTCIceCandidate(candidate)).catch((err) =>
        console.warn("[voice] addIceCandidate failed:", from, err),
      );
    };

    socket.on("voice:offer", onOffer);
    socket.on("voice:answer", onAnswer);
    socket.on("voice:ice", onIce);
    return () => {
      socket.off("voice:offer", onOffer);
      socket.off("voice:answer", onAnswer);
      socket.off("voice:ice", onIce);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [enabled]);

  // Create/close peer connections when the players list changes.
  useEffect(() => {
    if (!enabled || !micReady) return;
    const me = myIdRef.current;

    for (const player of players) {
      if (player.id === me || !player.connected || peersRef.current.has(player.id)) continue;
      // Alphabetically-lower ID is the initiator to prevent glare.
      createPeer(player.id, me < player.id);
    }

    // Close peers for players who left or disconnected.
    for (const [pid] of peersRef.current) {
      if (!players.find((p) => p.id === pid && p.connected)) {
        peersRef.current.get(pid)?.close();
        peersRef.current.delete(pid);
        remoteAnalysersRef.current.delete(pid);
      }
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [enabled, micReady, players]);

  // Initial mic acquire and full cleanup on unmount.
  useEffect(() => {
    if (!enabled) return;
    void acquireMic(micDeviceId);
    return () => {
      for (const [, pc] of peersRef.current) pc.close();
      peersRef.current.clear();
      remoteAnalysersRef.current.clear();
      audioElemsRef.current.forEach((a) => { a.srcObject = null; });
      audioElemsRef.current.clear();
      localStreamRef.current?.getTracks().forEach((t) => t.stop());
      localStreamRef.current = null;
      localAnalyserRef.current = null;
      audioCtxRef.current?.close().catch(() => {});
      audioCtxRef.current = null;
      micReadyRef.current = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [enabled]);

  // PTT key listener (only when push-to-talk mode is active). The bound key is
  // configurable; it is read from a ref so rebinding does not need to tear down
  // and re-add the listeners mid-press.
  useEffect(() => {
    if (!enabled || voiceMode !== "push-to-talk") return;
    const down = (e: KeyboardEvent) => {
      if (e.code !== pttKeyRef.current || e.repeat) return;
      const el = document.activeElement;
      if (el instanceof HTMLInputElement || el instanceof HTMLTextAreaElement) return;
      e.preventDefault();
      pttActiveRef.current = true;
      _setPttActive(true);
      applyMute();
    };
    const up = (e: KeyboardEvent) => {
      if (e.code !== pttKeyRef.current) return;
      pttActiveRef.current = false;
      _setPttActive(false);
      applyMute();
    };
    window.addEventListener("keydown", down);
    window.addEventListener("keyup", up);
    return () => {
      window.removeEventListener("keydown", down);
      window.removeEventListener("keyup", up);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [enabled, voiceMode]);

  const setVoiceMode = useCallback(
    (mode: VoiceMode) => {
      _setVoiceMode(mode);
      voiceModeRef.current = mode;
      try { localStorage.setItem(LS_VOICE_MODE, mode); } catch {}
      applyMute();
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [],
  );

  const setPttActive = useCallback((active: boolean) => {
    pttActiveRef.current = active;
    _setPttActive(active);
    applyMute();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const changeMic = useCallback(
    async (deviceId: string) => {
      _setMicDeviceId(deviceId);
      try { localStorage.setItem(LS_MIC_DEVICE, deviceId); } catch {}
      await acquireMic(deviceId);
    },
    [acquireMic],
  );

  /**
   * Commit a new per-peer map.
   *
   * The ref is updated synchronously (not inside the state updater) because
   * `applyPeerAudio` reads it immediately afterwards — a functional updater
   * runs during the next render, so the ref would still hold the old value and
   * the audio element would not change until something else re-rendered.
   */
  const commitPeerAudio = useCallback((next: Record<string, PeerAudio>) => {
    peerAudioRef.current = next;
    savePeerAudio(next);
    setPeerAudio(next);
    applyPeerAudio();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  /** Set one peer's playback volume (0..1). Unmutes if the level is raised. */
  const setPeerVolume = useCallback(
    (playerId: string, volume: number) => {
      const clamped = Math.max(0, Math.min(1, volume));
      const prev = peerAudioRef.current;
      const current = prev[playerId] ?? DEFAULT_PEER_AUDIO;
      commitPeerAudio({
        ...prev,
        [playerId]: { volume: clamped, muted: clamped === 0 ? current.muted : false },
      });
    },
    [commitPeerAudio],
  );

  /** Toggle one peer's mute. The volume level is preserved. */
  const togglePeerMute = useCallback(
    (playerId: string) => {
      const prev = peerAudioRef.current;
      const current = prev[playerId] ?? DEFAULT_PEER_AUDIO;
      commitPeerAudio({ ...prev, [playerId]: { ...current, muted: !current.muted } });
    },
    [commitPeerAudio],
  );

  /** Rebind push-to-talk. Stored as a `KeyboardEvent.code`. */
  const setPttKey = useCallback((code: string) => {
    if (!code || code.length > 32) return;
    _setPttKey(code);
    pttKeyRef.current = code;
    try { localStorage.setItem(LS_PTT_KEY, code); } catch {}
  }, []);

  return {
    voiceMode,
    setVoiceMode,
    micDeviceId,
    changeMic,
    speakingIds,
    micError,
    micReady,
    pttActive,
    setPttActive,
    localAnalyserRef,
    getAudioCtx,
    acquireMic,
    peerAudio,
    setPeerVolume,
    togglePeerMute,
    pttKey,
    setPttKey,
  };
}
