import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";
import type {
  GameMode,
  GameRecord,
  GameRecordPlayer,
  LeaderboardEntry,
  PlayerStats,
  Room,
} from "../shared/types";
import {
  CONTINENT_CODES,
  MAPS_FOR_GLOBETROTTER,
  SOLO_ACE_SCORE,
  WINS_FOR_VETERAN,
} from "../shared/achievements";

// ---------------------------------------------------------------------------
// Finished-game history.
//
// Same shape as the Maps budget counter: a single JSON file on the persistent
// /data volume, written atomically (temp file + rename) so a crash mid-write
// can never leave a truncated file. Games finish a handful of times an hour at
// most, so a synchronous write per game is cheap and means a SIGTERM cannot
// lose a result.
//
// The store is deliberately append-only and capped: it is a stats source, not
// an audit log, and an unbounded file would eventually be read into memory on
// every boot.
// ---------------------------------------------------------------------------

const HISTORY_PATH = process.env.HISTORY_STATE_PATH || "/data/history.json";

/** Keep the most recent N games. Older ones are dropped on write. */
const MAX_GAMES = 2000;

/** How many recent games the personal stats page shows. */
const RECENT_GAMES = 10;

interface HistoryState {
  version: 1;
  games: GameRecord[];
}

function emptyState(): HistoryState {
  return { version: 1, games: [] };
}

// Set once if the file turns out to be unusable, so the warning is logged a
// single time rather than on every game.
let degraded = false;

function degrade(action: string, err: unknown): void {
  if (degraded) return;
  degraded = true;
  console.error(
    `[history] cannot ${action} ${HISTORY_PATH} — finished games are kept ` +
      `IN MEMORY ONLY and will be lost on restart. Mount a writable volume ` +
      `and set HISTORY_STATE_PATH.`,
    err,
  );
}

function isRecord(value: unknown): value is GameRecord {
  if (typeof value !== "object" || value === null) return false;
  const o = value as Record<string, unknown>;
  return (
    typeof o.id === "string" &&
    typeof o.code === "string" &&
    typeof o.finishedAt === "number" &&
    typeof o.mode === "string" &&
    typeof o.mapId === "string" &&
    typeof o.rounds === "number" &&
    Array.isArray(o.players)
  );
}

function load(): HistoryState {
  try {
    const raw = JSON.parse(readFileSync(HISTORY_PATH, "utf8")) as Partial<HistoryState>;
    if (!Array.isArray(raw?.games)) return emptyState();
    return { version: 1, games: raw.games.filter(isRecord) };
  } catch (err) {
    // A missing file on first boot is normal, not a degradation.
    if ((err as NodeJS.ErrnoException)?.code !== "ENOENT") degrade("read", err);
    return emptyState();
  }
}

function save(state: HistoryState): void {
  const tmp = `${HISTORY_PATH}.tmp`;
  try {
    mkdirSync(dirname(HISTORY_PATH), { recursive: true });
    writeFileSync(tmp, JSON.stringify(state), "utf8");
    renameSync(tmp, HISTORY_PATH);
  } catch (err) {
    // Fail soft: a disk problem must never take the game down.
    degrade("write", err);
  }
}

let state = load();

/** True when the store is not being persisted (see the degrade warning). */
export function historyDegraded(): boolean {
  return degraded;
}

/** Number of games currently held. */
export function historyGameCount(): number {
  return state.games.length;
}

// ---------------------------------------------------------------------------
// Writing a finished game
// ---------------------------------------------------------------------------

/**
 * Rank players for the record. HP matches are decided by remaining health, then
 * multiplier, then score — the same order `FinalScores` uses, so the stored
 * placement matches what the players were shown. Classic games rank by score.
 */
function rankPlayers(room: Room): GameRecordPlayer[] {
  const seated = room.players.filter((p) => !p.spectator);
  const hp = room.mode === "hp";

  // These come from per-game counters incremented as each round is scored, not
  // from `p.guesses`: classic multiplayer clears `guesses` at the end of every
  // cycle, so a scan here only ever saw the final cycle.
  const rows = seated.map(function (p) {
    return {
      playerKey: p.playerKey,
      name: p.name,
      emoji: p.emoji,
      totalScore: p.totalScore,
      hp: p.hp,
      guessMultiplier: p.guessMultiplier,
      rank: 0,
      bestDistanceKm: p.bestDistanceKm,
      perfectGuesses: p.perfectGuesses,
      roundsGuessed: p.roundsScored,
    };
  });

  rows.sort(function (a, b) {
    if (hp) {
      if (b.hp !== a.hp) return b.hp - a.hp;
      if (b.guessMultiplier !== a.guessMultiplier) {
        return b.guessMultiplier - a.guessMultiplier;
      }
    }
    return b.totalScore - a.totalScore;
  });

  for (let i = 0; i < rows.length; i++) rows[i].rank = i + 1;
  return rows;
}

/**
 * Persist a finished game. Returns the record, or null when the room has
 * already been recorded (or has no seated players). Idempotent: the caller can
 * invoke it from any transition that ends a game.
 */
export function recordFinishedGame(room: Room): GameRecord | null {
  if (room.historyRecorded) return null;
  const players = rankPlayers(room);
  if (players.length === 0) return null;

  const record: GameRecord = {
    id: `${room.code}-${Date.now()}`,
    code: room.code,
    finishedAt: Date.now(),
    mode: room.mode,
    mapId: room.settings.selectedMap || "global",
    rounds: room.roundHistory ? room.roundHistory.length : 0,
    players: players,
  };

  room.historyRecorded = true;
  state.games.push(record);
  if (state.games.length > MAX_GAMES) {
    state.games.splice(0, state.games.length - MAX_GAMES);
  }
  save(state);
  return record;
}

// ---------------------------------------------------------------------------
// Reading: personal stats and the leaderboard
// ---------------------------------------------------------------------------

function emptyStats(playerKey: string): PlayerStats {
  return {
    playerKey: playerKey,
    games: 0,
    wins: 0,
    totalScore: 0,
    bestScore: 0,
    bestDistanceKm: null,
    perfectGuesses: 0,
    roundsGuessed: 0,
    byMode: {},
    byMap: {},
    continentsWon: [],
    achievements: [],
    recent: [],
  };
}

/**
 * A solo game has exactly one player, so "rank 1" there is not a win — it would
 * make the win achievements free. Solo progress is tracked by `solo_ace`
 * instead.
 */
function isWin(record: GameRecord, player: GameRecordPlayer): boolean {
  return record.mode !== "solo" && player.rank === 1;
}

function continentOf(mapId: string): string | null {
  if (!mapId.startsWith("continent:")) return null;
  const code = mapId.slice("continent:".length);
  return CONTINENT_CODES.includes(code) ? code : null;
}

/** Aggregate every stored game for one player key. */
export function getPlayerStats(playerKey: string): PlayerStats {
  const stats = emptyStats(playerKey);
  if (!playerKey) return stats;

  const mapsPlayed = new Set<string>();
  const continentsWon = new Set<string>();
  let perfectGuesses = 0;

  // Walk newest-first so `recent` is genuinely the most recent games, and so
  // the per-map / per-mode "best" values are filled in one pass.
  for (let i = state.games.length - 1; i >= 0; i--) {
    const record = state.games[i];
    let mine: GameRecordPlayer | null = null;
    for (let j = 0; j < record.players.length; j++) {
      if (record.players[j].playerKey === playerKey) {
        mine = record.players[j];
        break;
      }
    }
    if (!mine) continue;

    stats.games++;
    stats.totalScore += mine.totalScore;
    if (mine.totalScore > stats.bestScore) stats.bestScore = mine.totalScore;
    if (
      mine.bestDistanceKm !== null &&
      (stats.bestDistanceKm === null || mine.bestDistanceKm < stats.bestDistanceKm)
    ) {
      stats.bestDistanceKm = mine.bestDistanceKm;
    }
    stats.perfectGuesses += mine.perfectGuesses;
    perfectGuesses += mine.perfectGuesses;
    stats.roundsGuessed += mine.roundsGuessed;

    const won = isWin(record, mine);
    if (won) {
      stats.wins++;
      const continent = continentOf(record.mapId);
      if (continent) continentsWon.add(continent);
    }

    mapsPlayed.add(record.mapId);

    const mode = stats.byMode[record.mode] ?? { games: 0, wins: 0, bestScore: 0 };
    mode.games++;
    if (won) mode.wins++;
    if (mine.totalScore > mode.bestScore) mode.bestScore = mine.totalScore;
    stats.byMode[record.mode] = mode;

    const map = stats.byMap[record.mapId] ?? { games: 0, bestScore: 0 };
    map.games++;
    if (mine.totalScore > map.bestScore) map.bestScore = mine.totalScore;
    stats.byMap[record.mapId] = map;

    if (stats.recent.length < RECENT_GAMES) {
      stats.recent.push(record);
    }
  }

  stats.continentsWon = CONTINENT_CODES.filter((c) => continentsWon.has(c));

  stats.achievements = computeAchievements(stats, {
    perfectGuesses: perfectGuesses,
    mapsPlayed: mapsPlayed.size,
    continentsWon: continentsWon.size,
  });
  return stats;
}

function computeAchievements(
  stats: PlayerStats,
  extra: { perfectGuesses: number; mapsPlayed: number; continentsWon: number },
): string[] {
  const earned: string[] = [];
  if (stats.games >= 1) earned.push("first_game");
  if (extra.perfectGuesses >= 1) earned.push("first_perfect");
  if (extra.perfectGuesses >= 5) earned.push("sharpshooter");
  if (stats.wins >= 1) earned.push("first_win");
  if (stats.wins >= WINS_FOR_VETERAN) earned.push("veteran");
  if (extra.mapsPlayed >= MAPS_FOR_GLOBETROTTER) earned.push("globetrotter");
  if (extra.continentsWon >= CONTINENT_CODES.length) earned.push("continental");
  if ((stats.byMode.hp?.wins ?? 0) >= 1) earned.push("hp_survivor");
  if ((stats.byMode.solo?.bestScore ?? 0) >= SOLO_ACE_SCORE) earned.push("solo_ace");
  return earned;
}

export interface LeaderboardQuery {
  mapId?: string;
  mode?: GameMode;
  limit?: number;
}

/**
 * All-time best single-game scores, optionally filtered by map and mode. One
 * row per player key (their best game), so a strong player cannot fill the
 * whole board.
 */
export function getLeaderboard(query: LeaderboardQuery = {}): LeaderboardEntry[] {
  const limit = Math.max(1, Math.min(100, query.limit ?? 20));
  const best = new Map<string, LeaderboardEntry>();

  for (let i = 0; i < state.games.length; i++) {
    const record = state.games[i];
    if (query.mapId && record.mapId !== query.mapId) continue;
    if (query.mode && record.mode !== query.mode) continue;
    for (let j = 0; j < record.players.length; j++) {
      const p = record.players[j];
      if (!p.playerKey) continue;
      const existing = best.get(p.playerKey);
      if (existing && existing.score >= p.totalScore) continue;
      best.set(p.playerKey, {
        playerKey: p.playerKey,
        name: p.name,
        emoji: p.emoji,
        score: p.totalScore,
        bestDistanceKm: p.bestDistanceKm,
        mapId: record.mapId,
        mode: record.mode,
        finishedAt: record.finishedAt,
      });
    }
  }

  const rows = Array.from(best.values());
  rows.sort(function (a, b) {
    if (b.score !== a.score) return b.score - a.score;
    return a.finishedAt - b.finishedAt;
  });
  return rows.slice(0, limit);
}

/** Maps that actually have a recorded game, for the leaderboard filter. */
export function recordedMapIds(): string[] {
  const ids = new Set<string>();
  for (let i = 0; i < state.games.length; i++) ids.add(state.games[i].mapId);
  return Array.from(ids).sort();
}

/** Test hook: drop everything. Not exposed over the network. */
export function resetHistoryForTests(): void {
  state = emptyState();
  save(state);
}

/** Exported for the smoke test: the on-disk path in use. */
export const HISTORY_FILE = HISTORY_PATH;

/** Exported for the smoke test: whether the file exists yet. */
export function historyFileExists(): boolean {
  return existsSync(HISTORY_PATH);
}
