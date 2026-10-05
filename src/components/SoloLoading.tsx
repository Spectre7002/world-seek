"use client";

import { useEffect, useState } from "react";
import type { HidingSpot } from "@/shared/types";
import { generateSoloTarget } from "@/lib/soloLocation";

interface Props {
  /** Send the resolved location up to the server to seed this solo round. */
  onTarget: (spot: HidingSpot) => void;
}

/**
 * Solo finding starts with no location: the browser is the only thing that can
 * reach Google Street View, so it generates a covered random spot here, then hands
 * the panoId to the server. Mounted per-round (keyed on currentRound), so it runs
 * once and unmounts as soon as the server echoes back a currentTarget.
 */
export default function SoloLoading({ onTarget }: Props) {
  const [error, setError] = useState(false);
  const [attempt, setAttempt] = useState(0);

  useEffect(() => {
    let cancelled = false;
    setError(false);
    generateSoloTarget()
      .then((spot) => {
        if (!cancelled) onTarget(spot);
      })
      .catch(() => {
        if (!cancelled) setError(true);
      });
    return () => {
      cancelled = true;
    };
  }, [onTarget, attempt]);

  return (
    <div className="center-screen">
      <div className="stack" style={{ width: 420, gap: 18, textAlign: "center" }}>
        {error ? (
          <>
            <h1 className="title">Couldn't find a spot 😕</h1>
            <p className="muted" style={{ margin: 0 }}>
              Street View didn't answer. Give it another try.
            </p>
            <button onClick={() => setAttempt((a) => a + 1)}>Try again</button>
          </>
        ) : (
          <>
            <h1 className="title">Finding a location… 🌍</h1>
            <p className="muted" style={{ margin: 0 }}>
              Dropping you somewhere in the world.
            </p>
          </>
        )}
      </div>
    </div>
  );
}
