"use client";

// HorrorGuessr — `prefers-reduced-motion` as React state (§6.6).
//
// Every animated effect in P7 is gated on this. It defaults to `false` on the
// server and on the first client render, then syncs to the media query in an
// effect, so there is no hydration mismatch.

import { useEffect, useState } from "react";

export function useReducedMotion(): boolean {
  const [reduced, setReduced] = useState(false);

  useEffect(() => {
    if (typeof window === "undefined" || typeof window.matchMedia !== "function") {
      return;
    }
    const query = window.matchMedia("(prefers-reduced-motion: reduce)");
    setReduced(query.matches);
    const onChange = () => setReduced(query.matches);
    query.addEventListener?.("change", onChange);
    return () => query.removeEventListener?.("change", onChange);
  }, []);

  return reduced;
}
