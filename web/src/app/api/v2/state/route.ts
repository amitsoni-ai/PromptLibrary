import { getDb, hasDb } from "@/db/client";
import { learnerState } from "@/db/schema";
import { getAccess, subjectFor } from "@/server/auth";
import { getState } from "@/server/state";
import { ok, fail, requestId, csrfOk, log } from "@/server/http";
import { STATE_KEYS, StatePutRequestSchema } from "@/contracts/state";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const KEYS = new Set<string>(STATE_KEYS);

// GET /api/v2/state?keys=favorites,usage — cookie-keyed learner state
// (subject = 'user:'+id). This is the AUTH.md "next step": server-side sync for
// account users, reusing the existing learner_state table. Additive, no auth
// change. Mirrors legacy /api/state's flat { key: value } response shape.
export async function GET(req: Request) {
  const rid = requestId(req);
  if (!hasDb()) return fail(503, "no-backend", rid);
  const access = await getAccess();
  const subject = subjectFor(access);
  if (!subject) return fail(401, "auth", rid);

  const url = new URL(req.url);
  const wanted = String(url.searchParams.get("keys") || "")
    .split(",")
    .map((s) => s.trim())
    .filter((k) => KEYS.has(k));
  const list = wanted.length ? wanted : [...KEYS];

  try {
    const out = await getState(subject, list);
    return ok(out, rid);
  } catch (e) {
    log(rid, { route: "state", op: "get", error: String((e as Error)?.message || e) });
    return fail(503, "no-backend", rid);
  }
}

// PUT /api/v2/state — { key, value } | { states: {...} } (legacy shape).
export async function PUT(req: Request) {
  const rid = requestId(req);
  if (!hasDb()) return fail(503, "no-backend", rid);
  if (!csrfOk(req)) return fail(403, "bad-csrf", rid);
  const access = await getAccess();
  const subject = subjectFor(access);
  if (!subject) return fail(401, "auth", rid);

  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return fail(400, "bad-body", rid);
  }
  const parsed = StatePutRequestSchema.safeParse(body);
  if (!parsed.success) return fail(400, "bad-body", rid);
  const states =
    "states" in parsed.data ? parsed.data.states : { [parsed.data.key]: parsed.data.value };

  try {
    const db = await getDb();
    for (const [key, value] of Object.entries(states)) {
      if (!KEYS.has(key)) continue;
      await db
        .insert(learnerState)
        .values({ subject, key, value: value as object })
        .onConflictDoUpdate({
          target: [learnerState.subject, learnerState.key],
          set: { value: value as object, updatedAt: new Date() },
        });
    }
    return ok({ ok: true as const }, rid);
  } catch (e) {
    log(rid, { route: "state", op: "put", error: String((e as Error)?.message || e) });
    return fail(503, "no-backend", rid);
  }
}
