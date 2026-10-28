"use client";

import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { useLanguage } from "@/lib/language";
import { useHorrorRun, type HorrorActResult } from "@/lib/useHorrorRun";
import { useHorrorFx } from "@/lib/useHorrorFx";
import { useReducedMotion } from "@/lib/useReducedMotion";
import { isJumpscareEnabled, setJumpscareEnabled } from "@/lib/horrorFxSettings";
import HorrorMainMenu from "@/components/horror/HorrorMainMenu";
import HorrorHud from "@/components/horror/HorrorHud";
import HorrorMerchant from "@/components/horror/HorrorMerchant";
import HorrorDayModifiers from "@/components/horror/HorrorDayModifiers";
import HorrorJumpscare from "@/components/horror/HorrorJumpscare";
import HorrorFxControl from "@/components/horror/HorrorFxControl";
import HorrorBossHud from "@/components/horror/HorrorBossHud";
import HorrorBossMinigame from "@/components/horror/HorrorBossMinigame";
import HorrorDayResults, { type HorrorDayResult } from "@/components/horror/HorrorDayResults";
import StreetView from "@/components/StreetView";
import MapPicker from "@/components/MapPicker";
import FloatingMap from "@/components/FloatingMap";
import { getHorrorItem } from "@/shared/horrorCatalogue";

/** Russian needs three day forms (день / дня / дней); English reuses two of them. */
function dayCountKey(n: number): "day" | "days2" | "days" {
  const mod10 = n % 10;
  const mod100 = n % 100;
  if (mod10 === 1 && mod100 !== 11) return "day";
  if (mod10 >= 2 && mod10 <= 4 && (mod100 < 12 || mod100 > 14)) return "days2";
  return "days";
}

export default function HorrorPage() {
  const { t } = useLanguage();
  const router = useRouter();
  const [runId, setRunId] = useState<string | null>(null);
  const [difficulty, setDifficulty] = useState<string>("Normal");
  const [bestRun, setBestRun] = useState<number | null>(null);
  const [merchantOpen, setMerchantOpen] = useState(false);
  const [dayResult, setDayResult] = useState<HorrorDayResult | null>(null);
  const [guessPin, setGuessPin] = useState<{ lat: number; lng: number } | null>(null);
  const [panoId, setPanoId] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [ar, setAr] = useState<any>(null);
  const [jumpscaresOn, setJumpscaresOn] = useState(true);
  const tickInFlight = useRef(false);
  const tickErrorShown = useRef(false);
  const targetDayRef = useRef<number | null>(null);
  const bestRunSavedRef = useRef<string | null>(null);

  const { run, status, error, act, createRun } = useHorrorRun(runId);
  const fx = useHorrorFx();
  const reducedMotion = useReducedMotion();

  // Read the persisted jumpscare preference on mount (client-only, so no
  // hydration mismatch — the default is `true` on both server and first render).
  useEffect(() => {
    setJumpscaresOn(isJumpscareEnabled());
  }, []);

  // Persist best run (days survived) so the menu shows a real number, not a lie.
  useEffect(() => {
    try {
      const raw = window.localStorage.getItem("horror-best-run");
      if (raw) setBestRun(Number(raw));
    } catch {}
  }, []);

  function toggleJumpscares(next: boolean) {
    setJumpscaresOn(next);
    setJumpscareEnabled(next);
  }

  /**
   * Surface a transport-level failure once, unless the caller already has a
   * meaningful `actionResult` to render. `onceKey` suppresses repeated tick
   * errors (the timer retries every few seconds).
   */
  function reportActError(res: HorrorActResult, onceKey?: "tick") {
    if (res.ok || res.actionResult) return;
    if (onceKey === "tick") {
      if (tickErrorShown.current) return;
      tickErrorShown.current = true;
    }
    setMessage(t(res.reason ?? "Request failed"));
  }

  // The server picks each day's location from the same map pool solo mode uses
  // (`/maps`), and the projection carries only the panorama id — the true
  // coordinates never reach the client.
  useEffect(() => {
    const currentDay = run?.day;
    if (currentDay === undefined) return;
    if (targetDayRef.current === currentDay) return;
    targetDayRef.current = currentDay;
    setGuessPin(null);
    setPanoId(run?.targetPanoId ?? null);
  }, [run?.day, run?.targetPanoId]);

  // Save the best run (days survived) once the run is over, whichever action
  // ended it (a tick catch, a guess, a fall).
  useEffect(() => {
    if (!run || run.health > 0) return;
    if (bestRunSavedRef.current === run.runId) return;
    bestRunSavedRef.current = run.runId;
    try {
      const prev = Number(window.localStorage.getItem("horror-best-run") ?? "0");
      if (run.day > prev) {
        window.localStorage.setItem("horror-best-run", String(run.day));
        setBestRun(run.day);
      }
    } catch {}
  }, [run?.health, run?.runId, run?.day]);

  async function startRun() {
    setMessage(null);
    setGuessPin(null);
    setPanoId(null);
    setDayResult(null);
    setMerchantOpen(false);
    targetDayRef.current = null;
    const id = await createRun(difficulty);
    if (id) setRunId(id);
  }

  function backToMenu() {
    setRunId(null);
    setMessage(null);
    setGuessPin(null);
    setPanoId(null);
    setDayResult(null);
    setMerchantOpen(false);
    targetDayRef.current = null;
  }

  async function handleStep() {
    if (!run) return;
    setBusy(true);
    const res = await act({ kind: "step", panoId: "", heading: 0, pitch: 0 });
    setBusy(false);
    reportActError(res);
    setAr(res.actionResult);
    const ar: any = res.actionResult;
    // A fall is a jumpscare trigger (§4.8): 50 damage plus 20 steps of ground.
    if (ar?.fell) {
      if (jumpscaresOn) fx.fire("jumpscare");
      if (ar.fallDamage) fx.fire("damage", ar.fallDamage);
    }
    if (ar?.caught || ar?.dead) {
      if (jumpscaresOn) fx.fire("jumpscare");
      if (ar?.caught) setMessage(t("Caught by the monster!"));
      else if (ar?.dead) {
        fx.fire("death");
        setMessage(t("You died."));
      }
    } else if (ar?.fell) {
      setMessage(t("You fell!"));
    }
  }

  async function handleTick() {
    if (!run || tickInFlight.current) return;
    tickInFlight.current = true;
    try {
      const res = await act({ kind: "tick" });
      if (res.ok) tickErrorShown.current = false;
      reportActError(res, "tick");
      const ar: any = res.actionResult;
      if (ar?.caught || ar?.dead) {
        if (jumpscaresOn) fx.fire("jumpscare");
        if (ar?.caught) setMessage(t("Caught by the monster!"));
        else if (ar?.dead) {
          fx.fire("death");
          setMessage(t("You died."));
        }
      }
    } finally {
      tickInFlight.current = false;
    }
  }

  async function handleGuess() {
    if (!run || !guessPin || !run.targetPanoId) return;
    const guess = { ...guessPin };
    setBusy(true);
    const res = await act({ kind: "guess", lat: guess.lat, lng: guess.lng });
    setBusy(false);
    reportActError(res);
    const ar: any = res.actionResult;
    if (ar?.rejected) {
      // A rejected guess is free of health but costs a jumpscare (§4.2).
      if (jumpscaresOn) fx.fire("jumpscare");
      setMessage(t("Guess rejected — below threshold."));
    } else if (ar?.dead) {
      fx.fire("death");
      setMessage(t("You died."));
    } else if (ar?.target && ar?.distanceKm !== undefined) {
      // A big hit is a "crit" vignette; a small one is a plain damage pulse.
      if (ar?.fullHeal) fx.fire("heal");
      else if (ar.damage) fx.fire(ar.damage >= 1000 ? "crit" : "damage", ar.damage);
      setMessage(null);
      // The server reveals the played day's target only when that day ended,
      // so this is the one moment the true spot can be drawn.
      setDayResult({
        day: ar.day,
        target: ar.target,
        guess,
        distanceKm: ar.distanceKm,
        score: ar.score ?? 0,
        damage: ar.damage ?? 0,
        healthBefore: ar.healthBefore ?? run.health,
        healthAfter: ar.healthAfter ?? run.health,
        perfect: Boolean(ar.fullHeal),
      });
    }
  }

  async function handleHappyThoughts() {
    setBusy(true);
    const res = await act({ kind: "happyThoughts" });
    setBusy(false);
    reportActError(res);
    const ar: any = res.actionResult;
    if (ar?.ok === false) setMessage(ar.reason ?? "failed");
    else if (res.ok) setMessage(t("Happy Thoughts used."));
  }

  async function openMerchant() {
    setBusy(true);
    const res = await act({ kind: "openMerchant" });
    setBusy(false);
    reportActError(res);
    setMerchantOpen(true);
  }

  async function handleBuy(offerIndex: number) {
    setBusy(true);
    const res = await act({ kind: "buy", offerIndex });
    setBusy(false);
    reportActError(res);
    const ar: any = res.actionResult;
    if (ar?.ok === false) setMessage(ar.reason ?? "buy_failed");
    else if (res.ok) setMessage(t("Bought."));
  }

  async function handleReroll() {
    setBusy(true);
    const res = await act({ kind: "reroll" });
    setBusy(false);
    reportActError(res);
    const ar: any = res.actionResult;
    if (ar?.ok === false) setMessage(ar.reason ?? "reroll_failed");
  }

  async function handleSell(itemId: string) {
    setBusy(true);
    const res = await act({ kind: "sell", itemId });
    setBusy(false);
    reportActError(res);
    const ar: any = res.actionResult;
    if (ar?.ok === false) setMessage(ar.reason ?? "sell_failed");
  }

  async function handleEat(itemId: string) {
    setBusy(true);
    const res = await act({ kind: "eat", itemId });
    setBusy(false);
    reportActError(res);
    const ar: any = res.actionResult;
    if (ar?.destroyed) setMessage(t("Item destroyed."));
  }

  async function handleCast(spellId: string, target: { lat: number; lng: number }) {
    setBusy(true);
    const res = await act({ kind: "cast", spellId, target });
    setBusy(false);
    reportActError(res);
    const ar: any = res.actionResult;
    if (ar?.ok === false) setMessage(ar.reason ?? "cast_failed");
  }

  // ── Boss duel actions (P8, §5.1–§5.4) ──────────────────────────────────────

  /** Meep Moorp's laser lock: the lock is the round's player score. */
  async function handleLaserLock(x: number, y: number) {
    setBusy(true);
    const res = await act({ kind: "laserLock", x, y });
    setBusy(false);
    reportActError(res);
    const ar: any = res.actionResult;
    if (ar?.bossDefeated) {
      setMessage(t("Boss defeated!"));
    } else if (ar?.playerDead) {
      fx.fire("death");
      setMessage(t("You died."));
    } else if (ar?.score !== undefined) {
      setMessage(`${t("Score")}: ${ar.score} · ${t("Boss")}: ${ar.bossScore}`);
    }
  }

  /** The Clown's cream-pie wipe: cosmetic and rate-limited. */
  async function handleWipe(amount: number) {
    const res = await act({ kind: "wipe", amount });
    reportActError(res);
  }

  /** The Banshee's scream penalty: any input during the scream costs damage. */
  async function handleScreamPenalty() {
    const res = await act({ kind: "screamPenalty" });
    reportActError(res);
    const ar: any = res.actionResult;
    if (ar?.damage) {
      fx.fire("damage", ar.damage);
      setMessage(t("You moved!"));
    }
    if (ar?.dead) {
      fx.fire("death");
      setMessage(t("You died."));
    }
  }

  /** The Witch's hexes: break them to restore the view. */
  async function handleHexClear() {
    setBusy(true);
    const res = await act({ kind: "hexClear" });
    setBusy(false);
    reportActError(res);
  }

  /** The day-30 finale's pick-one-of-three (§5.4). */
  async function handleFinalReward(choice: "fullHeal" | "mythicEquipment" | "fiveRareFoods") {
    setBusy(true);
    const res = await act({ kind: "finalBossReward", choice });
    setBusy(false);
    reportActError(res);
    const ar: any = res.actionResult;
    if (ar?.ok === false) setMessage(ar.reason ?? "reward_failed");
    else if (res.ok) setMessage(t("Reward taken."));
  }

  if (!runId) {
    return (
      <HorrorMainMenu
        difficulty={difficulty}
        setDifficulty={setDifficulty}
        onStart={startRun}
        busy={status === "connecting"}
        bestRun={bestRun}
      />
    );
  }

  if (status === "connecting" || !run) {
    return (
      <div className="center-screen">
        <p className="muted">{t("Loading…")}</p>
      </div>
    );
  }

  if (status === "error") {
    return (
      <div className="center-screen">
        <p style={{ color: "#ef4444" }}>{error}</p>
        <button onClick={() => router.push("/")}>{t("Back")}</button>
      </div>
    );
  }

  // The Witch's hexes transform the panorama (§5.2): a mirrored world flips it
  // horizontally, an upside-down kingdom rotates it 180°. The transforms are
  // applied to the pano layer only, so the HUD and map stay readable.
  const hexKinds = (run.duel?.hexes ?? []).map((hex) => hex.kind);

  // Meep Moorp replaces the map with the laser minigame (§5.2).
  const laserBoss =
    run.boss?.mechanic === "laserLock" || run.boss?.mechanic === "laserOverdrive";

  // While the results overlay is open the HUD is unmounted, which also stops
  // the client-driven monster timer for the day that has already ended.
  const resultsOpen = Boolean(dayResult) && run.health > 0;

  const hexTransform = [
    hexKinds.includes("mirrorPano") ? "scaleX(-1)" : "",
    hexKinds.includes("upsideDown") ? "rotate(180deg)" : "",
  ]
    .filter(Boolean)
    .join(" ");

  return (
    <div className="full-bleed" style={{ position: "relative", background: "#0b0610" }}>
      {/* Day-modifier visual layer (§4.4, §4.5): Shadow Realm filter, Lights Out
          flashlight, Dark Panorama dim. It wraps only the panorama, so the HUD
          below stays legible on a flashlight day. */}
      <HorrorDayModifiers
        modifier={run.dayModifier}
        bypassed={run.mods.bypassedModifiers}
        reducedMotion={reducedMotion}
      >
        <div
          style={{
            position: "absolute",
            inset: 0,
            transform: hexTransform || undefined,
            transition: reducedMotion ? undefined : "transform 300ms ease",
          }}
        >
          <StreetView mode="pano" panoId={panoId} interactive onPano={(p) => setPanoId(p?.panoId ?? null)} />
        </div>
      </HorrorDayModifiers>

      {/* Solo Horror HUD - HP Battle style from World Seek */}
      {!resultsOpen && (
        <HorrorHud
          run={run}
          onHappyThoughts={handleHappyThoughts}
          happyThoughtsBusy={busy}
          onGuessClick={handleGuess}
          onMerchant={openMerchant}
          guessPin={guessPin}
          busy={busy}
          targetReady={Boolean(run.targetPanoId)}
          onTick={handleTick}
        />
      )}

      {/* Boss duel HUD (§5.1, §5.4): two health bars, the round count, and the
          finale's pick-one-of-three. */}
      {run.boss && (
        <HorrorBossHud run={run} onFinalReward={handleFinalReward} busy={busy} />
      )}

      {/* Boss minigames (§5.2, §5.3): laser lock, cream-pie wipe, scream penalty,
          hex transforms. */}
      {run.boss && (
        <HorrorBossMinigame
          run={run}
          reducedMotion={reducedMotion}
          busy={busy}
          onLaserLock={handleLaserLock}
          onWipe={handleWipe}
          onScreamPenalty={handleScreamPenalty}
          onHexClear={handleHexClear}
        />
      )}

      {/* Meep Moorp has no normal map (§5.2): the laser minigame *is* the answer
          mechanism that day, so the map and the map-guess button are withheld. */}
      {!laserBoss && (
        <FloatingMap title={t("Map")}>
          <MapPicker
            value={guessPin}
            onChange={(p) => setGuessPin(p)}
            markers={guessPin ? [{ lat: guessPin.lat, lng: guessPin.lng, color: "#d31730" }] : []}
          />
        </FloatingMap>
      )}

      {merchantOpen && !resultsOpen && (
        <HorrorMerchant
          run={run}
          offers={run.merchantOffers}
          onBuy={handleBuy}
          onReroll={handleReroll}
          onSell={handleSell}
          onClose={() => setMerchantOpen(false)}
        />
      )}

      {resultsOpen && dayResult && (
        <HorrorDayResults result={dayResult} onContinue={() => setDayResult(null)} />
      )}

      {message && (
        <div
          style={{
            position: "absolute",
            bottom: 16,
            left: "50%",
            transform: "translateX(-50%)",
            background: "rgba(20,11,29,0.9)",
            border: "1px solid rgba(255,255,255,0.08)",
            borderRadius: 8,
            padding: "8px 14px",
            color: "#efe8f2",
            fontSize: 12,
            zIndex: 40,
          }}
          onClick={() => setMessage(null)}
        >
          {message}
        </div>
      )}

      {/* Jumpscares and animation triggers (§4.2, §6.6). The jumpscare is
          suppressed by the settings toggle; damage/heal/death always render. */}
      <HorrorJumpscare
        event={
          fx.event && fx.event.kind === "jumpscare" && !jumpscaresOn ? null : fx.event
        }
        reducedMotion={reducedMotion}
      />

      {/* Run over: the monster caught you, or health hit zero. Without this the
          jumpscare was the last thing the player ever saw. */}
      {run.health <= 0 && (
        <div
          style={{
            position: "fixed",
            inset: 0,
            // Below the jumpscare (60) so the scare plays first, above the HUD.
            zIndex: 50,
            display: "grid",
            placeItems: "center",
            padding: 24,
            background: "rgba(5, 2, 10, 0.94)",
          }}
        >
          <div className="stack" style={{ gap: 14, width: 340, textAlign: "center" }}>
            <h1 className="title" style={{ fontSize: 40, color: "#ff2d55", margin: 0 }}>
              {t("Game over")}
            </h1>
            <p className="muted" style={{ margin: 0 }}>
              {t("You survived")} {run.day} {t(dayCountKey(run.day))}
            </p>
            <button type="button" onClick={startRun}>
              {t("Play again")}
            </button>
            <button type="button" className="secondary" onClick={backToMenu}>
              {t("Main menu")}
            </button>
          </div>
        </div>
      )}
    </div>
  );
}