// Admin identity plane (spec §8) — completely separate from learner auth.
//   POST   /api/admin/session   { email, password }  -> { ok, admin } + syn_admin cookie
//   GET    /api/admin/session                        -> { authenticated, admin }
//   DELETE /api/admin/session                        -> { ok }   (logout)
//
// Bootstrap: if there are zero admin_users rows and ADMIN_BOOTSTRAP_EMAIL /
// ADMIN_BOOTSTRAP_PASSWORD are set, the first correct POST with that email
// creates the SUPER_ADMIN. (run_v2.mjs also seeds it.)
import { db, json, readBody } from "../_db.js";
import { checkCsrf, issueCsrf, clientIp } from "../_http.js";
import { rateLimit, ipKey, emailKey, tooMany } from "../_ratelimit.js";
import { validEmail } from "../_validate.js";
import { verifyPassword, burnTime, hashPassword, newId } from "../_crypto.js";
import { createAdminSession, attachAdminSessionCookie, clearAdminSessionCookie, revokeAdminSession, resolveAdmin } from "../_session.js";
import { authEvent, auditLog } from "../_audit.js";

const MAX_FAILS = 5;
const LOCK_MINUTES = 15;

function publicAdmin(a) {
  return { id: a.id, email: a.email, name: a.name, role: a.admin_role, status: a.status, lastLoginAt: a.last_login_at };
}

async function maybeBootstrap(sql, email, password) {
  const cnt = (await sql`select count(*)::int as n from admin_users`)[0].n;
  if (cnt > 0) return null;
  const be = (process.env.ADMIN_BOOTSTRAP_EMAIL || "").toLowerCase().trim();
  const bp = process.env.ADMIN_BOOTSTRAP_PASSWORD || "";
  if (!be || !bp || email !== be || password !== bp) return null;
  const id = newId("adm");
  await sql`insert into admin_users (id, email, email_norm, password_hash, name, admin_role, status, created_by)
            values (${id}, ${email}, ${email}, ${await hashPassword(bp)}, 'Super Admin', 'SUPER_ADMIN', 'active', 'bootstrap')`;
  return (await sql`select * from admin_users where id = ${id} limit 1`)[0];
}

export default async function handler(req, res) {
  let sql;
  try { sql = db(); } catch { return json(res, 503, { error: "no-backend" }); }

  if (req.method === "GET") {
    const ctx = await resolveAdmin(sql, req).catch(() => null);
    if (!ctx) return json(res, 200, { authenticated: false });
    issueCsrf(res, req);
    return json(res, 200, { authenticated: true, admin: publicAdmin(ctx.admin) });
  }

  if (req.method === "DELETE") {
    try { await revokeAdminSession(sql, req); } catch {}
    clearAdminSessionCookie(res);
    return json(res, 200, { ok: true });
  }

  if (req.method !== "POST") return json(res, 405, { error: "method-not-allowed" });
  if (!checkCsrf(req)) return json(res, 403, { error: "bad-csrf" });

  const rlIp = await rateLimit(sql, "admin_login", ipKey(req));
  if (!rlIp.ok) return tooMany(res, json, rlIp.retryAfter);

  const body = await readBody(req);
  const ev = validEmail(body.email);
  const password = String(body.password || "");
  if (ev.error || !password) { await burnTime(password); return json(res, 401, { error: "bad-credentials" }); }
  const rlEmail = await rateLimit(sql, "admin_login", emailKey(ev.value));
  if (!rlEmail.ok) return tooMany(res, json, rlEmail.retryAfter);

  let a = (await sql`select * from admin_users where email_norm = ${ev.value} limit 1`)[0];
  if (!a) a = await maybeBootstrap(sql, ev.value, password);
  if (!a) {
    await burnTime(password);
    authEvent(sql, { email: ev.value, event: "admin_login_fail", req, meta: { reason: "no-admin" } });
    return json(res, 401, { error: "bad-credentials" });
  }
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
  return json(res, 200, { ok: true, admin: publicAdmin(a) });
}
