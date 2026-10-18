"use client";

import { useEffect, useRef, useState } from "react";
import { playTimeTickSfx } from "@/lib/sfx";

interface Props {
  seconds: number;
  capSeconds?: number | null;
  onExpire?: () => void;
}

export default function Timer(props: Props) {
  const initialSeconds = props.seconds;
  const capSeconds = props.capSeconds;
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
    getEffectiveInitial(initialSeconds, capSeconds),
  );

  useEffect(
    function () {
      expiredRef.current = false;
      setTimeLeft(getEffectiveInitial(initialSeconds, capSeconds));
    },
    [initialSeconds],
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

  useEffect(
    function () {
      if (timeLeft <= 0) {
        if (!expiredRef.current) {
          expiredRef.current = true;
          if (onExpireRef.current) onExpireRef.current();
        }
        return;
      }

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
    [timeLeft],
  );

  useEffect(
    function () {
      if (timeLeft <= 0 || timeLeft > 15) return;
      playTimeTickSfx(timeLeft <= 5);
    },
    [timeLeft],
  );

  if (initialSeconds <= 0 && (!capSeconds || capSeconds <= 0)) {
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
