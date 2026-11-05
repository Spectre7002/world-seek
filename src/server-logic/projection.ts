import type {
  CurrentTarget,
  LiveGuess,
  LiveView,
  PublicGuess,
  PublicPlayer,
  PublicState,
  RoundHistoryEntry,
  RoundResult,
  Room,
} from "../shared/types";
import {
  connectedPlayers,
  currentTargetId,
  expectedGuessers,
  findPlayer,
  isServerPicked,
  kickTally,
  roundTurnKey,
  soloGuess,
  soloTarget,
} from "./transitions";
import { DEFAULT_EMOJI } from "../shared/emojis";
import { emptySpellCounts, totalSpells } from "../shared/spells";
import { CASE_PITY_MAX } from "../shared/types";
import { isAvailableMap, mapCatalog } from "./locations";
import { getRegionBounds } from "./boundaries";

const SOLO_TARGET = { id: "solo", name: "Mystery location", emoji: DEFAULT_EMOJI };

/**
 * The coordinates a viewer's spells may be cast against, or undefined when they
 * have no spells to spend. Gating on ownership means the answer is never sent to
 * a player who cannot use it, so this is not a free hint.
 */
function spellTargetFor(
  room: Room,
  viewer: Room["players"][number] | undefined,
  targetId: string | null,
): { lat: number; lng: number } | undefined {
  if (!viewer || room.phase !== "finding") return undefined;
  if (totalSpells(viewer.spells) <= 0) return undefined;
  if (isServerPicked(room)) {
    const target = soloTarget(room);
    return target ? { lat: target.lat, lng: target.lng } : undefined;
  }
  if (!targetId) return undefined;
  const target = findPlayer(room, targetId);
  return target?.hiding ? { lat: target.hiding.lat, lng: target.hiding.lng } : undefined;
}

function publicPlayer(p: Room["players"][number]): PublicPlayer {
  return {
    id: p.id,
    name: p.name,
    emoji: p.emoji,
    isGameMaster: p.isGameMaster,
    connected: p.connected,
    spectator: p.spectator,
    hasHidden: p.hasHidden,
    hp: p.hp,
    totalScore: p.totalScore,
    guessMultiplier: p.guessMultiplier,
    // Only a live freeze is worth sending; an expired one is noise.
    frozenUntil: p.frozenUntil != null && p.frozenUntil > Date.now() ? p.frozenUntil : null,
  };
}

/**
 * True when this player is watching the current turn rather than hunting: the
 * target, someone who already locked a guess, or a spectator.
 *
 * This is the same condition the live-pin projection uses. It is exported so
 * handlers can decide who receives a live packet without projecting a full
 * `PublicState` per recipient just to read two booleans.
 */
export function isWatcher(room: Room, playerId: string): boolean {
  const viewer = findPlayer(room, playerId);
  if (!viewer) return false;
  if (viewer.spectator) return true;
  const targetId = currentTargetId(room);
  if (targetId !== null && targetId === playerId) return true;
  if (isServerPicked(room)) {
    return Boolean(viewer.guesses["solo-" + room.currentRound]);
  }
  return Boolean(targetId && viewer.guesses[targetId]);
}

/**
 * Live pins visible to one viewer. Empty for active hunters and outside the
 * finding phase, so a pin can never be used to copy another player's position.
 *
 * Extracted from `projectFor` so the `guess:preview` delta can send just this
 * list instead of a full state projection per player.
 */
export function livePinsFor(room: Room, viewerId: string): LiveGuess[] {
  const pins: LiveGuess[] = [];
  if (room.phase !== "finding") return pins;
  const viewer = findPlayer(room, viewerId);
  if (!viewer) return pins;
  const spectator = Boolean(viewer.spectator);

  if (room.mode === "hp") {
    // HP mode: once a player has guessed, they can watch the remaining hunters.
    // A spectator has no guess of their own, so they always watch.
    const soloKey = "solo-" + room.currentRound;
    if (!viewer.guesses[soloKey] && !spectator) return pins;
    for (let i = 0; i < room.players.length; i++) {
      const p = room.players[i];
      if (p.id === viewerId) continue;
      const confirmedGuess = p.guesses[soloKey];
      if (confirmedGuess) {
        pins.push({
          playerId: p.id,
          name: p.name,
          emoji: p.emoji,
          lat: confirmedGuess.lat,
          lng: confirmedGuess.lng,
          confirmed: true,
        });
      } else if (p.livePin && p.livePin.targetId === "hp") {
        pins.push({
          playerId: p.id,
          name: p.name,
          emoji: p.emoji,
          lat: p.livePin.lat,
          lng: p.livePin.lng,
          confirmed: false,
        });
      }
    }
    return pins;
  }

  const targetId = currentTargetId(room);
  if (!targetId) return pins;
  const youAreTarget = targetId === viewerId;
  if (!youAreTarget && !viewer.guesses[targetId] && !spectator) return pins;
  for (let i = 0; i < room.players.length; i++) {
    const p = room.players[i];
    if (p.id === viewerId || p.id === targetId) continue;
    const confirmed = p.guesses[targetId];
    if (confirmed) {
      pins.push({
        playerId: p.id,
        name: p.name,
        emoji: p.emoji,
        lat: confirmed.lat,
        lng: confirmed.lng,
        confirmed: true,
      });
    } else if (p.livePin && p.livePin.targetId === targetId) {
      pins.push({
        playerId: p.id,
        name: p.name,
        emoji: p.emoji,
        lat: p.livePin.lat,
        lng: p.livePin.lng,
        confirmed: false,
      });
    }
  }
  return pins;
}

/** Follow-along Street Views visible to one viewer. Same gating as the pins. */
export function liveViewsFor(room: Room, viewerId: string): LiveView[] {
  const views: LiveView[] = [];
  if (room.phase !== "finding") return views;
  const viewer = findPlayer(room, viewerId);
  if (!viewer) return views;
  const spectator = Boolean(viewer.spectator);

  if (room.mode === "hp") {
    const soloKey = "solo-" + room.currentRound;
    if (!viewer.guesses[soloKey] && !spectator) return views;
    for (let i = 0; i < room.players.length; i++) {
      const p = room.players[i];
      if (p.id === viewerId) continue;
      if (p.guesses[soloKey]) continue;
      if (p.liveView && p.liveView.targetId === "hp") {
        views.push({
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
    return views;
  }

  const targetId = currentTargetId(room);
  if (!targetId) return views;
  const youAreTarget = targetId === viewerId;
  if (!youAreTarget && !viewer.guesses[targetId] && !spectator) return views;
  for (let i = 0; i < room.players.length; i++) {
    const p = room.players[i];
    if (p.id === viewerId || p.id === targetId) continue;
    if (p.guesses[targetId]) continue;
    if (p.liveView && p.liveView.targetId === targetId) {
      views.push({
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
  return views;
}

export function projectFor(room: Room, viewerId: string): PublicState {
  const viewer = findPlayer(room, viewerId);
  // HP mode is its own `mode` now, so the three concepts are distinct:
  //   serverPickedLocation — the server chose the target (solo or HP)
  //   solo                 — a genuine single-player game
  //   hpLocationGame       — a shared-location HP match with a winner
  const serverPickedLocation = isServerPicked(room);
  const hpLocationGame = room.mode === "hp";
  const solo = room.mode === "solo";
  const targetId = currentTargetId(room);

  // A 1v1 duel is not a stored setting: it is simply an HP match with exactly
  // two players connected. Deriving it here keeps the lobby labels and the HP
  // HUD in agreement, and stops the flag from being a settable-but-never-set
  // field that silently stayed false.
  const connectedCount = connectedPlayers(room).length;
  const is1v1 = room.settings.gameMode === "hp" && connectedCount === 2;
  const youAreSpectator = Boolean(viewer && viewer.spectator);

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
      
      // ЛОГИКА ЧИТОВ: Передаем точные координаты цели, если читы включены
      if (room.settings.cheatsEnabled) {
        currentTarget.realCoords = { lat: target.hiding.lat, lng: target.hiding.lng };
      }
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
            damage: g.damage,
            appliedMultiplier: g.appliedMultiplier,
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

  const myGuess = serverPickedLocation ? soloGuess(room, viewerId) : null;
  if (serverPickedLocation) {
    const target = soloTarget(room);
    if (room.phase === "finding" && target) {
      currentTarget = {
        id: SOLO_TARGET.id,
        name: SOLO_TARGET.name,
        emoji: SOLO_TARGET.emoji,
        panoId: target.panoId,
        heading: target.heading,
        pitch: target.pitch,
      };
      
      // ЛОГИКА ЧИТОВ ДЛЯ СОЛО РЕЖИМА
      if (room.settings.cheatsEnabled) {
        currentTarget.realCoords = { lat: target.lat, lng: target.lng };
      }
    }
    if (room.phase === "results" && target) {
      const guesses: PublicGuess[] = [];
      // HP rounds are shared by the whole lobby, so every player's guess must
      // be visible on the results map, including players who disconnected.
      const resultPlayers = hpLocationGame ? room.players : viewer ? [viewer] : [];
      for (let i = 0; i < resultPlayers.length; i++) {
        const player = resultPlayers[i];
        const guess = player.guesses["solo-" + room.currentRound];
        if (!guess) continue;
        guesses.push({
          playerId: player.id,
          name: player.name,
          emoji: player.emoji,
          lat: guess.lat,
          lng: guess.lng,
          distanceKm: guess.distanceKm,
          points: guess.points,
          damage: guess.damage,
          appliedMultiplier: guess.appliedMultiplier,
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

  // Live pins and follow-along views are built by the same helpers the
  // `guess:preview` delta uses, so the two paths cannot drift apart.
  const livePins: LiveGuess[] = livePinsFor(room, viewerId);
  const liveViews: LiveView[] = liveViewsFor(room, viewerId);

  const connected = connectedPlayers(room);
  const expected = expectedGuessers(room);
  let guessedCount = 0;
  if (hpLocationGame) {
    for (let i = 0; i < connected.length; i++) {
      if (connected[i].guesses["solo-" + room.currentRound]) {
        guessedCount++;
      }
    }
  } else if (solo) {
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

  // A turn id that is unique across the whole game. Computed by the same
  // helper the round-history writer uses, so a log entry's `roundKey` always
  // matches the projection's and the results screen can highlight it.
  const roundKey = roundTurnKey(room);
  const selectedMap = isAvailableMap(room.settings.selectedMap)
    ? room.settings.selectedMap
    : "global";

  return {
    code: room.code,
    phase: room.phase,
    solo: solo,
    serverPickedLocation: serverPickedLocation,
    settings: room.settings,
    is1v1: is1v1,
    maps: mapCatalog,
    mapBounds: getRegionBounds(selectedMap),
    gameMasterId: room.gameMasterId,
    players: players,

    youId: viewerId,
    youEmoji: viewer ? viewer.emoji : "",
    youAreGameMaster: Boolean(viewer && viewer.isGameMaster),
    youAreSpectator: youAreSpectator,
    yourSpot: (youAreTarget && viewer && viewer.hiding)
      ? { lat: viewer.hiding.lat, lng: viewer.hiding.lng }
      : undefined,
    yourSpells: viewer ? viewer.spells : emptySpellCounts(),
    casePity: viewer ? viewer.casePity : 0,
    casePityMax: CASE_PITY_MAX,
    youFrozenUntil:
      viewer && viewer.frozenUntil != null && viewer.frozenUntil > Date.now()
        ? viewer.frozenUntil
        : null,
    // Only reveal the answer to someone who can actually cast a spell with it.
    spellTarget: spellTargetFor(room, viewer, targetId),

    youHaveHidden: Boolean(viewer && viewer.hasHidden),
    hiddenCount: hiddenCount,
    expectedHiders: connected.length,

    currentRound: serverPickedLocation ? room.currentRound : currentCycle - 1,
    totalRounds: serverPickedLocation ? room.settings.soloRounds : totalCycles,
    subRound: room.currentRound,
    totalSubRounds: room.order.length,
    roundKey: roundKey,
    currentTarget: currentTarget,
    youAreTarget: youAreTarget,
    youHaveGuessed: youAreSpectator
      ? false
      : serverPickedLocation
        ? Boolean(myGuess)
        : Boolean(targetId && viewer && viewer.guesses[targetId]),
    guessedCount: guessedCount,
    expectedGuessers: hpLocationGame ? connected.length : solo ? 1 : expected.length,
    livePins: livePins,
    liveViews: liveViews,
    // Only watchers (the target, an already-guessed player, or a spectator) see
    // the case roulette. `isWatcher` handles the server-picked modes too, where
    // there is no `targetId` and the previous `guesses[targetId ?? ""]` test
    // never matched — so the roulette was never projected in solo/HP.
    liveCase:
      room.phase === "finding" && isWatcher(room, viewerId)
        ? room.liveCase ?? null
        : null,

    result: result,

    firstGuessTime: (hpLocationGame && room.phase === "finding") ? (room.firstGuessTime ?? null) : null,
    deadlineAt: room.deadlineAt ?? null,

    // The full round log is only useful once the game is over (the final screen
    // shows it) or on the results screen (the breakdown). Sending it during
    // hiding/finding would leak every earlier target's coordinates to a player
    // who has not finished guessing them.
    roundHistory:
      room.phase === "results" || room.phase === "finished"
        ? (room.roundHistory ?? [])
        : [],

    // Vote-kick tallies. Only the weighted counts are projected — who voted for
    // whom is nobody's business, and the client only needs "2/3 votes".
    kickVotes: kickVoteCounts(room),
    // The threshold for any real target: every connected seat except that one.
    // Computed from the count directly rather than by calling
    // `kickVotesNeeded(room, someId)`, because a placeholder id would be
    // counted as a real seat and overstate the requirement.
    kickVotesNeeded: connectedCount <= 1 ? 0 : Math.floor((connectedCount - 1) / 2) + 1,
  };
}

/** Weighted vote counts per target, as a plain object. */
function kickVoteCounts(room: Room): Record<string, number> {
  const counts: Record<string, number> = {};
  if (!room.kickVotes) return counts;
  for (const targetId of Object.keys(room.kickVotes)) {
    const tally = kickTally(room, targetId);
    if (tally > 0) counts[targetId] = tally;
  }
  return counts;
}