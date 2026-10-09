"use client";

import type { PublicState } from "@/shared/types";
import { emojiUrl } from "@/shared/emojis";
import { useLanguage } from "@/lib/language";

interface Props {
  state: PublicState;
  onReturnToLobby: () => void;
}

const MEDALS = ["🥇", "🥈", "🥉"];

export default function FinalScores(props: Props) {
  const { t } = useLanguage();
  const state = props.state;
  const onReturnToLobby = props.onReturnToLobby;

  const ranked = state.players;
  const topScore = ranked[0] ? ranked[0].totalScore : 0;
  const winners = [];
  for (let i = 0; i < ranked.length; i++) {
    if (ranked[i].totalScore === topScore && topScore > 0) {
      winners.push(ranked[i]);
    }
  }

  let winnerText = "";
  if (state.solo) {
    winnerText = t("You scored {score} points").replace("{score}", topScore.toLocaleString());
  } else if (winners.length === 1) {
    winnerText = t("Winner: {name}").replace("{name}", winners[0].name);
  } else {
    const winnerNames = [];
    for (let i = 0; i < winners.length; i++) {
      winnerNames.push(winners[i].name);
    }
    winnerText = t("It's a tie: {names}").replace("{names}", winnerNames.join(", "));
  }

  return (
    <div className="center-screen">
      <div className="stack" style={{ width: 460, gap: 20 }}>
        <div className="stack" style={{ gap: 4 }}>
          <h1 className="title" style={{ fontSize: 34 }}>
            🏆 {t("Game over")}
          </h1>
          <p className="muted" style={{ margin: 0 }}>
            {winnerText}
          </p>
        </div>

        <div className="card stack" style={{ gap: 10 }}>
          {ranked.map(function (p, i) {
            return (
              <div key={p.id} className="player-row">
                <div className="row" style={{ gap: 10 }}>
                  <span style={{ width: 24, fontWeight: "bold" }}>
                    {MEDALS[i] || i + 1 + "."}
                  </span>
                  <span className="roster-avatar" aria-hidden="true">
                    <img className="emoji-img" src={emojiUrl(p.emoji)} alt="" />
                  </span>
                  <strong>{p.name}</strong>
                  {p.id === state.youId && <span className="badge">{t("you")}</span>}
                </div>
                <strong style={{ fontVariantNumeric: "tabular-nums" }}>
                  {p.totalScore.toLocaleString()}
                </strong>
              </div>
            );
          })}
        </div>

        {state.youAreGameMaster ? (
          <button type="button" onClick={onReturnToLobby}>
            {t("Back to lobby")}
          </button>
        ) : (
          <p className="muted">{t("Waiting for the host to return to the lobby…")}</p>
        )}
      </div>
    </div>
  );
}