// Read-only check: is the Working with AI pack visible on a running site?
// Reads the page's built-in library (index.html #data-prompts) and the public
// GET /api/prompts feed of admin-console changes. Never writes anything.
//
//   node docs/collections/working-with-ai/check_live.mjs https://prompting.synottic.com
//   node docs/collections/working-with-ai/check_live.mjs http://localhost:8790
import fs from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const base = (process.argv[2] || "http://localhost:8790").replace(/\/+$/, "");
const HERE = dirname(fileURLToPath(import.meta.url));
const pilot = JSON.parse(fs.readFileSync(join(HERE, "import", "02_working_with_ai.json"), "utf8"));
const cleanup = JSON.parse(fs.readFileSync(join(HERE, "import", "01_cleanup.json"), "utf8"));

// Admin-console changes (optional: a site without a database has none).
let feed = { prompts: [], archivedIds: [], count: 0 };
try {
  const r = await fetch(base + "/api/prompts", { headers: { accept: "application/json" } });
  if (r.ok) feed = await r.json();
} catch { /* no feed: rely on the built-in library */ }
// Prompts baked into the build ship inside the page itself.
let baked = [];
try {
  const html = await (await fetch(base + "/", { headers: { accept: "text/html" } })).text();
  const m = html.match(/<script type="application\/json" id="data-prompts">([\s\S]*?)<\/script>/);
  if (m) baked = JSON.parse(m[1]);
} catch { /* page not readable: fall back to the feed only */ }
// Admin-console changes override the built-in copy, as in the app.
const byId = new Map([...baked, ...(feed.prompts || [])].map((p) => [p.id, p]));
const archived = new Set(feed.archivedIds || []);

console.log(`Site: ${base}   (built-in prompts: ${baked.length}, admin-managed changes: ${feed.count})\n`);

console.log("New prompts (Working with AI):");
let live = 0;
for (const p of pilot) {
  const rec = byId.get(p.id);
  const state = archived.has(p.id) ? "archived (hidden)" : rec ? "LIVE" : "not imported";
  if (state === "LIVE") live++;
  console.log(`  ${state === "LIVE" ? "✓" : "·"} ${p.id}  ${p.title}  [${state}]`);
}

console.log("\nClean-up fixes:");
let fixed = 0;
for (const c of cleanup) {
  const rec = byId.get(c.id);
  const same = rec && rec.originalPrompt && rec.originalPrompt.trim() === c.originalPrompt.trim();
  if (same) fixed++;
  console.log(`  ${same ? "✓" : "·"} ${c.id}  ${c.title}  [${same ? "fixed" : rec ? "edited, but not the approved text" : "not applied yet (old version still live)"}]`);
}

console.log(`\nSummary: ${live}/${pilot.length} new prompts live, ${fixed}/${cleanup.length} fixes applied.`);
console.log("Note: this shows what the whole library can see. Who sees them inside the Collection");
console.log("depends on the access code: sign in with an account that redeemed it to confirm.");
