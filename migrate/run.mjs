// Apply schema.sql and seed Neon from the built data parts.
//   DATABASE_URL=postgres://...  node migrate/run.mjs [--reset]
//
// --reset drops all app tables first (destructive). Without it the run is
// idempotent: taxonomy/prompts/seed codes are upserted, built-in admin codes
// are inserted only if their code isn't present, learner_state/activity are
// left untouched.
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { neon, Client } from "@neondatabase/serverless";

const HERE = dirname(fileURLToPath(import.meta.url));
const SRC = join(HERE, "..", "src");
const RESET = process.argv.includes("--reset");

if (!process.env.DATABASE_URL) {
  console.error("Set DATABASE_URL (Neon pooled connection string).");
  process.exit(1);
}
const sql = neon(process.env.DATABASE_URL);
const readJson = (p) => JSON.parse(readFileSync(join(SRC, p), "utf8"));

function extractDataBlock(id) {
  const html = readFileSync(join(SRC, "data_blocks.html"), "utf8");
  const m = html.match(new RegExp(`id="${id}">\\s*([\\s\\S]*?)</script>`));
  if (!m) throw new Error("data block not found: " + id);
  return JSON.parse(m[1]);
}

async function run() {
  console.log("→ schema");
  // DDL goes through a Client (simple-query protocol handles multi-statement
  // scripts and needs no parameters); seeding below uses the neon() tagged
  // template with bound parameters.
  const client = new Client(process.env.DATABASE_URL);
  await client.connect();
  try {
    if (RESET) {
      await client.query(`drop table if exists activity, learner_state, prompts, seed_codes,
        admin_codes, learners, cohorts, programs, orgs cascade`);
    }
    await client.query(readFileSync(join(HERE, "schema.sql"), "utf8"));
  } finally {
    await client.end();
  }

  const model = readJson("part_orgmodel.json");
  const curriculum = readJson("part_curriculum.json");
  const adminSeed = readJson("part_admin_seed.json");
  const libPrompts = extractDataBlock("data-prompts");

  console.log(`→ orgs (${model.organizations.length})`);
  for (const o of model.organizations) {
    await sql`insert into orgs (id, name, short_name, data)
              values (${o.id}, ${o.name}, ${o.shortName || null}, ${JSON.stringify(o)})
              on conflict (id) do update set name = excluded.name,
                short_name = excluded.short_name, data = excluded.data`;
  }

  console.log(`→ programs (${model.programs.length})`);
  for (const p of model.programs) {
    await sql`insert into programs (id, org_id, name, track, scope, access_code, data)
              values (${p.id}, ${p.orgId}, ${p.name}, ${p.track || null},
                      ${p.scope || "program"}, ${p.accessCode || null}, ${JSON.stringify(p)})
              on conflict (id) do update set org_id = excluded.org_id, name = excluded.name,
                track = excluded.track, scope = excluded.scope,
                access_code = excluded.access_code, data = excluded.data`;
  }

  console.log(`→ cohorts (${model.cohorts.length})`);
  for (const c of model.cohorts) {
    await sql`insert into cohorts (id, program_id, name, starts_on, data)
              values (${c.id}, ${c.programId}, ${c.name}, ${c.startsOn || null}, ${JSON.stringify(c)})
              on conflict (id) do update set program_id = excluded.program_id,
                name = excluded.name, starts_on = excluded.starts_on, data = excluded.data`;
  }

  console.log(`→ learners (${(model.learners || []).length})`);
  for (const l of model.learners || []) {
    await sql`insert into learners (id, cohort_id, name, email, data)
              values (${l.id}, ${l.cohortId || null}, ${l.name || null}, ${l.email || null}, ${JSON.stringify(l)})
              on conflict (id) do update set cohort_id = excluded.cohort_id,
                name = excluded.name, email = excluded.email, data = excluded.data`;
  }

  console.log(`→ seed_codes (${model.accessCodes.length})`);
  for (const a of model.accessCodes) {
    await sql`insert into seed_codes (code, cohort_id, learner_id, kind)
              values (${a.code}, ${a.cohortId}, ${a.learnerId || null}, ${a.kind || "cohort"})
              on conflict (code) do update set cohort_id = excluded.cohort_id,
                learner_id = excluded.learner_id, kind = excluded.kind`;
  }

  console.log(`→ admin_codes (built-in ${adminSeed.length}, insert-if-absent)`);
  for (const s of adminSeed) {
    await sql`insert into admin_codes (id, code, org_name, domain, industry, functions, roles,
                program_ids, full_library, super_admin, enabled, note, seeded)
              values (${s.id}, ${s.code}, ${s.orgName || null}, ${s.domain || null},
                      ${s.industry || null}, ${JSON.stringify(s.functions || [])},
                      ${JSON.stringify(s.roles || [])}, ${JSON.stringify(s.programIds || [])},
                      ${!!s.fullLibrary}, ${!!s.superAdmin}, ${s.enabled !== false},
                      ${s.note || null}, true)
              on conflict (code) do nothing`;
  }

  const allPrompts = libPrompts.concat(curriculum);
  console.log(`→ prompts (${allPrompts.length}) — one insert per row, ~a few seconds`);
  let n = 0;
  for (const r of allPrompts) {
    await sql`insert into prompts (id, source_number, title, category, source, program_id,
                lifecycle, quality_score, data)
              values (${r.id}, ${r.sourceNumber ?? null}, ${r.title ?? null}, ${r.category ?? null},
                      ${r.source ?? null}, ${r.programId ?? null}, ${r.lifecycle ?? null},
                      ${typeof r.qualityScore === "number" ? r.qualityScore : null},
                      ${JSON.stringify(r)})
              on conflict (id) do update set title = excluded.title, category = excluded.category,
                source = excluded.source, program_id = excluded.program_id,
                lifecycle = excluded.lifecycle, quality_score = excluded.quality_score,
                data = excluded.data`;
    if (++n % 500 === 0) console.log(`   ${n}/${allPrompts.length}`);
  }

  const counts = await sql`select
    (select count(*) from orgs) orgs, (select count(*) from programs) programs,
    (select count(*) from cohorts) cohorts, (select count(*) from seed_codes) seed_codes,
    (select count(*) from admin_codes) admin_codes, (select count(*) from prompts) prompts`;
  console.log("✓ done", counts[0]);
}

run().catch((e) => { console.error(e); process.exit(1); });
