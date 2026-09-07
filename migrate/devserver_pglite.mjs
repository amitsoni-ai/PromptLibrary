// Dev server with the full /api surface backed by an in-process Postgres
// (PGlite) + a freshly migrated v2 schema.
//
//   node migrate/devserver_pglite.mjs           # http://localhost:8790
//
// Reads prompt-library/.env if present (RESEND_API_KEY, EMAIL_TRANSPORT, …).
// With EMAIL_TRANSPORT=console (default) emails print here; with =resend they
// go through Resend AND a copy is kept at GET /api/dev/outbox.
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
const HERE = dirname(fileURLToPath(import.meta.url));
try { process.loadEnvFile(join(HERE, "..", ".env")); console.log("→ loaded .env"); }
catch { /* no .env — fine */ }

process.env.DATABASE_URL = process.env.DATABASE_URL || "pglite:///tmp/synottic-dev-pglite";
process.env.SESSION_SECRET = process.env.SESSION_SECRET || "dev-session-secret";
process.env.ADMIN_SECRET = process.env.ADMIN_SECRET || "SYNOTTIC-ADMIN";
process.env.EMAIL_TRANSPORT = process.env.EMAIL_TRANSPORT || (process.env.RESEND_API_KEY ? "resend" : "console");
process.env.APP_BASE_URL = process.env.APP_BASE_URL || "http://localhost:8790";
process.env.ADMIN_BOOTSTRAP_EMAIL = process.env.ADMIN_BOOTSTRAP_EMAIL || "admin@synottic.dev";
process.env.ADMIN_BOOTSTRAP_PASSWORD = process.env.ADMIN_BOOTSTRAP_PASSWORD || "adminDevPass123";
process.env.PORT = process.env.PORT || "8790";

import { readFileSync } from "node:fs";

const { db } = await import("../api/_db.js");
const { DEFAULT_FEATURES } = await import("../api/_access.js");
const { hashPassword, newId } = await import("../api/_crypto.js");

const sql = db();
console.log("→ applying schema_v2.sql to", process.env.DATABASE_URL);
const schema = readFileSync(join(HERE, "schema_v2.sql"), "utf8").replace(/--.*$/gm, "");
for (const stmt of schema.split(/;\s*(?:\n|$)/).map((s) => s.trim()).filter(Boolean)) await sql(stmt);
for (const f of DEFAULT_FEATURES) {
  await sql(
    `insert into feature_permissions (feature_key,label,description,public_ok,requires_verified,requires_entitlement,min_ai_level,sort)
     values ($1,$2,$3,$4,$5,$6,$7,$8) on conflict (feature_key) do nothing`,
    [f.feature_key, f.label, null, !!f.public_ok, f.requires_verified ?? true, f.requires_entitlement ?? false, f.min_ai_level || null, f.sort || 100]);
}
const adminCnt = (await sql`select count(*)::int as n from admin_users`)[0].n;
if (!adminCnt) {
  const be = process.env.ADMIN_BOOTSTRAP_EMAIL.toLowerCase();
  await sql(`insert into admin_users (id,email,email_norm,password_hash,name,admin_role,status,created_by)
             values ($1,$2,$3,$4,'Dev Super Admin','SUPER_ADMIN','active','devserver')`,
    [newId("adm"), be, be, await hashPassword(process.env.ADMIN_BOOTSTRAP_PASSWORD)]);
  console.log(`→ admin: ${be} / ${process.env.ADMIN_BOOTSTRAP_PASSWORD}`);
}
// a demo access code learners can redeem
await sql(`insert into access_codes (id,code,label,org_name,scope_type,license_type,enabled,created_by)
           values ($1,'DEMO-LEARNER','Demo','Synottic','full','trial',true,'devserver')
           on conflict (code) do nothing`, [newId("acc")]);
console.log("→ access code: DEMO-LEARNER (full)");
console.log(`→ email: transport=${process.env.EMAIL_TRANSPORT} from=${process.env.EMAIL_FROM || "(default)"}` +
  (process.env.EMAIL_TRANSPORT === "resend" ? `  key=${(process.env.RESEND_API_KEY || "").slice(0, 8)}…` : ""));

await import("../devserver.mjs");
