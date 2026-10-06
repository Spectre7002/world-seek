"use client";

import { useEffect, useRef, useState } from "react";
import { playTimeTickSfx } from "@/lib/sfx";

interface Props {
  seconds: number;
  onExpire?: () => void;
}

export default function Timer(props: Props) {
  const initialSeconds = props.seconds;
  const onExpire = props.onExpire;
  const expiredRef = useRef(false);
  const onExpireRef = useRef(onExpire);
  onExpireRef.current = onExpire;

  const [timeLeft, setTimeLeft] = useState<number>(initialSeconds);

  useEffect(
    function () {
      expiredRef.current = false;
      setTimeLeft(initialSeconds);
    },
    [initialSeconds]
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
    [timeLeft]
  );

  useEffect(
    function () {
      if (timeLeft <= 0 || timeLeft > 15) return;
      playTimeTickSfx(timeLeft <= 5);
    },
    [timeLeft]
  );

  if (initialSeconds <= 0) {
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
