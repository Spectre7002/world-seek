import { io } from "socket.io-client";

const URL = process.env.SMOKE_URL || "http://localhost:3000";
const wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
const players = [];
let failures = 0;

function check(label, condition) {
  console.log(`${condition ? "✓" : "✗"} ${label}`);
  if (!condition) failures++;
}

function connect() {
  const socket = io(URL, { transports: ["websocket"], forceNew: true });
  socket.last = null;
  socket.liveViews = [];
  socket.on("state", (state) => {
    socket.last = state;
  });
  socket.on("view:live", (view) => {
    socket.liveViews = socket.liveViews.filter((item) => item.playerId !== view.playerId);
    socket.liveViews.push(view);
  });
  return socket;
}

function emitAck(socket, event, payload) {
  return new Promise((resolve, reject) => {
    const timeout = setTimeout(() => reject(new Error(`${event} timed out`)), 8000);
    const ack = (result) => {
      clearTimeout(timeout);
      resolve(result);
    };
    if (payload === undefined) socket.emit(event, ack);
    else socket.emit(event, payload, ack);
  });
}

async function waitForState(socket, predicate) {
  if (socket.last && predicate(socket.last)) return socket.last;
  return new Promise((resolve, reject) => {
    const timeout = setTimeout(() => {
      socket.off("state", onState);
      reject(new Error("Timed out waiting for game state"));
    }, 8000);
    function onState(state) {
      if (!predicate(state)) return;
      clearTimeout(timeout);
      socket.off("state", onState);
      resolve(state);
    }
    socket.on("state", onState);
  });
}

try {
  for (let index = 0; index < 10; index++) {
    const socket = connect();
    players.push(socket);
  }
  await Promise.all(players.map((socket) => new Promise((resolve) => socket.on("connect", resolve))));

  const created = await emitAck(players[0], "game:create", {
    gmName: "Capacity GM",
    gmEmoji: "grinning",
  });
  check("host room created", created.ok === true);

  const emojiIds = [
    "cool", "nerd", "clown", "mind-blown", "ghost",
    "robot", "alien", "dog", "cat",
  ];
  for (let index = 1; index < players.length; index++) {
    const joined = await emitAck(players[index], "game:join", {
      code: created.code,
      name: `Player ${index + 1}`,
      emoji: emojiIds[index - 1],
    });
    check(`player ${index + 1} joined`, joined.ok === true);
  }

  await emitAck(players[0], "game:settings", { settings: { multiplayerCycles: 1 } });
  await waitForState(players[0], (state) => state.players.length === 10);
  check("lobby supports ten players", players[0].last.players.length === 10);

  const overflowSocket = connect();
  await new Promise((resolve) => overflowSocket.on("connect", resolve));
  const overCapacity = await emitAck(
  overflowSocket,
    "game:join",
    { code: created.code, name: "Player 11", emoji: "fox" },
  );
  check("eleventh player is rejected", overCapacity.ok === false && overCapacity.error === "full");
  overflowSocket.disconnect();

  await emitAck(players[0], "game:start");
  await Promise.all(players.map((socket) => waitForState(socket, (state) => state.phase === "hiding")));
  const spot = (index) => ({
    lat: 30 + index,
    lng: -100 + index * 2,
    panoId: `capacity-pano-${index}`,
  });
  for (let index = 0; index < players.length; index++) {
    players[index].emit("hide:confirm", spot(index));
  }
  await Promise.all(players.map((socket) => waitForState(socket, (state) => state.phase === "finding")));
  check("all ten hiders advance to finding", players.every((socket) => socket.last.hiddenCount === 10));

  let previousTargetId = "";
  for (let round = 0; round < 10; round++) {
    await wait(80);
    const target = players.find((socket) => socket.last?.youAreTarget);
    check(`round ${round + 1} has one target`, Boolean(target));
    if (!target) break;

    const hunter = players.find((socket) => !socket.last?.youAreTarget);
    const targetId = target.last.youId;
    check(`round ${round + 1} uses a new target`, targetId !== previousTargetId);
    previousTargetId = targetId;
    const hunterId = hunter.last.youId;
    hunter.emit("view:sync", {
      panoId: `live-pano-${round}`,
      heading: 120,
      pitch: 0,
      zoom: 1,
    });
    await new Promise((resolve, reject) => {
      if (target.liveViews.some((view) => view.playerId === hunterId && view.panoId === `live-pano-${round}`)) {
        resolve();
        return;
      }
      const timeout = setTimeout(() => {
        target.off("view:live", onView);
        reject(new Error("Timed out waiting for live Street View"));
      }, 8000);
      function onView(view) {
        if (view.playerId !== hunterId || view.panoId !== `live-pano-${round}`) return;
        clearTimeout(timeout);
        target.off("view:live", onView);
        target.liveViews.push(view);
        resolve();
      }
      target.on("view:live", onView);
    });
    check(`round ${round + 1} live Street View reaches the hider`, target.liveViews.some((view) => view.playerId === hunterId && view.panoId === `live-pano-${round}`));
    check(`round ${round + 1} hides target identity from hunters`, players.filter((socket) => !socket.last.youAreTarget).every((socket) => socket.last.currentTarget?.id === targetId));

    for (const socket of players) {
      if (socket.last.youAreTarget) continue;
      socket.emit("guess:confirm", { lat: 35 + round, lng: 12 - round });
    }
    await waitForState(players[0], (state) => state.phase === "results");
    check(`round ${round + 1} scores all nine hunters`, players[0].last.result?.guesses.length === 9);

    await emitAck(players[0], "round:next");
    if (round < 9) {
      await Promise.all(players.map((socket) =>
        waitForState(socket, (state) => state.phase === "finding"),
      ));
    } else {
      await Promise.all(players.map((socket) => waitForState(socket, (state) => state.phase === "finished")));
    }
  }

  check("all ten players remain in final scores", players.every((socket) => socket.last.players.length === 10));
} catch (error) {
  failures++;
  console.error(error);
} finally {
  for (const socket of players) socket.disconnect();
}

console.log(`\n${failures === 0 ? "ALL PASS ✅" : `${failures} FAILURE(S) ❌`}`);
process.exitCode = failures === 0 ? 0 : 1;
