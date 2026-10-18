"use client";

import { useCallback, useEffect, useRef, useState, useMemo } from "react";
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
  onShareCaseHint?: (hint: any) => void;
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

// Продвинутый режим наблюдения за другими (Демка)
function WatchView({
  roundLabel,
  title,
  emptyHint,
  markers,
  views,
  current,
  total,
  players,
  excludePlayerId,
  state
}: {
  roundLabel: string;
  title: string;
  emptyHint: string;
  markers: MapMarker[];
  views: LiveView[];
  current: number;
  total: number;
  players: PublicPlayer[];
  excludePlayerId?: string;
  state: PublicState;
}) {
  const { t } = useLanguage();
  const [activeId, setActiveId] = useState<string | null>(null);
  const [watchRoulette, setWatchRoulette] = useState(false);
  const [watchedCaseHint, setWatchedCaseHint] = useState<any>(null);

  const availableHunters = players.filter(p => p.id !== excludePlayerId && p.connected);

  useEffect(() => {
    if (!activeId && availableHunters.length > 0) {
      setActiveId(availableHunters[0].id);
    } else if (activeId && !availableHunters.find(h => h.id === activeId)) {
      setActiveId(availableHunters.length > 0 ? availableHunters[0].id : null);
    }
  }, [activeId, availableHunters]);

  const activeView = views.find(v => v.playerId === activeId);
  
  const fallbackView = useMemo(() => {
    if (!state.currentTarget) return null;
    return {
      panoId: state.currentTarget.panoId,
      heading: state.currentTarget.heading || 0,
      pitch: state.currentTarget.pitch || 0,
      zoom: 1
    };
  }, [state.currentTarget]);

  const viewToRender = activeView || fallbackView;

  useEffect(() => {
    if (!state.liveCase) return;
    setWatchRoulette(true);
    setWatchedCaseHint(null);
    const timer = window.setTimeout(() => {
      setWatchRoulette(false);
      setWatchedCaseHint(state.liveCase?.hint ?? null);
    }, 5000);
    return () => window.clearTimeout(timer);
  }, [state.liveCase]);

  const watchedRouletteItems = useMemo(() => {
    if (!state.liveCase) return [];
    return Array.from({ length: 60 }, (_, index) => ({
      name: index === 45
        ? state.liveCase!.hint.itemName
        : ROULETTE_POOL[index % ROULETTE_POOL.length].name,
      color: index === 45
        ? state.liveCase!.hint.tierColor
        : ROULETTE_POOL[index % ROULETTE_POOL.length].color,
      isWinner: index === 45,
    }));
  }, [state.liveCase]);

  return (
    <div className="full-bleed">
      <div className="round-play">
        <div className="round-streetview watch-view">
          
          <div className="watch-target-heading" style={{ zIndex: 10 }}>
            <strong>{title}</strong>
            <span>{emptyHint}</span>
          </div>

          {viewToRender ? (
            <StreetView
              // Ключ принудительно перерисовывает панораму при смене игрока или локации в демке
              key={activeId ? `view-${activeId}-${viewToRender.panoId}` : `fallback-${viewToRender.panoId}`}
              mode="pano"
              panoId={viewToRender.panoId}
              follow={viewToRender}
              interactive={false}
            />
          ) : (
            <div className="hiding-preview-prompt">
              {availableHunters.length > 0
                ? t("Loading hunter's Street View…")
                : emptyHint}
            </div>
          )}

          {watchRoulette && (
            <div className="roulette-overlay">
              <div className="roulette-window">
                <div className="roulette-pointer">▼</div>
                <div
                  className="roulette-strip"
                  style={{
                    animationDuration: "5s",
                    ["--roulette-stop-index" as string]: 45,
                    ["--roulette-stop-offset" as string]: "0px",
                  }}
                >
                  {watchedRouletteItems.map((item, index) => (
                    <div
                      key={index}
                      className={`roulette-card${item.isWinner ? " winner" : ""}`}
                      style={{ borderBottom: `4px solid ${item.color}` }}
                    >
                      <span style={{ color: item.color }}>
                        {item.name.ru || item.name.en}
                      </span>
                    </div>
                  ))}
                </div>
              </div>
            </div>
          )}
          
          <div className="roster" role="status" style={{ bottom: "20px", top: "auto" }}>
            <div className="roster-head">
              <span>{t("Watching")}</span>
            </div>
            <div className="roster-list">
              {availableHunters.map(p => {
                const isWatching = activeId === p.id;
                const hasGuessed = state.livePins.some(lp => lp.playerId === p.id && lp.confirmed) ||
                                   (state.result && state.result.guesses.some(g => g.playerId === p.id));
                
                return (
                  <button
                    key={p.id}
                    className={`roster-player ${hasGuessed ? "is-hidden" : "is-waiting"} ${isWatching ? "is-selected" : ""}`}
                    onClick={() => setActiveId(p.id)}
                    style={{
                      width: "100%", textAlign: "left", cursor: "pointer",
                      border: "none", background: isWatching ? "var(--bg-elev-2)" : "transparent"
                    }}
                  >
                    <span className="roster-avatar" aria-hidden="true">
                      <img className="emoji-img" src={emojiUrl(p.emoji)} alt="" />
                    </span>
                    <span className="roster-name">{p.name}</span>
                    <span className="roster-status">
                      {hasGuessed ? t("hidden") : isWatching ? t("Watching") : t("picking…")}
                    </span>
                  </button>
                );
              })}
            </div>
          </div>
        </div>

        <FloatingMap title={t("Guesses")} className="hiding-map-window">
          <MapPicker markers={markers} fitToContent={false} caseHint={watchedCaseHint} />
        </FloatingMap>
      </div>

      <div className="overlay-bar">
        <WaitingBar label={t("Guesses in") || "Guesses in"} current={current} total={total} />
      </div>
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
      const mirrorLat = -coords.lat;
      
      hintData.hintTitle = { ru: "Зеркало экватора", en: "Equator Mirror" };
      hintData.hintValue = { 
        ru: `Широта: ${mirrorLat.toFixed(2)}°, долгота без изменений: ${coords.lng.toFixed(2)}°`, 
        en: `Latitude: ${mirrorLat.toFixed(2)}°, longitude unchanged: ${coords.lng.toFixed(2)}°` 
      };
      hintData.circle = { center: { lat: mirrorLat, lng: coords.lng }, radiusMeters: 100000 };
      hintData.exact = { lat: mirrorLat, lng: coords.lng };
    } else if (cheatType === "5k") {
      hintData.hintTitle = { ru: "Точные координаты (5K)", en: "Exact Coordinates (5K)" };
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
    props.onShareCaseHint?.(hintData);
    setShowCheatMenu(false);
  }

  const liveMarkers: MapMarker[] = state.livePins.map(g => ({
    id: g.playerId, 
    lat: g.lat, 
    lng: g.lng, 
    icon: g.emoji, 
    opacity: g.confirmed ? 1 : TENTATIVE_OPACITY, 
    title: g.name
  }));

  if (state.youAreTarget && state.yourSpot) {
    liveMarkers.unshift({
      id: "my-hiding-spot",
      lat: state.yourSpot.lat,
      lng: state.yourSpot.lng,
      icon: state.youEmoji,
      opacity: 1,
      title: t("Your hiding spot"),
    });
  }

  if (state.youAreTarget || state.youHaveGuessed) {
    return (
      <>
        {state.settings.gameMode === "hp" && state.players.length === 2 && <HpBattleHud state={state} />}
        <WatchView 
          roundLabel={roundLabel} 
          title={state.youAreTarget ? t("Everyone's hunting for you 🔎") : t("Guess locked in ✅")} 
          emptyHint={t("Waiting for the others.")} 
          markers={liveMarkers} 
          views={state.liveViews} 
          current={state.guessedCount} 
          total={state.expectedGuessers} 
          players={state.players} 
          excludePlayerId={state.youAreTarget ? state.youId : state.currentTarget?.id} 
          state={state}
        />
      </>
    );
  }

  const baseFindingTime = state.settings.findingTimeLimit || 0;
  let urgentSecondsLeft: number | null = null;
  
  if (
    state.settings.gameMode === "hp" &&
    state.firstGuessTime !== null &&
    state.firstGuessTime !== undefined &&
    !state.youHaveGuessed
  ) {
    const elapsed = Math.floor((Date.now() - state.firstGuessTime) / 1000);
    urgentSecondsLeft = Math.max(0, 15 - elapsed);
  }
  
  const findingTime = urgentSecondsLeft !== null ? urgentSecondsLeft : baseFindingTime;

  return (
    <div className="full-bleed">
      <div style={{ position: "absolute", left: 20, top: "50%", transform: "translateY(-50%)", zIndex: 1000, display: "flex", flexDirection: "column", gap: 12 }}>
        {state.settings.cheatsEnabled && state.currentTarget?.realCoords && !caseHint && (
          <button
            type="button"
            onClick={() => setShowCheatMenu(true)}
            style={{ background: "gold", color: "black", padding: "12px 18px", border: "2px solid #000", borderRadius: 8, cursor: "pointer", fontWeight: "bold", boxShadow: "0 4px 12px rgba(0,0,0,0.4)" }}
          >
            🔮 {t("Cheats")}
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
                <option value="antipode">{tCheat("Зеркало экватора", "Equator Mirror")}</option>
                <option value="5k">{tCheat("Точные координаты (5K)", "Exact Coordinates (5K)")}</option>
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
          <StreetView 
            mode="pano" 
            panoId={state.currentTarget?.panoId} 
            onView={state.solo ? undefined : onView} 
          />
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
          <MapPicker 
            value={guess} 
            onChange={(p) => { setGuess(p); sendPreview(p); }} 
            onDrag={sendPreview} 
            markerIcon={state.youEmoji} 
            resetViewKey={state.currentRound} 
            caseHint={caseHint}
            markers={liveMarkers}
          />
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