// Load / stress test for the admin + auth surface, against an in-process
// Postgres (PGlite) with the real v1+v2+v3 schema. No network / real DB / email.
//
//   npm run loadtest            # default scale (2k users, 20 orgs, 50 collections)
//   SCALE=0.25 npm run loadtest # quick pass
//
// Seeds a large dataset by direct INSERT (fast), then drives the ACTUAL API
// handlers (api/_adminsrc/*, api/_authsrc/*, api/session.js) to measure:
//   * Users tab: list, +org filter, +search, +entitlement filters, pagination
//   * Admin analytics
//   * /api/auth/me and /api/auth/redeem-code under concurrency
//   * Collection resolution cost on the learner path
//   * Redemption race: N concurrent redeems on a seat-limited code
// and flags any list endpoint returning an unbounded result set.

process.env.DATABASE_URL = "pglite://memory";
process.env.NODE_ENV = "test";
process.env.EMAIL_TRANSPORT = "console";
process.env.EMAIL_SILENT = "1";
process.env.SESSION_SECRET = "loadtest-secret";
process.env.ADMIN_SECRET = "loadtest-admin";
process.env.APP_BASE_URL = "http://load.local";
process.env.ADMIN_BOOTSTRAP_EMAIL = "root@synottic.test";
process.env.ADMIN_BOOTSTRAP_PASSWORD = "rootPassw0rd-123";

import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const HERE = dirname(fileURLToPath(import.meta.url));
const S = Number(process.env.SCALE || 1);
const N_ORGS = Math.max(1, Math.round(20 * S));
const N_USERS = Math.max(10, Math.round(2000 * S));
const N_COLLECTIONS = Math.max(1, Math.round(50 * S));
const N_CODES = Math.max(1, Math.round(200 * S));
const N_ACTIVITY = Math.max(10, Math.round(10000 * S));
const CONCURRENCY = Math.max(2, Math.round(50 * S));

const { db } = await import("../api/_db.js");
const { DEFAULT_FEATURES } = await import("../api/_access.js");
const { hashPassword, newId } = await import("../api/_crypto.js");
const sql = db();

const findings = [];
const rows = [];
function note(msg) { findings.push(msg); }
function ms(t) { return (Number(t) / 1e6).toFixed(1); }
async function timed(label, fn, { cap } = {}) {
  const t0 = process.hrtime.bigint();
  const r = await fn();
  const dur = process.hrtime.bigint() - t0;
  const n = Array.isArray(r) ? r.length : (r && Array.isArray(r.users) ? r.users.length : (r && Array.isArray(r.rows) ? r.rows.length : (r && typeof r.count === "number" ? r.count : "")));
  rows.push({ label, ms: +ms(dur), n });
  if (cap && typeof n === "number" && n > cap) note(`⚠ ${label}: returned ${n} rows with no cap (expected ≤ ${cap}) — unbounded result set`);
  return r;
}
function table() {
  const w = Math.max(...rows.map((r) => r.label.length), 8);
  console.log("\n  " + "operation".padEnd(w) + "   rows    ms");
  console.log("  " + "-".repeat(w) + "   ----   -----");
  for (const r of rows) console.log("  " + r.label.padEnd(w) + "   " + String(r.n).padStart(4) + "   " + String(r.ms).padStart(6));
}

// ---- schema + seed feature rows -------------------------------------------------
console.log(`load test — scale ${S}: ${N_USERS} users · ${N_ORGS} orgs · ${N_COLLECTIONS} collections · ${N_CODES} codes · ${N_ACTIVITY} activity rows`);
{
  const t0 = process.hrtime.bigint();
  for (const file of ["schema.sql", "schema_v2.sql", "schema_v3.sql"]) {
    const schema = readFileSync(join(HERE, file), "utf8").replace(/--.*$/gm, "");
    for (const stmt of schema.split(/;\s*(?:\n|$)/).map((s) => s.trim()).filter(Boolean)) await sql(stmt);
  }
  for (const f of DEFAULT_FEATURES) {
    await sql(`insert into feature_permissions (feature_key,label,description,public_ok,requires_verified,requires_entitlement,min_ai_level,sort)
               values ($1,$2,$3,$4,$5,$6,$7,$8) on conflict (feature_key) do nothing`,
      [f.feature_key, f.label, null, !!f.public_ok, f.requires_verified ?? true, f.requires_entitlement ?? false, f.min_ai_level || null, f.sort || 100]);
  }
  const be = process.env.ADMIN_BOOTSTRAP_EMAIL;
  await sql(`insert into admin_users (id,email,email_norm,password_hash,name,admin_role,status,created_by)
             values ($1,$2,$3,$4,'Root','SUPER_ADMIN','active','loadtest')`,
    [newId("adm"), be, be, await hashPassword(process.env.ADMIN_BOOTSTRAP_PASSWORD)]);
  console.log(`  schema applied in ${ms(process.hrtime.bigint() - t0)} ms`);
}

const ROLES = ["sales", "marketing", "hr", "finance", "legal", "it_engineering", "product", "operations", "data_analysis", "general"];
const AI = ["beginner", "foundational", "intermediate", "advanced", "expert"];
const STATUS = ["active", "active", "active", "active", "pending_verification", "suspended"];
const CATS = ["AI & Prompt Engineering", "General", "Sales & Lead Generation", "Email Marketing", "Content Writing & Copywriting",
  "Customer Support", "Legal & Compliance", "Image & Design", "SEO & Analytics", "Business Strategy"];
const orgs = Array.from({ length: N_ORGS }, (_, i) => `Org ${String.fromCharCode(65 + (i % 26))}${i}`);
const pick = (a, i) => a[i % a.length];
const randCats = (i) => CATS.filter((_, k) => (i + k) % 3 === 0);

// ---- bulk seed ---------------------------------------------------------------
{
  const t0 = process.hrtime.bigint();
  // users (+ ~80% entitlements, mixed sources)
  const CHUNK = 500;
  for (let start = 0; start < N_USERS; start += CHUNK) {
    const end = Math.min(N_USERS, start + CHUNK);
    const uVals = [], uParams = [];
    const eVals = [], eParams = [];
    for (let i = start; i < end; i++) {
      const id = "usr_load_" + i;
      const p = uParams.length;
      uParams.push(id, `load${i}@ex.com`, `load${i}@ex.com`, "x", "L", "User" + i, pick(ROLES, i), pick(AI, i),
        pick(orgs, i), pick(STATUS, i), i % 4 !== 0, new Date(Date.now() - i * 3600_000).toISOString());
      uVals.push(`($${p + 1},$${p + 2},$${p + 3},$${p + 4},$${p + 5},$${p + 6},$${p + 7},$${p + 8},$${p + 9},$${p + 10},$${p + 11},$${p + 12})`);
      if (i % 5 !== 0) {
        const source = ["auto_function", "auto_function", "access_code", "admin", "self_signup"][i % 5];
        const scope = source === "self_signup" ? "none" : source === "access_code" ? "collection" : source === "admin" ? "full" : "function";
        const st = ["active", "active", "active", "suspended", "expired"][i % 5];
        const q = eParams.length;
        eParams.push("ent_load_" + i, id, source, scope, JSON.stringify(randCats(i)), st);
        eVals.push(`($${q + 1},$${q + 2},$${q + 3},$${q + 4},$${q + 5}::jsonb,'[]'::jsonb,$${q + 6})`);
      }
    }
    await sql(`insert into users (id,email,email_norm,password_hash,first_name,last_name,role,ai_level,org_name,account_status,email_verified,last_login_at) values ${uVals.join(",")}`, uParams);
    if (eVals.length) await sql(`insert into entitlements (id,user_id,source,scope_type,category_ids,prompt_ids,status) values ${eVals.join(",")}`, eParams);
  }
  // collections + codes
  const cVals = [], cParams = [];
  for (let i = 0; i < N_COLLECTIONS; i++) {
    const q = cParams.length;
    cParams.push("col_load_" + i, pick(orgs, i), "Collection " + i, JSON.stringify(randCats(i)), i % 7 !== 0);
    cVals.push(`($${q + 1},$${q + 2},$${q + 3},$${q + 4}::jsonb,'[]'::jsonb,'[]'::jsonb,$${q + 5})`);
  }
  await sql(`insert into collections (id,org_name,name,category_ids,program_ids,prompt_ids,enabled) values ${cVals.join(",")}`, cParams);
  const kVals = [], kParams = [];
  for (let i = 0; i < N_CODES; i++) {
    const q = kParams.length;
    const max = i % 4 === 0 ? null : (i % 4 === 1 ? 5 : 50);
    kParams.push("acc_load_" + i, `LOAD-${i}`, "col_load_" + (i % N_COLLECTIONS), pick(orgs, i),
      JSON.stringify(randCats(i)), max, i % 11 !== 0);
    kVals.push(`($${q + 1},$${q + 2},'collection',$${q + 3},$${q + 4},$${q + 5}::jsonb,'[]'::jsonb,$${q + 6},$${q + 7})`);
  }
  await sql(`insert into access_codes (id,code,scope_type,collection_id,org_name,category_ids,prompt_ids,max_redemptions,enabled) values ${kVals.join(",")}`, kParams);
  // activity rows
  for (let start = 0; start < N_ACTIVITY; start += 1000) {
    const end = Math.min(N_ACTIVITY, start + 1000);
    const aVals = [], aParams = [];
    for (let i = start; i < end; i++) {
      const q = aParams.length;
      aParams.push("subj_" + (i % N_USERS), "LOAD-" + (i % N_CODES), ["opened", "copied", "search", "signin", "practice"][i % 5],
        new Date(Date.now() - i * 60_000).toISOString());
      aVals.push(`($${q + 1},$${q + 2},$${q + 3},$${q + 4})`);
    }
    await sql(`insert into activity (subject,code,event,ts) values ${aVals.join(",")}`, aParams);
  }
  // auth_events feed last_activity_at
  for (let start = 0; start < N_USERS; start += 1000) {
    const end = Math.min(N_USERS, start + 1000);
    const aVals = [], aParams = [];
    for (let i = start; i < end; i++) {
      const q = aParams.length;
      aParams.push("usr_load_" + i, `load${i}@ex.com`, "login_ok", new Date(Date.now() - i * 1000).toISOString());
      aVals.push(`($${q + 1},$${q + 2},$${q + 3},$${q + 4})`);
    }
    await sql(`insert into auth_events (user_id,email_norm,event,ts) values ${aVals.join(",")}`, aParams);
  }
  console.log(`  seeded in ${ms(process.hrtime.bigint() - t0)} ms`);
}

// ---- tiny handler shim ------------------------------------------------------
function makeRes() {
  const res = { statusCode: 200, headers: {}, body: null, _cookies: [] };
  res.setHeader = (k, v) => { if (k.toLowerCase() === "set-cookie") res._cookies = res._cookies.concat(v); res.headers[k.toLowerCase()] = v; return res; };
  res.getHeader = (k) => res.headers[k.toLowerCase()];
  res.status = (c) => { res.statusCode = c; return res; };
  res.send = (b) => { res.body = b; return res; };
  res.end = (b) => { if (b !== undefined) res.body = b; return res; };
  return res;
}
function jarNew() {
  const store = {};
  return {
    header() { return Object.entries(store).map(([k, v]) => `${k}=${v}`).join("; "); },
    absorb(res) { for (const c of res._cookies || []) { const [pair] = String(c).split(";"); const eq = pair.indexOf("="); store[pair.slice(0, eq).trim()] = pair.slice(eq + 1); } },
  };
}
async function call(handler, { method = "GET", query = {}, body = null, jar, csrf, ip } = {}) {
  const req = { method, query, headers: { host: "load.local", "user-agent": "loadtest", "x-forwarded-for": ip || "10.9.0.1" }, body: body || undefined };
  if (jar) req.headers.cookie = jar.header();
  if (csrf) req.headers["x-csrf-token"] = csrf;
  const res = makeRes();
  await handler(req, res);
  if (jar) jar.absorb(res);
  let json = null; try { json = JSON.parse(res.body); } catch {}
  return { status: res.statusCode, json };
}
const H = {
  csrf: (await import("../api/_authsrc/csrf.js")).default,
  login: (await import("../api/_authsrc/login.js")).default,
  me: (await import("../api/_authsrc/me.js")).default,
  redeem: (await import("../api/_authsrc/redeem-code.js")).default,
  session: (await import("../api/session.js")).default,
  signup: (await import("../api/_authsrc/signup.js")).default,
  verify: (await import("../api/_authsrc/verify-email.js")).default,
  adminUsers: (await import("../api/_adminsrc/users.js")).default,
  adminAnalytics: (await import("../api/_adminsrc/analytics.js")).default,
  adminCollections: (await import("../api/_adminsrc/collections.js")).default,
};

// admin session
const aj = jarNew();
const acsrf = (await call(H.csrf, { jar: aj })).json.csrfToken;
await call(H.login, { method: "POST", jar: aj, csrf: acsrf, body: { email: process.env.ADMIN_BOOTSTRAP_EMAIL, password: process.env.ADMIN_BOOTSTRAP_PASSWORD } });

// ---- MEASURE: admin Users tab ---------------------------------------------
const someOrg = orgs[3];
await timed("users: list (limit 25)", () => call(H.adminUsers, { jar: aj, query: { limit: "25" } }).then((r) => r.json), { cap: 25 });
await timed("users: list (limit 100)", () => call(H.adminUsers, { jar: aj, query: { limit: "100" } }).then((r) => r.json), { cap: 100 });
await timed("users: limit 100000 (cap check)", () => call(H.adminUsers, { jar: aj, query: { limit: "100000" } }).then((r) => r.json), { cap: 100 });
await timed("users: +org filter", () => call(H.adminUsers, { jar: aj, query: { org: someOrg, limit: "100" } }).then((r) => r.json), { cap: 100 });
await timed("users: +search 'user1'", () => call(H.adminUsers, { jar: aj, query: { q: "user1", limit: "100" } }).then((r) => r.json), { cap: 100 });
await timed("users: +entSource=access_code", () => call(H.adminUsers, { jar: aj, query: { entSource: "access_code", limit: "100" } }).then((r) => r.json), { cap: 100 });
await timed("users: +entStatus=none", () => call(H.adminUsers, { jar: aj, query: { entStatus: "none", limit: "100" } }).then((r) => r.json), { cap: 100 });
await timed("users: page 10 (offset 250)", () => call(H.adminUsers, { jar: aj, query: { limit: "25", offset: "250" } }).then((r) => r.json), { cap: 25 });
await timed("users: deep page (offset " + (N_USERS - 25) + ")", () => call(H.adminUsers, { jar: aj, query: { limit: "25", offset: String(Math.max(0, N_USERS - 25)) } }).then((r) => r.json), { cap: 25 });
await timed("users: single detail (getUserAccess)", () => call(H.adminUsers, { jar: aj, query: { id: "usr_load_7" } }).then((r) => r.json));

// ---- MEASURE: analytics --------------------------------------------------
await timed("admin analytics (30d)", () => call(H.adminAnalytics, { jar: aj, query: { days: "30" } }).then((r) => r.json));
await timed("admin analytics (365d)", () => call(H.adminAnalytics, { jar: aj, query: { days: "365" } }).then((r) => r.json));

// ---- MEASURE: collections console --------------------------------------------
await timed("collections: list + codes", () => call(H.adminCollections, { jar: aj, query: {} }).then((r) => r.json && r.json.collections), { cap: 500 });

// ---- MEASURE: gate resolution + concurrency --------------------------------
await timed("gate: /api/session preview (collection code)", () => call(H.session, { method: "POST", body: { code: "LOAD-3", preview: true } }).then((r) => r.json));

// a real verified learner for the me / redeem concurrency runs
async function realLearner(email) {
  const j = jarNew();
  const csrf = (await call(H.csrf, { jar: j })).json.csrfToken;
  await sql`delete from rate_limits`;
  await call(H.signup, { method: "POST", jar: j, csrf, body: { firstName: "Real", lastName: "L", email, password: "L0adScope!!", confirmPassword: "L0adScope!!", function: "sales", aiLevel: "beginner", organization: "LoadCo", agreeTerms: true } });
  const { __outbox } = await import("../api/_email.js");
  const mail = [...__outbox].reverse().find((m) => m.to === email);
  const token = mail && new URL((mail.text.match(/https?:\/\/\S+/) || [])[0]).searchParams.get("token");
  await call(H.verify, { method: "POST", jar: j, csrf, body: { token } });
  return { j, csrf };
}
const learner = await realLearner("real-load@ex.com");

async function concurrent(label, n, fn) {
  await sql`delete from rate_limits`;
  const t0 = process.hrtime.bigint();
  const out = await Promise.all(Array.from({ length: n }, (_, i) => fn(i)));
  const dur = process.hrtime.bigint() - t0;
  const okN = out.filter((s) => s === 200).length;
  rows.push({ label: `${label} ×${n}`, ms: +ms(dur), n: `${okN} ok` });
  return out;
}
await concurrent("auth/me concurrency", CONCURRENCY, () => call(H.me, { jar: learner.j }).then((r) => r.status));

// ---- redemption race: N concurrent redeems on a seat-limited code ----------
{
  // make a dedicated code with max_redemptions = 5 and N verified learners
  const raceCol = (await call(H.adminCollections, { method: "POST", jar: aj, csrf: acsrf, body: { action: "create", name: "Race", orgName: "RaceCo", categoryIds: ["General"] } })).json.collection.id;
  const raceCode = (await call(H.adminCollections, { method: "POST", jar: aj, csrf: acsrf, body: { action: "generate_code", id: raceCol, maxRedemptions: 5 } })).json.code.code;
  const racers = [];
  for (let i = 0; i < 20; i++) racers.push(await realLearner(`racer-load-${i}@ex.com`));
  await sql`delete from rate_limits`;
  const t0 = process.hrtime.bigint();
  const outcomes = await Promise.all(racers.map((r, i) => call(H.redeem, { method: "POST", jar: r.j, csrf: r.csrf, ip: `10.5.0.${i + 1}`, body: { code: raceCode } }).then((x) => x.status)));
  const granted = outcomes.filter((s) => s === 200).length;
  rows.push({ label: "redeem race ×20 (max 5)", ms: +ms(process.hrtime.bigint() - t0), n: `${granted} ok` });
  const stored = (await sql`select redemptions from access_codes where upper(code) = ${raceCode}`)[0].redemptions;
  if (granted !== 5 || stored !== 5) note(`✗ redemption race: expected exactly 5 grants + stored=5, got granted=${granted} stored=${stored}`);
  else console.log(`\n  ✓ redemption race: exactly 5/20 concurrent redeems succeeded, stored count = 5`);
}

// ---- report --------------------------------------------------------------
table();
const slow = rows.filter((r) => typeof r.ms === "number" && r.ms > 250);
console.log("\nfindings:");
if (!findings.length && !slow.length) console.log("  none — every measured endpoint is capped and < 250 ms at this scale");
for (const f of findings) console.log("  " + f);
for (const s of slow) console.log(`  ! ${s.label}: ${s.ms} ms (> 250 ms budget) — investigate index / query shape`);
process.exit(findings.some((f) => f.startsWith("✗")) ? 1 : 0);
