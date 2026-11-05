"use client";

import { useEffect, useRef, useState } from "react";
import { playTimeTickSfx } from "@/lib/sfx";

interface Props {
  seconds: number;
  capSeconds?: number | null;
  /**
   * Server-authoritative deadline (ms since epoch). When set, the countdown is
   * derived from the wall clock instead of a locally-started interval, so a
   * refresh, a background tab, or a slow render cannot desync the timer from
   * the server. `seconds` is then only used to decide whether to render at all.
   */
  deadlineAt?: number | null;
  onExpire?: () => void;
}

function secondsUntil(deadlineAt: number): number {
  return Math.max(0, Math.ceil((deadlineAt - Date.now()) / 1000));
}

export default function Timer(props: Props) {
  const initialSeconds = props.seconds;
  const capSeconds = props.capSeconds;
  const deadlineAt = props.deadlineAt ?? null;
  const onExpire = props.onExpire;
  const expiredRef = useRef(false);
  const onExpireRef = useRef(onExpire);
  onExpireRef.current = onExpire;

  const getEffectiveInitial = (base: number, cap?: number | null) => {
    if (base > 0) {
      return cap != null ? Math.min(base, cap) : base;
    }
    return cap != null && cap > 0 ? cap : 0;
  };

  const [timeLeft, setTimeLeft] = useState<number>(() =>
    deadlineAt != null
      ? secondsUntil(deadlineAt)
      : getEffectiveInitial(initialSeconds, capSeconds),
  );

  // A new deadline means a new phase: reset the expiry latch so the next
  // countdown can fire its own onExpire.
  useEffect(
    function () {
      expiredRef.current = false;
      if (deadlineAt != null) {
        setTimeLeft(secondsUntil(deadlineAt));
        return;
      }
      setTimeLeft(getEffectiveInitial(initialSeconds, capSeconds));
    },
    [initialSeconds, deadlineAt],
  );

  useEffect(
    function () {
      if (capSeconds != null) {
        setTimeLeft(function (prev) {
          if (prev <= 0 && initialSeconds <= 0 && capSeconds > 0) {
            expiredRef.current = false;
            return capSeconds;
          }
          if (capSeconds < prev) {
            return capSeconds;
          }
          return prev;
        });
      }
    },
    [capSeconds, initialSeconds],
  );

  // Server-clock mode: recompute from the deadline every tick. The server also
  // advances the phase on its own, so onExpire here is only a local courtesy
  // (e.g. auto-submitting the current pin) and never the source of truth.
  useEffect(
    function () {
      if (deadlineAt == null) return;
      const interval = setInterval(function () {
        setTimeLeft(secondsUntil(deadlineAt));
      }, 250);
      return function () {
        clearInterval(interval);
      };
    },
    [deadlineAt],
  );

  useEffect(
    function () {
      if (timeLeft <= 0) {
        if (!expiredRef.current) {
          expiredRef.current = true;
          if (onExpireRef.current) onExpireRef.current();
        }
        return;
      }

      // Local countdown, used only when the server sent no deadline.
      if (deadlineAt != null) return;

      const interval = setInterval(function () {
        setTimeLeft(function (prev) {
          if (prev <= 1) {
            return 0;
          }
          return prev - 1;
        });
      }, 1000);

      return function () {
        clearInterval(interval);
      };
    },
    [timeLeft, deadlineAt],
  );

  useEffect(
    function () {
      if (timeLeft <= 0 || timeLeft > 15) return;
      playTimeTickSfx(timeLeft <= 5);
    },
    [timeLeft],
  );

  if (deadlineAt == null && initialSeconds <= 0 && (!capSeconds || capSeconds <= 0)) {
    return null;
  }

  const mins = Math.floor(timeLeft / 60);
  const secs = timeLeft % 60;
  const formattedSecs = secs < 10 ? "0" + secs : secs;
  const isWarning = timeLeft <= 15;
  const isCritical = timeLeft <= 15 && timeLeft > 0;

  return (
    <>
      <div className={`timer-badge${isWarning ? " warning" : ""}`}>
        ⏱️ {mins}:{formattedSecs}
      </div>
      {isCritical && <div className="time-critical-flash" aria-hidden="true" />}
    </>
  );
}
