"use client";

import { useState } from "react";
import type { PublicPlayer } from "@/shared/types";
import { emojiUrl } from "@/shared/emojis";
import SfxControl from "./SfxControl";
import { useLanguage } from "@/lib/language";
import { useDialog } from "@/lib/useDialog";

interface Props {
  isGameMaster: boolean;
  onLeave: () => void;
  onClose: () => void;
  /** Host only: skip the current phase (hiding / finding) immediately. */
  onForceAdvance?: () => void;
  /** True while a phase can actually be skipped. */
  canForceAdvance?: boolean;
  /** Everyone in the room, for the vote-kick list. */
  players?: PublicPlayer[];
  youId?: string;
  /** Vote counts per target player id. */
  kickVotes?: Record<string, number>;
  /** Votes needed to remove a player right now. */
  kickVotesNeeded?: number;
  onVoteKick?: (targetId: string) => void;
}

/**
 * Top-right menu button. Tapping it opens a small panel that tucks away the
 * exit/leave action (previously a loose button in the bottom-left corner). The
 * host closes the game for everyone; everyone else just leaves. Either way a
 * confirmation dialog guards against accidental taps before anything happens.
 */
export default function GameMenu({
  isGameMaster,
  onLeave,
  onClose,
  onForceAdvance,
  canForceAdvance,
  players,
  youId,
  kickVotes,
  kickVotesNeeded,
  onVoteKick,
}: Props) {
  const { t } = useLanguage();
  const [open, setOpen] = useState(false);
  const [confirming, setConfirming] = useState(false);
  const [kicking, setKicking] = useState(false);
  // Escape/close + focus trap for the two dialogs (they are conditionally
  // mounted, so the hook is told when each is actually open).
  const kickingRef = useDialog<HTMLDivElement>(() => setKicking(false), kicking);
  const confirmingRef = useDialog<HTMLDivElement>(() => setConfirming(false), confirming);

  // The host cannot be voted out (the server refuses it too), and you cannot
  // vote for yourself.
  const kickable = (players ?? []).filter(
    (p) => p.id !== youId && p.connected && !p.isGameMaster,
  );
  const canKick = Boolean(onVoteKick) && kickable.length > 0;

  return (
    <>
      {/* Transparent scrim so a tap anywhere outside the panel closes it without
          dimming the game behind it. */}
      {open && (
        <div className="game-menu-scrim" onClick={() => setOpen(false)} />
      )}

      <div className="game-menu">
        <button
          className="secondary game-menu-button"
          onClick={() => setOpen((o) => !o)}
          aria-label={t("Menu")}
          aria-expanded={open}
        >
          ☰
        </button>

        {open && (
          <div className="game-menu-panel stack">
            <div className="game-menu-row">
              <SfxControl />
            </div>
            {isGameMaster && canForceAdvance && onForceAdvance && (
              <button
                className="ghost game-menu-item"
                onClick={() => {
                  setOpen(false);
                  onForceAdvance();
                }}
              >
                {t("Skip phase")}
              </button>
            )}
            {canKick && (
              <button
                className="ghost game-menu-item"
                onClick={() => {
                  setOpen(false);
                  setKicking(true);
                }}
              >
                {t("Vote to kick")}
              </button>
            )}
            <button
              className="ghost game-menu-item"
              onClick={() => {
                setOpen(false);
                setConfirming(true);
              }}
            >
              {isGameMaster ? t("Close game") : t("Exit game")}
            </button>
          </div>
        )}
      </div>

      {kicking && (
        <div className="modal-backdrop" onClick={() => setKicking(false)}>
          <div
            ref={kickingRef}
            role="dialog"
            aria-modal="true"
            aria-label={t("Vote to kick")}
            className="modal stack"
            style={{ width: 520, gap: 16 }}
            onClick={(e) => e.stopPropagation()}
          >
            <button
              className="ghost modal-x"
              onClick={() => setKicking(false)}
              aria-label={t("Cancel")}
            >
              ✕
            </button>
            <h2 className="title" style={{ fontSize: 22 }}>
              {t("Vote to kick")}
            </h2>
            <p className="muted" style={{ margin: 0, fontSize: 14 }}>
              {t("A player is removed once enough votes are in. The host's vote counts double.")}
            </p>
            <div className="stack" style={{ gap: 8 }}>
              {kickable.map((p) => {
                const votes = kickVotes?.[p.id] ?? 0;
                const needed = kickVotesNeeded ?? 0;
                return (
                  <div key={p.id} className="player-row">
                    <div className="row" style={{ gap: 8 }}>
                      <span className="roster-avatar" aria-hidden="true">
                        <img className="emoji-img" src={emojiUrl(p.emoji)} alt="" />
                      </span>
                      <strong>{p.name}</strong>
                      {votes > 0 && (
                        <span className="badge">
                          {votes}/{needed}
                        </span>
                      )}
                    </div>
                    <button
                      type="button"
                      className="secondary"
                      onClick={() => onVoteKick?.(p.id)}
                    >
                      {t("Vote")}
                    </button>
                  </div>
                );
              })}
            </div>
            <div className="row" style={{ justifyContent: "flex-end" }}>
              <button className="secondary" onClick={() => setKicking(false)}>
                {t("Done")}
              </button>
            </div>
          </div>
        </div>
      )}

      {confirming && (
        <div className="modal-backdrop" onClick={() => setConfirming(false)}>
          <div
            ref={confirmingRef}
            role="dialog"
            aria-modal="true"
            aria-label={isGameMaster ? t("Close game?") : t("Exit game?")}
            className="modal stack"
            style={{ width: 600, gap: 18 }}
            onClick={(e) => e.stopPropagation()}
          >
            <button
              className="ghost modal-x"
              onClick={() => setConfirming(false)}
              aria-label={t("Cancel")}
            >
              ✕
            </button>
            <h2 className="title" style={{ fontSize: 24 }}>
              {isGameMaster ? t("Close game?") : t("Exit game?")}
            </h2>
            <p className="muted" style={{ margin: 0 }}>
              {isGameMaster
                ? t("This ends the game for everyone and sends all players back to the home page.")
                : t("You'll go back to the home page. The other players keep playing.")}
            </p>
            <div className="row" style={{ gap: 10, alignItems: "stretch" }}>
              <button
                className="secondary"
                style={{ flex: 1 }}
                onClick={() => setConfirming(false)}
              >
                {t("Cancel")}
              </button>
              <button style={{ flex: 1 }} onClick={isGameMaster ? onClose : onLeave}>
                {isGameMaster ? t("Close game for everyone") : t("Exit game")}
              </button>
            </div>
          </div>
        </div>
      )}
    </>
  );
}
