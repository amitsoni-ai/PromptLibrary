// Apply the v6 social sign-in schema (additive): the `user_identities` table
// that links Google / Microsoft accounts to learners.
//
//   DATABASE_URL=postgres://...   node migrate/run_v6.mjs
//   DATABASE_URL=pglite://memory  node migrate/run_v6.mjs      (dev/test)
//
// Idempotent. Run AFTER migrate/run_v5.mjs.
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const HERE = dirname(fileURLToPath(import.meta.url));

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

const sql = await getSql();
const schema = readFileSync(join(HERE, "schema_v6.sql"), "utf8").replace(/--.*$/gm, "");
for (const stmt of schema.split(/;\s*(?:\n|$)/).map((s) => s.trim()).filter(Boolean)) await sql(stmt);
console.log("✓ schema_v6 applied (user_identities)");
