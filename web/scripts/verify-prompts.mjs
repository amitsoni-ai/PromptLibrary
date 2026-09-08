// Data source of truth (Phase 1 §8).
//   1. Extract the canonical prompt set from the legacy #data-prompts block.
//   2. Write web/seed/prompts.json (the no-DB catalogue fallback + parity ref).
//   3. If DATABASE_URL is set, verify the `prompts` table matches the block
//      (row count + id checksum) and report drift.
//
// Run:  node scripts/verify-prompts.mjs         (export only)
//       DATABASE_URL=… node scripts/verify-prompts.mjs   (export + verify)
import { readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { createHash } from "node:crypto";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const REPO = join(__dirname, "..", ".."); // web/scripts -> repo root
const INDEX = join(REPO, "index.html");
const SEED = join(__dirname, "..", "seed", "prompts.json");

function extractBlock(html, id) {
  const open = html.match(new RegExp(`<script[^>]*id="${id}"[^>]*>`));
  if (!open) throw new Error(`#${id} not found in index.html`);
  const start = html.indexOf(">", open.index) + 1;
  const end = html.indexOf("</script>", start);
  return JSON.parse(html.slice(start, end).trim());
}

function checksum(ids) {
  return createHash("sha256").update(ids.slice().sort().join("\n")).digest("hex");
}

const html = readFileSync(INDEX, "utf8");
const prompts = extractBlock(html, "data-prompts");
if (!Array.isArray(prompts)) throw new Error("data-prompts is not an array");

const ids = prompts.map((p) => p.id);
const sum = checksum(ids);

mkdirSync(dirname(SEED), { recursive: true });
writeFileSync(SEED, JSON.stringify(prompts));
console.log(`✓ exported ${prompts.length} prompts → web/seed/prompts.json`);
console.log(`  block checksum (sorted ids): ${sum.slice(0, 16)}…`);

if (!process.env.DATABASE_URL) {
  console.log("• DATABASE_URL not set — skipping DB verification.");
  process.exit(0);
}

// Verify against the prompts table (non-archived).
const { neon } = await import("@neondatabase/serverless");
const sql = neon(process.env.DATABASE_URL);
const rows = await sql`
  select id from prompts
  where (lifecycle is distinct from 'Archived') and archived_at is null`;
const dbIds = rows.map((r) => r.id);
const dbSum = checksum(dbIds);

const blockSet = new Set(ids);
const dbSet = new Set(dbIds);
const missingInDb = ids.filter((id) => !dbSet.has(id));
const extraInDb = dbIds.filter((id) => !blockSet.has(id));

console.log(`\nprompts table: ${dbIds.length} rows  checksum ${dbSum.slice(0, 16)}…`);
if (dbSum === sum) {
  console.log("✓ MATCH — Postgres is in sync with the data-prompts block.");
  process.exit(0);
}
console.log("✗ DRIFT:");
console.log(`  in block not in DB: ${missingInDb.length}${missingInDb.length ? " e.g. " + missingInDb.slice(0, 5).join(", ") : ""}`);
console.log(`  in DB not in block: ${extraInDb.length}${extraInDb.length ? " e.g. " + extraInDb.slice(0, 5).join(", ") : ""}`);
process.exit(1);
