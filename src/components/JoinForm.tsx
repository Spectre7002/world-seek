"use client";

import { useEffect, useState } from "react";
import EmojiPicker from "./EmojiPicker";

interface Props {
  code: string;
  error?: string | null;
  onJoin: (name: string, emoji: string) => void;
  onPeek: (code: string) => Promise<string[]>;
}

export default function JoinForm(props: Props) {
  const code = props.code;
  const error = props.error;
  const onJoin = props.onJoin;
  const onPeek = props.onPeek;

  const [name, setName] = useState("");
  const [selectedEmoji, setSelectedEmoji] = useState("grinning");
  const [takenEmojis, setTakenEmojis] = useState<string[]>([]);

  useEffect(
    function () {
      if (code) {
        onPeek(code).then(function (taken) {
          if (taken) {
            setTakenEmojis(taken);
          }
        });
      }
    },
    [code, onPeek]
  );

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (name.trim()) {
      onJoin(name.trim(), selectedEmoji);
    }
  }

  function handleNameChange(e: React.ChangeEvent<HTMLInputElement>) {
    setName(e.target.value);
  }

  function handleEmojiChange(id: string) {
    setSelectedEmoji(id);
  }

  return (
    <div className="center-screen">
      <div className="stack" style={{ width: 440, gap: 20 }}>
        <div style={{ textAlign: "center" }}>
          <span className="eyebrow">OPEN WORLD · STREET VIEW</span>
          <h1 className="title" style={{ fontSize: 36, marginTop: 4 }}>
            World Seek
          </h1>
          <p className="muted" style={{ fontSize: 14, marginTop: 6 }}>
            Прячься в любой точке мира. Дай друзьям найти тебя в Street View.
          </p>
        </div>

        <form onSubmit={handleSubmit} className="card stack" style={{ gap: 18 }}>
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
            <span className="eyebrow">Вход в игру</span>
            <span className="code-pill">{code}</span>
          </div>

          {error && (
            <div style={{ color: "var(--danger)", fontSize: 14 }}>
              {error}
            </div>
          )}

          <div className="stack" style={{ gap: 6 }}>
            <label className="setting-label">Ваше имя</label>
            <input
              type="text"
              placeholder="Введите ваше имя..."
              value={name}
              onChange={handleNameChange}
              maxLength={20}
              required
              autoFocus
            />
          </div>

          <div className="stack" style={{ gap: 8 }}>
            <label className="setting-label">Выберите аватар</label>
            <EmojiPicker
              value={selectedEmoji}
              onChange={handleEmojiChange}
              taken={takenEmojis}
            />
          </div>

          <button
            type="submit"
            className="btn-primary-large"
            disabled={!name.trim()}
          >
            Присоединиться к игре
          </button>
        </form>
      </div>
    </div>
  );
}