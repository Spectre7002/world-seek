"use client";

import { useLanguage } from "@/lib/language";
import type { HorrorRunView } from "./types";

interface Props {
  /** Local player's run view */
  run: HorrorRunView;
  /** Opponent's run view (from server) */
  opponentRun: HorrorRunView | null;
  /** Local player's ID */
  youId: string;
  /** Opponent's ID */
  opponentId: string | null;
  /** Current round number */
  round: number;
  /** Total rounds */
  totalRounds: number;
  /** Time remaining in seconds */
  timeLeft: number | null;
  /** Callback when local player guesses */
  onGuess: (lat: number, lng: number) => void;
  /** Callback for happy thoughts */
  onHappyThoughts: () => void;
  /** Whether happy thoughts is busy */
  happyThoughtsBusy?: boolean;
  /** Whether a guess is being processed */
  guessBusy?: boolean;
  /** Current guess pin */
  guessPin?: { lat: number; lng: number } | null;
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

export default function Horror1v1Hud(props: Props) {
  const { t } = useLanguage();
  const { run, opponentRun, youId, opponentId, round, totalRounds, timeLeft, onGuess, onHappyThoughts, happyThoughtsBusy, guessBusy, guessPin } = props;

  const myHealthPct = Math.max(0, Math.min(100, (run.health / run.maxHealth) * 100));
  const myMonsterDist = formatDistance(run.monster.distance);
  const myLowHealth = run.health / run.maxHealth <= 0.25;

  const oppHealthPct = opponentRun ? Math.max(0, Math.min(100, (opponentRun.health / opponentRun.maxHealth) * 100)) : 0;
  const oppMonsterDist = opponentRun ? formatDistance(opponentRun.monster.distance) : "—";
  const oppLowHealth = opponentRun ? opponentRun.health / opponentRun.maxHealth <= 0.25 : false;

  const isMyTurn = !guessBusy; // Simplified - in real game this would come from server

  return (
    <>
      {/* Top Center: Round Info & Timer */}
      <div
        style={{
          position: "absolute",
          top: 16,
          left: "50%",
          transform: "translateX(-50%)",
          zIndex: 30,
          pointerEvents: "none",
          textAlign: "center",
        }}
      >
        <div
          style={{
            display: "inline-flex",
            alignItems: "center",
            gap: 12,
            padding: "6px 16px",
            background: "rgba(10, 5, 15, 0.85)",
            border: "1px solid rgba(255, 255, 255, 0.08)",
            borderRadius: 30,
            backdropFilter: "blur(8px)",
            boxShadow: "0 4px 24px rgba(0, 0, 0, 0.5)",
          }}
        >
          <span style={{ color: "#a897b3", fontSize: 12, fontWeight: 600, textTransform: "uppercase", letterSpacing: 1 }}>
            {t("Round")} {round} / {totalRounds}
          </span>
          {timeLeft !== null && timeLeft > 0 && (
            <span
              style={{
                color: timeLeft <= 10 ? "#d31730" : "#38e07a",
                fontSize: 18,
                fontWeight: 800,
                fontFamily: "var(--font-mono, monospace)",
                fontVariantNumeric: "tabular-nums",
                textShadow: timeLeft <= 10 ? "0 0 12px rgba(211, 23, 48, 0.8)" : "none",
              }}
            >
              {timeLeft}s
            </span>
          )}
        </div>
      </div>

      {/* Left Side: Local Player */}
      <div
        style={{
          position: "absolute",
          top: 80,
          left: 16,
          zIndex: 30,
          pointerEvents: "auto",
          width: 280,
        }}
      >
        <div
          style={{
            background: "rgba(20, 11, 29, 0.92)",
            border: `2px solid ${getHealthColor(myHealthPct)}`,
            borderRadius: 16,
            padding: 16,
            backdropFilter: "blur(12px)",
            boxShadow: `0 8px 32px rgba(0, 0, 0, 0.6), inset 0 1px 0 rgba(255,255,255,0.05), 0 0 24px ${getHealthColor(myHealthPct)}40`,
          }}
        >
          {/* Player Header */}
          <div style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 12 }}>
            <div
              style={{
                width: 44,
                height: 44,
                borderRadius: "50%",
                background: "linear-gradient(135deg, rgba(255,255,255,0.15) 0%, rgba(255,255,255,0.02) 100%)",
                border: "2px solid rgba(255,255,255,0.1)",
                display: "flex",
                alignItems: "center",
                justifyContent: "center",
                fontSize: 20,
              }}
            >
              👤
            </div>
            <div style={{ flex: 1, minWidth: 0 }}>
              <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                <span style={{ color: "#efe8f2", fontWeight: 700, fontSize: 14, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>
                  {t("You")}
                </span>
                <span
                  style={{
                    background: "linear-gradient(135deg, #d31730, #8b0f1f)",
                    color: "#fff",
                    fontSize: 9,
                    fontWeight: 800,
                    padding: "2px 8px",
                    borderRadius: 10,
                    textTransform: "uppercase",
                    letterSpacing: 0.5,
                  }}
                >
                  {t("LIVE")}
                </span>
              </div>
              <div style={{ color: "#a897b3", fontSize: 11, marginTop: 2, fontFamily: "var(--font-mono, monospace)" }}>
                Day {run.day} · {run.gold} {t("Gold")}
              </div>
            </div>
          </div>

          {/* Health Bar */}
          <div style={{ marginBottom: 12 }}>
            <div style={{ display: "flex", justifyContent: "space-between", fontSize: 11, color: "#a897b3", marginBottom: 4 }}>
              <span>{t("Health")}</span>
              <span style={{ fontFamily: "var(--font-mono, monospace)", color: getHealthColor(myHealthPct), fontWeight: 700 }}>
                {run.health.toLocaleString()} / {run.maxHealth.toLocaleString()}
              </span>
            </div>
            <div
              role="meter"
              aria-valuenow={run.health}
              aria-valuemin={0}
              aria-valuemax={run.maxHealth}
              style={{
                height: 14,
                borderRadius: 7,
                background: "rgba(255,255,255,0.08)",
                overflow: "hidden",
                position: "relative",
              }}
            >
              <div
                style={{
                  width: `${myHealthPct}%`,
                  height: "100%",
                  background: myLowHealth
                    ? "linear-gradient(90deg, #d31730 0%, #ff4444 50%, #d31730 100%)"
                    : "linear-gradient(90deg, #38e07a 0%, #a3e635 50%, #38e07a 100%)",
                  transition: "width 300ms ease",
                  borderRadius: 7,
                }}
              />
              {myLowHealth && (
                <div
                  style={{
                    position: "absolute",
                    inset: 0,
                    background: "repeating-linear-gradient(45deg, transparent, transparent 4px, rgba(255,255,255,0.1) 4px, rgba(255,255,255,0.1) 8px)",
                    animation: "pulse-stripes 1s linear infinite",
                    pointerEvents: "none",
                  }}
                />
              )}
            </div>
          </div>

          {/* Monster Distance */}
          <div style={{ marginBottom: 12, padding: "10px 12px", background: "rgba(211, 23, 48, 0.1)", border: "1px solid rgba(211, 23, 48, 0.3)", borderRadius: 10 }}>
            <div style={{ display: "flex", alignItems: "baseline", gap: 6, marginBottom: 4 }}>
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="#d31730" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <circle cx="12" cy="12" r="10"></circle>
                <path d="M12 6v6l4 2"></path>
              </svg>
              <span style={{ color: "#a897b3", fontSize: 11, textTransform: "uppercase", letterSpacing: 1 }}>{t("Monster")}</span>
            </div>
            <div style={{ display: "flex", alignItems: "baseline", gap: 4 }}>
              <span style={{ color: "#d31730", fontWeight: 900, fontSize: 28, fontFamily: "var(--font-mono, monospace)", lineHeight: 1, textShadow: "0 0 16px rgba(211, 23, 48, 0.8)" }}>
                {myMonsterDist}
              </span>
              <span style={{ color: "#d31730", fontWeight: 700, fontSize: 14, marginTop: 4 }}>M</span>
              <span style={{ color: "#a897b3", fontSize: 10, marginTop: 8, textTransform: "uppercase", letterSpacing: 1 }}>{t("AWAY")}</span>
            </div>
            <div style={{ marginTop: 6, fontSize: 10, color: "#a897b3", fontFamily: "var(--font-mono, monospace)" }}>
              Pace: {run.monster.paceMs}ms · Stride: +{run.monster.strideBonusM}m
            </div>
          </div>

          {/* Resources Row */}
          <div style={{ display: "flex", gap: 8, marginBottom: 12, flexWrap: "wrap" }}>
            <div style={{ flex: 1, minWidth: 60, padding: "8px 10px", background: "rgba(255,255,255,0.04)", border: "1px solid rgba(255,255,255,0.06)", borderRadius: 8, textAlign: "center" }}>
              <div style={{ color: "#ffd700", fontWeight: 800, fontSize: 16, fontFamily: "var(--font-mono, monospace)" }}>{run.gold}</div>
              <div style={{ color: "#a897b3", fontSize: 9, textTransform: "uppercase", letterSpacing: 0.5 }}>{t("Gold")}</div>
            </div>
            <div style={{ flex: 1, minWidth: 60, padding: "8px 10px", background: "rgba(255,255,255,0.04)", border: "1px solid rgba(255,255,255,0.06)", borderRadius: 8, textAlign: "center" }}>
              <div style={{ color: "#bb86fc", fontWeight: 800, fontSize: 16, fontFamily: "var(--font-mono, monospace)" }}>{run.freeRerolls}</div>
              <div style={{ color: "#a897b3", fontSize: 9, textTransform: "uppercase", letterSpacing: 0.5 }}>{t("Rerolls")}</div>
            </div>
            <div style={{ flex: 1, minWidth: 60, padding: "8px 10px", background: "rgba(255,255,255,0.04)", border: "1px solid rgba(255,255,255,0.06)", borderRadius: 8, textAlign: "center" }}>
              <div style={{ color: "#2f7dff", fontWeight: 800, fontSize: 16, fontFamily: "var(--font-mono, monospace)" }}>{run.echoes}</div>
              <div style={{ color: "#a897b3", fontSize: 9, textTransform: "uppercase", letterSpacing: 0.5 }}>{t("Echoes")}</div>
            </div>
          </div>

          {/* Happy Thoughts Button */}
          <button
            type="button"
            disabled={!run.happyThoughtsReady || happyThoughtsBusy}
            onClick={onHappyThoughts}
            style={{
              width: "100%",
              padding: "12px 16px",
              background: run.happyThoughtsReady
                ? "linear-gradient(135deg, #6b2d9e 0%, #8b3fd8 50%, #6b2d9e 100%)"
                : "rgba(255,255,255,0.05)",
              border: run.happyThoughtsReady
                ? "1px solid #bb86fc"
                : "1px solid rgba(255,255,255,0.05)",
              borderRadius: 10,
              color: "#fff",
              cursor: run.happyThoughtsReady ? "pointer" : "not-allowed",
              fontWeight: 700,
              fontSize: 12,
              letterSpacing: 0.5,
              textTransform: "uppercase",
              fontFamily: "var(--font-mono, monospace)",
              transition: "all 0.2s ease",
              boxShadow: run.happyThoughtsReady
                ? "0 0 20px rgba(187, 134, 252, 0.4), inset 0 1px 0 rgba(255,255,255,0.1)"
                : "none",
              opacity: run.happyThoughtsReady ? 1 : 0.5,
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              gap: 8,
            }}
          >
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <circle cx="12" cy="12" r="10"></circle>
              <path d="M8 14s1.5 2 4 2 4-2 4-2"></path>
              <line x1="9" y1="9" x2="9.01" y2="9"></line>
              <line x1="15" y1="9" x2="15.01" y2="9"></line>
            </svg>
            <span>{run.happyThoughtsReady ? t("HAPPY THOUGHTS READY") : t("HAPPY THOUGHTS CHARGING")}</span>
            {run.happyThoughtsCharges > 1 && (
              <span style={{ background: "rgba(255,255,255,0.2)", borderRadius: 10, padding: "0 6px", fontSize: 10, fontWeight: 700 }}>
                x{run.happyThoughtsCharges}
              </span>
            )}
          </button>
        </div>
      </div>

      {/* Right Side: Opponent */}
      <div
        style={{
          position: "absolute",
          top: 80,
          right: 16,
          zIndex: 30,
          pointerEvents: "auto",
          width: 280,
        }}
      >
        <div
          style={{
            background: "rgba(20, 11, 29, 0.92)",
            border: opponentRun ? `2px solid ${getHealthColor(oppHealthPct)}` : "2px solid rgba(255,255,255,0.1)",
            borderRadius: 16,
            padding: 16,
            backdropFilter: "blur(12px)",
            boxShadow: opponentRun
              ? `0 8px 32px rgba(0, 0, 0, 0.6), inset 0 1px 0 rgba(255,255,255,0.05), 0 0 24px ${getHealthColor(oppHealthPct)}40`
              : "0 8px 32px rgba(0, 0, 0, 0.6), inset 0 1px 0 rgba(255,255,255,0.05)",
            opacity: opponentRun ? 1 : 0.5,
          }}
        >
          {/* Opponent Header */}
          <div style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 12 }}>
            <div
              style={{
                width: 44,
                height: 44,
                borderRadius: "50%",
                background: opponentRun
                  ? "linear-gradient(135deg, rgba(211,23,48,0.2) 0%, rgba(139,15,31,0.1) 100%)"
                  : "rgba(255,255,255,0.02)",
                border: opponentRun ? "2px solid rgba(211,23,48,0.5)" : "2px solid rgba(255,255,255,0.05)",
                display: "flex",
                alignItems: "center",
                justifyContent: "center",
                fontSize: 20,
              }}
            >
              👻
            </div>
            <div style={{ flex: 1, minWidth: 0 }}>
              <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                <span style={{ color: opponentRun ? "#efe8f2" : "#555", fontWeight: 700, fontSize: 14, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>
                  {opponentRun ? "Opponent" : t("Waiting for opponent...")}
                </span>
                {opponentRun && (
                  <span
                    style={{
                      background: "linear-gradient(135deg, #d31730, #8b0f1f)",
                      color: "#fff",
                      fontSize: 9,
                      fontWeight: 800,
                      padding: "2px 8px",
                      borderRadius: 10,
                      textTransform: "uppercase",
                      letterSpacing: 0.5,
                    }}
                  >
                    {t("LIVE")}
                  </span>
                )}
              </div>
              {opponentRun && (
                <div style={{ color: "#a897b3", fontSize: 11, marginTop: 2, fontFamily: "var(--font-mono, monospace)" }}>
                  Day {opponentRun.day} · {opponentRun.gold} {t("Gold")}
                </div>
              )}
            </div>
          </div>

          {opponentRun ? (
            <>
              {/* Opponent Health Bar */}
              <div style={{ marginBottom: 12 }}>
                <div style={{ display: "flex", justifyContent: "space-between", fontSize: 11, color: "#a897b3", marginBottom: 4 }}>
                  <span>{t("Health")}</span>
                  <span style={{ fontFamily: "var(--font-mono, monospace)", color: getHealthColor(oppHealthPct), fontWeight: 700 }}>
                    {opponentRun.health.toLocaleString()} / {opponentRun.maxHealth.toLocaleString()}
                  </span>
                </div>
                <div
                  role="meter"
                  aria-valuenow={opponentRun.health}
                  aria-valuemin={0}
                  aria-valuemax={opponentRun.maxHealth}
                  style={{
                    height: 14,
                    borderRadius: 7,
                    background: "rgba(255,255,255,0.08)",
                    overflow: "hidden",
                    position: "relative",
                  }}
                >
                  <div
                    style={{
                      width: `${oppHealthPct}%`,
                      height: "100%",
                      background: oppLowHealth
                        ? "linear-gradient(90deg, #d31730 0%, #ff4444 50%, #d31730 100%)"
                        : "linear-gradient(90deg, #38e07a 0%, #a3e635 50%, #38e07a 100%)",
                      transition: "width 300ms ease",
                      borderRadius: 7,
                    }}
                  />
                  {oppLowHealth && (
                    <div
                      style={{
                        position: "absolute",
                        inset: 0,
                        background: "repeating-linear-gradient(45deg, transparent, transparent 4px, rgba(255,255,255,0.1) 4px, rgba(255,255,255,0.1) 8px)",
                        animation: "pulse-stripes 1s linear infinite",
                        pointerEvents: "none",
                      }}
                    />
                  )}
                </div>
              </div>

              {/* Opponent Monster Distance */}
              <div style={{ marginBottom: 12, padding: "10px 12px", background: "rgba(211, 23, 48, 0.1)", border: "1px solid rgba(211, 23, 48, 0.3)", borderRadius: 10 }}>
                <div style={{ display: "flex", alignItems: "baseline", gap: 6, marginBottom: 4 }}>
                  <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="#d31730" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                    <circle cx="12" cy="12" r="10"></circle>
                    <path d="M12 6v6l4 2"></path>
                  </svg>
                  <span style={{ color: "#a897b3", fontSize: 11, textTransform: "uppercase", letterSpacing: 1 }}>{t("Monster")}</span>
                </div>
                <div style={{ display: "flex", alignItems: "baseline", gap: 4 }}>
                  <span style={{ color: "#d31730", fontWeight: 900, fontSize: 28, fontFamily: "var(--font-mono, monospace)", lineHeight: 1, textShadow: "0 0 16px rgba(211, 23, 48, 0.8)" }}>
                    {oppMonsterDist}
                  </span>
                  <span style={{ color: "#d31730", fontWeight: 700, fontSize: 14, marginTop: 4 }}>M</span>
                  <span style={{ color: "#a897b3", fontSize: 10, marginTop: 8, textTransform: "uppercase", letterSpacing: 1 }}>{t("AWAY")}</span>
                </div>
                <div style={{ marginTop: 6, fontSize: 10, color: "#a897b3", fontFamily: "var(--font-mono, monospace)" }}>
                  Pace: {opponentRun.monster.paceMs}ms · Stride: +{opponentRun.monster.strideBonusM}m
                </div>
              </div>

              {/* Opponent Resources */}
              <div style={{ display: "flex", gap: 8, marginBottom: 12, flexWrap: "wrap" }}>
                <div style={{ flex: 1, minWidth: 60, padding: "8px 10px", background: "rgba(255,255,255,0.04)", border: "1px solid rgba(255,255,255,0.06)", borderRadius: 8, textAlign: "center" }}>
                  <div style={{ color: "#ffd700", fontWeight: 800, fontSize: 16, fontFamily: "var(--font-mono, monospace)" }}>{opponentRun.gold}</div>
                  <div style={{ color: "#a897b3", fontSize: 9, textTransform: "uppercase", letterSpacing: 0.5 }}>{t("Gold")}</div>
                </div>
                <div style={{ flex: 1, minWidth: 60, padding: "8px 10px", background: "rgba(255,255,255,0.04)", border: "1px solid rgba(255,255,255,0.06)", borderRadius: 8, textAlign: "center" }}>
                  <div style={{ color: "#bb86fc", fontWeight: 800, fontSize: 16, fontFamily: "var(--font-mono, monospace)" }}>{opponentRun.freeRerolls}</div>
                  <div style={{ color: "#a897b3", fontSize: 9, textTransform: "uppercase", letterSpacing: 0.5 }}>{t("Rerolls")}</div>
                </div>
                <div style={{ flex: 1, minWidth: 60, padding: "8px 10px", background: "rgba(255,255,255,0.04)", border: "1px solid rgba(255,255,255,0.06)", borderRadius: 8, textAlign: "center" }}>
                  <div style={{ color: "#2f7dff", fontWeight: 800, fontSize: 16, fontFamily: "var(--font-mono, monospace)" }}>{opponentRun.echoes}</div>
                  <div style={{ color: "#a897b3", fontSize: 9, textTransform: "uppercase", letterSpacing: 0.5 }}>{t("Echoes")}</div>
                </div>
              </div>

              {/* Opponent Happy Thoughts Status */}
              <div
                style={{
                  padding: "10px 12px",
                  background: opponentRun.happyThoughtsReady ? "rgba(187, 134, 252, 0.15)" : "rgba(255,255,255,0.03)",
                  border: opponentRun.happyThoughtsReady ? "1px solid #bb86fc" : "1px solid rgba(255,255,255,0.05)",
                  borderRadius: 10,
                  display: "flex",
                  alignItems: "center",
                  justifyContent: "center",
                  gap: 8,
                }}
              >
                <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke={opponentRun.happyThoughtsReady ? "#bb86fc" : "#555"} strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                  <circle cx="12" cy="12" r="10"></circle>
                  <path d="M8 14s1.5 2 4 2 4-2 4-2"></path>
                  <line x1="9" y1="9" x2="9.01" y2="9"></line>
                  <line x1="15" y1="9" x2="15.01" y2="9"></line>
                </svg>
                <span style={{ color: opponentRun.happyThoughtsReady ? "#bb86fc" : "#555", fontWeight: 700, fontSize: 11, textTransform: "uppercase", letterSpacing: 0.5, fontFamily: "var(--font-mono, monospace)" }}>
                  {opponentRun.happyThoughtsReady ? t("HAPPY THOUGHTS READY") : t("HAPPY THOUGHTS CHARGING")}
                </span>
                {opponentRun.happyThoughtsCharges > 1 && (
                  <span style={{ background: "rgba(255,255,255,0.1)", borderRadius: 10, padding: "0 6px", fontSize: 10, fontWeight: 700, color: "#888" }}>
                    x{opponentRun.happyThoughtsCharges}
                  </span>
                )}
              </div>
            </>
          ) : (
            <div style={{ textAlign: "center", padding: "20px", color: "#555" }}>
              <div style={{ fontSize: 24, marginBottom: 8 }}>👻</div>
              <div style={{ fontSize: 12, textTransform: "uppercase", letterSpacing: 1 }}>{t("Waiting for opponent...")}</div>
            </div>
          )}
        </div>
      </div>

      {/* Bottom Center: Action Panel (Guess Button) */}
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

            {guessPin && (
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
            onClick={() => guessPin && onGuess(guessPin.lat, guessPin.lng)}
            disabled={guessBusy || !guessPin}
            style={{
              width: "100%",
              padding: "14px 20px",
              background: guessPin && !guessBusy
                ? "linear-gradient(135deg, #d31730 0%, #8b0f1f 100%)"
                : "rgba(255,255,255,0.05)",
              border: guessPin && !guessBusy
                ? "1px solid rgba(211, 23, 48, 0.5)"
                : "1px solid rgba(255,255,255,0.05)",
              borderRadius: 10,
              color: "#fff",
              cursor: guessPin && !guessBusy ? "pointer" : "not-allowed",
              fontWeight: 800,
              fontSize: 14,
              letterSpacing: 1,
              textTransform: "uppercase",
              fontFamily: "var(--font-mono, monospace)",
              transition: "all 0.2s ease",
              boxShadow: guessPin && !guessBusy
                ? "0 0 20px rgba(211, 23, 48, 0.4), inset 0 1px 0 rgba(255,255,255,0.1)"
                : "none",
              opacity: guessPin && !guessBusy ? 1 : 0.5,
            }}
          >
            {t("GUESS")}
          </button>
        </div>
      </div>

      {/* Global Styles */}
      <style jsx global>{`
        @keyframes pulse-stripes {
          0% { background-position: 0 0; }
          100% { background-position: 16px 0; }
        }
        @keyframes pulse-ring {
          0% { transform: scale(1); opacity: 0.6; }
          100% { transform: scale(1.4); opacity: 0; }
        }
      `}</style>
    </>
  );
}