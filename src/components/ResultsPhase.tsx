"use client";

import { useEffect, useState } from "react";
import type { PublicState } from "@/shared/types";
import { formatDistance } from "@/shared/scoring";
import { emojiUrl } from "@/shared/emojis";
import MapPicker, { type MapLine, type MapMarker } from "./MapPicker";
import { useLanguage } from "@/lib/language";

const PALETTE = ["#4a5d2f", "#9a3324", "#c8843d", "#3a5a6e", "#7d5a3a", "#5e7540", "#a8553d", "#2f4858", "#b8862f", "#6b4226", "#436b56", "#8c3d2e"];

// Компонент для плавной анимации цифр
function AnimatedNumber({ value }: { value: number }) {
  const [display, setDisplay] = useState(value);
  
  useEffect(() => {
    let start = display;
    if (start === value) return;
    let startTime = performance.now();
    const duration = 1500;
    
    const tick = (now: number) => {
      const progress = Math.min((now - startTime) / duration, 1);
      const ease = 1 - Math.pow(1 - progress, 4); // easeOutQuart
      setDisplay(Math.round(start + (value - start) * ease));
      if (progress < 1) requestAnimationFrame(tick);
    };
    requestAnimationFrame(tick);
  }, [value]);
  
  return <span>{display}</span>;
}

interface Props {
  state: PublicState;
  onNext: () => void;
  // Получаем чит из GameRoom для отрисовки зоны
  caseHint?: any;
}

export default function ResultsPhase(props: Props) {
  const { t } = useLanguage();
  const state = props.state;
  const onNext = props.onNext;
  const caseHint = props.caseHint;
  const result = state.result;
  const isLast = state.solo 
  ? state.currentRound + 1 >= state.totalRounds
  : (state.currentRound + 1 >= state.totalRounds) && (state.subRound !== undefined && state.subRound + 1 >= state.totalSubRounds!);
  const isHpMode = state.settings.gameMode === "hp" && !state.solo;

  if (!result) return <div className="center-screen"><p className="muted">{t("Tallying the round…")}</p></div>;

  const markers: MapMarker[] = [{ lat: result.real.lat, lng: result.real.lng, icon: state.solo ? undefined : result.targetEmoji, size: 54, title: state.solo ? t("The real spot") : result.targetName + "'s " + t("real hiding spot") }];
  const lines: MapLine[] = [];

  for (let i = 0; i < result.guesses.length; i++) {
    const g = result.guesses[i];
    markers.push({ lat: g.lat, lng: g.lng, icon: g.emoji, title: g.name + " · " + formatDistance(g.distanceKm) });
    lines.push({ from: { lat: g.lat, lng: g.lng }, to: result.real, color: PALETTE[i % PALETTE.length] });
  }

  return (
    <div className="full-bleed">
      <div className="split">
        <div style={{ position: "relative", width: "100%", height: "100%" }}>
          <div className="overlay-top">
            {!state.solo && <span className="roster-avatar" aria-hidden="true"><img className="emoji-img" src={emojiUrl(result.targetEmoji)} alt="" /></span>}
            <span>{state.solo ? <>{t("This was the spot 📍")}</> : <><strong>{result.targetName}</strong>{t(" was hiding here 📍")}</>}</span>
          </div>
          {/* Передаем caseHint в MapPicker для финальной карты */}
          <MapPicker markers={markers} lines={lines} fitToContent caseHint={caseHint} />
        </div>
        <div style={{ padding: 24, overflowY: "auto", background: "var(--bg)", display: "flex", flexDirection: "column", gap: 16 }}>
          
          <div className="stack" style={{ gap: 4 }}>
            <span className="muted">{t("Round")} {state.currentRound + 1} {t("of")} {state.totalRounds}</span>
            <h2 className="title" style={{ fontSize: 22 }}>{t("This round's guesses")}</h2>
          </div>

          <div className="stack" style={{ gap: 8 }}>
            {result.guesses.map(g => (
              <div key={g.playerId} className="player-row">
                <div className="row" style={{ gap: 8, alignItems: "center" }}>
                  <span className="roster-avatar" aria-hidden="true"><img className="emoji-img" src={emojiUrl(g.emoji)} alt="" /></span>
                  <strong>{g.name}</strong>
                  <span className="muted">{formatDistance(g.distanceKm)}</span>
                </div>
                {isHpMode ? (
                  <strong style={{ color: "var(--danger)" }}>-{g.damage?.toLocaleString()} HP</strong>
                ) : (
                  <strong>+{g.points.toLocaleString()}</strong>
                )}
              </div>
            ))}
          </div>

          <div className="stack" style={{ gap: 8 }}>
            <strong className="muted">{t("Standings")} {isHpMode ? "(Здоровье)" : "(Очки)"}</strong>
            {state.players.map(p => {
              const hpPercent = Math.max(0, Math.min(100, (p.hp / 5000) * 100));
              return (
                <div key={p.id} className="player-row" style={{ flexDirection: "column", alignItems: "stretch", gap: 8 }}>
                  <div className="row" style={{ justifyContent: "space-between" }}>
                    <div className="row" style={{ gap: 8 }}>
                      <span className="roster-avatar" aria-hidden="true"><img className="emoji-img" src={emojiUrl(p.emoji)} alt="" /></span>
                      <span>{p.name} {p.id === state.youId && <span className="badge">{t("you")}</span>}</span>
                    </div>
                    {isHpMode ? (
                      <strong style={{ display: 'flex', gap: 6, alignItems: 'center' }}>
                        ❤ <AnimatedNumber value={p.hp} />
                      </strong>
                    ) : (
                      <strong><AnimatedNumber value={p.totalScore} /></strong>
                    )}
                  </div>
                  {isHpMode && (
                    <div className="hp-bar-bg">
                      <div className="hp-bar-fill" style={{ width: `${hpPercent}%`, background: hpPercent > 25 ? '#10b981' : '#ef4444' }} />
                    </div>
                  )}
                </div>
              );
            })}
          </div>

          {state.youAreGameMaster ? (
            <button type="button" onClick={onNext}>{isLast ? t("See final scores") : t("Next round")}</button>
          ) : (
            <p className="muted">{t("Waiting for the host to continue…")}</p>
          )}
        </div>
      </div>
    </div>
  );
}