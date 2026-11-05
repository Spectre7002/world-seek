"use client";

import {
  MAP_SPELL_IDS,
  SERVER_SPELL_IDS,
  SPELLS,
  totalSpells,
  type SpellCounts,
  type SpellId,
} from "@/shared/spells";
import { useLanguage } from "@/lib/language";
import SpellIcon from "./SpellIcon";

interface Props {
  counts: SpellCounts;
  active: SpellId | null;
  disabled?: boolean;
  /** Server spells (freeze / reroll) are cast immediately, not armed. */
  onSelect: (spell: SpellId | null) => void;
  /** Fired for a server spell; the caller emits `spell:consume` right away. */
  onCast?: (spell: SpellId) => void;
}

export default function SpellBar({ counts, active, disabled, onSelect, onCast }: Props) {
  const { t, language } = useLanguage();
  const open = totalSpells(counts) > 0;

  function renderPill(id: SpellId) {
    const count = counts[id];
    const isMap = SPELLS[id].kind === "map";
    const isActive = active === id;
    return (
      <button
        key={id}
        type="button"
        className={`spell-pill${isActive ? " is-active" : ""}${
          isMap ? "" : " is-instant"
        }`}
        disabled={count <= 0 || (isMap && disabled)}
        title={
          isMap && disabled
            ? t("Target coordinates unavailable")
            : `${SPELLS[id].name[language]} — ${SPELLS[id].description[language]}`
        }
        aria-pressed={isMap ? isActive : undefined}
        onClick={() => {
          if (isMap) {
            onSelect(isActive ? null : id);
            return;
          }
          onCast?.(id);
        }}
      >
        <span className="spell-icon">
          <SpellIcon id={id} />
        </span>
        <span className="spell-name">{SPELLS[id].label}</span>
        <span className="spell-count">{count}</span>
      </button>
    );
  }

  return (
    <div className={`spell-bar${open ? " is-open" : ""}`} aria-hidden={!open}>
      <span className="spell-bar-title">{t("Spells")}</span>
      <div className="spell-bar-list" role="toolbar" aria-label={t("Spells")}>
        {MAP_SPELL_IDS.map(renderPill)}
        {SERVER_SPELL_IDS.map(renderPill)}
      </div>
    </div>
  );
}
