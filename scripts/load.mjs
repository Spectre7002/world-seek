// World Seek load harness.
//
// Drives N concurrent rooms of M players through the real game loop over
// Socket.IO and measures what a player actually feels (action -> state-broadcast
// latency) plus the server's RSS/CPU (sampled by pid). It reuses the same event
// flow as scripts/smoke.mjs, but at scale and under sustained load, with the
// finding-phase live-preview streaming that is the app's heaviest broadcast path.
//
// Usage:
//   node scripts/load.mjs [rooms] [playersPerRoom] [durationSec] [serverPid]
// Example:
//   node scripts/load.mjs 50 6 20 95728
//
// No Google Maps key needed — coordinates are synthetic; the server never calls
// Google (in multiplayer it only stores panoIds/coords the clients send).

import { io } from "socket.io-client";
import { execSync } from "node:child_process";

const ROOMS = parseInt(process.argv[2] || "20", 10);
const PLAYERS = parseInt(process.argv[3] || "6", 10);
const DURATION = parseInt(process.argv[4] || "15", 10) * 1000;
const SERVER_PID = process.argv[5] ? parseInt(process.argv[5], 10) : null;
const URL = process.env.SMOKE_URL || "http://localhost:3000";

const EMOJIS = ["cat","fox","dog","frog","lion","panda","robot","alien","ghost","unicorn","dragon","penguin"];
const wait = (ms) => new Promise((r) => setTimeout(r, ms));
const emitAck = (s, ev, p) =>
  new Promise((res) => { let d=false; s.emit(ev,p,(r)=>{d=true;res(r);}); setTimeout(()=>!d&&res({__timeout:true}),5000); });

function connect() {
  const s = io(URL, { transports: ["websocket"], forceNew: true, reconnection: false });
  s.last = null;
  s.on("state", (st) => { s.last = st; if (s._await) s._await(st); });
  return s;
}
// Resolve when a state matching pred arrives (or immediately if already true).
function onState(s, pred) {
  return new Promise((res) => {
    if (s.last && pred(s.last)) return res(s.last);
    const h = (st) => { if (pred(st)) { s.off("state", h); res(st); } };
    s.on("state", h);
  });
}

// --- metrics -----------------------------------------------------------------
const latencies = [];     // action -> resulting broadcast, ms
let actions = 0;          // actions issued
let broadcasts = 0;       // state events received (all sockets)
let disconnects = 0;
let errors = 0;
const rssSamples = [];
const cpuSamples = [];

function sampleServer() {
  if (!SERVER_PID) return;
  try {
    const out = execSync(`ps -o rss=,%cpu= -p ${SERVER_PID}`, { encoding: "utf8" }).trim();
    const [rss, cpu] = out.split(/\s+/).map(Number);
    if (Number.isFinite(rss)) rssSamples.push(rss);
    if (Number.isFinite(cpu)) cpuSamples.push(cpu);
  } catch {}
}
function pct(arr, p) {
  if (!arr.length) return NaN;
  const a = [...arr].sort((x,y)=>x-y);
  return a[Math.min(a.length-1, Math.floor((p/100)*a.length))];
}
const round1 = (n) => Math.round(n*10)/10;

// --- one room's lifecycle ----------------------------------------------------
async function runRoom(idx, deadline) {
  const socks = [];
  try {
    for (let i = 0; i < PLAYERS; i++) {
      const s = connect();
      s.on("state", () => broadcasts++);
      s.on("disconnect", () => disconnects++);
      s.on("connect_error", () => errors++);
      socks.push(s);
    }
    await Promise.all(socks.map((s) => new Promise((r) => { s.on("connect", r); s.on("connect_error", r); })));

    const created = await emitAck(socks[0], "game:create", { gmName: `H${idx}`, gmEmoji: EMOJIS[0] });
    if (!created.code) { errors++; return; }
    const code = created.code;
    for (let i = 1; i < PLAYERS; i++) {
      await emitAck(socks[i], "game:join", { code, name: `P${idx}_${i}`, emoji: EMOJIS[i % EMOJIS.length] });
    }

    // Loop full games until the deadline.
    while (Date.now() < deadline) {
      socks[0].emit("game:start");
      await onState(socks[0], (s) => s.phase === "hiding");
      // everyone hides
      socks.forEach((s, i) => s.emit("hide:confirm", { lat: 40 + i + Math.random(), lng: -70 - i - Math.random(), panoId: `p${idx}_${i}` }));
      await onState(socks[0], (s) => s.phase === "finding");

      // Play each round: the heaviest path — active guessers stream live previews
      // (like dragging a pin) before locking in a guess.
      let guard = 0;
      while (socks[0].last?.phase !== "finished" && Date.now() < deadline && guard++ < PLAYERS + 2) {
        const targetId = socks.map(s=>s.last).find(x=>x?.currentTarget)?.currentTarget?.id;
        const guessers = socks.filter((s) => s.last && s.last.youId !== targetId && !s.last.youAreTarget);
        // Stream a few preview frames per guesser (throttled like the real client).
        for (let frame = 0; frame < 5; frame++) {
          for (const g of guessers) g.emit("guess:preview", { lat: 10 + Math.random()*30, lng: 10 + Math.random()*30 });
          await wait(60);
        }
        // Lock in guesses, timing the action->results broadcast for one guesser.
        for (let gi = 0; gi < guessers.length; gi++) {
          const g = guessers[gi];
          if (gi === 0) {
            const t0 = Date.now();
            const pAll = onState(socks[0], (s) => s.phase === "results" || (s.currentTarget && s.currentTarget.id !== targetId));
            g.emit("guess:confirm", { lat: 1 + Math.random(), lng: 1 + Math.random() });
            actions++;
            pAll.then(() => latencies.push(Date.now() - t0));
          } else {
            g.emit("guess:confirm", { lat: 1 + Math.random(), lng: 1 + Math.random() });
            actions++;
          }
        }
        await onState(socks[0], (s) => s.phase === "results" || s.phase === "finished");
        if (socks[0].last?.phase === "results") socks[0].emit("round:next");
        await wait(30);
      }
      socks[0].emit("game:returnToLobby");
      await onState(socks[0], (s) => s.phase === "lobby").catch(()=>{});
    }
  } catch (e) {
    errors++;
  } finally {
    socks.forEach((s) => { try { s.close(); } catch {} });
  }
}

// --- run ---------------------------------------------------------------------
console.log(`Load: ${ROOMS} rooms x ${PLAYERS} players for ${DURATION/1000}s -> ${URL}${SERVER_PID?` (pid ${SERVER_PID})`:""}`);
const start = Date.now();
const deadline = start + DURATION;
const sampler = setInterval(sampleServer, 500);
sampleServer();

const rooms = Array.from({ length: ROOMS }, (_, i) => runRoom(i, deadline));
await Promise.all(rooms);
clearInterval(sampler);
sampleServer();

const wall = (Date.now() - start) / 1000;
const rssMin = rssSamples.length ? Math.min(...rssSamples) : NaN;
const rssMax = rssSamples.length ? Math.max(...rssSamples) : NaN;

console.log("\n--- results ---");
console.log(`wall time:            ${round1(wall)}s`);
console.log(`connections:          ${ROOMS*PLAYERS} sockets`);
console.log(`actions issued:       ${actions}`);
console.log(`state broadcasts recv:${broadcasts}  (${round1(broadcasts/wall)}/s)`);
console.log(`timed guesses:        ${latencies.length}`);
console.log(`latency p50/p95/p99:  ${round1(pct(latencies,50))} / ${round1(pct(latencies,95))} / ${round1(pct(latencies,99))} ms  (max ${round1(Math.max(...latencies,0))})`);
console.log(`disconnects:          ${disconnects}`);
console.log(`errors:               ${errors}`);
if (SERVER_PID) {
  console.log(`server RSS:           ${round1(rssMin/1024)}..${round1(rssMax/1024)} MB  (grew ${round1((rssMax-rssMin)/1024)} MB)`);
  console.log(`server CPU:           avg ${round1(cpuSamples.reduce((a,b)=>a+b,0)/(cpuSamples.length||1))}%  peak ${round1(Math.max(...cpuSamples,0))}%`);
}
console.log(`\nCSV,${ROOMS},${PLAYERS},${ROOMS*PLAYERS},${round1(pct(latencies,50))},${round1(pct(latencies,95))},${round1(pct(latencies,99))},${round1(rssMax/1024)},${round1(Math.max(...cpuSamples,0))},${errors},${disconnects}`);
process.exit(0);
