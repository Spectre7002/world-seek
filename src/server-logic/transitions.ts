import {
  DEFAULT_SETTINGS,
  type HidingSpot,
  type LatLng,
  type Location,
  type Player,
  type Room,
  type Settings,
} from "../shared/types";
import { getRandomLocation, isAvailableMap, type MapId } from "./locations";
import { computeScore, haversineKm } from "../shared/scoring";
import { generatePlayerId, generateRoomCode, generateToken } from "../shared/codes";
import { DEFAULT_EMOJI, isValidEmoji } from "../shared/emojis";

const MAX_PLAYERS = 10;

export function createRoom(
  gmName: string,
  settings?: Partial<Settings>,
  gmEmoji?: string,
): {
  room: Room;
  player: Player;
} {
  const player = newPlayer(gmName, true, gmEmoji);
  const room: Room = {
    code: generateRoomCode(),
    phase: "lobby",
    mode: "multiplayer",
    settings: { ...DEFAULT_SETTINGS, ...settings },
    gameMasterId: player.id,
    players: [player],
    order: [],
    currentRound: 0,
    targets: [],
    cycleCount: 1,
  };
  return { room: room, player: player };
}

function newPlayer(name: string, isGameMaster: boolean, emoji?: string): Player {
  return {
    id: generatePlayerId(),
    name: String(name ?? "").trim().slice(0, 24) || "Player",
    emoji: emoji && isValidEmoji(emoji) ? emoji : DEFAULT_EMOJI,
    sessionToken: generateToken(),
    isGameMaster: isGameMaster,
    connected: true,
    socketId: null,
    hiding: null,
    hasHidden: false,
    guesses: {},
    livePin: null,
    liveView: null,
    totalScore: 0,
  };
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

export function addPlayer(room: Room, name: string, emoji?: string): AddResult {
  if (room.phase !== "lobby") return { ok: false, error: "in_progress" };
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

  const player = newPlayer(trimmed, false, resolved);
  room.players.push(player);
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

export function connectedPlayers(room: Room): Player[] {
  const result: Player[] = [];
  for (let i = 0; i < room.players.length; i++) {
    if (room.players[i].connected) {
      result.push(room.players[i]);
    }
  }
  return result;
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

  room.players.splice(idx, 1);

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
    if (orderIdx <= room.currentRound && room.currentRound > 0) {
      room.currentRound -= 1;
    }
  }
  return { removed: true, wasCurrentTarget: wasCurrentTarget };
}

export function startGame(room: Room): boolean {
  if (room.phase !== "lobby") return false;
  const connected = connectedPlayers(room);
  if (room.players.length < 2) {
    if (connected.length === 1) return startSolo(room);
    return false;
  }
  if (connected.length < 2) return false;

  room.mode = "multiplayer";
  room.phase = "hiding";
  room.cycleCount = 1;

  for (let i = 0; i < room.players.length; i++) {
    const p = room.players[i];
    p.hiding = null;
    p.hasHidden = false;
    p.guesses = {};
    p.livePin = null;
    p.liveView = null;
    p.totalScore = 0;
  }
  return true;
}

export function recordHide(room: Room, playerId: string, spot: HidingSpot): boolean {
  if (room.phase !== "hiding") return false;
  const p = findPlayer(room, playerId);
  if (!p) return false;
  p.hiding = spot;
  p.hasHidden = true;
  return true;
}

export function allConnectedHidden(room: Room): boolean {
  const connected = connectedPlayers(room);
  if (connected.length < 2) return false;
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
  return true;
}

export function currentTargetId(room: Room): string | null {
  if (room.phase !== "finding" && room.phase !== "results") return null;
  if (room.order.length === 0) return null;
  const safeIdx = Math.min(room.currentRound, room.order.length - 1);
  return room.order[safeIdx] ?? null;
}

export function recordGuess(room: Room, guesserId: string, at: LatLng): boolean {
  if (room.phase !== "finding") return false;
  const targetId = currentTargetId(room);
  if (!targetId || guesserId === targetId) return false;
  const guesser = findPlayer(room, guesserId);
  const target = findPlayer(room, targetId);
  if (!guesser || !target || !target.hiding) return false;

  const distanceKm = haversineKm(at, target.hiding);
  const points = computeScore(distanceKm, room.settings);
  guesser.guesses[targetId] = { lat: at.lat, lng: at.lng, distanceKm: distanceKm, points: points };
  guesser.livePin = null;
  return true;
}

export function recordLivePin(room: Room, guesserId: string, at: LatLng): boolean {
  if (room.phase !== "finding") return false;
  const targetId = currentTargetId(room);
  if (!targetId || guesserId === targetId) return false;
  const guesser = findPlayer(room, guesserId);
  const target = findPlayer(room, targetId);
  if (!guesser || !target || !target.hiding) return false;
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
  const targetId = currentTargetId(room);
  if (!targetId || guesserId === targetId) return false;
  const guesser = findPlayer(room, guesserId);
  const target = findPlayer(room, targetId);
  if (!guesser || !target || !target.hiding) return false;
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
  for (let i = 0; i < room.players.length; i++) {
    const p = room.players[i];
    const g = p.guesses[targetId];
    if (g) p.totalScore += g.points;
  }
  room.phase = "results";
  return true;
}

export function nextRound(room: Room): boolean {
  if (room.phase !== "results") return false;

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
      room.phase = "finished";
    }
  } else {
    room.currentRound += 1;
    room.phase = "finding";
    for (let i = 0; i < room.players.length; i++) {
      room.players[i].liveView = null;
      room.players[i].livePin = null;
    }
  }
  return true;
}

export function returnToLobby(room: Room): boolean {
  room.phase = "lobby";
  room.mode = "multiplayer";
  room.order = [];
  room.targets = [];
  room.currentRound = 0;
  room.cycleCount = 1;
  for (let i = 0; i < room.players.length; i++) {
    const p = room.players[i];
    p.hiding = null;
    p.hasHidden = false;
    p.guesses = {};
    p.livePin = null;
    p.liveView = null;
    p.totalScore = 0;
  }
  return true;
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
  room.targets = [getRandomLocation(isAvailableMap(room.settings.selectedMap) ? room.settings.selectedMap : "global")];
  room.currentRound = 0;
  for (let i = 0; i < room.players.length; i++) {
    const p = room.players[i];
    p.hiding = null;
    p.hasHidden = false;
    p.guesses = {};
    p.livePin = null;
    p.liveView = null;
    p.totalScore = 0;
  }
  return true;
}

export function soloTarget(room: Room): Location | null {
  if (room.mode !== "solo") return null;
  return room.targets[room.currentRound] ?? null;
}

export function recordSoloGuess(room: Room, playerId: string, at: LatLng): boolean {
  if (room.mode !== "solo" || room.phase !== "finding") return false;
  const target = room.targets[room.currentRound];
  if (!target) return false;
  const player = findPlayer(room, playerId);
  if (!player) return false;
  const distanceKm = haversineKm(at, target);
  const points = computeScore(distanceKm, room.settings);
  player.guesses[soloTargetKey(room.currentRound)] = { lat: at.lat, lng: at.lng, distanceKm: distanceKm, points: points };
  return true;
}

export function soloGuess(room: Room, playerId: string) {
  const player = findPlayer(room, playerId);
  return player?.guesses[soloTargetKey(room.currentRound)] ?? null;
}

export function scoreSoloRound(room: Room, playerId: string): boolean {
  if (room.mode !== "solo" || room.phase !== "finding") return false;
  const player = findPlayer(room, playerId);
  const g = player?.guesses[soloTargetKey(room.currentRound)];
  if (!player || !g) return false;
  player.totalScore += g.points;
  room.phase = "results";
  return true;
}

export function nextSoloRound(room: Room): boolean {
  if (room.mode !== "solo" || room.phase !== "results") return false;
  if (room.currentRound + 1 >= room.settings.soloRounds) {
    room.phase = "finished";
  } else {
    room.currentRound += 1;
    const mapId = isAvailableMap(room.settings.selectedMap) ? room.settings.selectedMap : "global";
    room.targets[room.currentRound] = getRandomLocation(mapId);
    room.phase = "finding";
  }
  return true;
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