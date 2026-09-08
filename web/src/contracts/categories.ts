import { z } from "zod";

// GET /api/v2/categories — categories with LIVE in-scope counts (matches the
// legacy scopeInfo() count semantics: only categories present in the caller's
// scoped library, counted after archived/model-specific exclusions).
export const CategoryCountSchema = z.object({
  category: z.string(),
  count: z.number().int(),
});
export type CategoryCount = z.infer<typeof CategoryCountSchema>;

export const CategoriesResponseSchema = z.object({
  categories: z.array(CategoryCountSchema),
  total: z.number().int(),
});
export type CategoriesResponse = z.infer<typeof CategoriesResponseSchema>;
