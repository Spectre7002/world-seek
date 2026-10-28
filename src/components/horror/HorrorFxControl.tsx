"use client";

// HorrorGuessr — the jumpscare settings toggle (P7, §4.2).
//
// §4.2 requires the jumpscare to respect a settings toggle as well as
// `prefers-reduced-motion`. This is that toggle: a compact button that flips the
// persisted preference. It mirrors the shape of `SfxControl` (a small control
// reading a `lib` settings module) without duplicating the audio plumbing.

import { useLanguage } from "@/lib/language";

interface Props {
  enabled: boolean;
  onChange: (enabled: boolean) => void;
}

export default function HorrorFxControl(props: Props) {
  const { t } = useLanguage();
  return (
    <button
      type="button"
      onClick={() => props.onChange(!props.enabled)}
      aria-pressed={props.enabled}
      title={t("Jumpscares")}
      style={{
        background: props.enabled ? "rgba(211,23,48,0.25)" : "rgba(255,255,255,0.08)",
        color: "#efe8f2",
        border: `1px solid ${props.enabled ? "#d31730" : "rgba(255,255,255,0.08)"}`,
        borderRadius: 8,
        padding: "8px 14px",
        cursor: "pointer",
        fontWeight: 700,
        fontSize: 12,
      }}
    >
      {props.enabled ? t("FX On") : t("FX Off")}
    </button>
  );
}
