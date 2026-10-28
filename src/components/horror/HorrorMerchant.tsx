"use client";

import { getHorrorItem } from "@/shared/horrorCatalogue";
import { useLanguage } from "@/lib/language";
import type { HorrorRunView } from "./types";

interface Props {
  run: HorrorRunView;
  onBuy: (offerIndex: number) => void;
  onReroll: () => void;
  onSell: (itemId: string) => void;
  onClose: () => void;
  offers: Array<{ itemId: string; rarity: string; price: number }>;
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

export default function HorrorMerchant(props: Props) {
  const { t } = useLanguage();
  const run = props.run;

  return (
    <div
      className="horror-merchant"
      style={{
        position: "absolute",
        inset: 0,
        background: "rgba(11,6,16,0.92)",
        zIndex: 30,
        display: "flex",
        flexDirection: "column",
        padding: 24,
        color: "#efe8f2",
        overflowY: "auto",
      }}
    >
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 16 }}>
        <h2 style={{ margin: 0, fontSize: 20 }}>{t("Merchant")}</h2>
        <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
          <span style={{ fontSize: 12, color: "#a897b3" }}>
            {t("Gold")}: {run.gold}
          </span>
          <button
            type="button"
            onClick={props.onClose}
            style={{
              background: "transparent",
              border: "1px solid rgba(255,255,255,0.08)",
              color: "#efe8f2",
              borderRadius: 6,
              padding: "4px 10px",
              cursor: "pointer",
            }}
          >
            {t("Close")}
          </button>
        </div>
      </div>

      <div style={{ marginBottom: 12, fontSize: 11, color: "#a897b3" }}>
        {t("Day")} {run.day}
      </div>

      {/* Offers grid */}
      <div
        style={{
          display: "grid",
          gridTemplateColumns: "repeat(auto-fill, minmax(160px, 1fr))",
          gap: 12,
          marginBottom: 16,
        }}
      >
        {props.offers.map((offer, idx) => {
          const item = getHorrorItem(offer.itemId);
          const sold = offer.itemId === "__sold__";
          return (
            <div
              key={idx}
              style={{
                background: "rgba(255,255,255,0.04)",
                border: `1px solid ${rarityColor(offer.rarity)}`,
                borderRadius: 8,
                padding: 10,
                opacity: sold ? 0.4 : 1,
              }}
            >
              <div style={{ fontWeight: 700, color: rarityColor(offer.rarity), fontSize: 13 }}>
                {item?.name ?? offer.itemId}
              </div>
              <div style={{ fontSize: 10, color: "#a897b3" }}>{offer.rarity}</div>
              <div style={{ marginTop: 6, fontSize: 12 }}>
                {t("Price")}: {offer.price}
              </div>
              <button
                type="button"
                disabled={sold || run.gold < offer.price}
                onClick={() => props.onBuy(idx)}
                style={{
                  marginTop: 8,
                  width: "100%",
                  background: "linear-gradient(rgb(211,23,48), rgb(113,9,23))",
                  color: "#efe8f2",
                  border: "none",
                  borderRadius: 6,
                  padding: "6px 0",
                  cursor: sold || run.gold < offer.price ? "not-allowed" : "pointer",
                  fontWeight: 700,
                  fontSize: 12,
                }}
              >
                {t("Buy")}
              </button>
            </div>
          );
        })}
      </div>

      {/* Reroll + sell row */}
      <div style={{ display: "flex", gap: 8, marginBottom: 16 }}>
        <button
          type="button"
          onClick={props.onReroll}
          style={{
            background: "rgba(255,255,255,0.08)",
            color: "#efe8f2",
            border: "1px solid rgba(255,255,255,0.08)",
            borderRadius: 6,
            padding: "6px 12px",
            cursor: "pointer",
            fontSize: 12,
          }}
        >
          {t("Reroll")} ({run.rerollCost})
        </button>
        <span style={{ fontSize: 11, color: "#a897b3", alignSelf: "center" }}>
          {t("Free rerolls")}: {run.freeRerolls}
        </span>
      </div>

      {/* Sell list */}
      <div>
        <div style={{ fontSize: 12, color: "#a897b3", marginBottom: 6, textTransform: "uppercase", letterSpacing: 1 }}>
          {t("Sell")}
        </div>
        <div style={{ display: "flex", flexWrap: "wrap", gap: 6 }}>
          {[...run.equipment.filter(Boolean), ...run.food].map((id, idx) => {
            const item = id ? getHorrorItem(id) : null;
            return (
              <button
                key={`sell-${idx}`}
                type="button"
                onClick={() => id && props.onSell(id)}
                style={{
                  background: "rgba(255,255,255,0.04)",
                  border: "1px solid rgba(255,255,255,0.08)",
                  color: "#efe8f2",
                  borderRadius: 6,
                  padding: "4px 8px",
                  cursor: "pointer",
                  fontSize: 11,
                }}
              >
                {item?.name ?? id}
              </button>
            );
          })}
        </div>
      </div>
    </div>
  );
}