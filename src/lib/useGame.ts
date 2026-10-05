"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import type {
  ActionAck,
  HidingSpot,
  JoinAck,
  JoinError,
  LatLng,
  PeekAck,
  PublicState,
  ReconnectAck,
} from "@/shared/types";
import { emitAck, emitAction, getSocket } from "./socket";
import { clearSession, loadSession, saveSession } from "./session";

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
  const [budgetBlocked, setBudgetBlocked] = useState<boolean>(false);
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

      socket.on("state", onState);
      socket.on("connect", onConnect);
      socket.on("disconnect", onDisconnect);
      socket.on("game:closed", onClosed);

      if (socket.connected) {
        setConnected(true);
        reseat();
      }

      return function () {
        socket.off("state", onState);
        socket.off("connect", onConnect);
        socket.off("disconnect", onDisconnect);
        socket.off("game:closed", onClosed);
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
            return;
          }
          if (res.reason === "budget") setBudgetBlocked(true);
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

  const guess = useCallback(
    function (at: LatLng) {
      dispatch("guess:confirm", at);
    },
    [dispatch],
  );

  const sendSoloTarget = useCallback(
    function (spot: HidingSpot) {
      dispatch("solo:target", spot);
    },
    [dispatch],
  );

  const previewGuess = useCallback(function (at: LatLng) {
    const socket = getSocket();
    if (socket.connected && seated.current) socket.emit("guess:preview", at);
  }, []);

  const nextRound = useCallback(
    function () {
      dispatch("round:next");
    },
    [dispatch],
  );

  const returnToLobby = useCallback(
    function () {
      dispatch("game:returnToLobby");
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

  // Новый метод для смены настроек
  const updateSettings = useCallback(
    function (settings: Record<string, number>) {
      dispatch("game:settings", { settings: settings });
    },
    [dispatch],
  );

  return {
    state: state,
    status: status,
    error: error,
    connected: connected,
    budgetBlocked: budgetBlocked,
    join: join,
    peek: peek,
    start: start,
    hide: hide,
    guess: guess,
    sendSoloTarget: sendSoloTarget,
    previewGuess: previewGuess,
    nextRound: nextRound,
    returnToLobby: returnToLobby,
    leave: leave,
    close: close,
    updateSettings: updateSettings,
  };
}