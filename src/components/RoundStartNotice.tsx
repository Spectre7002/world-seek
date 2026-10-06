"use client";

import { useEffect, useRef, useState } from "react";
import { playRoundStartSfx } from "@/lib/sfx";

export default function RoundStartNotice(props: { round: number }) {
  const [visible, setVisible] = useState(true);
  const soundPlayed = useRef(false);

  useEffect(function () {
    if (!soundPlayed.current) {
      soundPlayed.current = true;
      playRoundStartSfx();
    }
    const timeout = setTimeout(function () {
      setVisible(false);
    }, 2400);
    return function () {
      clearTimeout(timeout);
    };
  }, []);

  if (!visible) return null;

  return (
    <div className="round-start-notice" role="status">
      Раунд {props.round} розпочато!
    </div>
  );
}
