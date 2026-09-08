import { getAccess, subjectFor } from "@/server/auth";
import { getUsage } from "@/server/usage";
import { ok, fail, requestId, log } from "@/server/http";
import { UsageResponseSchema } from "@/contracts/usage";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// GET /api/v2/usage — cookie-keyed { counts, recent } aggregate of the caller's
// activity (opened/copied/tested), for the Home "Recommended for you" and
// "Recently used" widgets. See server/usage.ts for the exact semantics.
export async function GET(req: Request) {
  const rid = requestId(req);
  const access = await getAccess();
  const subject = subjectFor(access);
  if (!subject) return fail(401, "auth", rid);

  try {
    const usage = await getUsage(subject);
    const body = UsageResponseSchema.parse(usage);
    log(rid, { route: "usage", promptCount: Object.keys(body.counts).length });
    return ok(body, rid);
  } catch (e) {
    log(rid, { route: "usage", error: String((e as Error)?.message || e) });
    return fail(503, "no-backend", rid);
  }
}
