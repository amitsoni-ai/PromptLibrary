import "server-only";
import { getCatalogue } from "./catalogue";
import { frameworkBadge } from "@/lib/framework";
import { PUBLIC_FREE_IDS, PUBLIC_PREMIUM_IDS } from "@/lib/public-free";
import type { Prompt } from "@/contracts/prompt";

// ─────────────────────────────────────────────────────────────────────────────
// Public marketing landing view-model. Built entirely from the in-memory
// catalogue cache (server/catalogue.ts) — no auth, no scope, no DB round-trip
// beyond the shared catalogue load. Served to logged-out `/` visitors when
// LANDING_V2 is on (middleware.ts + app/page.tsx).
//
// Two tiers of sample prompts:
//   • free    — the whole body ships to the client; the card has a copy button.
//   • premium — only a CLIPPED (~200 char) preview ships; the card blurs it and
//               shows a "Sign up to unlock" affordance and links to `/legacy`.
// The premium body is never sent to the browser.
// ─────────────────────────────────────────────────────────────────────────────

const PREVIEW_CHARS = 200;
const FREE_BODY_CHARS = 900; // generous — most templates are shorter than this

export interface LandingSampleBase {
  id: string;
  title: string;
  category: string;
  description: string | null;
  frameworkLevel: 1 | 2 | 3 | null;
  frameworkCode: string | null;
  frameworkBadge: string | null; // e.g. "L2 · R-C-T-F-V-V", or null
  isTemplate: boolean;
}

export interface LandingFreeSample extends LandingSampleBase {
  tier: "free";
  body: string; // full (or lightly capped) prompt text — safe to show + copy
  variables: string[];
}

export interface LandingPremiumSample extends LandingSampleBase {
  tier: "premium";
  preview: string; // clipped, ellipsised body — safe to show blurred
}

export interface LandingCategory {
  name: string;
  count: number;
}

export interface LandingData {
  counts: {
    prompts: number; // total non-archived prompts in the catalogue
    categories: number; // distinct categories
    frameworkLevels: { level: 1 | 2 | 3; count: number }[]; // L1 / L2 / L3 tallies
  };
  categories: LandingCategory[]; // every category + its prompt count, count desc
  freeSamples: LandingFreeSample[];
  premiumSamples: LandingPremiumSample[];
}

function tidy(s: string | null | undefined): string {
  return String(s ?? "").replace(/\r\n/g, "\n").replace(/[ \t]+\n/g, "\n").trim();
}

/** First ~n chars, on a word boundary, ellipsised. */
function clip(body: string | null | undefined, n: number): string {
  const text = tidy(body).replace(/\s+/g, " ");
  if (text.length <= n) return text;
  const cut = text.slice(0, n);
  const lastSpace = cut.lastIndexOf(" ");
  return (lastSpace > n * 0.6 ? cut.slice(0, lastSpace) : cut).trimEnd() + "…";
}

function base(p: Prompt): LandingSampleBase {
  const level = p.frameworkLevel ?? null;
  return {
    id: p.id,
    title: p.title,
    category: p.category,
    description: p.description ?? null,
    frameworkLevel: level,
    frameworkCode: p.frameworkCode ?? null,
    frameworkBadge: level ? frameworkBadge(level) : null,
    isTemplate: !!p.isTemplate,
  };
}

/** Order the picked prompts to match the curated id list. */
function inCuratedOrder(map: Map<string, Prompt>, ids: readonly string[]): Prompt[] {
  return ids.map((id) => map.get(id)).filter((p): p is Prompt => !!p);
}

export async function getLandingData(): Promise<LandingData> {
  const catalogue = await getCatalogue(); // already excludes Archived (enrich)
  const byId = new Map(catalogue.map((p) => [p.id, p]));

  const categoryCount = new Map<string, number>();
  const levelTally: Record<1 | 2 | 3, number> = { 1: 0, 2: 0, 3: 0 };
  for (const p of catalogue) {
    if (p.category) categoryCount.set(p.category, (categoryCount.get(p.category) ?? 0) + 1);
    if (p.frameworkLevel === 1 || p.frameworkLevel === 2 || p.frameworkLevel === 3) {
      levelTally[p.frameworkLevel] += 1;
    }
  }
  const categoryDirectory: LandingCategory[] = Array.from(categoryCount, ([name, count]) => ({
    name,
    count,
  })).sort((a, b) => b.count - a.count || a.name.localeCompare(b.name));

  const freeSamples: LandingFreeSample[] = inCuratedOrder(byId, PUBLIC_FREE_IDS).map((p) => ({
    ...base(p),
    tier: "free",
    body: clip(p.originalPrompt, FREE_BODY_CHARS),
    variables: (p.variables ?? []).slice(0, 12),
  }));

  const premiumSamples: LandingPremiumSample[] = inCuratedOrder(byId, PUBLIC_PREMIUM_IDS).map(
    (p) => ({
      ...base(p),
      tier: "premium",
      preview: clip(p.originalPrompt, PREVIEW_CHARS),
    }),
  );

  return {
    counts: {
      prompts: catalogue.length,
      categories: categoryDirectory.length,
      frameworkLevels: [
        { level: 1, count: levelTally[1] },
        { level: 2, count: levelTally[2] },
        { level: 3, count: levelTally[3] },
      ],
    },
    categories: categoryDirectory,
    freeSamples,
    premiumSamples,
  };
}
