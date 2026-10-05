"use client";

import type { PublicState } from "@/shared/types";
import { formatDistance } from "@/shared/scoring";
import { emojiUrl } from "@/shared/emojis";
import MapPicker, { type MapLine, type MapMarker } from "./MapPicker";

const PALETTE = [
  "#4a5d2f", "#9a3324", "#c8843d", "#3a5a6e", "#7d5a3a", "#5e7540",
  "#a8553d", "#2f4858", "#b8862f", "#6b4226", "#436b56", "#8c3d2e",
];

interface Props {
  state: PublicState;
  onNext: () => void;
}

export default function ResultsPhase(props: Props) {
  const state = props.state;
  const onNext = props.onNext;
  const result = state.result;
  const isLast = state.currentRound + 1 >= state.totalRounds;

  if (!result) {
    return (
      <div className="center-screen">
        <p className="muted">Tallying the round…</p>
      </div>
    );
  }

  function colorFor(i: number): string {
    return PALETTE[i % PALETTE.length];
  }

  const markers: MapMarker[] = [
    {
      lat: result.real.lat,
      lng: result.real.lng,
      icon: state.solo ? undefined : result.targetEmoji,
      size: 54,
      title: state.solo ? "The real spot" : result.targetName + "'s real hiding spot",
    },
  ];

  for (let i = 0; i < result.guesses.length; i++) {
    const g = result.guesses[i];
    markers.push({
      lat: g.lat,
      lng: g.lng,
      icon: g.emoji,
      title: g.name + " · " + formatDistance(g.distanceKm) + " · " + g.points + " pts",
    });
  }

  const lines: MapLine[] = [];
  for (let i = 0; i < result.guesses.length; i++) {
    const g = result.guesses[i];
    lines.push({
      from: { lat: g.lat, lng: g.lng },
      to: result.real,
      color: colorFor(i),
    });
  }

  return (
    <div className="full-bleed">
      <div className="split">
        <div style={{ position: "relative", width: "100%", height: "100%" }}>
          <div className="overlay-top">
            {!state.solo && (
              <span className="roster-avatar" aria-hidden="true">
                <img className="emoji-img" src={emojiUrl(result.targetEmoji)} alt="" />
              </span>
            )}
            <span>
              {state.solo ? (
                <>This was the spot 📍</>
              ) : (
                <>
                  <strong>{result.targetName}</strong> was hiding here 📍
                </>
              )}
            </span>
          </div>
          <MapPicker markers={markers} lines={lines} fitToContent />
        </div>
        <div
          style={{
            padding: 24,
            overflowY: "auto",
            background: "var(--bg)",
            display: "flex",
            flexDirection: "column",
            gap: 16,
          }}
        >
          <div className="stack" style={{ gap: 4 }}>
            <span className="muted">
              Round {state.currentRound + 1} of {state.totalRounds}
            </span>
            <h2 className="title" style={{ fontSize: 22 }}>
              This round's guesses
            </h2>
          </div>

          <div className="stack" style={{ gap: 8 }}>
            {result.guesses.map(function (g) {
              return (
                <div key={g.playerId} className="player-row">
                  <div className="row" style={{ gap: 8 }}>
                    <span className="roster-avatar" aria-hidden="true">
                      <img className="emoji-img" src={emojiUrl(g.emoji)} alt="" />
                    </span>
                    <strong>{g.name}</strong>
                    <span className="muted">{formatDistance(g.distanceKm)}</span>
                  </div>
                  <strong>+{g.points.toLocaleString()}</strong>
                </div>
              );
            })}
          </div>

          <div className="stack" style={{ gap: 8 }}>
            <strong className="muted">Standings</strong>
            {state.players.map(function (p) {
              return (
                <div key={p.id} className="player-row">
                  <div className="row" style={{ gap: 8 }}>
                    <span className="roster-avatar" aria-hidden="true">
                      <img className="emoji-img" src={emojiUrl(p.emoji)} alt="" />
                    </span>
                    <span>
                      {p.name}
                      {p.id === state.youId && <span className="badge">you</span>}
                    </span>
                  </div>
                  <strong>{p.totalScore.toLocaleString()}</strong>
                </div>
              );
            })}
          </div>

          {state.youAreGameMaster ? (
            <button type="button" onClick={onNext}>
              {isLast ? "See final scores" : "Next round"}
            </button>
          ) : (
            <p className="muted">Waiting for the host to continue…</p>
          )}
        </div>
      </div>
    </div>
  );
}