// End-to-end auth/entitlement/admin journeys against an in-process Postgres
// (PGlite). No network, no real DB, no email provider needed.
//
//   node migrate/authtest.mjs
//
// Exercises: signup → verify → login; unverified partial access; verified w/o
// entitlement → redeem code → full; forgot/reset password; admin RBAC console;
// and the security edge cases (expired/used/invalid tokens, lockout, rate
// limit, unauthorised admin, missing CSRF).

process.env.DATABASE_URL = "pglite://memory";
process.env.NODE_ENV = "test";
process.env.EMAIL_TRANSPORT = "console";
process.env.EMAIL_SILENT = "1";
process.env.SESSION_SECRET = "authtest-secret";
process.env.ADMIN_SECRET = "authtest-admin";
process.env.APP_BASE_URL = "http://test.local";
process.env.ADMIN_BOOTSTRAP_EMAIL = "root@synottic.test";
process.env.ADMIN_BOOTSTRAP_PASSWORD = "rootPassw0rd-123";

import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const HERE = dirname(fileURLToPath(import.meta.url));
const { db } = await import("../api/_db.js");
const { DEFAULT_FEATURES } = await import("../api/_access.js");
const { __outbox } = await import("../api/_email.js");

let pass = 0, fail = 0;
const results = [];
function ok(name, cond, extra) {
  const line = cond ? `  ✓ ${name}` : `  ✗ ${name}${extra ? "  — " + extra : ""}`;
  if (cond) pass++; else fail++;
  results.push(line);
  console.log(line);
}
function section(t) { results.push(`\n${t}`); console.log(`\n${t}`); }
process.on("uncaughtException", (e) => { console.error("\n💥", e); process.exit(1); });
// The suite creates many accounts from one IP; real per-endpoint limits (e.g.
// signup 5/h) would trip. Clear the counters between phases — the dedicated
// rate-limit / lockout checks in section 6 exercise the limiter directly.
async function resetLimits() { try { await sql`delete from rate_limits`; await sql`update users set failed_logins = 0, locked_until = null`; } catch (e) {} }

// ---- schema + seed (same as run_v2, in-process so it shares the pglite singleton)
const sql = db();
{
  for (const file of ["schema.sql", "schema_v2.sql", "schema_v3.sql"]) {
    const schema = readFileSync(join(HERE, file), "utf8").replace(/--.*$/gm, "");
    for (const stmt of schema.split(/;\s*(?:\n|$)/).map((s) => s.trim()).filter(Boolean)) await sql(stmt);
  }
  for (const f of DEFAULT_FEATURES) {
    await sql(
      `insert into feature_permissions (feature_key,label,description,public_ok,requires_verified,requires_entitlement,min_ai_level,sort)
       values ($1,$2,$3,$4,$5,$6,$7,$8) on conflict (feature_key) do nothing`,
      [f.feature_key, f.label, null, !!f.public_ok, f.requires_verified ?? true, f.requires_entitlement ?? false, f.min_ai_level || null, f.sort || 100]);
  }
}

// ---- tiny HTTP shim -----------------------------------------------------------
function makeRes() {
  const res = { statusCode: 200, headers: {}, body: null, _cookies: [] };
  res.setHeader = (k, v) => {
    if (k.toLowerCase() === "set-cookie") res._cookies = res._cookies.concat(v);
    res.headers[k.toLowerCase()] = v; return res;
  };
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
        const name = pair.slice(0, eq), val = pair.slice(eq + 1);
        const maxAge = attrs.find((a) => /^max-age=/i.test(a));
        if (maxAge && parseInt(maxAge.split("=")[1], 10) === 0) delete store[name];
        else store[name] = val;
      }
    },
    get(name) { return store[name]; },
  };
}

// Handlers now live in api/_authsrc/ and api/_adminsrc/ (underscore = excluded
// from Vercel's function count); /api/auth/* and /api/admin/* are served by the
// [action].js catch-alls. The tests exercise the handlers directly.
const H = {
  csrf:      (await import("../api/_authsrc/csrf.js")).default,
  signup:    (await import("../api/_authsrc/signup.js")).default,
  verify:    (await import("../api/_authsrc/verify-email.js")).default,
  resend:    (await import("../api/_authsrc/resend-verification.js")).default,
  login:     (await import("../api/_authsrc/login.js")).default,
  logout:    (await import("../api/_authsrc/logout.js")).default,
  me:        (await import("../api/_authsrc/me.js")).default,
  forgot:    (await import("../api/_authsrc/forgot-password.js")).default,
  reset:     (await import("../api/_authsrc/reset-password.js")).default,
  redeem:    (await import("../api/_authsrc/redeem-code.js")).default,
  session:   (await import("../api/session.js")).default,
  adminSession: (await import("../api/_adminsrc/session.js")).default,
  adminUsers:   (await import("../api/_adminsrc/users.js")).default,
  adminEnt:     (await import("../api/_adminsrc/entitlements.js")).default,
  adminFns:     (await import("../api/_adminsrc/functions.js")).default,
  adminCols:    (await import("../api/_adminsrc/collections.js")).default,
  adminAudit:   (await import("../api/_adminsrc/audit.js")).default,
  adminAnalytics: (await import("../api/_adminsrc/analytics.js")).default,
};

async function call(handler, { method = "GET", query = {}, body = null, cookieJar, csrf, ip } = {}) {
  const req = {
    method, query,
    headers: { host: "test.local", "user-agent": "authtest", "x-forwarded-for": ip || "10.0.0.1" },
    body: body || undefined,
  };
  if (cookieJar) req.headers.cookie = cookieJar.header();
  if (csrf) req.headers["x-csrf-token"] = csrf;
  const res = makeRes();
  await handler(req, res);
  if (cookieJar) cookieJar.absorb(res);
  let parsed = null;
  try { parsed = JSON.parse(res.body); } catch {}
  return { status: res.statusCode, json: parsed, res };
}
async function getCsrf(j) {
  const r = await call(H.csrf, { cookieJar: j });
  return r.json.csrfToken;
}
function lastMailTo(email, subjectIncludes) {
  for (let i = __outbox.length - 1; i >= 0; i--) {
    const m = __outbox[i];
    if (m.to === email && (!subjectIncludes || m.subject.includes(subjectIncludes))) return m;
  }
  return null;
}
function tokenFromMail(m) {
  const link = (m.text.match(/https?:\/\/\S+/) || [])[0] || "";
  return new URL(link).searchParams.get("token");
}

// ─────────────────────────────────────────────────────────────────────────────
section("1. New user: signup → verify email → login → personalized access");
{
  const j = jar();
  const csrf = await getCsrf(j);
  const signup = await call(H.signup, { method: "POST", cookieJar: j, csrf, body: {
    firstName: "Ada", lastName: "Lovelace", email: "ada@example.com",
    password: "Analyt1calEngine", confirmPassword: "Analyt1calEngine",
    function: "it_engineering", aiLevel: "advanced", organization: "Synottic", agreeTerms: true,
  }});
  ok("signup returns 201 pending + signs in immediately (limited access)",
    signup.status === 201 && signup.json.pending === true && signup.json.signedIn === true && !!signup.json.access,
    JSON.stringify(signup.json));
  ok("signup session works: /me authenticated but unverified",
    (await call(H.me, { method: "GET", cookieJar: j })).json.authenticated === true);

  const preLogin = await call(H.login, { method: "POST", cookieJar: j, csrf, body: { email: "ada@example.com", password: "Analyt1calEngine" } });
  ok("can log in before verifying (partial access)", preLogin.status === 200 && preLogin.json.needsVerification === true);
  ok("unverified: library.full denied w/ reason verify_email",
    preLogin.json.access.features["library.full"] === false && preLogin.json.access.reasons["library.full"] === "verify_email");
  ok("unverified: account.manage allowed", preLogin.json.access.features["account.manage"] === true);
  {
    const pj = jar(); const pcsrf = await getCsrf(pj);
    const shortPw = await call(H.signup, { method: "POST", cookieJar: pj, csrf: pcsrf, body: {
      firstName: "Min", lastName: "Pass", email: "minpass@example.com", password: "abcde",
      confirmPassword: "abcde", function: "general", aiLevel: "beginner", organization: "X", agreeTerms: true } });
    ok("5-char password accepted (min lowered to 5)", shortPw.status === 201, `status=${shortPw.status} ${JSON.stringify(shortPw.json)}`);
    const tooShort = await call(H.signup, { method: "POST", cookieJar: pj, csrf: pcsrf, body: {
      firstName: "Way", lastName: "Short", email: "wayshort@example.com", password: "abc",
      confirmPassword: "abc", function: "general", aiLevel: "beginner", organization: "X", agreeTerms: true } });
    ok("4-char password rejected (422)", tooShort.status === 422 && tooShort.json.field === "password");
  }

  const mail = lastMailTo("ada@example.com");
  ok("verification email sent", !!mail, "no outbox mail");
  const token = mail && tokenFromMail(mail);
  const verify = await call(H.verify, { method: "POST", cookieJar: j, csrf, body: { token } });
  ok("verify-email 200 verified", verify.status === 200 && verify.json.status === "verified", JSON.stringify(verify.json));

  const me = await call(H.me, { method: "GET", cookieJar: j });
  ok("me: authenticated + emailVerified", me.json.authenticated === true && me.json.user.emailVerified === true);
  // Auto-entitlement on verify — NO access code step. Function "it_engineering"
  // -> function scope (filtered category browse), so all features unlock and the
  // entitlement is active.
  ok("verify auto-grants access (no code): entitlement active, function-scoped",
    me.json.access.access.active === true && me.json.access.access.scopeType === "function",
    JSON.stringify(me.json.access.access));
  ok("auto-granted: library.full + practice + advanced_ai all allowed",
    me.json.access.features["library.full"] === true &&
    me.json.access.features["practice"] === true &&
    me.json.access.features["advanced_ai"] === true, JSON.stringify(me.json.access.features));
  ok("auto-granted: programIds carries the function's program",
    Array.isArray(me.json.access.programs) && me.json.access.programs.includes("prog-syn-it-eng"),
    JSON.stringify(me.json.access.programs));
  ok("auto-granted: access.categoryIds carries the function's categories",
    Array.isArray(me.json.access.access.categoryIds) &&
    me.json.access.access.categoryIds.includes("Coding & Tech"),
    JSON.stringify(me.json.access.access.categoryIds));
  ok("personalization: no 'add access code' CTA anymore", me.json.access.personalization.cta === null);

  globalThis._ada = { j, csrf };
}

section("2. Reused / invalid / expired verification tokens");
{
  await resetLimits();
  const j = jar(); const csrf = await getCsrf(j);
  await call(H.signup, { method: "POST", cookieJar: j, csrf, body: {
    firstName: "Grace", lastName: "Hopper", email: "grace@example.com",
    password: "N0Bugs4Me!!", confirmPassword: "N0Bugs4Me!!", function: "it_engineering",
    aiLevel: "expert", organization: "Navy", agreeTerms: true } });
  const token = tokenFromMail(lastMailTo("grace@example.com"));
  const first = await call(H.verify, { method: "POST", cookieJar: j, csrf, body: { token } });
  ok("first verify ok", first.status === 200);
  const second = await call(H.verify, { method: "POST", cookieJar: j, csrf, body: { token } });
  ok("reused token -> 200 'already' (verified) or 410 used", second.status === 200 || second.status === 410);
  const bad = await call(H.verify, { method: "POST", cookieJar: j, csrf, body: { token: "not-a-real-token" } });
  ok("invalid token -> 400 invalid", bad.status === 400 && bad.json.error === "invalid");

  // expired: fresh still-unverified user + a token dated in the past
  const j2 = jar(); const csrf2 = await getCsrf(j2);
  await call(H.signup, { method: "POST", cookieJar: j2, csrf: csrf2, body: {
    firstName: "Expiry", lastName: "Case", email: "expiry@example.com",
    password: "Timeb0mbPass!!", confirmPassword: "Timeb0mbPass!!", function: "general",
    aiLevel: "beginner", organization: "X", agreeTerms: true } });
  const past = new Date(Date.now() - 3600_000).toISOString();
  const u = (await sql`select id from users where email_norm='expiry@example.com'`)[0];
  const { sha256, newId } = await import("../api/_crypto.js");
  await sql`update email_verification_tokens set used_at = now() where user_id = ${u.id} and used_at is null`;
  await sql`insert into email_verification_tokens (id,user_id,token_hash,expires_at) values (${newId("evt")}, ${u.id}, ${sha256("expired-tok")}, ${past})`;
  const exp = await call(H.verify, { method: "POST", cookieJar: j2, csrf: csrf2, body: { token: "expired-tok" } });
  ok("expired token -> 410 expired", exp.status === 410 && exp.json.error === "expired", `status=${exp.status} ${JSON.stringify(exp.json)}`);
}

section("3. Verified without entitlement → admin/self grants access → full");
{
  await resetLimits();
  // bootstrap admin
  const aj = jar(); const acsrf = await getCsrf(aj);
  const login = await call(H.adminSession, { method: "POST", cookieJar: aj, csrf: acsrf,
    body: { email: process.env.ADMIN_BOOTSTRAP_EMAIL, password: process.env.ADMIN_BOOTSTRAP_PASSWORD } });
  ok("admin bootstrap login ok (SUPER_ADMIN)", login.status === 200 && login.json.admin.role === "SUPER_ADMIN", JSON.stringify(login.json));

  // Unified sign-in: the SAME /api/auth/login form authenticates the admin and
  // flags isAdmin (no separate console login).
  {
    const uj = jar(); const ucsrf = await getCsrf(uj);
    const r = await call(H.login, { method: "POST", cookieJar: uj, csrf: ucsrf,
      body: { email: process.env.ADMIN_BOOTSTRAP_EMAIL, password: process.env.ADMIN_BOOTSTRAP_PASSWORD } });
    ok("unified /api/auth/login returns isAdmin for an admin account",
      r.status === 200 && r.json.isAdmin === true && r.json.admin.role === "SUPER_ADMIN", `status=${r.status} ${JSON.stringify(r.json)}`);
    const usersViaUnified = await call(H.adminUsers, { method: "GET", cookieJar: uj, query: {} });
    ok("admin cookie from the unified login works on admin APIs", usersViaUnified.status === 200 && Array.isArray(usersViaUnified.json.users));
    const wrongPw = await call(H.login, { method: "POST", cookieJar: uj, csrf: ucsrf,
      body: { email: process.env.ADMIN_BOOTSTRAP_EMAIL, password: "wrong-admin-pass" } });
    ok("unified login with wrong admin password -> 401", wrongPw.status === 401);
  }

  const users = await call(H.adminUsers, { method: "GET", cookieJar: aj, query: { q: "ada" } });
  ok("admin can search users", users.status === 200 && users.json.users.some((u) => u.email === "ada@example.com"));
  const adaId = users.json.users.find((u) => u.email === "ada@example.com").id;

  const { j, csrf } = globalThis._ada;

  // Ada already has access (auto-granted on verify, function=it_engineering).
  const meAda = await call(H.me, { method: "GET", cookieJar: j });
  ok("verified learner already has an active entitlement (no code needed)",
    meAda.json.access.access.active === true && meAda.json.access.access.source === "auto_function");

  // An admin can still generate a code AND a learner may redeem one to change scope.
  const gen = await call(H.adminEnt, { method: "POST", cookieJar: aj, csrf: acsrf,
    body: { action: "generate_code", label: "ACME", orgName: "Acme", scopeType: "full", licenseType: "enterprise" } });
  ok("admin generates access code", gen.status === 200 && gen.json.code && /^ACME-/.test(gen.json.code.code), `status=${gen.status} ${JSON.stringify(gen.json)}`);
  const code = gen.json.code && gen.json.code.code;

  const redeem = await call(H.redeem, { method: "POST", cookieJar: j, csrf, body: { code } });
  ok("learner can still redeem a code to widen scope -> full", redeem.status === 200 &&
    redeem.json.access.access.scopeType === "full", JSON.stringify(redeem.json));

  // admin assigns a program-scoped entitlement directly, then revokes
  const assign = await call(H.adminEnt, { method: "POST", cookieJar: aj, csrf: acsrf,
    body: { action: "assign", userId: adaId, scopeType: "program", programIds: ["prog-syn-sales"], status: "active" } });
  ok("admin assign program entitlement", assign.status === 200 && assign.json.entitlement.scope_type === "program");
  const revoke = await call(H.adminEnt, { method: "POST", cookieJar: aj, csrf: acsrf, body: { action: "revoke", userId: adaId } });
  ok("admin revoke entitlement", revoke.status === 200 && revoke.json.status === "revoked");
  const meAfter = await call(H.me, { method: "GET", cookieJar: j });
  ok("after admin revoke: library.full denied again", meAfter.json.access.features["library.full"] === false);
  ok("admin-revoked entitlement is NOT re-granted automatically on next /me",
    meAfter.json.access.access.status === "revoked");

  const hist = await call(H.adminEnt, { method: "GET", cookieJar: aj, query: { userId: adaId } });
  ok("entitlement history records the auto grant + code redemption + revoke",
    hist.json.history.some((h) => h.action === "granted") &&
    hist.json.history.some((h) => h.action === "code_redeemed") &&
    hist.json.history.some((h) => h.action === "revoked"));

  globalThis._admin = { aj, acsrf, adaId };
}

section("4. Password reset: forgot → reset → old password & sessions dead");
{
  await resetLimits();
  const j = jar(); const csrf = await getCsrf(j);
  await call(H.signup, { method: "POST", cookieJar: j, csrf, body: {
    firstName: "Kat", lastName: "Johnson", email: "kat@example.com",
    password: "OldPassw0rd!!", confirmPassword: "OldPassw0rd!!", function: "finance",
    aiLevel: "beginner", organization: "NASA", agreeTerms: true } });
  const vtok = tokenFromMail(lastMailTo("kat@example.com"));
  await call(H.verify, { method: "POST", cookieJar: j, csrf, body: { token: vtok } });
  const login1 = await call(H.login, { method: "POST", cookieJar: j, csrf, body: { email: "kat@example.com", password: "OldPassw0rd!!", remember: true } });
  ok("login with old password ok", login1.status === 200);
  const oldSessionJar = jar();
  oldSessionJar.absorb(login1.res); // capture the logged-in cookie

  const forgot = await call(H.forgot, { method: "POST", cookieJar: j, csrf, body: { email: "kat@example.com" } });
  ok("forgot-password always 200", forgot.status === 200);
  const forgotUnknown = await call(H.forgot, { method: "POST", cookieJar: j, csrf, body: { email: "nobody@example.com" } });
  ok("forgot-password 200 for unknown email too (no enumeration)", forgotUnknown.status === 200);

  const rtok = tokenFromMail(lastMailTo("kat@example.com", "Reset"));
  ok("reset email sent", !!rtok);
  const reset = await call(H.reset, { method: "POST", cookieJar: j, csrf, body: { token: rtok, password: "BrandN3wKey!!", confirmPassword: "BrandN3wKey!!" } });
  ok("reset-password ok", reset.status === 200, JSON.stringify(reset.json));

  const reuseReset = await call(H.reset, { method: "POST", cookieJar: j, csrf, body: { token: rtok, password: "Another0ne!!", confirmPassword: "Another0ne!!" } });
  ok("reset token single-use -> 410", reuseReset.status === 410);

  const loginOld = await call(H.login, { method: "POST", cookieJar: j, csrf, body: { email: "kat@example.com", password: "OldPassw0rd!!" } });
  ok("old password rejected after reset", loginOld.status === 401);
  const loginNew = await call(H.login, { method: "POST", cookieJar: j, csrf, body: { email: "kat@example.com", password: "BrandN3wKey!!" } });
  ok("new password works", loginNew.status === 200);

  const meOld = await call(H.me, { method: "GET", cookieJar: oldSessionJar });
  ok("sessions issued before reset are revoked", meOld.json.authenticated === false);
}

section("5. Suspended account is blocked regardless of entitlement");
{
  await resetLimits();
  const { aj, acsrf } = globalThis._admin;
  // give ada full access again, then suspend the account
  const users = await call(H.adminUsers, { method: "GET", cookieJar: aj, query: { q: "ada" } });
  const adaId = users.json.users.find((u) => u.email === "ada@example.com").id;
  await call(H.adminEnt, { method: "POST", cookieJar: aj, csrf: acsrf, body: { action: "assign", userId: adaId, scopeType: "full", status: "active" } });
  const susp = await call(H.adminUsers, { method: "PATCH", cookieJar: aj, csrf: acsrf, body: { id: adaId, action: "suspend", reason: "test" } });
  ok("admin suspend user", susp.status === 200 && susp.json.user.accountStatus === "suspended");

  const { j } = globalThis._ada;
  const me = await call(H.me, { method: "GET", cookieJar: j });
  ok("suspended: authenticates but library.full denied", me.json.authenticated === true && me.json.access.features["library.full"] === false);
  ok("suspended: reason is account_suspended", me.json.access.reasons["library.full"] === "account_suspended");
  ok("suspended: personalization tier 'blocked'", me.json.access.personalization.tier === "blocked");

  const react = await call(H.adminUsers, { method: "PATCH", cookieJar: aj, csrf: acsrf, body: { id: adaId, action: "reactivate" } });
  ok("admin reactivate -> active", react.status === 200 && react.json.user.accountStatus === "active");
  const me2 = await call(H.me, { method: "GET", cookieJar: j });
  ok("reactivated + full entitlement: library.full restored", me2.json.access.features["library.full"] === true);
}

section("6. Security: rate limiting, lockout, unauthorised admin, CSRF");
{
  await resetLimits();
  const j = jar(); const csrf = await getCsrf(j);
  await call(H.signup, { method: "POST", cookieJar: j, csrf, body: {
    firstName: "Lock", lastName: "Target", email: "lock@example.com",
    password: "InitialP4ss!!", confirmPassword: "InitialP4ss!!", function: "general",
    aiLevel: "beginner", organization: "X", agreeTerms: true } });
  let locked = false, rated = false;
  for (let i = 0; i < 12; i++) {
    const r = await call(H.login, { method: "POST", cookieJar: j, csrf, body: { email: "lock@example.com", password: "wrong-pass-here" } });
    if (r.status === 423) locked = true;
    if (r.status === 429) rated = true;
  }
  ok("repeated bad logins -> lockout (423) and/or rate-limit (429)", locked || rated);

  const noAuth = await call(H.adminUsers, { method: "GET" });
  ok("admin API without a session -> 401", noAuth.status === 401);

  const j2 = jar(); const csrf2 = await getCsrf(j2);
  const noCsrf = await call(H.signup, { method: "POST", cookieJar: j2, body: {
    firstName: "No", lastName: "Csrf", email: "nocsrf@example.com", password: "Whatever123!!",
    confirmPassword: "Whatever123!!", function: "general", aiLevel: "beginner", organization: "X", agreeTerms: true } });
  ok("state-changing POST without CSRF header -> 403", noCsrf.status === 403);

  // VIEW_ONLY admin cannot write
  const { aj, acsrf } = globalThis._admin;
  const { newId, hashPassword } = await import("../api/_crypto.js");
  await sql`insert into admin_users (id,email,email_norm,password_hash,name,admin_role,status)
            values (${newId("adm")}, 'viewer@synottic.test','viewer@synottic.test', ${await hashPassword("ViewerPass123")}, 'Viewer','VIEW_ONLY','active')`;
  const vj = jar(); const vcsrf = await getCsrf(vj);
  await call(H.adminSession, { method: "POST", cookieJar: vj, csrf: vcsrf, body: { email: "viewer@synottic.test", password: "ViewerPass123" } });
  const vRead = await call(H.adminUsers, { method: "GET", cookieJar: vj, query: {} });
  const vWrite = await call(H.adminEnt, { method: "POST", cookieJar: vj, csrf: vcsrf, body: { action: "generate_code", label: "NOPE" } });
  ok("VIEW_ONLY admin can read users", vRead.status === 200);
  ok("VIEW_ONLY admin cannot write entitlements -> 403", vWrite.status === 403);
}

section("7. Admin analytics + audit log");
{
  await resetLimits();
  const { aj } = globalThis._admin;
  const an = await call(H.adminAnalytics, { method: "GET", cookieJar: aj, query: { days: 30 } });
  ok("analytics: users block present", an.status === 200 && an.json.users && typeof an.json.users.total === "number", JSON.stringify(an.json.users));
  ok("analytics: verified + activation rate computed",
    typeof an.json.users.verificationRate === "number" && typeof an.json.users.activationRate === "number");
  const audit = await call(H.adminAudit, { method: "GET", cookieJar: aj, query: { type: "admin", limit: 100 } });
  ok("audit log records admin actions", audit.status === 200 && audit.json.rows.some((r) => r.action === "access.code_generate"));
  const authlog = await call(H.adminAudit, { method: "GET", cookieJar: aj, query: { type: "auth", limit: 100 } });
  ok("auth events recorded (signup/login_ok/verify_ok)",
    authlog.json.rows.some((r) => r.event === "signup") && authlog.json.rows.some((r) => r.event === "verify_ok"));
}

section("8. Function library scope: signup function -> filtered category browse, re-scoped on profile change");
{
  await resetLimits();
  const j = jar(); const csrf = await getCsrf(j);
  await call(H.signup, { method: "POST", cookieJar: j, csrf, body: {
    firstName: "Fenna", lastName: "Scope", email: "fenna@example.com",
    password: "H3lloScope!!", confirmPassword: "H3lloScope!!", function: "hr",
    aiLevel: "intermediate", organization: "Synottic", agreeTerms: true } });
  const vtok = tokenFromMail(lastMailTo("fenna@example.com"));
  await call(H.verify, { method: "POST", cookieJar: j, csrf, body: { token: vtok } });

  const me = await call(H.me, { method: "GET", cookieJar: j });
  const acc = me.json.access.access;
  ok("HR signup -> scope_type 'function', active", acc.active === true && acc.scopeType === "function", JSON.stringify(acc));
  ok("HR signup -> categoryIds includes 'HR & Recruiting'", (acc.categoryIds || []).includes("HR & Recruiting"), JSON.stringify(acc.categoryIds));
  ok("HR signup -> programs includes prog-syn-hr", (me.json.access.programs || []).includes("prog-syn-hr"), JSON.stringify(me.json.access.programs));
  ok("HR signup -> library.full + practice allowed (function scope entitles)",
    me.json.access.features["library.full"] === true && me.json.access.features["practice"] === true);
  ok("HR signup -> entitlement source is auto_function", acc.source === "auto_function");

  // change the function in the profile -> the auto entitlement re-scopes
  const patch = await call(H.me, { method: "PATCH", cookieJar: j, csrf, body: { function: "finance" } });
  ok("profile function change accepted", patch.status === 200, JSON.stringify(patch.json));
  const me2 = await call(H.me, { method: "GET", cookieJar: j });
  const acc2 = me2.json.access.access;
  ok("after change -> categoryIds now includes 'Finance & Accounting'", (acc2.categoryIds || []).includes("Finance & Accounting"), JSON.stringify(acc2.categoryIds));
  ok("after change -> categoryIds no longer includes 'HR & Recruiting'", !(acc2.categoryIds || []).includes("HR & Recruiting"), JSON.stringify(acc2.categoryIds));
  ok("after change -> programs swapped to prog-syn-finance", (me2.json.access.programs || []).includes("prog-syn-finance") && !(me2.json.access.programs || []).includes("prog-syn-hr"), JSON.stringify(me2.json.access.programs));
  ok("after change -> still source auto_function, still function scope", acc2.source === "auto_function" && acc2.scopeType === "function");

  // an admin override in function_scopes flows through resolveFunctionScope
  {
    const { aj, acsrf } = globalThis._admin;
    await call(H.adminFns, { method: "POST", cookieJar: aj, csrf: acsrf, body: {
      action: "save", functionKey: "finance",
      categories: ["Finance & Accounting", "Business Strategy"], programIds: [], promptIds: ["p-x"] } });
  }
  await call(H.me, { method: "PATCH", cookieJar: j, csrf, body: { function: "hr" } });
  await call(H.me, { method: "PATCH", cookieJar: j, csrf, body: { function: "finance" } });
  const me3 = await call(H.me, { method: "GET", cookieJar: j });
  const acc3 = me3.json.access.access;
  ok("function_scopes override drives the resolved categories",
    JSON.stringify((acc3.categoryIds || []).slice().sort()) === JSON.stringify(["Business Strategy", "Finance & Accounting"]),
    JSON.stringify(acc3.categoryIds));
  ok("function_scopes override drives the pinned prompt_ids", (acc3.promptIds || []).includes("p-x"), JSON.stringify(acc3.promptIds));
}

section("9. Admin: assign a prompt set to a function (function_scopes)");
{
  await resetLimits();
  const { aj, acsrf } = globalThis._admin;

  const list = await call(H.adminFns, { method: "GET", cookieJar: aj, query: {} });
  ok("admin lists function scopes (13, no 'general')",
    list.status === 200 && list.json.functions.length === 13 && !list.json.functions.some((f) => f.key === "general"));
  const salesRow = list.json.functions.find((f) => f.key === "sales");
  ok("function list carries the static default categories",
    salesRow && salesRow.default.categories.includes("Sales & Lead Generation") && salesRow.scope === null,
    JSON.stringify(salesRow));

  const save = await call(H.adminFns, { method: "POST", cookieJar: aj, csrf: acsrf, body: {
    action: "save", functionKey: "sales",
    categories: ["Sales & Lead Generation", "Email Marketing"], programIds: [], promptIds: ["p-pin-1", "p-pin-1", " "] } });
  ok("admin saves a custom sales scope", save.status === 200 && save.json.scope.categories.length === 2 && save.json.scope.promptIds.length === 1,
    JSON.stringify(save.json));

  // a fresh sales signup now inherits the custom scope
  const j = jar(); const csrf = await getCsrf(j);
  await call(H.signup, { method: "POST", cookieJar: j, csrf, body: {
    firstName: "Cus", lastName: "Tom", email: "custom-sales@example.com",
    password: "Cust0mScope!!", confirmPassword: "Cust0mScope!!", function: "sales",
    aiLevel: "beginner", organization: "Synottic", agreeTerms: true } });
  await call(H.verify, { method: "POST", cookieJar: j, csrf, body: { token: tokenFromMail(lastMailTo("custom-sales@example.com")) } });
  const me = await call(H.me, { method: "GET", cookieJar: j });
  ok("new sales signup inherits the custom categories",
    JSON.stringify((me.json.access.access.categoryIds || []).slice().sort()) === JSON.stringify(["Email Marketing", "Sales & Lead Generation"]),
    JSON.stringify(me.json.access.access.categoryIds));
  ok("new sales signup inherits the pinned prompt id",
    (me.json.access.access.promptIds || []).includes("p-pin-1"), JSON.stringify(me.json.access.access.promptIds));

  // re-apply pushes the new scope onto existing auto_function learners
  await call(H.adminFns, { method: "POST", cookieJar: aj, csrf: acsrf, body: {
    action: "save", functionKey: "sales", categories: ["Sales & Lead Generation"], programIds: [], promptIds: [] } });
  const reapply = await call(H.adminFns, { method: "POST", cookieJar: aj, csrf: acsrf, body: { action: "reapply", functionKey: "sales" } });
  ok("re-apply updates current sales learners", reapply.status === 200 && reapply.json.reapplied >= 1, JSON.stringify(reapply.json));
  const me2 = await call(H.me, { method: "GET", cookieJar: j });
  ok("existing learner re-scoped by re-apply",
    JSON.stringify(me2.json.access.access.categoryIds || []) === JSON.stringify(["Sales & Lead Generation"]),
    JSON.stringify(me2.json.access.access.categoryIds));

  // reset -> back to the static default for new signups
  const reset = await call(H.adminFns, { method: "POST", cookieJar: aj, csrf: acsrf, body: { action: "reset", functionKey: "sales" } });
  ok("admin resets sales to default", reset.status === 200 && reset.json.scope === null);
  const j2 = jar(); const csrf2 = await getCsrf(j2);
  await call(H.signup, { method: "POST", cookieJar: j2, csrf: csrf2, body: {
    firstName: "Def", lastName: "Ault", email: "default-sales@example.com",
    password: "D3faultScope!!", confirmPassword: "D3faultScope!!", function: "sales",
    aiLevel: "beginner", organization: "Synottic", agreeTerms: true } });
  await call(H.verify, { method: "POST", cookieJar: j2, csrf: csrf2, body: { token: tokenFromMail(lastMailTo("default-sales@example.com")) } });
  const me3 = await call(H.me, { method: "GET", cookieJar: j2 });
  ok("after reset, new sales signup gets the built-in default categories",
    (me3.json.access.access.categoryIds || []).length === 6 && (me3.json.access.access.categoryIds || []).includes("Communication & Leadership"),
    JSON.stringify(me3.json.access.access.categoryIds));

  // RBAC: VIEW_ONLY cannot write a function scope
  const vj = jar(); const vcsrf = await getCsrf(vj);
  await call(H.adminSession, { method: "POST", cookieJar: vj, csrf: vcsrf, body: { email: "viewer@synottic.test", password: "ViewerPass123" } });
  const vWrite = await call(H.adminFns, { method: "POST", cookieJar: vj, csrf: vcsrf, body: { action: "save", functionKey: "hr", categories: ["HR & Recruiting"] } });
  ok("VIEW_ONLY admin cannot save a function scope -> 403", vWrite.status === 403);
}

section("10. Org collection: curate a set, generate a code, learner redeems -> collection scope");
{
  await resetLimits();
  const { aj, acsrf } = globalThis._admin;

  const create = await call(H.adminCols, { method: "POST", cookieJar: aj, csrf: acsrf, body: {
    action: "create", name: "ABC Onboarding", orgName: "ABC",
    categoryIds: ["Sales & Lead Generation", "Email Marketing"], programIds: [], promptIds: ["lib-2878"] } });
  ok("admin creates a collection", create.status === 200 && create.json.collection.id && create.json.collection.categoryIds.length === 2,
    JSON.stringify(create.json));
  const colId = create.json.collection.id;

  const future = new Date(Date.now() + 30 * 86400000).toISOString();
  const gen = await call(H.adminCols, { method: "POST", cookieJar: aj, csrf: acsrf, body: {
    action: "generate_code", id: colId, label: "Cohort A", maxRedemptions: 2, expiresAt: future } });
  ok("admin generates a collection code", gen.status === 200 && /^ABC-/.test(gen.json.code.code) && gen.json.code.maxRedemptions === 2,
    JSON.stringify(gen.json));
  const code = gen.json.code.code;

  // a verified learner (function scope) widens/replaces to the collection scope
  const mk = async (email) => {
    const j = jar(); const csrf = await getCsrf(j);
    await call(H.signup, { method: "POST", cookieJar: j, csrf, body: {
      firstName: "Col", lastName: "Redeem", email, password: "C0llScope!!", confirmPassword: "C0llScope!!",
      function: "hr", aiLevel: "beginner", organization: "ABC", agreeTerms: true } });
    await call(H.verify, { method: "POST", cookieJar: j, csrf, body: { token: tokenFromMail(lastMailTo(email)) } });
    return { j, csrf };
  };

  const a = await mk("col-a@example.com");
  const rd = await call(H.redeem, { method: "POST", cookieJar: a.j, csrf: a.csrf, body: { code } });
  ok("learner redeems collection code -> 200", rd.status === 200, JSON.stringify(rd.json));
  const meA = await call(H.me, { method: "GET", cookieJar: a.j });
  const accA = meA.json.access.access;
  ok("redeemed: scope_type 'collection', active", accA.scopeType === "collection" && accA.active === true, JSON.stringify(accA));
  ok("redeemed: categoryIds match the collection",
    JSON.stringify((accA.categoryIds || []).slice().sort()) === JSON.stringify(["Email Marketing", "Sales & Lead Generation"]),
    JSON.stringify(accA.categoryIds));
  ok("redeemed: pinned prompt id carried through", (accA.promptIds || []).includes("lib-2878"), JSON.stringify(accA.promptIds));
  ok("redeemed: collection with no programs -> access.programs empty (no leak from prior HR function scope)",
    Array.isArray(meA.json.access.programs) && meA.json.access.programs.length === 0, JSON.stringify(meA.json.access.programs));

  const listAfter1 = await call(H.adminCols, { method: "GET", cookieJar: aj, query: {} });
  const col1 = listAfter1.json.collections.find((c) => c.id === colId);
  ok("redemption count increments", col1.codes[0].redemptions === 1, JSON.stringify(col1.codes[0]));

  // re-scope the collection -> the still-unredeemed part stays in sync; the code
  // itself already redeemed keeps the snapshot on the entitlement
  await call(H.adminCols, { method: "POST", cookieJar: aj, csrf: acsrf, body: {
    action: "update", id: colId, categoryIds: ["Sales & Lead Generation"], promptIds: [] } });
  const b = await mk("col-b@example.com");
  const rdB = await call(H.redeem, { method: "POST", cookieJar: b.j, csrf: b.csrf, body: { code } });
  const accB = (await call(H.me, { method: "GET", cookieJar: b.j })).json.access.access;
  ok("re-scoped collection flows to a new redemption",
    rdB.status === 200 && JSON.stringify(accB.categoryIds || []) === JSON.stringify(["Sales & Lead Generation"]),
    JSON.stringify(accB.categoryIds));

  // seat limit reached (2/2)
  const c = await mk("col-c@example.com");
  const rdC = await call(H.redeem, { method: "POST", cookieJar: c.j, csrf: c.csrf, body: { code } });
  ok("code exhausted after maxRedemptions -> 403", rdC.status === 403 && rdC.json.error === "code-exhausted", JSON.stringify(rdC.json));

  // disable via the shared access-code PATCH
  const codeId = col1.codes[0].id;
  await call(H.adminEnt, { method: "PATCH", cookieJar: aj, csrf: acsrf, body: { codeId, enabled: false, maxRedemptions: 99 } });
  const d = await mk("col-d@example.com");
  const rdD = await call(H.redeem, { method: "POST", cookieJar: d.j, csrf: d.csrf, body: { code } });
  ok("disabled code -> 403 code-disabled", rdD.status === 403 && rdD.json.error === "code-disabled", JSON.stringify(rdD.json));

  // delete guard + RBAC
  const del = await call(H.adminCols, { method: "POST", cookieJar: aj, csrf: acsrf, body: { action: "delete", id: colId } });
  ok("cannot delete a collection with redeemed codes -> 422", del.status === 422 && del.json.error === "has-redemptions", JSON.stringify(del.json));

  const vj = jar(); const vcsrf = await getCsrf(vj);
  await call(H.adminSession, { method: "POST", cookieJar: vj, csrf: vcsrf, body: { email: "viewer@synottic.test", password: "ViewerPass123" } });
  const vCreate = await call(H.adminCols, { method: "POST", cookieJar: vj, csrf: vcsrf, body: { action: "create", name: "Nope", orgName: "X" } });
  ok("VIEW_ONLY admin cannot create a collection -> 403", vCreate.status === 403);
}

section("11. Admin user-management console: filters, create/invite, align, bulk");
{
  await resetLimits();
  const { aj, acsrf } = globalThis._admin;

  // enriched list rows + filters
  const list = await call(H.adminUsers, { method: "GET", cookieJar: aj, query: { limit: "100" } });
  ok("user list rows carry entitlement status/source + last activity",
    list.status === 200 && list.json.users.length > 0 &&
    list.json.users.every((u) => "entStatus" in u && "entSource" in u && "lastActivityAt" in u),
    JSON.stringify(list.json.users[0]));
  const bySrc = await call(H.adminUsers, { method: "GET", cookieJar: aj, query: { entSource: "auto_function", limit: "100" } });
  ok("filter by entitlement source = auto_function",
    bySrc.status === 200 && bySrc.json.users.length > 0 && bySrc.json.users.every((u) => u.entSource === "auto_function"));
  const noneEnt = await call(H.adminUsers, { method: "GET", cookieJar: aj, query: { entStatus: "none", limit: "100" } });
  ok("filter by entitlement status = none returns only users without an entitlement",
    noneEnt.status === 200 && noneEnt.json.users.every((u) => u.entStatus === "none"));

  // create user (invite) with a starting function scope
  const create = await call(H.adminUsers, { method: "POST", cookieJar: aj, csrf: acsrf, body: {
    action: "create", email: "invited@example.com", firstName: "In", lastName: "Vited",
    function: "marketing", aiLevel: "beginner", organization: "ABC", functionScope: true, sendInvite: true } });
  ok("admin creates a user -> 201 pending_verification", create.status === 201 && create.json.user.accountStatus === "pending_verification" && create.json.user.emailVerified === false,
    JSON.stringify(create.json));
  const invitedId = create.json.user.id;
  ok("invite / verification email sent to the new user", !!lastMailTo("invited@example.com"));
  const invitedEnt = await call(H.adminEnt, { method: "GET", cookieJar: aj, query: { userId: invitedId } });
  ok("created user has the starting function-scope entitlement",
    invitedEnt.json.entitlement && invitedEnt.json.entitlement.scope_type === "function" &&
    (invitedEnt.json.entitlement.category_ids || []).includes("Marketing & Branding"),
    JSON.stringify(invitedEnt.json.entitlement));
  const dupe = await call(H.adminUsers, { method: "POST", cookieJar: aj, csrf: acsrf, body: {
    action: "create", email: "invited@example.com", function: "sales" } });
  ok("duplicate email on create -> 409", dupe.status === 409);

  // admin changes the function on an auto_function user -> re-scoped
  const changed = await call(H.adminUsers, { method: "PATCH", cookieJar: aj, csrf: acsrf, body: {
    id: invitedId, action: "update_profile", role: "legal" } });
  ok("admin update_profile role change accepted", changed.status === 200);
  const afterEnt = await call(H.adminEnt, { method: "GET", cookieJar: aj, query: { userId: invitedId } });
  ok("changing function re-scopes the auto entitlement (Legal categories now)",
    (afterEnt.json.entitlement.category_ids || []).includes("Legal & Compliance") &&
    !(afterEnt.json.entitlement.category_ids || []).includes("Marketing & Branding"),
    JSON.stringify(afterEnt.json.entitlement.category_ids));

  // align_function on a NON-auto entitlement -> 409
  const adaId = globalThis._admin.adaId;
  await call(H.adminEnt, { method: "POST", cookieJar: aj, csrf: acsrf, body: { action: "assign", userId: adaId, scopeType: "full", status: "active" } });
  const badAlign = await call(H.adminUsers, { method: "PATCH", cookieJar: aj, csrf: acsrf, body: { id: adaId, action: "align_function" } });
  ok("align_function on an admin entitlement -> 409 not-auto-entitlement", badAlign.status === 409);

  // bulk suspend
  const u1 = (await sql`select id from users where email_norm = 'invited@example.com'`)[0].id;
  const bulk = await call(H.adminUsers, { method: "POST", cookieJar: aj, csrf: acsrf, body: {
    action: "bulk", subAction: "suspend", ids: [u1, adaId] } });
  ok("bulk suspend -> both ok", bulk.status === 200 && bulk.json.results.filter((r) => r.ok).length === 2);
  const suspended = await call(H.adminUsers, { method: "GET", cookieJar: aj, query: { status: "suspended", limit: "100" } });
  ok("bulk-suspended users show as suspended", suspended.json.users.some((u) => u.id === u1) && suspended.json.users.some((u) => u.id === adaId));
  await call(H.adminUsers, { method: "POST", cookieJar: aj, csrf: acsrf, body: { action: "bulk", subAction: "reactivate", ids: [u1, adaId] } });

  // RBAC
  const vj = jar(); const vcsrf = await getCsrf(vj);
  await call(H.adminSession, { method: "POST", cookieJar: vj, csrf: vcsrf, body: { email: "viewer@synottic.test", password: "ViewerPass123" } });
  const vList = await call(H.adminUsers, { method: "GET", cookieJar: vj, query: {} });
  const vCreate = await call(H.adminUsers, { method: "POST", cookieJar: vj, csrf: vcsrf, body: { action: "create", email: "nope2@example.com" } });
  ok("VIEW_ONLY admin can list users", vList.status === 200);
  ok("VIEW_ONLY admin cannot create a user -> 403", vCreate.status === 403);
}

section("12. Collection code on the anonymous gate + unknown/expired + seat-limit race");
{
  await resetLimits();
  const { aj, acsrf } = globalThis._admin;

  const col = await call(H.adminCols, { method: "POST", cookieJar: aj, csrf: acsrf, body: {
    action: "create", name: "Gate Test", orgName: "GATECO",
    categoryIds: ["Sales & Lead Generation", "Email Marketing", "Customer Support"], programIds: [], promptIds: [] } });
  const colId = col.json.collection.id;
  const gen = await call(H.adminCols, { method: "POST", cookieJar: aj, csrf: acsrf, body: {
    action: "generate_code", id: colId, label: "Open" } });
  const code = gen.json.code.code;

  // --- anonymous /api/session must NOT 500 and must NOT silently fail ---
  const prev = await call(H.session, { method: "POST", body: { code, preview: true } });
  ok("collection code: /api/session preview -> accountRequired (not 404/500)",
    prev.status === 200 && prev.json.resolved && prev.json.resolved.accountRequired === true && prev.json.resolved.orgName === "GATECO",
    JSON.stringify(prev.json));
  const prevCase = await call(H.session, { method: "POST", body: { code: `  ${code.toLowerCase()} `, preview: true } });
  ok("collection code: preview tolerates case + surrounding spaces",
    prevCase.status === 200 && prevCase.json.resolved && prevCase.json.resolved.accountRequired === true, JSON.stringify(prevCase.json));
  const red = await call(H.session, { method: "POST", body: { code, name: "Anon" } });
  ok("collection code: /api/session redeem -> 409 account-required (routes to sign-up)",
    red.status === 409 && red.json.error === "account-required" && red.json.code === code, JSON.stringify(red.json));

  const unknown = await call(H.session, { method: "POST", body: { code: "TOTALLY-BOGUS", preview: true } });
  ok("unknown code on the gate -> clean 404 unknown-code", unknown.status === 404 && unknown.json.error === "unknown-code", JSON.stringify(unknown.json));

  // --- learner account path: unknown + expired rejected cleanly ---
  const mk = async (email) => {
    await resetLimits();   // the suite drives many signups from one IP
    const j = jar(); const csrf = await getCsrf(j);
    await call(H.signup, { method: "POST", cookieJar: j, csrf, body: {
      firstName: "Race", lastName: "R", email, password: "R4ceScope!!", confirmPassword: "R4ceScope!!",
      function: "sales", aiLevel: "beginner", organization: "GATECO", agreeTerms: true } });
    await call(H.verify, { method: "POST", cookieJar: j, csrf, body: { token: tokenFromMail(lastMailTo(email)) } });
    return { j, csrf };
  };
  const u = await mk("race-unknown@example.com");
  const ru = await call(H.redeem, { method: "POST", cookieJar: u.j, csrf: u.csrf, body: { code: "NOPE-NOPE" } });
  ok("redeem unknown code -> 404 unknown-code", ru.status === 404 && ru.json.error === "unknown-code", JSON.stringify(ru.json));

  const past = new Date(Date.now() - 86400000).toISOString();
  const expGen = await call(H.adminCols, { method: "POST", cookieJar: aj, csrf: acsrf, body: {
    action: "generate_code", id: colId, label: "Expired", expiresAt: past } });
  const ue = await mk("race-expired@example.com");
  const re = await call(H.redeem, { method: "POST", cookieJar: ue.j, csrf: ue.csrf, body: { code: expGen.json.code.code } });
  ok("redeem expired code -> 403 code-expired", re.status === 403 && re.json.error === "code-expired", JSON.stringify(re.json));
  const pe = await call(H.session, { method: "POST", body: { code: expGen.json.code.code, preview: true } });
  ok("expired collection code on the gate -> 403 code-expired", pe.status === 403 && pe.json.error === "code-expired", JSON.stringify(pe.json));

  // --- seat-limit race: 20 concurrent redeems, max_redemptions = 5 -> exactly 5 ---
  const seatGen = await call(H.adminCols, { method: "POST", cookieJar: aj, csrf: acsrf, body: {
    action: "generate_code", id: colId, label: "Seats", maxRedemptions: 5 } });
  const seatCode = seatGen.json.code.code;
  const racers = [];
  for (let i = 0; i < 20; i++) racers.push(await mk(`race-${i}@example.com`));
  await resetLimits();
  // distinct IPs so the per-IP redeem limiter doesn't mask the DB seat guard —
  // the guard is what we're proving holds under concurrency.
  const outcomes = await Promise.all(racers.map((r, i) =>
    call(H.redeem, { method: "POST", cookieJar: r.j, csrf: r.csrf, ip: `10.1.0.${i + 1}`, body: { code: seatCode } }).then((x) => x.status)));
  const granted = outcomes.filter((s) => s === 200).length;
  const refused = outcomes.filter((s) => s === 403).length;
  ok("seat-limit race: exactly 5 of 20 concurrent redeems succeed, rest refused 403",
    granted === 5 && refused === 15, `statuses=${JSON.stringify(outcomes)}`);
  const finalCount = (await call(H.adminCols, { method: "GET", cookieJar: aj, query: {} }))
    .json.collections.find((c) => c.id === colId).codes.find((k) => k.code === seatCode).redemptions;
  ok("seat-limit race: stored redemption count is exactly 5 (no over-count)", finalCount === 5, `redemptions=${finalCount}`);

  // re-applying the SAME code you already hold doesn't burn another seat
  const holder = racers[outcomes.indexOf(200)];
  await resetLimits();
  const reapply = await call(H.redeem, { method: "POST", cookieJar: holder.j, csrf: holder.csrf, ip: "10.2.0.1", body: { code: seatCode } });
  const afterReapply = (await call(H.adminCols, { method: "GET", cookieJar: aj, query: {} }))
    .json.collections.find((c) => c.id === colId).codes.find((k) => k.code === seatCode).redemptions;
  ok("re-redeeming a held code is idempotent (no extra seat consumed)", reapply.status === 200 && afterReapply === 5, `redemptions=${afterReapply}`);
}

// ─────────────────────────────────────────────────────────────────────────────
console.log(`\n${pass}/${pass + fail} checks passed` + (fail ? `  (${fail} FAILED)` : "  ✓"));
process.exit(fail ? 1 : 0);
