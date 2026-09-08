import { z } from "zod";

// GET /api/v2/usage — cookie-keyed aggregate of the `activity` table, mirroring
// the shape of legacy client-side Store.getUsage(): counts (per-prompt
// interaction count) + recent (distinct prompt ids, most-recently-used first).
// Only opened/copied/tested feed usage (see recordUsage in
// src/part_app_1.js:233 — favorited/unfavorited are favorites, not usage).
export const UsageResponseSchema = z.object({
  counts: z.record(z.string(), z.number().int()),
  recent: z.array(z.object({ id: z.string(), ts: z.number() })),
});
export type UsageResponse = z.infer<typeof UsageResponseSchema>;
