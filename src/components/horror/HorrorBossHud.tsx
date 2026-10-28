"use client";

// HorrorGuessr — the boss duel HUD (P8, §5.1, §5.4, §6.6).
//
// A boss day is a **score comparison, not a damage race** (§5.1), so the HUD
// shows two health bars facing each other, the running round count, and the
// boss's mechanic. On the day-30 finale it also renders the pick-one-of-three
// reward chooser (§5.4), which is irreversible and must be legible before it is
// committed.
//
// The HUD never covers the guess confirmation: it sits at the top of the screen,
// above the day panel but clear of the map and the action row, and it is
// pointer-transparent except for its own buttons (§4.2: "never trap the
// player"). Health exposes `role="meter"` with `aria-valuenow/min/max` (§6.6).

import { useState } from "react";
import { useLanguage } from "@/lib/language";
import type { HorrorRunView } from "./types";
import { horrorBossMeta } from "./bossMeta";

interface Props {
  run: HorrorRunView;
  /** Send a `finalBossReward` action (day-30 finale only). */
  onFinalReward: (choice: "fullHeal" | "mythicEquipment" | "fiveRareFoods") => void;
  busy?: boolean;
}

const FINAL_OPTIONS = [
  {
    id: "fullHeal" as const,
    icon: "❤️",
    label: "A full heal",
    detail: "Back to full health, whatever you had left.",
  },
  {
    id: "mythicEquipment" as const,
    icon: "🛡️",
    label: "One Mythic equipment",
    detail: "Take it, or sell it on the spot.",
  },
  {
    id: "fiveRareFoods" as const,
    icon: "🍎",
    label: "5 Rare foods",
    detail: "All eaten, every one of them Rare.",
  },
];

export default function HorrorBossHud(props: Props) {
  const { t, language } = useLanguage();
  const run = props.run;
  const boss = run.boss;
  const [choosing, setChoosing] = useState(false);
  if (!boss) return null;

  const meta = horrorBossMeta(boss.mechanic);
  const duel = run.duel;
  const bossPct = Math.max(0, Math.min(100, (boss.health / boss.maxHealth) * 100));
  const playerPct = Math.max(0, Math.min(100, (run.health / run.maxHealth) * 100));
  const isFinal = boss.mechanic === "chosenRewards";
  const finalPending = isFinal && (duel?.rewardGranted ?? false) && (duel?.finalReward ?? null) === null;

  return (
    <>
      <div
        className="horror-boss-hud"
        style={{
          position: "absolute",
          top: 74,
          left: 12,
          right: 12,
          zIndex: 21,
          display: "flex",
          gap: 12,
          alignItems: "stretch",
          pointerEvents: "none",
        }}
      >
        {/* Player health */}
        <div
          className="horror-panel"
          style={{
            flex: 1,
            pointerEvents: "auto",
            background: "rgba(20,11,29,0.88)",
            border: "1px solid rgba(255,255,255,0.08)",
            borderRadius: 10,
            padding: "8px 12px",
            color: "#efe8f2",
          }}
        >
          <div style={{ display: "flex", justifyContent: "space-between", fontSize: 11, color: "#a897b3" }}>
            <span>{t("You")}</span>
            <span style={{ fontFamily: "monospace" }}>
              {run.health} / {run.maxHealth}
            </span>
          </div>
          <div
            role="meter"
            aria-valuenow={run.health}
            aria-valuemin={0}
            aria-valuemax={run.maxHealth}
            style={{
              marginTop: 4,
              height: 12,
              borderRadius: 6,
              background: "rgba(255,255,255,0.08)",
              overflow: "hidden",
            }}
          >
            <div
              style={{
                width: `${playerPct}%`,
                height: "100%",
                background: "linear-gradient(90deg, #38e07a, #a3e635)",
                transition: "width 300ms ease",
              }}
            />
          </div>
        </div>

        {/* Boss identity + mechanic */}
        <div
          className="horror-panel"
          style={{
            flex: 1.4,
            pointerEvents: "auto",
            background: "rgba(20,11,29,0.88)",
            border: `1px solid ${meta.color}`,
            borderRadius: 10,
            padding: "8px 12px",
            color: "#efe8f2",
          }}
        >
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: 8 }}>
            <span style={{ display: "inline-flex", alignItems: "center", gap: 6, fontWeight: 800 }}>
              <span aria-hidden="true" style={{ fontSize: 16 }}>{meta.icon}</span>
              <span>{boss.name[language] ?? boss.name.en}</span>
            </span>
            <span style={{ fontSize: 10, color: meta.color, fontWeight: 700, letterSpacing: 0.4 }}>
              {t(meta.label)}
            </span>
          </div>
          <div
            role="meter"
            aria-valuenow={boss.health}
            aria-valuemin={0}
            aria-valuemax={boss.maxHealth}
            style={{
              marginTop: 4,
              height: 12,
              borderRadius: 6,
              background: "rgba(255,255,255,0.08)",
              overflow: "hidden",
            }}
          >
            <div
              style={{
                width: `${bossPct}%`,
                height: "100%",
                background: `linear-gradient(90deg, ${meta.color}, #710917)`,
                transition: "width 300ms ease",
              }}
            />
          </div>
          <div style={{ marginTop: 4, display: "flex", justifyContent: "space-between", fontSize: 10, color: "#a897b3" }}>
            <span>{t("Round")} {duel?.round ?? 1}</span>
            <span>
              {t("Won")}: {duel?.roundsWon ?? 0} · {t("Lost")}: {duel?.roundsLost ?? 0}
            </span>
            <span style={{ fontFamily: "monospace" }}>
              {boss.health} / {boss.maxHealth}
            </span>
          </div>
        </div>
      </div>

      {/* The finale's reward chooser: only after a win, only once. */}
      {finalPending && (
        <div
          className="horror-final-reward"
          style={{
            position: "absolute",
            inset: 0,
            zIndex: 50,
            display: "grid",
            placeItems: "center",
            background: "rgba(11,6,16,0.92)",
            pointerEvents: "auto",
          }}
        >
          <div
            style={{
              width: "min(640px, calc(100vw - 32px))",
              background: "rgba(20,11,29,0.98)",
              border: "1px solid #ffc23d",
              borderRadius: 14,
              padding: 20,
              color: "#efe8f2",
            }}
          >
            <div style={{ fontSize: 12, color: "#ffc23d", letterSpacing: 2, textTransform: "uppercase" }}>
              {t("Final boss defeated")}
            </div>
            <h2 style={{ margin: "6px 0 4px", fontSize: 20 }}>{t("Choose one reward")}</h2>
            <p style={{ margin: 0, fontSize: 12, color: "#a897b3" }}>
              {t("This is irreversible. Take your time.")}
            </p>
            <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(160px, 1fr))", gap: 12, marginTop: 16 }}>
              {FINAL_OPTIONS.map((option) => (
                <button
                  key={option.id}
                  type="button"
                  disabled={props.busy || choosing}
                  onClick={() => {
                    setChoosing(true);
                    props.onFinalReward(option.id);
                  }}
                  style={{
                    textAlign: "left",
                    background: "rgba(255,255,255,0.04)",
                    border: "1px solid rgba(255,194,61,0.5)",
                    borderRadius: 10,
                    padding: 14,
                    color: "#efe8f2",
                    cursor: props.busy || choosing ? "not-allowed" : "pointer",
                  }}
                >
                  <div style={{ fontSize: 24 }} aria-hidden="true">{option.icon}</div>
                  <div style={{ fontWeight: 800, marginTop: 6 }}>{t(option.label)}</div>
                  <div style={{ fontSize: 11, color: "#a897b3", marginTop: 2 }}>{t(option.detail)}</div>
                </button>
              ))}
            </div>
          </div>
        </div>
      )}
    </>
  );
}