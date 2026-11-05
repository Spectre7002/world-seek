"use client";

// A stable, anonymous identity for the stats page and the leaderboard.
//
// This is deliberately NOT an account: it is a random id in localStorage, so
// clearing site data starts a fresh record. It is never sent to other players —
// the server only uses it to group finished games by player.

const STORAGE_KEY = "world-seek:player-key";

function randomKey(): string {
  // crypto.randomUUID is available in every browser this app targets, but a
  // fallback keeps the stats page working in an odd embedded webview.
  if (typeof crypto !== "undefined" && typeof crypto.randomUUID === "function") {
    return crypto.randomUUID();
  }
  return "pk-" + Math.random().toString(36).slice(2) + Date.now().toString(36);
}

/** The current player key, creating and persisting one on first use. */
export function getPlayerKey(): string {
  if (typeof window === "undefined") return "";
  try {
    const existing = window.localStorage.getItem(STORAGE_KEY);
    if (existing) return existing;
    const created = randomKey();
    window.localStorage.setItem(STORAGE_KEY, created);
    return created;
  } catch {
    // Private mode / storage disabled: fall back to a per-session key so the
    // game still works, even though the record will not persist.
    return randomKey();
  }
}

/** Drop the stored key. Used by the "reset my stats" control. */
export function clearPlayerKey(): void {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.removeItem(STORAGE_KEY);
  } catch {
    // Nothing to do — the key was never persisted.
  }
}
