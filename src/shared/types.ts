// Shared types used by BOTH the Socket.IO server and the React client.

import type { SpellCounts, SpellId } from "./spells";

export type Phase = "lobby" | "hiding" | "finding" | "results" | "finished";

export interface Settings {
  /** Points awarded for a perfect guess. */
  maxPoints: number;
  /** Distance (km) controlling how fast the score decays. Larger = more forgiving. */
  scoreScaleKm: number;
  /** Number of rounds in a solo game (the game picks one location per round). */
  soloRounds: number;
  /** Number of cycles in a multiplayer game. */
  multiplayerCycles: number;
  /** Time limit for hiding phase in seconds (0 = unlimited). */
  hidingTimeLimit: number;
  /** Time limit for finding phase in seconds (0 = unlimited). */
  findingTimeLimit: number;
  /** Whether in-game text chat is enabled. */
  textChat: boolean;
  /** Whether in-game voice chat (WebRTC) is enabled. */
  voiceChat: boolean;
  /** Whether hiding spots may use community and photosphere imagery. */
  allowUnofficialCoverage: boolean;
  selectedMap: string;
  
  // Добавленные параметры
  cheatsEnabled: boolean;
  caseEnabled: boolean;
  caseOddsMode: CaseMode;
  /** Case tiers the host allows to drop. Empty means "all tiers". */
  caseTiers: CaseTierKey[];
  gameMode: "classic" | "hp";
  /**
   * Movement rule for the finding phase.
   *
   *   "free"    — walk and look around (the default).
   *   "no-move" — NMPZ: the panorama is locked to the spawn point. The player
   *               may still look around (rotate/pitch/zoom) but cannot travel
   *               to a neighbouring panorama.
   *   "NMPZ" — the strict NMPZ mode: the camera is frozen too, so
   *               the player sees exactly one frame.
   *
   * Enforced in the browser (the panorama is the only place movement happens)
   * and mirrored in the projection so the client knows which lock to apply.
   */
  movementMode: MovementMode;
  /**
   * Shared seed for the server-picked location sequence. Empty means "pick
   * randomly". A non-empty seed makes every player who joins the same room see
   * the same locations in the same order, which is what the daily challenge and
   * a shareable seed both need.
   */
  seed: string;
}
export type CaseMode = "standard" | "better_odds";

/** How much the player may move inside Street View while hunting. */
export type MovementMode = "free" | "no-move" | "NMPZ";

export const MOVEMENT_MODES: MovementMode[] = ["free", "no-move", "NMPZ"];

/**
 * Case rarity tiers. The host can enable a subset in the lobby and the roll
 * only considers enabled tiers, so a "gold only" or "no blues" game is possible.
 */
export type CaseTierKey = "MIL_SPEC" | "RESTRICTED" | "CLASSIFIED" | "COVERT" | "SPECIAL";
export const CASE_TIER_KEYS: CaseTierKey[] = [
  "MIL_SPEC",
  "RESTRICTED",
  "CLASSIFIED",
  "COVERT",
  "SPECIAL",
];

/**
 * Pity timer: after this many consecutive MIL_SPEC rolls the next case is
 * guaranteed to be a better tier. Without it a long unlucky streak is pure
 * frustration, and the published odds make a 10-blue streak ~10% likely.
 */
export const CASE_PITY_MAX = 10;
export interface LocalizedText {
  ru: string;
  en: string;
}

export interface CaseHintData {
  /** Stable id of the won item, used for duplicate protection. */
  itemKey: string;
  tierKey: string;
  tierName: LocalizedText;
  tierColor: string;
  itemName: LocalizedText;
  hintTitle: LocalizedText;
  hintValue: LocalizedText;
  circle?: { center: LatLng; radiusMeters: number };
  band?: { min: number; max: number; axis: "lat" | "lng" };
  exact?: LatLng;
  /** Set when the case roll was a spell; the client adds it to the inventory. */
  spell?: SpellId;
  /** Target coords bundled with a spell so it can be cast without cheats on. */
  spellTarget?: LatLng;
}
export const DEFAULT_SETTINGS: Settings = {
  maxPoints: 5000,
  scoreScaleKm: 2000,
  soloRounds: 5,
  multiplayerCycles: 5,
  hidingTimeLimit: 0,
  findingTimeLimit: 0,
  textChat: true,
  voiceChat: false,
  allowUnofficialCoverage: false,
  selectedMap: "global",
  cheatsEnabled: false,
  caseEnabled: false,
  caseOddsMode: "better_odds",
  caseTiers: [...CASE_TIER_KEYS],
  gameMode: "classic",
  movementMode: "free",
  seed: "",
};

// ---------------------------------------------------------------------------
// Chat
// ---------------------------------------------------------------------------

export interface ChatMessage {
  id: string;
  playerId: string;
  playerName: string;
  emoji: string;
  text: string;
  ts: number;
  /**
   * True for server-generated notices ("Bob joined", "Round 3 started"). They
   * carry no playerId/emoji and are rendered as a muted line instead of a
   * player bubble.
   */
  system?: boolean;
}

/**
 * The only reaction glyphs the server will relay. A whitelist rather than a
 * length check: an arbitrary string would let a client render text in the
 * reaction bubble, and the set is small enough that there is no reason to
 * accept anything else.
 */
export const REACTIONS: readonly string[] = [
  "👍",
  "😂",
  "😮",
  "😭",
  "🔥",
  "🎯",
  "💀",
  "👏",
];

/**
 * A quick emoji reaction burst over the map. Ephemeral: the server relays it
 * and never stores it, so it cannot be replayed or used to leak information.
 */
export interface Reaction {
  id: string;
  playerId: string;
  name: string;
  emoji: string;
  /** The reaction glyph itself (whitelisted server-side). */
  reaction: string;
  ts: number;
}

/**
 * "multiplayer" = the classic hide & seek (players hide, others guess).
 * "solo" = the game picks a random location each round and the lone player guesses.
 * "hp" = the server picks a shared location and every player guesses it; the
 *        worst guesses lose health. Previously this reused "solo", which made a
 *        3-player HP match look like a single-player game to the projection.
 */
export type GameMode = "solo" | "multiplayer" | "hp";

export type MapCategory = "global" | "continents" | "countries";
export type MapId = "global" | `continent:${string}` | `country:${string}`;

export interface MapOption {
  id: MapId;
  category: MapCategory;
  code: string;
  name: string;
}

export interface MapCatalog {
  global: MapOption;
  continents: MapOption[];
  countries: MapOption[];
}

export interface RegionBounds {
  north: number;
  south: number;
  east: number;
  west: number;
}

export interface LatLng {
  lat: number;
  lng: number;
}

/** A server-selected Street View location from the generated global pool. */
export interface Location extends LatLng {
  heading: number;
  pitch: number;
  panoId: string;
}

export interface HidingSpot extends LatLng {
  /** Street View panorama id at this spot (broadcast to guessers instead of coords). */
  panoId: string;
}

export interface Guess extends LatLng {
  distanceKm: number;
  points: number;
  /** HP-only: health removed from the guesser when they are not the round's best. */
  damage?: number;
  appliedMultiplier?: number;
}

// ---------------------------------------------------------------------------
// Round history (per-game log, shown on the results and final screens)
// ---------------------------------------------------------------------------

/**
 * One scored round, kept on the room for the whole game so the results screen
 * can show a breakdown of earlier rounds and the final screen can show the
 * full log. Built server-side from the same data the results projection uses,
 * so the log and the live results view cannot disagree.
 */
export interface RoundHistoryEntry {
  /** Monotonic turn id — matches `PublicState.roundKey` for that turn. */
  roundKey: number;
  /** 1-based display index within the game. */
  round: number;
  /** Map the round was played on (`global`, `continent:eu`, `country:FR`). */
  mapId: string;
  /** True when the server picked the location (solo / HP). */
  serverPicked: boolean;
  targetName: string;
  targetEmoji: string;
  real: LatLng;
  guesses: PublicGuess[];
  /** ms timestamp when the round was scored. */
  scoredAt: number;
}

// ---------------------------------------------------------------------------
// Server-internal model (never sent verbatim to clients).
// ---------------------------------------------------------------------------

export interface Player {
  id: string;
  name: string;
  emoji: string; // chosen avatar id (see src/shared/emojis.ts); unique per room
  sessionToken: string; // secret — never projected
  /**
   * Stable, client-generated identity that survives across games (stored in
   * localStorage). Used only for the personal stats page and the leaderboard —
   * it is never projected to other players.
   */
  playerKey: string;
  isGameMaster: boolean;
  connected: boolean;
  socketId: string | null; // live socket, for per-player emits
  /** ms timestamp when this player took their seat — used for host succession. */
  joinedAt: number;
  /**
   * True for a late joiner who watches the running game without a seat. They
   * are seated automatically when the room returns to the lobby.
   */
  spectator: boolean;
  hiding: HidingSpot | null; // secret until results
  hasHidden: boolean;
  guesses: Record<string, Guess>; // targetPlayerId -> this player's guess
  // Current-round in-progress pin, streamed to watchers as they place/drag it.
  // Cleared on confirm; validated against the live target so it can't bleed rounds.
  livePin: { targetId: string; lat: number; lng: number } | null;
  // Hunter Street View camera, streamed only to the hider / already-guessed.
  liveView: {
    targetId: string;
    panoId: string;
    heading: number;
    pitch: number;
    zoom: number;
  } | null;
  hp: number;
  totalScore: number;
  guessMultiplier: number;
  /** roundKey of the turn this player last opened a case in (0 = never). */
  caseOpenedRound: number;
  /**
   * Rounds this player actually locked a guess in, over the whole game.
   *
   * Classic multiplayer clears `guesses` at the end of every cycle, so counting
   * `Object.keys(p.guesses)` when the game ends only ever sees the final cycle.
   * These three counters are incremented as rounds are scored, so the finished-
   * game record is accurate for every cycle.
   */
  roundsScored: number;
  /** Closest guess of the game, in km, or null when they never guessed. */
  bestDistanceKm: number | null;
  /** Guesses within PERFECT_DISTANCE_KM, over the whole game. */
  perfectGuesses: number;
  /** Spells won from cases. Server-owned so they survive a refresh. */
  spells: SpellCounts;
  /** Consecutive MIL_SPEC rolls; drives the pity timer. */
  casePity: number;
  /** Stable key of the last case item won, for duplicate protection. */
  lastCaseItem: string | null;
  /** ms timestamp until which a Freeze spell blocks this player's guess. */
  frozenUntil: number | null;
}

export interface Room {
  code: string;
  phase: Phase;
  mode: GameMode;
  settings: Settings;
  gameMasterId: string;
  players: Player[];
  order: string[];
  currentRound: number;
  targets: Location[];
  cycleCount?: number; // Номер текущего круга пряток (от 1 до 5)
  /** HP mode: ms timestamp when the first player confirmed a guess this round. */
  firstGuessTime?: number | null;
  /**
   * ms timestamp when the current phase auto-advances, or null when the phase
   * has no time limit. Set once when the phase starts and projected verbatim —
   * recomputing it per broadcast would push the deadline forward on every state
   * emit and the timer would never fire.
   */
  deadlineAt?: number | null;
  /**
   * The case opened during the current turn, kept so watchers can replay the
   * roulette. Stored on the room rather than pushed as a one-off event, because
   * the next state broadcast would otherwise overwrite the client's copy.
   */
  liveCase?: LiveCase | null;
  /**
   * Every scored round of the current game, in order. Reset when a new game
   * starts; projected to clients so the results screen can show a breakdown.
   */
  roundHistory?: RoundHistoryEntry[];
  /**
   * Set once the finished game has been written to the history store, so the
   * record is written exactly once no matter which transition ended the game.
   */
  historyRecorded?: boolean;
  /**
   * How many locations the seeded RNG has produced this game. Part of the
   * deterministic sequence: the same seed + the same cursor always yields the
   * same location, so two players on the same seed see the same game.
   */
  seedCursor?: number;
  /** Vote-kick tallies: target player id -> the ids that voted for it. */
  kickVotes?: Record<string, string[]>;
  /**
   * System chat lines queued by a transition. Transitions have no socket
   * access, so they queue the text here and the next broadcast flushes it into
   * the room chat.
   */
  pendingSystem?: string[];
}

// ---------------------------------------------------------------------------
// Public projection (what a given client actually receives).
// ---------------------------------------------------------------------------

export interface PublicPlayer {
  id: string;
  name: string;
  emoji: string;
  isGameMaster: boolean;
  connected: boolean;
  /** True for a late joiner watching without a seat. */
  spectator: boolean;
  hasHidden: boolean;
  hp: number;
  totalScore: number;
  guessMultiplier: number;
  /** ms timestamp until which a Freeze spell blocks this player's guess. */
  frozenUntil: number | null;
}

export interface CurrentTarget {
  id: string;
  name: string;
  emoji: string;
  panoId: string; // imagery only; coords never sent here
  heading: number;
  pitch: number;
  realCoords?: LatLng; // Отправляется только если включены читы
}

export interface PublicGuess extends LatLng {
  playerId: string;
  name: string;
  emoji: string;
  distanceKm: number;
  points: number;
  damage?: number;
  appliedMultiplier?: number;
}

export interface RoundResult {
  targetId: string;
  targetName: string;
  targetEmoji: string;
  real: LatLng; // revealed only in results
  guesses: PublicGuess[];
}

/**
 * A live "follow-along" pin shown to watchers (the target + already-guessed
 * players) during the finding phase. Only ever sent to people who can no longer
 * guess this round, so it can't be used to copy positions.
 */
export interface LiveGuess extends LatLng {
  playerId: string;
  name: string;
  emoji: string;
  confirmed: boolean; // false = still placing (transparent), true = locked in (solid)
}

/**
 * Delta packet for `live:update`. Carries only the live pin list, so a
 * `guess:preview` no longer has to broadcast a full `PublicState` per player.
 */
export interface LiveUpdate {
  pins: LiveGuess[];
}

/** Follow-along Street View of a hunter, shown only to watchers. */
export interface LiveView {
  playerId: string;
  name: string;
  emoji: string;
  panoId: string;
  heading: number;
  pitch: number;
  zoom: number;
}

export interface LiveCase {
  playerId: string;
  name: string;
  emoji: string;
  hint: CaseHintData;
}

export interface PublicState {
  code: string;
  phase: Phase;
  /** True only for a genuine single-player game (one player, no opponents). */
  solo: boolean;
  /**
   * True when the server picked the target instead of a player hiding. Covers
   * both solo and HP mode, which share the same location-picking path but are
   * not the same thing: an HP match has opponents and a winner.
   */
  serverPickedLocation: boolean;
  settings: Settings;
  /**
   * Derived, never a stored setting: true only for a 2-player HP match. Moved
   * off `Settings` because a stored flag could be set-but-never-used, and the
   * value is a pure function of the game mode and the connected player count.
   */
  is1v1: boolean;
  maps: MapCatalog;
  mapBounds: RegionBounds | null;
  gameMasterId: string;
  players: PublicPlayer[];

  youId: string;
  youEmoji: string; // viewer's own avatar — for their dropped pin
  youAreGameMaster: boolean;
  /** True when the viewer joined mid-game and is only watching. */
  youAreSpectator: boolean;
  yourSpot?: LatLng; // hider's own spot (only sent to the hider)
  /** The viewer's own spell inventory (server-owned, survives a refresh). */
  yourSpells: SpellCounts;
  /** Consecutive MIL_SPEC case rolls, and the count that forces a better tier. */
  casePity: number;
  casePityMax: number;
  /** ms timestamp until which the viewer is frozen and cannot lock a guess. */
  youFrozenUntil: number | null;
  /**
   * Coordinates the viewer's spells may be cast against. Only sent when the
   * viewer actually owns a spell, so it is not a free hint for everyone.
   */
  spellTarget?: LatLng;

  // hiding phase
  youHaveHidden: boolean;
  hiddenCount: number;
  expectedHiders: number;

  // finding phase
  currentRound: number;
  totalRounds: number;
  subRound?: number; // Добавлено для отслеживания текущего игрока в цикле
  totalSubRounds?: number; // Добавлено для отслеживания общего количества игроков
  /**
   * Monotonic id for the current turn, unique across the whole game.
   *
   * In classic multiplayer `currentRound` is the *cycle* index and stays the
   * same for every target in that cycle, so it cannot be used to detect "a new
   * turn started". Anything that must reset per turn (case hint, guess pin, map
   * view, round notice) keys on this instead.
   */
  roundKey: number;
  currentTarget: CurrentTarget | null; // null when you are the target
  youAreTarget: boolean;
  youHaveGuessed: boolean;
  guessedCount: number;
  expectedGuessers: number;
  // Live pins of the other hunters — populated only for watchers (target or
  // already-guessed); empty for active guessers and outside the finding phase.
  livePins: LiveGuess[];
  liveViews: LiveView[];
  liveCase: LiveCase | null;

  // results phase
  result: RoundResult | null;

  // HP mode: timestamp (ms) when the first player guessed this round.
  // Used to shrink the remaining timer to 15s for others.
  firstGuessTime: number | null;

  /**
   * Server-authoritative phase deadline (ms since epoch), or null when the
   * current phase has no time limit. The client renders its countdown from
   * this instead of a locally-started timer, so a refresh or a slow tab cannot
   * desync the clock.
   */
  deadlineAt: number | null;

  /** Every scored round so far this game, oldest first. */
  roundHistory: RoundHistoryEntry[];

  /** Vote-kick tallies, keyed by the target player id. */
  kickVotes: Record<string, number>;
  /** How many votes a kick needs right now (majority of connected seats). */
  kickVotesNeeded: number;
}

// ---------------------------------------------------------------------------
// Persistence: finished games, personal stats, leaderboard
// ---------------------------------------------------------------------------

/** One player's line in a finished game. */
export interface GameRecordPlayer {
  playerKey: string;
  name: string;
  emoji: string;
  totalScore: number;
  hp: number;
  guessMultiplier: number;
  /** 1-based final placement. */
  rank: number;
  /** Closest guess of the game, in km, or null when they never guessed. */
  bestDistanceKm: number | null;
  /** Guesses within PERFECT_DISTANCE_KM. */
  perfectGuesses: number;
  /** Rounds this player actually guessed in. */
  roundsGuessed: number;
}

/** A finished game, as written to the history store. */
export interface GameRecord {
  id: string;
  code: string;
  finishedAt: number;
  mode: GameMode;
  mapId: string;
  rounds: number;
  players: GameRecordPlayer[];
}

/** Aggregate stats for one player key. */
export interface PlayerStats {
  playerKey: string;
  games: number;
  wins: number;
  totalScore: number;
  bestScore: number;
  bestDistanceKm: number | null;
  perfectGuesses: number;
  roundsGuessed: number;
  /** Per-mode breakdown, keyed by GameMode. */
  byMode: Record<string, { games: number; wins: number; bestScore: number }>;
  /** Per-map breakdown, keyed by map id. */
  byMap: Record<string, { games: number; bestScore: number }>;
  /** Continent codes (from `continent:*` maps) this player has won on. */
  continentsWon: string[];
  achievements: string[];
  /** Most recent games, newest first. */
  recent: GameRecord[];
}

/** One row of the all-time leaderboard. */
export interface LeaderboardEntry {
  playerKey: string;
  name: string;
  emoji: string;
  score: number;
  bestDistanceKm: number | null;
  mapId: string;
  mode: GameMode;
  finishedAt: number;
}

// ---------------------------------------------------------------------------
// Socket payloads
// ---------------------------------------------------------------------------

export type CreateAck =
  | { ok: true; code: string; sessionToken: string; playerId: string }
  // "server_full": at capacity (room cap or per-socket limit) — try again later.
  | { ok: false; error: "server_full" };

export type JoinError =
  | "not_found"
  | "in_progress"
  | "name_taken"
  | "emoji_taken"
  | "full";

export type JoinAck =
  | { ok: true; sessionToken: string; playerId: string }
  // takenEmojis included on emoji_taken so the picker can refresh its disabled set.
  | { ok: false; error: JoinError; takenEmojis?: string[] };

export type PeekAck =
  | { ok: true; takenEmojis: string[] }
  | { ok: false };

export type ReconnectAck =
  | { ok: true; playerId: string }
  | { ok: false; error: "not_found" | "bad_token" };

// Acknowledgement for fire-and-forget game actions (start/hide/guess/next/lobby).
export type ActionAck =
  | { ok: true }
  | {
      ok: false;
      reason: "not_seated" | "rejected" | "frozen" |
        "Нельзя спрятаться за пределами выбранной страны" |
        "Нельзя спрятаться за пределами выбранного региона";
    };