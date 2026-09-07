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
  const schema = readFileSync(join(HERE, "schema_v2.sql"), "utf8").replace(/--.*$/gm, "");
  for (const stmt of schema.split(/;\s*(?:\n|$)/).map((s) => s.trim()).filter(Boolean)) await sql(stmt);
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
  adminSession: (await import("../api/_adminsrc/session.js")).default,
  adminUsers:   (await import("../api/_adminsrc/users.js")).default,
  adminEnt:     (await import("../api/_adminsrc/entitlements.js")).default,
  adminAudit:   (await import("../api/_adminsrc/audit.js")).default,
  adminAnalytics: (await import("../api/_adminsrc/analytics.js")).default,
};

async function call(handler, { method = "GET", query = {}, body = null, cookieJar, csrf } = {}) {
  const req = {
    method, query, headers: { host: "test.local", "user-agent": "authtest", "x-forwarded-for": "10.0.0.1" },
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
  // -> program scope, so all features unlock and the entitlement is active.
  ok("verify auto-grants access (no code): entitlement active, program-scoped",
    me.json.access.access.active === true && me.json.access.access.scopeType === "program",
    JSON.stringify(me.json.access.access));
  ok("auto-granted: library.full + practice + advanced_ai all allowed",
    me.json.access.features["library.full"] === true &&
    me.json.access.features["practice"] === true &&
    me.json.access.features["advanced_ai"] === true, JSON.stringify(me.json.access.features));
  ok("auto-granted: programIds carries the function's program",
    Array.isArray(me.json.access.programs) && me.json.access.programs.includes("prog-syn-it-eng"),
    JSON.stringify(me.json.access.programs));
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

// ─────────────────────────────────────────────────────────────────────────────
console.log(`\n${pass}/${pass + fail} checks passed` + (fail ? `  (${fail} FAILED)` : "  ✓"));
process.exit(fail ? 1 : 0);
