"use client";

import { io, type Socket } from "socket.io-client";

let socket: Socket | null = null;

export function getSocket(): Socket {
  if (!socket) {
    socket = io({ autoConnect: true, transports: ["websocket", "polling"] });
  }
  return socket;
}

/** Emit an event and resolve with its ack payload. */
export function emitAck<T>(event: string, payload?: unknown): Promise<T> {
  return new Promise((resolve) => {
    getSocket().emit(event, payload, (res: T) => resolve(res));
  });
}

/**
 * Emit a game action and resolve with its ack. Unlike `emitAck`, this omits the
 * payload argument entirely when there isn't one, so the server always receives
 * the ack callback in the slot it expects (payloadless events like `round:next`).
 */
export function emitAction<T>(event: string, payload?: unknown): Promise<T> {
  return new Promise((resolve) => {
    const socket = getSocket();
    if (payload === undefined) socket.emit(event, (res: T) => resolve(res));
    else socket.emit(event, payload, (res: T) => resolve(res));
  });
}
