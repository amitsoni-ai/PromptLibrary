import "server-only";
import { and, eq, inArray } from "drizzle-orm";
import { getDb, hasDb } from "@/db/client";
import { learnerState } from "@/db/schema";
import { STATE_KEYS } from "@/contracts/state";

const KEYS = new Set<string>(STATE_KEYS);

/** Read a subset (or all) of a subject's learner_state rows. Used by both the
 *  /api/v2/state route and server-side RSC composers (e.g. server/home.ts) so
 *  the query lives in one place. */
export async function getState(
  subject: string,
  keys: string[] = [...KEYS],
): Promise<Record<string, unknown>> {
  if (!hasDb()) return {};
  const list = keys.filter((k) => KEYS.has(k));
  if (!list.length) return {};
  try {
    const db = await getDb();
    const rows = await db
      .select({ key: learnerState.key, value: learnerState.value })
      .from(learnerState)
      .where(and(eq(learnerState.subject, subject), inArray(learnerState.key, list)));
    const out: Record<string, unknown> = {};
    for (const r of rows) out[r.key] = r.value;
    return out;
  } catch {
    return {};
  }
}

/** Convenience: the caller's favorite prompt ids (empty array on any failure). */
export async function getFavoriteIds(subject: string): Promise<string[]> {
  const state = await getState(subject, ["favorites"]);
  const favorites = state.favorites;
  return Array.isArray(favorites) ? favorites.filter((x): x is string => typeof x === "string") : [];
}
