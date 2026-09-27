// Dry run of the whole load against an in-memory Postgres (PGlite), using the
// real admin handlers. Nothing touches Neon. Run from the repo root:
//
//   node docs/collections/working-with-ai/load_test.mjs
//
// Proves: clean-up import updates 3 live prompts in place (no new rows); pilot
// import creates 20 new prompts with the planned ids; re-import is a no-op
// update; the public delta feed carries the fixes; the admin Collection accepts
// the 20 pinned ids and a code redeemed by a learner resolves to that set.
process.env.DATABASE_URL = "pglite://memory";
process.env.NODE_ENV = "test";
process.env.EMAIL_TRANSPORT = "console";
process.env.EMAIL_SILENT = "1";
process.env.SESSION_SECRET = "loadtest-secret";
process.env.ADMIN_SECRET = "loadtest-admin";
process.env.APP_BASE_URL = "http://test.local";
process.env.ADMIN_BOOTSTRAP_EMAIL = "root@synottic.test";
process.env.ADMIN_BOOTSTRAP_PASSWORD = "rootPassw0rd-123";

import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const HERE = dirname(fileURLToPath(import.meta.url));
const REPO = join(HERE, "..", "..", "..");
const MIGRATE = join(REPO, "migrate");
const { db } = await import(join(REPO, "api", "_db.js"));
const { DEFAULT_FEATURES } = await import(join(REPO, "api", "_access.js"));
const { __outbox } = await import(join(REPO, "api", "_email.js"));

let pass = 0, fail = 0;
const ok = (name, cond, extra) => { cond ? pass++ : fail++; console.log(`${cond ? "  ✓" : "  ✗"} ${name}${!cond && extra ? "  — " + extra : ""}`); };

const sql = db();
for (const file of ["schema.sql", "schema_v2.sql", "schema_v3.sql", "schema_v5.sql", "schema_v6.sql"]) {
  const schema = readFileSync(join(MIGRATE, file), "utf8").replace(/--.*$/gm, "");
  for (const stmt of schema.split(/;\s*(?:\n|$)/).map((s) => s.trim()).filter(Boolean)) await sql(stmt);
}
for (const f of DEFAULT_FEATURES) {
  await sql(`insert into feature_permissions (feature_key,label,description,public_ok,requires_verified,requires_entitlement,min_ai_level,sort)
     values ($1,$2,$3,$4,$5,$6,$7,$8) on conflict (feature_key) do nothing`,
    [f.feature_key, f.label, null, !!f.public_ok, f.requires_verified ?? true, f.requires_entitlement ?? false, f.min_ai_level || null, f.sort || 100]);
}

// Seed the live versions of the 3 clean-up prompts exactly as migrate/run.mjs would (origin excel).
const seed = JSON.parse(readFileSync(join(REPO, "web", "seed", "prompts.json"), "utf8"));
const cleanup = JSON.parse(readFileSync(join(HERE, "import", "01_cleanup.json"), "utf8"));
const pilot = JSON.parse(readFileSync(join(HERE, "import", "02_working_with_ai.json"), "utf8"));
for (const c of cleanup) {
  const r = seed.find((x) => x.id === c.id);
  await sql`insert into prompts (id, source_number, title, category, source, lifecycle, quality_score, data, origin, title_norm)
    values (${r.id}, ${r.sourceNumber ?? null}, ${r.title}, ${r.category}, ${r.source}, ${r.lifecycle || null},
            ${r.qualityScore ?? null}, ${JSON.stringify(r)}, 'excel', ${r.title.trim().toLowerCase()})`;
}

// ---- tiny HTTP shim (same as migrate/authtest.mjs)
function makeRes() {
  const res = { statusCode: 200, headers: {}, body: null, _cookies: [] };
  res.setHeader = (k, v) => { if (k.toLowerCase() === "set-cookie") res._cookies = res._cookies.concat(v); res.headers[k.toLowerCase()] = v; return res; };
  res.getHeader = (k) => res.headers[k.toLowerCase()];
  res.status = (c) => { res.statusCode = c; return res; };
  res.send = (b) => { res.body = b; return res; };
  res.end = (b) => { if (b !== undefined) res.body = b; return res; };
  return res;
}
function jar() {
  const store = {};
  return {
    header() { return Object.entries(store).map(([k, v]) => `${k}=${v}`).join("; "); },
    absorb(res) {
      for (const c of res._cookies || []) {
        const [pair, ...attrs] = String(c).split(";").map((s) => s.trim());
        const eq = pair.indexOf("=");
        const maxAge = attrs.find((a) => /^max-age=/i.test(a));
        if (maxAge && parseInt(maxAge.split("=")[1], 10) === 0) delete store[pair.slice(0, eq)];
        else store[pair.slice(0, eq)] = pair.slice(eq + 1);
      }
    },
  };
}
const imp = async (p) => (await import(join(REPO, "api", p))).default;
const H = {
  csrf: await imp("_authsrc/csrf.js"), signup: await imp("_authsrc/signup.js"), verify: await imp("_authsrc/verify-email.js"),
  redeem: await imp("_authsrc/redeem-code.js"), me: await imp("_authsrc/me.js"),
  adminSession: await imp("_adminsrc/session.js"), adminPrompts: await imp("_adminsrc/prompts.js"),
  adminCols: await imp("_adminsrc/collections.js"), prompts: await imp("prompts.js"),
};
async function call(handler, { method = "GET", query = {}, body = null, cookieJar, csrf } = {}) {
  const req = { method, query, headers: { host: "test.local", "user-agent": "loadtest", "x-forwarded-for": "10.0.0.9" }, body: body || undefined };
  if (cookieJar) req.headers.cookie = cookieJar.header();
  if (csrf) req.headers["x-csrf-token"] = csrf;
  const res = makeRes();
  await handler(req, res);
  if (cookieJar) cookieJar.absorb(res);
  let json = null;
  try { json = JSON.parse(res.body); } catch {}
  return { status: res.statusCode, json };
}
const getCsrf = async (j) => (await call(H.csrf, { cookieJar: j })).json.csrfToken;

console.log("\nAdmin sign-in");
const aj = jar(); const acsrf = await getCsrf(aj);
const login = await call(H.adminSession, { method: "POST", cookieJar: aj, csrf: acsrf,
  body: { email: process.env.ADMIN_BOOTSTRAP_EMAIL, password: process.env.ADMIN_BOOTSTRAP_PASSWORD } });
ok("super admin signed in", login.status === 200, JSON.stringify(login.json));
const post = (body) => call(H.adminPrompts, { method: "POST", cookieJar: aj, csrf: acsrf, body });

console.log("\n1. Clean-up import (01_cleanup.json)");
const cPrev = await post({ action: "import", rows: cleanup, commit: false });
ok("preview = 3 update, 0 new, 0 invalid", cPrev.json.counts.update === 3 && !cPrev.json.counts.new && !cPrev.json.counts.invalid, JSON.stringify(cPrev.json.counts));
const cCommit = await post({ action: "import", rows: cleanup, commit: true });
ok("commit applied", cCommit.json.committed === true && cCommit.json.counts.update === 3, JSON.stringify(cCommit.json.counts));
const after = await sql`select id, data from prompts where id in ('lib-336','lib-437','lib-2178')`;
const body = (id) => after.find((r) => r.id === id).data.originalPrompt;
ok("lib-336 live prompt no longer contains the jailbreak", !/\bDAN\b|do anything now/i.test(body("lib-336")));
ok("lib-437 / lib-2178 no longer teach AI-detection evasion",
  !/avoid ai detection|bypass|undetectable/i.test(body("lib-437")) && !/bypass|undetectable/i.test(body("lib-2178")));
ok("clean-up kept category and id (no new rows)", (await sql`select count(*)::int as n from prompts`)[0].n === 3);
const legacyStill = after.find((r) => r.id === "lib-336").data.legacyPrompt || "";
console.log(`  i legacyPrompt on lib-336 still holds the old text (${/do anything now/i.test(legacyStill) ? "includes DAN" : "clean"}); it is never displayed, and the import path cannot remove fields.`);

console.log("\n2. Pilot import (02_working_with_ai.json)");
const pPrev = await post({ action: "import", rows: pilot, commit: false });
ok("preview = 20 new, 0 invalid, 0 update", pPrev.json.counts.new === 20 && !pPrev.json.counts.invalid && !pPrev.json.counts.update, JSON.stringify(pPrev.json.counts));
const pCommit = await post({ action: "import", rows: pilot, commit: true });
const ids = pilot.map((p) => p.id);
ok("commit created the 20 planned ids", pCommit.json.preview.every((p, i) => p.id === ids[i]), JSON.stringify(pCommit.json.preview.map((p) => p.id)));
const again = await post({ action: "import", rows: pilot, commit: false });
ok("re-import is idempotent (20 update, 0 new)", again.json.counts.update === 20 && !again.json.counts.new, JSON.stringify(again.json.counts));
const stored = await sql`select id, category, origin, lifecycle, data from prompts where id like 'syn-wwai-%' order by id`;
ok("stored as authored, Curated, AI & Prompt Engineering",
  stored.length === 20 && stored.every((r) => r.origin === "authored" && r.lifecycle === "Curated" && r.category === "AI & Prompt Engineering"));
ok("variables and tags carried through", stored.every((r) => r.data.variables.length > 0 && r.data.tags.includes("Working with AI")));
ok("no provenance or source text stored in the product record",
  stored.every((r) => !JSON.stringify(r.data).includes("prompts.chat") && !r.data.provenance));

console.log("\n3. Public delta feed (/api/prompts)");
const feed = await call(H.prompts, {});
const feedIds = new Set(feed.json.prompts.map((p) => p.id));
ok("feed carries all 20 new prompts and the 3 fixes", ids.every((i) => feedIds.has(i)) && ["lib-336", "lib-437", "lib-2178"].every((i) => feedIds.has(i)), `count=${feed.json.count}`);

console.log("\n4. Admin Collection");
const create = await call(H.adminCols, { method: "POST", cookieJar: aj, csrf: acsrf,
  body: { action: "create", name: "Working with AI", orgName: "Pilot Org", promptIds: ids, categoryIds: [], programIds: [] } });
ok("collection created with 20 pinned ids", create.status === 200 && create.json.collection.promptIds.length === 20, JSON.stringify(create.json));
const gen = await call(H.adminCols, { method: "POST", cookieJar: aj, csrf: acsrf,
  body: { action: "generate_code", id: create.json.collection.id, label: "Pilot" } });
ok("access code generated", gen.status === 200 && !!gen.json.code?.code, JSON.stringify(gen.json));

console.log("\n5. Learner redeems the code");
const lj = jar(); const lcsrf = await getCsrf(lj);
const email = "pilot.learner@example.com";
await call(H.signup, { method: "POST", cookieJar: lj, csrf: lcsrf, body: {
  firstName: "Pilot", lastName: "Learner", email, password: "P1lotLearner!!", confirmPassword: "P1lotLearner!!",
  function: "general", aiLevel: "beginner", organization: "Pilot Org", agreeTerms: true } });
const mail = __outbox.filter((m) => m.to === email).pop();
const token = decodeURIComponent((String(mail?.text || mail?.html || "").match(/token=([A-Za-z0-9._%-]+)/) || [])[1] || "");
await call(H.verify, { method: "POST", cookieJar: lj, csrf: lcsrf, body: { token } });
const red = await call(H.redeem, { method: "POST", cookieJar: lj, csrf: lcsrf, body: { code: gen.json.code.code } });
ok("learner redeemed the collection code", red.status === 200, JSON.stringify(red.json));
const me = await call(H.me, { cookieJar: lj });
const scopeIds = JSON.stringify(me.json || {});
ok("learner scope includes the pinned prompt ids", ids.every((i) => scopeIds.includes(i)), scopeIds.slice(0, 400));

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
