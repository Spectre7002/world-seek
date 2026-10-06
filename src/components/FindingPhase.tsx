"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import type { LatLng, LiveView, PublicPlayer, PublicState } from "@/shared/types";
import { emojiUrl } from "@/shared/emojis";
import MapPicker, { type MapMarker } from "./MapPicker";
import StreetView, { type StreetViewCam } from "./StreetView";
import PlayerList from "./PlayerList";
import WaitingBar from "./WaitingBar";
import Timer from "./Timer";
import FloatingMap from "./FloatingMap";

interface Props {
  state: PublicState;
  onGuess: (at: LatLng) => void;
  onPreview: (at: LatLng) => void;
  onView: (view: StreetViewCam) => void;
}

const PREVIEW_THROTTLE_MS = 100;
const TENTATIVE_OPACITY = 0.4;

export default function FindingPhase(props: Props) {
  const state = props.state;
  const onGuess = props.onGuess;
  const onPreview = props.onPreview;
  const onView = props.onView;

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
        views={state.liveViews}
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
        views={state.liveViews}
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
      <div className="round-play">
        <div className="round-streetview">
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
          <StreetView
            mode="pano"
            panoId={state.currentTarget ? state.currentTarget.panoId : undefined}
            onView={state.solo ? undefined : onView}
          />
        </div>

        <div className="round-hud">
          <span>{roundLabel} · drop your guess</span>
          {findingTime > 0 && <Timer seconds={findingTime} onExpire={handleTimeUp} />}
        </div>
        <FloatingMap title="Move the map and place your guess" className="guess-map-window">
          <MapPicker
            value={guess}
            onChange={handleChange}
            onDrag={handleDrag}
            markerIcon={state.youEmoji}
            resetViewKey={state.currentRound}
          />
        </FloatingMap>
      </div>

      <div className="overlay-bar guess-confirm-bar">
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
  views: LiveView[];
  current: number;
  total: number;
  players?: PublicPlayer[];
}) {
  const roundLabel = props.roundLabel;
  const title = props.title;
  const emptyHint = props.emptyHint;
  const markers = props.markers;
  const views = props.views;
  const current = props.current;
  const total = props.total;
  const players = props.players;
  const [selectedHunterId, setSelectedHunterId] = useState("");
  const selectedView =
    views.find(function (view) {
      return view.playerId === selectedHunterId;
    }) || views[0] || null;

  if (markers.length === 0 && views.length === 0) {
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
      <div className="round-play">
        <div className="round-streetview watch-view">
          <div className="watch-target-heading">
            <strong>{title}</strong>
            <span>{roundLabel} · live hunter view</span>
            <div className="watch-hunter-tabs" role="tablist" aria-label="Choose a hunter">
              {views.map(function (view) {
                return (
                  <button
                    type="button"
                    key={view.playerId}
                    role="tab"
                    aria-selected={selectedView?.playerId === view.playerId}
                    className={selectedView?.playerId === view.playerId ? "is-selected" : ""}
                    onClick={function () {
                      setSelectedHunterId(view.playerId);
                    }}
                  >
                    {view.emoji} {view.name}
                  </button>
                );
              })}
            </div>
          </div>
          {selectedView ? (
            <StreetView
              mode="pano"
              panoId={selectedView.panoId}
              follow={selectedView}
              interactive={false}
            />
          ) : (
            <div className="watch-waiting-hint">
              {views.length === 0 ? emptyHint : "Завантаження Street View шукача…"}
            </div>
          )}
        </div>
        <FloatingMap title="Hunters' guesses" className="watch-map-window">
          <MapPicker markers={markers} />
        </FloatingMap>
      </div>
      <div className="overlay-bar">
        <div style={{ minWidth: 220 }}>
          <WaitingBar label="Guesses in" current={current} total={total} />
        </div>
      </div>
    </div>
  );
}