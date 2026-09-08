import "server-only";
import { isNull, ne, and, or } from "drizzle-orm";
import { getDb, hasDb } from "@/db/client";
import { prompts as promptsTable } from "@/db/schema";
import { deriveFrameworkLevel } from "@/lib/framework";
import { PUBLIC_LANDING_IDS } from "@/lib/public-free";
import { PromptSchema, type Prompt } from "@/contracts/prompt";

// ─────────────────────────────────────────────────────────────────────────────
// Read-through catalogue cache. The prompt set is mostly static (~3.6k rows,
// ~7.7 MB), so we load it once from the `prompts` table (Postgres = canonical),
// enrich each row with its framework level (lib/framework.ts, mirroring the
// legacy client), and memoize the array PER SERVER INSTANCE with a TTL.
//
// Why a module cache, not unstable_cache: Next's data cache caps a single entry
// at 2 MB — the full catalogue is far larger — so unstable_cache would silently
// no-op and re-load on every request. A module-level cache has no size cap and
// keeps warm lambdas fast (p95 well under budget after the first load).
//
// Invalidation: TTL (300 s) + resetCatalogue(), which POST /api/v2/revalidate
// calls after a legacy admin prompt edit. (Per-instance; the TTL bounds cross-
// instance staleness.)
//
// Scale path: when the catalogue outgrows memory, push search to SQL ILIKE /
// pg_trgm (migrate/schema_v4.sql adds the trigram indexes). Documented.
// ─────────────────────────────────────────────────────────────────────────────

export const CATALOGUE_TAG = "catalogue";
const TTL_MS = 300_000;

function enrich(raw: unknown): Prompt | null {
  const parsed = PromptSchema.safeParse(raw);
  if (!parsed.success) return null;
  const p = parsed.data;
  if (p.lifecycle === "Archived") return null;
  const fw = deriveFrameworkLevel(p.originalPrompt);
  return {
    ...p,
    frameworkLevel: fw.frameworkLevel,
    frameworkCode: fw.frameworkCode,
    publicFree: PUBLIC_LANDING_IDS.includes(p.id),
  };
}

async function loadFromDb(): Promise<Prompt[]> {
  const db = await getDb();
  const rows = await db
    .select({ data: promptsTable.data })
    .from(promptsTable)
    .where(
      and(
        or(isNull(promptsTable.lifecycle), ne(promptsTable.lifecycle, "Archived")),
        isNull(promptsTable.archivedAt),
      ),
    );
  const out: Prompt[] = [];
  for (const r of rows) {
    const e = enrich(r.data);
    if (e) out.push(e);
  }
  return out;
}

async function loadFromSeed(): Promise<Prompt[]> {
  try {
    const seed = (await import("../../seed/prompts.json")).default as unknown[];
    const out: Prompt[] = [];
    for (const raw of seed) {
      const e = enrich(raw);
      if (e) out.push(e);
    }
    return out;
  } catch {
    return [];
  }
}

async function load(): Promise<Prompt[]> {
  let list: Prompt[];
  if (!hasDb()) {
    list = await loadFromSeed();
  } else {
    try {
      const rows = await loadFromDb();
      // A DB present but missing the prompts rows (fresh pglite, schema behind)
      // falls back to the committed seed — same spirit as legacy safeRows.
      list = rows.length ? rows : await loadFromSeed();
    } catch {
      list = await loadFromSeed();
    }
  }
  // Stable order: quality desc (nulls last), then id — the keyset order.
  list.sort((a, b) => (b.qualityScore ?? -1) - (a.qualityScore ?? -1) || a.id.localeCompare(b.id));
  return list;
}

// Per-instance memo. A single in-flight promise dedupes concurrent cold loads.
let _cache: Prompt[] | null = null;
let _at = 0;
let _inflight: Promise<Prompt[]> | null = null;

export async function getCatalogue(): Promise<Prompt[]> {
  if (_cache && Date.now() - _at < TTL_MS) return _cache;
  if (!_inflight) {
    _inflight = load().then((list) => {
      _cache = list;
      _at = Date.now();
      _inflight = null;
      return list;
    });
  }
  return _inflight;
}

export function resetCatalogue(): void {
  _cache = null;
  _at = 0;
}
