// Guardrail: Drizzle INTROSPECTS ONLY. Fail CI if drizzle-kit ever emits
// generated migration files (a sign someone ran generate/push instead of pull).
import { readdirSync, existsSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const DRIZZLE_DIR = join(__dirname, "..", "drizzle");

if (!existsSync(DRIZZLE_DIR)) {
  console.log("✓ no drizzle/ output directory — introspection only, as required.");
  process.exit(0);
}

const offenders = readdirSync(DRIZZLE_DIR, { recursive: true }).filter((f) =>
  /\.sql$/i.test(String(f)) || String(f).endsWith("_journal.json"),
);

if (offenders.length) {
  console.error("✗ Generated Drizzle migration artifacts found (introspection-only rule):");
  for (const f of offenders) console.error("   drizzle/" + f);
  console.error("Remove them — the DB is owned by migrate/*.sql. Use `npm run db:pull` only.");
  process.exit(1);
}
console.log("✓ drizzle/ contains no generated migrations.");
process.exit(0);
