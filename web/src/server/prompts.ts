import "server-only";
import { getCatalogue } from "./catalogue";
import type { Scope } from "./scope";
import type { Prompt, PromptCard } from "@/contracts/prompt";
import type { PromptsListRequest } from "@/contracts/prompts";

// ─────────────────────────────────────────────────────────────────────────────
// Query layer over the cached catalogue. All filtering/scoping/pagination is in
// JS to mirror the legacy client (scopedLibrary + filters) exactly, but returns
// small paginated projections. Keyset cursor over the catalogue's stable sort
// (quality desc, id asc).
// ─────────────────────────────────────────────────────────────────────────────

function isModelSpecific(p: Prompt): boolean {
  const flags = (p as { flags?: { modelSpecific?: unknown } }).flags;
  return !!(flags && flags.modelSpecific);
}

/** Apply the learner's scope to the full catalogue (already sorted). */
function inScope(catalogue: Prompt[], scope: Scope): Prompt[] {
  if (scope.mode === "full") return catalogue;

  if (scope.mode === "preview") {
    return catalogue.filter((p) => !isModelSpecific(p)).slice(0, 24);
  }

  const cats = new Set(scope.categories);
  const linked = new Set(scope.promptIds);
  const out = catalogue.filter((p) => (p.category ? cats.has(p.category) : false) || linked.has(p.id));
  // Legacy fallback: a scope that resolves to nothing shows the preview set.
  return out.length ? out : catalogue.filter((p) => !isModelSpecific(p)).slice(0, 24);
}

function matchesFilters(p: Prompt, f: PromptsListRequest, idSet: Set<string> | null): boolean {
  if (idSet && !idSet.has(p.id)) return false;
  if (f.category && p.category !== f.category) return false;
  if (f.role && String(p.role || "").toLowerCase() !== f.role.toLowerCase()) return false;
  if (f.difficulty && p.difficulty !== f.difficulty) return false;
  if (f.template && !p.isTemplate) return false;
  if (f.level && p.frameworkLevel !== f.level) return false;
  if (f.q) {
    const hay = (
      (p.title || "") +
      " " +
      (p.description || "") +
      " " +
      (p.useCase || "") +
      " " +
      (p.originalPrompt || "") +
      " " +
      (p.tags || []).join(" ")
    ).toLowerCase();
    // Multi-word AND match (every query word must appear somewhere in the
    // combined haystack). This is NOT the legacy relevance engine
    // (src/part_app_1.js#searchPrompts does per-word IDF-weighted scoring +
    // synonym expansion + semantic category routing) — that full port is
    // Phase 3 (see MIGRATION.md). This bounded fix restores correct
    // multi-word queries (a single-substring match broke on e.g. "churn
    // email") without taking on the relevance engine mid-verification.
    const words = f.q.toLowerCase().split(/\s+/).filter(Boolean);
    if (!words.every((w) => hay.includes(w))) return false;
  }
  return true;
}

// Cursor = base64("<qualityScore>|<id>"); items strictly AFTER it in sort order.
function encodeCursor(p: Prompt): string {
  return Buffer.from(`${p.qualityScore ?? -1}|${p.id}`, "utf8").toString("base64url");
}
function afterCursor(list: Prompt[], cursor: string | undefined): number {
  if (!cursor) return 0;
  let key: { q: number; id: string } | null = null;
  try {
    const [q, id] = Buffer.from(cursor, "base64url").toString("utf8").split("|");
    key = { q: Number(q), id: id ?? "" };
  } catch {
    return 0;
  }
  // First index strictly after the cursor per the (quality desc, id asc) order.
  for (let i = 0; i < list.length; i++) {
    const p = list[i]!;
    const q = p.qualityScore ?? -1;
    const after = q < key.q || (q === key.q && p.id > key.id);
    if (after) return i;
  }
  return list.length;
}

function toCard(p: Prompt): PromptCard {
  return {
    id: p.id,
    title: p.title,
    category: p.category,
    description: p.description ?? null,
    role: p.role ?? null,
    difficulty: p.difficulty ?? null,
    isTemplate: p.isTemplate ?? null,
    tags: p.tags ?? [],
    qualityScore: p.qualityScore ?? null,
    frameworkLevel: p.frameworkLevel ?? null,
    frameworkCode: p.frameworkCode ?? null,
  };
}

export interface ListResult {
  items: PromptCard[];
  nextCursor: string | null;
  total: number;
}

export async function listPrompts(scope: Scope, filters: PromptsListRequest): Promise<ListResult> {
  const catalogue = await getCatalogue();
  const scoped = inScope(catalogue, scope);
  const idSet = filters.ids
    ? new Set(
        filters.ids
          .split(",")
          .map((s) => s.trim())
          .filter(Boolean),
      )
    : null;
  const filtered = scoped.filter((p) => matchesFilters(p, filters, idSet));
  const start = afterCursor(filtered, filters.cursor);
  const page = filtered.slice(start, start + filters.limit);
  const nextIndex = start + filters.limit;
  const nextCursor = nextIndex < filtered.length ? encodeCursor(page[page.length - 1]!) : null;
  return { items: page.map(toCard), nextCursor, total: filtered.length };
}

export async function getPromptById(scope: Scope, id: string): Promise<Prompt | null> {
  const catalogue = await getCatalogue();
  const scoped = inScope(catalogue, scope);
  return scoped.find((p) => p.id === id) ?? null;
}

export async function categoriesInScope(
  scope: Scope,
): Promise<{ categories: { category: string; count: number }[]; total: number }> {
  const catalogue = await getCatalogue();
  const scoped = inScope(catalogue, scope);
  const counts = new Map<string, number>();
  for (const p of scoped) {
    if (!p.category) continue;
    counts.set(p.category, (counts.get(p.category) ?? 0) + 1);
  }
  const categories = Array.from(counts, ([category, count]) => ({ category, count })).sort(
    (a, b) => b.count - a.count || a.category.localeCompare(b.category),
  );
  return { categories, total: scoped.length };
}
