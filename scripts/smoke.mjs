import { io } from "socket.io-client";

const URL = process.env.SMOKE_URL || "http://localhost:3000";
const log = (...a) => console.log(...a);
const wait = (ms) => new Promise((r) => setTimeout(r, ms));

function connect() {
  const s = io(URL, { transports: ["websocket"], forceNew: true });
  s.last = null;
  s.on("state", (st) => (s.last = st));
  return s;
}
const emitAck = (s, ev, p) => new Promise((res) => s.emit(ev, p, res));
function nextState(s, pred) {
  return new Promise((res) => {
    if (s.last && (!pred || pred(s.last))) return res(s.last);
    const h = (st) => {
      if (!pred || pred(st)) {
        s.off("state", h);
        res(st);
      }
    };
    s.on("state", h);
  });
}

const spots = [
  { lat: 40.758, lng: -73.9855, panoId: "pano-A" },
  { lat: 48.8584, lng: 2.2945, panoId: "pano-B" },
  { lat: 35.6595, lng: 139.7005, panoId: "pano-C" },
];

let failures = 0;
const check = (name, cond) => {
  log(`${cond ? "✓" : "✗"} ${name}`);
  if (!cond) failures++;
};

const a = connect();
const b = connect();
const c = connect();
await Promise.all(
  [a, b, c].map((s) => new Promise((r) => s.on("connect", r))),
);

const created = await emitAck(a, "game:create", { gmName: "Alice", gmEmoji: "02-dance" });
check("create returns code", !!created.code);
const code = created.code;

// Distinct emojis: avatars are unique per room, so each player picks their own.
const jb = await emitAck(b, "game:join", { code, name: "Bob", emoji: "cat" });
const jc = await emitAck(c, "game:join", { code, name: "Cara", emoji: "fox" });
check("Bob joined", jb.ok === true);
check("Cara joined", jc.ok === true);

const dup = await emitAck(connect(), "game:join", { code, name: "Bob" });
check("duplicate name rejected", dup.ok === false && dup.error === "name_taken");

let sA = await nextState(a, (s) => s.players.length === 3);
check("lobby shows 3 players", sA.players.length === 3);
check("Alice is GM", sA.youAreGameMaster === true);

// non-GM start is ignored
b.emit("game:start");
await wait(200);
check("non-GM cannot start", (a.last?.phase ?? "lobby") === "lobby");

a.emit("game:start");
sA = await nextState(a, (s) => s.phase === "hiding");
check("moved to hiding", sA.phase === "hiding");

const blocked = await emitAck(connect(), "game:join", { code, name: "Late" });
check("join blocked in progress", blocked.ok === false && blocked.error === "in_progress");

a.emit("hide:confirm", spots[0]);
b.emit("hide:confirm", spots[1]);
c.emit("hide:confirm", spots[2]);

sA = await nextState(a, (s) => s.phase === "finding");
check("advanced to finding", sA.phase === "finding");
check("3 rounds total", sA.totalRounds === 3);

const ids = {};
sA.players.forEach((p) => (ids[p.name] = p.id));
const byId = { [ids.Alice]: a, [ids.Bob]: b, [ids.Cara]: c };

for (let round = 0; round < 3; round++) {
  // wait until all three sockets have a state for this round
  await wait(100);
  const targetId = [a, b, c].find((s) => s.last?.currentTarget)?.last
    ?.currentTarget?.id;
  check(`round ${round + 1} has a target`, !!targetId);

  // target sees null currentTarget + youAreTarget true
  const targetSock = byId[targetId];
  check(`round ${round + 1} target sits out`, targetSock.last?.youAreTarget === true);

  // place guesses at varying distances to test scoring order
  let i = 0;
  for (const [pid, sock] of Object.entries(byId)) {
    if (pid === targetId) continue;
    sock.emit("guess:confirm", { lat: i === 0 ? 41 : -33, lng: i === 0 ? -74 : 151 });
    i++;
  }

  const res = await nextState(a, (s) => s.phase === "results" && s.currentRound === round);
  check(`round ${round + 1} produced results`, res.result != null);
  check(
    `round ${round + 1} reveals real coords`,
    typeof res.result?.real?.lat === "number",
  );
  check(
    `round ${round + 1} guesses sorted by points`,
    res.result.guesses.every(
      (g, idx, arr) => idx === 0 || arr[idx - 1].points >= g.points,
    ),
  );

  a.emit("round:next");
  if (round < 2) {
    await nextState(a, (s) => s.phase === "finding" && s.currentRound === round + 1);
  } else {
    const fin = await nextState(a, (s) => s.phase === "finished");
    check("game finished", fin.phase === "finished");
    check(
      "scores totaled",
      fin.players.some((p) => p.totalScore > 0),
    );
  }
}

a.emit("game:returnToLobby");
const back = await nextState(a, (s) => s.phase === "lobby");
check("returned to lobby", back.phase === "lobby");
check("scores reset", back.players.every((p) => p.totalScore === 0));

// reconnection: Bob's token still works after a fresh socket
const reB = connect();
await new Promise((r) => reB.on("connect", r));
const rec = await emitAck(reB, "game:reconnect", {
  code,
  sessionToken: jb.sessionToken,
});
check("reconnect with valid token", rec.ok === true && rec.playerId === ids.Bob);
const recBad = await emitAck(connect(), "game:reconnect", {
  code,
  sessionToken: "nope",
});
check("reconnect bad token rejected", recBad.ok === false);

// --- solo mode: one player, game-picked locations -------------------------
// We inject solo:target with fixed spots (the browser would normally resolve
// these via Google Street View, which Node can't reach) to drive the full loop.
const solo = connect();
await new Promise((r) => solo.on("connect", r));
const soloCreated = await emitAck(solo, "game:create", { gmName: "Solo" });
const soloCode = soloCreated.code;

let sS = await nextState(solo, (s) => s.code === soloCode);
check("solo lobby starts multiplayer-flagged off", sS.phase === "lobby" && sS.solo === false);

solo.emit("game:start");
sS = await nextState(solo, (s) => s.phase === "finding");
check("lone host starts a solo game", sS.solo === true);
check("solo uses soloRounds as total", sS.totalRounds === sS.settings.soloRounds);

const soloSpots = [
  { lat: 40.758, lng: -73.9855, panoId: "solo-pano-A" },
  { lat: 48.8584, lng: 2.2945, panoId: "solo-pano-B" },
];
const soloRounds = sS.settings.soloRounds;
for (let round = 0; round < soloRounds; round++) {
  sS = await nextState(
    solo,
    (s) => s.phase === "finding" && s.currentRound === round,
  );
  check(`solo round ${round + 1} awaits a generated target`, sS.currentTarget === null);

  solo.emit("solo:target", soloSpots[round % soloSpots.length]);
  sS = await nextState(
    solo,
    (s) => s.currentTarget != null && s.currentRound === round,
  );
  check(
    `solo round ${round + 1} sends pano without coords`,
    !!sS.currentTarget?.panoId && sS.currentTarget.lat === undefined,
  );

  solo.emit("guess:confirm", { lat: 41, lng: -74 });
  const r = await nextState(
    solo,
    (s) => s.phase === "results" && s.currentRound === round,
  );
  check(
    `solo round ${round + 1} reveals coords + one guess`,
    typeof r.result?.real?.lat === "number" && r.result.guesses.length === 1,
  );

  solo.emit("round:next");
}

const soloFin = await nextState(solo, (s) => s.phase === "finished");
check("solo game finishes after soloRounds", soloFin.phase === "finished");
check("solo score totaled", soloFin.players[0].totalScore > 0);

solo.emit("game:returnToLobby");
const soloBack = await nextState(solo, (s) => s.phase === "lobby");
check("solo returns to lobby (mode reset)", soloBack.phase === "lobby" && soloBack.solo === false);

log(`\n${failures === 0 ? "ALL PASS ✅" : failures + " FAILURE(S) ❌"}`);
process.exit(failures === 0 ? 0 : 1);
