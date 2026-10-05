"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import type { LatLng, PublicPlayer, PublicState } from "@/shared/types";
import { emojiUrl } from "@/shared/emojis";
import MapPicker, { type MapMarker } from "./MapPicker";
import StreetView from "./StreetView";
import PlayerList from "./PlayerList";
import WaitingBar from "./WaitingBar";
import Timer from "./Timer";

interface Props {
  state: PublicState;
  onGuess: (at: LatLng) => void;
  onPreview: (at: LatLng) => void;
}

const PREVIEW_THROTTLE_MS = 100;
const TENTATIVE_OPACITY = 0.4;

export default function FindingPhase(props: Props) {
  const state = props.state;
  const onGuess = props.onGuess;
  const onPreview = props.onPreview;

  const [guess, setGuess] = useState<LatLng | null>(null);
  const roundLabel = "Round " + (state.currentRound + 1) + " of " + state.totalRounds;

  const lastSent = useRef(0);
  const trailing = useRef<ReturnType<typeof setTimeout> | null>(null);
  const onPreviewRef = useRef(onPreview);
  onPreviewRef.current = onPreview;

  useEffect(
    function () {
      return function () {
        if (trailing.current) clearTimeout(trailing.current);
      };
    },
    []
  );

  useEffect(
    function () {
      setGuess(null);
      if (trailing.current) clearTimeout(trailing.current);
    },
    [state.currentRound]
  );

  const sendPreview = useCallback(
    function (at: LatLng) {
      const wait = PREVIEW_THROTTLE_MS - (Date.now() - lastSent.current);
      if (wait <= 0) {
        lastSent.current = Date.now();
        onPreviewRef.current(at);
      } else {
        if (trailing.current) clearTimeout(trailing.current);
        trailing.current = setTimeout(function () {
          lastSent.current = Date.now();
          onPreviewRef.current(at);
        }, wait);
      }
    },
    []
  );

  const liveMarkers: MapMarker[] = [];
  for (let i = 0; i < state.livePins.length; i++) {
    const g = state.livePins[i];
    liveMarkers.push({
      id: g.playerId,
      lat: g.lat,
      lng: g.lng,
      icon: g.emoji,
      opacity: g.confirmed ? 1 : TENTATIVE_OPACITY,
      title: g.name,
    });
  }

  if (state.youAreTarget) {
    return (
      <WatchView
        roundLabel={roundLabel}
        title="Everyone's hunting for you 🔎"
        emptyHint="Sit tight while the others guess your hiding spot."
        markers={liveMarkers}
        current={state.guessedCount}
        total={state.expectedGuessers}
      />
    );
  }

  if (state.youHaveGuessed) {
    return (
      <WatchView
        roundLabel={roundLabel}
        title="Guess locked in ✅"
        emptyHint="Waiting for the other hunters to lock in."
        markers={liveMarkers}
        current={state.guessedCount}
        total={state.expectedGuessers}
        players={state.players}
      />
    );
  }

  function handleChange(p: LatLng) {
    setGuess(p);
    sendPreview(p);
  }

  function handleDrag(p: LatLng) {
    sendPreview(p);
  }

  function handleConfirmGuess() {
    if (guess) {
      onGuess(guess);
    }
  }

  function handleTimeUp() {
    if (guess) {
      onGuess(guess);
    } else {
      onGuess({ lat: 0, lng: 0 });
    }
  }

  const findingTime = state.settings.findingTimeLimit || 0;

  return (
    <div className="full-bleed">
      <div className="split">
        <div style={{ position: "relative", background: "#000", width: "100%", height: "100%" }}>
          <div className="overlay-top overlay-top--emoji">
            {state.solo ? (
              <span>
                Where in the world is this? 🌍 ({roundLabel})
              </span>
            ) : (
              <>
                {state.currentTarget && (
                  <span className="emoji-inline" aria-hidden="true">
                    <img
                      className="emoji-img"
                      src={emojiUrl(state.currentTarget.emoji)}
                      alt=""
                    />
                  </span>
                )}
                <span>
                  Where is <strong>{state.currentTarget ? state.currentTarget.name : "player"}</strong> hiding?
                </span>
              </>
            )}
          </div>
          <StreetView mode="pano" panoId={state.currentTarget ? state.currentTarget.panoId : undefined} />
        </div>

        <div style={{ position: "relative", width: "100%", height: "100%" }}>
          <div className="overlay-top">
            <span>{roundLabel} · drop your guess</span>
            {findingTime > 0 && <Timer seconds={findingTime} onExpire={handleTimeUp} />}
          </div>
          <MapPicker
            value={guess}
            onChange={handleChange}
            onDrag={handleDrag}
            markerIcon={state.youEmoji}
            resetViewKey={state.currentRound}
          />
        </div>
      </div>

      <div className="overlay-bar">
        {!guess && <span className="muted">Click the map to place your guess.</span>}
        {guess && <span className="muted">Lock it in?</span>}
        <button
          type="button"
          onClick={handleConfirmGuess}
          disabled={!guess}
        >
          Guess here
        </button>
      </div>
    </div>
  );
}

function WatchView(props: {
  roundLabel: string;
  title: string;
  emptyHint: string;
  markers: MapMarker[];
  current: number;
  total: number;
  players?: PublicPlayer[];
}) {
  const roundLabel = props.roundLabel;
  const title = props.title;
  const emptyHint = props.emptyHint;
  const markers = props.markers;
  const current = props.current;
  const total = props.total;
  const players = props.players;

  if (markers.length === 0) {
    return (
      <div className="center-screen">
        <div className="stack" style={{ width: 420, gap: 18 }}>
          <span className="muted">{roundLabel}</span>
          <h1 className="title">{title}</h1>
          <p className="muted" style={{ margin: 0 }}>
            {emptyHint}
          </p>
          <div className="card stack">
            <WaitingBar label="Guesses in" current={current} total={total} />
            {players && <PlayerList players={players} />}
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="full-bleed">
      <div className="map-wrap">
        <div className="overlay-top">
          <strong>{title}</strong>
          <div className="muted" style={{ fontSize: 14, marginTop: 2 }}>
            {roundLabel} · pins glow solid when locked in
          </div>
        </div>
        <MapPicker markers={markers} />
      </div>
      <div className="overlay-bar">
        <div style={{ minWidth: 220 }}>
          <WaitingBar label="Guesses in" current={current} total={total} />
        </div>
      </div>
    </div>
  );
}