import { getDb, hasDb } from "@/db/client";
import { activity } from "@/db/schema";
import { getAccess, subjectFor } from "@/server/auth";
import { ok, fail, requestId, csrfOk, log } from "@/server/http";
import { ActivityRequestSchema } from "@/contracts/activity";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// POST /api/v2/activity — cookie-keyed event write (subject = 'user:'+id). Same
// `activity` table + event allow-list as legacy api/activity.js. Fire-and-forget:
// silently drops (204) when there is no DB / no auth / unknown event, exactly
// like legacy.
export async function POST(req: Request) {
  const rid = requestId(req);
  if (!hasDb()) return new Response(null, { status: 204 });
  if (!csrfOk(req)) return fail(403, "bad-csrf", rid);

  const access = await getAccess();
  const subject = subjectFor(access);
  if (!subject) return new Response(null, { status: 204 });

  let raw: unknown;
  try {
    raw = await req.json();
  } catch {
    return new Response(null, { status: 204 });
  }
  const parsed = ActivityRequestSchema.safeParse(raw);
  if (!parsed.success) return new Response(null, { status: 204 });

  try {
    const db = await getDb();
    await db.insert(activity).values({
      subject,
      code: null,
      orgId: null,
      programId: null,
      event: parsed.data.event,
      promptId: parsed.data.promptId ?? null,
      meta: (parsed.data.meta ?? {}) as object,
    });
    return ok({ ok: true as const }, rid, 202);
  } catch (e) {
    log(rid, { route: "activity", error: String((e as Error)?.message || e) });
    return new Response(null, { status: 204 });
  }
}
