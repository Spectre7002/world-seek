"use client";

import Link from "next/link";
import type { PublicState } from "@/shared/types";
import { emojiUrl } from "@/shared/emojis";
import RoundHistory from "./RoundHistory";
import { useLanguage } from "@/lib/language";

interface Props {
  state: PublicState;
  onReturnToLobby: () => void;
  /** Host only: restart immediately with the same players and settings. */
  onRematch?: () => void;
}

const MEDALS = ["🥇", "🥈", "🥉"];

export default function FinalScores(props: Props) {
  const { t } = useLanguage();
  const state = props.state;
  const onReturnToLobby = props.onReturnToLobby;
  const onRematch = props.onRematch;

  const isHpMode = state.settings.gameMode === "hp";
  // Spectators never played, so they must not appear in the standings.
  const seated = state.players.filter((p) => !p.spectator);
  // HP matches are decided by remaining health, not by points. The server sorts
  // `players` by totalScore, so re-sort here or the "winner" is just whoever
  // scored most while being eliminated.
  const ranked = isHpMode
    ? [...seated].sort(
        (a, b) =>
          b.hp - a.hp ||
          (b.guessMultiplier ?? 1) - (a.guessMultiplier ?? 1) ||
          b.totalScore - a.totalScore,
      )
    : seated;
  const topScore = ranked[0] ? ranked[0].totalScore : 0;
  const winners = [];
  for (let i = 0; i < ranked.length; i++) {
    if (ranked[i].totalScore === topScore && topScore > 0) {
      winners.push(ranked[i]);
    }
  }

  let winnerText = "";
  if (isHpMode) {
    const winner = ranked[0];
    winnerText = winner
      ? t("Winner: {name}").replace("{name}", winner.name)
      : t("Game over");
  } else if (state.solo) {
    // `solo` is now a genuine single-player game only; HP matches have a winner
    // and are handled by the branch above.
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
                  {state.settings.gameMode === "hp"
                    ? `❤ ${p.hp.toLocaleString()} · ${(p.guessMultiplier ?? 1).toFixed(1)}x`
                    : p.totalScore.toLocaleString()}
                </strong>
              </div>
            );
          })}
        </div>

        <RoundHistory state={state} />

        <div className="row" style={{ gap: 10 }}>
          {state.youAreGameMaster ? (
            <>
              {onRematch && (
                <button type="button" onClick={onRematch} style={{ flex: 1 }}>
                  🔁 {t("Rematch")}
                </button>
              )}
              <button
                type="button"
                className="secondary"
                onClick={onReturnToLobby}
                style={{ flex: 1 }}
              >
                {t("Back to lobby")}
              </button>
            </>
          ) : (
            <p className="muted" style={{ flex: 1 }}>
              {t("Waiting for the host to return to the lobby...")}
            </p>
          )}
          <Link className="secondary" href="/stats" style={{ textDecoration: "none" }}>
            {t("Stats")}
          </Link>
        </div>
      </div>
    </div>
  );
}