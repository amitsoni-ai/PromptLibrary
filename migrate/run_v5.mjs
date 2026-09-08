// Apply the v5 stackable-access-codes schema (additive) and seed the built-in
// SYNOTTIC-* codes into `access_codes` so a SIGNED-IN learner can redeem them
// (until now they only lived in `admin_codes`, reachable through the anonymous
// gate only — the "access code won't apply after login" bug).
//
//   DATABASE_URL=postgres://...   node migrate/run_v5.mjs
//   DATABASE_URL=pglite://memory  node migrate/run_v5.mjs      (dev/test)
//
// Idempotent. Run AFTER migrate/run_v3.mjs. Only ever inserts / refreshes rows
// tagged `managed_by = 'seed:catalogue'` — an admin-authored code with the same
// name (unlikely) is left untouched.
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const HERE = dirname(fileURLToPath(import.meta.url));

const { newId } = await import("../api/_crypto.js");

async function getSql() {
  const url = process.env.DATABASE_URL;
  if (!url) { console.error("Set DATABASE_URL"); process.exit(1); }
  if (/^pglite:/i.test(url)) {
    const { neon } = await import("../api/_pglite.js");
    return neon(url);
  }
  const { neon } = await import("@neondatabase/serverless");
  return neon(url);
}

export async function applyV5(sql) {
  const schema = readFileSync(join(HERE, "schema_v5.sql"), "utf8").replace(/--.*$/gm, "");
  for (const stmt of schema.split(/;\s*(?:\n|$)/).map((s) => s.trim()).filter(Boolean)) {
    await sql(stmt);
  }
}

// part_admin_seed.json is the canonical list of every built-in SYNOTTIC-* code
// (per-course, per-track, all-access + the two admin-console codes). It is the
// same data seeded into `admin_codes` by run.mjs.
function catalogueCodes() {
  const seed = JSON.parse(readFileSync(join(HERE, "..", "src", "part_admin_seed.json"), "utf8"));
  const out = [];
  for (const s of seed) {
    if (!s.code) continue;
    if (s.superAdmin || /-(SUPERADMIN|ADMIN)$/.test(s.code)) continue;   // admin-console keys, not a learner library
    const programIds = Array.isArray(s.programIds) ? s.programIds.filter((p) => p && p !== "prog-full") : [];
    const scopeType = s.fullLibrary ? "full" : programIds.length > 1 ? "track" : "program";
    out.push({
      code: s.code,
      label: s.note || null,
      orgName: s.orgName || "Synottic AI Institute",
      scopeType,
      programIds: scopeType === "full" ? [] : programIds,
      enabled: s.enabled !== false,
    });
  }
  // DEMO-2026 — "same as SYNOTTIC-ALL", full library, for demos (not in the seed file).
  if (!out.some((c) => c.code === "DEMO-2026")) {
    out.push({ code: "DEMO-2026", label: "Evaluation / demo — full library", orgName: "Synottic AI Institute",
      scopeType: "full", programIds: [], enabled: true });
  }
  return out;
}

export async function seedCatalogueAccessCodes(sql) {
  const codes = catalogueCodes();
  let inserted = 0, refreshed = 0, skipped = 0;
  for (const c of codes) {
    const existing = (await sql`select id, managed_by from access_codes where upper(code) = ${c.code.toUpperCase()} limit 1`)[0];
    if (existing && existing.managed_by !== "seed:catalogue") { skipped++; continue; }   // admin-authored — hands off
    if (existing) {
      await sql`update access_codes set
          label = ${c.label}, org_name = ${c.orgName}, scope_type = ${c.scopeType},
          program_ids = ${JSON.stringify(c.programIds)}, enabled = ${c.enabled},
          managed_by = 'seed:catalogue', updated_at = now()
        where id = ${existing.id}`;
      refreshed++;
    } else {
      await sql`insert into access_codes
          (id, code, label, org_name, scope_type, program_ids, category_ids, prompt_ids,
           feature_flags, license_type, max_redemptions, enabled, note, created_by, managed_by)
        values (${newId("acc")}, ${c.code}, ${c.label}, ${c.orgName},
           ${c.scopeType}, ${JSON.stringify(c.programIds)}, '[]'::jsonb, '[]'::jsonb,
           '{}'::jsonb, 'standard', null, ${c.enabled}, 'Built-in catalogue code', 'run_v5', 'seed:catalogue')`;
      inserted++;
    }
  }
  return { total: codes.length, inserted, refreshed, skipped };
}

async function run() {
  const t0 = Date.now();
  const sql = await getSql();
  console.log("→ schema_v5.sql");
  await applyV5(sql);
  console.log("→ seeding catalogue codes into access_codes");
  const r = await seedCatalogueAccessCodes(sql);
  console.log(`  ${r.inserted} inserted, ${r.refreshed} refreshed, ${r.skipped} left to admin (of ${r.total})`);
  const c = (await sql(`select
    (select count(*) from access_codes)::int access_codes,
    (select count(*) from access_codes where managed_by = 'seed:catalogue')::int catalogue_codes,
    (select count(*) from user_access_codes)::int user_access_codes`))[0];
  console.log(`✓ v5 done in ${((Date.now() - t0) / 1000).toFixed(1)}s`, c);
}

if (process.argv[1] && process.argv[1].endsWith("run_v5.mjs")) {
  run().catch((e) => { console.error(e); process.exit(1); });
}
