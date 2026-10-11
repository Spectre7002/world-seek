"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import type { LatLng, LiveView, PublicPlayer, PublicState } from "@/shared/types";
import { emojiUrl } from "@/shared/emojis";
import MapPicker, { type MapMarker } from "./MapPicker";
import StreetView, { type StreetViewCam } from "./StreetView";
import PlayerList from "./PlayerList";
import WaitingBar from "./WaitingBar";
import Timer from "./Timer";
import FloatingMap from "./FloatingMap";
import { useLanguage } from "@/lib/language";

interface Props {
  state: PublicState;
  onGuess: (at: LatLng) => void;
  onPreview: (at: LatLng) => void;
  onView: (view: StreetViewCam) => void;
  onOpenCase: () => Promise<{ ok: boolean; hint?: any }>;
}

const PREVIEW_THROTTLE_MS = 100;
const TENTATIVE_OPACITY = 0.4;
const CS2_COLORS = ["#4b69ff", "#8847ff", "#d32ce6", "#eb4b4b", "#ffd700"];

export default function FindingPhase(props: Props) {
  const { t } = useLanguage();
  const state = props.state;
  const onGuess = props.onGuess;
  const onPreview = props.onPreview;
  const onView = props.onView;

  const [guess, setGuess] = useState<LatLng | null>(null);
  const roundLabel = t("Round") + " " + (state.currentRound + 1) + " " + t("of") + " " + state.totalRounds;
  
  // Case & Roulette States
  const [caseHint, setCaseHint] = useState<any>(null);
  const [rouletteActive, setRouletteActive] = useState(false);
  const [rouletteItems, setRouletteItems] = useState<any[]>([]);

  // Cheat Menu States
  const [showCheatMenu, setShowCheatMenu] = useState(false);
  const [cheatLang, setCheatLang] = useState<"ru" | "en">("ru");
  const [cheatType, setCheatType] = useState<"circle" | "lat" | "lng">("circle");
  const [cheatValue, setCheatValue] = useState(500); // km или градусы

  const lastSent = useRef(0);
  const trailing = useRef<ReturnType<typeof setTimeout> | null>(null);
  const onPreviewRef = useRef(onPreview);
  onPreviewRef.current = onPreview;

  useEffect(() => () => { if (trailing.current) clearTimeout(trailing.current); }, []);

  useEffect(() => {
    setGuess(null);
    setCaseHint(null);
    if (trailing.current) clearTimeout(trailing.current);
  }, [state.currentRound]);

  // Глобальный слушатель комбинации клавиш (Alt+C) для читов
  useEffect(() => {
    function handleKeyDown(e: KeyboardEvent) {
      if (!state.settings.cheatsEnabled || !state.currentTarget?.realCoords || caseHint) return;

      if (e.altKey && e.code === "KeyC") {
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

  // --- CS2 ROULETTE LOGIC ---
  async function handleOpenCase() {
    if (rouletteActive || caseHint) return;
    
    const fakes = Array.from({ length: 60 }).map(() => ({
      name: "?",
      color: CS2_COLORS[Math.floor(Math.random() * CS2_COLORS.length)]
    }));
    
    setRouletteItems(fakes);
    setRouletteActive(true);

    try {
      let res = await props.onOpenCase().catch(() => ({ ok: false }));
      
      if ((!res || !res.ok) && state.solo) {
        const coords = state.currentTarget?.realCoords || { lat: 0, lng: 0 };
        const tierIndex = Math.random() > 0.8 ? 2 : 0; 
        const radiusMeters = tierIndex === 2 ? 500000 : 2500000;
        const angle = Math.random() * Math.PI * 2;
        const r = radiusMeters * 0.5;
        
        const latOffset = (r / 111320) * Math.cos(angle);
        const lngOffset = (r / (111320 * Math.cos(coords.lat * (Math.PI/180)))) * Math.sin(angle);

        res = {
          ok: true,
          hint: {
            tierName: tierIndex === 2 ? "Classified" : "Mil-Spec",
            tierColor: CS2_COLORS[tierIndex],
            hintTitle: "Зона поиска",
            hintValue: `Радиус ${radiusMeters / 1000} км`,
            circle: { 
              center: { lat: coords.lat + latOffset, lng: coords.lng + lngOffset }, 
              radiusMeters: radiusMeters 
            }
          }
        };
      }

      if (res && res.ok && res.hint) {
        fakes[45] = { name: res.hint.tierName, color: res.hint.tierColor, isWinner: true, realHint: res.hint };
        setRouletteItems([...fakes]);
        
        setTimeout(() => {
          setCaseHint(res.hint);
          setRouletteActive(false);
        }, 6500);
      } else {
        setRouletteActive(false);
      }
    } catch (error) {
      console.error("Failed to open case:", error);
      setRouletteActive(false);
    }
  }

  // --- CHEAT MENU LOGIC ---
  const tCheat = (ru: string, en: string) => cheatLang === "ru" ? ru : en;
  
  function applyCheat() {
    const coords = state.currentTarget?.realCoords;
    if (!coords) return;
    
    let hintData: any = { tierName: "CHEAT", tierColor: "#00ff00", hintTitle: "Cheat Activated", hintValue: "" };
    
    if (cheatType === "circle") {
      const radiusMeters = cheatValue * 1000;
      const angle = Math.random() * Math.PI * 2;
      const r = Math.random() * (radiusMeters * 0.7); 
      const latOffset = (r / 111320) * Math.cos(angle);
      const lngOffset = (r / (111320 * Math.cos(coords.lat * (Math.PI/180)))) * Math.sin(angle);
      
      hintData.circle = { center: { lat: coords.lat + latOffset, lng: coords.lng + lngOffset }, radiusMeters };
      hintData.hintValue = `Radius ${cheatValue}km`;
    } else {
      const widthDegrees = cheatValue;
      const offset = (Math.random() - 0.5) * (widthDegrees * 0.8);
      if (cheatType === "lat") {
        hintData.band = { min: coords.lat + offset - widthDegrees/2, max: coords.lat + offset + widthDegrees/2, axis: "lat" };
        hintData.hintValue = `Lat Band ${widthDegrees}°`;
      } else {
        hintData.band = { min: coords.lng + offset - widthDegrees/2, max: coords.lng + offset + widthDegrees/2, axis: "lng" };
        hintData.hintValue = `Lng Band ${widthDegrees}°`;
      }
    }
    
    setCaseHint(hintData);
    setShowCheatMenu(false);
  }

  const liveMarkers: MapMarker[] = state.livePins.map(g => ({
    id: g.playerId, lat: g.lat, lng: g.lng, icon: g.emoji, opacity: g.confirmed ? 1 : TENTATIVE_OPACITY, title: g.name
  }));

  if (state.youAreTarget || state.youHaveGuessed) {
    return <WatchView roundLabel={roundLabel} title={state.youAreTarget ? t("Everyone's hunting for you 🔎") : t("Guess locked in ✅")} emptyHint={t("Waiting for the others.")} markers={liveMarkers} views={state.liveViews} current={state.guessedCount} total={state.expectedGuessers} players={state.players} excludePlayerId={state.youAreTarget ? state.youId : state.currentTarget?.id} />;
  }

  const findingTime = state.settings.findingTimeLimit || 0;

  return (
    <div className="full-bleed">
      {/* CS2 Roulette Overlay */}
      {rouletteActive && (
        <div className="roulette-overlay">
          <div className="roulette-window">
            <div className="roulette-pointer">▼</div>
            <div className="roulette-strip">
              {rouletteItems.map((item, i) => (
                <div key={i} className={`roulette-card ${item.isWinner ? 'winner' : ''}`} style={{ borderBottom: `4px solid ${item.color}` }}>
                  <span style={{ color: item.color }}>{item.name}</span>
                </div>
              ))}
            </div>
          </div>
        </div>
      )}

      {/* Cheat Menu Modal */}
      {showCheatMenu && (
        <div className="cheat-modal-overlay">
          <div className="cheat-modal card stack">
            <div className="row" style={{ justifyContent: "space-between" }}>
              <h3 style={{ margin: 0 }}>🔮 {tCheat("Чит-Меню", "Cheat Menu")}</h3>
              <button onClick={() => setCheatLang(cheatLang === "ru" ? "en" : "ru")} style={{ padding: "4px 8px" }}>
                {cheatLang === "ru" ? "EN" : "RU"}
              </button>
            </div>
            
            <div className="setting-row">
              <label>{tCheat("Тип Зоны", "Zone Type")}</label>
              <select value={cheatType} onChange={(e) => setCheatType(e.target.value as any)} style={{ padding: 6, background: "var(--bg-elev-2)", color: "#fff" }}>
                <option value="circle">{tCheat("Круг (Радиус)", "Circle (Radius)")}</option>
                <option value="lat">{tCheat("Широта (Latitude)", "Latitude Band")}</option>
                <option value="lng">{tCheat("Долгота (Longitude)", "Longitude Band")}</option>
              </select>
            </div>
            
            <div className="setting-row">
              <label>{cheatType === "circle" ? tCheat("Ширина в КМ", "Width in KM") : tCheat("Ширина в градусах", "Width in Degrees")}</label>
              <input type="number" value={cheatValue} onChange={(e) => setCheatValue(Number(e.target.value))} style={{ padding: 6, background: "var(--bg-elev-2)", color: "#fff" }} />
            </div>

            <p className="muted" style={{ fontSize: 12 }}>
              {tCheat("* Локация будет смещена от центра зоны случайным образом.", "* Target will be randomly offset from the center.")}
            </p>

            <div className="row" style={{ justifyContent: "flex-end", marginTop: 10 }}>
              <button onClick={() => setShowCheatMenu(false)} className="secondary">{tCheat("Отмена", "Cancel")}</button>
              <button onClick={applyCheat}>{tCheat("Применить", "Apply")}</button>
            </div>
          </div>
        </div>
      )}

      <div className="round-play">
        <div className="round-streetview">
          <div className="overlay-top overlay-top--emoji">
            {!state.solo && state.currentTarget && <span className="emoji-inline"><img className="emoji-img" src={emojiUrl(state.currentTarget.emoji)} alt="" /></span>}
            <span>{state.solo ? <>{t("Where in the world is this?")} 🌍 ({roundLabel})</> : <>{t("Where is")} <strong>{state.currentTarget?.name}</strong> {t("hiding?")}</>}</span>
          </div>
          <StreetView mode="pano" panoId={state.currentTarget?.panoId} onView={state.solo ? undefined : onView} />
        </div>

        <div className="round-hud" style={{ flexWrap: 'wrap' }}>
          <span>{roundLabel}</span>
          {findingTime > 0 && <Timer seconds={findingTime} onExpire={() => onGuess(guess || { lat: 0, lng: 0 })} />}
          
          {state.settings.gameMode === "hp" && !state.solo && (
            <div className="hp-indicator">❤ {state.players.find(p => p.id === state.youId)?.hp || 5000} HP</div>
          )}
          
          {state.settings.cheatsEnabled && state.currentTarget?.realCoords && !caseHint && (
            <button onClick={() => setShowCheatMenu(true)} style={{ background: "gold", color: "black", padding: "6px 12px", border: "none", borderRadius: 4, cursor: "pointer", fontWeight: "bold" }}>
              🔮 Чит (Alt+C)
            </button>
          )}
          
          {state.settings.caseEnabled && !caseHint && (
            <button onClick={handleOpenCase} disabled={rouletteActive} style={{ background: "#4b69ff", color: "white", padding: "6px 12px", border: "none", borderRadius: 4, cursor: "pointer", fontWeight: "bold" }}>
              {rouletteActive ? "Открываем..." : "🎁 Classic Case"}
            </button>
          )}

          {caseHint && (
            <div style={{ padding: "6px 10px", border: `2px solid ${caseHint.tierColor}`, borderRadius: 4, background: "rgba(0,0,0,0.85)", fontSize: 13 }}>
              <strong style={{ color: caseHint.tierColor }}>{caseHint.tierName}</strong>: {caseHint.hintTitle} ({caseHint.hintValue})
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
        <button onClick={() => guess && onGuess(guess)} disabled={!guess}>{t("Guess here")}</button>
      </div>
    </div>
  );
}

function WatchView(props: any) {
  return <div className="full-bleed"><div className="round-play"><div className="round-streetview watch-view"><div className="watch-target-heading"><strong>{props.title}</strong><span>{props.emptyHint}</span></div></div><FloatingMap title="Guesses"><MapPicker markers={props.markers} /></FloatingMap></div><div className="overlay-bar"><WaitingBar label="Guesses in" current={props.current} total={props.total} /></div></div>;
}