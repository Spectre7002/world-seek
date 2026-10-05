// Shared types used by BOTH the Socket.IO server and the React client.

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
}

/**
 * "multiplayer" = the classic hide & seek (players hide, others guess).
 * "solo" = the game picks a random location each round and the lone player guesses.
 */
export type GameMode = "solo" | "multiplayer";

export interface LatLng {
  lat: number;
  lng: number;
}

export interface HidingSpot extends LatLng {
  /** Street View panorama id at this spot (broadcast to guessers instead of coords). */
  panoId: string;
}

export interface Guess extends LatLng {
  distanceKm: number;
  points: number;
}

// ---------------------------------------------------------------------------
// Server-internal model (never sent verbatim to clients).
// ---------------------------------------------------------------------------

export interface Player {
  id: string;
  name: string;
  emoji: string; // chosen avatar id (see src/shared/emojis.ts); unique per room
  sessionToken: string; // secret — never projected
  isGameMaster: boolean;
  connected: boolean;
  socketId: string | null; // live socket, for per-player emits
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
  totalScore: number;
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
  targets: HidingSpot[];
  cycleCount?: number; // Номер текущего круга пряток (от 1 до 5)
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
  hasHidden: boolean;
  totalScore: number;
}

export interface CurrentTarget {
  id: string;
  name: string;
  emoji: string;
  panoId: string; // imagery only; coords never sent here
}

export interface PublicGuess extends LatLng {
  playerId: string;
  name: string;
  emoji: string;
  distanceKm: number;
  points: number;
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

export interface PublicState {
  code: string;
  phase: Phase;
  solo: boolean; // true when this is a single-player game (system-picked locations)
  settings: Settings;
  gameMasterId: string;
  players: PublicPlayer[];

  youId: string;
  youEmoji: string; // viewer's own avatar — for their dropped pin
  youAreGameMaster: boolean;

  // hiding phase
  youHaveHidden: boolean;
  hiddenCount: number;
  expectedHiders: number;

  // finding phase
  currentRound: number;
  totalRounds: number;
  currentTarget: CurrentTarget | null; // null when you are the target
  youAreTarget: boolean;
  youHaveGuessed: boolean;
  guessedCount: number;
  expectedGuessers: number;
  // Live pins of the other hunters — populated only for watchers (target or
  // already-guessed); empty for active guessers and outside the finding phase.
  livePins: LiveGuess[];
  liveViews: LiveView[];

  // results phase
  result: RoundResult | null;
}

// ---------------------------------------------------------------------------
// Socket payloads
// ---------------------------------------------------------------------------

export type CreateAck =
  | { ok: true; code: string; sessionToken: string; playerId: string }
  // "server_full": at capacity (room cap or per-socket limit) — try again later.
  // "budget": this month's Google Maps budget is spent, so the site is closed
  // until the 1st. Not retriable; the client shows the self-host page.
  | { ok: false; error: "server_full" | "budget" };

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
  | { ok: false; reason: "not_seated" | "rejected" | "budget" };