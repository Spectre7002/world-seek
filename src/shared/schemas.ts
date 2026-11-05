import { z } from "zod";

/**
 * Runtime schemas for untrusted socket payloads.
 *
 * These replace the point-by-point hand-rolled guards in `validate.ts`. zod
 * objects strip unknown keys by default, which is the same protection
 * `pickLatLng` / `pickHidingSpot` / `pickLiveView` used to provide by copying
 * only the known fields out. The socket layer runs each payload through
 * `safeParse` and drops the packet when it fails.
 */

export const latLngSchema = z.object({
  lat: z.number().finite().min(-90).max(90),
  lng: z.number().finite().min(-180).max(180),
});

export const hidingSpotSchema = z.object({
  lat: z.number().finite().min(-90).max(90),
  lng: z.number().finite().min(-180).max(180),
  panoId: z.string().min(1).max(256),
});

export const liveViewSchema = z.object({
  panoId: z.string().min(1).max(256),
  heading: z.number().finite().min(-720).max(720),
  pitch: z.number().finite().min(-90).max(90),
  zoom: z.number().finite().min(0).max(5).default(1),
});

export const codeSchema = z.string().max(32);
export const nameSchema = z.string().max(24);

export const createPayloadSchema = z.object({
  gmName: z.string().max(24).optional(),
  gmEmoji: z.string().max(16).optional(),
  settings: z.unknown().optional(),
  playerKey: z.string().max(64).optional(),
});

export const joinPayloadSchema = z.object({
  code: z.string().max(32),
  name: z.string().max(24).optional(),
  emoji: z.string().max(16).optional(),
  playerKey: z.string().max(64).optional(),
});

export const reconnectPayloadSchema = z.object({
  code: z.string().max(32),
  sessionToken: z.string().max(64),
});

export const settingsPayloadSchema = z.object({
  settings: z.unknown().optional(),
});

export const chatPayloadSchema = z.object({
  text: z.string().max(500),
});

export const reactionPayloadSchema = z.object({
  reaction: z.string().max(8),
});

export const spellPayloadSchema = z.object({
  spell: z.string().max(32),
});

export const voteKickPayloadSchema = z.object({
  targetId: z.string().max(64),
});

export const statsPayloadSchema = z.object({
  playerKey: z.string().max(64),
});

export const leaderboardPayloadSchema = z.object({
  mapId: z.string().max(80).optional(),
  mode: z.enum(["solo", "hp", "multiplayer"]).optional(),
  limit: z.number().finite().optional(),
});

export const voiceSignalSchema = z.object({
  to: z.string().max(64),
  sdp: z.unknown().optional(),
  candidate: z.unknown().optional(),
});
