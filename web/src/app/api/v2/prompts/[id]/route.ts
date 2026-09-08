import { getAccess } from "@/server/auth";
import { resolveScope } from "@/server/scope";
import { getPromptById } from "@/server/prompts";
import { ok, fail, requestId, log } from "@/server/http";
import { PromptByIdResponseSchema } from "@/contracts/prompts";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// GET /api/v2/prompts/[id] — single prompt (scope-checked; 404 if out of scope).
export async function GET(req: Request, ctx: { params: Promise<{ id: string }> }) {
  const rid = requestId(req);
  const { id } = await ctx.params;
  try {
    const access = await getAccess();
    const scope = resolveScope(access);
    const prompt = await getPromptById(scope, id);
    if (!prompt) return fail(404, "not-found", rid);
    const body = PromptByIdResponseSchema.parse({ prompt });
    log(rid, { route: "prompt", id, mode: scope.mode });
    return ok(body, rid);
  } catch (e) {
    log(rid, { route: "prompt", id, error: String((e as Error)?.message || e) });
    return fail(503, "no-backend", rid);
  }
}
