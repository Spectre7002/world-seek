"use client";

import { useMemo, useState } from "react";
import type { MapCatalog, MapId } from "@/shared/types";
import { useLanguage } from "@/lib/language";

interface Props {
  catalog: MapCatalog;
  value: string;
  disabled?: boolean;
  onChange: (mapId: MapId) => void;
}

export default function MapSelector(props: Props) {
  const { language, t } = useLanguage();
  const [category, setCategory] = useState<"global" | "continents" | "countries">(
    props.value.startsWith("continent:")
      ? "continents"
      : props.value.startsWith("country:")
        ? "countries"
        : "global",
  );
  const [query, setQuery] = useState("");
  const options = category === "global"
    ? [props.catalog.global]
    : props.catalog[category];
  const filtered = useMemo(
    () => options.filter((option) => option.name.toLowerCase().includes(query.toLowerCase()) || option.code.toLowerCase().includes(query.toLowerCase())),
    [options, query],
  );
  const regionNames = useMemo(
    () => new Intl.DisplayNames([language], { type: "region" }),
    [language],
  );

  function optionName(option: (typeof options)[number]): string {
    if (option.category === "countries") {
      return regionNames.of(option.code) ?? option.name;
    }
    const continentNames: Record<string, string> = {
      africa: t("Africa"),
      asia: t("Asia"),
      europe: t("Europe"),
      northamerica: t("North America"),
      oceania: t("Oceania"),
      southamerica: t("South America"),
    };
    return continentNames[option.code] ?? option.name;
  }

  return (
    <div className="stack" style={{ gap: 8 }}>
      <div className="map-selector-tabs">
        {(["global", "continents", "countries"] as const).map((item) => (
          <button
            key={item}
            type="button"
            className={`map-selector-tab${category === item ? " is-selected" : ""}`}
            disabled={props.disabled}
            onClick={() => setCategory(item)}
          >
            {item === "global" ? t("Whole world") : item === "continents" ? t("Continents") : t("Countries")}
          </button>
        ))}
      </div>
      {category !== "global" && (
        <input
          className="map-selector-input"
          value={query}
          disabled={props.disabled}
          onChange={(event) => setQuery(event.target.value)}
          placeholder={t("Search maps…")}
          aria-label={t("Search maps")}
        />
      )}
      <div className="map-selector-options" role="listbox" aria-label={t("Maps")}>
        {filtered.map((option) => (
          <button
            key={option.id}
            type="button"
            role="option"
            aria-selected={props.value === option.id}
            className={`map-selector-option${props.value === option.id ? " is-selected" : ""}`}
            disabled={props.disabled}
            onClick={() => props.onChange(option.id)}
          >
            {optionName(option)} {option.category === "countries" ? `(${option.code})` : ""}
          </button>
        ))}
      </div>
    </div>
  );
}
