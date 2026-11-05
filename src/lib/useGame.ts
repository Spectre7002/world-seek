"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import type {
  ActionAck,
  HidingSpot,
  JoinAck,
  JoinError,
  LatLng,
  LiveUpdate,
  LiveView,
  LiveCase,
  PeekAck,
  PublicState,
  ReconnectAck,
} from "@/shared/types";
import { emitAck, emitAction, getSocket } from "./socket";
import { clearSession, loadSession, saveSession } from "./session";
import { getPlayerKey } from "./playerKey";

export type GameStatus = "connecting" | "need-join" | "in-game";

function joinErrorMessage(err: JoinError): string {
  switch (err) {
    case "not_found":
      return "That game doesn't exist.";
    case "in_progress":
      return "This game is already in progress — you can't join right now.";
    case "name_taken":
      return "That name is taken. Try another.";
    case "emoji_taken":
      return "That avatar was just taken. Pick another.";
    case "full":
      return "This game is full.";
  }
}

export function useGame(code: string) {
  const router = useRouter();
  const [state, setState] = useState<PublicState | null>(null);
  const [status, setStatus] = useState<GameStatus>("connecting");
  const [error, setError] = useState<string | null>(null);
  const [connected, setConnected] = useState<boolean>(false);
  const inGame = useRef<boolean>(false);

  const seated = useRef<boolean>(false);
  const pending = useRef<Array<() => void>>([]);
  const reseatRef = useRef<() => Promise<boolean>>(function () {
    return Promise.resolve(false);
  });

  const flushPending = useCallback(function () {
    const queue = pending.current;
    pending.current = [];
    for (let i = 0; i < queue.length; i++) {
      queue[i]();
    }
  }, []);

  useEffect(
    function () {
      const socket = getSocket();

      function reseat(): Promise<boolean> {
        const sess = loadSession(code);
        if (!sess) {
          seated.current = false;
          if (!inGame.current) setStatus("need-join");
          return Promise.resolve(false);
        }
        return emitAck<ReconnectAck>("game:reconnect", {
          code: code,
          sessionToken: sess.sessionToken,
        }).then(function (res) {
          if (res.ok) {
            seated.current = true;
            flushPending();
            return true;
          }
          seated.current = false;
          clearSession(code);
          if (!inGame.current) setStatus("need-join");
          return false;
        });
      }

      reseatRef.current = reseat;

      function onState(s: PublicState) {
        inGame.current = true;
        setState(s);
        setStatus("in-game");
      }

      // Delta from `guess:preview`: only the live pin list, not a full state.
      function onLiveUpdate(update: LiveUpdate) {
        setState(function (current) {
          if (!current || current.phase !== "finding") return current;
          return { ...current, livePins: update.pins };
        });
      }

      function onLiveView(view: LiveView) {
        setState(function (current) {
          if (!current || current.phase !== "finding") return current;
          const liveViews = current.liveViews.filter(function (item) {
            return item.playerId !== view.playerId;
          });
          liveViews.push(view);
          return { ...current, liveViews: liveViews };
        });
      }

      function onLiveCase(liveCase: LiveCase) {
        setState(function (current) {
          if (!current || current.phase !== "finding") return current;
          return { ...current, liveCase: liveCase };
        });
      }

      function onConnect() {
        setConnected(true);
        reseat();
      }

      function onDisconnect() {
        setConnected(false);
        seated.current = false;
      }

      function onClosed() {
        clearSession(code);
        router.push("/");
      }

      // Removed by a vote-kick. Same landing as a closed room, but the player
      // is told why instead of silently reappearing on the home page.
      function onKicked() {
        clearSession(code);
        router.push("/?kicked=1");
      }

      socket.on("state", onState);
      socket.on("live:update", onLiveUpdate);
      socket.on("view:live", onLiveView);
      socket.on("case:live", onLiveCase);
      socket.on("connect", onConnect);
      socket.on("disconnect", onDisconnect);
      socket.on("game:closed", onClosed);
      socket.on("game:kicked", onKicked);

      if (socket.connected) {
        setConnected(true);
        reseat();
      }

      return function () {
        socket.off("state", onState);
        socket.off("live:update", onLiveUpdate);
        socket.off("view:live", onLiveView);
        socket.off("case:live", onLiveCase);
        socket.off("connect", onConnect);
        socket.off("disconnect", onDisconnect);
        socket.off("game:closed", onClosed);
        socket.off("game:kicked", onKicked);
      };
    },
    [code, flushPending, router],
  );

  const dispatch = useCallback(
    function (event: string, payload?: unknown) {
      const socket = getSocket();

      function send() {
        emitAction<ActionAck>(event, payload).then(function (res) {
          if (res.ok) return;
          if (res.reason === "not_seated") {
            reseatRef.current().then(function (ok) {
              if (ok) emitAction<ActionAck>(event, payload);
            });
          }
        });
      }

      if (socket.connected && seated.current) {
        send();
        return;
      }
      pending.current.push(send);
      if (!socket.connected) socket.connect();
      else reseatRef.current();
    },
    [],
  );

  const join = useCallback(
    function (
      name: string,
      emoji: string,
    ): Promise<{ ok: boolean; takenEmojis?: string[] }> {
      return emitAck<JoinAck>("game:join", {
        code: code,
        name: name,
        emoji: emoji,
        playerKey: getPlayerKey(),
      }).then(function (res) {
        if (res.ok) {
          saveSession(code, {
            sessionToken: res.sessionToken,
            playerId: res.playerId,
          });
          seated.current = true;
          flushPending();
          setError(null);
          return { ok: true };
        }
        setError(joinErrorMessage(res.error));
        return { ok: false, takenEmojis: res.takenEmojis };
      });
    },
    [code, flushPending],
  );

  const peek = useCallback(
    function (): Promise<string[]> {
      return emitAck<PeekAck>("game:peek", { code: code }).then(
        function (res) {
          return res.ok ? res.takenEmojis : [];
        },
      );
    },
    [code],
  );

  const start = useCallback(
    function () {
      dispatch("game:start");
    },
    [dispatch],
  );

  const hide = useCallback(
    function (spot: HidingSpot) {
      dispatch("hide:confirm", spot);
    },
    [dispatch],
  );

  /**
   * Hiding timer ran out with no valid spot selected. The server drops the
   * player on a random covered location so the room can advance.
   */
  const autoHide = useCallback(
    function () {
      dispatch("hide:auto");
    },
    [dispatch],
  );

  const validateHide = useCallback(function (
    spot: HidingSpot,
  ): Promise<{ ok: boolean; spot?: HidingSpot; reason?: string }> {
    return emitAck("hide:validate", spot);
  }, []);

  const guess = useCallback(
    function (at: LatLng) {
      dispatch("guess:confirm", at);
    },
    [dispatch],
  );

  const previewGuess = useCallback(function (at: LatLng) {
    const socket = getSocket();
    if (socket.connected && seated.current) socket.emit("guess:preview", at);
  }, []);

  const syncView = useCallback(function (
    view: Pick<LiveView, "panoId" | "heading" | "pitch" | "zoom">,
  ) {
    const socket = getSocket();
    if (socket.connected && seated.current) socket.emit("view:sync", view);
  }, []);

  /**
   * Spend one spell from the server-owned inventory. Resolves with the ack so
   * REROLL can hand back the replacement case hint.
   */
  const consumeSpell = useCallback(function (
    spell: string,
  ): Promise<{ ok: boolean; hint?: any }> {
    const socket = getSocket();
    if (!socket.connected || !seated.current) return Promise.resolve({ ok: false });
    return emitAck<{ ok: boolean; hint?: any }>("spell:consume", { spell });
  }, []);

  /** Cheat-menu helper: grant one of each spell (server checks the cheat flag). */
  const grantSpells = useCallback(function () {
    const socket = getSocket();
    if (socket.connected && seated.current) socket.emit("spell:grant");
  }, []);

  const shareCaseHint = useCallback(function (hint: unknown) {
    const socket = getSocket();
    if (socket.connected && seated.current) socket.emit("case:share", hint);
  }, []);

  const nextRound = useCallback(
    function () {
      dispatch("round:next");
    },
    [dispatch],
  );

  /**
   * Host escape hatch: skip the current phase immediately. The server owns the
   * phase clock, so this is the manual override for an AFK player.
   */
  const forceAdvance = useCallback(
    function () {
      dispatch("round:forceAdvance");
    },
    [dispatch],
  );

  const returnToLobby = useCallback(
    function () {
      dispatch("game:returnToLobby");
    },
    [dispatch],
  );

  /** Host only: restart with the same players and settings. */
  const rematch = useCallback(
    function () {
      dispatch("game:rematch");
    },
    [dispatch],
  );

  /** Vote to kick a player. The server decides when the tally is enough. */
  const voteKick = useCallback(
    function (targetId: string) {
      dispatch("game:voteKick", { targetId: targetId });
    },
    [dispatch],
  );

  const leave = useCallback(
    function () {
      getSocket().emit("game:leave");
      clearSession(code);
      router.push("/");
    },
    [code, router],
  );

  const close = useCallback(
    function () {
      getSocket().emit("game:close");
      clearSession(code);
      router.push("/");
    },
    [code, router],
  );

  const updateSettings = useCallback(
    function (settings: Partial<PublicState["settings"]>) {
      dispatch("game:settings", { settings: settings });
    },
    [dispatch],
  );

  const openCase = useCallback(function (): Promise<{ ok: boolean; hint?: any }> {
    return emitAction<{ ok: boolean; hint?: any }>("case:open");
  }, []);

  return {
    state: state,
    status: status,
    error: error,
    connected: connected,
    join: join,
    peek: peek,
    start: start,
    hide: hide,
    autoHide: autoHide,
    validateHide: validateHide,
    guess: guess,
    previewGuess: previewGuess,
    syncView: syncView,
    consumeSpell: consumeSpell,
    grantSpells: grantSpells,
    shareCaseHint: shareCaseHint,
    nextRound: nextRound,
    forceAdvance: forceAdvance,
    returnToLobby: returnToLobby,
    rematch: rematch,
    voteKick: voteKick,
    leave: leave,
    close: close,
    updateSettings: updateSettings,
    openCase: openCase,
  };
}