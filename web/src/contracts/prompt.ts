import { z } from "zod";

// The prompt record the Library consumes. Fields mirror the `prompts.data`
// jsonb (see src/prompts_authored.json) plus the two derived framework fields
// (computed via lib/framework.ts, never stored). Extra keys are passed through
// so we never drop data the legacy card might show.
export const PromptSchema = z
  .object({
    id: z.string(),
    title: z.string(),
    category: z.string(),
    description: z.string().optional().nullable(),
    useCase: z.string().optional().nullable(),
    originalPrompt: z.string().optional().nullable(),
    role: z.string().optional().nullable(),
    promptType: z.string().optional().nullable(),
    outcome: z.string().optional().nullable(),
    difficulty: z.string().optional().nullable(),
    isTemplate: z.boolean().optional().nullable(),
    tags: z.array(z.string()).optional().default([]),
    variables: z.array(z.string()).optional().default([]),
    qualityScore: z.number().optional().nullable(),
    lifecycle: z.string().optional().nullable(),
    source: z.string().optional().nullable(),
    programId: z.string().optional().nullable(),
    aiTool: z.string().optional().nullable(),
    // Derived (lib/framework.ts) — L1/L2/L3 or null.
    frameworkLevel: z.union([z.literal(1), z.literal(2), z.literal(3), z.null()]).optional(),
    frameworkCode: z.string().nullable().optional(),
    // Derived (lib/public-free.ts) — true iff this row is a curated free sample
    // shown (locked) on the public marketing landing page. Set in
    // server/catalogue.ts#enrich; not part of the list card projection.
    publicFree: z.boolean().optional(),
  })
  .passthrough();

export type Prompt = z.infer<typeof PromptSchema>;

// A slimmer card projection for list payloads (keeps responses small — no full
// originalPrompt body in the list).
export const PromptCardSchema = PromptSchema.pick({
  id: true,
  title: true,
  category: true,
  description: true,
  role: true,
  difficulty: true,
  isTemplate: true,
  tags: true,
  qualityScore: true,
  frameworkLevel: true,
  frameworkCode: true,
});

export type PromptCard = z.infer<typeof PromptCardSchema>;
