"use client";

import { useState } from "react";
import type { Reaction } from "@/shared/types";
import { REACTIONS } from "@/shared/types";
import { emojiUrl } from "@/shared/emojis";
import { useLanguage } from "@/lib/language";

interface Props {
  reactions: Reaction[];
  onSend: (reaction: string) => void;
}

/**
 * Quick reactions: a small palette plus the bursts currently on screen.
 *
 * The palette is collapsed behind one button so it does not compete with the
 * guess map for space. Bursts float up and fade out; they are positioned by
 * index rather than randomly so the layout is stable across re-renders (a
 * random offset would jump every time a new burst arrived).
 */
export default function ReactionBar({ reactions, onSend }: Props) {
  const { t } = useLanguage();
  const [open, setOpen] = useState(false);

  function pick(glyph: string) {
    onSend(glyph);
    setOpen(false);
  }

  return (
    <>
      <div className="reaction-bursts" aria-live="polite" aria-atomic="false">
        {reactions.map((r, i) => (
          <div
            key={r.id}
            className="reaction-burst"
            style={{ ["--burst-index" as string]: i % 6 }}
          >
            <span className="reaction-burst-glyph">{r.reaction}</span>
            <span className="reaction-burst-name">
              <img className="emoji-img" src={emojiUrl(r.emoji)} alt="" />
              {r.name}
            </span>
          </div>
        ))}
      </div>

      <div className="reaction-bar">
        {open && (
          <div className="reaction-palette" role="group" aria-label={t("Reactions")}>
            {REACTIONS.map((glyph) => (
              <button
                key={glyph}
                type="button"
                className="reaction-pick"
                onClick={() => pick(glyph)}
                aria-label={glyph}
              >
                {glyph}
              </button>
            ))}
          </div>
        )}
        <button
          type="button"
          className="secondary reaction-toggle"
          onClick={() => setOpen((o) => !o)}
          aria-label={t("Reactions")}
          aria-expanded={open}
        >
          😀
        </button>
      </div>
    </>
  );
}
