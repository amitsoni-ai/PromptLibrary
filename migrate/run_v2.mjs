// Apply the v2 identity/access schema (additive) and seed reference data.
//   DATABASE_URL=postgres://...        node migrate/run_v2.mjs
//   DATABASE_URL=pglite://memory       node migrate/run_v2.mjs      (dev/test)
//
// Optional env:
//   ADMIN_BOOTSTRAP_EMAIL / ADMIN_BOOTSTRAP_PASSWORD  -> creates the first SUPER_ADMIN
//   SEED_DEMO_ACCESS_CODE=1                            -> inserts a DEMO-LEARNER code
//
// Idempotent. Run AFTER migrate/run.mjs (v1 taxonomy/prompts).
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const HERE = dirname(fileURLToPath(import.meta.url));
const url = process.env.DATABASE_URL;
if (!url) { console.error("Set DATABASE_URL"); process.exit(1); }

async function getSql() {
  if (/^pglite:/i.test(url)) {
    const { neon } = await import("../api/_pglite.js");
    return neon(url);
  }
  const { neon } = await import("@neondatabase/serverless");
  return neon(url);
}

const { DEFAULT_FEATURES } = await import("../api/_access.js");
const { hashPassword, newId } = await import("../api/_crypto.js");

const FEATURE_META = {
  "library.preview":   { desc: "A handful of sample prompts, visible while signed out.", verified: false, ent: false },
  "account.manage":    { desc: "View and edit your own profile.", verified: false, ent: false },
  "library.full":      { desc: "The complete prompt library for your program(s).", verified: true, ent: true },
  "prompt.copy":       { desc: "Copy or run protected prompts.", verified: true, ent: true },
  "prompt.save":       { desc: "Save prompts to your account.", verified: true, ent: false },
  "practice":          { desc: "Guided practice with feedback.", verified: true, ent: true },
  "learning":          { desc: "Learn modules and the prompt framework.", verified: true, ent: true },
  "my_program":        { desc: "Your assigned program view.", verified: true, ent: true },
  "recommendations":   { desc: "Role- and level-based recommendations.", verified: true, ent: false },
  "progress_tracking": { desc: "Track lessons, practice and streaks.", verified: true, ent: false },
  "advanced_ai":       { desc: "Advanced AI features for intermediate+ learners.", verified: true, ent: true },
};

async function run() {
  const t0 = Date.now();
  const sql = await getSql();

  console.log("→ schema_v2.sql");
  const schema = readFileSync(join(HERE, "schema_v2.sql"), "utf8").replace(/--.*$/gm, "");
  for (const stmt of schema.split(/;\s*(?:\n|$)/).map((s) => s.trim()).filter(Boolean)) {
    await sql(stmt);
  }

  console.log(`→ feature_permissions (${DEFAULT_FEATURES.length})`);
  for (const f of DEFAULT_FEATURES) {
    const meta = FEATURE_META[f.feature_key] || {};
    await sql(
      `insert into feature_permissions (feature_key, label, description, public_ok, requires_verified, requires_entitlement, min_ai_level, sort)
       values ($1,$2,$3,$4,$5,$6,$7,$8)
       on conflict (feature_key) do update set label=excluded.label, description=excluded.description,
         public_ok=excluded.public_ok, requires_verified=excluded.requires_verified,
         requires_entitlement=excluded.requires_entitlement, min_ai_level=excluded.min_ai_level, sort=excluded.sort`,
      [f.feature_key, f.label, meta.desc || null, !!f.public_ok,
       meta.verified ?? f.requires_verified ?? true, meta.ent ?? f.requires_entitlement ?? false,
       f.min_ai_level || null, f.sort || 100]);
  }

  const be = (process.env.ADMIN_BOOTSTRAP_EMAIL || "").toLowerCase().trim();
  const bp = process.env.ADMIN_BOOTSTRAP_PASSWORD || "";
  if (be && bp) {
    const exists = await sql(`select 1 from admin_users where email_norm = $1 limit 1`, [be]);
    if (!exists.length) {
      await sql(
        `insert into admin_users (id, email, email_norm, password_hash, name, admin_role, status, created_by)
         values ($1,$2,$3,$4,'Super Admin','SUPER_ADMIN','active','run_v2')`,
        [newId("adm"), be, be, await hashPassword(bp)]);
      console.log(`→ admin_users: created SUPER_ADMIN ${be}`);
    } else {
      console.log(`→ admin_users: ${be} already exists (left unchanged)`);
    }
  } else {
    console.log("→ admin_users: no ADMIN_BOOTSTRAP_EMAIL/PASSWORD — skipping (create via /api/admin/session bootstrap or SQL)");
  }

  if (process.env.SEED_DEMO_ACCESS_CODE === "1") {
    await sql(
      `insert into access_codes (id, code, label, org_name, scope_type, license_type, enabled, note, created_by)
       values ($1,'DEMO-LEARNER','Demo learner access','Synottic AI Institute','full','trial',true,'Seeded by run_v2','run_v2')
       on conflict (code) do nothing`, [newId("acc")]);
    console.log("→ access_codes: DEMO-LEARNER (full, trial)");
  }

  const c = (await sql(`select
    (select count(*) from users)::int users,
    (select count(*) from admin_users)::int admins,
    (select count(*) from feature_permissions)::int features,
    (select count(*) from access_codes)::int access_codes`))[0];
  console.log(`✓ v2 done in ${((Date.now() - t0) / 1000).toFixed(1)}s`, c);
}

run().catch((e) => { console.error(e); process.exit(1); });
