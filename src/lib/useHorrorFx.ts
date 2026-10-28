"use client";

// HorrorGuessr — the transient visual-effect queue (P7, §4.2, §6.6).
//
// A tiny event bus for one-shot effects. The play shell calls `fire(kind)` after
// an action resolves; `HorrorJumpscare` renders whatever the latest event is and
// clears itself. Each event carries a monotonic id so two identical effects in a
// row still re-trigger the animation.

import { useCallback, useRef, useState } from "react";
import type { HorrorFxEvent, HorrorFxKind } from "@/components/horror/HorrorJumpscare";

export interface HorrorFxController {
  /** The most recent effect, or null. */
  event: HorrorFxEvent | null;
  /** Emit an effect. `amount` sizes the damage vignette. */
  fire: (kind: HorrorFxKind, amount?: number) => void;
  /** Clear the current effect early. */
  clear: () => void;
}

export function useHorrorFx(): HorrorFxController {
  const [event, setEvent] = useState<HorrorFxEvent | null>(null);
  const idRef = useRef(0);

  const fire = useCallback((kind: HorrorFxKind, amount?: number) => {
    idRef.current += 1;
    setEvent({ id: idRef.current, kind, amount });
  }, []);

  const clear = useCallback(() => setEvent(null), []);

  return { event, fire, clear };
}
