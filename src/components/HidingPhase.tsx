"use client";

import { useState } from "react";
import type { HidingSpot, LatLng, PublicState } from "@/shared/types";
import EmojiStill from "./EmojiStill";
import MapPicker from "./MapPicker";
import StreetView, { type ResolvedPano } from "./StreetView";
import PlayerList from "./PlayerList";
import WaitingBar from "./WaitingBar";
import Timer from "./Timer";
import FloatingMap from "./FloatingMap";

interface Props {
  state: PublicState;
  onHide: (spot: HidingSpot) => void;
  speakingIds?: Set<string>;
}

type Coverage = "unknown" | "checking" | "ok" | "none";

function snapRadius(lat: number, zoom: number): number {
  const metersPerPixel =
    (156543.03392 * Math.cos((lat * Math.PI) / 180)) / Math.pow(2, zoom);
  return Math.min(500000, Math.max(500, Math.round(metersPerPixel * 60)));
}

export default function HidingPhase(props: Props) {
  const state = props.state;
  const onHide = props.onHide;
  const speakingIds = props.speakingIds;

  const [query, setQuery] = useState<LatLng | null>(null);
  const [queryRadius, setQueryRadius] = useState(500);
  const [resolved, setResolved] = useState<ResolvedPano | null>(null);
  const [coverage, setCoverage] = useState<Coverage>("unknown");

  if (state.youHaveHidden) {
    return (
      <div className="center-screen">
        <div className="stack" style={{ width: 420, gap: 18 }}>
          <h1 className="title">You're hidden 🫣</h1>
          <p className="muted" style={{ margin: 0 }}>
            Waiting for everyone to pick a hiding spot.
          </p>
          <div className="card stack">
            <WaitingBar
              label="Players hidden"
              current={state.hiddenCount}
              total={state.expectedHiders}
            />
            <PlayerList
              players={state.players}
              showHidden
              hiddenLabel="hidden"
              speakingIds={speakingIds}
            />
          </div>
        </div>
      </div>
    );
  }

  function pick(p: LatLng, zoom: number) {
    setQuery(p);
    setQueryRadius(snapRadius(p.lat, zoom));
    setResolved(null);
    setCoverage("checking");
  }

  function onPano(res: ResolvedPano | null) {
    if (!res) {
      setResolved(null);
      setCoverage("none");
      return;
    }
    setResolved(res);
    setCoverage("ok");
  }

  function confirm() {
    if (resolved && coverage === "ok") {
      onHide({ lat: resolved.lat, lng: resolved.lng, panoId: resolved.panoId });
    }
  }

  function handleTimeUp() {
    if (resolved && coverage === "ok") {
      confirm();
    } else {
      onHide({
        lat: 48.8584,
        lng: 2.2945,
        panoId: "CBISS3k4o_4AAAQfwo_2Tw",
      });
    }
  }

  const canHide = !!resolved && coverage === "ok";
  const markerSpot: LatLng | null = resolved
    ? { lat: resolved.lat, lng: resolved.lng }
    : query;

  const hidingTime = state.settings.hidingTimeLimit || 0;

  return (
    <div className="full-bleed">
      <div className="round-play">
        <div className="round-streetview">
          {query ? (
            <StreetView
              mode="position"
              position={query}
              radius={queryRadius}
              allowUnofficialCoverage={state.settings.allowUnofficialCoverage}
              onPano={onPano}
            />
          ) : (
            <div className="hiding-preview-prompt">Оберіть точку на мапі, щоб завантажити Street View.</div>
          )}
          <div className="round-hud">
            <span>{resolved ? "Оберіть місце схованки" : "Спочатку оберіть місце на мапі"}</span>
            {hidingTime > 0 && <Timer seconds={hidingTime} onExpire={handleTimeUp} />}
          </div>

          <div className="roster" role="status" aria-label="Hiding status">
            <div className="roster-head">
              <span>Hiding spots</span>
              <span className="roster-count">
                {state.hiddenCount}/{state.expectedHiders}
              </span>
            </div>
            <div className="roster-list">
              {state.players.map(function (p) {
                return (
                  <div
                    key={p.id}
                    className={`roster-player ${
                      p.hasHidden ? "is-hidden" : "is-waiting"
                    }${p.connected ? "" : " is-off"}`}
                    title={
                      p.name +
                      " — " +
                      (!p.connected
                        ? "offline"
                        : p.hasHidden
                        ? "hidden"
                        : "still picking")
                    }
                  >
                    <span className="roster-avatar" aria-hidden="true">
                      <EmojiStill emoji={p.emoji} className="emoji-img" />
                    </span>
                    <span className="roster-name">{p.name}</span>
                    <span className="roster-status">
                      {!p.connected ? "off" : p.hasHidden ? "hidden" : "picking…"}
                    </span>
                  </div>
                );
              })}
            </div>
          </div>
        </div>

        <FloatingMap title="Pick your hiding spot" className="hiding-map-window">
          <MapPicker
            value={markerSpot}
            onChange={pick}
            markerIcon={state.youEmoji}
            coverage
          />
        </FloatingMap>
        {query && (
          <div className="overlay-bar hiding-confirm-bar">
            <span className="overlay-bar-msg">
              {coverage === "checking" ? (
                <span className="muted">Завантаження панорами…</span>
              ) : coverage === "none" ? (
                <span style={{ color: "var(--warn)" }}>Street View не знайдено поруч.</span>
              ) : (
                <span className="muted">Ховатися в цій панорамі?</span>
              )}
            </span>
            <button type="button" onClick={confirm} disabled={!canHide}>
              Hide here
            </button>
          </div>
        )}
      </div>
    </div>
  );
}