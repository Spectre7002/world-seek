import type { ChatMessage, Room } from "../shared/types";

// In-memory room store. Lost on restart (acceptable for local dev / MVP).
const rooms = new Map<string, Room>();

// socketId -> where that socket is seated, so disconnects can be resolved.
const sockets = new Map<string, { code: string; playerId: string }>();

// Per-room chat history, capped at MAX_HISTORY messages.
const chatHistory = new Map<string, ChatMessage[]>();
const MAX_HISTORY = 200;

export function getRoom(code: string): Room | undefined {
  return rooms.get(code.toLowerCase());
}

export function saveRoom(room: Room): void {
  rooms.set(room.code, room);
}

export function deleteRoom(code: string): void {
  const key = code.toLowerCase();
  rooms.delete(key);
  chatHistory.delete(key);
  emptySince.delete(key);
}

/** Current number of rooms held in memory (for the creation cap). */
export function roomCount(): number {
  return rooms.size;
}

// When a room was first observed with zero connected players (for idle sweeping).
const emptySince = new Map<string, number>();

/**
 * Drop rooms that have had no connected players for longer than ttlMs. A room
 * with at least one live player is kept and its idle timer reset. Returns the
 * number of rooms removed. Called on an interval so closed tabs / abandoned
 * games can't leak memory indefinitely.
 */
export function sweepIdleRooms(ttlMs: number): number {
  const now = Date.now();
  let dropped = 0;
  for (const [key, room] of rooms) {
    const hasConnected = room.players.some((p) => p.connected);
    if (hasConnected) {
      emptySince.delete(key);
      continue;
    }
    const since = emptySince.get(key);
    if (since === undefined) {
      emptySince.set(key, now);
    } else if (now - since >= ttlMs) {
      rooms.delete(key);
      chatHistory.delete(key);
      emptySince.delete(key);
      dropped++;
    }
  }
  return dropped;
}

export function getChatHistory(code: string): ChatMessage[] {
  return chatHistory.get(code.toLowerCase()) ?? [];
}

export function addChatMessage(code: string, msg: ChatMessage): void {
  const key = code.toLowerCase();
  const hist = chatHistory.get(key) ?? [];
  hist.push(msg);
  if (hist.length > MAX_HISTORY) hist.splice(0, hist.length - MAX_HISTORY);
  chatHistory.set(key, hist);
}

export function bindSocket(socketId: string, code: string, playerId: string): void {
  sockets.set(socketId, { code, playerId });
}

export function lookupSocket(socketId: string) {
  return sockets.get(socketId);
}

export function unbindSocket(socketId: string): void {
  sockets.delete(socketId);
}
