"use client";

import { useEffect, useState } from "react";
import { useLanguage } from "@/lib/language";
import { useRouter } from "next/navigation";

type Props = {
  difficulty: string;
  setDifficulty: (d: string) => void;
  onStart: () => void;
  busy: boolean;
  bestRun: number | null;
};

const NODES = [5, 10, 15, 20, 25, 30];
const BEST_RUN_KEY = "horror-best-run";

export default function HorrorMainMenu({ difficulty, setDifficulty, onStart, busy }: Props) {
  const { t } = useLanguage();
  const router = useRouter();
  const [bestRun, setBestRun] = useState<number | null>(null);

  useEffect(() => {
    try {
      const raw = window.localStorage.getItem(BEST_RUN_KEY);
      if (raw) setBestRun(Number(raw));
    } catch {}
  }, []);

  const cards = [
    { key: "Normal", title: "NORMAL", desc: t("You are a beginner") },
    { key: "Hard", title: "HARD", desc: t("You know a few clues and metas") },
    { key: "Nightmare", title: "NIGHTMARE", desc: t("You are a pro") },
  ];

  return (
    <div className="horror-menu">
      {/* Background scene */}
      <div className="horror-menu-bg" aria-hidden="true">
        <svg className="horror-menu-scene" viewBox="0 0 1200 700" preserveAspectRatio="xMidYMid slice">
          <defs>
            <radialGradient id="hzMoonGlow" cx="50%" cy="40%" r="45%">
              <stop offset="0%" stopColor="#7c3aed" stopOpacity="0.4" />
              <stop offset="100%" stopColor="#0b0610" stopOpacity="0" />
            </radialGradient>
            <radialGradient id="hzLanternGlow" cx="50%" cy="50%" r="50%">
              <stop offset="0%" stopColor="#fbbf24" stopOpacity="0.95" />
              <stop offset="55%" stopColor="#f97316" stopOpacity="0.45" />
              <stop offset="100%" stopColor="#0b0610" stopOpacity="0" />
            </radialGradient>
          </defs>
          <rect width="1200" height="700" fill="url(#hzMoonGlow)" />
          {/* Monster silhouette */}
          <g transform="translate(600,110)" opacity="0.9">
            <path d="M0,0 C-46,22 -70,90 -58,175 C-46,240 -22,285 0,310 C22,285 46,240 58,175 C70,90 46,22 0,0 Z" fill="#05020a" />
            <path d="M-34,70 Q-80,45 -100,100 Q-78,135 -44,112 Z" fill="#05020a" />
            <path d="M34,70 Q80,45 100,100 Q78,135 44,112 Z" fill="#05020a" />
          </g>
          {/* Trees left */}
          <g fill="#0a0512" opacity="0.95">
            <path d="M70,700 L95,290 L82,268 L108,245 L90,222 L115,198 L98,175 L120,150 L102,128 L88,700 Z" />
            <path d="M150,700 L170,330 L158,308 L182,285 L165,262 L188,238 L172,215 L155,700 Z" />
          </g>
          {/* Trees right */}
          <g fill="#0a0512" opacity="0.95">
            <path d="M1050,700 L1025,290 L1038,268 L1012,245 L1030,222 L1005,198 L1022,175 L1000,150 L1018,128 L1050,700 Z" />
            <path d="M1130,700 L1110,330 L1122,308 L1098,285 L1115,262 L1092,238 L1108,215 L1130,700 Z" />
          </g>
          {/* Stone fence */}
          <rect x="0" y="565" width="1200" height="20" fill="#1a1224" />
          {/* Tombstones */}
          <g fill="#1f1630">
            <rect x="250" y="495" width="44" height="72" rx="22" />
            <rect x="335" y="508" width="38" height="60" rx="19" />
            <rect x="870" y="500" width="46" height="68" rx="23" />
            <rect x="955" y="512" width="36" height="56" rx="18" />
          </g>
          {/* Lantern */}
          <g transform="translate(175,460)">
            <rect x="-7" y="0" width="14" height="100" fill="#2a1f3a" />
            <rect x="-16" y="-28" width="32" height="34" rx="5" fill="#1a1224" stroke="#3a2a4a" />
            <circle cx="0" cy="-11" r="26" fill="url(#hzLanternGlow)" />
          </g>
        </svg>
        <div className="horror-menu-fog horror-menu-fog--1" />
        <div className="horror-menu-fog horror-menu-fog--2" />
      </div>

      <button className="horror-back-btn" onClick={() => router.push("/")}>
        ← {t("Back to menu")}
      </button>

      <div className="horror-menu-content">
        {/* Hero */}
        <div className="horror-menu-hero">
          <h1 className="horror-menu-title">
            <span>{t("SOMETHING IS")}</span>
            <span>{t("STALKING YOU")}</span>
          </h1>
          <p className="horror-menu-subtitle">{t("How long can you survive?")}</p>
        </div>

        {/* Progression track */}
        <div className="horror-menu-track">
          <div className="horror-menu-track-line" />
          <div className="horror-menu-track-dash" />
          <div className="horror-menu-track-nodes">
            {NODES.map((n) => {
              const active = n === 5;
              return (
                <div key={n} className={`horror-menu-node ${active ? "is-active" : ""}`}>
                  {active && <div className="horror-menu-node-glow" />}
                  <div className="horror-menu-node-circle">
                    <span className={active ? "horror-menu-node-avatar" : "horror-menu-node-silhouette"}>
                      👤
                    </span>
                  </div>
                  <span className="horror-menu-node-num">{n}</span>
                </div>
              );
            })}
          </div>
          <div className="horror-menu-track-label">
            <span className="horror-menu-chest">📦</span>
            <span>{t("PRIZES • BEST RUN")} {bestRun ?? "—"} {">"}</span>
          </div>
        </div>

        {/* Difficulty cards */}
        <div className="horror-menu-difficulties">
          {cards.map((c) => {
            const selected = difficulty === c.key;
            return (
              <button
                key={c.key}
                type="button"
                className={`horror-menu-card ${selected ? "is-selected" : ""}`}
                onClick={() => setDifficulty(c.key)}
              >
                <span className="horror-menu-card-badge">
                  <span className="horror-menu-tombstone">🪦</span>
                  <span>{t("0 days")}</span>
                </span>
                <span className="horror-menu-card-title">{c.title}</span>
                <span className="horror-menu-card-desc">{c.desc}</span>
              </button>
            );
          })}
        </div>

        {/* CTA */}
        <button
          type="button"
          className="horror-menu-start"
          onClick={onStart}
          disabled={busy}
        >
          {t("START")}
        </button>
      </div>
    </div>
  );
}
