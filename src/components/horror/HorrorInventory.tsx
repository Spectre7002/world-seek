"use client";

import { useState } from "react";
import { getHorrorItem } from "@/shared/horrorCatalogue";
import { useLanguage } from "@/lib/language";
import type { HorrorRunView } from "./types";

interface Props {
  run: HorrorRunView;
  onSell: (itemId: string) => void;
  onEat: (itemId: string) => void;
  onEquip?: (itemId: string, slot: number) => void;
  onUnequip?: (slot: number) => void;
}

function rarityColor(r: string): string {
  switch (r) {
    case "Common":
      return "#cfd3d8";
    case "Uncommon":
      return "#38e07a";
    case "Rare":
      return "#2f7dff";
    case "Mythic":
      return "#ff2d55";
    default:
      return "#efe8f2";
  }
}

export default function HorrorInventory(props: Props) {
  const { t } = useLanguage();
  const run = props.run;
  const [tooltip, setTooltip] = useState<string | null>(null);

  const equipped = run.equipment.map((id, slot) => ({ id, slot }));
  const food = run.food;

  return (
    <div
      className="horror-inventory"
      style={{
        position: "absolute",
        bottom: 12,
        left: 12,
        width: 360,
        maxHeight: "40vh",
        overflowY: "auto",
        background: "rgba(20,11,29,0.9)",
        border: "1px solid rgba(255,255,255,0.08)",
        borderRadius: 10,
        padding: 10,
        color: "#efe8f2",
        zIndex: 20,
      }}
    >
      <div style={{ fontSize: 12, color: "#a897b3", marginBottom: 6, textTransform: "uppercase", letterSpacing: 1 }}>
        {t("Inventory")}
      </div>

      {/* Equipment slots */}
      <div style={{ display: "grid", gridTemplateColumns: "repeat(4, 1fr)", gap: 6, marginBottom: 8 }}>
        {equipped.map(({ id, slot }) => {
          const item = id ? getHorrorItem(id) : null;
          return (
            <div
              key={`slot-${slot}`}
              style={{
                minHeight: 64,
                background: "rgba(255,255,255,0.04)",
                border: "1px solid rgba(255,255,255,0.08)",
                borderRadius: 8,
                padding: 4,
                position: "relative",
                cursor: id ? "pointer" : "default",
              }}
              onMouseEnter={() => id && setTooltip(id)}
              onMouseLeave={() => setTooltip(null)}
              onClick={() => {
                if (id && props.onUnequip) props.onUnequip(slot);
              }}
            >
              {item ? (
                <>
                  <div style={{ fontSize: 10, color: rarityColor(item.rarity), fontWeight: 700 }}>
                    {item.name}
                  </div>
                  <div style={{ fontSize: 9, color: "#a897b3" }}>{item.rarity}</div>
                  {run.itemStacks[String(slot)] !== undefined && (
                    <div style={{ fontSize: 9, color: "#ffc23d" }}>
                      x{run.itemStacks[String(slot)]}
                    </div>
                  )}
                </>
              ) : (
                <div style={{ fontSize: 9, color: "#a897b3", textAlign: "center", marginTop: 20 }}>
                  {t("empty")}
                </div>
              )}
            </div>
          );
        })}
      </div>

      {/* Food list */}
      <div style={{ fontSize: 11, color: "#a897b3", marginBottom: 4 }}>{t("Food")}</div>
      <div style={{ display: "flex", flexWrap: "wrap", gap: 4 }}>
        {food.length === 0 && (
          <span style={{ fontSize: 10, color: "#a897b3" }}>{t("none")}</span>
        )}
        {food.map((id, idx) => {
          const item = getHorrorItem(id);
          return (
            <div
              key={`food-${idx}`}
              style={{
                background: "rgba(255,255,255,0.04)",
                border: `1px solid ${item ? rarityColor(item.rarity) : "rgba(255,255,255,0.08)"}`,
                borderRadius: 6,
                padding: "2px 6px",
                fontSize: 10,
                cursor: "pointer",
              }}
              onMouseEnter={() => setTooltip(id)}
              onMouseLeave={() => setTooltip(null)}
              onClick={() => props.onEat(id)}
            >
              {item?.name ?? id}
            </div>
          );
        })}
      </div>

      {/* Spells */}
      {Object.keys(run.spells).length > 0 && (
        <div style={{ marginTop: 8 }}>
          <div style={{ fontSize: 11, color: "#a897b3", marginBottom: 4 }}>{t("Spells")}</div>
          <div style={{ display: "flex", flexWrap: "wrap", gap: 4 }}>
            {Object.entries(run.spells).map(([id, charges]) => (
              <div
                key={id}
                style={{
                  background: "rgba(255,255,255,0.04)",
                  border: "1px solid rgba(255,255,255,0.08)",
                  borderRadius: 6,
                  padding: "2px 6px",
                  fontSize: 10,
                }}
              >
                {id}: {charges}
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Tooltip */}
      {tooltip && (() => {
        const item = getHorrorItem(tooltip);
        if (!item) return null;
        return (
          <div
            style={{
              marginTop: 8,
              padding: 8,
              background: "rgba(0,0,0,0.6)",
              border: `1px solid ${rarityColor(item.rarity)}`,
              borderRadius: 6,
              fontSize: 10,
            }}
          >
            <div style={{ fontWeight: 700, color: rarityColor(item.rarity) }}>{item.name}</div>
            <div style={{ color: "#a897b3" }}>{item.rarity} · {item.kind}</div>
            <div style={{ marginTop: 4 }}>
              {item.effects.map((e, i) => (
                <div key={i}>
                  {e.op} {e.value !== 0 ? e.value : ""}
                </div>
              ))}
            </div>
            {item.stacks && (
              <div style={{ marginTop: 4, color: "#ffc23d" }}>
                {t("stack")}: {item.stacks.key}
              </div>
            )}
          </div>
        );
      })()}
    </div>
  );
}