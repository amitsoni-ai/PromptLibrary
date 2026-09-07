// Create or update an admin console account (spec §8 RBAC).
//
//   DATABASE_URL="postgres://…-pooler…/neondb?sslmode=require" \
//   ADMIN_EMAIL="info@synottic.com" ADMIN_PASSWORD="…" \
//   [ADMIN_ROLE=SUPER_ADMIN] [ADMIN_NAME="Info"] \
//   node migrate/make_admin.mjs
//
// - Upserts into `admin_users` by normalised email; existing row -> password +
//   role reset, status forced to `active`, lockout cleared.
// - Password is scrypt-hashed (never stored in plain text).
// - Works against Neon OR a local `pglite://…` URL (same driver switch as the app).
// - Warns if a LEARNER account (`users`) shares the email — the unified
//   /api/auth/login checks learners first, so that would shadow the admin.
import { ADMIN_ROLES } from "../api/_validate.js";
import { hashPassword, newId } from "../api/_crypto.js";

const url = process.env.DATABASE_URL;
const email = (process.env.ADMIN_EMAIL || process.argv[2] || "").trim().toLowerCase();
const password = process.env.ADMIN_PASSWORD || process.argv[3] || "";
const role = (process.env.ADMIN_ROLE || "SUPER_ADMIN").toUpperCase();
const name = process.env.ADMIN_NAME || email.split("@")[0] || "Admin";

if (!url) { console.error("Set DATABASE_URL"); process.exit(1); }
if (!email || !password) { console.error("Set ADMIN_EMAIL and ADMIN_PASSWORD"); process.exit(1); }
if (!ADMIN_ROLES.includes(role)) { console.error(`ADMIN_ROLE must be one of: ${ADMIN_ROLES.join(", ")}`); process.exit(1); }
if (password.length < 5) { console.error("Password must be at least 5 characters"); process.exit(1); }

async function getSql() {
  if (/^pglite:/i.test(url)) return (await import("../api/_pglite.js")).neon(url);
  return (await import("@neondatabase/serverless")).neon(url);
}

const sql = await getSql();

// schema_v2 must already be applied (run_v2.mjs). Fail clearly if not.
try { await sql`select 1 from admin_users limit 1`; }
catch { console.error("admin_users table not found — run `node migrate/run_v2.mjs` first."); process.exit(1); }

const hash = await hashPassword(password);
const existing = (await sql`select id, admin_role, status from admin_users where email_norm = ${email} limit 1`)[0];

if (existing) {
  await sql`update admin_users set password_hash = ${hash}, admin_role = ${role}, name = ${name},
            status = 'active', failed_logins = 0, locked_until = null, updated_at = now()
            where id = ${existing.id}`;
  console.log(`✓ updated admin ${email} -> role ${role}, status active  (was ${existing.admin_role}/${existing.status})`);
} else {
  const id = newId("adm");
  await sql`insert into admin_users (id, email, email_norm, password_hash, name, admin_role, status, created_by)
            values (${id}, ${email}, ${email}, ${hash}, ${name}, ${role}, 'active', 'make_admin')`;
  console.log(`✓ created admin ${email} -> role ${role}  (id ${id})`);
}

const learner = (await sql`select id, account_status from users where email_norm = ${email} limit 1`)[0];
if (learner) {
  console.warn(`\n⚠  A LEARNER account also exists for ${email} (id ${learner.id}, ${learner.account_status}).`);
  console.warn(`   /api/auth/login checks learners first, so signing in with this email would`);
  console.warn(`   open the learner app, not the admin console. Use a different email for the`);
  console.warn(`   admin, or delete the learner row:  delete from users where email_norm = '${email}';`);
}

const count = (await sql`select count(*)::int as n from admin_users where admin_role = 'SUPER_ADMIN' and status = 'active'`)[0].n;
console.log(`\nactive SUPER_ADMINs: ${count}`);
process.exit(0);   // pglite's WASM instance keeps the event loop alive otherwise
