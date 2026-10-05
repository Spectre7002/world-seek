"use client";

import { useEffect, useRef } from "react";
import { emojiUrl } from "@/shared/emojis";

const BUFFER = 128;

export default function EmojiStill(props: {
  emoji: string;
  className?: string;
}) {
  const emoji = props.emoji;
  const className = props.className;
  const ref = useRef<HTMLCanvasElement>(null);

  useEffect(
    function () {
      const canvas = ref.current;
      if (!canvas) return;
      let cancelled = false;
      const img = new Image();
      img.onload = function () {
        if (cancelled) return;
        const ctx = canvas.getContext("2d");
        if (!ctx) return;
        const scale = Math.min(
          BUFFER / img.naturalWidth,
          BUFFER / img.naturalHeight
        );
        const w = img.naturalWidth * scale;
        const h = img.naturalHeight * scale;
        ctx.clearRect(0, 0, BUFFER, BUFFER);
        ctx.drawImage(img, (BUFFER - w) / 2, (BUFFER - h) / 2, w, h);
      };
      img.src = emojiUrl(emoji);
      return function () {
        cancelled = true;
      };
    },
    [emoji]
  );

  return (
    <canvas
      ref={ref}
      width={BUFFER}
      height={BUFFER}
      className={className}
      style={{
        width: "32px",
        height: "32px",
        maxWidth: "32px",
        maxHeight: "32px",
        display: "block",
        objectFit: "contain",
      }}
      aria-hidden="true"
    />
  );
}