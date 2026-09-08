import { z } from "zod";

// GET /api/v2/state?keys=favorites — cookie-keyed learner state (subject
// 'user:'+id). Response mirrors legacy /api/state: a flat object keyed by state
// key. We expose the Library-relevant keys.
export const STATE_KEYS = ["favorites", "usage"] as const;
export type StateKey = (typeof STATE_KEYS)[number];

export const StateResponseSchema = z
  .object({
    favorites: z.unknown().optional(),
    usage: z.unknown().optional(),
  })
  .passthrough();
export type StateResponse = z.infer<typeof StateResponseSchema>;

// PUT /api/v2/state — { key, value } | { states: {...} } (legacy shape).
export const StatePutRequestSchema = z.union([
  z.object({ key: z.enum(STATE_KEYS), value: z.unknown() }),
  z.object({ states: z.record(z.string(), z.unknown()) }),
]);
export type StatePutRequest = z.infer<typeof StatePutRequestSchema>;

export const StatePutResponseSchema = z.object({ ok: z.literal(true) });
