"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import type { Reaction } from "@/shared/types";
import { getSocket } from "./socket";

/** How long a burst stays on screen before it is dropped. */
const REACTION_TTL_MS = 2600;
/** Hard cap so a burst of spam cannot grow the list without bound. */
const MAX_VISIBLE = 24;
/** Client-side throttle, matching the server's 400 ms guard. */
const SEND_THROTTLE_MS = 400;

export interface ReactionsHook {
  /** Reactions currently on screen, oldest first. */
  reactions: Reaction[];
  /** Send one reaction. Silently ignored while throttled. */
  send: (reaction: string) => void;
}

/**
 * Quick emoji reactions.
 *
 * The server relays each burst to the whole room and never stores it, so this
 * hook owns the only copy: it appends incoming bursts and drops them after a
 * short TTL. Nothing here is persisted, which is the point — a reaction is a
 * moment, not a message.
 */
export function useReactions(enabled: boolean): ReactionsHook {
  const [reactions, setReactions] = useState<Reaction[]>([]);
  const lastSent = useRef(0);
  // Timers are tracked so unmounting does not leave a setState on a dead
  // component behind.
  const timers = useRef<Set<ReturnType<typeof setTimeout>>>(new Set());

  useEffect(() => {
    if (!enabled) return;
    const socket = getSocket();

    const onReaction = (reaction: Reaction) => {
      setReactions((prev) => {
        const next = [...prev, reaction];
        return next.length > MAX_VISIBLE ? next.slice(next.length - MAX_VISIBLE) : next;
      });
      const timer = setTimeout(() => {
        timers.current.delete(timer);
        setReactions((prev) => prev.filter((r) => r.id !== reaction.id));
      }, REACTION_TTL_MS);
      timers.current.add(timer);
    };

    socket.on("reaction:new", onReaction);
    return () => {
      socket.off("reaction:new", onReaction);
      for (const timer of timers.current) clearTimeout(timer);
      timers.current.clear();
    };
  }, [enabled]);

  const send = useCallback((reaction: string) => {
    const now = Date.now();
    if (now - lastSent.current < SEND_THROTTLE_MS) return;
    lastSent.current = now;
    getSocket().emit("reaction:send", { reaction });
  }, []);

  return { reactions, send };
}
