import { randomUUID } from "node:crypto";
import type { Server, Socket } from "socket.io";
import type {
  ActionAck,
  ChatMessage,
  CreateAck,
  HidingSpot,
  JoinAck,
  LatLng,
  PeekAck,
  ReconnectAck,
  Room,
  Settings,
} from "../src/shared/types";
import {
  addChatMessage,
  bindSocket,
  deleteRoom,
  getChatHistory,
  getRoom,
  lookupSocket,
  saveRoom,
  unbindSocket,
} from "../src/server-logic/store";
import {
  addPlayer,
  allConnectedHidden,
  allGuessed,
  connectedPlayers,
  createRoom,
  findByToken,
  findPlayer,
  nextRound,
  nextSoloRound,
  recordGuess,
  recordHide,
  recordLivePin,
  recordLiveView,
  recordSoloGuess,
  removePlayer,
  returnToLobby,
  scoreRound,
  scoreSoloRound,
  startFinding,
  startGame,
  takenEmojis,
} from "../src/server-logic/transitions";
import { projectFor } from "../src/server-logic/projection";
import { roomCount } from "../src/server-logic/store";
import {
  budgetStatus,
  chargeIfAffordable,
  multiplayerUnits,
  soloUnits,
} from "../src/server-logic/budget";
import {
  isValidHidingSpot,
  isValidLatLng,
  isValidLiveView,
  pickHidingSpot,
  pickLatLng,
  pickLiveView,
  sanitizeSettings,
  toSafeString,
} from "../src/shared/validate";

const MAX_ROOMS = 5000;
const MAX_CONNECTIONS = 4000;
const MAX_ROOMS_PER_SOCKET = 50;
const CREATE_MIN_INTERVAL_MS = 1000;

function rateOk(socket: Socket, key: string, minIntervalMs: number): boolean {
  const data = socket.data as Record<string, number>;
  const now = Date.now();
  const last = data[key] ?? 0;
  if (now - last < minIntervalMs) return false;
  data[key] = now;
  return true;
}

function broadcastState(io: Server, room: Room): void {
  for (let i = 0; i < room.players.length; i++) {
    const p = room.players[i];
    if (p.connected && p.socketId) {
      io.to(p.socketId).emit("state", projectFor(room, p.id));
    }
  }
}

function closeRoom(io: Server, room: Room): void {
  for (let i = 0; i < room.players.length; i++) {
    const p = room.players[i];
    if (p.connected && p.socketId) {
      io.to(p.socketId).emit("game:closed");
      unbindSocket(p.socketId);
    }
  }
  deleteRoom(room.code);
}

function seat(socket: Socket): { room: Room; playerId: string } | null {
  const binding = lookupSocket(socket.id);
  if (!binding) return null;
  const room = getRoom(binding.code);
  if (!room) return null;
  if (!findPlayer(room, binding.playerId)) return null;
  return { room: room, playerId: binding.playerId };
}

function isGameMaster(room: Room, playerId: string): boolean {
  return room.gameMasterId === playerId;
}

type AckFn = (res: ActionAck) => void;

function reply(cb: AckFn | undefined, res: ActionAck): void {
  if (typeof cb === "function") cb(res);
}

export function registerHandlers(io: Server): void {
  io.on("connection", function (socket: Socket) {
    if (io.engine.clientsCount > MAX_CONNECTIONS) {
      socket.disconnect(true);
      return;
    }

    socket.on(
      "game:create",
      function (
        payload: { gmName: string; gmEmoji?: string; settings?: Partial<Settings> },
        ack: (res: CreateAck) => void,
      ) {
        if (budgetStatus().exhausted) return ack({ ok: false, error: "budget" });

        const data = socket.data as Record<string, number>;
        if (
          roomCount() >= MAX_ROOMS ||
          (data.roomsCreated ?? 0) >= MAX_ROOMS_PER_SOCKET ||
          !rateOk(socket, "create", CREATE_MIN_INTERVAL_MS)
        ) {
          return ack({ ok: false, error: "server_full" });
        }
        const created = createRoom(
          toSafeString(payload?.gmName, 24),
          sanitizeSettings(payload?.settings),
          typeof payload?.gmEmoji === "string" ? payload.gmEmoji : undefined,
        );
        const room = created.room;
        const player = created.player;

        data.roomsCreated = (data.roomsCreated ?? 0) + 1;
        player.socketId = socket.id;
        saveRoom(room);
        bindSocket(socket.id, room.code, player.id);
        ack({ ok: true, code: room.code, sessionToken: player.sessionToken, playerId: player.id });
        broadcastState(io, room);
      },
    );

    socket.on(
      "game:peek",
      function (payload: { code: string }, ack: (res: PeekAck) => void) {
        if (!rateOk(socket, "peek", 300)) return ack({ ok: false });
        const room = getRoom(toSafeString(payload?.code, 32));
        if (!room) return ack({ ok: false });
        ack({ ok: true, takenEmojis: takenEmojis(room) });
      },
    );

    socket.on(
      "game:join",
      function (
        payload: { code: string; name: string; emoji?: string },
        ack: (res: JoinAck) => void,
      ) {
        const room = getRoom(toSafeString(payload?.code, 32));
        if (!room) return ack({ ok: false, error: "not_found" });
        const result = addPlayer(
          room,
          toSafeString(payload?.name, 24),
          typeof payload?.emoji === "string" ? payload.emoji : undefined,
        );
        if (!result.ok) {
          return ack(
            result.error === "emoji_taken"
              ? { ok: false, error: result.error, takenEmojis: takenEmojis(room) }
              : { ok: false, error: result.error },
          );
        }
        result.player.socketId = socket.id;
        saveRoom(room);
        bindSocket(socket.id, room.code, result.player.id);
        ack({
          ok: true,
          sessionToken: result.player.sessionToken,
          playerId: result.player.id,
        });
        broadcastState(io, room);
        if (room.settings.textChat) {
          socket.emit("chat:history", getChatHistory(room.code));
        }
      },
    );

    socket.on(
      "game:reconnect",
      function (
        payload: { code: string; sessionToken: string },
        ack: (res: ReconnectAck) => void,
      ) {
        const room = getRoom(toSafeString(payload?.code, 32));
        if (!room) return ack({ ok: false, error: "not_found" });
        const player = findByToken(room, toSafeString(payload?.sessionToken, 64));
        if (!player) return ack({ ok: false, error: "bad_token" });
        player.connected = true;
        player.socketId = socket.id;
        bindSocket(socket.id, room.code, player.id);
        ack({ ok: true, playerId: player.id });
        broadcastState(io, room);
        if (room.settings.textChat) {
          socket.emit("chat:history", getChatHistory(room.code));
        }
      },
    );

    // Новий обробник оновлення настройок лоббі хостом
    socket.on(
      "game:settings",
      function (payload: { settings?: Partial<Settings> }, cb?: AckFn) {
        const s = seat(socket);
        if (!s) return reply(cb, { ok: false, reason: "not_seated" });
        if (!isGameMaster(s.room, s.playerId) || s.room.phase !== "lobby") {
          return reply(cb, { ok: false, reason: "rejected" });
        }
        if (payload && payload.settings) {
          const clean = sanitizeSettings(payload.settings);
          Object.assign(s.room.settings, clean);
          saveRoom(s.room);
          broadcastState(io, s.room);
        }
        reply(cb, { ok: true });
      },
    );

    socket.on("game:start", function (cb?: AckFn) {
      const s = seat(socket);
      if (!s) return reply(cb, { ok: false, reason: "not_seated" });
      const active = connectedPlayers(s.room).length;
      if (!isGameMaster(s.room, s.playerId) || s.room.phase !== "lobby" || active < 1) {
        return reply(cb, { ok: false, reason: "rejected" });
      }

      const units =
        active === 1 ? soloUnits(s.room.settings.soloRounds) : multiplayerUnits(active);
      if (!chargeIfAffordable(units)) return reply(cb, { ok: false, reason: "budget" });

      if (!startGame(s.room)) return reply(cb, { ok: false, reason: "rejected" });
      broadcastState(io, s.room);
      reply(cb, { ok: true });
    });

    socket.on("hide:confirm", function (spot: HidingSpot, cb?: AckFn) {
      const s = seat(socket);
      if (!s) return reply(cb, { ok: false, reason: "not_seated" });
      if (!isValidHidingSpot(spot)) return reply(cb, { ok: false, reason: "rejected" });
      if (!recordHide(s.room, s.playerId, pickHidingSpot(spot))) {
        return reply(cb, { ok: false, reason: "rejected" });
      }
      if (allConnectedHidden(s.room)) startFinding(s.room);
      broadcastState(io, s.room);
      reply(cb, { ok: true });
    });

    socket.on("guess:preview", function (at: LatLng) {
      if (!rateOk(socket, "preview", 50)) return;
      const s = seat(socket);
      if (!s) return;
      if (!isValidLatLng(at)) return;
      if (!recordLivePin(s.room, s.playerId, pickLatLng(at))) return;
      broadcastState(io, s.room);
    });

    socket.on("view:sync", function (payload: unknown) {
      if (!rateOk(socket, "viewsync", 70)) return;
      const s = seat(socket);
      if (!s) return;
      if (!isValidLiveView(payload)) return;
      const view = pickLiveView(payload);
      if (!recordLiveView(s.room, s.playerId, view)) return;
      const hunter = findPlayer(s.room, s.playerId);
      if (!hunter) return;
      const packet = {
        playerId: hunter.id,
        name: hunter.name,
        emoji: hunter.emoji,
        panoId: view.panoId,
        heading: view.heading,
        pitch: view.pitch,
        zoom: view.zoom,
      };
      for (let i = 0; i < s.room.players.length; i++) {
        const p = s.room.players[i];
        if (!p.connected || !p.socketId || p.id === s.playerId) continue;
        const projected = projectFor(s.room, p.id);
        if (projected.youAreTarget || projected.youHaveGuessed) {
          io.to(p.socketId).emit("view:live", packet);
        }
      }
    });

    socket.on("guess:confirm", function (at: LatLng, cb?: AckFn) {
      const s = seat(socket);
      if (!s) return reply(cb, { ok: false, reason: "not_seated" });
      if (!isValidLatLng(at)) return reply(cb, { ok: false, reason: "rejected" });
      const coords = pickLatLng(at);
      if (s.room.mode === "solo") {
        if (!recordSoloGuess(s.room, s.playerId, coords)) {
          return reply(cb, { ok: false, reason: "rejected" });
        }
        scoreSoloRound(s.room, s.playerId);
        broadcastState(io, s.room);
        return reply(cb, { ok: true });
      }
      if (!recordGuess(s.room, s.playerId, coords)) {
        return reply(cb, { ok: false, reason: "rejected" });
      }
      if (allGuessed(s.room)) scoreRound(s.room);
      broadcastState(io, s.room);
      reply(cb, { ok: true });
    });

    socket.on("round:next", function (cb?: AckFn) {
      const s = seat(socket);
      if (!s) return reply(cb, { ok: false, reason: "not_seated" });
      const advance = s.room.mode === "solo" ? nextSoloRound : nextRound;
      if (!isGameMaster(s.room, s.playerId) || !advance(s.room)) {
        return reply(cb, { ok: false, reason: "rejected" });
      }
      broadcastState(io, s.room);
      reply(cb, { ok: true });
    });

    socket.on("game:returnToLobby", function (cb?: AckFn) {
      const s = seat(socket);
      if (!s) return reply(cb, { ok: false, reason: "not_seated" });
      if (!isGameMaster(s.room, s.playerId) || !returnToLobby(s.room)) {
        return reply(cb, { ok: false, reason: "rejected" });
      }
      broadcastState(io, s.room);
      reply(cb, { ok: true });
    });

    socket.on("game:close", function (cb?: AckFn) {
      const s = seat(socket);
      if (!s) return reply(cb, { ok: false, reason: "not_seated" });
      if (!isGameMaster(s.room, s.playerId)) {
        return reply(cb, { ok: false, reason: "rejected" });
      }
      closeRoom(io, s.room);
      reply(cb, { ok: true });
    });

    socket.on("game:leave", function (cb?: AckFn) {
      const s = seat(socket);
      if (!s) return reply(cb, { ok: false, reason: "not_seated" });
      if (isGameMaster(s.room, s.playerId)) {
        closeRoom(io, s.room);
        return reply(cb, { ok: true });
      }

      const res = removePlayer(s.room, s.playerId);
      if (!res.removed) return reply(cb, { ok: false, reason: "rejected" });
      unbindSocket(socket.id);

      if (s.room.players.length === 0) {
        deleteRoom(s.room.code);
        return reply(cb, { ok: true });
      }

      const active = connectedPlayers(s.room).length;
      const inProgress = s.room.phase !== "lobby" && s.room.phase !== "finished";

      if (inProgress && active < 2) {
        closeRoom(io, s.room);
        return reply(cb, { ok: true });
      }

      if (s.room.phase === "hiding") {
        if (allConnectedHidden(s.room)) startFinding(s.room);
      } else if (s.room.phase === "finding") {
        if (res.wasCurrentTarget && s.room.currentRound >= s.room.order.length) {
          s.room.phase = "finished";
        } else if (allGuessed(s.room)) {
          scoreRound(s.room);
        }
      } else if (s.room.phase === "results" && res.wasCurrentTarget) {
        s.room.phase =
          s.room.currentRound >= s.room.order.length ? "finished" : "finding";
      }

      broadcastState(io, s.room);
      reply(cb, { ok: true });
    });

    socket.on("chat:send", function (payload: { text: string }) {
      if (!rateOk(socket, "chat", 250)) return;
      const s = seat(socket);
      if (!s || !s.room.settings.textChat) return;
      const text = toSafeString(payload?.text, 500).trim();
      if (!text) return;
      const player = findPlayer(s.room, s.playerId);
      if (!player) return;
      const msg: ChatMessage = {
        id: randomUUID(),
        playerId: s.playerId,
        playerName: player.name,
        emoji: player.emoji,
        text: text,
        ts: Date.now(),
      };
      addChatMessage(s.room.code, msg);
      for (let i = 0; i < s.room.players.length; i++) {
        const p = s.room.players[i];
        if (p.connected && p.socketId) {
          io.to(p.socketId).emit("chat:message", msg);
        }
      }
    });

    socket.on("voice:offer", function (payload: { to: string; sdp: RTCSessionDescriptionInit }) {
      const s = seat(socket);
      if (!s || !s.room.settings.voiceChat) return;
      const target = findPlayer(s.room, payload?.to ?? "");
      if (!target || !target.socketId || !target.connected) return;
      io.to(target.socketId).emit("voice:offer", { from: s.playerId, sdp: payload.sdp });
    });

    socket.on("voice:answer", function (payload: { to: string; sdp: RTCSessionDescriptionInit }) {
      const s = seat(socket);
      if (!s || !s.room.settings.voiceChat) return;
      const target = findPlayer(s.room, payload?.to ?? "");
      if (!target || !target.socketId || !target.connected) return;
      io.to(target.socketId).emit("voice:answer", { from: s.playerId, sdp: payload.sdp });
    });

    socket.on("voice:ice", function (payload: { to: string; candidate: RTCIceCandidateInit }) {
      const s = seat(socket);
      if (!s || !s.room.settings.voiceChat) return;
      const target = findPlayer(s.room, payload?.to ?? "");
      if (!target || !target.socketId || !target.connected) return;
      io.to(target.socketId).emit("voice:ice", { from: s.playerId, candidate: payload.candidate });
    });

    socket.on("disconnect", function () {
      const binding = lookupSocket(socket.id);
      unbindSocket(socket.id);
      if (!binding) return;
      const room = getRoom(binding.code);
      if (!room) return;
      const player = findPlayer(room, binding.playerId);
      if (player && player.socketId === socket.id) {
        player.connected = false;
        player.socketId = null;
        if (room.phase === "hiding" && allConnectedHidden(room)) {
          startFinding(room);
        } else if (room.phase === "finding" && allGuessed(room)) {
          scoreRound(room);
        }
        broadcastState(io, room);
      }
    });
  });
}