import "server-only";
import { getCatalogue } from "./catalogue";
import { getUsage } from "./usage";
import { getFavoriteIds } from "./state";
import { recommendedForYou, type Pick } from "@/lib/recommend";
import type { AccessPayload } from "./auth";
import type { Scope } from "./scope";
import type { Prompt } from "@/contracts/prompt";

// Static example chips for the hero search — 1:1 with src/part_app_2.js#SEARCH_EXAMPLES.
export const SEARCH_EXAMPLES = [
  "Write a launch email to unhappy customers",
  "Summarize this customer interview into key themes",
  "Draft a performance review for a strong but quiet teammate",
  "Turn this rough outline into a client-ready proposal",
  "Explain this technical concept to a non-technical exec",
];

function labelFromRole(role: string | null): string | null {
  if (!role || role === "general") return null;
  return role
    .split(/[_\s]+/)
    .map((w) => (w ? w[0]!.toUpperCase() + w.slice(1) : w))
    .join(" ");
}

export interface HomeData {
  recommended: Pick[];
  recentlyUsed: Prompt[];
  saved: Prompt[];
  searchExamples: string[];
}

/**
 * Compose everything the Home RSC page needs in one shot (mirrors how
 * src/part_app_3.js#renderHome pulls together recommendedForYou + usage +
 * favorites). Continue-card / program-companion are intentionally omitted this
 * slice — see MIGRATION.md Phase 3 notes (Learn/Practice-coupled,
 * ported alongside those screens).
 */
export async function getHomeData(access: AccessPayload, scope: Scope): Promise<HomeData> {
  const subject = access.userId ? `user:${access.userId}` : null;
  const [catalogue, usage, favoriteIds] = await Promise.all([
    getCatalogue(),
    subject ? getUsage(subject) : Promise.resolve({ counts: {}, recent: [] }),
    subject ? getFavoriteIds(subject) : Promise.resolve([]),
  ]);

  const byId = new Map(catalogue.map((p) => [p.id, p]));
  const seenIds = new Set(Object.keys(usage.counts));

  const recommended = recommendedForYou(
    {
      catalogue,
      scope,
      roleLabel: labelFromRole(access.role),
      favoriteIds,
      usageCounts: usage.counts,
      seenIds,
    },
    6,
  );

  const recentlyUsed = usage.recent
    .map((r) => byId.get(r.id))
    .filter((p): p is Prompt => !!p)
    .slice(0, 5);

  const saved = favoriteIds
    .map((id) => byId.get(id))
    .filter((p): p is Prompt => !!p)
    .slice(0, 5);

  return { recommended, recentlyUsed, saved, searchExamples: SEARCH_EXAMPLES };
}
