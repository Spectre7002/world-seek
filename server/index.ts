import { createServer } from "http";
import next from "next";
import { Server } from "socket.io";
import { registerHandlers } from "./handlers";
import { allRooms, roomCount, sweepIdleRooms } from "../src/server-logic/store";
import { logBudgetAtBoot } from "../src/server-logic/budget";
import { getNearestLocation } from "../src/server-logic/locations";
import { tickPhase } from "../src/server-logic/transitions";
import { projectFor } from "../src/server-logic/projection";
import { reportError } from "../src/server-logic/logger";

const dev = process.env.NODE_ENV !== "production";
const port = parseInt(process.env.PORT || "3000", 10);
const startedAt = Date.now();

// Захист від падіння сервера при необроблених помилках. Both hooks emit a
// structured line and forward to the optional reporter, so an uncaught error
// is not just a bare console dump.
process.on("uncaughtException", function (err) {
  reportError(err, { source: "uncaughtException" });
});

process.on("unhandledRejection", function (reason) {
  reportError(reason, { source: "unhandledRejection" });
});

const IDLE_ROOM_TTL_MS = 30 * 60 * 1000; // 30 хвилин
const SWEEP_INTERVAL_MS = 5 * 60 * 1000;  // Кожні 5 хвилин

// Server-authoritative phase clock. The client timer is only a display now:
// this loop is what actually advances a phase whose deadline has passed, so an
// idle or disconnected player can never stall a room.
const PHASE_TICK_MS = 500;

const app = next({ dev: dev });
const handle = app.getRequestHandler();

// /api/road-snap scans the whole global pool on every call, so it needs a cheap
// per-IP guard. A fixed window is enough: the endpoint is only hit when a player
// clicks the hiding map, not on a timer.
const ROAD_SNAP_WINDOW_MS = 60_000;
const ROAD_SNAP_MAX_PER_WINDOW = 60;
const roadSnapHits = new Map<string, { count: number; resetAt: number }>();

function roadSnapAllowed(ip: string): boolean {
  const now = Date.now();
  const entry = roadSnapHits.get(ip);
  if (!entry || now >= entry.resetAt) {
    roadSnapHits.set(ip, { count: 1, resetAt: now + ROAD_SNAP_WINDOW_MS });
    return true;
  }
  if (entry.count >= ROAD_SNAP_MAX_PER_WINDOW) return false;
  entry.count += 1;
  return true;
}

// Keep the map from growing without bound on a long-lived process.
setInterval(function () {
  const now = Date.now();
  for (const [ip, entry] of roadSnapHits) {
    if (now >= entry.resetAt) roadSnapHits.delete(ip);
  }
}, ROAD_SNAP_WINDOW_MS).unref?.();

app.prepare().then(function () {
  const server = createServer(function (req, res) {
    const requestUrl = new URL(req.url || "/", `http://${req.headers.host || "localhost"}`);
    if (req.method === "GET" && requestUrl.pathname === "/api/health") {
      const rooms = roomCount();
      let players = 0;
      const all = allRooms();
      for (let i = 0; i < all.length; i++) {
        players += all[i].players.filter((p) => p.connected).length;
      }
      res.writeHead(200, {
        "content-type": "application/json",
        "cache-control": "no-store",
      });
      res.end(JSON.stringify({
        ok: true,
        uptimeMs: Date.now() - startedAt,
        rooms: rooms,
        connectedPlayers: players,
        connections: io ? io.engine.clientsCount : 0,
        // The local Maps admission meter is disabled (Cloud Monitoring is the
        // source of truth); reported here so an operator is not misled.
        mapsAdmissionMeter: "disabled",
      }));
      return;
    }
    if (req.method === "GET" && requestUrl.pathname === "/api/road-snap") {
      const ip =
        (req.headers["x-forwarded-for"] as string | undefined)?.split(",")[0].trim() ||
        req.socket.remoteAddress ||
        "unknown";
      if (!roadSnapAllowed(ip)) {
        res.writeHead(429, { "content-type": "application/json" });
        res.end(JSON.stringify({ ok: false, error: "rate_limited" }));
        return;
      }
      const lat = Number(requestUrl.searchParams.get("lat"));
      const lng = Number(requestUrl.searchParams.get("lng"));
      if (!Number.isFinite(lat) || !Number.isFinite(lng) ||
        lat < -90 || lat > 90 || lng < -180 || lng > 180) {
        res.writeHead(400, { "content-type": "application/json" });
        res.end(JSON.stringify({ ok: false, error: "invalid_coordinates" }));
        return;
      }
      const location = getNearestLocation(lat, lng, "global");
      res.writeHead(200, {
        "content-type": "application/json",
        "cache-control": "no-store",
      });
      res.end(JSON.stringify(location ? { ok: true, location } : { ok: false, error: "not_found" }));
      return;
    }
    handle(req, res);
  });

  // Fail closed in production: without ALLOWED_ORIGIN the previous
  // `origin: true` reflected *any* origin, so a hostile page could open a
  // socket to the room server. Refuse cross-origin (same-origin requests carry
  // no Origin header and are always allowed) unless the operator opts in.
  const allowedOrigin = process.env.ALLOWED_ORIGIN?.trim();
  const corsOrigin: string | boolean = dev
    ? "*"
    : allowedOrigin && allowedOrigin.length > 0
      ? allowedOrigin
      : false;

  const io = new Server(server, {
    cors: { origin: corsOrigin },
    maxHttpBufferSize: 256 * 1024,
    pingTimeout: 20000,
  });

  registerHandlers(io);

  const sweeper = setInterval(function () {
    const dropped = sweepIdleRooms(IDLE_ROOM_TTL_MS);
    if (dropped > 0) {
      console.log("[sweep] dropped " + dropped + " idle room(s)");
    }
  }, SWEEP_INTERVAL_MS);

  if (sweeper.unref) {
    sweeper.unref();
  }

  const phaseClock = setInterval(function () {
    const now = Date.now();
    const rooms = allRooms();
    for (let i = 0; i < rooms.length; i++) {
      const room = rooms[i];
      if (room.deadlineAt == null || now < room.deadlineAt) continue;
      if (!tickPhase(room, now)) continue;
      // The phase changed: push the new state to everyone still connected.
      for (let j = 0; j < room.players.length; j++) {
        const p = room.players[j];
        if (p.connected && p.socketId) {
          io.to(p.socketId).emit("state", projectFor(room, p.id));
        }
      }
    }
  }, PHASE_TICK_MS);

  if (phaseClock.unref) {
    phaseClock.unref();
  }

  server.listen(port, function () {
    console.log("> World Seek ready on http://localhost:" + port);
    void logBudgetAtBoot();
  });
});