// Runs Synottic's own framework-level detector (src/part_framework.js#deriveFrameworkLevel)
// over prompt rows read from stdin: [{id, originalPrompt}] -> [{id, level, comps}].
// Usage: node check_framework.mjs <path to src/part_framework.js> < rows.json
import fs from "node:fs";
import vm from "node:vm";

const src = fs.readFileSync(process.argv[2], "utf8");
const ctx = { console, escapeHtml: (s) => String(s), window: {} };
vm.createContext(ctx);
vm.runInContext(src + "\n;globalThis.__derive = deriveFrameworkLevel;", ctx);

const rows = JSON.parse(fs.readFileSync(0, "utf8"));
const out = rows.map((r) => {
  const x = ctx.__derive({ originalPrompt: r.originalPrompt });
  return { id: r.id, level: x.frameworkLevel, comps: x.frameworkComponents };
});
process.stdout.write(JSON.stringify(out));
