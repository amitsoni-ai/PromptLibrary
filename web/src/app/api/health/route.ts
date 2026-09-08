import { NextResponse } from "next/server";
import { sql } from "drizzle-orm";
import { getDb, hasDb } from "@/db/client";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// GET /api/health — liveness + DB ping. 200 { ok:true, db:"up" } when the DB
// answers; 200 { ok:true, db:"absent" } on a static/no-DB deploy; 503 on error.
export async function GET() {
  const started = Date.now();
  if (!hasDb()) {
    return NextResponse.json({ ok: true, db: "absent", ms: 0 }, { status: 200 });
  }
  try {
    const db = await getDb();
    await db.execute(sql`select 1`);
    return NextResponse.json({ ok: true, db: "up", ms: Date.now() - started });
  } catch (e) {
    return NextResponse.json(
      { ok: false, db: "down", error: String((e as Error)?.message || e) },
      { status: 503 },
    );
  }
}
