import { z } from "zod";
import { PromptSchema, PromptCardSchema } from "./prompt";

// GET /api/v2/prompts — paginated, searchable, scope-filtered list.
export const PromptsListRequestSchema = z.object({
  q: z.string().trim().max(200).optional(),
  category: z.string().max(120).optional(),
  role: z.string().max(120).optional(),
  difficulty: z.enum(["Beginner", "Intermediate", "Advanced"]).optional(),
  template: z.coerce.boolean().optional(), // isTemplate only
  level: z.coerce.number().int().min(1).max(3).optional(), // framework level
  // Comma-separated prompt ids to restrict the list to (e.g. the caller's full
  // saved/favorites set). Combines with every other filter (AND) and still
  // participates in scope-checking + cursor pagination — this is how "Saved
  // only" surfaces the WHOLE saved set, not just whatever page happened to be
  // loaded client-side.
  ids: z.string().max(4000).optional(),
  cursor: z.string().optional(), // opaque cursor (base64)
  limit: z.coerce.number().int().min(1).max(100).default(30),
});
export type PromptsListRequest = z.infer<typeof PromptsListRequestSchema>;

export const PromptsListResponseSchema = z.object({
  items: z.array(PromptCardSchema),
  nextCursor: z.string().nullable(),
  total: z.number().int(), // total in scope after filters (for the header count)
  scope: z.object({
    mode: z.enum(["full", "program", "function", "collection", "preview"]),
    restricted: z.boolean(),
    label: z.string().nullable(),
  }),
});
export type PromptsListResponse = z.infer<typeof PromptsListResponseSchema>;

// GET /api/v2/prompts/[id]
export const PromptByIdResponseSchema = z.object({ prompt: PromptSchema });
export type PromptByIdResponse = z.infer<typeof PromptByIdResponseSchema>;
