import { randomBytes, randomUUID } from "crypto";

// Avoid ambiguous letters (no i/l/o) so codes are easy to read & share.
const ALPHABET = "abcdefghjkmnpqrstuvwxyz";

function group(len: number): string {
  const bytes = randomBytes(len);
  let out = "";
  for (let i = 0; i < len; i++) {
    out += ALPHABET[bytes[i] % ALPHABET.length];
  }
  return out;
}

/** Room code like "abr-tyr". */
export function generateRoomCode(): string {
  return `${group(3)}-${group(3)}`;
}

/** Opaque per-player session token for reconnection. */
export function generateToken(): string {
  return randomUUID();
}

/** Short player id. */
export function generatePlayerId(): string {
  return randomBytes(6).toString("hex");
}
