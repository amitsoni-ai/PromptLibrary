import { getAccess } from "@/server/auth";
import { resolveScope } from "@/server/scope";
import { listPrompts } from "@/server/prompts";
import { ok, fail, requestId, log } from "@/server/http";
import { PromptsListRequestSchema, PromptsListResponseSchema } from "@/contracts/prompts";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// GET /api/v2/prompts — paginated, searchable, scope-filtered list.
export async function GET(req: Request) {
  const rid = requestId(req);
  const started = Date.now();
  const url = new URL(req.url);
  const raw = Object.fromEntries(url.searchParams.entries());
  const parsed = PromptsListRequestSchema.safeParse(raw);
  if (!parsed.success) {
    return fail(400, "bad-query", rid, { field: parsed.error.issues[0]?.path.join(".") });
  }

  try {
    const access = await getAccess();
    const scope = resolveScope(access);
    const result = await listPrompts(scope, parsed.data);
    const body = PromptsListResponseSchema.parse({
      ...result,
      scope: { mode: scope.mode, restricted: scope.restricted, label: scope.label },
    });
    log(rid, { route: "prompts", ms: Date.now() - started, count: body.items.length, mode: scope.mode });
    return ok(body, rid);
  } catch (e) {
    log(rid, { route: "prompts", error: String((e as Error)?.message || e) });
    return fail(503, "no-backend", rid);
  }
}
