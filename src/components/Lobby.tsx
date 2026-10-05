"use client";

import { useState } from "react";
import QRCode from "react-qr-code";
import type { PublicState } from "@/shared/types";
import PlayerList from "./PlayerList";

interface Props {
  state: PublicState;
  onStart: () => void;
  onUpdateSettings?: (settings: Record<string, number>) => void;
  speakingIds?: Set<string>;
}

export default function Lobby(props: Props) {
  const state = props.state;
  const onStart = props.onStart;
  const onUpdateSettings = props.onUpdateSettings;
  const speakingIds = props.speakingIds;

  const [copied, setCopied] = useState(false);
  const [showQR, setShowQR] = useState(false);

  const isGM = state.youAreGameMaster;
  const isSolo = state.players.length < 2;
  const gameUrl = typeof window !== "undefined" ? window.location.href : "";

  function copyLink() {
    if (navigator.clipboard) {
      navigator.clipboard.writeText(gameUrl).then(function () {
        setCopied(true);
        setTimeout(function () {
          setCopied(false);
        }, 1500);
      });
    }
  }

  function handleOpenQR() {
    setShowQR(true);
  }

  function handleCloseQR() {
    setShowQR(false);
  }

  function changeRounds(delta: number) {
    if (!onUpdateSettings) return;
    const current = state.settings.multiplayerCycles || 5;
    const nextVal = Math.max(1, Math.min(10, current + delta));
    onUpdateSettings({ multiplayerCycles: nextVal, soloRounds: nextVal });
  }

  function changeHidingTime(delta: number) {
    if (!onUpdateSettings) return;
    const current = state.settings.hidingTimeLimit || 0;
    const nextVal = Math.max(0, Math.min(300, current + delta));
    onUpdateSettings({ hidingTimeLimit: nextVal });
  }

  function changeFindingTime(delta: number) {
    if (!onUpdateSettings) return;
    const current = state.settings.findingTimeLimit || 0;
    const nextVal = Math.max(0, Math.min(300, current + delta));
    onUpdateSettings({ findingTimeLimit: nextVal });
  }

  function handleDecRounds() {
    changeRounds(-1);
  }

  function handleIncRounds() {
    changeRounds(1);
  }

  function handleDecHiding() {
    changeHidingTime(-15);
  }

  function handleIncHiding() {
    changeHidingTime(15);
  }

  function handleDecFinding() {
    changeFindingTime(-15);
  }

  function handleIncFinding() {
    changeFindingTime(15);
  }

  function formatTime(seconds: number): string {
    if (seconds === 0) return "∞ (Без лимита)";
    const mins = Math.floor(seconds / 60);
    const secs = seconds % 60;
    if (mins > 0 && secs > 0) {
      return mins + " мин " + secs + " сек";
    }
    if (mins > 0) {
      return mins + " мин";
    }
    return secs + " сек";
  }

  const currentRoundsVal = state.settings.multiplayerCycles || 5;
  const hidingTimeVal = state.settings.hidingTimeLimit || 0;
  const findingTimeVal = state.settings.findingTimeLimit || 0;

  return (
    <>
      <div className="center-screen">
        <div className="stack" style={{ width: 460, gap: 18 }}>
          
          <div className="stack" style={{ gap: 8 }}>
            <div className="row" style={{ justifyContent: "space-between", alignItems: "center" }}>
              <h1 className="title">Лобби игры</h1>
              <span className="badge good">
                {isSolo ? "Соло режим" : "Мультиплеер"}
              </span>
            </div>

            <div
              className="row"
              style={{ gap: 10, justifyContent: "space-between", alignItems: "stretch" }}
            >
              <span className="code-pill" style={{ fontSize: 20 }}>
                {state.code}
              </span>
              <div className="row" style={{ gap: 8, alignItems: "stretch" }}>
                <button
                  type="button"
                  className="secondary qr-button"
                  onClick={handleOpenQR}
                  aria-label="Показать QR-код"
                >
                  <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                    <path d="M4 8V5a1 1 0 0 1 1-1h3" />
                    <path d="M20 8V5a1 1 0 0 0-1-1h-3" />
                    <path d="M4 16v3a1 1 0 0 0 1 1h3" />
                    <path d="M20 16v3a1 1 0 0 1-1 1h-3" />
                    <rect x="9" y="9" width="6" height="6" />
                  </svg>
                </button>
                <button type="button" className="secondary" onClick={copyLink}>
                  {copied ? "Скопировано!" : "Скопировать ссылку"}
                </button>
              </div>
            </div>
          </div>

          <div className="card stack" style={{ gap: 12 }}>
            <div className="row" style={{ justifyContent: "space-between" }}>
              <span className="eyebrow">Игроки ({state.players.length})</span>
              <span className="muted" style={{ fontSize: 13 }}>
                {state.players.length}/10 участников
              </span>
            </div>
            <PlayerList players={state.players} speakingIds={speakingIds} />
          </div>

          <div className="card stack" style={{ gap: 12 }}>
            <div className="row" style={{ justifyContent: "space-between" }}>
              <span className="eyebrow">Настройки матча ⚙️</span>
              {!isGM && <span className="badge">Только хост</span>}
            </div>

            <div className="setting-row">
              <div className="setting-info">
                <span className="setting-label">Количество раундов</span>
                <span className="setting-desc">Кругов пряток за игру</span>
              </div>
              {isGM ? (
                <div className="stepper-control">
                  <button
                    type="button"
                    className="stepper-btn"
                    onClick={handleDecRounds}
                    disabled={currentRoundsVal <= 1}
                  >
                    -
                  </button>
                  <span className="stepper-val">{currentRoundsVal}</span>
                  <button
                    type="button"
                    className="stepper-btn"
                    onClick={handleIncRounds}
                    disabled={currentRoundsVal >= 10}
                  >
                    +
                  </button>
                </div>
              ) : (
                <span className="setting-value-static">{currentRoundsVal} раундов</span>
              )}
            </div>

            <div className="setting-row">
              <div className="setting-info">
                <span className="setting-label">Таймер на прятки</span>
                <span className="setting-desc">Время на выбор точки</span>
              </div>
              {isGM ? (
                <div className="stepper-control">
                  <button
                    type="button"
                    className="stepper-btn"
                    onClick={handleDecHiding}
                    disabled={hidingTimeVal <= 0}
                  >
                    -
                  </button>
                  <span className="stepper-val-text">{formatTime(hidingTimeVal)}</span>
                  <button
                    type="button"
                    className="stepper-btn"
                    onClick={handleIncHiding}
                    disabled={hidingTimeVal >= 300}
                  >
                    +
                  </button>
                </div>
              ) : (
                <span className="setting-value-static">{formatTime(hidingTimeVal)}</span>
              )}
            </div>

            <div className="setting-row">
              <div className="setting-info">
                <span className="setting-label">Таймер на поиск</span>
                <span className="setting-desc">Время на угадывание</span>
              </div>
              {isGM ? (
                <div className="stepper-control">
                  <button
                    type="button"
                    className="stepper-btn"
                    onClick={handleDecFinding}
                    disabled={findingTimeVal <= 0}
                  >
                    -
                  </button>
                  <span className="stepper-val-text">{formatTime(findingTimeVal)}</span>
                  <button
                    type="button"
                    className="stepper-btn"
                    onClick={handleIncFinding}
                    disabled={findingTimeVal >= 300}
                  >
                    +
                  </button>
                </div>
              ) : (
                <span className="setting-value-static">{formatTime(findingTimeVal)}</span>
              )}
            </div>
          </div>

          {isGM ? (
            <div className="card stack" style={{ gap: 10 }}>
              <button type="button" className="btn-primary-large" onClick={onStart}>
                {isSolo ? "Играть соло" : "Начать игру"}
              </button>
              {isSolo && (
                <p className="muted" style={{ margin: 0, fontSize: 13, textAlign: "center" }}>
                  Вы один в комнате. Вы будете угадывать точки от сервера. Пригласите друга для соперничества!
                </p>
              )}
            </div>
          ) : (
            <div className="card" style={{ textAlign: "center" }}>
              <p className="muted" style={{ margin: 0, fontSize: 14 }}>
                Ожидание старта игры от хоста…
              </p>
            </div>
          )}
        </div>
      </div>

      {showQR && (
        <div className="qr-overlay">
          <button
            type="button"
            className="ghost modal-x"
            onClick={handleCloseQR}
            aria-label="Закрыть"
          >
            ✕
          </button>
          <h2 className="title" style={{ fontSize: 22 }}>
            Сканируйте для входа
          </h2>
          <div className="qr-code-wrap">
            <QRCode
              value={gameUrl}
              size={220}
              fgColor="#090d16"
              bgColor="#ffffff"
              style={{ width: "min(70vw, 50vh, 320px)", height: "auto" }}
            />
          </div>
          <span className="code-pill" style={{ fontSize: 20 }}>
            {state.code}
          </span>
        </div>
      )}
    </>
  );
}