import { z } from "zod";

// POST /api/v2/activity — cookie-keyed event write. Event allow-list mirrors
// legacy api/activity.js EVENTS.
export const ACTIVITY_EVENTS = [
  "opened",
  "copied",
  "tested",
  "favorited",
  "unfavorited",
  "practice",
  "improved",
  "created",
  "search",
] as const;

export const ActivityRequestSchema = z.object({
  event: z.enum(ACTIVITY_EVENTS),
  promptId: z.string().max(120).optional(),
  meta: z.record(z.string(), z.unknown()).optional(),
});
export type ActivityRequest = z.infer<typeof ActivityRequestSchema>;

// Legacy returns 202 { ok:true } on accept, 204 (no body) when it silently
// drops (no auth / unknown event / no DB).
export const ActivityResponseSchema = z.object({ ok: z.literal(true) });
