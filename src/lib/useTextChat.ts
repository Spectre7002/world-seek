"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import type { ChatMessage } from "@/shared/types";
import { getSocket } from "./socket";

export interface TextChatHook {
  messages: ChatMessage[];
  send: (text: string) => void;
  unreadCount: number;
  setOpen: (open: boolean) => void;
}

export function useTextChat(enabled: boolean): TextChatHook {
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [unreadCount, setUnreadCount] = useState(0);
  const openRef = useRef(false);

  useEffect(() => {
    if (!enabled) return;
    const socket = getSocket();

    const onHistory = (history: ChatMessage[]) => {
      setMessages(history);
    };

    const onMessage = (msg: ChatMessage) => {
      setMessages((prev) => [...prev, msg]);
      if (!openRef.current) {
        setUnreadCount((c) => c + 1);
      }
    };

    socket.on("chat:history", onHistory);
    socket.on("chat:message", onMessage);

    return () => {
      socket.off("chat:history", onHistory);
      socket.off("chat:message", onMessage);
    };
  }, [enabled]);

  const send = useCallback((text: string) => {
    const trimmed = text.trim();
    if (!trimmed) return;
    getSocket().emit("chat:send", { text: trimmed });
  }, []);

  const setOpen = useCallback((open: boolean) => {
    openRef.current = open;
    if (open) setUnreadCount(0);
  }, []);

  return { messages, send, unreadCount, setOpen };
}
