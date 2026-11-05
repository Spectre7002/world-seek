"use client";

import { useCallback, useEffect, useRef, useState, useMemo } from "react";
import type { LatLng, LiveView, PublicPlayer, PublicState } from "@/shared/types";
import { emojiUrl } from "@/shared/emojis";
import MapPicker, { type MapMarker } from "./MapPicker";
import StreetView, { type StreetViewCam } from "./StreetView";
import Timer from "./Timer";
import FloatingMap from "./FloatingMap";
import WaitingBar from "./WaitingBar";
import SpellBar from "./SpellBar";
import { useLanguage } from "@/lib/language";
import { useDialog } from "@/lib/useDialog";
import { totalSpells, type SpellId } from "@/shared/spells";

interface Props {
  state: PublicState;
  onGuess: (at: LatLng) => void;
  onPreview: (at: LatLng) => void;
  onView: (view: StreetViewCam) => void;
  onOpenCase: () => Promise<{ ok: boolean; hint?: any }>;
  onCaseOpened?: (hint: any) => void;
  onShareCaseHint?: (hint: any) => void;
  /**
   * Spend one spell from the server-owned inventory. Resolves with the new
   * case hint when the spell was a REROLL, so the opener can show it.
   */
  onSpellConsumed: (spell: SpellId) => Promise<{ ok: boolean; hint?: any }>;
  /** Cheat-menu helper: grant one of each spell. */
  onSpellsGranted: () => void;
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
  { name: { ru: "OMEN", en: "OMEN" }, color: "#8847ff" },
  { name: { ru: "COMPASS", en: "COMPASS" }, color: "#8847ff" },
  { name: { ru: "ARROW", en: "ARROW" }, color: "#d32ce6" },
  { name: { ru: "SCRY", en: "SCRY" }, color: "#d32ce6" },
  { name: { ru: "ECHO", en: "ECHO" }, color: "#d32ce6" },
  { name: { ru: "HEATMAP", en: "HEATMAP" }, color: "#d32ce6" },
  { name: { ru: "FREEZE", en: "FREEZE" }, color: "#eb4b4b" },
  { name: { ru: "REROLL", en: "REROLL" }, color: "#ffd700" },
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
  // Spectators have no seat and sit at a full 10,000 HP, so they must never be
  // picked as the duel opponent — otherwise a 2-player match with one watcher
  // shows the watcher's health instead of the real rival's.
  const seated = state.players.filter((player) => !player.spectator);
  const me = seated.find((player) => player.id === state.youId);
  const opponent = seated.find((player) => player.id !== state.youId);

  if (!me || !opponent) return null;

  return (
    <div className="hp-battle-hud" aria-label="Health">
      <PlayerBar player={me} state={state} side="left" />
      <PlayerBar player={opponent} state={state} side="right" />
    </div>
  );
}

/**
 * Compact HP board for HP matches with 3+ players. The duel HUD above only
 * knows how to show one opponent, so it is used for exactly two players; every
 * larger match gets this ranked list instead. Damage is shown as a floating
 * delta so a hit is visible even when the bar barely moves.
 */
function HpRoster({
  state,
  variant = "guess",
}: {
  state: PublicState;
  variant?: "guess" | "watch";
}) {
  const { t } = useLanguage();
  const prevHp = useRef<Map<string, number>>(new Map());
  const [deltas, setDeltas] = useState<Record<string, number>>({});

  // Spectators never played, so they have no health to show.
  const ranked = useMemo(
    () =>
      state.players
        .filter((p) => !p.spectator)
        .sort(
          (a, b) => b.hp - a.hp || (b.guessMultiplier ?? 1) - (a.guessMultiplier ?? 1),
        ),
    [state.players],
  );

  useEffect(() => {
    const next: Record<string, number> = {};
    let changed = false;
    for (const p of state.players) {
      const before = prevHp.current.get(p.id);
      if (before !== undefined && before > p.hp) {
        next[p.id] = before - p.hp;
        changed = true;
      }
      prevHp.current.set(p.id, p.hp);
    }
    if (!changed) return;
    setDeltas(next);
    const timer = setTimeout(() => setDeltas({}), 1200);
    return () => clearTimeout(timer);
  }, [state.players]);

  return (
    <div
      className={`hp-roster${variant === "watch" ? " hp-roster--watch" : ""}`}
      aria-label={t("Health")}
    >
      {ranked.map((p) => {
        const percent = Math.max(0, Math.min(100, (p.hp / 10000) * 100));
        const mult = p.guessMultiplier ?? 1;
        const multText = mult % 1 === 0 ? mult.toString() : mult.toFixed(1);
        const isMe = p.id === state.youId;
        const delta = deltas[p.id];
        return (
          <div
            key={p.id}
            className={`hp-roster-row${isMe ? " is-me" : ""}${
              p.hp <= 0 ? " is-out" : ""
            }${p.connected ? "" : " is-off"}`}
          >
            <span className="hp-roster-avatar">
              <img className="emoji-img" src={emojiUrl(p.emoji)} alt="" />
            </span>
            <div className="hp-roster-body">
              <div className="hp-roster-top">
                <span className="hp-roster-name">
                  {p.name}
                  {isMe && <span className="badge">{t("you")}</span>}
                </span>
                <span className="hp-roster-mult">x{multText}</span>
              </div>
              <div className="hp-roster-track">
                <div
                  className="hp-roster-fill"
                  style={{
                    width: `${percent}%`,
                    background: percent > 25 ? undefined : "#ef4444",
                  }}
                />
                <span className="hp-roster-val">{p.hp.toLocaleString()}</span>
              </div>
            </div>
            {delta ? (
              <span className="hp-roster-delta">-{delta.toLocaleString()}</span>
            ) : null}
          </div>
        );
      })}
    </div>
  );
}

/**
 * Picks the HP layout for the current match: the side-by-side duel HUD for two
 * players, the ranked roster for three or more. Renders nothing outside HP mode
 * or when fewer than two players are connected.
 *
 * `variant` only affects the roster: the watch view already uses the bottom-left
 * corner for its hunter roster, so the HP board moves to the top-right there.
 */
function HpHealthHud({
  state,
  variant = "guess",
}: {
  state: PublicState;
  variant?: "guess" | "watch";
}) {
  if (state.settings.gameMode !== "hp") return null;
  // Spectators have no seat and no health of their own, so they must not show
  // up in the HP board (they would appear at a full 10,000 HP).
  const connected = state.players.filter((p) => p.connected && !p.spectator);
  if (connected.length < 2) return null;
  if (connected.length === 2) return <HpBattleHud state={state} />;
  return <HpRoster state={state} variant={variant} />;
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
  const [activeSpell, setActiveSpell] = useState<SpellId | null>(null);
  const [lootedSpellTarget, setLootedSpellTarget] = useState<LatLng | null>(null);

  const [showCheatMenu, setShowCheatMenu] = useState(false);
  const [cheatType, setCheatType] = useState<"circle" | "lat" | "lng" | "antipode" | "5k" | "outline_continent" | "outline_country">("circle");
  const [cheatValue, setCheatValue] = useState(500);
  // Escape-to-close + focus trap for the two case/cheat dialogs.
  const winModalRef = useDialog<HTMLDivElement>(() => setWinModalHint(null), Boolean(winModalHint));
  const cheatMenuRef = useDialog<HTMLDivElement>(() => setShowCheatMenu(false), showCheatMenu);

  const lastSent = useRef(0);
  const trailing = useRef<ReturnType<typeof setTimeout> | null>(null);
  const onPreviewRef = useRef(onPreview);
  onPreviewRef.current = onPreview;

  useEffect(() => () => { if (trailing.current) clearTimeout(trailing.current); }, []);

  // Keyed on roundKey, not currentRound: in classic multiplayer currentRound is
  // the cycle index and does not change between targets, so keying on it left
  // the previous target's case hint on screen and kept the case button hidden
  // for the rest of the cycle.
  useEffect(() => {
    setGuess(null);
    setCaseHint(null);
    setWinModalHint(null);
    setActiveSpell(null);
    setLootedSpellTarget(null);
    props.onCaseOpened?.(null);
    if (trailing.current) clearTimeout(trailing.current);
  }, [state.roundKey]);

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
      // The server already added the spell to the inventory; the next state
      // broadcast carries the new count, so nothing to do here.
      if (res.hint.spellTarget) setLootedSpellTarget(res.hint.spellTarget);

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

  // The server sends the answer only to players who own a spell, so this works
  // in a normal game (not just with cheats on) and survives a refresh.
  const spellTarget = state.spellTarget ?? state.currentTarget?.realCoords ?? lootedSpellTarget;
  const spellCount = totalSpells(state.yourSpells);

  function handleSpellUsed(id: SpellId) {
    props.onSpellConsumed(id);
    setActiveSpell(null);
  }

  // Server spells (freeze / reroll) are applied by the server. FREEZE only
  // needs the charge spent; REROLL returns the replacement hint, which has to
  // replace the local case hint or the player would keep seeing the old one.
  async function handleServerSpell(id: SpellId) {
    const res: { ok: boolean; hint?: any } = await props
      .onSpellConsumed(id)
      .catch(() => ({ ok: false }));
    if (!res || !res.ok) return;
    if (id === "reroll" && res.hint) {
      setCaseHint(res.hint);
      setWinModalHint(res.hint);
      props.onCaseOpened?.(res.hint);
      if (res.hint.spellTarget) setLootedSpellTarget(res.hint.spellTarget);
    }
  }

  // FREEZE countdown. The server owns the deadline; this only renders it.
  const [frozenLeft, setFrozenLeft] = useState(0);
  useEffect(() => {
    const until = state.youFrozenUntil;
    if (!until) {
      setFrozenLeft(0);
      return;
    }
    const tick = () => setFrozenLeft(Math.max(0, Math.ceil((until - Date.now()) / 1000)));
    tick();
    const timer = window.setInterval(tick, 500);
    return () => window.clearInterval(timer);
  }, [state.youFrozenUntil]);
  const frozen = frozenLeft > 0;

  const tCheat = (ru: string, en: string) => language === "ru" ? ru : en;

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

  // A spectator has no seat: they watch the round without a guess map. The
  // server never sends them a target or a spell answer, so this is purely a
  // read-only view of the same live pins the target sees.
  if (state.youAreSpectator) {
    return (
      <>
        <HpHealthHud state={state} variant="watch" />
        <WatchView
          roundLabel={roundLabel}
          title={t("Spectating")}
          emptyHint={t("Waiting for the round to end...")}
          markers={liveMarkers}
          views={state.liveViews}
          current={state.guessedCount}
          total={state.expectedGuessers}
          players={state.players}
          excludePlayerId={state.currentTarget?.id}
          state={state}
        />
      </>
    );
  }

  if (state.youAreTarget || state.youHaveGuessed) {
    return (
      <>
        <HpHealthHud state={state} variant="watch" />
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

  // The HP "first guess in -> 15s for everyone else" rule is enforced on the
  // server, which shortens `deadlineAt` when the first guess lands. The timer
  // therefore just renders that deadline; recomputing a local 15s cap here
  // would be ignored anyway (Timer prefers `deadlineAt`) and could disagree
  // with the clock that actually ends the round.
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

        {/* Pity timer: a visible countdown to a guaranteed better tier. */}
        {state.settings.caseEnabled && state.casePity > 0 && (
          <div className="case-pity" title={t("Guaranteed better tier soon")}>
            🎯 {t("Pity")} {state.casePity}/{state.casePityMax}
          </div>
        )}

        {frozen && (
          <div className="freeze-banner" role="status">
            ❄️ {t("Frozen")} — {frozenLeft}s
          </div>
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
          <div ref={winModalRef} role="dialog" aria-modal="true" aria-label={winModalHint.tierName[lang] || winModalHint.tierName.ru || winModalHint.tierName} style={{ background: "var(--bg-elev-1)", padding: "28px", borderRadius: "16px", border: `3px solid ${winModalHint.tierColor}`, minWidth: "320px", textAlign: "center", boxShadow: "0 8px 32px rgba(0,0,0,0.8)", display: "flex", flexDirection: "column", gap: "16px" }}>
            <h2 style={{ margin: 0, color: winModalHint.tierColor, fontSize: "1.5rem" }}>
              🎉 {winModalHint.tierName[lang] || winModalHint.tierName.ru || winModalHint.tierName}
            </h2>
            <div style={{ fontSize: "1.1rem", fontWeight: 600 }}>
              {winModalHint.hintTitle[lang] || winModalHint.hintTitle.ru || winModalHint.hintTitle}
            </div>
            <div style={{ color: "var(--muted)", fontSize: "0.95rem" }}>
              {winModalHint.hintValue[lang] || winModalHint.hintValue.ru || winModalHint.hintValue}
            </div>
            {winModalHint.spell && (
              <div style={{ color: "#c084fc", fontSize: "0.9rem", fontWeight: 600 }}>
                ✨ {t("Added to your spell bar")}
              </div>
            )}
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
        <div
          onClick={() => setShowCheatMenu(false)}
          style={{ position: "fixed", inset: 0, backgroundColor: "rgba(0,0,0,0.7)", zIndex: 99999, display: "flex", alignItems: "center", justifyContent: "center" }}
        >
          <div
            ref={cheatMenuRef}
            role="dialog"
            aria-modal="true"
            aria-label={tCheat("Чит-Меню", "Cheat Menu")}
            onClick={(e) => e.stopPropagation()}
            style={{ background: "var(--bg-elev-1)", padding: "28px", minWidth: "360px", borderRadius: "12px", border: "1px solid var(--border-color)", boxShadow: "0 8px 32px rgba(0,0,0,0.9)", display: "flex", flexDirection: "column", gap: "20px" }}
          >
            <div className="row" style={{ justifyContent: "space-between", alignItems: "center", borderBottom: "1px solid var(--border-color)", paddingBottom: "12px" }}>
              <h3 style={{ margin: 0, fontSize: "1.2rem" }}>🔮 {tCheat("Чит-Меню", "Cheat Menu")}</h3>
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
              <button type="button" onClick={props.onSpellsGranted} className="secondary" style={{ padding: "8px 16px" }}>
                🎲 {tCheat("Получить заклинания", "Get Spells")}
              </button>
              <button type="button" onClick={() => setShowCheatMenu(false)} className="secondary" style={{ padding: "8px 16px" }}>{tCheat("Отмена", "Cancel")}</button>
              <button type="button" onClick={applyCheat} className="btn-primary" style={{ backgroundColor: "#ff3333", color: "white", padding: "8px 16px" }}>{tCheat("Применить", "Apply")}</button>
            </div>
          </div>
        </div>
      )}

      <div className="round-play">
        <HpHealthHud state={state} />
        
        <div className="round-streetview">
          <div className="overlay-top overlay-top--emoji">
            {!state.serverPickedLocation && state.currentTarget && <span className="emoji-inline"><img className="emoji-img" src={emojiUrl(state.currentTarget.emoji)} alt="" /></span>}
            <span>{state.serverPickedLocation ? <>{t("Where in the world is this?")} 🌍 ({roundLabel})</> : <>{t("Where is")} <strong>{state.currentTarget?.name}</strong> {t("hiding?")}</>}</span>
            {state.settings.movementMode === "NMPZ" && (
              <span className="nmpz-badge" role="status">
                🔒 NMPZ
              </span>
            )}
          </div>
          <StreetView
            mode="pano"
            panoId={state.currentTarget?.panoId}
            onView={state.serverPickedLocation ? undefined : onView}
            // NMPZ: the server records the rule, the panorama enforces it.
            movementMode={state.settings.movementMode}
          />
        </div>

        <div className="round-hud" style={{ flexWrap: "wrap" }}>
          {(findingTime > 0 || state.deadlineAt != null) && (
            <Timer
              seconds={findingTime}
              // The server owns the phase clock; this deadline is the same one
              // it will expire, so the display cannot drift from the truth.
              deadlineAt={state.deadlineAt}
              // Only submit a real pin. The old fallback guessed {0,0} — a
              // scored guess in the Gulf of Guinea — so an idle player was
              // penalised for a place they never picked.
              onExpire={() => { if (guess) onGuess(guess); }}
            />
          )}

          {caseHint && (
            <div style={{ padding: "6px 10px", border: `2px solid ${caseHint.tierColor}`, borderRadius: 4, background: "rgba(0,0,0,0.85)", fontSize: 13 }}>
              <strong style={{ color: caseHint.tierColor }}>
                {caseHint.tierName[lang] || caseHint.tierName.ru || caseHint.tierName}
              </strong>: {caseHint.hintTitle[lang] || caseHint.hintTitle.ru || caseHint.hintTitle} ({caseHint.hintValue[lang] || caseHint.hintValue.ru || caseHint.hintValue})
            </div>
          )}
        </div>

        <FloatingMap
          title={t("Move the map and place your guess")}
          className={`guess-map-window${spellCount > 0 ? " has-spells" : ""}`}
        >
          <div className="spell-map">
            <SpellBar
              counts={state.yourSpells}
              active={activeSpell}
              disabled={!spellTarget}
              onSelect={setActiveSpell}
              onCast={handleServerSpell}
            />
            <div className="spell-map-canvas">
              <MapPicker
                value={guess}
                onChange={(p) => { setGuess(p); sendPreview(p); }}
                onDrag={sendPreview}
                markerIcon={state.youEmoji}
                restriction={state.mapBounds}
                resetViewKey={state.roundKey}
                caseHint={caseHint}
                markers={liveMarkers}
                spell={activeSpell}
                spellTarget={spellTarget}
                scoreSettings={state.settings}
                onSpellUsed={handleSpellUsed}
              />
            </div>
          </div>
        </FloatingMap>
      </div>

      <div className="overlay-bar guess-confirm-bar">
        {frozen ? (
          <span className="muted">
            ❄️ {t("Frozen by a rival")} — {frozenLeft}s
          </span>
        ) : (
          <>
            {!guess && <span className="muted">{t("Click the map to place your guess.")}</span>}
            {guess && <span className="muted">{t("Lock it in?")}</span>}
          </>
        )}
        <button
          type="button"
          onClick={() => guess && onGuess(guess)}
          disabled={!guess || frozen}
        >
          {t("Guess here")}
        </button>
      </div>
    </div>
  );
}