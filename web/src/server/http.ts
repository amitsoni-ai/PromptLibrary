import "server-only";
import { NextResponse } from "next/server";
import { randomUUID } from "node:crypto";

// ─────────────────────────────────────────────────────────────────────────────
// Response plumbing for /api/v2. Mirrors legacy api/_db.js#json (no-store) and
// the `{ error: <slug> }` envelope. Propagates x-request-id and emits one
// structured log line per request.
// ─────────────────────────────────────────────────────────────────────────────

export function requestId(req: Request): string {
  return req.headers.get("x-request-id") || randomUUID();
}

function withMeta(res: NextResponse, rid: string): NextResponse {
  res.headers.set("cache-control", "no-store");
  res.headers.set("x-request-id", rid);
  return res;
}

export function ok<T>(body: T, rid: string, status = 200): NextResponse {
  return withMeta(NextResponse.json(body, { status }), rid);
}

/** Legacy-compatible error envelope: { error: slug, ...extra }. */
export function fail(
  status: number,
  error: string,
  rid: string,
  extra?: Record<string, unknown>,
): NextResponse {
  return withMeta(NextResponse.json({ error, ...(extra || {}) }, { status }), rid);
}

export function log(
  rid: string,
  fields: Record<string, unknown>,
): void {
  try {
    // eslint-disable-next-line no-console
    console.log(JSON.stringify({ t: new Date().toISOString(), rid, ...fields }));
  } catch {
    /* never throw from logging */
  }
}

// Double-submit CSRF (matches api/_http.js#checkCsrf semantics): the syn_csrf
// cookie value must equal the x-csrf-token header for state-changing verbs.
export function csrfOk(req: Request): boolean {
  const cookie = req.headers.get("cookie") || "";
  const m = cookie.match(/(?:^|;\s*)syn_csrf=([^;]+)/);
  const cookieTok = m?.[1] ? decodeURIComponent(m[1]) : "";
  const headerTok = req.headers.get("x-csrf-token") || req.headers.get("x-xsrf-token") || "";
  return !!cookieTok && !!headerTok && cookieTok === headerTok;
}
