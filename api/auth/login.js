// POST /api/auth/login   { email, password, remember? }
// -> 200 { ok, access }  + Set-Cookie session   |   401 { error }
// Brute-force: per-IP + per-email rate limit, plus a progressive per-account
// lockout (5 fails -> 15 min). Response time is levelled for unknown emails.
import { db, json, readBody } from "../_db.js";
import { checkCsrf } from "../_http.js";
import { rateLimit, ipKey, emailKey, tooMany } from "../_ratelimit.js";
import { validEmail } from "../_validate.js";
import { verifyPassword, burnTime } from "../_crypto.js";
import { createUserSession, attachUserSessionCookie, createAdminSession, attachAdminSessionCookie } from "../_session.js";
import { issueCsrf } from "../_http.js";
import { getUserAccess } from "../_access.js";
import { authEvent, auditLog } from "../_audit.js";

const MAX_FAILS = 5;
const LOCK_MINUTES = 15;

// One sign-in form for everyone. If the email isn't a learner account, try the
// admin directory — a matching admin (system-admin role) is signed straight into
// the admin console, no separate login page.
async function tryAdminLogin(sql, req, res, email, password) {
  const a = (await sql`select * from admin_users where email_norm = ${email} limit 1`)[0];
  if (!a) return null;
  if (a.status !== "active") return json(res, 403, { error: "admin-" + a.status });
  if (a.locked_until && new Date(a.locked_until) > new Date()) {
    const secs = Math.ceil((new Date(a.locked_until) - Date.now()) / 1000);
    res.setHeader("Retry-After", String(secs));
    return json(res, 423, { error: "account-locked", retryAfter: secs });
  }
  const ok = await verifyPassword(password, a.password_hash);
  if (!ok) {
    const fails = (a.failed_logins || 0) + 1;
    const lockedUntil = fails >= MAX_FAILS ? new Date(Date.now() + LOCK_MINUTES * 60000).toISOString() : null;
    await sql`update admin_users set failed_logins = ${fails}, locked_until = ${lockedUntil}, updated_at = now() where id = ${a.id}`;
    authEvent(sql, { userId: a.id, email: a.email, event: "admin_login_fail", req, meta: { fails } });
    return json(res, 401, { error: "bad-credentials" });
  }
  await sql`update admin_users set failed_logins = 0, locked_until = null, last_login_at = now(), updated_at = now() where id = ${a.id}`;
  const { value, ttl } = await createAdminSession(sql, a.id, { req });
  attachAdminSessionCookie(res, value, ttl);
  issueCsrf(res, req);
  authEvent(sql, { userId: a.id, email: a.email, event: "admin_login_ok", req });
  auditLog(sql, { actorType: "admin", actorId: a.id, actorLabel: a.email, action: "admin.login", req });
  return json(res, 200, { ok: true, isAdmin: true,
    admin: { id: a.id, email: a.email, name: a.name, role: a.admin_role } });
}

export default async function handler(req, res) {
  if (req.method !== "POST") return json(res, 405, { error: "method-not-allowed" });
  let sql;
  try { sql = db(); } catch { return json(res, 503, { error: "no-backend" }); }
  if (!checkCsrf(req)) return json(res, 403, { error: "bad-csrf" });

  const body = await readBody(req);
  const ev = validEmail(body.email);
  const password = String(body.password || "");
  const remember = body.remember === true || body.remember === "true";

  const rlIp = await rateLimit(sql, "login", ipKey(req));
  if (!rlIp.ok) return tooMany(res, json, rlIp.retryAfter);
  if (ev.error || !password) { await burnTime(password); return json(res, 401, { error: "bad-credentials" }); }
  const rlEmail = await rateLimit(sql, "login_email", emailKey(ev.value));
  if (!rlEmail.ok) return tooMany(res, json, rlEmail.retryAfter);

  const rows = await sql`select * from users where email_norm = ${ev.value} limit 1`;
  if (!rows.length) {
    const adminResult = await tryAdminLogin(sql, req, res, ev.value, password);
    if (adminResult) return adminResult;
    await burnTime(password);
    authEvent(sql, { email: ev.value, event: "login_fail", req, meta: { reason: "no-user" } });
    return json(res, 401, { error: "bad-credentials" });
  }
  const u = rows[0];

  if (u.locked_until && new Date(u.locked_until) > new Date()) {
    authEvent(sql, { userId: u.id, email: u.email, event: "login_fail", req, meta: { reason: "locked" } });
    const secs = Math.ceil((new Date(u.locked_until) - Date.now()) / 1000);
    res.setHeader("Retry-After", String(secs));
    return json(res, 423, { error: "account-locked", retryAfter: secs,
      message: "Too many attempts. Try again in a few minutes or reset your password." });
  }

  const ok = await verifyPassword(password, u.password_hash);
  if (!ok) {
    const fails = (u.failed_logins || 0) + 1;
    const lock = fails >= MAX_FAILS;
    const lockedUntil = lock ? new Date(Date.now() + LOCK_MINUTES * 60000).toISOString() : null;
    await sql`update users set failed_logins = ${fails}, locked_until = ${lockedUntil}, updated_at = now() where id = ${u.id}`;
    authEvent(sql, { userId: u.id, email: u.email, event: lock ? "lockout" : "login_fail", req, meta: { fails } });
    return json(res, 401, { error: "bad-credentials" });
  }

  if (u.account_status === "disabled") {
    authEvent(sql, { userId: u.id, email: u.email, event: "login_fail", req, meta: { reason: "disabled" } });
    return json(res, 403, { error: "account-disabled", message: "This account has been disabled. Contact your programme lead." });
  }

  await sql`update users set failed_logins = 0, locked_until = null, last_login_at = now(), updated_at = now() where id = ${u.id}`;
  const { value, ttl } = await createUserSession(sql, u.id, { remember, req });
  attachUserSessionCookie(res, value, ttl);
  issueCsrf(res, req);
  authEvent(sql, { userId: u.id, email: u.email, event: "login_ok", req, meta: { remember } });
  auditLog(sql, { actorType: "user", actorId: u.id, actorLabel: u.email, action: "user.login", targetType: "user", targetId: u.id, req });

  const access = await getUserAccess(sql, { ...u });
  // A suspended account authenticates but is access-blocked everywhere (spec §11).
  return json(res, 200, {
    ok: true,
    needsVerification: !u.email_verified,
    suspended: u.account_status === "suspended",
    access,
  });
}
