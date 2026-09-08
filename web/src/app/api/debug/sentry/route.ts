import { NextResponse } from "next/server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// Verifies server-side Sentry capture (acceptance #9). Inert unless
// SENTRY_DEBUG=1 — returns 404 otherwise, so it is safe to leave deployed.
// With the flag set, throwing here is captured by instrumentation.ts's
// onRequestError. Trigger the CLIENT test from a page by calling Sentry in the
// browser (documented in MIGRATION.md).
export async function GET() {
  if (process.env.SENTRY_DEBUG !== "1") {
    return NextResponse.json({ error: "not-found" }, { status: 404 });
  }
  throw new Error("Sentry server test error (SENTRY_DEBUG) — expected.");
}
