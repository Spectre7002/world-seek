import test from "node:test";
import assert from "node:assert/strict";
import { mkdirSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

// `locations.ts` resolves map pools from `process.cwd()/maps` at import time, so
// the throwaway maps tree and the cwd swap must happen before the module is
// imported. The import is therefore dynamic, inside the test body.
const root = join(tmpdir(), "world-seek-tests-" + process.pid);
mkdirSync(join(root, "maps"), { recursive: true });
const pool = [
  { lat: 48.85, lng: 2.35, heading: 0, pitch: 0, panoId: "pano-a" },
  { lat: 40.71, lng: -74.0, heading: 0, pitch: 0, panoId: "pano-b" },
  { lat: 35.68, lng: 139.69, heading: 0, pitch: 0, panoId: "pano-c" },
];
writeFileSync(join(root, "maps", "global-roads-only-locations.json"), JSON.stringify(pool));

// A country pool with data but no polygon in the boundary file, plus an empty
// pool, so the catalog filter and the bounds fallback can both be exercised.
mkdirSync(join(root, "maps", "countries"), { recursive: true });
writeFileSync(
  join(root, "maps", "countries", "ZZ-locations.json"),
  JSON.stringify([{ lat: -21.23, lng: 55.3, heading: 0, pitch: 0, panoId: "pano-zz" }]),
);
writeFileSync(join(root, "maps", "countries", "YY-locations.json"), "[]");
process.cwd = () => root;

test("transitions", async (t) => {
  const {
    addPlayer,
    createRoom,
    currentTargetId,
    isServerPicked,
    recordSoloGuess,
    removePlayer,
    soloGuess,
    soloTarget,
    startSolo,
    tickPhase,
  } = await import("../src/server-logic/transitions");

  await t.test("a fresh room starts in the lobby in multiplayer mode", () => {
    const { room } = createRoom("Host");
    assert.equal(room.phase, "lobby");
    assert.equal(room.mode, "multiplayer");
    assert.equal(room.players.length, 1);
    assert.equal(room.players[0].isGameMaster, true);
  });

  await t.test("a join during a running game takes a spectator seat", () => {
    const { room } = createRoom("Host");
    room.phase = "finding";
    // A distinct avatar: the host already owns the default one.
    const res = addPlayer(room, "Late", "fox");
    assert.equal(res.ok, true);
    if (res.ok) assert.equal(res.player.spectator, true);
  });

  await t.test("startSolo picks a server location and accepts exactly one guess", () => {
    const { room, player } = createRoom("Solo");
    assert.equal(startSolo(room), true);
    assert.equal(room.mode, "solo");
    assert.equal(isServerPicked(room), true);
    assert.ok(soloTarget(room), "a target should be picked");

    assert.equal(recordSoloGuess(room, player.id, { lat: 0, lng: 0 }), true);
    assert.ok(soloGuess(room, player.id));
    // One guess per round: a second submission must be refused.
    assert.equal(recordSoloGuess(room, player.id, { lat: 10, lng: 10 }), false);
  });

  await t.test("isServerPicked covers both solo and hp", () => {
    const { room } = createRoom("H");
    room.mode = "hp";
    assert.equal(isServerPicked(room), true);
    room.mode = "multiplayer";
    assert.equal(isServerPicked(room), false);
  });

  await t.test("an expired finding deadline advances the phase", () => {
    const { room, player } = createRoom("Clock");
    startSolo(room);
    recordSoloGuess(room, player.id, { lat: 0, lng: 0 });
    room.deadlineAt = Date.now() - 1;
    assert.equal(tickPhase(room, Date.now()), true);
    assert.equal(room.phase, "results");
  });

  await t.test("removePlayer repairs the round cursor when an earlier target leaves", () => {
    const { room } = createRoom("A");
    const b = addPlayer(room, "B", "fox");
    const c = addPlayer(room, "C", "cat");
    assert.equal(b.ok && c.ok, true);
    if (!b.ok || !c.ok) return;
    const ids = room.players.map((p) => p.id);
    // `currentTargetId` only resolves during finding/results.
    room.phase = "finding";
    room.order = [...ids];
    room.currentRound = 1;
    assert.equal(currentTargetId(room), ids[1]);

    // Removing the first player (before the cursor) must pull the cursor back.
    removePlayer(room, ids[0]);
    assert.equal(room.currentRound, 0);
    assert.equal(currentTargetId(room), ids[1]);
  });
});

/**
 * Regression tests for the seven confirmed logic bugs. Each one failed before
 * the fix and is asserted here so it cannot silently come back.
 */
test("confirmed logic bugs", async (t) => {
  const {
    addPlayer,
    createRoom,
    currentTargetId,
    finishGame,
    nextRound,
    recordGuess,
    recordHide,
    recordSoloGuess,
    refreshDeadline,
    returnToLobby,
    roundTurnKey,
    scoreRound,
    startFinding,
    startGame,
    tickPhase,
  } = await import("../src/server-logic/transitions");
  const { projectFor } = await import("../src/server-logic/projection");

  // Point the history store at a throwaway file before importing it, so the
  // test never touches /data and never trips the degrade warning.
  process.env.HISTORY_STATE_PATH = join(root, "history.json");
  const { getPlayerStats, resetHistoryForTests } = await import(
    "../src/server-logic/history"
  );
  // Other suites / reruns must not leak games into the aggregate.
  resetHistoryForTests();

  /** Three connected players in classic mode, hidden, with finding started. */
  function classicRoom() {
    const created = createRoom("Host");
    const b = addPlayer(created.room, "B", "fox");
    const c = addPlayer(created.room, "C", "cat");
    if (!b.ok || !c.ok) throw new Error("join failed");
    startGame(created.room);
    for (const p of created.room.players) {
      recordHide(created.room, p.id, { lat: 10, lng: 10, panoId: "p" + p.id });
    }
    startFinding(created.room);
    return created.room;
  }

  await t.test("bug 1: an HP round scores from any guesser, not just connected[0]", () => {
    const created = createRoom("Host");
    const guest = addPlayer(created.room, "Guest", "fox");
    if (!guest.ok) throw new Error("join failed");
    created.room.settings.gameMode = "hp";
    created.room.players.forEach((p) => (p.connected = true));
    startGame(created.room);

    const [first, second] = created.room.players;
    // Only the SECOND player guesses. The old code passed `connected[0]` to
    // scoreSoloRound, which returned false and skipped the whole round.
    recordSoloGuess(created.room, second.id, { lat: 0, lng: 0 });
    created.room.deadlineAt = Date.now() - 1;

    assert.equal(tickPhase(created.room, Date.now()), true);
    assert.equal(created.room.phase, "results");
    assert.ok(second.totalScore > 0, "the guessing player must be scored");
    assert.equal(first.totalScore, 0, "a non-guesser takes no points");
    assert.equal(created.room.roundHistory?.length, 1, "the round must be logged");
  });

  await t.test("bug 2: a classic guess cannot be overwritten", () => {
    const room = classicRoom();
    const targetId = currentTargetId(room);
    assert.ok(targetId);
    const hunter = room.players.find((p) => p.id !== targetId);
    assert.ok(hunter && targetId);

    assert.equal(recordGuess(room, hunter.id, { lat: 0, lng: 0 }), true);
    const locked = hunter.guesses[targetId].points;
    // A second submission, even a much better one, must be refused.
    assert.equal(recordGuess(room, hunter.id, { lat: 48.85, lng: 2.35 }), false);
    assert.equal(hunter.guesses[targetId].points, locked);
  });

  await t.test("bug 3: the log's roundKey matches the projection's", () => {
    const room = classicRoom();
    const targetId = currentTargetId(room);
    assert.ok(targetId);
    for (const p of room.players) {
      if (p.id !== targetId) recordGuess(room, p.id, { lat: 11, lng: 11 });
    }
    scoreRound(room);

    const state = projectFor(room, room.players[0].id);
    const entry = room.roundHistory?.[0];
    assert.ok(entry);
    assert.equal(entry.roundKey, state.roundKey);
    assert.equal(entry.roundKey, roundTurnKey(room));
  });

  await t.test("bug 4: entering finding restamps a deadline the clock can expire", () => {
    const room = classicRoom();
    room.settings.findingTimeLimit = 60;
    // The handler now calls refreshDeadline after its hand-rolled phase change.
    room.phase = "results";
    room.deadlineAt = null;
    room.phase = "finding";
    refreshDeadline(room);
    assert.ok(room.deadlineAt !== null, "finding must have a deadline");
    assert.ok(room.deadlineAt! > Date.now());
  });

  await t.test("the turn key is never 0 (0 is the caseOpenedRound sentinel)", () => {
    // A server-picked first turn used to yield roundTurnKey === 0, which
    // collided with `caseOpenedRound: 0 = never opened`, so the first case of
    // every solo/HP round looked already spent.
    const created = createRoom("Host");
    created.room.mode = "hp";
    created.room.currentRound = 0;
    assert.equal(roundTurnKey(created.room), 1);

    created.room.mode = "solo";
    assert.equal(roundTurnKey(created.room), 1);

    // Classic first turn of the first cycle is 10, also never 0.
    created.room.mode = "multiplayer";
    created.room.cycleCount = 1;
    assert.equal(roundTurnKey(created.room), 10);
  });

  await t.test("bug 5: caseOpenedRound resets for a new game in the same room", () => {
    const room = classicRoom();
    const opener = room.players[0];
    opener.caseOpenedRound = roundTurnKey(room);

    finishGame(room);
    returnToLobby(room, false);
    startGame(room);

    assert.equal(opener.caseOpenedRound, 0, "the per-turn latch must be cleared");
    // The first turn of the new game uses the same turn id, so a stale latch
    // would have blocked the case.
    assert.equal(roundTurnKey(room), 10);
  });

  await t.test("bug 6: liveCase is projected in server-picked (HP) mode", () => {
    const created = createRoom("Host");
    const guest = addPlayer(created.room, "Guest", "fox");
    if (!guest.ok) throw new Error("join failed");
    created.room.settings.gameMode = "hp";
    created.room.players.forEach((p) => (p.connected = true));
    startGame(created.room);

    const viewer = created.room.players[0];
    // A confirmed guess makes the player a watcher even though HP has no target.
    recordSoloGuess(created.room, viewer.id, { lat: 0, lng: 0 });
    created.room.liveCase = {
      playerId: viewer.id,
      name: viewer.name,
      emoji: viewer.emoji,
      hint: {
        itemKey: "continent",
        tierKey: "MIL_SPEC",
        tierName: { ru: "Синее", en: "Mil-Spec" },
        tierColor: "#4b69ff",
        itemName: { ru: "Континент", en: "Continent" },
        hintTitle: { ru: "Континент", en: "Continent" },
        hintValue: { ru: "Европа", en: "Europe" },
      },
    };

    const state = projectFor(created.room, viewer.id);
    // projectFor only sends liveCase during `finding`; the guess above does not
    // end an HP round on its own, so we are still finding.
    assert.equal(state.liveCase?.playerId, viewer.id);
  });

  await t.test("bug 7: whole-game counters survive the per-cycle guess reset", () => {
    // A real playerKey is required: getPlayerStats("") short-circuits, so a
    // keyless room would make this assertion vacuous.
    const created = createRoom("Host", undefined, undefined, "key-host");
    const b = addPlayer(created.room, "B", "fox", "key-b");
    const c = addPlayer(created.room, "C", "cat", "key-c");
    if (!b.ok || !c.ok) throw new Error("join failed");
    const room = created.room;
    room.settings.multiplayerCycles = 2;
    startGame(room);

    for (let cycle = 0; cycle < 2; cycle++) {
      for (const p of room.players) {
        recordHide(room, p.id, { lat: 10, lng: 10, panoId: "p" + p.id });
      }
      startFinding(room);
      for (let r = 0; r < room.order.length; r++) {
        const targetId = room.order[room.currentRound];
        for (const p of room.players) {
          if (p.id !== targetId) recordGuess(room, p.id, { lat: 11, lng: 11 });
        }
        scoreRound(room);
        nextRound(room);
      }
    }
    assert.equal(room.phase, "finished");

    const host = room.players[0];
    // 3 players, 2 targets each per cycle, 2 cycles = 4 guesses.
    assert.equal(host.roundsScored, 4);
    assert.ok(host.bestDistanceKm !== null && host.bestDistanceKm >= 0);

    // `finishGame` (via `nextRound`) already persisted the record, and
    // recordFinishedGame is idempotent — so read it back through the stats
    // aggregation, which is the layer the scoreboard actually consumes.
    assert.equal(host.playerKey, "key-host");
    const stats = getPlayerStats("key-host");
    assert.equal(stats.roundsGuessed, 4, "stats must count every cycle");
    assert.equal(stats.games, 1);
    assert.ok(
      stats.bestDistanceKm !== null && stats.bestDistanceKm >= 0,
      "the best guess must be recorded",
    );
  });
});

/**
 * Regression tests for the data/config bugs and the NMPZ setting.
 */
test("data and config", async (t) => {
  const { mapCatalog, isAvailableMap, getLocations, getPoolBounds } = await import(
    "../src/server-logic/locations"
  );
  const { isInsideRegion, getRegionBounds } = await import("../src/server-logic/boundaries");
  const { sanitizeSettings } = await import("../src/shared/validate");
  const { DEFAULT_SETTINGS, MOVEMENT_MODES } = await import("../src/shared/types");

  await t.test("an empty country pool is not offered in the catalog", () => {
    // YY-locations.json is `[]`; ZZ has one location.
    const codes = mapCatalog.countries.map((c) => c.code);
    assert.ok(!codes.includes("YY"), "an empty pool must be filtered out");
    assert.ok(codes.includes("ZZ"), "a populated pool must stay");
    assert.equal(isAvailableMap("country:YY"), false);
    assert.equal(isAvailableMap("country:ZZ"), true);
  });

  await t.test("a map with no polygon falls back to its pool bounds", () => {
    // ZZ has no feature in the boundary file, so the polygon path returns
    // nothing and the pool extent has to take over.
    const bounds = getRegionBounds("country:ZZ");
    assert.ok(bounds, "bounds must come from the pool");
    assert.ok(bounds!.north >= -21.23 && bounds!.south <= -21.23);
    assert.ok(bounds!.east >= 55.3 && bounds!.west <= 55.3);

    const pool = getLocations("country:ZZ");
    assert.equal(pool.length, 1);
    assert.equal(isInsideRegion("country:ZZ", pool[0].lat, pool[0].lng), true);
    // A point far outside the pool extent is still refused.
    assert.equal(isInsideRegion("country:ZZ", 0, 0), false);
  });

  await t.test("getPoolBounds is null for a map with no pool", () => {
    assert.equal(getPoolBounds("country:YY"), null);
  });

  await t.test("movementMode is whitelisted and defaults to free", () => {
    assert.equal(DEFAULT_SETTINGS.movementMode, "free");
    assert.equal(sanitizeSettings({ movementMode: "no-move" }).movementMode, "no-move");
    assert.equal(
      sanitizeSettings({ movementMode: "NMPZ" }).movementMode,
      "NMPZ",
    );
    // An unknown value must be dropped, not passed through.
    assert.equal(sanitizeSettings({ movementMode: "teleport" }).movementMode, undefined);
    assert.equal(sanitizeSettings({ movementMode: 42 }).movementMode, undefined);
    assert.deepEqual(MOVEMENT_MODES, ["free", "no-move", "NMPZ"]);
  });

  await t.test("a room code never overwrites a live room", async () => {
    const { createRoom } = await import("../src/server-logic/transitions");
    const { saveRoom, getRoom, deleteRoom } = await import("../src/server-logic/store");
    const first = createRoom("First");
    saveRoom(first.room);
    // Create many rooms; none may reuse a code that is already stored.
    const codes = new Set<string>([first.room.code]);
    for (let i = 0; i < 50; i++) {
      const next = createRoom("N" + i);
      assert.ok(!codes.has(next.room.code), "a live code must not be reused");
      codes.add(next.room.code);
      saveRoom(next.room);
    }
    // The original room is still intact.
    assert.ok(getRoom(first.room.code));
    assert.equal(getRoom(first.room.code)!.players[0].name, "First");
    for (const code of codes) deleteRoom(code);
  });
});
