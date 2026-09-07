// Apply the v3 function/collection scope schema (additive) and seed the
// per-function library-scope rows from the static catalogue.
//   DATABASE_URL=postgres://...   node migrate/run_v3.mjs
//   DATABASE_URL=pglite://memory  node migrate/run_v3.mjs      (dev/test)
//
// Idempotent. Run AFTER migrate/run_v2.mjs.
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

// The static FUNCTIONS catalogue in api/_functions.js IS the default per-function
// library scope. `function_scopes` holds ONLY admin overrides — a function with
// no row uses its built-in default (api/_funcscope.js#resolveFunctionScope), and
// "Reset to default" in the console deletes the row. So there is nothing to seed.

export async function applyV3(sql) {
  const schema = readFileSync(join(HERE, "schema_v3.sql"), "utf8").replace(/--.*$/gm, "");
  for (const stmt of schema.split(/;\s*(?:\n|$)/).map((s) => s.trim()).filter(Boolean)) {
    await sql(stmt);
  }
}

async function run() {
  const t0 = Date.now();
  const sql = await getSql();
  console.log("→ schema_v3.sql");
  await applyV3(sql);
  const c = (await sql(`select
    (select count(*) from function_scopes)::int function_scopes,
    (select count(*) from collections)::int collections`))[0];
  console.log(`✓ v3 done in ${((Date.now() - t0) / 1000).toFixed(1)}s`, c);
}

if (process.argv[1] && process.argv[1].endsWith("run_v3.mjs")) {
  run().catch((e) => { console.error(e); process.exit(1); });
}
