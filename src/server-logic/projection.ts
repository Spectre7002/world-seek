import type {
  CurrentTarget,
  LiveGuess,
  LiveView,
  PublicGuess,
  PublicPlayer,
  PublicState,
  RoundResult,
  Room,
} from "../shared/types";
import {
  connectedPlayers,
  currentTargetId,
  expectedGuessers,
  findPlayer,
  soloGuess,
  soloTarget,
} from "./transitions";
import { DEFAULT_EMOJI } from "../shared/emojis";
import { isAvailableMap, mapCatalog } from "./locations";
import { getRegionBounds } from "./boundaries";

const SOLO_TARGET = { id: "solo", name: "Mystery location", emoji: DEFAULT_EMOJI };

function publicPlayer(p: Room["players"][number]): PublicPlayer {
  return {
    id: p.id,
    name: p.name,
    emoji: p.emoji,
    isGameMaster: p.isGameMaster,
    connected: p.connected,
    hasHidden: p.hasHidden,
    totalScore: p.totalScore,
  };
}

export function projectFor(room: Room, viewerId: string): PublicState {
  const viewer = findPlayer(room, viewerId);
  const solo = room.mode === "solo";
  const targetId = currentTargetId(room);

  const players: PublicPlayer[] = [];
  for (let i = 0; i < room.players.length; i++) {
    players.push(publicPlayer(room.players[i]));
  }
  players.sort(function (a, b) {
    if (b.totalScore !== a.totalScore) {
      return b.totalScore - a.totalScore;
    }
    return a.name.localeCompare(b.name);
  });

  let currentTarget: CurrentTarget | null = null;
  const youAreTarget = targetId !== null && targetId === viewerId;
  if (room.phase === "finding" && targetId && !youAreTarget) {
    const target = findPlayer(room, targetId);
    if (target && target.hiding) {
      currentTarget = {
        id: target.id,
        name: target.name,
        emoji: target.emoji,
        panoId: target.hiding.panoId,
        heading: 0,
        pitch: 0,
      };
    }
  }

  let result: RoundResult | null = null;
  if (room.phase === "results" && targetId) {
    const target = findPlayer(room, targetId);
    if (target && target.hiding) {
      const guesses: PublicGuess[] = [];
      for (let i = 0; i < room.players.length; i++) {
        const p = room.players[i];
        const g = p.guesses[targetId];
        if (g) {
          guesses.push({
            playerId: p.id,
            name: p.name,
            emoji: p.emoji,
            lat: g.lat,
            lng: g.lng,
            distanceKm: g.distanceKm,
            points: g.points,
          });
        }
      }
      guesses.sort(function (a, b) {
        return b.points - a.points;
      });

      result = {
        targetId: target.id,
        targetName: target.name,
        targetEmoji: target.emoji,
        real: { lat: target.hiding.lat, lng: target.hiding.lng },
        guesses: guesses,
      };
    }
  }

  const myGuess = solo ? soloGuess(room, viewerId) : null;
  if (solo) {
    const target = soloTarget(room);
    if (room.phase === "finding" && target) {
      currentTarget = {
        ...SOLO_TARGET,
        panoId: target.panoId,
        heading: target.heading,
        pitch: target.pitch,
      };
    }
    if (room.phase === "results" && target) {
      const guesses: PublicGuess[] = [];
      if (viewer && myGuess) {
        guesses.push({
          playerId: viewer.id,
          name: viewer.name,
          emoji: viewer.emoji,
          lat: myGuess.lat,
          lng: myGuess.lng,
          distanceKm: myGuess.distanceKm,
          points: myGuess.points,
        });
      }
      result = {
        targetId: SOLO_TARGET.id,
        targetName: SOLO_TARGET.name,
        targetEmoji: SOLO_TARGET.emoji,
        real: { lat: target.lat, lng: target.lng },
        guesses: guesses,
      };
    }
  }

  let livePins: LiveGuess[] = [];
  let liveViews: LiveView[] = [];
  if (room.phase === "finding" && targetId) {
    const viewerHasGuessed = Boolean(viewer && viewer.guesses[targetId]);
    if (youAreTarget || viewerHasGuessed) {
      for (let i = 0; i < room.players.length; i++) {
        const p = room.players[i];
        if (p.id === viewerId || p.id === targetId) continue;
        const confirmed = p.guesses[targetId];
        if (confirmed) {
          livePins.push({
            playerId: p.id,
            name: p.name,
            emoji: p.emoji,
            lat: confirmed.lat,
            lng: confirmed.lng,
            confirmed: true,
          });
        } else if (p.livePin && p.livePin.targetId === targetId) {
          livePins.push({
            playerId: p.id,
            name: p.name,
            emoji: p.emoji,
            lat: p.livePin.lat,
            lng: p.livePin.lng,
            confirmed: false,
          });
        }
        if (p.liveView && p.liveView.targetId === targetId) {
          liveViews.push({
            playerId: p.id,
            name: p.name,
            emoji: p.emoji,
            panoId: p.liveView.panoId,
            heading: p.liveView.heading,
            pitch: p.liveView.pitch,
            zoom: p.liveView.zoom,
          });
        }
      }
    }
  }

  const connected = connectedPlayers(room);
  const expected = expectedGuessers(room);
  let guessedCount = 0;
  if (solo) {
    guessedCount = myGuess ? 1 : 0;
  } else if (targetId) {
    for (let i = 0; i < expected.length; i++) {
      if (expected[i].guesses[targetId]) {
        guessedCount++;
      }
    }
  }

  let hiddenCount = 0;
  for (let i = 0; i < connected.length; i++) {
    if (connected[i].hasHidden) {
      hiddenCount++;
    }
  }

  const currentCycle = room.cycleCount || 1;
  const totalCycles = room.settings.multiplayerCycles || 5;
  const selectedMap = isAvailableMap(room.settings.selectedMap)
    ? room.settings.selectedMap
    : "global";

  return {
    code: room.code,
    phase: room.phase,
    solo: solo,
    settings: room.settings,
    maps: mapCatalog,
    mapBounds: getRegionBounds(selectedMap),
    gameMasterId: room.gameMasterId,
    players: players,

    youId: viewerId,
    youEmoji: viewer ? viewer.emoji : "",
    youAreGameMaster: Boolean(viewer && viewer.isGameMaster),

    youHaveHidden: Boolean(viewer && viewer.hasHidden),
    hiddenCount: hiddenCount,
    expectedHiders: connected.length,

    currentRound: solo ? room.currentRound : currentCycle - 1,
    totalRounds: solo ? room.settings.soloRounds : totalCycles,
    currentTarget: currentTarget,
    youAreTarget: youAreTarget,
    youHaveGuessed: solo ? Boolean(myGuess) : Boolean(targetId && viewer && viewer.guesses[targetId]),
    guessedCount: guessedCount,
    expectedGuessers: solo ? 1 : expected.length,
    livePins: livePins,
    liveViews: liveViews,

    result: result,
  };
}