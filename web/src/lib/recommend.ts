import { hashStr } from "./hash";
import { skillFor } from "./skill";
import type { Prompt } from "@/contracts/prompt";
import type { Scope } from "@/server/scope";

// ─────────────────────────────────────────────────────────────────────────────
// 1:1 port of src/part_app_3.js#recommendedForYou. Same weights/bonuses/penalty
// so the "why am I seeing this" reasons and ranking feel identical to legacy.
//
// Simplification (documented, not silent): legacy derives a function's bonus
// category set (`fnCats`) from a static client-side FUNCTIONS catalogue
// (api/_functions.js) as a FALLBACK mirror of what the backend already resolved
// onto the entitlement. We are DB-backed, so `scope.categories` (from
// getUserAccess().access.categoryIds) IS that already-resolved set — reusing it
// avoids porting the separate FUNCTIONS catalogue for an equivalent result.
// `isCurriculumPrompt` + `source === "Original Library"` collapse to a single
// `source === "Original Library"` check: the only non-"Original Library" source
// in the actual data is "Synottic Programs" (curriculum), so both legacy checks
// target the same 200 records.
// ─────────────────────────────────────────────────────────────────────────────

const LEVEL_RANK_LOW = { Beginner: 0, Intermediate: 1, Advanced: 2 } as const; // engaged < 4
const LEVEL_RANK_MID = { Intermediate: 0, Beginner: 1, Advanced: 1 } as const; // engaged < 15
const LEVEL_RANK_HIGH = { Advanced: 0, Intermediate: 1, Beginner: 2 } as const; // engaged >= 15

export interface RecommendInput {
  catalogue: Prompt[];
  scope: Scope;
  roleLabel: string | null; // display label for "Because you work in X", or null
  favoriteIds: string[];
  usageCounts: Record<string, number>;
  seenIds: Set<string>; // prompts already interacted with — excluded from the pool
}

export interface Pick {
  prompt: Prompt;
  reason: string;
}

export function recommendedForYou(input: RecommendInput, limit = 6): Pick[] {
  const { catalogue, scope, roleLabel, favoriteIds, usageCounts, seenIds } = input;

  const favRecs = favoriteIds.map((id) => catalogue.find((p) => p.id === id)).filter((p): p is Prompt => !!p);
  const savedCats = new Set(favRecs.map((r) => r.category));
  const savedSkills = new Set(favRecs.map((r) => skillFor(r.category)));

  const primary = new Set(scope.categories); // already-resolved function/collection categories
  const engaged = seenIds.size + favoriteIds.length;
  const levelRank: Record<string, number> = engaged < 4 ? LEVEL_RANK_LOW : engaged < 15 ? LEVEL_RANK_MID : LEVEL_RANK_HIGH;

  const pool = catalogue.filter(
    (r) => !seenIds.has(r.id) && r.lifecycle !== "Archived" && r.source === "Original Library",
  );

  const scored = pool.map((r) => {
    let s = (r.qualityScore || 0) * 0.25;
    let reason = "Popular in your library";
    const skill = skillFor(r.category);
    const inScopeFocus = scope.restricted && primary.has(r.category || "");

    if (savedCats.has(r.category || "") || savedSkills.has(skill)) {
      s += 12;
      reason = "Based on what you saved";
    }
    if (inScopeFocus) {
      s += roleLabel ? 18 : 10;
      if (reason === "Popular in your library") {
        reason = roleLabel ? `Because you work in ${roleLabel}` : "Central to your library";
      }
    }
    s -= (levelRank[r.difficulty || ""] ?? 1) * 8;
    s += hashStr(r.id) % 7;
    return { rec: r, reason, s };
  });

  scored.sort((a, b) => b.s - a.s);
  return scored.slice(0, limit).map((x) => ({ prompt: x.rec, reason: x.reason }));
}
