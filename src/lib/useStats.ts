"use client";

import { useCallback, useEffect, useState } from "react";
import type { GameMode, LeaderboardEntry, PlayerStats } from "@/shared/types";
import { emitAck } from "./socket";
import { getPlayerKey } from "./playerKey";

type StatsAck = { ok: true; stats: PlayerStats } | { ok: false; error: string };

type LeaderboardAck =
  | { ok: true; entries: LeaderboardEntry[]; maps: string[] }
  | { ok: false; error: string };

export interface LeaderboardFilter {
  mapId?: string;
  mode?: GameMode;
  limit?: number;
}

/**
 * Personal stats for the current player key. Read-only: the server aggregates
 * the finished-game store, so nothing here can be forged by the client.
 */
export function useStats() {
  const [stats, setStats] = useState<PlayerStats | null>(null);
  const [loading, setLoading] = useState<boolean>(true);
  const [error, setError] = useState<string | null>(null);

  const refresh = useCallback(function () {
    const key = getPlayerKey();
    if (!key) {
      setLoading(false);
      return;
    }
    setLoading(true);
    emitAck<StatsAck>("stats:get", { playerKey: key }).then(function (res) {
      if (res.ok) {
        setStats(res.stats);
        setError(null);
      } else {
        setError(res.error);
      }
      setLoading(false);
    });
  }, []);

  useEffect(
    function () {
      refresh();
    },
    [refresh],
  );

  return { stats: stats, loading: loading, error: error, refresh: refresh };
}

/** All-time leaderboard, optionally filtered by map and mode. */
export function useLeaderboard(filter: LeaderboardFilter) {
  const [entries, setEntries] = useState<LeaderboardEntry[]>([]);
  const [maps, setMaps] = useState<string[]>([]);
  const [loading, setLoading] = useState<boolean>(true);

  const mapId = filter.mapId;
  const mode = filter.mode;
  const limit = filter.limit;

  useEffect(
    function () {
      let live = true;
      setLoading(true);
      emitAck<LeaderboardAck>("leaderboard:get", {
        mapId: mapId,
        mode: mode,
        limit: limit,
      }).then(function (res) {
        if (!live) return;
        if (res.ok) {
          setEntries(res.entries);
          setMaps(res.maps);
        }
        setLoading(false);
      });
      return function () {
        live = false;
      };
    },
    [mapId, mode, limit],
  );

  return { entries: entries, maps: maps, loading: loading };
}
