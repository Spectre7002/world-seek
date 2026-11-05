"use client";

import { useEffect, useState } from "react";
import QRCode from "react-qr-code";
import type {
  CaseTierKey,
  MapId,
  MovementMode,
  PublicState,
  Settings,
} from "@/shared/types";
import { CASE_TIER_KEYS, MOVEMENT_MODES } from "@/shared/types";
import PlayerList from "./PlayerList";
import LanguageSwitch from "./LanguageSwitch";
import { useLanguage } from "@/lib/language";
import MapSelector from "./MapSelector";

interface Props {
  state: PublicState;
  onStart: () => void;
  onUpdateSettings?: (settings: Partial<Settings>) => void;
  speakingIds?: Set<string>;
}

export default function Lobby(props: Props) {
  const state = props.state;
  const { t } = useLanguage();
  const onStart = props.onStart;
  const onUpdateSettings = props.onUpdateSettings;
  const speakingIds = props.speakingIds;

  const [copied, setCopied] = useState(false);
  const [showQR, setShowQR] = useState(false);

  const isGM = state.youAreGameMaster;
  // Spectators are only promoted to seats when the room returns to the lobby,
  // so this is normally a no-op — but counting seats rather than rows keeps the
  // "solo / multiplayer" label correct even if one is still watching.
  const seatedCount = state.players.filter((p) => !p.spectator).length;
  const isSolo = seatedCount < 2;
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

  function toggleUnofficialCoverage() {
    if (onUpdateSettings) {
      onUpdateSettings({
        allowUnofficialCoverage: !state.settings.allowUnofficialCoverage,
      });
    }
  }

  function toggleCheats() {
    if (onUpdateSettings) {
      onUpdateSettings({ cheatsEnabled: !state.settings.cheatsEnabled });
    }
  }

  function toggleCase() {
    if (onUpdateSettings) {
      onUpdateSettings({ caseEnabled: !state.settings.caseEnabled });
    }
  }

  // Case tiers: the host picks which rarities may drop. The last enabled tier
  // cannot be switched off, because an empty pool would make the case
  // unrollable (the server also falls back to "all tiers" defensively).
  const enabledTiers: CaseTierKey[] =
    state.settings.caseTiers && state.settings.caseTiers.length > 0
      ? state.settings.caseTiers
      : CASE_TIER_KEYS;

  function toggleCaseTier(tier: CaseTierKey) {
    if (!onUpdateSettings) return;
    const isOn = enabledTiers.includes(tier);
    if (isOn && enabledTiers.length === 1) return;
    const next = isOn
      ? enabledTiers.filter((k) => k !== tier)
      : CASE_TIER_KEYS.filter((k) => k === tier || enabledTiers.includes(k));
    onUpdateSettings({ caseTiers: next });
  }

  function selectGameMode(gameMode: "classic" | "hp") {
    if (onUpdateSettings && state.settings.gameMode !== gameMode) {
      onUpdateSettings({
        gameMode,
        ...(gameMode === "hp" ? { hidingTimeLimit: 0 } : {}),
      });
    }
  }

  function selectMovementMode(movementMode: MovementMode) {
    if (onUpdateSettings && state.settings.movementMode !== movementMode) {
      onUpdateSettings({ movementMode });
    }
  }

  // Seed: empty = random. "daily" is resolved to today's UTC date by the
  // server, so every player who picks it plays the same sequence.
  const seed = state.settings.seed ?? "";
  const isDaily = seed.startsWith("daily-");
  const [seedDraft, setSeedDraft] = useState(seed);

  // Keep the input in sync when the server normalises the value (e.g. "daily"
  // becomes "daily-2026-11-05").
  useEffect(() => {
    setSeedDraft(seed);
  }, [seed]);

  function applySeed() {
    if (!onUpdateSettings) return;
    onUpdateSettings({ seed: seedDraft.trim() });
  }

  function useDailySeed() {
    if (!onUpdateSettings) return;
    onUpdateSettings({ seed: "daily" });
  }

  // Ask the server for a fresh shareable seed. Generating it client-side would
  // work too, but the server is the one that has to accept it, so this keeps a
  // single source of truth for the format.
  function useRandomSeed() {
    if (!onUpdateSettings) return;
    onUpdateSettings({ seed: "random" });
  }

  function clearSeed() {
    if (!onUpdateSettings) return;
    onUpdateSettings({ seed: "" });
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
    if (seconds === 0) return "∞ (" + t("No limit") + ")";
    const mins = Math.floor(seconds / 60);
    const secs = seconds % 60;
    if (mins > 0 && secs > 0) {
      return mins + t(" min ") + secs + t(" sec");
    }
    if (mins > 0) {
      return mins + t(" min");
    }
    return secs + t(" sec");
  }

  const currentRoundsVal = state.settings.multiplayerCycles || 5;
  const hidingTimeVal = state.settings.hidingTimeLimit || 0;
  const findingTimeVal = state.settings.findingTimeLimit || 0;

  return (
    <>
      <div className="center-screen">
        <div className="stack lobby-shell" style={{ width: "min(920px, calc(100vw - 32px))", gap: 18 }}>
          
          <div className="stack" style={{ gap: 8 }}>
            <div className="row" style={{ justifyContent: "space-between", alignItems: "center" }}>
              <h1 className="title">{t("Game lobby")}</h1>
              <LanguageSwitch />
              <span className="badge good">
                {isSolo ? t("Solo mode") : state.is1v1 ? t("1v1 Duel") : t("Multiplayer")}
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
                  aria-label={t("Show QR code")}
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
                  {copied ? t("Copied!") : t("Copy link")}
                </button>
              </div>
            </div>
          </div>

          <div className="card stack" style={{ gap: 12 }}>
            <div className="row" style={{ justifyContent: "space-between" }}>
              <span className="eyebrow">{t("Players")} ({seatedCount})</span>
              <span className="muted" style={{ fontSize: 13 }}>
                {seatedCount}/10 {t("participants")}
              </span>
            </div>
            <PlayerList players={state.players} speakingIds={speakingIds} />
          </div>

          <div className="lobby-settings-grid">
            
            {/* ЛЕВАЯ КОЛОНКА: Основные настройки матча */}
            <div className="card stack" style={{ gap: 20 }}>
              <div className="row" style={{ justifyContent: "space-between" }}>
                <span className="eyebrow">{t("Match settings ⚙️")}</span>
                {!isGM && <span className="badge">{t("Host only")}</span>}
              </div>

              {state.settings.gameMode !== "hp" && <div className="setting-row">
                <div className="setting-info">
                  <span className="setting-label">{t("Number of rounds")}</span>
                  <span className="setting-desc">{t("Hide-and-seek cycles per game")}</span>
                </div>
                {isGM ? (
                  <div className="stepper-control" style={{ marginTop: 12 }}>
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
                  <span className="setting-value-static" style={{ marginTop: 12 }}>{currentRoundsVal} {t("rounds")}</span>
                )}
              </div>}

              {state.settings.gameMode !== "hp" && <div className="setting-row">
                <div className="setting-info">
                  <span className="setting-label">{t("Hiding timer")}</span>
                  <span className="setting-desc">{t("Time to choose a spot")}</span>
                </div>
                {isGM ? (
                  <div className="stepper-control" style={{ marginTop: 12 }}>
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
                  <span className="setting-value-static" style={{ marginTop: 12 }}>{formatTime(hidingTimeVal)}</span>
                )}
              </div>}

              <div className="setting-row">
                <div className="setting-info">
                  <span className="setting-label">{t("Finding timer")}</span>
                  <span className="setting-desc">{t("Time to make a guess")}</span>
                </div>
                {isGM ? (
                  <div className="stepper-control" style={{ marginTop: 12 }}>
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
                  <span className="setting-value-static" style={{ marginTop: 12 }}>{formatTime(findingTimeVal)}</span>
                )}
              </div>

              <div className="setting-row">
                <div className="setting-info">
                  <span className="setting-label">{t("Game mode")}</span>
                  <span className="setting-desc">{t("Classic (Points) / HP Mode (Health)")}</span>
                </div>
                <div className="game-mode-buttons" role="group" aria-label={t("Game mode")} style={{ marginTop: 12 }}>
                  <button
                    type="button"
                    className={`coverage-toggle${state.settings.gameMode === "classic" ? " is-on" : ""}`}
                    aria-pressed={state.settings.gameMode === "classic"}
                    disabled={!isGM}
                    onClick={() => selectGameMode("classic")}
                  >
                    {isSolo ? t("Classic") : t("Hide and Seek")} 🏆
                  </button>
                  <button
                    type="button"
                    className={`coverage-toggle${state.settings.gameMode === "hp" ? " is-on" : ""}`}
                    aria-pressed={state.settings.gameMode === "hp"}
                    disabled={!isGM || isSolo}
                    onClick={() => selectGameMode("hp")}
                  >
                    {t("HP Mode")} 🩸
                  </button>
                </div>
              </div>

              <div className="setting-row">
                <div className="setting-info">
                  <span className="setting-label">{t("Movement")}</span>
                  <span className="setting-desc">
                    {t("NMPZ locks the panorama: no walking, and optionally no looking around.")}
                  </span>
                </div>
                <div
                  className="game-mode-buttons"
                  role="group"
                  aria-label={t("Movement")}
                  style={{ marginTop: 12 }}
                >
                  {MOVEMENT_MODES.map((mode) => (
                    <button
                      key={mode}
                      type="button"
                      className={`coverage-toggle${
                        state.settings.movementMode === mode ? " is-on" : ""
                      }`}
                      aria-pressed={state.settings.movementMode === mode}
                      disabled={!isGM}
                      onClick={() => selectMovementMode(mode)}
                    >
                      {mode === "free"
                        ? t("Free movement")
                        : mode === "no-move"
                          ? t("No move")
                          : t("NMPZ")}
                    </button>
                  ))}
                </div>
              </div>

              {!isSolo && <div className="setting-row">
                <div className="setting-info">
                  <span className="setting-label">{t("Allow unofficial coverage")}</span>
                  <span className="setting-desc">
                    {t("Buildings and unofficial photospheres for hiding spots")}
                  </span>
                </div>
                <button
                  type="button"
                  className={`coverage-toggle${state.settings.allowUnofficialCoverage ? " is-on" : ""}`}
                  role="switch"
                  aria-checked={state.settings.allowUnofficialCoverage}
                  disabled={!isGM}
                  style={{ marginTop: 12 }}
                  onClick={toggleUnofficialCoverage}
                >
                  {state.settings.allowUnofficialCoverage
                    ? t("Official and unofficial")
                    : t("Official only")}
                </button>
              </div>}
            </div>
            
            {/* ПРАВАЯ КОЛОНКА: Карта и Дополнительные фишки */}
            <div className="stack" style={{ gap: 16, alignSelf: "flex-start" }}>
              <div className="card stack map-settings-card" style={{ gap: 20 }}>
                <div className="row" style={{ justifyContent: "space-between" }}>
                  <div className="setting-info">
                    <span className="setting-label">{t("Map")}</span>
                    <span className="setting-desc">{t("Location pool for this game")}</span>
                  </div>
                  {!isGM && <span className="badge">{t("Host only")}</span>}
                </div>
                <div style={{ marginTop: 4 }}>
                  <MapSelector
                    catalog={state.maps}
                    value={state.settings.selectedMap}
                    disabled={!isGM}
                    onChange={function (mapId: MapId) {
                      if (onUpdateSettings) onUpdateSettings({ selectedMap: mapId });
                    }}
                  />
                </div>
              </div>

              <div className="card stack" style={{ gap: 20 }}>
                <div className="row" style={{ justifyContent: "space-between" }}>
                  <span className="eyebrow">{t("Additional 🌟")}</span>
                  {!isGM && <span className="badge">{t("Host only")}</span>}
                </div>

                <div className="setting-row">
                  <div className="setting-info">
                    <span className="setting-label">{t("Enable Cheats 🔮")}</span>
                    <span className="setting-desc">{t("Opens the menu for adjusting target offset and radius")}</span>
                  </div>
                  <button
                    type="button"
                    className={`coverage-toggle${state.settings.cheatsEnabled ? " is-on" : ""}`}
                    role="switch"
                    aria-checked={state.settings.cheatsEnabled}
                    disabled={!isGM}
                    style={{ marginTop: 12 }}
                    onClick={toggleCheats}
                  >
                    {state.settings.cheatsEnabled ? t("Enabled") : t("Disabled")}
                  </button>
                </div>

                <div className="setting-row">
                  <div className="setting-info">
                    <span className="setting-label">{t("Special Case 🎁")}</span>
                    <span className="setting-desc">{t("Random rewards / odds")}</span>
                  </div>
                  <div className="row" style={{ gap: 10, alignItems: "center", marginTop: 12 }}>
                    <select
                      value={state.settings.caseOddsMode}
                      onChange={(e) => onUpdateSettings && onUpdateSettings({ caseOddsMode: e.target.value as any })}
                      disabled={!isGM}
                      style={{ padding: "6px 10px", background: "var(--bg-elev-2)", color: "#fff", borderRadius: 4, border: "1px solid var(--border-color)", cursor: "pointer" }}
                    >
                      <option value="standard">{t("Standard")}</option>
                      <option value="better_odds">{t("Better")}</option>
                    </select>
                    <button
                      type="button"
                      className={`coverage-toggle${state.settings.caseEnabled ? " is-on" : ""}`}
                      role="switch"
                      aria-checked={state.settings.caseEnabled}
                      disabled={!isGM}
                      onClick={toggleCase}
                    >
                      {state.settings.caseEnabled ? t("Enabled") : t("Disabled")}
                    </button>
                  </div>
                </div>

                {state.settings.caseEnabled && (
                  <div className="setting-row">
                    <div className="setting-info">
                      <span className="setting-label">{t("Case tiers")}</span>
                      <span className="setting-desc">
                        {t("Which rarities can drop from a case")}
                      </span>
                    </div>
                    <div className="case-tier-list" role="group" aria-label={t("Case tiers")}>
                      {CASE_TIER_KEYS.map((tier) => {
                        const on = enabledTiers.includes(tier);
                        return (
                          <button
                            key={tier}
                            type="button"
                            className={`case-tier-chip${on ? " is-on" : ""}`}
                            aria-pressed={on}
                            disabled={!isGM || (on && enabledTiers.length === 1)}
                            onClick={() => toggleCaseTier(tier)}
                          >
                            {t(tier)}
                          </button>
                        );
                      })}
                    </div>
                  </div>
                )}

                {/* Seeded / daily challenge. Only affects server-picked
                    locations (solo and HP), so it is hidden in classic mode
                    where every target is a player. */}
                {state.settings.gameMode !== "classic" || isSolo ? (
                  <div className="setting-row">
                    <div className="setting-info">
                      <span className="setting-label">{t("Seed / daily challenge")}</span>
                      <span className="setting-desc">
                        {t("Same seed, same locations. Leave empty for random.")}
                      </span>
                    </div>
                    <div className="seed-controls">
                      <input
                        className="seed-input"
                        value={seedDraft}
                        maxLength={40}
                        placeholder={t("random")}
                        disabled={!isGM}
                        aria-label={t("Seed")}
                        onChange={(e) => setSeedDraft(e.target.value)}
                        onBlur={applySeed}
                        onKeyDown={(e) => {
                          if (e.key === "Enter") applySeed();
                        }}
                      />
                      <button
                        type="button"
                        className={`coverage-toggle${isDaily ? " is-on" : ""}`}
                        disabled={!isGM}
                        onClick={useDailySeed}
                      >
                        {t("Daily")}
                      </button>
                      <button
                        type="button"
                        className="secondary"
                        disabled={!isGM}
                        onClick={useRandomSeed}
                      >
                        {t("Random")}
                      </button>
                      {seed && (
                        <button type="button" className="ghost" disabled={!isGM} onClick={clearSeed}>
                          {t("Clear")}
                        </button>
                      )}
                    </div>
                  </div>
                ) : null}
              </div>
            </div>
            
          </div>

          {isGM ? (
            <div className="card stack lobby-start-card" style={{ gap: 10 }}>
              <button type="button" className="btn-primary-large" onClick={onStart}>
                {state.is1v1 ? t("Start 1v1 Duel") : isSolo ? t("Play solo") : t("Start game")}
              </button>
              {isSolo && (
                <p className="muted" style={{ margin: 0, fontSize: 13, textAlign: "center" }}>
                  {t("You're alone in the room. Guess locations picked by the server. Invite a friend to compete!")}
                </p>
              )}
            </div>
          ) : (
            <div className="card" style={{ textAlign: "center" }}>
              <p className="muted" style={{ margin: 0, fontSize: 14 }}>
                {t("Waiting for the host to start the game…")}
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
            aria-label={t("Close dialog")}
          >
            ✕
          </button>
          <h2 className="title" style={{ fontSize: 22 }}>
            {t("Scan to join")}
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