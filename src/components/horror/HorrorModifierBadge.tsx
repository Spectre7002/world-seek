"use client";

// HorrorGuessr — the HUD indicator for active day modifiers (P7, §6.2, §6.4).
//
// A compact badge row that names the day's modifier (Lights Out, Shadow Realm,
// Dark Panorama) and, when an equipped item deletes it, shows the badge struck
// through with a "bypassed" tag — so the player can see *why* the panorama is
// bright on a flashlight day. A boss day adds its own badge with the rank.
//
// The badge is a plain `title`-tooltipped element rather than the nested-tooltip
// system of §6.4, because it is a status chip, not an item card; the full nested
// tooltips belong to P9's docs shell.

import { useLanguage } from "@/lib/language";
import { horrorModifierMeta } from "./modifierMeta";

interface Props {
  /** The day's modifier, from `run.dayModifier`. */
  modifier: string;
  /** Modifiers deleted by an equipped item. */
  bypassed?: string[];
  /** `run.daySpec.type` — "Chase" | "Boss" | "FinalBoss". */
  dayType?: string;
  /** `run.daySpec.bossRank`, when the day is a boss day. */
  bossRank?: string | null;
}

export default function HorrorModifierBadge(props: Props) {
  const { t } = useLanguage();
  const meta = horrorModifierMeta(props.modifier);
  const isBypassed = (props.bypassed ?? []).includes(props.modifier);
  const showModifier = props.modifier !== "none";
  const showBoss = props.dayType === "Boss" || props.dayType === "FinalBoss";

  if (!showModifier && !showBoss) return null;

  return (
    <div
      className="horror-modifier-badges"
      style={{ display: "flex", flexWrap: "wrap", gap: 6, alignItems: "center" }}
    >
      {showModifier && (
        <div
          className={`horror-modifier-badge${isBypassed ? " is-bypassed" : ""}`}
          title={t(meta.description)}
          style={{
            display: "inline-flex",
            alignItems: "center",
            gap: 6,
            padding: "4px 9px",
            borderRadius: 999,
            border: `1px solid ${isBypassed ? "rgba(255,255,255,0.15)" : meta.color}`,
            background: isBypassed ? "rgba(255,255,255,0.06)" : "rgba(0,0,0,0.5)",
            color: "#efe8f2",
            fontSize: 11,
            fontWeight: 700,
            letterSpacing: 0.4,
            textDecoration: isBypassed ? "line-through" : "none",
            opacity: isBypassed ? 0.65 : 1,
          }}
        >
          <span aria-hidden="true">{meta.icon}</span>
          <span>{t(meta.label)}</span>
          {isBypassed && (
            <span style={{ fontSize: 9, color: "#38e07a", textDecoration: "none" }}>
              {t("bypassed")}
            </span>
          )}
        </div>
      )}

      {showBoss && (
        <div
          className="horror-modifier-badge is-boss"
          title={t("A boss day. Win the duel to survive.")}
          style={{
            display: "inline-flex",
            alignItems: "center",
            gap: 6,
            padding: "4px 9px",
            borderRadius: 999,
            border: "1px solid #d31730",
            background: "rgba(113,9,23,0.55)",
            color: "#efe8f2",
            fontSize: 11,
            fontWeight: 700,
            letterSpacing: 0.4,
          }}
        >
          <span aria-hidden="true">🤡</span>
          <span>{props.dayType === "FinalBoss" ? t("Final Boss") : t("Boss")}</span>
          {props.bossRank && (
            <span style={{ fontSize: 9, color: "#ffc23d" }}>{props.bossRank}</span>
          )}
        </div>
      )}
    </div>
  );
}
