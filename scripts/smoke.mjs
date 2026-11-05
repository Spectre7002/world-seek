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
// Payloadless events (round:next, round:forceAdvance, ...) take the ack in the
// first slot, so the payload argument must be omitted entirely.
const emitAction = (s, ev) => new Promise((res) => s.emit(ev, res));
function nextState(s, pred, timeoutMs) {
  return new Promise((res) => {
    if (s.last && (!pred || pred(s.last))) return res(s.last);
    let timer = null;
    const h = (st) => {
      if (!pred || pred(st)) {
        s.off("state", h);
        if (timer) clearTimeout(timer);
        res(st);
      }
    };
    s.on("state", h);
    // Resolve with the last known state on timeout so a failing assertion
    // reports the real phase instead of hanging the whole run.
    if (timeoutMs) {
      timer = setTimeout(() => {
        s.off("state", h);
        res(s.last);
      }, timeoutMs);
    }
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

// Two cycles verify players can hide again and progress through every turn.
await emitAck(a, "game:settings", { settings: { multiplayerCycles: 2 } });

// non-GM start is ignored
b.emit("game:start");
await wait(200);
check("non-GM cannot start", (a.last?.phase ?? "lobby") === "lobby");

a.emit("game:start");
sA = await nextState(a, (s) => s.phase === "hiding");
check("moved to hiding", sA.phase === "hiding");
check("hiding phase has a server deadline or none", sA.deadlineAt === null || typeof sA.deadlineAt === "number");

// A late joiner is no longer refused: they take a spectator seat and are
// promoted to a real player when the room returns to the lobby.
const lateSock = connect();
await new Promise((r) => lateSock.on("connect", r));
const lateJoin = await emitAck(lateSock, "game:join", { code, name: "Late", emoji: "panda" });
check("late join accepted as spectator", lateJoin.ok === true);
const sLate = await nextState(lateSock, (s) => s.players.some((p) => p.name === "Late"));
check("late joiner is flagged a spectator", sLate.youAreSpectator === true);
check(
  "spectator is not counted as a hider",
  sLate.expectedHiders === 3,
);
lateSock.disconnect();

a.emit("hide:confirm", spots[0]);
b.emit("hide:confirm", spots[1]);
c.emit("hide:confirm", spots[2]);

sA = await nextState(a, (s) => s.phase === "finding");
check("advanced to finding", sA.phase === "finding");
check("two cycles configured", sA.totalRounds === 2);

const ids = {};
sA.players.forEach((p) => (ids[p.name] = p.id));
const byId = { [ids.Alice]: a, [ids.Bob]: b, [ids.Cara]: c };
let previousTargetId = "";

for (let round = 0; round < 6; round++) {
  // wait until all three sockets have a state for this round
  await wait(100);
  const targetId = [a, b, c].find((s) => s.last?.youAreTarget)?.last?.youId;
  check(`round ${round + 1} has a target`, !!targetId);
  if (round % 3 === 0) previousTargetId = "";
  check(`round ${round + 1} uses a new target in this cycle`, !!targetId && targetId !== previousTargetId);
  previousTargetId = targetId;

  // target sees null currentTarget + youAreTarget true
  const targetSock = byId[targetId];
  check(`round ${round + 1} target sits out`, targetSock.last?.youAreTarget === true);

  // guess:preview must reach watchers as a `live:update` delta, not a full
  // state broadcast. The target is a watcher; an active hunter is not.
  if (round === 0) {
    const hunterSock = Object.entries(byId).find(([pid]) => pid !== targetId)[1];
    const hunterId = Object.keys(byId).find((pid) => pid !== targetId);
    const delta = await new Promise((resolve) => {
      const timer = setTimeout(() => resolve(null), 3000);
      targetSock.once("live:update", (packet) => {
        clearTimeout(timer);
        resolve(packet);
      });
      hunterSock.emit("guess:preview", { lat: 12.5, lng: 34.5 });
    });
    check("guess:preview sends a live:update delta to the target", delta != null);
    check(
      "live:update carries only the pin list",
      delta != null && Array.isArray(delta.pins) && !("phase" in delta),
    );
    check(
      "live:update includes the hunter's tentative pin",
      delta != null &&
        delta.pins.some((pin) => pin.playerId === hunterId && pin.confirmed === false),
    );
  }

  // place guesses at varying distances to test scoring order
  let i = 0;
  for (const [pid, sock] of Object.entries(byId)) {
    if (pid === targetId) continue;
    sock.emit("guess:confirm", { lat: i === 0 ? 41 : -33, lng: i === 0 ? -74 : 151 });
    i++;
  }

  const res = await nextState(a, (s) => s.phase === "results" && s.result?.targetId === targetId);
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
  if (round === 2) {
    await Promise.all([a, b, c].map((s) => nextState(s, (state) => state.phase === "hiding")));
    check("second hiding cycle resets all spots", [a, b, c].every((s) => !s.last.youHaveHidden));
    a.emit("hide:confirm", { ...spots[0], panoId: "pano-A-cycle-2" });
    b.emit("hide:confirm", { ...spots[1], panoId: "pano-B-cycle-2" });
    c.emit("hide:confirm", { ...spots[2], panoId: "pano-C-cycle-2" });
    await Promise.all([a, b, c].map((s) => nextState(s, (state) => state.phase === "finding")));
  } else if (round < 5) {
    await nextState(a, (s) => s.phase === "finding");
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
check("lobby has no deadline", back.deadlineAt === null);

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

// --- solo mode: one player, server-picked locations -----------------------
// The server picks each target from the maps pool (startSolo), so there is no
// client-side target injection to drive here. The old version emitted
// `solo:target`, which no handler listens for, and asserted the target was
// null — both stale.
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

const soloRounds = sS.settings.soloRounds;
for (let round = 0; round < soloRounds; round++) {
  sS = await nextState(
    solo,
    (s) => s.phase === "finding" && s.currentRound === round,
  );
  check(
    `solo round ${round + 1} has a server-picked target`,
    !!sS.currentTarget?.panoId,
  );
  check(
    `solo round ${round + 1} sends pano without coords`,
    sS.currentTarget?.lat === undefined && sS.currentTarget?.lng === undefined,
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

// --- HP mode: 3 players, shared location, damage + multiplier -------------
// Covers the 3+ player path, which previously had no HUD and no test.
const hpSocks = [connect(), connect(), connect()];
await Promise.all(hpSocks.map((s) => new Promise((r) => s.on("connect", r))));
const hpCreated = await emitAck(hpSocks[0], "game:create", { gmName: "HpHost", gmEmoji: "robot" });
const hpCode = hpCreated.code;
await emitAck(hpSocks[1], "game:join", { code: hpCode, name: "HpTwo", emoji: "fox" });
await emitAck(hpSocks[2], "game:join", { code: hpCode, name: "HpThree", emoji: "panda" });

await emitAck(hpSocks[0], "game:settings", { settings: { gameMode: "hp" } });
let sH = await nextState(hpSocks[0], (s) => s.players.length === 3);
check("hp mode accepted with 3 players", sH.settings.gameMode === "hp");
check("3-player hp is not flagged 1v1", sH.is1v1 === false);

hpSocks[0].emit("game:start");
sH = await nextState(hpSocks[0], (s) => s.phase === "finding");
check("hp game starts in finding", sH.phase === "finding");
check("hp game has a shared target", !!sH.currentTarget?.panoId);
check("hp game is not flagged solo", sH.solo === false);

// Everyone guesses; the best guess takes no damage, the rest lose HP.
hpSocks[0].emit("guess:confirm", { lat: 41, lng: -74 });
hpSocks[1].emit("guess:confirm", { lat: -33, lng: 151 });
hpSocks[2].emit("guess:confirm", { lat: 10, lng: 10 });
const hpRes = await nextState(hpSocks[0], (s) => s.phase === "results");
check("hp round produced results", hpRes.result != null);
check("hp results list every guess", hpRes.result.guesses.length === 3);
const hpAfter = hpRes.players;
check("hp leader keeps full health", hpAfter.some((p) => p.hp === 10000));
check("hp losers took damage", hpAfter.some((p) => p.hp < 10000));
check("hp leader gained a multiplier", hpAfter.some((p) => (p.guessMultiplier ?? 1) > 1));

// A 1v1 duel is derived from the connected count, not stored.
const duelSocks = [connect(), connect()];
await Promise.all(duelSocks.map((s) => new Promise((r) => s.on("connect", r))));
const duelCreated = await emitAck(duelSocks[0], "game:create", { gmName: "DuelA", gmEmoji: "cat" });
await emitAck(duelSocks[1], "game:join", { code: duelCreated.code, name: "DuelB", emoji: "dog" });
await emitAck(duelSocks[0], "game:settings", { settings: { gameMode: "hp" } });
const sD = await nextState(duelSocks[0], (s) => s.players.length === 2);
check("2-player hp is flagged 1v1", sD.is1v1 === true);

// --- HP mode: the "first guess in -> 15s" rule is server-side --------------
// The client timer is only a display now, so a client-only cap would be
// ignored and the server would wait out the full configured limit.
const graceSocks = [connect(), connect()];
await Promise.all(graceSocks.map((s) => new Promise((r) => s.on("connect", r))));
const graceCreated = await emitAck(graceSocks[0], "game:create", { gmName: "GraceA", gmEmoji: "cat" });
await emitAck(graceSocks[1], "game:join", { code: graceCreated.code, name: "GraceB", emoji: "fox" });
await emitAck(graceSocks[0], "game:settings", {
  settings: { gameMode: "hp", findingTimeLimit: 120 },
});
await nextState(graceSocks[0], (s) => s.players.length === 2);
graceSocks[0].emit("game:start");
let sG = await nextState(graceSocks[0], (s) => s.phase === "finding");
check(
  "hp round starts with the full configured deadline",
  Math.round((sG.deadlineAt - Date.now()) / 1000) >= 118,
);

graceSocks[0].emit("guess:confirm", { lat: 41, lng: -74 });
await wait(700);
sG = graceSocks[1].last;
const graceLeft = Math.round((sG.deadlineAt - Date.now()) / 1000);
check("first hp guess shortens the deadline to ~15s", graceLeft <= 15 && graceLeft >= 12);
check("first hp guess is timestamped", typeof sG.firstGuessTime === "number");
sG = await nextState(graceSocks[1], (s) => s.phase === "results", 20000);
check("hp round ends on the 15s grace deadline", sG.phase === "results");

// With no configured timer at all, the first guess must still create one —
// otherwise an HP round where someone never guesses hangs forever.
const noTimerSocks = [connect(), connect()];
await Promise.all(noTimerSocks.map((s) => new Promise((r) => s.on("connect", r))));
const noTimerCreated = await emitAck(noTimerSocks[0], "game:create", { gmName: "NoTimerA", gmEmoji: "cat" });
await emitAck(noTimerSocks[1], "game:join", { code: noTimerCreated.code, name: "NoTimerB", emoji: "fox" });
await emitAck(noTimerSocks[0], "game:settings", {
  settings: { gameMode: "hp", findingTimeLimit: 0 },
});
await nextState(noTimerSocks[0], (s) => s.players.length === 2);
noTimerSocks[0].emit("game:start");
let sN = await nextState(noTimerSocks[0], (s) => s.phase === "finding");
check("hp with no timer has no deadline before the first guess", sN.deadlineAt === null);
noTimerSocks[0].emit("guess:confirm", { lat: 41, lng: -74 });
await wait(700);
sN = noTimerSocks[1].last;
check("first hp guess creates a 15s deadline", typeof sN.deadlineAt === "number");
sN = await nextState(noTimerSocks[1], (s) => s.phase === "results", 20000);
check("hp round ends even with no configured timer", sN.phase === "results");

// --- Phase 2: server authority -------------------------------------------
// The server owns the phase clock, so a hiding timer expires on its own even
// if nobody confirms a spot. This is the structural fix for the stall bugs.
const clockSocks = [connect(), connect()];
await Promise.all(clockSocks.map((s) => new Promise((r) => s.on("connect", r))));
const clockCreated = await emitAck(clockSocks[0], "game:create", { gmName: "ClockA", gmEmoji: "robot" });
const clockCode = clockCreated.code;
await emitAck(clockSocks[1], "game:join", { code: clockCode, name: "ClockB", emoji: "fox" });
await emitAck(clockSocks[0], "game:settings", {
  settings: { hidingTimeLimit: 1, findingTimeLimit: 1 },
});
let sC = await nextState(clockSocks[0], (s) => s.players.length === 2);
check("hiding timer accepted", sC.settings.hidingTimeLimit === 1);

clockSocks[0].emit("game:start");
sC = await nextState(clockSocks[0], (s) => s.phase === "hiding");
check("hiding phase carries a deadline", typeof sC.deadlineAt === "number" && sC.deadlineAt > Date.now());

// Nobody hides. The server must drop both players on a spot and start finding.
sC = await nextState(clockSocks[0], (s) => s.phase === "finding", 8000);
check("server auto-advanced hiding on timer expiry", sC.phase === "finding");
check("finding phase carries a deadline", typeof sC.deadlineAt === "number");

// Nobody guesses. The server must score the round and move to results.
sC = await nextState(clockSocks[0], (s) => s.phase === "results", 8000);
check("server auto-advanced finding on timer expiry", sC.phase === "results");

// Host force-advance: skip a phase immediately, even with no timer at all.
// Timers are only settable in the lobby, so the next round inherits the 1s
// limits; force-advance must still work before they expire.
clockSocks[0].emit("round:next");
sC = await nextState(clockSocks[0], (s) => s.phase === "finding", 5000);
check("round:next moved to the next target", sC.phase === "finding");

const nonHostForce = await emitAction(clockSocks[1], "round:forceAdvance");
check("non-host cannot force advance", nonHostForce.ok === false);

const hostForce = await emitAction(clockSocks[0], "round:forceAdvance");
check("host can force advance", hostForce.ok === true);
sC = await nextState(clockSocks[0], (s) => s.phase === "results", 5000);
check("force advance skipped finding", sC.phase === "results");

// Spectators must be flagged so the mode-specific rosters can filter them out.
// They sit at a full 10,000 HP, so an unfiltered roster would show a watcher as
// a healthy rival (and the duel HUD would pick them as the opponent).
const specSocks = [connect(), connect(), connect()];
await Promise.all(specSocks.map((s) => new Promise((r) => s.on("connect", r))));
const specCreated = await emitAck(specSocks[0], "game:create", { gmName: "SpecA", gmEmoji: "cat" });
await emitAck(specSocks[1], "game:join", { code: specCreated.code, name: "SpecB", emoji: "fox" });
await emitAck(specSocks[2], "game:join", { code: specCreated.code, name: "SpecC", emoji: "panda" });
await emitAck(specSocks[0], "game:settings", { settings: { gameMode: "hp" } });
await nextState(specSocks[0], (s) => s.players.length === 3);
specSocks[0].emit("game:start");
await nextState(specSocks[0], (s) => s.phase === "finding");

const specLate = connect();
await new Promise((r) => specLate.on("connect", r));
await emitAck(specLate, "game:join", { code: specCreated.code, name: "SpecLate", emoji: "robot" });
let sSp = await nextState(specSocks[0], (s) => s.players.length === 4);
check("mid-game joiner is flagged a spectator", sSp.players.some((p) => p.spectator));
check(
  "seated count excludes the spectator",
  sSp.players.filter((p) => !p.spectator).length === 3,
);
check(
  "spectator is not in the hp roster input",
  sSp.players.filter((p) => !p.spectator).every((p) => p.name !== "SpecLate"),
);
specSocks.forEach((s) => s.disconnect());
specLate.disconnect();

// Host succession: the host leaving must not close the room for everyone.
// Tested in the lobby, because a 2-player game in progress legitimately ends
// when it drops to one player.
const succSocks = [connect(), connect(), connect()];
await Promise.all(succSocks.map((s) => new Promise((r) => s.on("connect", r))));
const succCreated = await emitAck(succSocks[0], "game:create", { gmName: "SuccA", gmEmoji: "cat" });
await emitAck(succSocks[1], "game:join", { code: succCreated.code, name: "SuccB", emoji: "fox" });
await emitAck(succSocks[2], "game:join", { code: succCreated.code, name: "SuccC", emoji: "panda" });
let sS2 = await nextState(succSocks[0], (s) => s.players.length === 3);
const oldHostId = sS2.gameMasterId;
check("original host is the creator", sS2.youAreGameMaster === true);

succSocks[0].emit("game:leave");
sS2 = await nextState(succSocks[1], (s) => s.gameMasterId !== oldHostId, 5000);
check("host succession promoted a new host", sS2.gameMasterId !== oldHostId);
check("new host is a remaining player", sS2.youAreGameMaster === true);
check("room survived the host leaving", sS2.players.length === 2);

// --- Phase 3: case and spell rework --------------------------------------
// Covers the server-owned inventory, case tiers, the pity timer, duplicate
// protection, and the two server-applied spells (FREEZE / REROLL).
const caseSocks = [connect(), connect()];
await Promise.all(caseSocks.map((s) => new Promise((r) => s.on("connect", r))));
const caseCreated = await emitAck(caseSocks[0], "game:create", {
  gmName: "CaseA",
  gmEmoji: "cat",
});
const caseCode = caseCreated.code;
await emitAck(caseSocks[1], "game:join", { code: caseCode, name: "CaseB", emoji: "fox" });

// Cheats on so the test can hand itself spells; cases on; only gold may drop.
await emitAck(caseSocks[0], "game:settings", {
  settings: {
    gameMode: "hp",
    cheatsEnabled: true,
    caseEnabled: true,
    caseTiers: ["SPECIAL"],
  },
});
let sCase = await nextState(caseSocks[0], (s) => s.players.length === 2);
check("case tiers accepted", JSON.stringify(sCase.settings.caseTiers) === '["SPECIAL"]');
check("pity counter starts at zero", sCase.casePity === 0);
check("pity cap is exposed to the client", sCase.casePityMax > 0);

// Garbage tier lists must not make the case unrollable.
await emitAck(caseSocks[0], "game:settings", {
  settings: { caseTiers: ["NOT_A_TIER", 42] },
});
sCase = await nextState(caseSocks[0], (s) => s.settings.caseTiers.length === 5);
check("invalid case tiers fall back to all tiers", sCase.settings.caseTiers.length === 5);
await emitAck(caseSocks[0], "game:settings", { settings: { caseTiers: ["SPECIAL"] } });
await nextState(caseSocks[0], (s) => s.settings.caseTiers.length === 1);

caseSocks[0].emit("game:start");
sCase = await nextState(caseSocks[0], (s) => s.phase === "finding");
check("case test game started", sCase.phase === "finding");

// The cheat grant is the only way to get spells without grinding cases.
const grant = await emitAction(caseSocks[0], "spell:grant");
check("cheat grant hands out spells", grant.ok === true);
sCase = await nextState(caseSocks[0], (s) => s.yourSpells.freeze > 0);
check("granted spells are projected", sCase.yourSpells.freeze === 1);
check("every spell id is granted", sCase.yourSpells.reroll === 1 && sCase.yourSpells.compass === 1);

// One case per player per turn, enforced server-side.
const openA = await emitAction(caseSocks[0], "case:open");
check("case opens", openA.ok === true && !!openA.hint);
check("only the enabled tier drops", openA.hint?.tierKey === "SPECIAL");
check("case items carry a stable key", typeof openA.hint?.itemKey === "string");
const openAgain = await emitAction(caseSocks[0], "case:open");
check("second case in the same turn is refused", openAgain.ok === false);

// `spell:consume` is rate-limited to one cast per 250ms, so the casts below are
// spaced out; otherwise the later ones are refused as rate_limited.
const castSpell = async (sock, spell) => {
  await wait(300);
  return emitAck(sock, "spell:consume", { spell });
};

// REROLL swaps the case the player already opened. The charge is checked as a
// delta, because a reroll can itself land on the REROLL spell item and refund
// the charge it just spent.
const rerollBefore = sCase.yourSpells.reroll;
const reroll = await castSpell(caseSocks[0], "reroll");
check("reroll succeeds on an open case", reroll.ok === true && !!reroll.hint);
check("reroll respects the enabled tiers", reroll.hint?.tierKey === "SPECIAL");
sCase = await nextState(caseSocks[0], (s) => s.yourSpells.reroll !== rerollBefore, 3000);
const rerollAfter = sCase.yourSpells.reroll;
check(
  "reroll charge is spent (or refunded by a reroll reward)",
  rerollAfter === rerollBefore - 1 || rerollAfter === rerollBefore,
);

// A map spell only spends its charge; the effect is drawn client-side.
const scryBefore = sCase.yourSpells.scry;
const scry = await castSpell(caseSocks[0], "scry");
check("map spell consumes a charge", scry.ok === true);
sCase = await nextState(caseSocks[0], (s) => s.yourSpells.scry === scryBefore - 1, 3000);
check("map spell charge is spent", sCase.yourSpells.scry === scryBefore - 1);
check("spell target is sent to a spell owner", typeof sCase.spellTarget?.lat === "number");

// FREEZE blocks the strongest rival from locking a guess.
const freeze = await castSpell(caseSocks[0], "freeze");
check("freeze succeeds with a rival present", freeze.ok === true);
sCase = await nextState(caseSocks[1], (s) => typeof s.youFrozenUntil === "number", 3000);
check("frozen player is told they are frozen", typeof sCase.youFrozenUntil === "number");
check("frozen player is flagged in the roster", sCase.players.some((p) => p.frozenUntil));
const frozenGuess = await emitAck(caseSocks[1], "guess:confirm", { lat: 41, lng: -74 });
check("frozen player cannot lock a guess", frozenGuess.ok === false && frozenGuess.reason === "frozen");

// The caster is not frozen and can still guess.
const freeGuess = await emitAck(caseSocks[0], "guess:confirm", { lat: 41, lng: -74 });
check("caster is not frozen", freeGuess.ok === true);

// A spell the player does not own is refused.
const noCharge = await castSpell(caseSocks[1], "freeze");
check("spending an unowned spell is refused", noCharge.ok === false);
const badSpell = await castSpell(caseSocks[0], "nope");
check("unknown spell id is refused", badSpell.ok === false);

// The pity timer and duplicate protection are pure engine behaviour, so they
// are covered by `npm run check:spells` rather than over the socket (the case
// handler is rate-limited to one open per 500ms).

caseSocks.forEach((s) => s.disconnect());

// --- Phase 5: round history, persistence, stats, leaderboard --------------
// A finished game must be written to the history store exactly once, and the
// per-round log must be visible on the results screen but NOT during finding
// (an earlier target's coordinates would leak to a player still guessing it).
const statsKey = "smoke-player-" + Date.now();
const histSocks = [connect(), connect()];
await Promise.all(histSocks.map((s) => new Promise((r) => s.on("connect", r))));
const histCreated = await emitAck(histSocks[0], "game:create", {
  gmName: "HistA",
  gmEmoji: "cat",
  playerKey: statsKey,
});
const histCode = histCreated.code;
await emitAck(histSocks[1], "game:join", {
  code: histCode,
  name: "HistB",
  emoji: "fox",
  playerKey: statsKey + "-b",
});
await emitAck(histSocks[0], "game:settings", { settings: { multiplayerCycles: 1 } });
await nextState(histSocks[0], (s) => s.players.length === 2);

histSocks[0].emit("game:start");
let sHist = await nextState(histSocks[0], (s) => s.phase === "hiding");
check("history game reached hiding", sHist.phase === "hiding");
check("round history is empty before any round is scored", sHist.roundHistory.length === 0);

histSocks[0].emit("hide:confirm", { lat: 40.758, lng: -73.9855, panoId: "hist-A" });
histSocks[1].emit("hide:confirm", { lat: 48.8584, lng: 2.2945, panoId: "hist-B" });
sHist = await nextState(histSocks[0], (s) => s.phase === "finding");
check("history game reached finding", sHist.phase === "finding");
check(
  "round history stays hidden during finding",
  Array.isArray(sHist.roundHistory) && sHist.roundHistory.length === 0,
);

// Two turns in a one-cycle 2-player game: each player is the target once.
for (let turn = 0; turn < 2; turn++) {
  await wait(100);
  const targetSock = histSocks.find((s) => s.last?.youAreTarget);
  const hunterSock = histSocks.find((s) => !s.last?.youAreTarget);
  check(`history turn ${turn + 1} has a target`, !!targetSock);
  hunterSock.emit("guess:confirm", { lat: 41, lng: -74 });
  const res = await nextState(histSocks[0], (s) => s.phase === "results");
  check(`history turn ${turn + 1} produced results`, res.result != null);
  check(
    `history turn ${turn + 1} is logged`,
    res.roundHistory.length === turn + 1,
  );
  check(
    `history turn ${turn + 1} entry carries the real coords`,
    typeof res.roundHistory[turn]?.real?.lat === "number",
  );
  histSocks[0].emit("round:next");
}

const histFin = await nextState(histSocks[0], (s) => s.phase === "finished");
check("history game finished", histFin.phase === "finished");
check("final screen keeps the full round log", histFin.roundHistory.length === 2);

// The finished game is now in the store, so the personal stats page has data.
const statsRes = await emitAck(histSocks[0], "stats:get", { playerKey: statsKey });
check("stats:get succeeds", statsRes.ok === true);
check("stats count the finished game", statsRes.stats?.games === 1);
check("stats record a best score", (statsRes.stats?.bestScore ?? 0) > 0);
check(
  "stats award the first-game achievement",
  Array.isArray(statsRes.stats?.achievements) &&
    statsRes.stats.achievements.includes("first_game"),
);
check(
  "stats list the game in recent history",
  Array.isArray(statsRes.stats?.recent) && statsRes.stats.recent.length === 1,
);

const boardRes = await emitAck(histSocks[0], "leaderboard:get", { limit: 50 });
check("leaderboard:get succeeds", boardRes.ok === true);
check(
  "leaderboard includes the recorded player",
  Array.isArray(boardRes.entries) &&
    boardRes.entries.some((e) => e.playerKey === statsKey),
);
check(
  "leaderboard reports the maps that have games",
  Array.isArray(boardRes.maps) && boardRes.maps.length > 0,
);

// A missing key is refused rather than silently returning an empty record.
// `stats:get` is rate-limited to one call per 500ms, so wait out the window
// first — otherwise this would pass for the wrong reason (rate_limited).
await wait(600);
const noKey = await emitAck(histSocks[0], "stats:get", {});
check("stats:get without a key is refused", noKey.ok === false && noKey.error === "no_key");

histSocks.forEach((s) => s.disconnect());

// --- Phase 6: social and polish -------------------------------------------
// Seeded games, system chat, reactions, vote-kick, and rematch.

// A seeded solo game must produce the same location sequence twice.
async function seededSoloTargets(seed, rounds) {
  const sock = connect();
  await new Promise((r) => sock.on("connect", r));
  const created = await emitAck(sock, "game:create", { gmName: "Seed" });
  await emitAck(sock, "game:settings", {
    settings: { seed: seed, soloRounds: rounds },
  });
  await nextState(sock, (s) => s.settings.seed === seed);
  sock.emit("game:start");
  let st = await nextState(sock, (s) => s.phase === "finding");
  const panos = [st.currentTarget?.panoId];
  for (let i = 0; i < rounds - 1; i++) {
    sock.emit("guess:confirm", { lat: 41, lng: -74 });
    await nextState(sock, (s) => s.phase === "results");
    sock.emit("round:next");
    st = await nextState(sock, (s) => s.phase === "finding");
    panos.push(st.currentTarget?.panoId);
  }
  sock.disconnect();
  return panos;
}

const seedA = await seededSoloTargets("smoke-seed", 3);
const seedB = await seededSoloTargets("smoke-seed", 3);
check("seeded game produces a target each round", seedA.every((p) => !!p));
check(
  "the same seed replays the same locations",
  seedA.length === seedB.length && seedA.every((p, i) => p === seedB[i]),
);

const seedC = await seededSoloTargets("other-seed", 3);
check(
  "a different seed produces a different sequence",
  seedA.some((p, i) => p !== seedC[i]),
);

// The daily shortcut resolves to a dated seed on the server.
const dailySock = connect();
await new Promise((r) => dailySock.on("connect", r));
const dailyCreated = await emitAck(dailySock, "game:create", { gmName: "Daily" });
await emitAck(dailySock, "game:settings", { settings: { seed: "daily" } });
const sDaily = await nextState(dailySock, (s) => s.settings.seed.startsWith("daily-"));
check("daily seed resolves to a dated seed", /^daily-\d{4}-\d{2}-\d{2}$/.test(sDaily.settings.seed));
dailySock.disconnect();

// System chat: a join queues a notice that arrives as a chat:message.
const sysSocks = [connect(), connect()];
await Promise.all(sysSocks.map((s) => new Promise((r) => s.on("connect", r))));
const sysCreated = await emitAck(sysSocks[0], "game:create", { gmName: "SysA", gmEmoji: "cat" });
const sysCode = sysCreated.code;
const sysMessages = [];
sysSocks[0].on("chat:message", (m) => sysMessages.push(m));
await emitAck(sysSocks[1], "game:join", { code: sysCode, name: "SysB", emoji: "fox" });
await wait(300);
check(
  "a join produces a system chat line",
  sysMessages.some((m) => m.system === true && m.text.includes("SysB")),
);

// Reactions: a whitelisted glyph is relayed, an arbitrary string is dropped.
const gotReactions = [];
sysSocks[0].on("reaction:new", (r) => gotReactions.push(r));
sysSocks[1].emit("reaction:send", { reaction: "🔥" });
await wait(200);
check("a whitelisted reaction is relayed", gotReactions.some((r) => r.reaction === "🔥"));
const before = gotReactions.length;
sysSocks[1].emit("reaction:send", { reaction: "<script>" });
await wait(200);
check("a non-whitelisted reaction is dropped", gotReactions.length === before);

// Vote-kick: the host's single vote is enough in a 2-player room.
const kickSocks = [connect(), connect()];
await Promise.all(kickSocks.map((s) => new Promise((r) => s.on("connect", r))));
const kickCreated = await emitAck(kickSocks[0], "game:create", { gmName: "KickHost", gmEmoji: "cat" });
const kickCode = kickCreated.code;
const kickJoin = await emitAck(kickSocks[1], "game:join", { code: kickCode, name: "KickTarget", emoji: "fox" });
let sKick = await nextState(kickSocks[0], (s) => s.players.length === 2);
check("kick room has two players", sKick.players.length === 2);
check("kick threshold is projected", sKick.kickVotesNeeded === 1);
let kickedEvent = false;
kickSocks[1].on("game:kicked", () => { kickedEvent = true; });
await emitAck(kickSocks[0], "game:voteKick", { targetId: kickJoin.playerId });
await wait(300);
check("the kicked player is told", kickedEvent === true);
sKick = await nextState(kickSocks[0], (s) => s.players.length === 1);
check("the kicked player is removed from the room", sKick.players.length === 1);
kickSocks.forEach((s) => s.disconnect());

// Rematch: the host restarts a finished game in one step.
const rmSocks = [connect(), connect()];
await Promise.all(rmSocks.map((s) => new Promise((r) => s.on("connect", r))));
const rmCreated = await emitAck(rmSocks[0], "game:create", { gmName: "RmHost", gmEmoji: "cat" });
const rmCode = rmCreated.code;
await emitAck(rmSocks[1], "game:join", { code: rmCode, name: "RmTwo", emoji: "fox" });
await emitAck(rmSocks[0], "game:settings", { settings: { multiplayerCycles: 1 } });
await nextState(rmSocks[0], (s) => s.players.length === 2);
rmSocks[0].emit("game:start");
await nextState(rmSocks[0], (s) => s.phase === "hiding");
rmSocks[0].emit("hide:confirm", { lat: 40.758, lng: -73.9855, panoId: "rm-A" });
rmSocks[1].emit("hide:confirm", { lat: 48.8584, lng: 2.2945, panoId: "rm-B" });
await nextState(rmSocks[0], (s) => s.phase === "finding");
for (let turn = 0; turn < 2; turn++) {
  await wait(100);
  const hunter = rmSocks.find((s) => !s.last?.youAreTarget);
  hunter.emit("guess:confirm", { lat: 41, lng: -74 });
  await nextState(rmSocks[0], (s) => s.phase === "results");
  rmSocks[0].emit("round:next");
}
const rmFin = await nextState(rmSocks[0], (s) => s.phase === "finished");
check("rematch room reached finished", rmFin.phase === "finished");
rmSocks[0].emit("game:rematch");
const rmBack = await nextState(rmSocks[0], (s) => s.phase === "hiding");
check("rematch restarts the game in one step", rmBack.phase === "hiding");
check("rematch keeps the same players", rmBack.players.length === 2);
check("rematch resets the scores", rmBack.players.every((p) => p.totalScore === 0));
rmSocks.forEach((s) => s.disconnect());

log(`\n${failures === 0 ? "ALL PASS ✅" : failures + " FAILURE(S) ❌"}`);
process.exit(failures === 0 ? 0 : 1);
