// Deterministic pseudo-random numbers for seeded games.
//
// A seeded game must produce the same location sequence on every client and on
// every server restart, so `Math.random()` cannot be used. This is a small
// xmur3 + mulberry32 pair: xmur3 turns the seed string into a 32-bit state, and
// mulberry32 turns that state into a stream of floats in [0, 1).
//
// It is deliberately NOT cryptographic. The seed is public (it is shown in the
// lobby and can be shared), so there is nothing to protect — the only property
// that matters is that the same seed always yields the same sequence.

/** Hash a seed string into a 32-bit unsigned integer. */
export function hashSeed(seed: string): number {
  let h = 1779033703 ^ seed.length;
  for (let i = 0; i < seed.length; i++) {
    h = Math.imul(h ^ seed.charCodeAt(i), 3432918353);
    h = (h << 13) | (h >>> 19);
  }
  h = Math.imul(h ^ (h >>> 16), 2246822507);
  h = Math.imul(h ^ (h >>> 13), 3266489909);
  return (h ^= h >>> 16) >>> 0;
}

/**
 * A deterministic float generator in [0, 1). The returned function advances an
 * internal 32-bit state, so calling it N times always yields the same N values
 * for the same seed.
 */
export function seededRandom(seed: string): () => number {
  let a = hashSeed(seed);
  return function next(): number {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/**
 * Pick an index in [0, length) for a given seed and cursor.
 *
 * Stateless on purpose: the room stores only a cursor, so a location can be
 * recomputed from (seed, cursor) at any time — including after a restart, and
 * including by a client that wants to verify the sequence. Advancing a shared
 * generator instead would make the result depend on how many times it had been
 * called, which is exactly the kind of hidden state that breaks on reconnect.
 */
export function seededIndex(seed: string, cursor: number, length: number): number {
  if (length <= 0) return 0;
  const rand = seededRandom(seed + ":" + cursor);
  // Discard the first value: mulberry32's first output is weakly mixed for
  // small seeds, and one extra step costs nothing.
  rand();
  return Math.floor(rand() * length) % length;
}

/** A short, human-shareable seed (e.g. "k3f9-q2"). */
export function generateSeed(): string {
  const alphabet = "abcdefghjkmnpqrstuvwxyz23456789";
  let out = "";
  for (let i = 0; i < 6; i++) {
    out += alphabet[Math.floor(Math.random() * alphabet.length)];
  }
  return out.slice(0, 3) + "-" + out.slice(3);
}

/**
 * The seed for today's daily challenge, in UTC so every timezone plays the same
 * game. Format: "daily-YYYY-MM-DD".
 */
export function dailySeed(now: number = Date.now()): string {
  const d = new Date(now);
  const y = d.getUTCFullYear();
  const m = String(d.getUTCMonth() + 1).padStart(2, "0");
  const day = String(d.getUTCDate()).padStart(2, "0");
  return "daily-" + y + "-" + m + "-" + day;
}
