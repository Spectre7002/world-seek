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
import { useLanguage } from "@/lib/language";

interface Props {
  state: PublicState;
  onHide: (spot: HidingSpot) => void;
  onValidateHide: (spot: HidingSpot) => Promise<{ ok: boolean; spot?: HidingSpot; reason?: string }>;
  speakingIds?: Set<string>;
}

type Coverage = "unknown" | "checking" | "ok" | "none";

export default function HidingPhase(props: Props) {
  const { t } = useLanguage();
  const state = props.state;
  const onHide = props.onHide;
  const onValidateHide = props.onValidateHide;
  const speakingIds = props.speakingIds;

  const [query, setQuery] = useState<LatLng | null>(null);
  const [queryRadius, setQueryRadius] = useState(500);
  const [resolved, setResolved] = useState<ResolvedPano | null>(null);
  const [coverage, setCoverage] = useState<Coverage>("unknown");
  const [mapValidation, setMapValidation] = useState<"unknown" | "checking" | "ok" | "outside_map" | "outside_selected_country" | "outside_selected_region" | "not_official_road">("unknown");

  if (state.youHaveHidden) {
    return (
      <div className="center-screen">
        <div className="stack" style={{ width: 420, gap: 18 }}>
          <h1 className="title">{t("You're hidden 🫣")}</h1>
          <p className="muted" style={{ margin: 0 }}>
            {t("Waiting for everyone to pick a hiding spot.")}
          </p>
          <div className="card stack">
            <WaitingBar
              label={t("Players hidden")}
              current={state.hiddenCount}
              total={state.expectedHiders}
            />
            <PlayerList
              players={state.players}
              showHidden
              hiddenLabel={t("hidden")}
              speakingIds={speakingIds}
            />
          </div>
        </div>
      </div>
    );
  }

  function pick(p: LatLng, zoom: number) {
    setQuery(p);
    void zoom;
    // Google caps Street View searches at 50 km; use that maximum so every
    // click can snap to the nearest available official road.
    setQueryRadius(50000);
    setResolved(null);
    setCoverage("checking");
    setMapValidation("checking");
  }

  function onPano(res: ResolvedPano | null) {
    if (!res) {
      setResolved(null);
      setCoverage("none");
      setMapValidation("outside_map");
      return;
    }
    // Use the actual Street View road coordinate so the pin visibly snaps to it.
    setResolved(res);
    setCoverage("ok");
    const selectedPoint = {
      lat: res.lat,
      lng: res.lng,
      panoId: res.panoId,
    };
    onValidateHide(selectedPoint).then((result) => {
      if (result.ok) {
        setMapValidation("ok");
      } else {
        setMapValidation(
          result.reason === "Нельзя спрятаться за пределами выбранной страны"
            ? "outside_selected_country"
            : result.reason === "Нельзя спрятаться за пределами выбранного региона"
            ? "outside_selected_region"
            : (result.reason as typeof mapValidation) || "outside_map",
        );
      }
    });
  }

  function confirm() {
    if (resolved && coverage === "ok" && mapValidation === "ok") {
      onHide({ lat: resolved.lat, lng: resolved.lng, panoId: resolved.panoId });
    }
  }

  function handleTimeUp() {
    if (resolved && coverage === "ok" && mapValidation === "ok") {
      confirm();
    }
  }

  const canHide = !!resolved && coverage === "ok" && mapValidation === "ok";
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
              onPanoError={(reason) => {
                setCoverage(reason === "none" ? "none" : "ok");
                setMapValidation(reason === "not_official_road" ? "not_official_road" : "outside_map");
              }}
            />
          ) : mapValidation === "checking" ? (
            <span className="muted">{t("Checking selected map…")}</span>
          ) : mapValidation === "outside_map" ? (
            <span style={{ color: "var(--warn)" }}>{t("You cannot hide here: outside the selected region.")}</span>
          ) : mapValidation === "outside_selected_country" ? (
            <span style={{ color: "var(--warn)" }}>{t("Нельзя спрятаться за пределами выбранной страны")}</span>
          ) : mapValidation === "outside_selected_region" ? (
            <span style={{ color: "var(--warn)" }}>{t("Нельзя спрятаться за пределами выбранного региона")}</span>
          ) : (
            <div className="hiding-preview-prompt">{t("Choose a spot on the map to load Street View.")}</div>
          )}
          <div className="round-hud">
            <span>{resolved ? t("Choose your hiding spot") : t("First, choose a spot on the map")}</span>
            {hidingTime > 0 && <Timer seconds={hidingTime} onExpire={handleTimeUp} />}
          </div>

          <div className="roster" role="status" aria-label={t("Hiding status")}>
            <div className="roster-head">
              <span>{t("Hiding spots")}</span>
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
                        ? t("offline")
                        : p.hasHidden
                        ? t("hidden")
                        : t("still picking"))
                    }
                  >
                    <span className="roster-avatar" aria-hidden="true">
                      <EmojiStill emoji={p.emoji} className="emoji-img" />
                    </span>
                    <span className="roster-name">{p.name}</span>
                    <span className="roster-status">
                      {!p.connected ? t("off") : p.hasHidden ? t("hidden") : t("picking…")}
                    </span>
                  </div>
                );
              })}
            </div>
          </div>
        </div>

        <FloatingMap title={t("Pick your hiding spot")} className="hiding-map-window">
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
                <span className="muted">{t("Loading panorama…")}</span>
              ) : coverage === "none" ? (
                <span style={{ color: "var(--warn)" }}>{t("No Street View found nearby.")}</span>
              ) : mapValidation === "not_official_road" ? (
                <span style={{ color: "var(--warn)" }}>{t("You cannot hide here: official roads only.")}</span>
              ) : mapValidation === "outside_map" ? (
                <span style={{ color: "var(--warn)" }}>{t("You cannot hide here: outside the selected region.")}</span>
              ) : mapValidation === "outside_selected_country" ? (
                <span style={{ color: "var(--warn)" }}>{t("Нельзя спрятаться за пределами выбранной страны")}</span>
              ) : mapValidation === "outside_selected_region" ? (
                <span style={{ color: "var(--warn)" }}>{t("Нельзя спрятаться за пределами выбранного региона")}</span>
              ) : (
                <span className="muted">{t("Hide in this panorama?")}</span>
              )}
            </span>
            <button type="button" onClick={confirm} disabled={!canHide}>
              {t("Hide here")}
            </button>
          </div>
        )}
      </div>
    </div>
  );
}