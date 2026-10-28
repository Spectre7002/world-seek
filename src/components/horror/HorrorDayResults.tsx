"use client";

// HorrorGuessr — the end-of-day results screen.
//
// Shown after an accepted guess, before the HUD comes back for the next day:
// the true spot, the player's guess, the line between them, and what the day
// cost. The reveal is the server's — the client never knew the coordinates
// while the day was being played.

import MapPicker, { type MapLine, type MapMarker } from "@/components/MapPicker";
import { formatDistance } from "@/shared/scoring";
import { useLanguage } from "@/lib/language";

export interface HorrorDayResult {
  day: number;
  target: { lat: number; lng: number };
  guess: { lat: number; lng: number };
  distanceKm: number;
  score: number;
  damage: number;
  healthBefore: number;
  healthAfter: number;
  perfect: boolean;
}

interface Props {
  result: HorrorDayResult;
  onContinue: () => void;
}

function Stat(props: { label: string; value: string; color?: string }) {
  return (
    <div
      style={{
        background: "rgba(255,255,255,0.04)",
        border: "1px solid rgba(255,255,255,0.08)",
        borderRadius: 10,
        padding: "8px 12px",
      }}
    >
      <div style={{ fontSize: 10, letterSpacing: 1, textTransform: "uppercase", color: "#a897b3" }}>
        {props.label}
      </div>
      <div style={{ fontSize: 18, fontWeight: 800, color: props.color ?? "#efe8f2", fontFamily: "var(--font-mono, monospace)" }}>
        {props.value}
      </div>
    </div>
  );
}

export default function HorrorDayResults({ result, onContinue }: Props) {
  const { t } = useLanguage();

  const markers: MapMarker[] = [
    { lat: result.target.lat, lng: result.target.lng, color: "#38e07a", title: t("The real spot") },
  ];
  if (!result.perfect) {
    markers.push({ lat: result.guess.lat, lng: result.guess.lng, color: "#d31730", title: t("Your guess") });
  }
  const lines: MapLine[] = result.perfect
    ? []
    : [{ from: result.guess, to: result.target, color: "#d31730" }];

  return (
    <div
      style={{
        position: "fixed",
        inset: 0,
        // Above the HUD and merchant, below the game-over screen and jumpscare.
        zIndex: 45,
        display: "grid",
        placeItems: "center",
        padding: 16,
        background: "rgba(5, 2, 10, 0.92)",
      }}
    >
      <div
        style={{
          width: "min(880px, calc(100vw - 32px))",
          maxHeight: "calc(100vh - 32px)",
          overflowY: "auto",
          background: "rgba(20, 11, 29, 0.98)",
          border: "1px solid rgba(255,255,255,0.08)",
          borderRadius: 16,
          color: "#efe8f2",
          boxShadow: "0 24px 64px rgba(0,0,0,0.7)",
        }}
      >
        <div style={{ padding: "14px 18px", borderBottom: "1px solid rgba(255,255,255,0.06)", display: "flex", alignItems: "baseline", gap: 10, flexWrap: "wrap" }}>
          <h2 style={{ margin: 0, fontSize: 22 }}>
            {t("Day complete")} · {result.day}
          </h2>
          {result.perfect && (
            <span style={{ fontSize: 11, fontWeight: 800, letterSpacing: 1, textTransform: "uppercase", color: "#38e07a" }}>
              {t("Perfect guess — full heal!")}
            </span>
          )}
        </div>

        <div style={{ height: 320, position: "relative", background: "#0b0610" }}>
          <MapPicker markers={markers} lines={lines} fitToContent />
        </div>

        <div style={{ padding: 16, display: "flex", flexDirection: "column", gap: 12 }}>
          <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(140px, 1fr))", gap: 8 }}>
            <Stat label={t("Distance")} value={formatDistance(result.distanceKm)} />
            <Stat label={t("Score")} value={result.score.toLocaleString()} />
            <Stat
              label={t("Damage taken")}
              value={result.damage > 0 ? `-${result.damage.toLocaleString()}` : "0"}
              color={result.damage > 0 ? "#ff2d55" : "#38e07a"}
            />
            <Stat
              label={t("Health")}
              value={`${result.healthBefore.toLocaleString()} → ${result.healthAfter.toLocaleString()}`}
              color={result.healthAfter > result.healthBefore ? "#38e07a" : "#efe8f2"}
            />
          </div>

          <button
            type="button"
            onClick={onContinue}
            style={{
              alignSelf: "flex-end",
              padding: "12px 28px",
              background: "linear-gradient(135deg, #d31730 0%, #8b0f1f 100%)",
              border: "1px solid rgba(211, 23, 48, 0.5)",
              borderRadius: 10,
              color: "#fff",
              cursor: "pointer",
              fontWeight: 800,
              fontSize: 14,
              letterSpacing: 1,
              textTransform: "uppercase",
              fontFamily: "var(--font-mono, monospace)",
            }}
          >
            {t("Continue")}
          </button>
        </div>
      </div>
    </div>
  );
}
