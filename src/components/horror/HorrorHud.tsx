"use client";

import { useEffect, useRef, useState } from "react";
import { useLanguage } from "@/lib/language";
import type { HorrorRunView } from "./types";

interface Props {
  run: HorrorRunView;
  onHappyThoughts: () => void;
  happyThoughtsBusy?: boolean;
  onGuessClick?: () => void;
  /** Opens the day's merchant shelf. */
  onMerchant?: () => void;
  guessPin?: { lat: number; lng: number } | null;
  busy?: boolean;
  /** False until the server knows the day's target (the panorama is scored against it). */
  targetReady?: boolean;
  onTick?: () => void;
}

function formatDistance(meters: number): string {
  if (meters >= 1000) {
    return `${(meters / 1000).toFixed(1)}K`;
  }
  return `${meters}M`;
}

function getHealthColor(pct: number): string {
  if (pct <= 25) return "#d31730";
  if (pct <= 50) return "#ffaa00";
  return "#38e07a";
}

export default function HorrorHud(props: Props) {
  const { t } = useLanguage();
  const run = props.run;
  const healthPct = Math.max(0, Math.min(100, (run.health / run.maxHealth) * 100));
  const lowHealth = run.health / run.maxHealth <= 0.25;
  const monsterDistance = formatDistance(run.monster.distance);
  const healthColor = getHealthColor(healthPct);
  const guessEnabled = Boolean(props.guessPin) && props.targetReady !== false && !props.busy;

  // Monster tick timer - advances the monster based on its pace.
  //
  // The monster closes 1 m per tick, so the tick cadence *is* `paceMs`. The
  // timer is paused while the run is over and while Happy Thoughts is freezing
  // him (`graceUntil`), so a dead run cannot keep calling the server and a
  // freeze actually buys the player the time it promises.
  //
  // We keep the latest `onTick` in a ref so the interval is NOT torn down and
  // recreated on every render (which would prevent it from ever firing, because
  // the parent passes a fresh function reference each render).
  const tickIntervalRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const onTickRef = useRef(props.onTick);
  onTickRef.current = props.onTick;

  const runOver = run.health <= 0;
  // Bumped when a Happy Thoughts freeze expires. `graceUntil` is a timestamp, so
  // without a re-render at that moment the effect would never restart the timer.
  const [epoch, setEpoch] = useState(0);

  // Anchor the server clock to a local timestamp. `run.serverTime` is fixed for
  // the whole projection, so using it directly as "now" would keep reporting the
  // original freeze duration forever and the timeout would reschedule itself
  // instead of restarting the tick interval. Advancing it by local elapsed time
  // keeps the server's clock authoritative without depending on the client clock.
  const serverClockRef = useRef({ serverTime: run.serverTime, localTime: Date.now() });
  if (serverClockRef.current.serverTime !== run.serverTime) {
    serverClockRef.current = { serverTime: run.serverTime, localTime: Date.now() };
  }

  useEffect(() => {
    if (!onTickRef.current) return;

    // Clear any existing interval
    if (tickIntervalRef.current) {
      clearInterval(tickIntervalRef.current);
      tickIntervalRef.current = null;
    }

    if (runOver) return;

    // `graceUntil` is on the server clock. Advance the projection's server time
    // by the local time elapsed since it was received, so the timeout expires
    // even when no new projection arrives during the freeze.
    const clock = serverClockRef.current;
    const serverNow = clock.serverTime + (Date.now() - clock.localTime);
    const remainingMs = run.monster.graceUntil - serverNow;
    if (remainingMs > 0) {
      const timeout = setTimeout(() => setEpoch((value) => value + 1), remainingMs + 50);
      return () => clearTimeout(timeout);
    }

    // Monster pace is in milliseconds per tick
    const paceMs = run.monster.paceMs;
    if (paceMs <= 0) return;

    // Set up interval to tick the monster
    tickIntervalRef.current = setInterval(() => {
      onTickRef.current?.();
    }, paceMs);

    return () => {
      if (tickIntervalRef.current) {
        clearInterval(tickIntervalRef.current);
        tickIntervalRef.current = null;
      }
    };
  }, [run.monster.paceMs, run.monster.graceUntil, runOver, epoch]);

  return (
    <>
      {/* Top HUD - HP Battle Style */}
      <div className="hp-battle-hud" style={{ pointerEvents: "auto" }}>
        {/* Left: Player Health */}
        <div className="hp-battle-player hp-battle-player--left" style={{ pointerEvents: "auto", width: "auto", maxWidth: "none", flex: 1, minWidth: 400 }}>
          <div className="hp-battle-avatar-wrapper" style={{ width: 56, height: 56 }}>
            <div style={{ width: "100%", height: "100%", borderRadius: "50%", background: "linear-gradient(135deg, rgba(255,255,255,0.15) 0%, rgba(255,255,255,0.02) 100%)", border: "2px solid rgba(255,255,255,0.1)", display: "flex", alignItems: "center", justifyContent: "center", fontSize: 24 }}>
              👤
            </div>
          </div>
          <div className="hp-battle-main">
            <div className="hp-battle-track-wrapper" style={{ gap: 8 }}>
              <div className="hp-battle-track" style={{
                borderColor: healthColor,
                boxShadow: `0 4px 10px rgba(0,0,0,0.5), 0 0 16px ${healthColor}40`,
                height: 45,
                width: 300,  // 3x wider (was 100)
                flex: "0 0 300px",  // Don't grow or shrink
              }}>
                <div 
                  className="hp-battle-fill" 
                  style={{ 
                    width: `${healthPct}%`,
                    background: lowHealth 
                      ? "linear-gradient(90deg, #d31730 0%, #ff4444 50%, #d31730 100%)"
                      : "linear-gradient(90deg, #38e07a 0%, #a3e635 50%, #38e07a 100%)",
                  }} 
                />
                <span className="hp-battle-val" style={{ transform: "skewX(10deg)", fontSize: 11, lineHeight: 1, marginTop: -8 }}>
                  {run.health.toLocaleString()} / {run.maxHealth.toLocaleString()}
                </span>
                {lowHealth && (
                  <div style={{ 
                    position: "absolute", 
                    inset: 0, 
                    background: "repeating-linear-gradient(45deg, transparent, transparent 4px, rgba(255,255,255,0.15) 4px, rgba(255,255,255,0.15) 8px)", 
                    animation: "pulse-stripes 1s linear infinite",
                    pointerEvents: "none",
                    transform: "skewX(10deg)",
                  }} />
                )}
              </div>
            </div>
            <div className="hp-battle-name" style={{ gap: 10, marginTop: 6 }}>
              <strong style={{ fontSize: 13 }}>{t("You")}</strong>
              <span style={{ color: "#a897b3", fontSize: 10, fontWeight: 500, fontFamily: "var(--font-mono, monospace)" }}>
                {t("Day")} {run.day}
              </span>
            </div>
            {/* Happy Thoughts button - moved under HP bar, compact */}
            <button
              type="button"
              disabled={!run.happyThoughtsReady || props.happyThoughtsBusy}
              onClick={props.onHappyThoughts}
              style={{
                marginTop: 8,
                display: "flex",
                alignItems: "center",
                justifyContent: "center",
                gap: 4,
                padding: "10px 12px",  // 1.5x taller padding
                background: run.happyThoughtsReady
                  ? "linear-gradient(135deg, #6b2d9e 0%, #8b3fd8 50%, #6b2d9e 100%)"
                  : "rgba(255,255,255,0.05)",
                border: run.happyThoughtsReady
                  ? "1px solid #bb86fc"
                  : "1px solid rgba(255,255,255,0.05)",
                borderRadius: 20,
                color: "#fff",
                cursor: run.happyThoughtsReady ? "pointer" : "not-allowed",
                fontWeight: 700,
                fontSize: 9,
                letterSpacing: 0.5,
                textTransform: "uppercase",
                fontFamily: "var(--font-mono, monospace)",
                transition: "all 0.2s ease",
                boxShadow: run.happyThoughtsReady
                  ? "0 0 20px rgba(187, 134, 252, 0.4), inset 0 1px 0 rgba(255,255,255,0.1)"
                  : "none",
                opacity: run.happyThoughtsReady ? 1 : 0.5,
                width: 225,  // 1.25x wider (180 * 1.25 = 225)
                height: 45,  // 1.5x taller
                overflow: "hidden",
                whiteSpace: "nowrap",
                textOverflow: "ellipsis",
              }}
            >
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" style={{ flexShrink: 0 }}>
                <circle cx="12" cy="12" r="10"></circle>
                <path d="M8 14s1.5 2 4 2 4-2 4-2"></path>
                <line x1="9" y1="9" x2="9.01" y2="9"></line>
                <line x1="15" y1="9" x2="15.01" y2="9"></line>
              </svg>
              <span style={{ overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                {run.happyThoughtsReady ? t("READY") : t("CHARGING")}
              </span>
              {run.happyThoughtsCharges > 1 && (
                <span style={{ background: "rgba(255,255,255,0.2)", borderRadius: 10, padding: "0 4px", fontSize: 8, fontWeight: 700, flexShrink: 0 }}>
                  x{run.happyThoughtsCharges}
                </span>
              )}
            </button>
          </div>
        </div>

        {/* Center: the working heading band comes from StreetView itself
            (`.sv-heading-band`), same as the other game modes. */}

        {/* Right: Monster Distance (moved from center) + Resources */}
        <div className="hp-battle-player hp-battle-player--right" style={{ pointerEvents: "auto", width: "auto", maxWidth: "none", flex: 1, justifyContent: "flex-end", minWidth: 280 }}>
          <div className="hp-battle-main" style={{ alignItems: "flex-end" }}>
            {/* Monster Distance - top right */}
            <div style={{ 
              display: "flex", 
              alignItems: "baseline", 
              gap: 4, 
              padding: "4px 12px", 
              background: "rgba(211, 23, 48, 0.15)", 
              border: "1px solid rgba(211, 23, 48, 0.4)", 
              borderRadius: 20, 
              backdropFilter: "blur(8px)",
              marginBottom: 8,
            }}>
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="#d31730" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <circle cx="12" cy="12" r="10"></circle>
                <path d="M12 6v6l4 2"></path>
              </svg>
              <span style={{ color: "#d31730", fontWeight: 900, fontSize: 20, fontFamily: "var(--font-mono, monospace)", lineHeight: 1, textShadow: "0 0 16px rgba(211, 23, 48, 0.8)" }}>
                {monsterDistance}
              </span>
              <span style={{ color: "#d31730", fontWeight: 700, fontSize: 11, marginTop: 2 }}>M</span>
              <span style={{ color: "#a897b3", fontSize: 8, marginTop: 4, textTransform: "uppercase", letterSpacing: 1 }}>{t("AWAY")}</span>
            </div>
            
            <div className="hp-battle-track-wrapper" style={{ gap: 8, justifyContent: "flex-end" }}>
              <div style={{ 
                display: "flex", 
                gap: 6, 
                background: "rgba(255,255,255,0.04)", 
                border: "1px solid rgba(255,255,255,0.06)", 
                borderRadius: 8, 
                padding: "6px 12px" 
              }}>
                <div style={{ display: "flex", alignItems: "center", gap: 4, color: "#ffd700" }}>
                  <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                    <circle cx="12" cy="12" r="10"></circle>
                    <path d="M12 6v6l4 2"></path>
                  </svg>
                  <span style={{ fontWeight: 800, fontSize: 14, fontFamily: "var(--font-mono, monospace)" }}>{run.gold}</span>
                </div>
                <div style={{ display: "flex", alignItems: "center", gap: 4, color: "#bb86fc" }}>
                  <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                    <path d="M3 7v6h6"></path>
                    <path d="M21 17a9 9 0 0 0-9-9 9 9 0 0 0-6 2.3L3 13"></path>
                  </svg>
                  <span style={{ fontWeight: 800, fontSize: 14, fontFamily: "var(--font-mono, monospace)" }}>{run.freeRerolls}</span>
                </div>
                <div style={{ display: "flex", alignItems: "center", gap: 4, color: "#2f7dff" }}>
                  <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                    <circle cx="12" cy="12" r="2"></circle>
                    <path d="M12 2v2"></path>
                    <path d="M12 20v2"></path>
                    <path d="M2 12h2"></path>
                    <path d="M20 12h2"></path>
                    <path d="M4.93 4.93l1.41 1.41"></path>
                    <path d="M17.66 17.66l1.41 1.41"></path>
                    <path d="M4.93 19.07l1.41-1.41"></path>
                    <path d="M17.66 6.34l1.41-1.41"></path>
                  </svg>
                  <span style={{ fontWeight: 800, fontSize: 14, fontFamily: "var(--font-mono, monospace)" }}>{run.echoes}</span>
                </div>
              </div>
            </div>
          </div>
        </div>
      </div>

      {/* Bottom Action Panel */}
      <div
        style={{
          position: "absolute",
          bottom: 16,
          left: "50%",
          transform: "translateX(-50%)",
          zIndex: 30,
          pointerEvents: "auto",
          width: 320,
        }}
      >
        <div
          style={{
            background: "rgba(20, 11, 29, 0.92)",
            border: "1px solid rgba(255, 255, 255, 0.08)",
            borderRadius: 16,
            padding: 16,
            backdropFilter: "blur(12px)",
            boxShadow: "0 8px 32px rgba(0, 0, 0, 0.6), inset 0 1px 0 rgba(255,255,255,0.05)",
          }}
        >
          {/* Title */}
          <div
            style={{
              textAlign: "center",
              color: "#efe8f2",
              fontSize: 13,
              fontWeight: 600,
              letterSpacing: 1,
              textTransform: "uppercase",
              marginBottom: 12,
              opacity: 0.8,
            }}
          >
            {t("GUESS WHERE YOU ARE")}
          </div>

          {/* Minimap / Hidden Area */}
          <div
            style={{
              width: "100%",
              height: 120,
              borderRadius: 10,
              background: "rgba(0, 0, 0, 0.6)",
              border: "1px solid rgba(255,255,255,0.05)",
              position: "relative",
              overflow: "hidden",
              marginBottom: 12,
            }}
          >
            <div
              style={{
                position: "absolute",
                inset: 0,
                background: "rgba(10, 5, 15, 0.9)",
                backdropFilter: "blur(8px)",
                display: "flex",
                flexDirection: "column",
                alignItems: "center",
                justifyContent: "center",
                gap: 8,
              }}
            >
              <svg width="32" height="32" viewBox="0 0 24 24" fill="none" stroke="rgba(255,255,255,0.3)" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
                <path d="M21 10c0 7-9 13-9 13s-9-6-9-13a9 9 0 0 1 18 0z"></path>
                <circle cx="12" cy="10" r="3"></circle>
                <line x1="12" y1="16" x2="12" y2="22"></line>
                <line x1="8" y1="19" x2="16" y2="19"></line>
              </svg>
              <span style={{ color: "rgba(255,255,255,0.4)", fontSize: 11, fontWeight: 500, letterSpacing: 0.5 }}>
                {t("HIDDEN")}
              </span>
              <span style={{ color: "rgba(255,255,255,0.25)", fontSize: 9, fontFamily: "var(--font-mono, monospace)" }}>
                {t("Use radar to reveal")}
              </span>
            </div>

            {props.guessPin && (
              <div
                style={{
                  position: "absolute",
                  bottom: 8,
                  left: "50%",
                  transform: "translateX(-50%)",
                  display: "flex",
                  alignItems: "center",
                  gap: 6,
                  padding: "4px 10px",
                  background: "rgba(211, 23, 48, 0.2)",
                  border: "1px solid rgba(211, 23, 48, 0.4)",
                  borderRadius: 20,
                  color: "#d31730",
                  fontSize: 10,
                  fontWeight: 600,
                  fontFamily: "var(--font-mono, monospace)",
                }}
              >
                <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                  <path d="M21 10c0 7-9 13-9 13s-9-6-9-13a9 9 0 0 1 18 0z"></path>
                  <circle cx="12" cy="10" r="3"></circle>
                </svg>
                {t("Marker placed")}
              </div>
            )}
          </div>

          {/* Guess Button */}
          <button
            type="button"
            onClick={props.onGuessClick}
            disabled={!guessEnabled}
            style={{
              width: "100%",
              padding: "14px 20px",
              background: guessEnabled
                ? "linear-gradient(135deg, #d31730 0%, #8b0f1f 100%)"
                : "rgba(255,255,255,0.05)",
              border: guessEnabled
                ? "1px solid rgba(211, 23, 48, 0.5)"
                : "1px solid rgba(255,255,255,0.05)",
              borderRadius: 10,
              color: "#fff",
              cursor: guessEnabled ? "pointer" : "not-allowed",
              fontWeight: 800,
              fontSize: 14,
              letterSpacing: 1,
              textTransform: "uppercase",
              fontFamily: "var(--font-mono, monospace)",
              transition: "all 0.2s ease",
              boxShadow: guessEnabled
                ? "0 0 20px rgba(211, 23, 48, 0.4), inset 0 1px 0 rgba(255,255,255,0.1)"
                : "none",
              opacity: guessEnabled ? 1 : 0.5,
            }}
          >
            {t("GUESS")}
          </button>

          <button
            type="button"
            onClick={props.onMerchant}
            disabled={props.busy}
            style={{
              width: "100%",
              marginTop: 8,
              padding: "10px 20px",
              background: "rgba(255,255,255,0.05)",
              border: "1px solid rgba(255,255,255,0.12)",
              borderRadius: 10,
              color: "#efe8f2",
              cursor: props.busy ? "not-allowed" : "pointer",
              fontWeight: 700,
              fontSize: 11,
              letterSpacing: 1,
              textTransform: "uppercase",
              fontFamily: "var(--font-mono, monospace)",
              opacity: props.busy ? 0.5 : 1,
            }}
          >
            🛒 {t("Merchant")}
          </button>
        </div>
      </div>

      {/* Global Styles */}
      <style jsx global>{`
        @keyframes pulse-stripes {
          0% { background-position: 0 0; }
          100% { background-position: 16px 0; }
        }
      `}</style>
    </>
  );
}