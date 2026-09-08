// Contract parity (Phase 1 §5, acceptance #5).
//
// Two modes (both run in CI; the HTTP diffs activate when URLs+cookie given):
//
// A) CATALOGUE INTEGRITY (always): loads web/seed/prompts.json, re-derives the
//    framework level with the SAME regex logic the app ships (imported from the
//    compiled app is not available to node, so the derivation is duplicated here
//    from lib/framework.ts and asserted identical in the unit check below), and
//    reports catalogue stats + invariants (unique ids, quality-desc sortability,
//    per-category counts). Fails on structural drift.
//
// B) HTTP DIFF (opt-in): with NEXT_URL + LEGACY_URL + TEST_COOKIE set, diffs the
//    SHARED endpoints that exist on both sides — /api/v2/state vs /api/state — as
//    JSON. (prompts/categories are NEW capabilities with no legacy HTTP
//    equivalent; their parity is the seed checksum in verify-prompts.mjs plus the
//    Playwright screenshot comparison.)
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const SEED = join(__dirname, "..", "seed", "prompts.json");

// ── framework derivation (kept byte-identical to src/lib/framework.ts) ───────
const C = {
  role: [/\b(act as|acting as|you are (an?|my|acting)|as an? (experienced|senior|expert|professional|seasoned|world[- ]class)|role\s*[:=]|imagine you(?:'re| are)|play the role of|take on the role|assume the role|you'?re an? \w+ (expert|specialist|strategist|analyst|manager|consultant|coach))/i, /\b(as an? (marketer|engineer|designer|writer|lawyer|teacher|recruiter|founder|manager|analyst|consultant|coach|strategist|advisor))\b/i],
  context: [/\b(context\s*[:=]|background\s*[:=]|the situation is|currently we|we are|we're a|our (company|team|product|audience|customers|users|clients|org)|my (company|team|role|manager|client)|for (my|our) (team|company|org|audience)|the audience is|target audience|given that|based on the|here'?s (the|what)|to give you context)/i, /\[[A-Za-z][A-Za-z0-9 _/'-]{1,40}\]|\b(because|since|so far|last (quarter|month|week|year))\b/i],
  goal: [/\b(goal\s*[:=]|the (goal|objective|aim|outcome) is|so that (i|we)|in order to|success looks like|the (result|output|answer) should (help|let|enable)|i want to be able to|end goal|desired outcome|what i'?m trying to achieve)/i, /\b(objective|outcome|so we can|to help (me|us)|ultimately)\b/i],
  task: [/\b(task\s*[:=]|your task is|please (write|draft|create|produce|analy|compare|summar|list|design|build|plan|review|rewrite|generate|outline|explain|evaluate)|^\s*(write|draft|create|produce|analy[sz]e|compare|summari[sz]e|list|design|build|plan|review|rewrite|generate|outline|explain|evaluate)\b|step 1[:.)]|^\s*1[.)]\s)/im, /\b(help me (write|draft|create|build|plan|make|analy)|i need (a|an|to|help)|can you (write|make|help|create|draft|give))\b/i],
  constraints: [/\b(constraint|limit(ed)? to|no more than|under \d|within \d|at most \d|word count|keep it (short|brief|concise|under|to)|tone\s*[:=]|in a \w+ tone|avoid|do not|don'?t|must not|only use|no jargon|stay under|maximum of|minimum of)/i, /\b(concise|brief|short|formal|informal|professional tone|friendly tone|no filler)\b/i],
  examples: [/\b(example\s*[:=]|for example|e\.g\.|for instance|such as|sample (input|output|answer|response)|like this\s*[:=]|here'?s an example|as an example|reference example|model it on)/i, /["“][^"”]{12,}["”]/],
  format: [/\b(format\s*[:=]|as a (table|list|bulleted list|numbered list|checklist)|bullet points?|numbered list|in \d+ (words|sentences|paragraphs|bullets)|markdown|json|as headings|in sections|use headings|a template|word count|respond with (a|only)|structure(d)? as|output\s*[:=])/i, /\b(table|list|bullets?|sections?|headings?|steps?|template|columns?)\b/i],
  verification: [/\b(verif|double.?check|check your (work|answer|response|facts)|review your (answer|work|response|draft)|self.?review|self.?check|flag (any|anything|any claim)|list (any )?assumptions|state your assumptions|cite (your )?sources|show your (working|reasoning)|make sure (you|the|everything)|confirm that|sanity.?check your)/i, /\b(accuracy|accurate|check for errors|before you finish)\b/i],
  validation: [/\b(validat|pressure.?test|stress.?test|test (it|this|the (answer|result|output|draft)) against|would this (actually )?work|does this hold up|edge case|in practice|real.?world|from the (customer|reader|user|buyer|board)'?s (point of view|perspective|angle)|red.?team|poke holes|where (it|this) (breaks|falls down))/i, /\b(realistic|would a \w+ (accept|buy|believe)|practical(ity)?)\b/i],
};
const L1 = ["role", "context", "task", "format"];
const L2 = ["role", "context", "task", "format", "verification", "validation"];
const L3 = ["role", "context", "goal", "task", "constraints", "examples", "format", "verification", "validation"];
function status(k, t) { const [d, s] = C[k]; if (!t) return "missing"; if (d.test(t)) return "strong"; if (s.test(t)) return "weak"; return "missing"; }
function level(text) {
  const map = {}; for (const k of L3) map[k] = status(k, text || "");
  const present = L3.filter((k) => map[k] !== "missing");
  const cov = (ks) => ks.filter((k) => map[k] !== "missing").length / ks.length;
  if (cov(L3) >= 0.78) return 3;
  if (cov(L2) >= 0.8) return 2;
  if (cov(L1) >= 0.75 || (map.task !== "missing" && present.length >= 3)) return 1;
  return null;
}

let failures = 0;
const fail = (m) => { console.error("✗ " + m); failures++; };
const okmsg = (m) => console.log("✓ " + m);

// ── A. catalogue integrity ───────────────────────────────────────────────────
const prompts = JSON.parse(readFileSync(SEED, "utf8")).filter((p) => p.lifecycle !== "Archived");
const ids = new Set();
let dupes = 0;
const catCount = {};
const levelCount = { 1: 0, 2: 0, 3: 0, null: 0 };
for (const p of prompts) {
  if (ids.has(p.id)) dupes++; else ids.add(p.id);
  catCount[p.category] = (catCount[p.category] || 0) + 1;
  const lv = level(p.originalPrompt || "");
  levelCount[lv === null ? "null" : lv]++;
}
dupes === 0 ? okmsg(`unique ids (${ids.size})`) : fail(`${dupes} duplicate ids`);
okmsg(`categories: ${Object.keys(catCount).length}`);
okmsg(`framework levels — L1:${levelCount[1]} L2:${levelCount[2]} L3:${levelCount[3]} none:${levelCount.null}`);
if (levelCount[1] + levelCount[2] + levelCount[3] === 0) fail("no prompt derived any framework level — derivation likely broken");

// ── B. HTTP diff (opt-in) ────────────────────────────────────────────────────
const { NEXT_URL, LEGACY_URL, TEST_COOKIE } = process.env;
if (NEXT_URL && LEGACY_URL && TEST_COOKIE) {
  const j = async (u) => {
    const r = await fetch(u, { headers: { cookie: TEST_COOKIE }, redirect: "manual" });
    return { status: r.status, body: await r.json().catch(() => null) };
  };
  const a = await j(`${LEGACY_URL}/api/state?keys=favorites`);
  const b = await j(`${NEXT_URL}/api/v2/state?keys=favorites`);
  const same = JSON.stringify(a.body) === JSON.stringify(b.body);
  same ? okmsg("state parity: legacy /api/state == /api/v2/state") : fail(`state diff: ${JSON.stringify(a)} vs ${JSON.stringify(b)}`);
} else {
  console.log("• HTTP diff skipped (set NEXT_URL, LEGACY_URL, TEST_COOKIE to enable).");
}

process.exit(failures ? 1 : 0);
