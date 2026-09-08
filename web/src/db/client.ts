import "server-only";
import { drizzle as drizzleNeon } from "drizzle-orm/neon-http";
import { neon } from "@neondatabase/serverless";
import * as schema from "./schema";

// ─────────────────────────────────────────────────────────────────────────────
// Drizzle client. Mirrors legacy api/_db.js: a real postgres:// URL uses the
// Neon serverless HTTP driver; pglite://memory (or pglite:///path) swaps in an
// in-process Postgres so dev/CI need no network or secrets. Read-only path — the
// /api/v2 endpoints only SELECT.
// ─────────────────────────────────────────────────────────────────────────────

export type Db = ReturnType<typeof drizzleNeon<typeof schema>>;

let _db: Db | null = null;
let _pglitePromise: Promise<Db> | null = null;

function url(): string {
  const u = process.env.DATABASE_URL;
  if (!u) {
    const e = new Error("DATABASE_URL is not set");
    (e as { code?: string }).code = "NO_DB";
    throw e;
  }
  return u;
}

async function makePglite(u: string): Promise<Db> {
  // Dynamic import so the neon path never pulls PGlite into the bundle.
  const { PGlite } = await import("@electric-sql/pglite");
  const { drizzle: drizzlePglite } = await import("drizzle-orm/pglite");
  const loc = u.replace(/^pglite:(\/\/)?/i, "") || "memory";
  const client = new PGlite(loc === "memory" ? undefined : loc);
  return drizzlePglite(client, { schema }) as unknown as Db;
}

/**
 * Get the Drizzle client. Async because the PGlite driver is loaded lazily.
 * The Neon branch resolves synchronously under the hood but we keep one shape.
 */
export async function getDb(): Promise<Db> {
  if (_db) return _db;
  const u = url();
  if (/^pglite:/i.test(u)) {
    if (!_pglitePromise) _pglitePromise = makePglite(u);
    _db = await _pglitePromise;
    return _db;
  }
  _db = drizzleNeon(neon(u), { schema });
  return _db;
}

export function hasDb(): boolean {
  return !!process.env.DATABASE_URL;
}

export { schema };
