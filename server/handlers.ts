import { randomUUID } from "node:crypto";
import { sanitizeCaseTiers, spinClassicCase } from "./caseEngine";
import type { Server, Socket } from "socket.io";
import type {
  ActionAck,
  ChatMessage,
  CreateAck,
  HidingSpot,
  JoinAck,
  LatLng,
  PeekAck,
  Reaction,
  ReconnectAck,
  Room,
  Settings,
} from "../src/shared/types";
import { REACTIONS } from "../src/shared/types";
import {
  addChatMessage,
  allRooms,
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
  allServerPickedGuessed,
  applyFreeze,
  clearKickVotes,
  connectedPlayers,
  createRoom,
  findByToken,
  findPlayer,
  finishGame,
  forceAdvance,
  isFrozen,
  isServerPicked,
  nextRound,
  nextSoloRound,
  promoteGameMaster,
  recordGuess,
  recordHide,
  recordLivePin,
  recordLiveView,
  recordSoloGuess,
  refreshDeadline,
  rematch,
  removePlayer,
  returnToLobby,
  roundTurnKey,
  scoreRound,
  scoreSoloRound,
  startFinding,
  startGame,
  takenEmojis,
  tickPhase,
  voteKick,
} from "../src/server-logic/transitions";
import { isWatcher, livePinsFor, projectFor } from "../src/server-logic/projection";
import { getLeaderboard, getPlayerStats, recordedMapIds } from "../src/server-logic/history";
import { roomCount } from "../src/server-logic/store";
import { sanitizeSettings, toSafeString } from "../src/shared/validate";
import {
  chatPayloadSchema,
  createPayloadSchema,
  hidingSpotSchema,
  joinPayloadSchema,
  latLngSchema,
  leaderboardPayloadSchema,
  liveViewSchema,
  reactionPayloadSchema,
  reconnectPayloadSchema,
  settingsPayloadSchema,
  spellPayloadSchema,
  statsPayloadSchema,
  voiceSignalSchema,
  voteKickPayloadSchema,
} from "../src/shared/schemas";
import type { z } from "zod";
import { isAvailableMap, pickLocation } from "../src/server-logic/locations";
import { isInsideSelectedRegion } from "../src/server-logic/countryValidator";
import { isSpellId, SPELL_IDS } from "../src/shared/spells";
import { dailySeed, generateSeed } from "../src/shared/rng";

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

/**
 * Parse an untrusted socket payload against a zod schema. Returns null when the
 * payload does not match, so callers can drop the packet instead of guarding
 * field by field. zod strips unknown keys, which also removes attacker-supplied
 * extras before anything reaches the game state.
 */
function parsePayload<S extends z.ZodTypeAny>(schema: S, payload: unknown): z.output<S> | null {
  const result = schema.safeParse(payload);
  return result.success ? result.data : null;
}

/**
 * Flush any system chat lines a transition queued.
 *
 * Transitions have no socket access, so they park the text on the room. This
 * runs before every broadcast, which is the only place a queued line can be
 * turned into a real `chat:message`. Lines are appended to the room history so
 * a late joiner sees them too.
 */
function flushSystemMessages(io: Server, room: Room): void {
  const queued = room.pendingSystem;
  if (!queued || queued.length === 0) return;
  room.pendingSystem = [];
  for (let i = 0; i < queued.length; i++) {
    const msg: ChatMessage = {
      id: randomUUID(),
      playerId: "",
      playerName: "",
      emoji: "",
      text: queued[i],
      ts: Date.now(),
      system: true,
    };
    addChatMessage(room.code, msg);
    for (let j = 0; j < room.players.length; j++) {
      const p = room.players[j];
      if (p.connected && p.socketId) {
        io.to(p.socketId).emit("chat:message", msg);
      }
    }
  }
}

function broadcastState(io: Server, room: Room): void {
  flushSystemMessages(io, room);
  for (let i = 0; i < room.players.length; i++) {
    const p = room.players[i];
    if (p.connected && p.socketId) {
      io.to(p.socketId).emit("state", projectFor(room, p.id));
    }
  }
}

// room code -> the socket that created it, so its creation credit can be
// returned when the room goes away.
const roomCreators = new Map<string, string>();

function closeRoom(io: Server, room: Room): void {
  for (let i = 0; i < room.players.length; i++) {
    const p = room.players[i];
    if (p.connected && p.socketId) {
      io.to(p.socketId).emit("game:closed");
      unbindSocket(p.socketId);
    }
  }
  releaseRoomCredit(io, room.code);
  deleteRoom(room.code);
}

/**
 * Give back the per-socket room-creation credit for a room that no longer
 * exists. Without this, `roomsCreated` only ever grew, so a socket that created
 * and left 50 rooms was permanently blocked from creating more.
 */
function releaseRoomCredit(io: Server, code: string): void {
  const creatorId = roomCreators.get(code);
  if (!creatorId) return;
  roomCreators.delete(code);
  const socket = io.sockets.sockets.get(creatorId);
  if (!socket) return;
  const data = socket.data as Record<string, number>;
  if ((data.roomsCreated ?? 0) > 0) data.roomsCreated -= 1;
}

/**
 * Re-evaluate the room after a player leaves or drops. Shared by `game:leave`
 * and `disconnect` so the two paths cannot drift apart.
 *
 * The phase clock (`tickPhase`) is the structural safety net: if this leaves a
 * phase that can never complete, the clock expires it. This function only
 * handles the cases where the departure makes the phase completable *now*.
 */
function advanceAfterDeparture(io: Server, room: Room, wasCurrentTarget: boolean): void {
  // Track whether this call moved the room into a new phase, so the deadline is
  // restamped once at the end instead of at every branch.
  let enteredFinding = false;

  if (room.phase === "hiding") {
    if (allConnectedHidden(room)) startFinding(room);
  } else if (room.phase === "finding") {
    if (wasCurrentTarget && room.currentRound >= room.order.length) {
      finishGame(room);
    } else if (isServerPicked(room)) {
      const connected = connectedPlayers(room);
      const allHpGuessed =
        connected.length > 0 &&
        connected.every((p) => p.guesses["solo-" + room.currentRound]);
      // Any actual guesser can trigger the score; requiring everyone to have
      // guessed first meant a round could be skipped when one player was AFK.
      const anyGuesser = connected.find((p) => p.guesses["solo-" + room.currentRound]);
      if (allHpGuessed && anyGuesser) scoreSoloRound(room, anyGuesser.id);
    } else if (allGuessed(room)) {
      scoreRound(room);
    }
  } else if (room.phase === "results" && wasCurrentTarget) {
    if (room.currentRound >= room.order.length) finishGame(room);
    else {
      room.phase = "finding";
      enteredFinding = true;
    }
  }

  // A hand-rolled `phase = "finding"` here used to skip `refreshDeadline`, so
  // the new turn had `deadlineAt = null` and the server clock could never
  // expire it (an AFK player stalled the room until the host skipped it).
  if (enteredFinding) refreshDeadline(room);

  broadcastState(io, room);
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
        payload: {
          gmName: string;
          gmEmoji?: string;
          settings?: Partial<Settings>;
          playerKey?: string;
        },
        ack: (res: CreateAck) => void,
      ) {
        const parsed = parsePayload(createPayloadSchema, payload);
        if (!parsed) return ack({ ok: false, error: "server_full" });
        const data = socket.data as Record<string, number>;
        if (
          roomCount() >= MAX_ROOMS ||
          (data.roomsCreated ?? 0) >= MAX_ROOMS_PER_SOCKET ||
          !rateOk(socket, "create", CREATE_MIN_INTERVAL_MS)
        ) {
          return ack({ ok: false, error: "server_full" });
        }
        const cleanSettings = sanitizeSettings(parsed.settings);
        if (cleanSettings.selectedMap && !isAvailableMap(cleanSettings.selectedMap)) {
          delete cleanSettings.selectedMap;
        }
        const created = createRoom(
          toSafeString(parsed.gmName, 24),
          cleanSettings,
          typeof parsed.gmEmoji === "string" ? parsed.gmEmoji : undefined,
          toSafeString(parsed.playerKey, 64),
        );
        const room = created.room;
        const player = created.player;

        data.roomsCreated = (data.roomsCreated ?? 0) + 1;
        roomCreators.set(room.code, socket.id);
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
        payload: { code: string; name: string; emoji?: string; playerKey?: string },
        ack: (res: JoinAck) => void,
      ) {
        const parsed = parsePayload(joinPayloadSchema, payload);
        if (!parsed) return ack({ ok: false, error: "not_found" });
        const room = getRoom(toSafeString(parsed.code, 32));
        if (!room) return ack({ ok: false, error: "not_found" });

        // No 1v1 cap here: "1v1" is derived from the connected player count, so
        // a third player simply turns the duel into a 3-player HP match (which
        // has its own HUD) rather than being rejected.
        //
        // A join during a running game is no longer refused either: addPlayer
        // hands out a spectator seat, and the player is promoted to a real seat
        // when the room returns to the lobby.
        const result = addPlayer(
          room,
          toSafeString(parsed.name, 24),
          typeof parsed.emoji === "string" ? parsed.emoji : undefined,
          toSafeString(parsed.playerKey, 64),
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
        const parsed = parsePayload(reconnectPayloadSchema, payload);
        if (!parsed) return ack({ ok: false, error: "not_found" });
        const room = getRoom(toSafeString(parsed.code, 32));
        if (!room) return ack({ ok: false, error: "not_found" });
        const player = findByToken(room, toSafeString(parsed.sessionToken, 64));
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

    socket.on(
      "game:settings",
      function (payload: { settings?: Partial<Settings> }, cb?: AckFn) {
        const parsed = parsePayload(settingsPayloadSchema, payload);
        if (!parsed) return reply(cb, { ok: false, reason: "rejected" });
        const s = seat(socket);
        if (!s) return reply(cb, { ok: false, reason: "not_seated" });
        if (!isGameMaster(s.room, s.playerId) || s.room.phase !== "lobby") {
          return reply(cb, { ok: false, reason: "rejected" });
        }
        const incoming = parsed.settings as Partial<Settings> | undefined;
        if (incoming) {
          const clean = sanitizeSettings(incoming);
          if (clean.selectedMap && !isAvailableMap(clean.selectedMap)) {
            delete clean.selectedMap;
          }

          // Принудительное присвоение новых булевых флагов
          if (typeof incoming.cheatsEnabled === "boolean") clean.cheatsEnabled = incoming.cheatsEnabled;
          if (typeof incoming.caseEnabled === "boolean") clean.caseEnabled = incoming.caseEnabled;
          // Case tiers: whitelisted to known keys, and an empty list falls back
          // to "all tiers" so the case can never become unrollable.
          if (incoming.caseTiers !== undefined) {
            clean.caseTiers = sanitizeCaseTiers(incoming.caseTiers);
          }
          // is1v1 is derived in projectFor from gameMode + connected count, so it
          // is deliberately not accepted from the client.
          if (incoming.caseOddsMode === "standard" || incoming.caseOddsMode === "better_odds") {
            clean.caseOddsMode = incoming.caseOddsMode;
          }
          if (clean.gameMode === "hp" && connectedPlayers(s.room).length < 2) {
            clean.gameMode = "classic";
          }
          if (clean.gameMode === "hp") {
            clean.hidingTimeLimit = 0;
          }
          // Seed: an empty string means "random". Two shortcuts are resolved
          // here so the client never has to know the date format or generate a
          // seed itself:
          //   "daily"  -> today's UTC date, so everyone plays the same game
          //   "random" -> a fresh shareable seed
          // A seed only affects server-picked locations, so it is harmless in
          // classic mode.
          if (typeof incoming.seed === "string") {
            const raw = incoming.seed.trim().slice(0, 40);
            if (raw === "daily") clean.seed = dailySeed();
            else if (raw === "random") clean.seed = generateSeed();
            else clean.seed = raw;
          }

          Object.assign(s.room.settings, clean);
          saveRoom(s.room);
          broadcastState(io, s.room);
        }
        reply(cb, { ok: true });
      },
    );

    // ИСПРАВЛЕННЫЙ ВЫЗОВ case:open
    socket.on("case:open", function (cb: (res: { ok: boolean; hint?: any; error?: string }) => void) {
      if (!rateOk(socket, "case", 500)) return cb({ ok: false, error: "rate_limited" });
      const s = seat(socket);
      if (!s) return cb({ ok: false, error: "not_seated" });
      if (s.room.phase !== "finding") return cb({ ok: false, error: "wrong_phase" });
      if (!s.room.settings.caseEnabled) return cb({ ok: false, error: "cases_disabled" });

      // One case per player per turn, enforced here rather than only in the UI.
      // The round's own target cannot open one either — they already know where
      // they are, so a hint would be a free reroll of the case table.
      const opener = findPlayer(s.room, s.playerId);
      if (!opener) return cb({ ok: false, error: "not_seated" });
      if (opener.spectator) return cb({ ok: false, error: "not_seated" });
      // Same turn id the projection and the round log use, so "one case per
      // turn" lines up with what the client considers a turn.
      const turnKey = roundTurnKey(s.room);
      if (opener.caseOpenedRound === turnKey) {
        return cb({ ok: false, error: "already_opened" });
      }
      if (!isServerPicked(s.room) && s.room.order[s.room.currentRound] === s.playerId) {
        return cb({ ok: false, error: "you_are_target" });
      }

      let targetLat: number;
      let targetLng: number;

      if (isServerPicked(s.room)) {
        const target = s.room.targets[s.room.currentRound];
        if (!target) return cb({ ok: false, error: "no_target" });
        targetLat = target.lat;
        targetLng = target.lng;
      } else {
        const targetId = s.room.order[s.room.currentRound];
        const targetPlayer = findPlayer(s.room, targetId);
        if (!targetPlayer || !targetPlayer.hiding) return cb({ ok: false, error: "no_target" });
        targetLat = targetPlayer.hiding.lat;
        targetLng = targetPlayer.hiding.lng;
      }

      const mode = s.room.settings.caseOddsMode || "better_odds";
      const hintData = spinClassicCase(mode, targetLat, targetLng, {
        enabledTiers: s.room.settings.caseTiers,
        pity: opener.casePity,
        lastItem: opener.lastCaseItem,
      });

      opener.caseOpenedRound = turnKey;
      // Pity timer bookkeeping: a blue streak builds up, anything better resets
      // it. Duplicate protection remembers the last item key.
      opener.casePity = hintData.tierKey === "MIL_SPEC" ? opener.casePity + 1 : 0;
      opener.lastCaseItem = hintData.itemKey;
      // A spell reward is granted here, not in the browser, so the inventory
      // survives a refresh and cannot be forged.
      if (hintData.spell) {
        opener.spells[hintData.spell] += 1;
      }
      // Store it on the room so it survives the next state broadcast (which
      // guess:preview fires up to 20x/s) instead of being wiped immediately.
      s.room.liveCase = {
        playerId: opener.id,
        name: opener.name,
        emoji: opener.emoji,
        hint: hintData,
      };
      broadcastState(io, s.room);
      cb({ ok: true, hint: hintData });
    });

    // Cheat-menu helper: hand the player one of each spell. Gated on the cheat
    // flag so it cannot be used in a normal game.
    socket.on("spell:grant", function (cb?: AckFn) {
      const s = seat(socket);
      if (!s) return reply(cb, { ok: false, reason: "not_seated" });
      if (!s.room.settings.cheatsEnabled) return reply(cb, { ok: false, reason: "rejected" });
      const player = findPlayer(s.room, s.playerId);
      if (!player) return reply(cb, { ok: false, reason: "rejected" });
      for (const id of SPELL_IDS) player.spells[id] += 1;
      broadcastState(io, s.room);
      reply(cb, { ok: true });
    });

    // Spend one spell from the server-owned inventory. The client only reports
    // which spell it cast; the count is authoritative here.
    //
    // Map spells (scry/arrow/echo/omen/compass/heatmap) are drawn client-side
    // from `spellTarget`, so spending the charge is the whole server job.
    // Server spells (freeze/reroll) change room state and are applied here.
    socket.on("spell:consume", function (payload: { spell?: string }, cb?: AckFn) {
      if (!rateOk(socket, "spell", 250)) return reply(cb, { ok: false, reason: "rejected" });
      const parsed = parsePayload(spellPayloadSchema, payload);
      if (!parsed) return reply(cb, { ok: false, reason: "rejected" });
      const s = seat(socket);
      if (!s) return reply(cb, { ok: false, reason: "not_seated" });
      const player = findPlayer(s.room, s.playerId);
      if (!player) return reply(cb, { ok: false, reason: "rejected" });
      if (player.spectator) return reply(cb, { ok: false, reason: "rejected" });
      const spell = parsed.spell;
      if (!isSpellId(spell)) return reply(cb, { ok: false, reason: "rejected" });
      if (player.spells[spell] <= 0) return reply(cb, { ok: false, reason: "rejected" });
      if (s.room.phase !== "finding") return reply(cb, { ok: false, reason: "rejected" });

      if (spell === "freeze") {
        // Freeze the strongest rival. Refuse (and do not spend the charge) when
        // there is nobody to freeze, so a solo player cannot waste one.
        const frozen = applyFreeze(s.room, player.id);
        if (!frozen) return reply(cb, { ok: false, reason: "rejected" });
        player.spells.freeze -= 1;
        broadcastState(io, s.room);
        return reply(cb, { ok: true });
      }

      if (spell === "reroll") {
        // Swap the current case for a fresh roll. Only meaningful when the
        // player has already opened one this turn.
        if (!s.room.settings.caseEnabled) return reply(cb, { ok: false, reason: "rejected" });
        if (!s.room.liveCase || s.room.liveCase.playerId !== player.id) {
          return reply(cb, { ok: false, reason: "rejected" });
        }
        let targetLat: number;
        let targetLng: number;
        if (isServerPicked(s.room)) {
          const target = s.room.targets[s.room.currentRound];
          if (!target) return reply(cb, { ok: false, reason: "rejected" });
          targetLat = target.lat;
          targetLng = target.lng;
        } else {
          const targetPlayer = findPlayer(s.room, s.room.order[s.room.currentRound] ?? "");
          if (!targetPlayer || !targetPlayer.hiding) {
            return reply(cb, { ok: false, reason: "rejected" });
          }
          targetLat = targetPlayer.hiding.lat;
          targetLng = targetPlayer.hiding.lng;
        }
        const mode = s.room.settings.caseOddsMode || "better_odds";
        const hintData = spinClassicCase(mode, targetLat, targetLng, {
          enabledTiers: s.room.settings.caseTiers,
          pity: player.casePity,
          lastItem: player.lastCaseItem,
        });
        player.spells.reroll -= 1;
        player.casePity = hintData.tierKey === "MIL_SPEC" ? player.casePity + 1 : 0;
        player.lastCaseItem = hintData.itemKey;
        if (hintData.spell) player.spells[hintData.spell] += 1;
        s.room.liveCase = {
          playerId: player.id,
          name: player.name,
          emoji: player.emoji,
          hint: hintData,
        };
        broadcastState(io, s.room);
        // The replacement hint goes back in the ack so the opener can swap the
        // case card it is showing; the broadcast only reaches the watchers.
        if (typeof cb === "function") {
          (cb as (res: { ok: boolean; hint?: unknown }) => void)({
            ok: true,
            hint: hintData,
          });
        }
        return;
      }

      player.spells[spell] -= 1;
      broadcastState(io, s.room);
      reply(cb, { ok: true });
    });

    // Personal stats and the all-time leaderboard. Both are read-only and
    // keyed on the client-generated `playerKey`, so no room seat is required —
    // a player can check their record from the landing page.
    socket.on(
      "stats:get",
      function (payload: { playerKey?: string }, cb?: (res: unknown) => void) {
        if (!rateOk(socket, "stats", 500)) {
          if (typeof cb === "function") cb({ ok: false, error: "rate_limited" });
          return;
        }
        const parsed = parsePayload(statsPayloadSchema, payload);
        const key = parsed ? toSafeString(parsed.playerKey, 64) : "";
        if (!key) {
          if (typeof cb === "function") cb({ ok: false, error: "no_key" });
          return;
        }
        if (typeof cb === "function") cb({ ok: true, stats: getPlayerStats(key) });
      },
    );

    socket.on(
      "leaderboard:get",
      function (
        payload: { mapId?: string; mode?: string; limit?: number },
        cb?: (res: unknown) => void,
      ) {
        if (!rateOk(socket, "leaderboard", 500)) {
          if (typeof cb === "function") cb({ ok: false, error: "rate_limited" });
          return;
        }
        const parsed = parsePayload(leaderboardPayloadSchema, payload);
        const mapId = parsed ? toSafeString(parsed.mapId, 80) : "";
        const mode = parsed?.mode;
        const limit =
          parsed && typeof parsed.limit === "number" && Number.isFinite(parsed.limit)
            ? parsed.limit
            : 20;
        if (typeof cb === "function") {
          cb({
            ok: true,
            entries: getLeaderboard({
              mapId: mapId || undefined,
              mode: mode,
              limit: limit,
            }),
            maps: recordedMapIds(),
          });
        }
      },
    );

    socket.on("case:share", function (hint: unknown) {
      const s = seat(socket);
      if (!s || !s.room.settings.cheatsEnabled || s.room.phase !== "finding") return;
      if (!hint || typeof hint !== "object") return;
      const encoded = JSON.stringify(hint);
      if (encoded.length > 10000) return;
      const opener = findPlayer(s.room, s.playerId);
      if (!opener) return;
      const packet = {
        playerId: opener.id,
        name: opener.name,
        emoji: opener.emoji,
        hint: hint,
      };
      for (let i = 0; i < s.room.players.length; i++) {
        const recipient = s.room.players[i];
        if (!recipient.connected || !recipient.socketId) continue;
        // isWatcher is the cheap predicate: projecting a full PublicState here
        // just to read two booleans was the whole cost of this loop.
        if (isWatcher(s.room, recipient.id)) {
          io.to(recipient.socketId).emit("case:live", packet);
        }
      }
    });

    socket.on("game:start", function (cb?: AckFn) {
      const s = seat(socket);
      if (!s) return reply(cb, { ok: false, reason: "not_seated" });
      // connectedPlayers() already excludes spectators, so a late joiner who is
      // still watching cannot make the room look ready to start.
      const active = connectedPlayers(s.room).length;
      const seated = s.room.players.filter((p) => !p.spectator).length;
      if (
        !isGameMaster(s.room, s.playerId) ||
        s.room.phase !== "lobby" ||
        active < 1 ||
        (seated >= 2 && active < 2)
      ) {
        return reply(cb, { ok: false, reason: "rejected" });
      }

      // No local admission check here any more: the monthly meter is disabled
      // (see `budget.ts`). Cloud Monitoring is the source of truth for quota
      // visibility, and a silent local cutoff used to stop maps rendering.
      if (!startGame(s.room)) return reply(cb, { ok: false, reason: "rejected" });
      broadcastState(io, s.room);
      reply(cb, { ok: true });
    });

    // Hiding-timer expiry with no valid spot selected. The client cannot invent
    // a covered location, so the server drops the player on a random spot from
    // the selected pool. Without this an idle player stalled the room in
    // `hiding` forever, because nothing else advances the phase.
    socket.on("hide:auto", function (cb?: AckFn) {
      const s = seat(socket);
      if (!s) return reply(cb, { ok: false, reason: "not_seated" });
      if (s.room.phase !== "hiding") return reply(cb, { ok: false, reason: "rejected" });
      const player = findPlayer(s.room, s.playerId);
      if (!player) return reply(cb, { ok: false, reason: "rejected" });
      if (player.hasHidden) return reply(cb, { ok: true });

      const mapId = isAvailableMap(s.room.settings.selectedMap)
        ? s.room.settings.selectedMap
        : "global";
      // Seeded rooms must stay deterministic here too, or an auto-hide would
      // break the shared sequence.
      const location = pickLocation(mapId, s.room.settings.seed, s.room.seedCursor ?? 0);
      s.room.seedCursor = (s.room.seedCursor ?? 0) + 1;
      if (!recordHide(s.room, s.playerId, {
        lat: location.lat,
        lng: location.lng,
        panoId: location.panoId,
      })) {
        return reply(cb, { ok: false, reason: "rejected" });
      }
      if (allConnectedHidden(s.room)) startFinding(s.room);
      broadcastState(io, s.room);
      reply(cb, { ok: true });
    });

    socket.on("hide:confirm", function (rawSpot: unknown, cb?: AckFn) {
      const s = seat(socket);
      if (!s) return reply(cb, { ok: false, reason: "not_seated" });
      const spot = parsePayload(hidingSpotSchema, rawSpot);
      if (!spot) return reply(cb, { ok: false, reason: "rejected" });
      if (!isInsideSelectedRegion(
        spot.lat,
        spot.lng,
        isAvailableMap(s.room.settings.selectedMap) ? s.room.settings.selectedMap : "global",
      )) {
        return reply(cb, {
          ok: false,
          reason: s.room.settings.selectedMap.startsWith("country:")
            ? "Нельзя спрятаться за пределами выбранной страны"
            : "Нельзя спрятаться за пределами выбранного региона",
        });
      }
      if (!recordHide(s.room, s.playerId, spot)) {
        return reply(cb, { ok: false, reason: "rejected" });
      }
      if (allConnectedHidden(s.room)) startFinding(s.room);
      broadcastState(io, s.room);
      reply(cb, { ok: true });
    });

    socket.on(
      "hide:validate",
      function (
        rawSpot: unknown,
        cb: (result: { ok: true; spot: HidingSpot } | { ok: false; reason: string }) => void,
      ) {
        const s = seat(socket);
        const spot = parsePayload(hidingSpotSchema, rawSpot);
        if (!s || !spot) return cb({ ok: false, reason: "invalid" });
        if (!isInsideSelectedRegion(
          spot.lat,
          spot.lng,
          isAvailableMap(s.room.settings.selectedMap) ? s.room.settings.selectedMap : "global",
        )) {
          return cb({
            ok: false,
            reason: s.room.settings.selectedMap.startsWith("country:")
              ? "Нельзя спрятаться за пределами выбранной страны"
              : "Нельзя спрятаться за пределами выбранного региона",
          });
        }
        cb({
          ok: true,
          spot,
        });
      },
    );

    // A live pin only ever reaches watchers (the target, players who already
    // guessed, spectators). Broadcasting the full state here meant one
    // projection per player, 20x/s — ~200 projections per second in a 10-player
    // room, to move a single pin. Send just the pin list instead.
    socket.on("guess:preview", function (rawAt: unknown) {
      if (!rateOk(socket, "preview", 50)) return;
      const s = seat(socket);
      if (!s) return;
      const at = parsePayload(latLngSchema, rawAt);
      if (!at) return;
      if (!recordLivePin(s.room, s.playerId, at)) return;
      for (let i = 0; i < s.room.players.length; i++) {
        const p = s.room.players[i];
        if (!p.connected || !p.socketId || p.id === s.playerId) continue;
        if (!isWatcher(s.room, p.id)) continue;
        io.to(p.socketId).emit("live:update", { pins: livePinsFor(s.room, p.id) });
      }
    });

    socket.on("view:sync", function (rawPayload: unknown) {
      if (!rateOk(socket, "viewsync", 8)) return;
      const s = seat(socket);
      if (!s) return;
      const view = parsePayload(liveViewSchema, rawPayload);
      if (!view) return;
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
        if (isWatcher(s.room, p.id)) {
          io.to(p.socketId).emit("view:live", packet);
        }
      }
    });

    socket.on("guess:confirm", function (rawAt: unknown, cb?: AckFn) {
      const s = seat(socket);
      if (!s) return reply(cb, { ok: false, reason: "not_seated" });
      const coords = parsePayload(latLngSchema, rawAt);
      if (!coords) return reply(cb, { ok: false, reason: "rejected" });
      // A FREEZE spell blocks the guess server-side; the client shows a
      // countdown, but the rule has to hold for a modified client too.
      const guesser = findPlayer(s.room, s.playerId);
      if (guesser && isFrozen(guesser)) return reply(cb, { ok: false, reason: "frozen" });
      if (isServerPicked(s.room)) {
        if (!recordSoloGuess(s.room, s.playerId, coords)) {
          return reply(cb, { ok: false, reason: "rejected" });
        }
        // Solo scores immediately. HP damage is relative, so it waits until
        // every connected player has guessed — or the phase clock expires.
        if (s.room.mode === "solo") {
          scoreSoloRound(s.room, s.playerId);
        } else if (allServerPickedGuessed(s.room)) {
          scoreSoloRound(s.room, s.playerId);
        }
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
      const advance = isServerPicked(s.room) ? nextSoloRound : nextRound;
      if (!isGameMaster(s.room, s.playerId) || !advance(s.room)) {
        return reply(cb, { ok: false, reason: "rejected" });
      }
      broadcastState(io, s.room);
      reply(cb, { ok: true });
    });

    // Host escape hatch: skip the current phase now instead of waiting out the
    // timer. An AFK player can no longer hold the room hostage, and it works
    // even when the phase has no time limit at all.
    socket.on("round:forceAdvance", function (cb?: AckFn) {
      const s = seat(socket);
      if (!s) return reply(cb, { ok: false, reason: "not_seated" });
      if (!isGameMaster(s.room, s.playerId)) {
        return reply(cb, { ok: false, reason: "rejected" });
      }
      if (!forceAdvance(s.room)) {
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

    // Rematch: restart with the same players and settings in one click. Only
    // the host can do it, and only from the finished screen.
    socket.on("game:rematch", function (cb?: AckFn) {
      const s = seat(socket);
      if (!s) return reply(cb, { ok: false, reason: "not_seated" });
      if (!isGameMaster(s.room, s.playerId)) {
        return reply(cb, { ok: false, reason: "rejected" });
      }
      if (!rematch(s.room)) return reply(cb, { ok: false, reason: "rejected" });
      broadcastState(io, s.room);
      reply(cb, { ok: true });
    });

    // Vote-kick. The host's vote counts double, and the host cannot be voted
    // out. A successful kick removes the player and closes their socket, which
    // is the same path `game:leave` takes.
    socket.on("game:voteKick", function (payload: { targetId?: string }, cb?: AckFn) {
      if (!rateOk(socket, "kick", 500)) return reply(cb, { ok: false, reason: "rejected" });
      const s = seat(socket);
      if (!s) return reply(cb, { ok: false, reason: "not_seated" });
      const parsed = parsePayload(voteKickPayloadSchema, payload);
      const targetId = parsed ? toSafeString(parsed.targetId, 64) : "";
      if (!targetId) return reply(cb, { ok: false, reason: "rejected" });

      const result = voteKick(s.room, s.playerId, targetId);
      if (!result) return reply(cb, { ok: false, reason: "rejected" });

      if (!result.kicked) {
        broadcastState(io, s.room);
        return reply(cb, { ok: true });
      }

      // Kick succeeded: drop the seat and tell the removed player's socket.
      const target = findPlayer(s.room, targetId);
      const targetSocketId = target?.socketId ?? null;
      clearKickVotes(s.room, targetId);
      const wasGameMaster = isGameMaster(s.room, targetId);
      const res = removePlayer(s.room, targetId);
      if (targetSocketId) {
        io.to(targetSocketId).emit("game:kicked");
        unbindSocket(targetSocketId);
      }
      if (!res.removed) return reply(cb, { ok: false, reason: "rejected" });

      if (s.room.players.length === 0) {
        releaseRoomCredit(io, s.room.code);
        deleteRoom(s.room.code);
        return reply(cb, { ok: true });
      }
      if (wasGameMaster) promoteGameMaster(s.room);

      const active = connectedPlayers(s.room).length;
      const inProgress = s.room.phase !== "lobby" && s.room.phase !== "finished";
      if (inProgress && active < 2) {
        closeRoom(io, s.room);
        return reply(cb, { ok: true });
      }
      advanceAfterDeparture(io, s.room, res.wasCurrentTarget);
      reply(cb, { ok: true });
    });

    // Quick emoji reaction. Ephemeral by design: relayed to everyone in the
    // room and never stored, so it cannot be replayed or used to leak state.
    // Throttled per socket so a held key cannot flood the room.
    socket.on("reaction:send", function (payload: { reaction?: string }) {
      if (!rateOk(socket, "reaction", 400)) return;
      const s = seat(socket);
      if (!s) return;
      const parsed = parsePayload(reactionPayloadSchema, payload);
      const glyph = parsed ? toSafeString(parsed.reaction, 8) : "";
      if (!REACTIONS.includes(glyph)) return;
      const player = findPlayer(s.room, s.playerId);
      if (!player) return;
      const packet: Reaction = {
        id: randomUUID(),
        playerId: player.id,
        name: player.name,
        emoji: player.emoji,
        reaction: glyph,
        ts: Date.now(),
      };
      for (let i = 0; i < s.room.players.length; i++) {
        const p = s.room.players[i];
        if (p.connected && p.socketId) {
          io.to(p.socketId).emit("reaction:new", packet);
        }
      }
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
      const wasGameMaster = isGameMaster(s.room, s.playerId);

      const res = removePlayer(s.room, s.playerId);
      if (!res.removed) return reply(cb, { ok: false, reason: "rejected" });
      unbindSocket(socket.id);

      if (s.room.players.length === 0) {
        releaseRoomCredit(io, s.room.code);
        deleteRoom(s.room.code);
        return reply(cb, { ok: true });
      }

      // Host succession: the room survives the host leaving. Previously the
      // whole game was closed for everyone, which made a host tab-close a
      // guaranteed game over.
      if (wasGameMaster) promoteGameMaster(s.room);

      const active = connectedPlayers(s.room).length;
      const inProgress = s.room.phase !== "lobby" && s.room.phase !== "finished";

      if (inProgress && active < 2) {
        closeRoom(io, s.room);
        return reply(cb, { ok: true });
      }

      advanceAfterDeparture(io, s.room, res.wasCurrentTarget);
      reply(cb, { ok: true });
    });

    socket.on("chat:send", function (payload: { text: string }) {
      if (!rateOk(socket, "chat", 250)) return;
      const s = seat(socket);
      if (!s || !s.room.settings.textChat) return;
      const parsed = parsePayload(chatPayloadSchema, payload);
      const text = parsed ? toSafeString(parsed.text, 500).trim() : "";
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
      const parsed = parsePayload(voiceSignalSchema, payload);
      if (!parsed) return;
      const target = findPlayer(s.room, parsed.to);
      if (!target || !target.socketId || !target.connected) return;
      io.to(target.socketId).emit("voice:offer", { from: s.playerId, sdp: parsed.sdp });
    });

    socket.on("voice:answer", function (payload: { to: string; sdp: RTCSessionDescriptionInit }) {
      const s = seat(socket);
      if (!s || !s.room.settings.voiceChat) return;
      const parsed = parsePayload(voiceSignalSchema, payload);
      if (!parsed) return;
      const target = findPlayer(s.room, parsed.to);
      if (!target || !target.socketId || !target.connected) return;
      io.to(target.socketId).emit("voice:answer", { from: s.playerId, sdp: parsed.sdp });
    });

    socket.on("voice:ice", function (payload: { to: string; candidate: RTCIceCandidateInit }) {
      const s = seat(socket);
      if (!s || !s.room.settings.voiceChat) return;
      const parsed = parsePayload(voiceSignalSchema, payload);
      if (!parsed) return;
      const target = findPlayer(s.room, parsed.to);
      if (!target || !target.socketId || !target.connected) return;
      io.to(target.socketId).emit("voice:ice", { from: s.playerId, candidate: parsed.candidate });
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

        // Host succession on disconnect too: a dropped host used to close the
        // room for everyone. Now the longest-connected player takes over.
        if (isGameMaster(room, player.id)) promoteGameMaster(room);

        // A game in progress with fewer than two connected players can never
        // continue: hiding needs two hiders and finding needs a guesser plus a
        // target. Close it the same way game:leave does, instead of leaving the
        // remaining player stuck on a phase that will never advance.
        const stillConnected = connectedPlayers(room).length;
        if (room.phase !== "lobby" && room.phase !== "finished" && stillConnected < 2) {
          closeRoom(io, room);
          return;
        }

        advanceAfterDeparture(io, room, false);
      }
    });
  });
}