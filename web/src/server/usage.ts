import "server-only";
import { sql } from "drizzle-orm";
import { getDb, hasDb } from "@/db/client";
import { activity } from "@/db/schema";
import type { UsageResponse } from "@/contracts/usage";

// Events that feed usage tracking (mirrors src/part_app_1.js#recordUsage —
// only opened/copied/tested are forwarded to Backend.logActivity for usage
// purposes; favorited/unfavorited are favorites, not usage).
const USAGE_EVENTS = ["opened", "copied", "tested"] as const;

const EMPTY: UsageResponse = { counts: {}, recent: [] };

/** Aggregate the caller's activity rows into { counts, recent } (subject-keyed). */
export async function getUsage(subject: string, recentLimit = 20): Promise<UsageResponse> {
  if (!hasDb()) return EMPTY;
  try {
    const db = await getDb();
    const rows = await db
      .select({
        promptId: activity.promptId,
        count: sql<number>`count(*)::int`,
        lastTs: sql<string>`max(${activity.ts})`,
      })
      .from(activity)
      .where(
        sql`${activity.subject} = ${subject} and ${activity.event} in (${sql.join(
          USAGE_EVENTS.map((e) => sql`${e}`),
          sql`, `,
        )}) and ${activity.promptId} is not null`,
      )
      .groupBy(activity.promptId);

    const counts: Record<string, number> = {};
    const withTs: { id: string; ts: number }[] = [];
    for (const r of rows) {
      if (!r.promptId) continue;
      counts[r.promptId] = Number(r.count) || 0;
      withTs.push({ id: r.promptId, ts: r.lastTs ? new Date(r.lastTs).getTime() : 0 });
    }
    withTs.sort((a, b) => b.ts - a.ts);
    return { counts, recent: withTs.slice(0, recentLimit) };
  } catch {
    return EMPTY;
  }
}
