import { revalidateTag } from "next/cache";
import { ok, fail, requestId } from "@/server/http";
import { CATALOGUE_TAG, resetCatalogue } from "@/server/catalogue";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// POST /api/v2/revalidate  { secret }  — busts the catalogue cache after a
// legacy admin prompt edit (/api/admin/prompts). Secret-guarded so it can't be
// abused. Wire the legacy admin save to call this (optional) or rely on the
// 300s time-based revalidate.
export async function POST(req: Request) {
  const rid = requestId(req);
  const secret = process.env.REVALIDATE_SECRET;
  let body: { secret?: string } = {};
  try {
    body = (await req.json()) as { secret?: string };
  } catch {
    /* empty body ok */
  }
  const provided = body.secret || req.headers.get("x-revalidate-secret") || "";
  if (!secret || provided !== secret) return fail(401, "unauthorized", rid);
  resetCatalogue();
  revalidateTag(CATALOGUE_TAG);
  return ok({ ok: true as const, revalidated: CATALOGUE_TAG }, rid);
}
