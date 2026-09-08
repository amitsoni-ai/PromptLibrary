import { getAccess } from "@/server/auth";
import { resolveScope } from "@/server/scope";
import { categoriesInScope } from "@/server/prompts";
import { ok, fail, requestId, log } from "@/server/http";
import { CategoriesResponseSchema } from "@/contracts/categories";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// GET /api/v2/categories — categories with live in-scope counts.
export async function GET(req: Request) {
  const rid = requestId(req);
  try {
    const access = await getAccess();
    const scope = resolveScope(access);
    const result = await categoriesInScope(scope);
    const body = CategoriesResponseSchema.parse(result);
    log(rid, { route: "categories", count: body.categories.length, mode: scope.mode });
    return ok(body, rid);
  } catch (e) {
    log(rid, { route: "categories", error: String((e as Error)?.message || e) });
    return fail(503, "no-backend", rid);
  }
}
