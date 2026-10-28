// HorrorGuessr — persisted jumpscare preference (P7, §4.2).
//
// Mirrors the shape of `src/lib/sfx.ts`: a tiny localStorage-backed settings
// module. The jumpscare is on by default; the toggle in `HorrorFxControl` writes
// here, and the play shell reads it on mount.

const LS_JUMPSCARE_KEY = "ws-horror-jumpscare";

export function isJumpscareEnabled(): boolean {
  try {
    return localStorage.getItem(LS_JUMPSCARE_KEY) !== "off";
  } catch {
    return true;
  }
}

export function setJumpscareEnabled(enabled: boolean): void {
  try {
    localStorage.setItem(LS_JUMPSCARE_KEY, enabled ? "on" : "off");
  } catch {}
}
