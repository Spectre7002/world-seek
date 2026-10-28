"use client";

// HorrorGuessr — jumpscares and animation triggers (P7, §4.2, §6.6).
//
// One overlay that renders whichever transient effect the run just produced:
//
//   - `jumpscare` — the monster flash on a catch, a fall, or a rejected guess
//     (§4.2). It obscures the map but never the HUD, and it is
//     `pointer-events: none`, so it can never overlap the guess confirmation
//     dialog (§4.2: "never trap the player").
//   - `damage` / `crit` — a red vignette pulse **sized to the damage** (§6.6).
//   - `heal` — a green flash on a perfect 5000 full heal (§1.3).
//   - `death` — the run-over overlay.
//
// Every animation is gated by `prefers-reduced-motion` (§6.6): when reduced, the
// effect still appears but holds still instead of animating.

import { useEffect, useState } from "react";
import { useLanguage } from "@/lib/language";

export type HorrorFxKind = "jumpscare" | "damage" | "heal" | "death" | "crit";

export interface HorrorFxEvent {
  /** Monotonic id, so two identical events still re-trigger the effect. */
  id: number;
  kind: HorrorFxKind;
  /** Damage magnitude, for the vignette sizing. */
  amount?: number;
}

interface Props {
  event: HorrorFxEvent | null;
  reducedMotion?: boolean;
}

const DURATIONS: Record<HorrorFxKind, number> = {
  jumpscare: 900,
  damage: 650,
  heal: 700,
  death: 1800,
  crit: 800,
};

export default function HorrorJumpscare(props: Props) {
  const { t } = useLanguage();
  const [visible, setVisible] = useState<HorrorFxEvent | null>(null);

  useEffect(() => {
    if (!props.event) return;
    setVisible(props.event);
    const timer = window.setTimeout(
      () => setVisible(null),
      DURATIONS[props.event.kind] ?? 700,
    );
    return () => window.clearTimeout(timer);
  }, [props.event]);

  if (!visible) return null;

  const reduced = Boolean(props.reducedMotion);
  const amount = visible.amount ?? 0;
  // Vignette thickness scales with the damage, capped so a huge hit does not
  // black out the screen (§6.6: "red vignette pulse sized to damage").
  const vignette = Math.min(0.85, 0.25 + amount / 4000);

  if (visible.kind === "jumpscare") {
    return (
      <div
        className="horror-jumpscare"
        aria-hidden="true"
        style={{
          position: "fixed",
          inset: 0,
          zIndex: 60,
          pointerEvents: "none",
          display: "grid",
          placeItems: "center",
          background:
            "radial-gradient(circle at 50% 45%, rgba(211,23,48,0.35), rgba(0,0,0,0.96) 70%)",
          animation: reduced ? undefined : "hz-jumpscare-flash 900ms ease-out both",
        }}
      >
        <div
          style={{
            fontSize: 96,
            filter: "drop-shadow(0 0 24px rgba(211,23,48,0.9))",
            animation: reduced ? undefined : "hz-shake 500ms ease-in-out both",
          }}
        >
          👹
        </div>
        <div
          style={{
            position: "absolute",
            bottom: "18%",
            color: "#efe8f2",
            fontWeight: 800,
            letterSpacing: 2,
            textTransform: "uppercase",
            fontSize: 14,
          }}
        >
          {t("Jumpscare!")}
        </div>
      </div>
    );
  }

  if (visible.kind === "death") {
    return (
      <div
        className="horror-death"
        aria-hidden="true"
        style={{
          position: "fixed",
          inset: 0,
          zIndex: 60,
          pointerEvents: "none",
          display: "grid",
          placeItems: "center",
          background: "rgba(40,0,0,0.92)",
          animation: reduced ? undefined : "hz-damage-vignette 1800ms ease-out both",
        }}
      >
        <div
          style={{
            color: "#ff2d55",
            fontSize: 40,
            fontWeight: 900,
            letterSpacing: 4,
            textTransform: "uppercase",
          }}
        >
          {t("You died")}
        </div>
      </div>
    );
  }

  if (visible.kind === "heal") {
    return (
      <div
        className="horror-heal-flash"
        aria-hidden="true"
        style={{
          position: "fixed",
          inset: 0,
          zIndex: 55,
          pointerEvents: "none",
          background:
            "radial-gradient(circle at 50% 50%, rgba(56,224,122,0.35), rgba(56,224,122,0) 70%)",
          animation: reduced ? undefined : "hz-heal-flash 700ms ease-out both",
        }}
      />
    );
  }

  // damage / crit — a red vignette pulse sized to the hit.
  const rgb = visible.kind === "crit" ? "255,45,85" : "211,23,48";
  return (
    <div
      className="horror-damage-vignette"
      aria-hidden="true"
      style={{
        position: "fixed",
        inset: 0,
        zIndex: 55,
        pointerEvents: "none",
        boxShadow: `inset 0 0 ${Math.round(60 + amount / 20)}px ${Math.round(
          20 + amount / 40,
        )}px rgba(${rgb},${vignette})`,
        animation: reduced ? undefined : "hz-damage-vignette 650ms ease-out both",
      }}
    />
  );
}
