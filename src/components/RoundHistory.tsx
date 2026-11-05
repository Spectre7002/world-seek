"use client";

import type { PublicState, RoundHistoryEntry } from "@/shared/types";
import { formatDistance } from "@/shared/scoring";
import { emojiUrl } from "@/shared/emojis";
import { useLanguage } from "@/lib/language";

interface Props {
  state: PublicState;
  /** Collapse to the last N rounds. Omit to show everything. */
  limit?: number;
  /** Highlight this roundKey (the round currently on screen). */
  highlightKey?: number;
}

function mapLabel(mapId: string): string {
  if (mapId === "global") return "Whole world";
  if (mapId.startsWith("continent:")) {
    const code = mapId.slice("continent:".length);
    return code.charAt(0).toUpperCase() + code.slice(1);
  }
  if (mapId.startsWith("country:")) return mapId.slice("country:".length);
  return mapId;
}

/**
 * Per-round log shown on the results and final screens.
 *
 * The entries come from the server (`PublicState.roundHistory`), which is only
 * populated in the results and finished phases — during hiding/finding it is
 * empty, so an earlier target's coordinates can never leak to a player who has
 * not finished guessing it.
 */
export default function RoundHistory(props: Props) {
  const { t } = useLanguage();
  const state = props.state;
  const history = state.roundHistory ?? [];
  if (history.length === 0) return null;

  const limit = props.limit && props.limit > 0 ? props.limit : history.length;
  const shown = history.slice(Math.max(0, history.length - limit));

  return (
    <div className="stack" style={{ gap: 8 }}>
      <div className="row" style={{ justifyContent: "space-between" }}>
        <strong className="muted">{t("Round history")}</strong>
        <span className="muted" style={{ fontSize: 12 }}>
          {history.length} {t("rounds")}
        </span>
      </div>
      <div className="round-history">
        {shown.map(function (entry) {
          return (
            <RoundRow
              key={entry.roundKey + "-" + entry.round}
              entry={entry}
              youId={state.youId}
              current={props.highlightKey === entry.roundKey}
            />
          );
        })}
      </div>
    </div>
  );
}

function RoundRow(props: {
  entry: RoundHistoryEntry;
  youId: string;
  current: boolean;
}) {
  const { t } = useLanguage();
  const entry = props.entry;

  // The viewer's own line is the one worth summarising; fall back to the round
  // winner so a spectator still sees something meaningful.
  let mine = null;
  for (let i = 0; i < entry.guesses.length; i++) {
    if (entry.guesses[i].playerId === props.youId) {
      mine = entry.guesses[i];
      break;
    }
  }
  const best = entry.guesses.length > 0 ? entry.guesses[0] : null;
  const shown = mine ?? best;

  return (
    <div className={`round-history-row${props.current ? " round-history-row--current" : ""}`}>
      <div className="row" style={{ gap: 8, minWidth: 0 }}>
        <span className="badge">{entry.round}</span>
        {!entry.serverPicked && (
          <span className="roster-avatar" aria-hidden="true">
            <img className="emoji-img" src={emojiUrl(entry.targetEmoji)} alt="" />
          </span>
        )}
        <span
          style={{ overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}
          title={mapLabel(entry.mapId)}
        >
          {entry.targetName === "Mystery location" ? t("Mystery location") : entry.targetName}
        </span>
      </div>
      <div className="row" style={{ gap: 10, flexShrink: 0 }}>
        {shown ? (
          <>
            <span className="muted">{formatDistance(shown.distanceKm)}</span>
            <strong style={{ fontVariantNumeric: "tabular-nums" }}>
              {shown.points.toLocaleString()}
            </strong>
          </>
        ) : (
          <span className="muted">{t("no guess")}</span>
        )}
      </div>
    </div>
  );
}
