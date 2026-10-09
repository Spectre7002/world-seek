import { createServer } from "http";
import next from "next";
import { Server } from "socket.io";
import { registerHandlers } from "./handlers";
import { sweepIdleRooms } from "../src/server-logic/store";
import { budgetStatus, logBudgetAtBoot } from "../src/server-logic/budget";
import { getNearestLocation } from "../src/server-logic/locations";

const dev = process.env.NODE_ENV !== "production";
const port = parseInt(process.env.PORT || "3000", 10);

// Захист від падіння сервера при необроблених помилках
process.on("uncaughtException", function (err) {
  console.error("[uncaughtException]", err);
});

process.on("unhandledRejection", function (reason) {
  console.error("[unhandledRejection]", reason);
});

const IDLE_ROOM_TTL_MS = 30 * 60 * 1000; // 30 хвилин
const SWEEP_INTERVAL_MS = 5 * 60 * 1000;  // Кожні 5 хвилин

const app = next({ dev: dev });
const handle = app.getRequestHandler();

app.prepare().then(function () {
  const server = createServer(function (req, res) {
    const requestUrl = new URL(req.url || "/", `http://${req.headers.host || "localhost"}`);
    if (req.method === "GET" && requestUrl.pathname === "/api/budget") {
      res.writeHead(200, {
        "content-type": "application/json",
        "cache-control": "no-store",
      });
      res.end(JSON.stringify(budgetStatus()));
      return;
    }
    if (req.method === "GET" && requestUrl.pathname === "/api/road-snap") {
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

  const io = new Server(server, {
    cors: { origin: dev ? "*" : process.env.ALLOWED_ORIGIN || true },
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

  server.listen(port, function () {
    console.log("> World Seek ready on http://localhost:" + port);
    void logBudgetAtBoot();
  });
});