"use client";

import { useEffect, useRef, useState } from "react";
import type { ChatMessage } from "@/shared/types";
import { emojiUrl } from "@/shared/emojis";

interface Props {
  messages: ChatMessage[];
  onSend: (text: string) => void;
  unreadCount: number;
  onSetOpen: (open: boolean) => void;
  hasVoice: boolean;
}

export default function TextChat({ messages, onSend, unreadCount, onSetOpen, hasVoice }: Props) {
  const [open, setOpen] = useState(false);
  const [draft, setDraft] = useState("");
  const bottomRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    onSetOpen(open);
  }, [open, onSetOpen]);

  // On desktop (see the min-width:561px rules in globals.css) this class turns
  // the chat panel into a full-height sidebar docked over the right edge of
  // the game (and hides the now-redundant toggle button). On mobile the class
  // has no effect, so the panel stays the original floating dropdown.
  useEffect(() => {
    document.body.classList.toggle("chat-open", open);
    return () => document.body.classList.remove("chat-open");
  }, [open]);

  // Auto-scroll to the newest message whenever the list grows.
  useEffect(() => {
    if (open) {
      bottomRef.current?.scrollIntoView({ behavior: "smooth" });
    }
  }, [messages, open]);

  // Focus input when opening.
  useEffect(() => {
    if (open) inputRef.current?.focus();
  }, [open]);

  function toggle() {
    setOpen((o) => !o);
  }

  function send() {
    const text = draft.trim();
    if (!text) return;
    onSend(text);
    setDraft("");
  }

  function onKeyDown(e: React.KeyboardEvent<HTMLInputElement>) {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      send();
    }
  }

  return (
    <div className={`chat-container${hasVoice ? "" : " chat-container--solo"}`}>
      {/* Toggle button at the top; panel drops down below it */}
      <button
        className={`chat-toggle secondary${unreadCount > 0 && !open ? " chat-toggle--unread" : ""}`}
        onClick={toggle}
        aria-label={open ? "Close chat" : `Chat${unreadCount > 0 ? ` (${unreadCount} new)` : ""}`}
        aria-expanded={open}
      >
        💬
        {unreadCount > 0 && !open && (
          <span className="chat-badge">{unreadCount > 9 ? "9+" : unreadCount}</span>
        )}
      </button>

      {open && (
        <div className="chat-panel">
          {/* Only shown when docked as a desktop sidebar — the toggle button
              above is hidden then, so this is the only way to close it. */}
          <div className="chat-panel-header">
            <span className="eyebrow">Chat</span>
            <button
              className="ghost modal-x"
              style={{ position: "static" }}
              onClick={toggle}
              aria-label="Close chat"
            >
              ✕
            </button>
          </div>
          <div className="chat-messages">
            {messages.length === 0 && (
              <p className="chat-empty muted">No messages yet.</p>
            )}
            {messages.map((msg) => (
              <div key={msg.id} className="chat-msg">
                <img
                  className="chat-emoji"
                  src={emojiUrl(msg.emoji)}
                  alt=""
                  aria-hidden="true"
                />
                <div className="chat-msg-body">
                  <span className="chat-name">{msg.playerName}</span>
                  <span className="chat-text">{msg.text}</span>
                </div>
              </div>
            ))}
            <div ref={bottomRef} />
          </div>
          <div className="chat-input-row">
            <input
              ref={inputRef}
              className="chat-input"
              value={draft}
              maxLength={500}
              placeholder="Message…"
              onChange={(e) => setDraft(e.target.value)}
              onKeyDown={onKeyDown}
            />
            <button className="secondary chat-send" onClick={send} disabled={!draft.trim()}>
              Send
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
