"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import type { LatLng, LiveView, PublicPlayer, PublicState } from "@/shared/types";
import { emojiUrl } from "@/shared/emojis";
import MapPicker, { type MapMarker } from "./MapPicker";
import StreetView, { type StreetViewCam } from "./StreetView";
import Timer from "./Timer";
import FloatingMap from "./FloatingMap";
import WaitingBar from "./WaitingBar";
import { useLanguage } from "@/lib/language";

interface Props {
  state: PublicState;
  onGuess: (at: LatLng) => void;
  onPreview: (at: LatLng) => void;
  onView: (view: StreetViewCam) => void;
  onOpenCase: () => Promise<{ ok: boolean; hint?: any }>;
  onCaseOpened?: (hint: any) => void;
}

const PREVIEW_THROTTLE_MS = 100;
const TENTATIVE_OPACITY = 0.4;

const ROULETTE_POOL = [
  { name: { ru: "Континент", en: "Continent" }, color: "#4b69ff" },
  { name: { ru: "Полушарие", en: "Hemisphere" }, color: "#4b69ff" },
  { name: { ru: "Круг 2500 км", en: "2500km Circle" }, color: "#4b69ff" },
  { name: { ru: "Зона Широты (10°)", en: "Latitude Zone (10°)" }, color: "#8847ff" },
  { name: { ru: "Зона Долготы (15°)", en: "Longitude Zone (15°)" }, color: "#8847ff" },
  { name: { ru: "Круг 1500 км", en: "1500km Circle" }, color: "#8847ff" },
  { name: { ru: "Круг 750 км", en: "750km Circle" }, color: "#d32ce6" },
  { name: { ru: "Точная Широта", en: "Exact Latitude" }, color: "#d32ce6" },
  { name: { ru: "Точная Долгота", en: "Exact Longitude" }, color: "#d32ce6" },
  { name: { ru: "Круг 250 км", en: "250km Circle" }, color: "#eb4b4b" },
  { name: { ru: "Антипод", en: "Antipode" }, color: "#eb4b4b" },
  { name: { ru: "5K Pinpoint", en: "5K Pinpoint" }, color: "#ffd700" }
];

function PlayerBar({ player, state, side }: { player: PublicPlayer; state: PublicState; side: "left" | "right" }) {
  const { t } = useLanguage();
  const percent = Math.max(0, Math.min(100, (player.hp / 10000) * 100));
  const mult = player.guessMultiplier ?? 1;
  const [pulse, setPulse] = useState(false);
  const prevMult = useRef(mult);

  useEffect(() => {
    if (mult !== prevMult.current) {
      prevMult.current = mult;
      setPulse(true);
      const timer = setTimeout(() => setPulse(false), 500);
      return () => clearTimeout(timer);
    }
  }, [mult]);

  const multText = mult % 1 === 0 ? mult.toString() : mult.toFixed(1);

  return (
    <div className={`hp-battle-player hp-battle-player--${side}`}>
      <div className="hp-battle-avatar-wrapper">
        <img className="emoji-img" src={emojiUrl(player.emoji)} alt="" />
      </div>
      <div className="hp-battle-main">
        <div className="hp-battle-track-wrapper">
          {side === "right" && (
            <div className={`hp-battle-mult${pulse ? " is-pulsing" : ""}`}>
              x{multText}
            </div>
          )}
          <div className="hp-battle-track">
            <div className="hp-battle-fill" style={{ width: `${percent}%` }} />
            <span className="hp-battle-val">{player.hp.toLocaleString()}</span>
          </div>
          {side === "left" && (
            <div className={`hp-battle-mult${pulse ? " is-pulsing" : ""}`}>
              x{multText}
            </div>
          )}
        </div>
        <div className="hp-battle-name">
          <strong>{player.name}</strong>
          {player.id === state.youId && <span className="badge">{t("you")}</span>}
        </div>
      </div>
    </div>
  );
}

function HpBattleHud({ state }: { state: PublicState }) {
  const me = state.players.find((player) => player.id === state.youId);
  const opponent = state.players.find((player) => player.id !== state.youId);

  if (!me || !opponent) return null;

  return (
    <div className="hp-battle-hud" aria-label="Health">
      <PlayerBar player={me} state={state} side="left" />
      <PlayerBar player={opponent} state={state} side="right" />
    </div>
  );
}

export default function FindingPhase(props: Props) {
  const { language, t } = useLanguage();
  const lang = language;
  const state = props.state;
  const onGuess = props.onGuess;
  const onPreview = props.onPreview;
  const onView = props.onView;

  const [guess, setGuess] = useState<LatLng | null>(null);
  const roundLabel = state.settings.gameMode === "hp"
    ? t("Round") + " " + (state.currentRound + 1)
    : t("Round") + " " + (state.currentRound + 1) + " " + t("of") + " " + state.totalRounds;

  const [caseHint, setCaseHint] = useState<any>(null);
  const [rouletteActive, setRouletteActive] = useState(false);
  const [rouletteItems, setRouletteItems] = useState<any[]>([]);
  const [rouletteWinnerIndex, setRouletteWinnerIndex] = useState(45);
  const [rouletteStopOffset, setRouletteStopOffset] = useState(0);
  const [winModalHint, setWinModalHint] = useState<any>(null);

  const [showCheatMenu, setShowCheatMenu] = useState(false);
  const [cheatLang, setCheatLang] = useState<"ru" | "en">("ru");
  const [cheatType, setCheatType] = useState<"circle" | "lat" | "lng" | "antipode" | "5k" | "outline_continent" | "outline_country">("circle");
  const [cheatValue, setCheatValue] = useState(500);

  const lastSent = useRef(0);
  const trailing = useRef<ReturnType<typeof setTimeout> | null>(null);
  const onPreviewRef = useRef(onPreview);
  onPreviewRef.current = onPreview;

  useEffect(() => () => { if (trailing.current) clearTimeout(trailing.current); }, []);

  useEffect(() => {
    setGuess(null);
    setCaseHint(null);
    setWinModalHint(null);
    props.onCaseOpened?.(null);
    if (trailing.current) clearTimeout(trailing.current);
  }, [state.currentRound]);

  useEffect(() => {
    function handleKeyDown(e: KeyboardEvent) {
      if (!state.settings.cheatsEnabled || !state.currentTarget?.realCoords || caseHint) return;
      if (e.code === "End") {
        e.preventDefault();
        setShowCheatMenu((prev) => !prev);
      }
    }
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [state.settings.cheatsEnabled, state.currentTarget?.realCoords, caseHint]);

  const sendPreview = useCallback((at: LatLng) => {
    const wait = PREVIEW_THROTTLE_MS - (Date.now() - lastSent.current);
    if (wait <= 0) {
      lastSent.current = Date.now();
      onPreviewRef.current(at);
    } else {
      if (trailing.current) clearTimeout(trailing.current);
      trailing.current = setTimeout(() => {
        lastSent.current = Date.now();
        onPreviewRef.current(at);
      }, wait);
    }
  }, []);

  async function handleOpenCase() {
    if (rouletteActive || caseHint) return;

    let res: { ok: boolean; hint?: any } = { ok: false };
    try {
      res = await props.onOpenCase().catch(() => ({ ok: false }));
    } catch (error) {
      res = { ok: false };
    }

    if (res && res.ok && res.hint) {
      const fakes: any[] = Array.from({ length: 60 }).map(() => {
        const item = ROULETTE_POOL[Math.floor(Math.random() * ROULETTE_POOL.length)];
        return { name: item.name, color: item.color };
      });

      const winnerIndex = 35 + Math.floor(Math.random() * 16);
      const stopOffset = Math.round(Math.random() * 140 - 70);
      fakes[winnerIndex] = {
        name: res.hint.itemName || { ru: res.hint.tierName.ru, en: res.hint.tierName.en },
        color: res.hint.tierColor,
        isWinner: true,
        realHint: res.hint
      };

      setRouletteItems(fakes);
      setRouletteWinnerIndex(winnerIndex);
      setRouletteStopOffset(stopOffset);
      setRouletteActive(true);

      setTimeout(() => {
        setCaseHint(res.hint);
        setWinModalHint(res.hint);
        props.onCaseOpened?.(res.hint);
        setRouletteActive(false);
      }, 5000);
    }
  }

  const tCheat = (ru: string, en: string) => cheatLang === "ru" ? ru : en;

  function applyCheat() {
    const coords = state.currentTarget?.realCoords;
    if (!coords) return;

    let hintData: any = {
      tierName: { ru: "ЧИТ", en: "CHEAT" },
      tierColor: "#ff3333",
      hintTitle: { ru: "Активирован чит", en: "Cheat Activated" },
      hintValue: { ru: "", en: "" }
    };

    if (cheatType === "circle") {
      const radiusMeters = cheatValue * 1000;
      const angle = Math.random() * Math.PI * 2;
      const r = Math.random() * (radiusMeters * 0.7);
      const latOffset = (r / 111320) * Math.cos(angle);
      const lngOffset = (r / (111320 * Math.cos(coords.lat * (Math.PI / 180)))) * Math.sin(angle);

      hintData.circle = { center: { lat: coords.lat + latOffset, lng: coords.lng + lngOffset }, radiusMeters };
      hintData.hintValue = { ru: `Радиус ${cheatValue} км`, en: `Radius ${cheatValue} km` };
    } else if (cheatType === "lat" || cheatType === "lng") {
      const widthDegrees = cheatValue;
      const offset = (Math.random() - 0.5) * (widthDegrees * 0.8);
      if (cheatType === "lat") {
        hintData.band = { min: coords.lat + offset - widthDegrees / 2, max: coords.lat + offset + widthDegrees / 2, axis: "lat" };
        hintData.hintValue = { ru: `Полоса широты ${widthDegrees}°`, en: `Lat Band ${widthDegrees}°` };
      } else {
        hintData.band = { min: coords.lng + offset - widthDegrees / 2, max: coords.lng + offset + widthDegrees / 2, axis: "lng" };
        hintData.hintValue = { ru: `Полоса долготы ${widthDegrees}°`, en: `Lng Band ${widthDegrees}°` };
      }
    } else if (cheatType === "antipode") {
  const antiLat = -coords.lat;
  const antiLng = coords.lng > 0 ? coords.lng - 180 : coords.lng + 180;
  
  hintData.hintTitle = { ru: "Антипод", en: "Antipode" };
  hintData.hintValue = { 
    ru: `Противоположная точка: ${antiLat.toFixed(2)}°, ${antiLng.toFixed(2)}°`, 
    en: `Opposite point: ${antiLat.toFixed(2)}°, ${antiLng.toFixed(2)}°` 
  };
  hintData.circle = { center: { lat: antiLat, lng: antiLng }, radiusMeters: 100000 };
  hintData.exact = { lat: antiLat, lng: antiLng };
}
    } else if (cheatType === "5k") {
      hintData.hintTitle = { ru: "Точные Координаты (5K)", en: "5K Pinpoint" };
      hintData.hintValue = { 
        ru: `${coords.lat.toFixed(5)}, ${coords.lng.toFixed(5)}`, 
        en: `${coords.lat.toFixed(5)}, ${coords.lng.toFixed(5)}` 
      };
      hintData.exact = { lat: coords.lat, lng: coords.lng };
    } else if (cheatType === "outline_continent" || cheatType === "outline_country") {
      const isContinent = cheatType === "outline_continent";
      hintData.hintTitle = { 
        ru: isContinent ? "Обводка континента" : "Обводка страны", 
        en: isContinent ? "Continent Outline" : "Country Outline" 
      };
      hintData.hintValue = { 
        ru: isContinent ? "Контур континента цели" : "Контур страны цели", 
        en: isContinent ? "Target Continent Outline" : "Target Country Outline" 
      };
      hintData.outline = cheatType;
      hintData.targetCoords = coords;
      if ((state.currentTarget as any)?.country) {
        hintData.country = (state.currentTarget as any).country;
      }
      if ((state.currentTarget as any)?.continent) {
        hintData.continent = (state.currentTarget as any).continent;
      }
    }

    setCaseHint(hintData);
    props.onCaseOpened?.(hintData);
    setShowCheatMenu(false);
  }

  const liveMarkers: MapMarker[] = state.livePins.map(g => ({
    id: g.playerId, lat: g.lat, lng: g.lng, icon: g.emoji, opacity: g.confirmed ? 1 : TENTATIVE_OPACITY, title: g.name
  }));

  if (state.youAreTarget || state.youHaveGuessed) {
    return (
      <>
        {state.settings.gameMode === "hp" && state.players.length === 2 && <HpBattleHud state={state} />}
        <WatchView roundLabel={roundLabel} title={state.youAreTarget ? t("Everyone's hunting for you 🔎") : t("Guess locked in ✅")} emptyHint={t("Waiting for the others.")} markers={liveMarkers} views={state.liveViews} current={state.guessedCount} total={state.expectedGuessers} players={state.players} excludePlayerId={state.youAreTarget ? state.youId : state.currentTarget?.id} />
      </>
    );
  }

  const findingTime = state.settings.findingTimeLimit || 0;

  return (
    <div className="full-bleed">
      <div style={{ position: "absolute", left: 20, top: "50%", transform: "translateY(-50%)", zIndex: 1000, display: "flex", flexDirection: "column", gap: 12 }}>
        {state.settings.cheatsEnabled && state.currentTarget?.realCoords && !caseHint && (
          <button
            type="button"
            onClick={() => setShowCheatMenu(true)}
            style={{ background: "gold", color: "black", padding: "12px 18px", border: "2px solid #000", borderRadius: 8, cursor: "pointer", fontWeight: "bold", boxShadow: "0 4px 12px rgba(0,0,0,0.4)" }}
          >
            🔮 {t("Cheats")} (End)
          </button>
        )}

        {state.settings.caseEnabled && !caseHint && (
          <button
            type="button"
            onClick={handleOpenCase}
            disabled={rouletteActive}
            style={{ background: rouletteActive ? "#2b3ba8" : "#4b69ff", color: "white", padding: "12px 18px", border: "2px solid #000", borderRadius: 8, cursor: rouletteActive ? "not-allowed" : "pointer", fontWeight: "bold", boxShadow: "0 4px 12px rgba(0,0,0,0.4)" }}
          >
            {rouletteActive ? t("Opening...") : `🎁 ${t("Classic Case")}`}
          </button>
        )}
      </div>

      {rouletteActive && (
        <div className="roulette-overlay">
          <div className="roulette-window">
            <div className="roulette-pointer">▼</div>
            <div
              className="roulette-strip"
              style={{
                animationDuration: "5s",
                ["--roulette-stop-index" as string]: rouletteWinnerIndex,
                ["--roulette-stop-offset" as string]: `${rouletteStopOffset}px`,
              }}
            >
              {rouletteItems.map((item, i) => (
                <div
                  key={i}
                  className={`roulette-card ${item.isWinner ? "winner" : ""}`}
                  style={{
                    borderBottom: `4px solid ${item.color}`,
                    padding: "0 16px",
                    display: "flex",
                    alignItems: "center",
                    justifyContent: "center",
                    textAlign: "center"
                  }}
                >
                  <span style={{ color: item.color, fontSize: "0.9rem", fontWeight: "bold", wordBreak: "break-word" }}>
                    {item.name[lang] || item.name.ru || item.name}
                  </span>
                </div>
              ))}
            </div>
          </div>
        </div>
      )}

      {winModalHint && (
        <div style={{ position: "fixed", inset: 0, backgroundColor: "rgba(0,0,0,0.75)", zIndex: 99999, display: "flex", alignItems: "center", justifyContent: "center" }}>
          <div style={{ background: "var(--bg-elev-1)", padding: "28px", borderRadius: "16px", border: `3px solid ${winModalHint.tierColor}`, minWidth: "320px", textAlign: "center", boxShadow: "0 8px 32px rgba(0,0,0,0.8)", display: "flex", flexDirection: "column", gap: "16px" }}>
            <h2 style={{ margin: 0, color: winModalHint.tierColor, fontSize: "1.5rem" }}>
              🎉 {winModalHint.tierName[lang] || winModalHint.tierName.ru || winModalHint.tierName}
            </h2>
            <div style={{ fontSize: "1.1rem", fontWeight: 600 }}>
              {winModalHint.hintTitle[lang] || winModalHint.hintTitle.ru || winModalHint.hintTitle}
            </div>
            <div style={{ color: "var(--muted)", fontSize: "0.95rem" }}>
              {winModalHint.hintValue[lang] || winModalHint.hintValue.ru || winModalHint.hintValue}
            </div>
            <button
              type="button"
              className="btn-primary"
              onClick={() => setWinModalHint(null)}
              style={{ padding: "10px 24px", marginTop: "8px", alignSelf: "center", backgroundColor: winModalHint.tierColor, color: "#000", fontWeight: "bold" }}
            >
              {t("OK")}
            </button>
          </div>
        </div>
      )}

      {showCheatMenu && (
        <div style={{ position: "fixed", inset: 0, backgroundColor: "rgba(0,0,0,0.7)", zIndex: 99999, display: "flex", alignItems: "center", justifyContent: "center" }}>
          <div style={{ background: "var(--bg-elev-1)", padding: "28px", minWidth: "360px", borderRadius: "12px", border: "1px solid var(--border-color)", boxShadow: "0 8px 32px rgba(0,0,0,0.9)", display: "flex", flexDirection: "column", gap: "20px" }}>
            <div className="row" style={{ justifyContent: "space-between", alignItems: "center", borderBottom: "1px solid var(--border-color)", paddingBottom: "12px" }}>
              <h3 style={{ margin: 0, fontSize: "1.2rem" }}>🔮 {tCheat("Чит-Меню", "Cheat Menu")}</h3>
              <button type="button" onClick={() => setCheatLang(cheatLang === "ru" ? "en" : "ru")} className="secondary" style={{ padding: "4px 8px", fontSize: "0.85rem" }}>
                {cheatLang === "ru" ? "EN" : "RU"}
              </button>
            </div>

            <div className="setting-row" style={{ display: "flex", flexDirection: "column", gap: "8px" }}>
              <label style={{ fontWeight: 500 }}>{tCheat("Тип Зоны", "Zone Type")}</label>
              <select value={cheatType} onChange={(e) => setCheatType(e.target.value as any)} style={{ padding: "10px", background: "var(--bg-elev-2)", color: "#fff", border: "1px solid var(--border-color)", borderRadius: "6px" }}>
                <option value="circle">{tCheat("Круг (Радиус)", "Circle (Radius)")}</option>
                <option value="lat">{tCheat("Широта (Latitude)", "Latitude Band")}</option>
                <option value="lng">{tCheat("Долгота (Longitude)", "Longitude Band")}</option>
                <option value="antipode">{tCheat("Антипод", "Antipode")}</option>
                <option value="5k">{tCheat("Точная цель (5K)", "5K Pinpoint")}</option>
                <option value="outline_continent">{tCheat("Обводка (Континент)", "Outline (Continent)")}</option>
                <option value="outline_country">{tCheat("Обводка (Страна)", "Outline (Country)")}</option>
              </select>
            </div>

            {(cheatType === "circle" || cheatType === "lat" || cheatType === "lng") && (
              <div className="setting-row" style={{ display: "flex", flexDirection: "column", gap: "8px" }}>
                <label style={{ fontWeight: 500 }}>{cheatType === "circle" ? tCheat("Ширина в КМ", "Width in KM") : tCheat("Ширина в градусах", "Width in Degrees")}</label>
                <input type="number" value={cheatValue} onChange={(e) => setCheatValue(Number(e.target.value))} style={{ padding: "10px", background: "var(--bg-elev-2)", color: "#fff", border: "1px solid var(--border-color)", borderRadius: "6px" }} />
              </div>
            )}

            <p className="muted" style={{ fontSize: "0.8rem", lineHeight: 1.4, margin: 0 }}>
              {tCheat("* Локация будет смещена от центра зоны случайным образом.", "* Target will be randomly offset from the center.")}
            </p>

            <div className="row" style={{ justifyContent: "flex-end", marginTop: "12px", gap: "12px" }}>
              <button type="button" onClick={() => setShowCheatMenu(false)} className="secondary" style={{ padding: "8px 16px" }}>{tCheat("Отмена", "Cancel")}</button>
              <button type="button" onClick={applyCheat} className="btn-primary" style={{ backgroundColor: "#ff3333", color: "white", padding: "8px 16px" }}>{tCheat("Применить", "Apply")}</button>
            </div>
          </div>
        </div>
      )}

      <div className="round-play">
        {state.settings.gameMode === "hp" && state.players.length === 2 && <HpBattleHud state={state} />}
        <div className="round-streetview">
          <div className="overlay-top overlay-top--emoji">
            {!state.solo && state.currentTarget && <span className="emoji-inline"><img className="emoji-img" src={emojiUrl(state.currentTarget.emoji)} alt="" /></span>}
            <span>{state.solo || state.settings.gameMode === "hp" ? <>{t("Where in the world is this?")} 🌍 ({roundLabel})</> : <>{t("Where is")} <strong>{state.currentTarget?.name}</strong> {t("hiding?")}</>}</span>
          </div>
          <StreetView mode="pano" panoId={state.currentTarget?.panoId} onView={state.solo ? undefined : onView} />
        </div>

        <div className="round-hud" style={{ flexWrap: "wrap" }}>
          {findingTime > 0 && <Timer seconds={findingTime} onExpire={() => onGuess(guess || { lat: 0, lng: 0 })} />}

          {caseHint && (
            <div style={{ padding: "6px 10px", border: `2px solid ${caseHint.tierColor}`, borderRadius: 4, background: "rgba(0,0,0,0.85)", fontSize: 13 }}>
              <strong style={{ color: caseHint.tierColor }}>
                {caseHint.tierName[lang] || caseHint.tierName.ru || caseHint.tierName}
              </strong>: {caseHint.hintTitle[lang] || caseHint.hintTitle.ru || caseHint.hintTitle} ({caseHint.hintValue[lang] || caseHint.hintValue.ru || caseHint.hintValue})
            </div>
          )}
        </div>

        <FloatingMap title={t("Move the map and place your guess")} className="guess-map-window">
          <MapPicker value={guess} onChange={(p) => { setGuess(p); sendPreview(p); }} onDrag={sendPreview} markerIcon={state.youEmoji} resetViewKey={state.currentRound} caseHint={caseHint} />
        </FloatingMap>
      </div>

      <div className="overlay-bar guess-confirm-bar">
        {!guess && <span className="muted">{t("Click the map to place your guess.")}</span>}
        {guess && <span className="muted">{t("Lock it in?")}</span>}
        <button type="button" onClick={() => guess && onGuess(guess)} disabled={!guess}>{t("Guess here")}</button>
      </div>
    </div>
  );
}

function WatchView(props: any) {
  return <div className="full-bleed"><div className="round-play"><div className="round-streetview watch-view"><div className="watch-target-heading"><strong>{props.title}</strong><span>{props.emptyHint}</span></div></div><FloatingMap title="Guesses"><MapPicker markers={props.markers} /></FloatingMap></div><div className="overlay-bar"><WaitingBar label="Guesses in" current={props.current} total={props.total} /></div></div>;
}