"use client";

import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import { emitAck } from "@/lib/socket";
import { saveSession } from "@/lib/session";
import { DEFAULT_EMOJI } from "@/shared/emojis";
import BudgetClosed from "@/components/BudgetClosed";
import EmojiPicker from "@/components/EmojiPicker";
import SfxControl from "@/components/SfxControl";
import type { CreateAck } from "@/shared/types";

export default function Home() {
  const router = useRouter();
  const [name, setName] = useState("");
  const [emoji, setEmoji] = useState(DEFAULT_EMOJI);
  const [code, setCode] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [textChat, setTextChat] = useState(false);
  const [voiceChat, setVoiceChat] = useState(false);
  const [settingsOpen, setSettingsOpen] = useState(false);
  // True once the month's Maps budget is spent and the site is closed.
  const [closed, setClosed] = useState(false);

  // Ask the server whether it can still afford to run games, so a visitor sees
  // the closed page up front rather than after typing a name and hitting start.
  useEffect(() => {
    let live = true;
    fetch("/api/budget")
      .then((r) => (r.ok ? r.json() : null))
      .then((s) => {
        if (live && s?.exhausted) setClosed(true);
      })
      // A failed check is not a reason to close the door — the server refuses
      // authoritatively at game:create anyway.
      .catch(() => {});
    return () => {
      live = false;
    };
  }, []);

  async function startGame() {
    if (!name.trim() || busy) return;
    setBusy(true);
    setError(null);
    const res = await emitAck<CreateAck>("game:create", {
      gmName: name.trim(),
      gmEmoji: emoji,
      settings: { textChat, voiceChat },
    });
    if (!res.ok) {
      // The budget ran out between page load and now — swap to the closed page
      // rather than inviting a retry that can't succeed until the 1st.
      if (res.error === "budget") {
        setClosed(true);
        return;
      }
      setError("The server is at capacity right now — please try again in a moment.");
      setBusy(false);
      return;
    }
    saveSession(res.code, {
      sessionToken: res.sessionToken,
      playerId: res.playerId,
    });
    router.push(`/game/${res.code}`);
  }

  // Codes are 6 letters shown as "xxx-xxx". Strip anything that isn't a letter,
  // cap at 6, and manage the dash so the user never types it. It appears as soon
  // as the 3rd letter lands (showing "abr-", ready for the 4th) — but only when
  // typing forward, so a backspace at "abr-" can still delete the dash.
  function formatCode(raw: string): string {
    const letters = raw.toLowerCase().replace(/[^a-z]/g, "").slice(0, 6);
    if (letters.length < 3) return letters;
    if (letters.length === 3) {
      const deleting = raw.length < code.length;
      return deleting ? letters : `${letters}-`;
    }
    return `${letters.slice(0, 3)}-${letters.slice(3)}`;
  }

  function joinGame() {
    const c = code.trim().toLowerCase();
    if (!c) return;
    router.push(`/game/${encodeURIComponent(c)}`);
  }

  if (closed) return <BudgetClosed />;

  return (
    <div className="center-screen">
      {/* Desaturated, near-transparent looping background video. Drop the file at
          public/landing-bg.mp4 — it's served from "/landing-bg.mp4". Muted + loop +
          playsInline so it autoplays silently on every browser. */}
      <video
        className="bg-video"
        autoPlay
        muted
        loop
        playsInline
        preload="auto"
        aria-hidden="true"
        src="/landing-bg.mp4"
        ref={(el) => {
          // Play at half speed for a slow, ambient drift.
          if (el) el.playbackRate = 0.5;
        }}
      />
      {/* Film-grain texture layered over the blurred video + terracotta field. */}
      <div className="bg-texture" aria-hidden="true" />
      <div className="stack" style={{ width: 380, gap: 24, position: "relative", zIndex: 1 }}>
        <div className="stack" style={{ gap: 10, textAlign: "center" }}>
          <span className="eyebrow" style={{ fontSize: 18 }}>
            Open World · Street View
          </span>
          <h1 className="title" style={{ fontSize: 64 }}>
            World Seek
          </h1>
          <p className="pullquote" style={{ margin: 0, fontSize: 18, color: "var(--text-dim)" }}>
            Hide somewhere in the world. Let your friends find you on Street View.
          </p>
        </div>

        <div className="card stack">
          <span className="eyebrow"><span className="section-number">§01</span>Start a new game</span>
          <input
            placeholder="Your name"
            value={name}
            maxLength={24}
            onChange={(e) => setName(e.target.value)}
            onKeyDown={(e) => e.key === "Enter" && startGame()}
            name="player-name"
            autoComplete="off"
            data-1p-ignore
            data-lpignore="true"
            data-bwignore
          />
          <span className="muted" style={{ fontSize: 23 }}>
            Pick your avatar
          </span>
          <EmojiPicker value={emoji} onChange={setEmoji} />
          <button type="button" className="secondary" onClick={() => setSettingsOpen(true)}>
            Settings
          </button>
          <button disabled={!name.trim() || busy} onClick={startGame}>
            {busy ? "Creating…" : "Start game"}
          </button>
        </div>

        {error && (
          <p className="muted" role="alert" style={{ color: "#c0392b" }}>
            {error}
          </p>
        )}

        {settingsOpen && (
          <div className="modal-backdrop" onClick={() => setSettingsOpen(false)}>
            <div
              className="modal stack"
              style={{ width: 420, gap: 20 }}
              onClick={(e) => e.stopPropagation()}
            >
              <button
                className="ghost modal-x"
                onClick={() => setSettingsOpen(false)}
                aria-label="Close"
              >
                ✕
              </button>
              <h2 className="title" style={{ fontSize: 22 }}>
                Settings
              </h2>

              <div className="stack" style={{ gap: 10 }}>
                <span className="eyebrow">Game settings</span>
                <div className="chat-toggles">
                  <label className="chat-toggle-row">
                    <span className="eyebrow">Text chat</span>
                    <button
                      type="button"
                      className={`toggle-btn${textChat ? " toggle-btn--on" : ""}`}
                      onClick={() => setTextChat((v) => !v)}
                      aria-pressed={textChat}
                    >
                      {textChat ? "On" : "Off"}
                    </button>
                  </label>
                  <label className="chat-toggle-row">
                    <span className="eyebrow">Voice chat</span>
                    <button
                      type="button"
                      className={`toggle-btn${voiceChat ? " toggle-btn--on" : ""}`}
                      onClick={() => setVoiceChat((v) => !v)}
                      aria-pressed={voiceChat}
                    >
                      {voiceChat ? "On" : "Off"}
                    </button>
                  </label>
                </div>
              </div>

              <div className="settings-divider" />

              <div className="stack" style={{ gap: 10 }}>
                <span className="eyebrow">Your settings</span>
                <SfxControl />
              </div>

              <div style={{ display: "flex", justifyContent: "flex-end" }}>
                <button className="secondary" onClick={() => setSettingsOpen(false)}>
                  Done
                </button>
              </div>
            </div>
          </div>
        )}

        <div className="card stack">
          <span className="eyebrow"><span className="section-number">§02</span>Join with a code</span>
          <input
            placeholder="e.g. abr-tyr"
            value={code}
            maxLength={7}
            onChange={(e) => setCode(formatCode(e.target.value))}
            onKeyDown={(e) => e.key === "Enter" && joinGame()}
          />
          <button className="secondary" disabled={!code.trim()} onClick={joinGame}>
            Join game
          </button>
        </div>

        <p className="muted" style={{ textAlign: "center", fontSize: 13, margin: 0 }}>
          Created by{" "}
          <a href="https://ivanvilla.com" target="_blank" rel="noopener noreferrer">
            Ivan Villa
          </a>
          {" · "}
          <a
            href="https://github.com/heyivanvilla/world-seek"
            target="_blank"
            rel="noopener noreferrer"
          >
            source code on GitHub
          </a>
        </p>
      </div>
    </div>
  );
}
