"use client";

import type { PublicPlayer } from "@/shared/types";
import { emojiUrl } from "@/shared/emojis";

interface Props {
  players: PublicPlayer[];
  showScore?: boolean;
  showHidden?: boolean;
  hiddenLabel?: string;
  speakingIds?: Set<string>;
}

export default function PlayerList({
  players,
  showScore,
  showHidden,
  hiddenLabel = "ready",
  speakingIds,
}: Props) {
  return (
    <div
      className="stack"
      style={{ gap: 8, maxHeight: "50vh", overflowY: "auto" }}
    >
      {players.map((p) => (
        <div key={p.id} className="player-row">
          <div className="row" style={{ gap: 8 }}>
            <span
              className={`roster-avatar${speakingIds?.has(p.id) ? " is-speaking" : ""}`}
              aria-hidden="true"
            >
              <img className="emoji-img" src={emojiUrl(p.emoji)} alt="" />
            </span>
            <strong>{p.name}</strong>
            {p.isGameMaster && <span className="badge">host</span>}
            {!p.connected && <span className="badge off">offline</span>}
          </div>
          <div className="row" style={{ gap: 8 }}>
            {showHidden && (
              <span className={`badge ${p.hasHidden ? "good" : ""}`}>
                {p.hasHidden ? hiddenLabel : "…"}
              </span>
            )}
            {showScore && (
              <strong style={{ fontVariantNumeric: "tabular-nums" }}>
                {p.totalScore.toLocaleString()}
              </strong>
            )}
          </div>
        </div>
      ))}
    </div>
  );
}
