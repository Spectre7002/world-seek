"use client";

interface Props {
  label: string;
  current: number;
  total: number;
}

export default function WaitingBar({ label, current, total }: Props) {
  const pct = total > 0 ? Math.round((current / total) * 100) : 0;
  return (
    <div className="stack" style={{ gap: 8 }}>
      <div className="row" style={{ justifyContent: "space-between" }}>
        <span className="muted">{label}</span>
        <span style={{ fontVariantNumeric: "tabular-nums" }}>
          {current} / {total}
        </span>
      </div>
      <div
        style={{
          height: 8,
          borderRadius: 999,
          background: "var(--bg-elev-2)",
          overflow: "hidden",
        }}
      >
        <div className="scorebar" style={{ width: `${pct}%`, height: "100%" }} />
      </div>
    </div>
  );
}
