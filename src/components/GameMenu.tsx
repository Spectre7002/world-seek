"use client";

import { useState } from "react";
import SfxControl from "./SfxControl";

interface Props {
  isGameMaster: boolean;
  onLeave: () => void;
  onClose: () => void;
}

/**
 * Top-right menu button. Tapping it opens a small panel that tucks away the
 * exit/leave action (previously a loose button in the bottom-left corner). The
 * host closes the game for everyone; everyone else just leaves. Either way a
 * confirmation dialog guards against accidental taps before anything happens.
 */
export default function GameMenu({ isGameMaster, onLeave, onClose }: Props) {
  const [open, setOpen] = useState(false);
  const [confirming, setConfirming] = useState(false);

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
          aria-label="Menu"
          aria-expanded={open}
        >
          ☰
        </button>

        {open && (
          <div className="game-menu-panel stack">
            <div className="game-menu-row">
              <SfxControl />
            </div>
            <button
              className="ghost game-menu-item"
              onClick={() => {
                setOpen(false);
                setConfirming(true);
              }}
            >
              {isGameMaster ? "Close game" : "Exit game"}
            </button>
          </div>
        )}
      </div>

      {confirming && (
        <div className="modal-backdrop" onClick={() => setConfirming(false)}>
          <div
            className="modal stack"
            style={{ width: 600, gap: 18 }}
            onClick={(e) => e.stopPropagation()}
          >
            <button
              className="ghost modal-x"
              onClick={() => setConfirming(false)}
              aria-label="Cancel"
            >
              ✕
            </button>
            <h2 className="title" style={{ fontSize: 24 }}>
              {isGameMaster ? "Close game?" : "Exit game?"}
            </h2>
            <p className="muted" style={{ margin: 0 }}>
              {isGameMaster
                ? "This ends the game for everyone and sends all players back to the home page."
                : "You'll go back to the home page. The other players keep playing."}
            </p>
            <div className="row" style={{ gap: 10, alignItems: "stretch" }}>
              <button
                className="secondary"
                style={{ flex: 1 }}
                onClick={() => setConfirming(false)}
              >
                Cancel
              </button>
              <button style={{ flex: 1 }} onClick={isGameMaster ? onClose : onLeave}>
                {isGameMaster ? "Close game for everyone" : "Exit game"}
              </button>
            </div>
          </div>
        </div>
      )}
    </>
  );
}
