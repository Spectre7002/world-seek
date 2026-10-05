"use client";

const REPO_URL = "https://github.com/heyivanvilla/world-seek";

/** First of next month, in the reader's locale — when the meter rolls over. */
function nextResetLabel(): string {
  const now = new Date();
  const reset = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() + 1, 1));
  return reset.toLocaleDateString(undefined, {
    month: "long",
    day: "numeric",
    timeZone: "UTC",
  });
}

/**
 * Shown when the month's Google Maps budget is spent. Every map and Street View
 * panorama in this game is a metered Google API call paid for out of one
 * person's pocket, so the site closes rather than running up a bill — and points
 * people at the source, since self-hosting with your own key has no such cap.
 */
export default function BudgetClosed({ inGame = false }: { inGame?: boolean }) {
  return (
    <div className="center-screen">
      <div className="stack" style={{ width: 420, gap: 20 }}>
        <div className="stack" style={{ gap: 10, textAlign: "center" }}>
          <span className="eyebrow" style={{ fontSize: 18 }}>
            Back on {nextResetLabel()}
          </span>
          <h1 className="title" style={{ fontSize: 44 }}>
            Out of map budget 🌍
          </h1>
          <p className="pullquote" style={{ margin: 0, fontSize: 18, color: "var(--text-dim)" }}>
            {inGame
              ? "This game can't start — the month's Google Maps budget just ran out."
              : "World Seek has used up this month's Google Maps budget."}
          </p>
        </div>

        <div className="card stack">
          <span className="eyebrow">What happened</span>
          <p className="muted" style={{ margin: 0, fontSize: 23 }}>
            Every map and Street View panorama in this game is a paid Google API
            call, funded out of pocket. There's a monthly cap so it can't run
            away — and it's been reached. The meter resets on the 1st.
          </p>
        </div>

        <div className="card stack">
          <span className="eyebrow">Play it anyway 🛠️</span>
          <p className="muted" style={{ margin: 0, fontSize: 23 }}>
            World Seek is open source. Run your own copy with your own Google
            Maps key and there's no cap but the one you set.
          </p>
          <a href={REPO_URL} target="_blank" rel="noopener noreferrer">
            <button type="button" style={{ width: "100%" }}>
              Get the source code
            </button>
          </a>
        </div>

        <p className="muted" style={{ textAlign: "center", fontSize: 13, margin: 0 }}>
          Made by{" "}
          <a href="https://ivanvilla.com" target="_blank" rel="noopener noreferrer">
            Ivan Villa
          </a>
        </p>
      </div>
    </div>
  );
}
