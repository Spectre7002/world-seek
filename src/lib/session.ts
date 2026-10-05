"use client";

export interface StoredSession {
  sessionToken: string;
  playerId: string;
}

function key(code: string): string {
  return `world-seek:${code.toLowerCase()}`;
}

export function saveSession(code: string, s: StoredSession): void {
  if (typeof window === "undefined") return;
  localStorage.setItem(key(code), JSON.stringify(s));
}

export function loadSession(code: string): StoredSession | null {
  if (typeof window === "undefined") return null;
  const raw = localStorage.getItem(key(code));
  if (!raw) return null;
  try {
    return JSON.parse(raw) as StoredSession;
  } catch {
    return null;
  }
}

export function clearSession(code: string): void {
  if (typeof window === "undefined") return;
  localStorage.removeItem(key(code));
}
