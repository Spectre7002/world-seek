"use client";

import { useEffect } from "react";
import { playSfx, preloadSfx } from "@/lib/sfx";

const CLICK_SRC = "/click-2.mp3";

/**
 * Global UI click sound. Delegates from a single document listener instead of
 * wiring an onClick into every button, so new buttons get it for free.
 *
 * Uses pointerdown rather than click: click only fires once the browser has
 * resolved the full tap gesture (touchstart -> touchend), which lags visibly
 * behind finger-down on mobile. pointerdown fires immediately on press, same
 * as a mouse press does on desktop, so the sound feels equally instant on
 * both. Still counts as a user gesture, so it isn't blocked by autoplay
 * restrictions.
 */
export default function ClickSound() {
  useEffect(() => {
    preloadSfx(CLICK_SRC);

    function onPointerDown(e: PointerEvent) {
      if (e.button !== 0) return; // left click / primary touch only
      const target = e.target as HTMLElement | null;
      if (!target?.closest("button, [role='button']")) return;
      playSfx(CLICK_SRC);
    }

    document.addEventListener("pointerdown", onPointerDown, { passive: true });
    return () => document.removeEventListener("pointerdown", onPointerDown);
  }, []);

  return null;
}
