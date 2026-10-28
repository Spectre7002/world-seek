"use client";

// HorrorGuessr — the boss minigames (P8, §5.2, §5.3).
//
// One component that mounts whichever interactive mechanic the boss brings, so
// the duel shell stays a plain composition. Four mechanics have a minigame:
//
//   - **Meep Moorp** (`laserLock` / `laserOverdrive`): two running laser lines
//     (X and Y) the player stops on the right country. Stopping sends
//     `laserLock` with a normalised `(x, y)`; the server scores it against a
//     seeded target. There is no map on this day (§5.2).
//   - **The Clown** (`rngChaos` / `archClown`): cream pies cover the screen and
//     the map. Pointer drag erases them with `destination-out` compositing; the
//     splat layout is seeded from the run seed (§5.3). Wiping is cosmetic and
//     rate-limited, so it never blocks the guess.
//   - **The Banshee** (`screamPenalty` / `echoScream`): a periodic scream window
//     during which any input costs instant damage. The client reports the
//     violation; the server applies the damage.
//   - **The Witch** (`hexes` / `stackedHexes`): view transforms — a mirrored
//     panorama, a shrunk map with spells locked, or an upside-down screen. A
//     "clear" action removes them.
//
// Every animation is gated by `prefers-reduced-motion` (§6.6), and no layer ever
// intercepts the click that confirms a guess (§4.2, §5.3).

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useLanguage } from "@/lib/language";
import type { HorrorRunView } from "./types";
import { horrorBossMeta } from "./bossMeta";

interface Props {
  run: HorrorRunView;
  /** Honours `prefers-reduced-motion` (§6.6). */
  reducedMotion?: boolean;
  /** Send a `laserLock` action. */
  onLaserLock: (x: number, y: number) => void;
  /** Send a `wipe` action (cosmetic). */
  onWipe: (amount: number) => void;
  /** Send a `screamPenalty` action. */
  onScreamPenalty: () => void;
  /** Send a `hexClear` action. */
  onHexClear: () => void;
  /** True while an action is in flight. */
  busy?: boolean;
}

// ---------------------------------------------------------------------------
// Seeded splat layout (§5.3: "Splat placement is seeded for reproducibility")
// ---------------------------------------------------------------------------

function seededUnit(seed: number, salt: number): number {
  let t = (seed ^ Math.imul(salt, 0x9e3779b9)) >>> 0;
  t = Math.imul(t ^ (t >>> 15), t | 1);
  t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
  return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
}

interface Splat {
  x: number;
  y: number;
  r: number;
}

function buildSplats(seed: number, count: number): Splat[] {
  const splats: Splat[] = [];
  for (let i = 0; i < count; i++) {
    splats.push({
      x: seededUnit(seed, i * 3 + 1),
      y: seededUnit(seed, i * 3 + 2),
      r: 0.08 + seededUnit(seed, i * 3 + 3) * 0.14,
    });
  }
  return splats;
}

// ---------------------------------------------------------------------------
// The Clown's cream-pie wipe layer (§5.3)
// ---------------------------------------------------------------------------

function WipeLayer(props: {
  seed: number;
  reducedMotion?: boolean;
  onWipe: (amount: number) => void;
}) {
  const { t } = useLanguage();
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const wipingRef = useRef(false);
  const lastRef = useRef<{ x: number; y: number } | null>(null);
  const wipedRef = useRef(0);
  const splats = useMemo(() => buildSplats(props.seed, 26), [props.seed]);
  // §5.3: the overlay must **never** intercept the click that confirms a guess,
  // so wiping is an explicit mode the player turns on and off. While wipe mode is
  // off the canvas is `pointer-events: none` and the map and confirm button are
  // fully usable.
  const [wipeMode, setWipeMode] = useState(false);

  const paint = useCallback(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;
    const { width, height } = canvas;
    ctx.clearRect(0, 0, width, height);
    for (const splat of splats) {
      const cx = splat.x * width;
      const cy = splat.y * height;
      const r = splat.r * Math.min(width, height);
      const gradient = ctx.createRadialGradient(cx, cy, r * 0.2, cx, cy, r);
      gradient.addColorStop(0, "rgba(255, 245, 220, 0.98)");
      gradient.addColorStop(0.7, "rgba(255, 230, 180, 0.9)");
      gradient.addColorStop(1, "rgba(255, 220, 160, 0)");
      ctx.fillStyle = gradient;
      ctx.beginPath();
      ctx.arc(cx, cy, r, 0, Math.PI * 2);
      ctx.fill();
    }
  }, [splats]);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const resize = () => {
      canvas.width = canvas.clientWidth;
      canvas.height = canvas.clientHeight;
      paint();
    };
    resize();
    window.addEventListener("resize", resize);
    return () => window.removeEventListener("resize", resize);
  }, [paint]);

  const erase = useCallback(
    (x: number, y: number) => {
      const canvas = canvasRef.current;
      if (!canvas) return;
      const ctx = canvas.getContext("2d");
      if (!ctx) return;
      ctx.globalCompositeOperation = "destination-out";
      const r = Math.min(canvas.width, canvas.height) * 0.09;
      const gradient = ctx.createRadialGradient(x, y, 0, x, y, r);
      gradient.addColorStop(0, "rgba(0,0,0,1)");
      gradient.addColorStop(1, "rgba(0,0,0,0)");
      ctx.fillStyle = gradient;
      ctx.beginPath();
      ctx.arc(x, y, r, 0, Math.PI * 2);
      ctx.fill();
      ctx.globalCompositeOperation = "source-over";
    },
    [],
  );

  const onPointerDown = (event: React.PointerEvent<HTMLCanvasElement>) => {
    wipingRef.current = true;
    const rect = event.currentTarget.getBoundingClientRect();
    lastRef.current = { x: event.clientX - rect.left, y: event.clientY - rect.top };
    erase(lastRef.current.x, lastRef.current.y);
  };

  const onPointerMove = (event: React.PointerEvent<HTMLCanvasElement>) => {
    if (!wipingRef.current) return;
    const rect = event.currentTarget.getBoundingClientRect();
    const x = event.clientX - rect.left;
    const y = event.clientY - rect.top;
    const last = lastRef.current;
    if (last) {
      const steps = Math.max(1, Math.round(Math.hypot(x - last.x, y - last.y) / 8));
      for (let i = 1; i <= steps; i++) {
        erase(last.x + ((x - last.x) * i) / steps, last.y + ((y - last.y) * i) / steps);
      }
    }
    lastRef.current = { x, y };
    wipedRef.current += 1;
    // Rate-limited: report roughly every 12 erase samples.
    if (wipedRef.current % 12 === 0) props.onWipe(1);
  };

  const onPointerUp = () => {
    wipingRef.current = false;
    lastRef.current = null;
  };

  return (
    <>
      <canvas
        ref={canvasRef}
        className="horror-wipe-layer"
        aria-hidden="true"
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={onPointerUp}
        onPointerLeave={onPointerUp}
        style={{
          position: "absolute",
          inset: 0,
          zIndex: 45,
          width: "100%",
          height: "100%",
          cursor: wipeMode ? "crosshair" : "default",
          touchAction: "none",
          // Only capture the pointer while wipe mode is on, so the map and the
          // confirm button stay clickable the rest of the time (§5.3).
          pointerEvents: wipeMode ? "auto" : "none",
        }}
      />
      <button
        type="button"
        onClick={() => setWipeMode((on) => !on)}
        style={{
          position: "absolute",
          bottom: 16,
          left: "50%",
          transform: "translateX(-50%)",
          zIndex: 46,
          background: wipeMode
            ? "linear-gradient(rgb(255,194,61), rgb(160,110,10))"
            : "rgba(20,11,29,0.92)",
          color: wipeMode ? "#1a0f24" : "#efe8f2",
          border: "1px solid rgba(255,194,61,0.6)",
          borderRadius: 999,
          padding: "8px 16px",
          fontWeight: 800,
          fontSize: 12,
          cursor: "pointer",
        }}
      >
        {wipeMode ? t("Done wiping") : t("Wipe the cream")}
      </button>
    </>
  );
}

// ---------------------------------------------------------------------------
// Meep Moorp's laser lock (§5.2)
// ---------------------------------------------------------------------------

function LaserMinigame(props: {
  overdrive: boolean;
  reducedMotion?: boolean;
  busy?: boolean;
  onLaserLock: (x: number, y: number) => void;
}) {
  const { t } = useLanguage();
  const [x, setX] = useState(0.5);
  const [y, setY] = useState(0.5);
  const [locked, setLocked] = useState(false);
  const rafRef = useRef<number | null>(null);
  const startRef = useRef<number>(0);
  const speed = props.overdrive ? 2 : 1;

  useEffect(() => {
    if (props.reducedMotion) return;
    startRef.current = performance.now();
    const tick = (now: number) => {
      const elapsed = (now - startRef.current) / 1000;
      // Two independent lines sweeping the unit square at different rates.
      setX((Math.sin(elapsed * 0.9 * speed) + 1) / 2);
      setY((Math.cos(elapsed * 1.3 * speed) + 1) / 2);
      rafRef.current = requestAnimationFrame(tick);
    };
    rafRef.current = requestAnimationFrame(tick);
    return () => {
      if (rafRef.current !== null) cancelAnimationFrame(rafRef.current);
    };
  }, [props.reducedMotion, speed]);

  const lock = () => {
    if (locked || props.busy) return;
    setLocked(true);
    props.onLaserLock(x, y);
  };

  return (
    <div
      className="horror-laser"
      style={{
        position: "absolute",
        inset: 0,
        zIndex: 44,
        background: "rgba(4,10,6,0.92)",
        overflow: "hidden",
      }}
    >
      {/* The two running lines. */}
      <div
        aria-hidden="true"
        style={{
          position: "absolute",
          top: 0,
          bottom: 0,
          left: `${x * 100}%`,
          width: 2,
          background: "linear-gradient(#38e07a, rgba(56,224,122,0.1))",
          boxShadow: "0 0 12px #38e07a",
        }}
      />
      <div
        aria-hidden="true"
        style={{
          position: "absolute",
          left: 0,
          right: 0,
          top: `${y * 100}%`,
          height: 2,
          background: "linear-gradient(90deg, #38e07a, rgba(56,224,122,0.1))",
          boxShadow: "0 0 12px #38e07a",
        }}
      />
      <div
        style={{
          position: "absolute",
          left: "50%",
          bottom: 24,
          transform: "translateX(-50%)",
          display: "flex",
          flexDirection: "column",
          alignItems: "center",
          gap: 8,
        }}
      >
        <div style={{ color: "#efe8f2", fontSize: 12, letterSpacing: 1, textTransform: "uppercase" }}>
          {t("Stop the laser on the country")}
        </div>
        <button
          type="button"
          onClick={lock}
          disabled={locked || props.busy}
          style={{
            background: "linear-gradient(rgb(56,224,122), rgb(20,120,60))",
            color: "#04120a",
            border: "none",
            borderRadius: 8,
            padding: "10px 22px",
            fontWeight: 800,
            fontSize: 14,
            cursor: locked ? "not-allowed" : "pointer",
          }}
        >
          {locked ? t("Locked") : t("Lock coordinates")}
        </button>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// The Banshee's scream (§5.2)
// ---------------------------------------------------------------------------

function ScreamLayer(props: {
  echo: boolean;
  reducedMotion?: boolean;
  busy?: boolean;
  onScreamPenalty: () => void;
}) {
  const { t } = useLanguage();
  const [screaming, setScreaming] = useState(false);
  const screamingRef = useRef(false);

  useEffect(() => {
    let timer: number;
    const schedule = () => {
      const safe = props.echo ? 3000 : 5000;
      timer = window.setTimeout(() => {
        setScreaming(true);
        screamingRef.current = true;
        const duration = props.echo ? 5000 : 3000;
        window.setTimeout(() => {
          setScreaming(false);
          screamingRef.current = false;
          schedule();
        }, duration);
      }, safe);
    };
    schedule();
    return () => window.clearTimeout(timer);
  }, [props.echo]);

  // Any input during the scream is a violation.
  useEffect(() => {
    const onInput = () => {
      if (screamingRef.current && !props.busy) props.onScreamPenalty();
    };
    window.addEventListener("pointerdown", onInput);
    window.addEventListener("keydown", onInput);
    window.addEventListener("wheel", onInput, { passive: true });
    return () => {
      window.removeEventListener("pointerdown", onInput);
      window.removeEventListener("keydown", onInput);
      window.removeEventListener("wheel", onInput);
    };
  }, [props.busy, props.onScreamPenalty]);

  if (!screaming) return null;

  return (
    <div
      className="horror-scream"
      aria-hidden="true"
      style={{
        position: "absolute",
        inset: 0,
        zIndex: 46,
        pointerEvents: "none",
        display: "grid",
        placeItems: "center",
        background: "radial-gradient(circle at 50% 50%, rgba(47,125,255,0.25), rgba(0,0,0,0.85) 70%)",
        animation: props.reducedMotion ? undefined : "hz-scream-pulse 700ms ease-in-out infinite alternate",
      }}
    >
      <div
        style={{
          color: "#efe8f2",
          fontSize: 28,
          fontWeight: 900,
          letterSpacing: 4,
          textTransform: "uppercase",
          textShadow: "0 0 20px rgba(47,125,255,0.9)",
        }}
      >
        {t("Do not move!")}
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// The Witch's hexes (§5.2)
// ---------------------------------------------------------------------------

function HexLayer(props: {
  hexes: Array<{ kind: string; until: number | null }>;
  busy?: boolean;
  onHexClear: () => void;
}) {
  const { t } = useLanguage();
  const kinds = props.hexes.map((hex) => hex.kind);
  const mirrored = kinds.includes("mirrorPano");
  const shrunk = kinds.includes("shrinkMap");
  const upsideDown = kinds.includes("upsideDown");
  const spellLock = kinds.includes("spellLock");

  if (props.hexes.length === 0) return null;

  return (
    <>
      {/* The view transforms are applied to the panorama by the shell via a
          data attribute; this layer only renders the status and the clear
          button, so it never covers the guess map. */}
      <div
        className="horror-hex-status"
        style={{
          position: "absolute",
          top: 80,
          left: "50%",
          transform: "translateX(-50%)",
          zIndex: 47,
          display: "flex",
          gap: 8,
          alignItems: "center",
          background: "rgba(20,11,29,0.92)",
          border: "1px solid #8b5cf6",
          borderRadius: 999,
          padding: "6px 12px",
          color: "#efe8f2",
          fontSize: 12,
          fontWeight: 700,
        }}
      >
        <span aria-hidden="true">🧙</span>
        <span>
          {mirrored && t("Mirrored world")}
          {mirrored && (shrunk || upsideDown) ? " · " : ""}
          {shrunk && t("Tiny map")}
          {shrunk && upsideDown ? " · " : ""}
          {upsideDown && t("Upside down")}
          {spellLock ? ` · ${t("Spells locked")}` : ""}
        </span>
        <button
          type="button"
          onClick={props.onHexClear}
          disabled={props.busy}
          style={{
            background: "linear-gradient(rgb(139,92,246), rgb(76,29,149))",
            color: "#efe8f2",
            border: "none",
            borderRadius: 999,
            padding: "4px 10px",
            fontSize: 11,
            fontWeight: 700,
            cursor: props.busy ? "not-allowed" : "pointer",
          }}
        >
          {t("Break the hex")}
        </button>
      </div>
    </>
  );
}

// ---------------------------------------------------------------------------
// The dispatcher
// ---------------------------------------------------------------------------

export default function HorrorBossMinigame(props: Props) {
  const run = props.run;
  const boss = run.boss;
  if (!boss) return null;
  const meta = horrorBossMeta(boss.mechanic);
  const duel = run.duel;

  if (meta.minigame === "laser") {
    return (
      <LaserMinigame
        overdrive={boss.mechanic === "laserOverdrive"}
        reducedMotion={props.reducedMotion}
        busy={props.busy}
        onLaserLock={props.onLaserLock}
      />
    );
  }

  if (meta.minigame === "wipe") {
    return (
      <WipeLayer
        seed={run.runId.length + run.day * 7}
        reducedMotion={props.reducedMotion}
        onWipe={props.onWipe}
      />
    );
  }

  if (meta.minigame === "scream") {
    return (
      <ScreamLayer
        echo={boss.mechanic === "echoScream"}
        reducedMotion={props.reducedMotion}
        busy={props.busy}
        onScreamPenalty={props.onScreamPenalty}
      />
    );
  }

  if (meta.minigame === "hex") {
    return (
      <HexLayer
        hexes={duel?.hexes ?? []}
        busy={props.busy}
        onHexClear={props.onHexClear}
      />
    );
  }

  return null;
}
