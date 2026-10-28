"use client";

import { useLanguage } from "@/lib/language";
import type { HorrorRunView } from "./types";

interface Props {
  run: HorrorRunView;
  onCast: (spellId: string, target: { lat: number; lng: number }) => void;
  castBusy?: boolean;
}

export default function HorrorSpells(props: Props) {
  const { t } = useLanguage();
  const run = props.run;
  const entries = Object.entries(run.spells);

  return (
    <div
      className="horror-spells"
      style={{
        position: "absolute",
        bottom: 12,
        right: 12,
        width: 260,
        background: "rgba(20,11,29,0.9)",
        border: "1px solid rgba(255,255,255,0.08)",
        borderRadius: 10,
        padding: 10,
        color: "#efe8f2",
        zIndex: 20,
      }}
    >
      <div style={{ fontSize: 12, color: "#a897b3", marginBottom: 6, textTransform: "uppercase", letterSpacing: 1 }}>
        {t("Spells")}
      </div>
      {entries.length === 0 && (
        <div style={{ fontSize: 11, color: "#a897b3" }}>{t("none")}</div>
      )}
      <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
        {entries.map(([id, charges]) => (
          <div
            key={id}
            style={{
              display: "flex",
              justifyContent: "space-between",
              alignItems: "center",
              background: "rgba(255,255,255,0.04)",
              border: "1px solid rgba(255,255,255,0.08)",
              borderRadius: 6,
              padding: "4px 8px",
            }}
          >
            <div>
              <div style={{ fontSize: 12, fontWeight: 700 }}>{id}</div>
              <div style={{ fontSize: 10, color: "#a897b3" }}>
                {t("charges")}: {charges}
              </div>
            </div>
            <button
              type="button"
              disabled={charges <= 0 || props.castBusy}
              onClick={() => props.onCast(id, { lat: 0, lng: 0 })}
              style={{
                background: charges > 0 ? "linear-gradient(rgb(211,23,48), rgb(113,9,23))" : "rgba(255,255,255,0.08)",
                color: "#efe8f2",
                border: "none",
                borderRadius: 6,
                padding: "4px 10px",
                cursor: charges > 0 ? "pointer" : "not-allowed",
                fontSize: 11,
                fontWeight: 700,
              }}
            >
              {t("Cast")}
            </button>
          </div>
        ))}
      </div>
      <div style={{ marginTop: 8, fontSize: 10, color: "#a897b3" }}>
        {t("Arrows")}: {run.arrows} · {t("Echoes")}: {run.echoes}
      </div>
    </div>
  );
}