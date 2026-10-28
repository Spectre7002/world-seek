"use client";

// HorrorGuessr — the day-modifier visual layer (P7, §4.4, §4.5, §6.6).
//
// One wrapper that owns every modifier-driven pixel effect, so the play shell
// stays a plain composition:
//
//   - **Shadow Realm** (§4.5): a CSS `filter` on the panorama plus a blue tint
//     with `mix-blend-mode: color`, producing the "monochrome blue" the plan
//     describes. Colour-based clues are erased by construction.
//   - **Lights Out** (§4.4): a pointer-tracked radial mask over the panorama —
//     the "flashlight" — implemented as a radial-gradient background so it needs
//     no `mask-image` browser quirks. `Torch` deletes the whole modifier.
//   - **Dark Panorama** (§4.4): a permanent dim, a *different* modifier from
//     Lights Out. `Beer Goggles` deletes it.
//
// The layer is `pointer-events: none` throughout, so it can never intercept the
// click that confirms a guess (§4.2: "never trap the player"). The HUD is a
// sibling, not a child, so the health bar and timer stay visible during Lights
// Out (§4.2). All motion is gated by `prefers-reduced-motion` (§6.6).

import { useEffect, useRef } from "react";
import type { ReactNode } from "react";
import type { HorrorDayModifier } from "@/shared/horrorTypes";

interface Props {
  /** The day's modifier, from `run.dayModifier` / `run.daySpec.modifier`. */
  modifier: string;
  /** Modifiers deleted by an equipped item (`Torch`, `Beer Goggles`). */
  bypassed?: string[];
  /** Honours `prefers-reduced-motion` (§6.6). */
  reducedMotion?: boolean;
  children: ReactNode;
}

// Monochrome blue: strip colour, then tint. `grayscale` removes the hue, the
// tint layer re-introduces exactly one.
const SHADOW_REALM_FILTER = "grayscale(1) brightness(0.82) contrast(1.15)";
// A permanently dimmed panorama — dimmer than Shadow Realm, but still coloured.
const DARK_PANO_FILTER = "brightness(0.45) contrast(1.05)";

export default function HorrorDayModifiers(props: Props) {
  const overlayRef = useRef<HTMLDivElement | null>(null);
  const modifier = props.modifier as HorrorDayModifier;
  const bypassed = props.bypassed ?? [];
  // A bypassed modifier is treated as `none` for every visual purpose.
  const active: HorrorDayModifier = bypassed.includes(modifier) ? "none" : modifier;

  // Pointer-tracked flashlight beam for Lights Out (§4.4). The beam position is
  // written straight to CSS custom properties on the overlay element rather than
  // through React state, so a fast pointer never triggers a re-render storm.
  useEffect(() => {
    if (active !== "lightsOut") return;
    const el = overlayRef.current;
    if (!el) return;
    const onMove = (event: PointerEvent) => {
      el.style.setProperty("--fx-x", `${event.clientX}px`);
      el.style.setProperty("--fx-y", `${event.clientY}px`);
    };
    window.addEventListener("pointermove", onMove, { passive: true });
    return () => window.removeEventListener("pointermove", onMove);
  }, [active]);

  const panoFilter =
    active === "shadowRealm"
      ? SHADOW_REALM_FILTER
      : active === "darkPano"
        ? DARK_PANO_FILTER
        : undefined;

  return (
    <div
      className="horror-pano-layer"
      data-modifier={active}
      style={{
        position: "absolute",
        inset: 0,
        filter: panoFilter,
        transition: props.reducedMotion ? undefined : "filter 400ms ease",
      }}
    >
      {props.children}

      {/* Shadow Realm: monochrome-blue tint + a slow fog drift for distortion. */}
      {active === "shadowRealm" && (
        <>
          <div
            className="horror-shadow-realm-tint"
            aria-hidden="true"
            style={{
              position: "absolute",
              inset: 0,
              zIndex: 4,
              pointerEvents: "none",
              background:
                "linear-gradient(180deg, rgba(27,47,107,0.55), rgba(10,14,40,0.78))",
              mixBlendMode: "color",
            }}
          />
          <div
            className="horror-fog"
            aria-hidden="true"
            style={{
              position: "absolute",
              inset: "-10%",
              zIndex: 4,
              pointerEvents: "none",
              opacity: 0.35,
              background:
                "radial-gradient(circle at 30% 40%, rgba(120,150,255,0.18), transparent 55%), radial-gradient(circle at 70% 65%, rgba(60,90,200,0.16), transparent 60%)",
              animation: props.reducedMotion ? undefined : "hz-fog-drift 70s ease-in-out infinite",
            }}
          />
        </>
      )}

      {/* Lights Out: the flashlight. Black everywhere except a soft hole at the
          pointer. `Torch` never reaches here — it is filtered out above. */}
      {active === "lightsOut" && (
        <div
          ref={overlayRef}
          className="horror-lights-out"
          aria-hidden="true"
          style={{
            position: "absolute",
            inset: 0,
            zIndex: 5,
            pointerEvents: "none",
            background:
              "radial-gradient(circle 150px at var(--fx-x, 50%) var(--fx-y, 50%), rgba(0,0,0,0) 0%, rgba(0,0,0,0.35) 40%, rgba(0,0,0,0.9) 70%, #000 100%)",
          }}
        />
      )}
    </div>
  );
}
