"use client";

import { useMemo, useState } from "react";
import Link from "next/link";
import type { GameMode } from "@/shared/types";
import { formatDistance } from "@/shared/scoring";
import { emojiUrl } from "@/shared/emojis";
import { ACHIEVEMENTS, achievementById } from "@/shared/achievements";
import { useLanguage } from "@/lib/language";
import { useLeaderboard, useStats } from "@/lib/useStats";

const MODE_LABEL: Record<string, string> = {
  solo: "Solo",
  multiplayer: "Hide and Seek",
  hp: "HP Mode",
};

function mapLabel(mapId: string): string {
  if (mapId === "global") return "Whole world";
  if (mapId.startsWith("continent:")) {
    const code = mapId.slice("continent:".length);
    return code.charAt(0).toUpperCase() + code.slice(1);
  }
  if (mapId.startsWith("country:")) return mapId.slice("country:".length);
  return mapId;
}

export default function StatsPage() {
  const { t } = useLanguage();
  const { stats, loading } = useStats();
  const [mapFilter, setMapFilter] = useState<string>("");
  const [modeFilter, setModeFilter] = useState<GameMode | "">("");
  const board = useLeaderboard({
    mapId: mapFilter || undefined,
    mode: modeFilter || undefined,
    limit: 20,
  });

  const earned = useMemo(function () {
    const set = new Set(stats ? stats.achievements : []);
    return ACHIEVEMENTS.map(function (def) {
      return { def: def, unlocked: set.has(def.id) };
    });
  }, [stats]);

  const unlockedCount = earned.filter((a) => a.unlocked).length;

  return (
    <div className="center-screen">
      <div className="stack stats-page" style={{ width: "min(900px, 100%)", gap: 20, padding: 24 }}>
        <div className="row" style={{ justifyContent: "space-between", alignItems: "center" }}>
          <div className="stack" style={{ gap: 4 }}>
            <span className="eyebrow">{t("Your record")}</span>
            <h1 className="title" style={{ fontSize: 34 }}>
              📊 {t("Stats")}
            </h1>
          </div>
          <Link className="secondary" href="/" style={{ textDecoration: "none" }}>
            {t("Back to start")}
          </Link>
        </div>

        {loading && <p className="muted">{t("Loading...")}</p>}

        {!loading && stats && stats.games === 0 && (
          <div className="card stack" style={{ gap: 8 }}>
            <strong>{t("No finished games yet")}</strong>
            <p className="muted" style={{ margin: 0 }}>
              {t("Play a game to the end and your results will show up here.")}
            </p>
          </div>
        )}

        {!loading && stats && stats.games > 0 && (
          <>
            <div className="card stack" style={{ gap: 12 }}>
              <span className="eyebrow">{t("Overview")}</span>
              <div className="stats-grid">
                <Stat label={t("Games")} value={stats.games.toLocaleString()} />
                <Stat label={t("Wins")} value={stats.wins.toLocaleString()} />
                <Stat label={t("Best score")} value={stats.bestScore.toLocaleString()} />
                <Stat
                  label={t("Best guess")}
                  value={
                    stats.bestDistanceKm === null
                      ? "—"
                      : formatDistance(stats.bestDistanceKm)
                  }
                />
                <Stat label={t("Perfect guesses")} value={stats.perfectGuesses.toLocaleString()} />
                <Stat
                  label={t("Average score")}
                  value={Math.round(stats.totalScore / stats.games).toLocaleString()}
                />
              </div>
            </div>

            <div className="card stack" style={{ gap: 10 }}>
              <div className="row" style={{ justifyContent: "space-between" }}>
                <span className="eyebrow">{t("Achievements")}</span>
                <span className="muted">
                  {unlockedCount} / {earned.length}
                </span>
              </div>
              <div className="achievement-grid">
                {earned.map(function (entry) {
                  return (
                    <div
                      key={entry.def.id}
                      className={`achievement${entry.unlocked ? " achievement--on" : ""}`}
                      title={entry.def.description.en}
                    >
                      <span className="achievement-icon" aria-hidden="true">
                        {entry.unlocked ? entry.def.icon : "🔒"}
                      </span>
                      <div className="stack" style={{ gap: 2 }}>
                        <strong>{t(entry.def.name.en)}</strong>
                        <span className="muted" style={{ fontSize: 12 }}>
                          {t(entry.def.description.en)}
                        </span>
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>

            <div className="card stack" style={{ gap: 10 }}>
              <span className="eyebrow">{t("By mode")}</span>
              {Object.keys(stats.byMode).map(function (mode) {
                const row = stats.byMode[mode];
                return (
                  <div key={mode} className="player-row">
                    <strong>{t(MODE_LABEL[mode] ?? mode)}</strong>
                    <span className="muted">
                      {row.games} {t("games")} · {row.wins} {t("wins")} ·{" "}
                      {t("best")} {row.bestScore.toLocaleString()}
                    </span>
                  </div>
                );
              })}
            </div>

            <div className="card stack" style={{ gap: 10 }}>
              <span className="eyebrow">{t("Recent games")}</span>
              {stats.recent.map(function (record) {
                const mine = record.players.find(function (p) {
                  return p.playerKey === stats.playerKey;
                });
                return (
                  <div key={record.id} className="player-row">
                    <div className="row" style={{ gap: 8 }}>
                      <span className="badge">#{mine ? mine.rank : "—"}</span>
                      <strong>{mapLabel(record.mapId)}</strong>
                      <span className="muted">{t(MODE_LABEL[record.mode] ?? record.mode)}</span>
                    </div>
                    <strong style={{ fontVariantNumeric: "tabular-nums" }}>
                      {mine ? mine.totalScore.toLocaleString() : "—"}
                    </strong>
                  </div>
                );
              })}
            </div>
          </>
        )}

        <div className="card stack" style={{ gap: 12 }}>
          <div className="row" style={{ justifyContent: "space-between", alignItems: "center" }}>
            <span className="eyebrow">{t("All-time leaderboard")}</span>
            <div className="row" style={{ gap: 8 }}>
              <select
                className="player-name-input"
                style={{ width: 180 }}
                value={mapFilter}
                onChange={(e) => setMapFilter(e.target.value)}
                aria-label={t("Map")}
              >
                <option value="">{t("All maps")}</option>
                {board.maps.map(function (id) {
                  return (
                    <option key={id} value={id}>
                      {mapLabel(id)}
                    </option>
                  );
                })}
              </select>
              <select
                className="player-name-input"
                style={{ width: 160 }}
                value={modeFilter}
                onChange={(e) => setModeFilter(e.target.value as GameMode | "")}
                aria-label={t("Game mode")}
              >
                <option value="">{t("All modes")}</option>
                <option value="multiplayer">{t("Hide and Seek")}</option>
                <option value="hp">{t("HP Mode")}</option>
                <option value="solo">{t("Solo mode")}</option>
              </select>
            </div>
          </div>

          {board.loading && <p className="muted">{t("Loading...")}</p>}
          {!board.loading && board.entries.length === 0 && (
            <p className="muted" style={{ margin: 0 }}>
              {t("No games recorded for this filter yet.")}
            </p>
          )}
          {board.entries.map(function (entry, i) {
            return (
              <div key={entry.playerKey} className="player-row">
                <div className="row" style={{ gap: 10 }}>
                  <span style={{ width: 24, fontWeight: "bold" }}>{i + 1}.</span>
                  <span className="roster-avatar" aria-hidden="true">
                    <img className="emoji-img" src={emojiUrl(entry.emoji)} alt="" />
                  </span>
                  <strong>{entry.name}</strong>
                  <span className="muted">{mapLabel(entry.mapId)}</span>
                </div>
                <strong style={{ fontVariantNumeric: "tabular-nums" }}>
                  {entry.score.toLocaleString()}
                </strong>
              </div>
            );
          })}
        </div>

        <p className="muted" style={{ fontSize: 12, margin: 0 }}>
          {t(
            "Stats are stored on this server and keyed to this browser. Clearing site data starts a fresh record.",
          )}
        </p>
      </div>
    </div>
  );
}

function Stat(props: { label: string; value: string }) {
  return (
    <div className="stack" style={{ gap: 2 }}>
      <span className="muted" style={{ fontSize: 12 }}>
        {props.label}
      </span>
      <strong style={{ fontSize: 20, fontVariantNumeric: "tabular-nums" }}>{props.value}</strong>
    </div>
  );
}
