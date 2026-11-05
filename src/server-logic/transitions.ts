import {
  DEFAULT_SETTINGS,
  type Guess,
  type HidingSpot,
  type LatLng,
  type Location,
  type Player,
  type PublicGuess,
  type Room,
  type RoundHistoryEntry,
  type Settings,
} from "../shared/types";
import { isAvailableMap, pickLocation, type MapId } from "./locations";
import { computeScore, haversineKm } from "../shared/scoring";
import { generatePlayerId, generateRoomCode, generateToken } from "../shared/codes";
import { DEFAULT_EMOJI, isValidEmoji } from "../shared/emojis";
import { emptySpellCounts, FREEZE_DURATION_MS } from "../shared/spells";
import { PERFECT_DISTANCE_KM } from "../shared/achievements";
import { recordFinishedGame } from "./history";
import { getRoom } from "./store";
import { getCountryName } from "./boundaries";

const MAX_PLAYERS = 10;

/**
 * Queue a server-generated chat line. Transitions have no socket access, so the
 * text is parked on the room and the next broadcast flushes it into the chat
 * history. Capped so a long game cannot grow the queue without bound.
 */
export function systemMessage(room: Room, text: string): void {
  if (!room.pendingSystem) room.pendingSystem = [];
  room.pendingSystem.push(text);
  if (room.pendingSystem.length > 20) {
    room.pendingSystem.splice(0, room.pendingSystem.length - 20);
  }
}

/**
 * Pick the next location for a server-picked round.
 *
 * Every server-picked path goes through here so a seeded game cannot mix a
 * random location into the sequence: with a seed the result is a pure function
 * of (seed, cursor), and the cursor advances exactly once per pick.
 */
function nextLocation(room: Room, mapId: MapId): Location {
  const cursor = room.seedCursor ?? 0;
  const location = pickLocation(mapId, room.settings.seed, cursor);
  room.seedCursor = cursor + 1;
  return location;
}

/** The map id a room is actually playing on (falls back to the global pool). */
function roomMapId(room: Room): MapId {
  return isAvailableMap(room.settings.selectedMap) ? room.settings.selectedMap : "global";
}

/**
 * HP mode: once the first player locks in a guess, everyone else gets this long
 * before the round is scored. Enforced server-side so the rule holds even when
 * `findingTimeLimit` is 0 or longer than the grace window.
 */
const HP_FIRST_GUESS_GRACE_MS = 15_000;

/**
 * A room code that is not already in use.
 *
 * `generateRoomCode` is random, but nothing checked the result against the live
 * store: a collision silently overwrote the existing room, evicting its players
 * mid-game. The space is large (~2.4e8 codes) so a retry loop is effectively
 * free, and the bounded attempt count keeps a pathological store from hanging.
 */
function uniqueRoomCode(): string {
  for (let attempt = 0; attempt < 20; attempt++) {
    const code = generateRoomCode();
    if (!getRoom(code)) return code;
  }
  // Fall back to a longer, timestamp-salted code rather than overwriting a room.
  return generateRoomCode() + "-" + Date.now().toString(36).slice(-4);
}

export function createRoom(
  gmName: string,
  settings?: Partial<Settings>,
  gmEmoji?: string,
  gmPlayerKey?: string,
): {
  room: Room;
  player: Player;
} {
  const player = newPlayer(gmName, true, gmEmoji, gmPlayerKey);
  const room: Room = {
    code: uniqueRoomCode(),
    phase: "lobby",
    mode: "multiplayer",
    settings: { ...DEFAULT_SETTINGS, ...settings },
    gameMasterId: player.id,
    players: [player],
    order: [],
    currentRound: 0,
    targets: [],
    cycleCount: 1,
    roundHistory: [],
    seedCursor: 0,
    kickVotes: {},
  };
  return { room: room, player: player };
}

function newPlayer(
  name: string,
  isGameMaster: boolean,
  emoji?: string,
  playerKey?: string,
): Player {
  return {
    id: generatePlayerId(),
    name: String(name ?? "").trim().slice(0, 24) || "Player",
    emoji: emoji && isValidEmoji(emoji) ? emoji : DEFAULT_EMOJI,
    sessionToken: generateToken(),
    // A stable cross-game identity for stats. Falls back to the per-room id so
    // a client that never sent one still produces a usable (if unlinked) row.
    playerKey: typeof playerKey === "string" && playerKey.length > 0
      ? playerKey.slice(0, 64)
      : "",
    isGameMaster: isGameMaster,
    connected: true,
    socketId: null,
    joinedAt: Date.now(),
    spectator: false,
    hiding: null,
    hasHidden: false,
    guesses: {},
    livePin: null,
    liveView: null,
    totalScore: 0,
    hp: 10000,
    guessMultiplier: 1,
    caseOpenedRound: 0,
    spells: emptySpellCounts(),
    casePity: 0,
    lastCaseItem: null,
    frozenUntil: null,
    roundsScored: 0,
    bestDistanceKm: null,
    perfectGuesses: 0,
  };
}

/**
 * Fold one scored guess into the player's whole-game counters. Kept separate
 * from `totalScore` so the finished-game record stays accurate even though
 * classic multiplayer clears `guesses` at the end of every cycle.
 */
function tallyGuess(p: Player, g: Guess): void {
  p.roundsScored += 1;
  if (p.bestDistanceKm === null || g.distanceKm < p.bestDistanceKm) {
    p.bestDistanceKm = g.distanceKm;
  }
  if (g.distanceKm <= PERFECT_DISTANCE_KM) p.perfectGuesses += 1;
}

/** True while a FREEZE spell is blocking this player from locking a guess. */
export function isFrozen(player: Player, now: number = Date.now()): boolean {
  return player.frozenUntil != null && player.frozenUntil > now;
}

/**
 * Apply a FREEZE spell: block the current HP leader from guessing for a while.
 * Returns the frozen player, or null when there is nobody sensible to freeze
 * (solo game, everyone frozen already, or the caster is the only player).
 */
export function applyFreeze(room: Room, casterId: string): Player | null {
  const now = Date.now();
  const candidates = connectedPlayers(room).filter(
    (p) => p.id !== casterId && !isFrozen(p, now),
  );
  if (candidates.length === 0) return null;
  // Freeze the strongest rival: the highest HP, then the highest multiplier.
  let target = candidates[0];
  for (let i = 1; i < candidates.length; i++) {
    const c = candidates[i];
    if (c.hp > target.hp || (c.hp === target.hp && c.guessMultiplier > target.guessMultiplier)) {
      target = c;
    }
  }
  target.frozenUntil = now + FREEZE_DURATION_MS;
  return target;
}

export function takenEmojis(room: Room): string[] {
  const result: string[] = [];
  for (let i = 0; i < room.players.length; i++) {
    result.push(room.players[i].emoji);
  }
  return result;
}

export type AddResult =
  | { ok: true; player: Player }
  | { ok: false; error: "in_progress" | "name_taken" | "emoji_taken" | "full" };

export function addPlayer(
  room: Room,
  name: string,
  emoji?: string,
  playerKey?: string,
): AddResult {
  // A late joiner is not turned away any more: they take a spectator seat and
  // are promoted to a real player when the room returns to the lobby.
  //
  // Only the lobby hands out real seats. A join during `finished` must also be
  // a spectator: the game is over, so seating them would drop a 0-point player
  // into the final standings. They get a seat on the next return to the lobby.
  const spectator = room.phase !== "lobby";
  if (room.players.length >= MAX_PLAYERS) return { ok: false, error: "full" };
  const trimmed = String(name ?? "").trim().slice(0, 24);

  for (let i = 0; i < room.players.length; i++) {
    if (room.players[i].name.toLowerCase() === trimmed.toLowerCase()) {
      return { ok: false, error: "name_taken" };
    }
  }

  const resolved = emoji && isValidEmoji(emoji) ? emoji : DEFAULT_EMOJI;
  for (let i = 0; i < room.players.length; i++) {
    if (room.players[i].emoji === resolved) {
      return { ok: false, error: "emoji_taken" };
    }
  }

  const player = newPlayer(trimmed, false, resolved, playerKey);
  player.spectator = spectator;
  room.players.push(player);
  systemMessage(
    room,
    spectator
      ? trimmed + " joined as a spectator"
      : trimmed + " joined the lobby",
  );
  return { ok: true, player: player };
}

export function findPlayer(room: Room, playerId: string): Player | undefined {
  for (let i = 0; i < room.players.length; i++) {
    if (room.players[i].id === playerId) {
      return room.players[i];
    }
  }
  return undefined;
}

export function findByToken(room: Room, token: string): Player | undefined {
  for (let i = 0; i < room.players.length; i++) {
    if (room.players[i].sessionToken === token) {
      return room.players[i];
    }
  }
  return undefined;
}

/**
 * Connected players who actually hold a seat. Spectators are connected but are
 * not part of the round, so every "is everyone ready / has everyone guessed"
 * check must ignore them or a late joiner would stall the phase forever.
 */
export function connectedPlayers(room: Room): Player[] {
  const result: Player[] = [];
  for (let i = 0; i < room.players.length; i++) {
    const p = room.players[i];
    if (p.connected && !p.spectator) {
      result.push(p);
    }
  }
  return result;
}

/** Connected spectators (late joiners watching the running game). */
export function connectedSpectators(room: Room): Player[] {
  const result: Player[] = [];
  for (let i = 0; i < room.players.length; i++) {
    const p = room.players[i];
    if (p.connected && p.spectator) {
      result.push(p);
    }
  }
  return result;
}

/**
 * Hand the host role to the longest-connected remaining player. Used when the
 * game master disconnects or leaves mid-game, so the room survives instead of
 * being closed for everyone.
 */
export function promoteGameMaster(room: Room): Player | null {
  const candidates = connectedPlayers(room);
  if (candidates.length === 0) return null;
  let next = candidates[0];
  for (let i = 1; i < candidates.length; i++) {
    if (candidates[i].joinedAt < next.joinedAt) next = candidates[i];
  }
  for (let i = 0; i < room.players.length; i++) {
    room.players[i].isGameMaster = room.players[i].id === next.id;
  }
  room.gameMasterId = next.id;
  return next;
}

/**
 * True when the server picked the location instead of a player hiding. Covers
 * both solo and HP mode, which share the location-picking path.
 */
export function isServerPicked(room: Room): boolean {
  return room.mode === "solo" || room.mode === "hp";
}

/**
 * Recompute the phase deadline. Called at the end of every transition that
 * changes the phase, so the value is stamped once per phase instead of being
 * recomputed on each broadcast (which would push it forward forever).
 */
/**
 * A turn id that is unique across a whole game, and never 0.
 *
 * In classic multiplayer `currentRound` is the cycle index and repeats for
 * every target in that cycle, so anything that must reset per turn keys on
 * this instead. The round-history log and the client projection MUST use the
 * same formula, or the results screen cannot match a log entry to the round it
 * is displaying.
 *
 * The value is deliberately 1-based: `Player.caseOpenedRound` uses 0 as its
 * "never opened a case" sentinel, so a turn id of 0 on the first turn would
 * make the first case of every game (and every solo/HP round) look already
 * spent. `cycleCount` is 1-based.
 */
export function roundTurnKey(room: Room): number {
  if (isServerPicked(room)) return room.currentRound + 1;
  return (room.cycleCount || 1) * 10 + room.currentRound;
}

export function refreshDeadline(room: Room): void {
  if (room.phase === "hiding") {
    const limit = room.settings.hidingTimeLimit || 0;
    room.deadlineAt = limit > 0 ? Date.now() + limit * 1000 : null;
    return;
  }
  if (room.phase === "finding") {
    const limit = room.settings.findingTimeLimit || 0;
    room.deadlineAt = limit > 0 ? Date.now() + limit * 1000 : null;
    return;
  }
  // Lobby, results and finished are host-driven: no server deadline.
  room.deadlineAt = null;
}

export function removePlayer(
  room: Room,
  playerId: string,
): { removed: boolean; wasCurrentTarget: boolean } {
  let idx = -1;
  for (let i = 0; i < room.players.length; i++) {
    if (room.players[i].id === playerId) {
      idx = i;
      break;
    }
  }
  if (idx === -1) return { removed: false, wasCurrentTarget: false };
  const wasCurrentTarget = currentTargetId(room) === playerId;
  const leavingName = room.players[idx].name;

  room.players.splice(idx, 1);
  systemMessage(room, leavingName + " left the game");
  // A departed player's kick votes are meaningless now, and their own tally
  // must not keep a stale target alive.
  if (room.kickVotes) {
    delete room.kickVotes[playerId];
    for (const targetId of Object.keys(room.kickVotes)) {
      room.kickVotes[targetId] = room.kickVotes[targetId].filter((id) => id !== playerId);
      if (room.kickVotes[targetId].length === 0) delete room.kickVotes[targetId];
    }
  }

  for (let i = 0; i < room.players.length; i++) {
    const p = room.players[i];
    delete p.guesses[playerId];
    if (p.livePin && p.livePin.targetId === playerId) {
      p.livePin = null;
    }
    if (p.liveView && p.liveView.targetId === playerId) {
      p.liveView = null;
    }
  }

  const orderIdx = room.order.indexOf(playerId);
  if (orderIdx !== -1) {
    room.order.splice(orderIdx, 1);
    // Only shift the cursor when the removed player sat BEFORE the current
    // target. Using `<=` also matched the current target itself, which rewound
    // the round and replayed the previous target's turn.
    if (orderIdx < room.currentRound) {
      room.currentRound -= 1;
    }
  }
  return { removed: true, wasCurrentTarget: wasCurrentTarget };
}

export function startGame(room: Room): boolean {
  if (room.phase !== "lobby") return false;
  const connected = connectedPlayers(room);
  // Count seats, not rows: a spectator who is still watching must not make a
  // one-player room look like a two-player game.
  const seated = room.players.filter((p) => !p.spectator).length;
  if (seated < 2) {
    if (room.settings.gameMode === "hp") {
      room.settings.gameMode = "classic";
    }
    if (connected.length === 1) return startSolo(room);
    return false;
  }
  if (connected.length < 2) return false;

  if (room.settings.gameMode === "hp") {
    return startHpGame(room);
  }

  room.mode = "multiplayer";
  room.phase = "hiding";
  room.cycleCount = 1;
  room.deadlineAt = null;
  // A fresh game starts with an empty log and an unrecorded result.
  room.roundHistory = [];
  room.historyRecorded = false;
  room.seedCursor = 0;
  room.kickVotes = {};
  systemMessage(room, "Game started — everyone is hiding");

  for (let i = 0; i < room.players.length; i++) {
    const p = room.players[i];
    p.hiding = null;
    p.hasHidden = false;
    p.guesses = {};
    p.livePin = null;
    p.liveView = null;
p.hp = 10000;
p.guessMultiplier = 1;
    p.totalScore = 0;
    p.frozenUntil = null;
    // A case is per-turn: clear the "opened this turn" latch so the first turn
    // of the new game is not refused with "already_opened".
    p.caseOpenedRound = 0;
    p.roundsScored = 0;
    p.bestDistanceKm = null;
    p.perfectGuesses = 0;
  }
  refreshDeadline(room);

  function resetRoundPlayers(room: Room): void {
    for (let i = 0; i < room.players.length; i++) {
      const p = room.players[i];
      p.hiding = null;
      p.hasHidden = false;
      p.guesses = {};
      p.livePin = null;
      p.liveView = null;
      p.hp = 10000;
      p.totalScore = 0;
      p.guessMultiplier = 1;
      p.frozenUntil = null;
      p.caseOpenedRound = 0;
      p.roundsScored = 0;
      p.bestDistanceKm = null;
      p.perfectGuesses = 0;
    }
  }

  function startHpGame(room: Room): boolean {
    // HP is its own mode now. It used to reuse "solo", which made the
    // projection report a 3-player HP match as a single-player game.
    room.mode = "hp";
    room.phase = "finding";
    room.order = [];
    room.targets = [];
    room.currentRound = 0;
    room.firstGuessTime = null;
    room.roundHistory = [];
    room.historyRecorded = false;
    room.seedCursor = 0;
    room.kickVotes = {};
    room.targets[0] = nextLocation(room, roomMapId(room));
    resetRoundPlayers(room);
    systemMessage(room, "HP match started — round 1");
    refreshDeadline(room);
    return true;
  }
  return true;
}

export function recordHide(room: Room, playerId: string, spot: HidingSpot): boolean {
  if (room.phase !== "hiding") return false;
  const p = findPlayer(room, playerId);
  // A spectator has no seat, so they cannot take part in the round.
  if (!p || p.spectator) return false;
  p.hiding = spot;
  p.hasHidden = true;
  return true;
}

export function allConnectedHidden(room: Room): boolean {
  const connected = connectedPlayers(room);
  // Fewer than two connected players means the hiding phase can never complete
  // on its own (there is nobody left to hide). Report it as done so the caller
  // advances instead of leaving the room stuck in `hiding` forever.
  if (connected.length < 2) return true;
  for (let i = 0; i < connected.length; i++) {
    if (!connected[i].hasHidden) return false;
  }
  return true;
}

export function startFinding(room: Room): boolean {
  const hiddenIds: string[] = [];
  for (let i = 0; i < room.players.length; i++) {
    const p = room.players[i];
    if (p.hasHidden && p.hiding) {
      hiddenIds.push(p.id);
    }
  }
  if (hiddenIds.length < 2) return false;
  room.order = shuffle(hiddenIds);
  room.currentRound = 0;
  room.phase = "finding";
  refreshDeadline(room);
  systemMessage(room, "Everyone is hidden — the hunt begins");
  return true;
}

export function currentTargetId(room: Room): string | null {
  if (room.phase !== "finding" && room.phase !== "results") return null;
  if (room.order.length === 0) return null;
  const safeIdx = Math.min(room.currentRound, room.order.length - 1);
  return room.order[safeIdx] ?? null;
}

/**
 * Append one scored round to the room's history log. Called from both scoring
 * paths so the log is built from exactly the data the results projection shows.
 */
function pushRoundHistory(
  room: Room,
  targetName: string,
  targetEmoji: string,
  real: LatLng,
  guesses: PublicGuess[],
): void {
  if (!room.roundHistory) room.roundHistory = [];
  const entry: RoundHistoryEntry = {
    roundKey: roundTurnKey(room),
    round: room.roundHistory.length + 1,
    mapId: room.settings.selectedMap || "global",
    serverPicked: isServerPicked(room),
    targetName: targetName,
    targetEmoji: targetEmoji,
    real: { lat: real.lat, lng: real.lng },
    guesses: guesses,
    scoredAt: Date.now(),
  };
  room.roundHistory.push(entry);
}

/**
 * End the game and persist the result. Every path that sets `phase` to
 * "finished" goes through here, so a game can never finish without being
 * recorded — and `recordFinishedGame` is idempotent, so a double call is safe.
 */
export function finishGame(room: Room): void {
  room.phase = "finished";
  refreshDeadline(room);
  systemMessage(room, "Game over");
  recordFinishedGame(room);
}

export function recordGuess(room: Room, guesserId: string, at: LatLng): boolean {
  if (room.phase !== "finding") return false;
  const targetId = currentTargetId(room);
  if (!targetId || guesserId === targetId) return false;
  const guesser = findPlayer(room, guesserId);
  const target = findPlayer(room, targetId);
  if (!guesser || guesser.spectator || !target || !target.hiding) return false;
  // A FREEZE spell blocks the guess outright; the client shows a countdown.
  if (isFrozen(guesser)) return false;
  // One guess per turn. Without this a player could re-submit and overwrite a
  // bad guess with a better one after watching the live pins — solo already
  // had this guard, classic did not.
  if (guesser.guesses[targetId]) return false;

  const distanceKm = haversineKm(at, target.hiding);
  const points = computeScore(distanceKm, room.settings);

  guesser.guesses[targetId] = { lat: at.lat, lng: at.lng, distanceKm: distanceKm, points: points };
  guesser.livePin = null;
  guesser.liveView = null;
  return true;
}

export function recordLivePin(room: Room, guesserId: string, at: LatLng): boolean {
  if (room.phase !== "finding") return false;
  const guesser = findPlayer(room, guesserId);
  if (!guesser || guesser.spectator) return false;

  // HP mode: use sentinel "hp" as targetId for live pins
  if (room.settings.gameMode === "hp") {
    const soloKey = "solo-" + room.currentRound;
    if (guesser.guesses[soloKey]) return false; // already guessed
    guesser.livePin = { targetId: "hp", lat: at.lat, lng: at.lng };
    return true;
  }

  const targetId = currentTargetId(room);
  if (!targetId || guesserId === targetId) return false;
  const target = findPlayer(room, targetId);
  if (!target || !target.hiding) return false;
  if (guesser.guesses[targetId]) return false;
  guesser.livePin = { targetId: targetId, lat: at.lat, lng: at.lng };
  return true;
}

export function recordLiveView(
  room: Room,
  guesserId: string,
  view: { panoId: string; heading: number; pitch: number; zoom: number },
): boolean {
  if (room.phase !== "finding") return false;
  const guesser = findPlayer(room, guesserId);
  if (!guesser || guesser.spectator) return false;

  // HP mode: all players guess a shared anonymous location.
  // Store the view without requiring a target player.
  if (room.settings.gameMode === "hp") {
    // Only store view for players who haven't guessed yet (still active hunters).
    const soloKey = "solo-" + room.currentRound;
    if (guesser.guesses[soloKey]) return false; // already guessed, no need to sync
    guesser.liveView = {
      targetId: "hp", // sentinel value for HP mode
      panoId: view.panoId,
      heading: view.heading,
      pitch: view.pitch,
      zoom: view.zoom,
    };
    return true;
  }

  // Classic mode: guessing against a specific hider.
  const targetId = currentTargetId(room);
  if (!targetId || guesserId === targetId) return false;
  const target = findPlayer(room, targetId);
  if (!target || !target.hiding) return false;
  if (guesser.guesses[targetId]) return false;
  guesser.liveView = {
    targetId: targetId,
    panoId: view.panoId,
    heading: view.heading,
    pitch: view.pitch,
    zoom: view.zoom,
  };
  return true;
}

export function expectedGuessers(room: Room): Player[] {
  const targetId = currentTargetId(room);
  const orderSet = new Set(room.order);
  const result: Player[] = [];
  for (let i = 0; i < room.players.length; i++) {
    const p = room.players[i];
    if (p.connected && orderSet.has(p.id) && p.id !== targetId) {
      result.push(p);
    }
  }
  return result;
}

export function allGuessed(room: Room): boolean {
  const targetId = currentTargetId(room);
  if (!targetId) return false;
  const expected = expectedGuessers(room);
  if (expected.length === 0) return false;
  for (let i = 0; i < expected.length; i++) {
    if (!expected[i].guesses[targetId]) return false;
  }
  return true;
}

export function scoreRound(room: Room): boolean {
  if (room.phase !== "finding") return false;
  const targetId = currentTargetId(room);
  if (!targetId) return false;
  const target = findPlayer(room, targetId);
  const guesses: PublicGuess[] = [];
  for (let i = 0; i < room.players.length; i++) {
    const p = room.players[i];
    const g = p.guesses[targetId];
    if (g) {
      p.totalScore += g.points;
      tallyGuess(p, g);
      guesses.push({
        playerId: p.id,
        name: p.name,
        emoji: p.emoji,
        lat: g.lat,
        lng: g.lng,
        distanceKm: g.distanceKm,
        points: g.points,
        damage: g.damage,
        appliedMultiplier: g.appliedMultiplier,
      });
    }
  }
  if (target && target.hiding) {
    guesses.sort(function (a, b) {
      return b.points - a.points;
    });
    pushRoundHistory(room, target.name, target.emoji, target.hiding, guesses);
  }
  room.phase = "results";
  refreshDeadline(room);
  return true;
}

export function nextRound(room: Room): boolean {
  if (room.phase !== "results") return false;

  // A case belongs to one turn; drop it as soon as the turn ends.
  room.liveCase = null;

  if (room.currentRound + 1 >= room.order.length) {
    const currentCycle = room.cycleCount || 1;
    const maxCycles = room.settings.multiplayerCycles || 5;

    if (currentCycle < maxCycles) {
      room.cycleCount = currentCycle + 1;
      room.phase = "hiding";
      room.order = [];
      room.currentRound = 0;
      for (let i = 0; i < room.players.length; i++) {
        const p = room.players[i];
        p.hiding = null;
        p.hasHidden = false;
        p.guesses = {};
        p.livePin = null;
        p.liveView = null;
      }
    } else {
      finishGame(room);
      return true;
    }
  } else {
    room.currentRound += 1;
    room.phase = "finding";
    for (let i = 0; i < room.players.length; i++) {
      room.players[i].liveView = null;
      room.players[i].livePin = null;
    }
  }
  refreshDeadline(room);
  return true;
}

export function returnToLobby(room: Room, announce = true): boolean {
  room.phase = "lobby";
  room.mode = "multiplayer";
  room.liveCase = null;
  // A new game starts from the lobby, so the previous game's log and its
  // "already recorded" flag must not leak into it.
  room.roundHistory = [];
  room.historyRecorded = false;
  room.seedCursor = 0;
  room.kickVotes = {};
  if (connectedPlayers(room).length < 2) {
    room.settings.gameMode = "classic";
  }
  room.order = [];
  room.targets = [];
  room.currentRound = 0;
  room.cycleCount = 1;
  room.firstGuessTime = null;
  for (let i = 0; i < room.players.length; i++) {
    const p = room.players[i];
    p.hiding = null;
    p.hasHidden = false;
    p.guesses = {};
    p.livePin = null;
    p.liveView = null;
    p.totalScore = 0;
p.hp = 10000;
p.guessMultiplier = 1;
    p.frozenUntil = null;
    // Must reset here too, or the first turn of the next game in this room is
    // blocked by a stale "case already opened" latch.
    p.caseOpenedRound = 0;
    p.roundsScored = 0;
    p.bestDistanceKm = null;
    p.perfectGuesses = 0;
  }
  // Late joiners were only watching; the lobby is where they get a real seat.
  seatSpectators(room);
  refreshDeadline(room);
  if (announce) systemMessage(room, "Back in the lobby");
  return true;
}

/**
 * Rematch: restart immediately with the same players and settings.
 *
 * This is `returnToLobby` + `startGame` in one step, so the host does not have
 * to click twice and the room never flashes the lobby between games. It is
 * deliberately not a new room: the code, the seats and the settings all stay,
 * which is the whole point of a rematch.
 *
 * Returns false when the room is not finished or cannot start (fewer than two
 * connected seats and not a solo game).
 */
export function rematch(room: Room): boolean {
  if (room.phase !== "finished") return false;
  // Suppress the "back in the lobby" line: the room never actually shows the
  // lobby, so announcing it would be a lie followed by "Rematch!".
  if (!returnToLobby(room, false)) return false;
  if (!startGame(room)) {
    // startGame refused (e.g. everyone but one player left): stay in the lobby
    // rather than leaving the room in a half-reset state.
    return false;
  }
  systemMessage(room, "Rematch!");
  return true;
}

/**
 * How many votes a kick needs: a strict majority of the connected seats,
 * excluding the target. With two players that is 1 vote, with four it is 2.
 */
export function kickVotesNeeded(room: Room, targetId: string): number {
  const eligible = connectedPlayers(room).filter((p) => p.id !== targetId).length;
  if (eligible <= 0) return 0;
  return Math.floor(eligible / 2) + 1;
}

/**
 * Record a vote to kick `targetId`. The host's vote counts double, so a host
 * can remove a griefer without needing a majority of the room.
 *
 * Returns the current tally, or null when the vote is not allowed (unknown
 * target, target is the host, target is not connected, or the voter is the
 * target).
 */
export function voteKick(
  room: Room,
  voterId: string,
  targetId: string,
): { votes: number; needed: number; kicked: boolean } | null {
  if (voterId === targetId) return null;
  const voter = findPlayer(room, voterId);
  const target = findPlayer(room, targetId);
  if (!voter || !target || !target.connected) return null;
  // The host cannot be voted out: that would leave the room without the one
  // player who can advance phases.
  if (target.isGameMaster) return null;

  if (!room.kickVotes) room.kickVotes = {};
  const votes = room.kickVotes[targetId] ?? [];
  if (!votes.includes(voterId)) votes.push(voterId);
  room.kickVotes[targetId] = votes;

  const needed = kickVotesNeeded(room, targetId);
  const tally = kickTally(room, targetId);
  const kicked = needed > 0 && tally >= needed;
  return { votes: tally, needed: needed, kicked: kicked };
}

/**
 * The weighted vote count for a target.
 *
 * The host's vote counts double, so a host can remove a griefer without
 * needing a majority of the room. The weighting is applied when reading the
 * tally rather than when storing it, so `kickVotes` stays a plain set of ids
 * and a host succession cannot retroactively change past votes.
 */
export function kickTally(room: Room, targetId: string): number {
  const votes = room.kickVotes?.[targetId];
  if (!votes || votes.length === 0) return 0;
  return votes.length + (votes.includes(room.gameMasterId) ? 1 : 0);
}

/** Clear a kick tally (after a successful kick, or when the target leaves). */
export function clearKickVotes(room: Room, targetId: string): void {
  if (room.kickVotes) delete room.kickVotes[targetId];
}

/**
 * Promote every connected spectator to a real player. Called when the room
 * returns to the lobby, which is the only point where a new seat is safe.
 */
export function seatSpectators(room: Room): number {
  let seated = 0;
  for (let i = 0; i < room.players.length; i++) {
    const p = room.players[i];
    if (p.spectator && p.connected) {
      p.spectator = false;
      p.hiding = null;
      p.hasHidden = false;
      p.guesses = {};
      p.livePin = null;
      p.liveView = null;
      p.totalScore = 0;
      p.hp = 10000;
      p.guessMultiplier = 1;
      p.frozenUntil = null;
      p.caseOpenedRound = 0;
      p.roundsScored = 0;
      p.bestDistanceKm = null;
      p.perfectGuesses = 0;
      seated++;
    }
  }
  return seated;
}

function soloTargetKey(round: number): string {
  return "solo-" + round;
}

export function startSolo(room: Room): boolean {
  if (room.phase !== "lobby") return false;
  if (connectedPlayers(room).length !== 1) return false;
  room.mode = "solo";
  room.phase = "finding";
  room.order = [];
  room.currentRound = 0;
  room.roundHistory = [];
  room.historyRecorded = false;
  room.seedCursor = 0;
  room.targets = [nextLocation(room, roomMapId(room))];
  for (let i = 0; i < room.players.length; i++) {
    const p = room.players[i];
    p.hiding = null;
    p.hasHidden = false;
    p.guesses = {};
    p.livePin = null;
    p.liveView = null;
    p.totalScore = 0;
p.hp = 10000;
    p.frozenUntil = null;
    p.caseOpenedRound = 0;
    p.roundsScored = 0;
    p.bestDistanceKm = null;
    p.perfectGuesses = 0;
  }
  refreshDeadline(room);
  return true;
}

export function soloTarget(room: Room): Location | null {
  if (!isServerPicked(room)) return null;
  return room.targets[room.currentRound] ?? null;
}

export function recordSoloGuess(room: Room, playerId: string, at: LatLng): boolean {
  if (!isServerPicked(room) || room.phase !== "finding") return false;
  const target = room.targets[room.currentRound];
  if (!target) return false;
  const player = findPlayer(room, playerId);
  if (!player || player.spectator) return false;
  // A FREEZE spell blocks the guess outright; the client shows a countdown.
  if (isFrozen(player)) return false;
  // One guess per player per round. Without this a player could re-submit and
  // overwrite a bad guess with a better one after seeing the results.
  if (player.guesses[soloTargetKey(room.currentRound)]) return false;
  
  const distanceKm = haversineKm(at, target);
  const points = computeScore(distanceKm, room.settings);
  player.guesses[soloTargetKey(room.currentRound)] = {
    lat: at.lat,
    lng: at.lng,
    distanceKm: distanceKm,
    points: points,
  };
  player.livePin = null;
  player.liveView = null;

  // HP mode: the first guess in starts a 15-second countdown for everyone else.
  // This has to be enforced here, not only in the client: the client timer is
  // now a display driven by `deadlineAt`, so a client-only cap would be ignored
  // and the server would wait out the full configured limit. It also guarantees
  // the round ends even when `findingTimeLimit` is 0 (no deadline at all).
  if (room.mode === "hp" && !room.firstGuessTime) {
    const now = Date.now();
    room.firstGuessTime = now;
    const hpDeadline = now + HP_FIRST_GUESS_GRACE_MS;
    // Never extend a deadline that is already sooner than the grace window.
    if (room.deadlineAt == null || hpDeadline < room.deadlineAt) {
      room.deadlineAt = hpDeadline;
    }
  }

  return true;
}

export function soloGuess(room: Room, playerId: string) {
  const player = findPlayer(room, playerId);
  return player?.guesses[soloTargetKey(room.currentRound)] ?? null;
}

/**
 * True when every connected seated player has locked in a guess for the
 * current server-picked round. HP damage is relative, so the round can only be
 * scored once everyone has guessed (or the phase clock expires).
 */
export function allServerPickedGuessed(room: Room): boolean {
  if (!isServerPicked(room)) return false;
  const connected = connectedPlayers(room);
  if (connected.length === 0) return false;
  const key = soloTargetKey(room.currentRound);
  for (let i = 0; i < connected.length; i++) {
    if (!connected[i].guesses[key]) return false;
  }
  return true;
}

/**
 * Score a server-picked round.
 *
 * `force` is used by the phase clock when the finding timer expires before
 * everyone has guessed. Without it, HP scoring would refuse to run (damage is
 * relative, so it normally waits for every guess) and the expired phase would
 * never advance — the clock would re-fire every tick forever. In forced mode
 * only the players who actually guessed are scored; a non-guesser takes no
 * points and no damage, which is the documented timeout behaviour.
 */
export function scoreSoloRound(room: Room, playerId: string, force = false): boolean {
  if (!isServerPicked(room) || room.phase !== "finding") return false;
  const player = findPlayer(room, playerId);
  const g = player?.guesses[soloTargetKey(room.currentRound)];
  if (!player || !g) return false;
  if (room.mode === "hp") {
    const connected = connectedPlayers(room);
    if (!force) {
      for (let i = 0; i < connected.length; i++) {
        const guess = connected[i].guesses[soloTargetKey(room.currentRound)];
        if (!guess) return false;
      }
    }
    const guessers = connected.filter(
      (p) => p.guesses[soloTargetKey(room.currentRound)],
    );
    if (guessers.length === 0) return false;
    let top = guessers[0];
    for (let i = 1; i < guessers.length; i++) {
      const candidate = guessers[i];
      const topGuess = top.guesses[soloTargetKey(room.currentRound)];
      const candidateGuess = candidate.guesses[soloTargetKey(room.currentRound)];
      if (candidateGuess && topGuess && candidateGuess.points > topGuess.points) {
        top = candidate;
      }
    }
    const topGuess = top.guesses[soloTargetKey(room.currentRound)];
    const multiplier = top.guessMultiplier ?? 1;
    for (let i = 0; i < guessers.length; i++) {
      const current = guessers[i];
      const guess = current.guesses[soloTargetKey(room.currentRound)];
      if (!guess || !topGuess) continue;
      current.totalScore += guess.points;
      tallyGuess(current, guess);
      guess.appliedMultiplier = multiplier;
      if (current.id !== top.id) {
        guess.damage = Math.max(0, Math.floor((topGuess.points - guess.points) * multiplier));
        current.hp = Math.max(0, current.hp - guess.damage);
      } else {
        guess.damage = 0;
        top.guessMultiplier += 0.5;
      }
    }
  } else {
    player.totalScore += g.points;
    tallyGuess(player, g);
  }

  // Log the round. HP rounds are shared by the whole lobby, so every guesser
  // appears; a solo round has exactly one.
  const target = room.targets[room.currentRound];
  if (target) {
    const key = soloTargetKey(room.currentRound);
    const logged: PublicGuess[] = [];
    const source = room.mode === "hp" ? room.players : player ? [player] : [];
    for (let i = 0; i < source.length; i++) {
      const p = source[i];
      const guess = p.guesses[key];
      if (!guess) continue;
      logged.push({
        playerId: p.id,
        name: p.name,
        emoji: p.emoji,
        lat: guess.lat,
        lng: guess.lng,
        distanceKm: guess.distanceKm,
        points: guess.points,
        damage: guess.damage,
        appliedMultiplier: guess.appliedMultiplier,
      });
    }
    logged.sort(function (a, b) {
      return b.points - a.points;
    });
    pushRoundHistory(
      room,
      getCountryName(target.lat, target.lng) ?? "Mystery location",
      DEFAULT_EMOJI,
      target,
      logged,
    );
  }

  room.phase = "results";
  refreshDeadline(room);
  return true;
}

/**
 * HP matches end when someone is eliminated, but identical guesses deal zero
 * damage, so a match could otherwise run forever. Cap it at the configured
 * round count and let the final standings break the tie.
 */
const HP_MAX_ROUNDS = 20;

export function nextSoloRound(room: Room): boolean {
  if (!isServerPicked(room) || room.phase !== "results") return false;
  room.liveCase = null;
  if (room.mode === "hp" && room.players.some((p) => p.hp <= 0)) {
    finishGame(room);
    return true;
  }
  if (room.mode === "hp" && room.currentRound + 1 >= HP_MAX_ROUNDS) {
    finishGame(room);
    return true;
  }
  if (room.mode === "hp") {
    room.currentRound += 1;
    room.targets[room.currentRound] = nextLocation(room, roomMapId(room));
    room.firstGuessTime = null; // reset for new round
    room.phase = "finding";
    for (let i = 0; i < room.players.length; i++) {
      room.players[i].liveView = null;
      room.players[i].livePin = null;
    }
  } else if (room.currentRound + 1 >= room.settings.soloRounds) {
    finishGame(room);
    return true;
  } else {
    room.currentRound += 1;
    room.targets[room.currentRound] = nextLocation(room, roomMapId(room));
    room.phase = "finding";
    for (let i = 0; i < room.players.length; i++) {
      room.players[i].liveView = null;
      room.players[i].livePin = null;
    }
  }
  refreshDeadline(room);
  return true;
}

/**
 * Server-side phase clock. Called on an interval by the server; advances a
 * phase whose deadline has passed so an idle or disconnected player can never
 * stall the room. Returns true when the room changed and needs a broadcast.
 *
 * This is the structural fix for the "hiding timer stalls the game" and
 * "disconnect during hiding stalls a 2-player game" bugs: the client timer is
 * now only a display, and the server owns the transition.
 */
export function tickPhase(room: Room, now: number = Date.now()): boolean {
  if (room.deadlineAt == null || now < room.deadlineAt) return false;

  if (room.phase === "hiding") {
    // Drop every connected player who has not picked a spot onto a random
    // covered location from the selected pool, then start finding.
    const connected = connectedPlayers(room);
    for (let i = 0; i < connected.length; i++) {
      const p = connected[i];
      if (p.hasHidden) continue;
      const location = nextLocation(room, roomMapId(room));
      p.hiding = { lat: location.lat, lng: location.lng, panoId: location.panoId };
      p.hasHidden = true;
    }
    if (!startFinding(room)) {
      // Fewer than two hiders: nothing to find. End the game rather than
      // leaving the room stuck in a phase that can never complete.
      finishGame(room);
    }
    return true;
  }

  if (room.phase === "finding") {
    if (isServerPicked(room)) {
      // Solo / HP: score whatever guesses exist. A player who never guessed
      // simply takes no points (and, in HP, no damage) for the round. `force`
      // is required here: without it HP scoring refuses to run until everyone
      // has guessed, and the expired phase would never advance.
      //
      // The trigger must be a player who actually guessed. Passing
      // `connected[0]` meant that if the first connected player was the one who
      // had not guessed, scoreSoloRound returned false and the entire round was
      // skipped — no points and no damage for anyone.
      const key = soloTargetKey(room.currentRound);
      const connected = connectedPlayers(room);
      const anyGuesser = connected.find((p) => p.guesses[key]);
      if (anyGuesser && scoreSoloRound(room, anyGuesser.id, true)) {
        return true;
      }
      room.phase = "results";
      refreshDeadline(room);
      return true;
    }
    // Classic: score the round with the guesses that came in.
    if (!scoreRound(room)) {
      room.phase = "results";
      refreshDeadline(room);
    }
    return true;
  }

  return false;
}

/**
 * Host "force advance": skip the current phase immediately. Used when a player
 * is AFK and the room would otherwise wait out a long timer. Only valid in
 * hiding / finding; results and finished are already host-driven.
 */
export function forceAdvance(room: Room): boolean {
  if (room.phase !== "hiding" && room.phase !== "finding") return false;
  // Expire the deadline now and let the normal clock path do the work, so
  // force-advance and timer expiry can never diverge.
  room.deadlineAt = Date.now();
  return tickPhase(room, Date.now());
}

function shuffle<T>(arr: T[]): T[] {
  const out = [...arr];
  for (let i = out.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    const temp = out[i];
    out[i] = out[j];
    out[j] = temp;
  }
  return out;
}