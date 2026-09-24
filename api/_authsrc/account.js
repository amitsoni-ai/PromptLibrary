// /api/auth/account — the signed-in learner's own account settings.
//
// GET  -> { email, hasPassword, methods: [{ provider, email, linkedAt, lastLoginAt }],
//           providers: [enabled social providers], otherSessions }
// POST { op: "password", currentPassword?, newPassword }
//        set or change the password. currentPassword is required only when the
//        account already has one (a Google/Microsoft-only account sets its first
//        password with just the session). Signs out every other device.
// POST { op: "unlink", provider }
//        disconnect Google / Microsoft, only if another way to sign in remains.
// POST { op: "logout-others" }
//        end every session except this one.
// POST { op: "delete", password?, confirmEmail? }
//        permanently delete the account: password if it has one, otherwise the
//        account email typed back. Personal data is deleted; security logs are
//        kept anonymised (see /privacy §10).
import { db, json, readBody } from "../_db.js";
import { checkCsrf, clearCookie, CSRF_COOKIE } from "../_http.js";
import { resolveUser, clearUserSessionCookie } from "../_session.js";
import { hashPassword, verifyPassword, burnTime } from "../_crypto.js";
import { rateLimit, tooMany } from "../_ratelimit.js";
import { validPassword, normEmail } from "../_validate.js";
import { authEvent, auditLog } from "../_audit.js";
import { sendEmail, appBaseUrl } from "../_email.js";
import { PROVIDERS, enabledProviders, ensureIdentitySchema } from "../_oauth.js";

// Accounts created through Google / Microsoft carry data.password_set = false
// (their stored hash is random). Every other account has a real password.
export function hasPassword(u) {
  return !(u && u.data && u.data.password_set === false);
}

export default async function handler(req, res) {
  let sql;
  try { sql = db(); } catch { return json(res, 503, { error: "no-backend" }); }
  if (req.method !== "GET" && req.method !== "POST") return json(res, 405, { error: "method-not-allowed" });
  if (!checkCsrf(req)) return json(res, 403, { error: "bad-csrf" });

  const ctx = await resolveUser(sql, req).catch(() => null);
  if (!ctx) return json(res, 401, { error: "auth" });
  const u = ctx.user;
  await ensureIdentitySchema(sql);

  if (req.method === "GET") return json(res, 200, await summary(sql, u, ctx.sessionId));

  const body = await readBody(req);
  const rl = await rateLimit(sql, "account", "user:" + u.id);
  if (!rl.ok) return tooMany(res, json, rl.retryAfter);

  if (body.op === "password") return changePassword(sql, req, res, ctx, body);
  if (body.op === "unlink") return unlink(sql, req, res, ctx, body);
  if (body.op === "logout-others") {
    const r = await sql`update user_sessions set revoked_at = now()
                        where user_id = ${u.id} and id <> ${ctx.sessionId} and revoked_at is null returning id`;
    authEvent(sql, { userId: u.id, email: u.email, event: "logout", req, meta: { others: r.length } });
    return json(res, 200, { ok: true, ended: r.length, ...(await summary(sql, u, ctx.sessionId)) });
  }
  if (body.op === "delete") return deleteAccount(sql, req, res, ctx, body);
  return json(res, 400, { error: "unknown-op" });
}

async function summary(sql, u, sessionId) {
  const ids = await sql`select provider, email, created_at, last_login_at from user_identities
                        where user_id = ${u.id} order by created_at`;
  const others = (await sql`select count(*)::int as n from user_sessions
                            where user_id = ${u.id} and id <> ${sessionId}
                              and revoked_at is null and expires_at > now()`)[0].n;
  return {
    email: u.email,
    hasPassword: hasPassword(u),
    methods: ids.map((i) => ({ provider: i.provider, label: (PROVIDERS[i.provider] || {}).label || i.provider,
      email: i.email, linkedAt: i.created_at, lastLoginAt: i.last_login_at })),
    providers: enabledProviders(),
    otherSessions: others,
  };
}

async function fullUser(sql, id) {
  return (await sql`select * from users where id = ${id} limit 1`)[0];
}

async function changePassword(sql, req, res, ctx, body) {
  const u = await fullUser(sql, ctx.user.id);
  const had = hasPassword(u);
  if (had) {
    const ok = await verifyPassword(String(body.currentPassword || ""), u.password_hash);
    if (!ok) {
      authEvent(sql, { userId: u.id, email: u.email, event: "reset_fail", req, meta: { via: "account", reason: "bad-current" } });
      return json(res, 401, { error: "bad-current-password" });
    }
  }
  const pv = validPassword(body.newPassword);
  if (pv.error) return json(res, 422, { error: pv.error, field: "newPassword" });

  const hash = await hashPassword(pv.value);
  await sql`update users set password_hash = ${hash}, failed_logins = 0, locked_until = null,
              data = coalesce(data, '{}'::jsonb) || '{"password_set": true}'::jsonb, updated_at = now()
            where id = ${u.id}`;
  // A changed password should lock out anyone else holding a session.
  await sql`update user_sessions set revoked_at = now()
            where user_id = ${u.id} and id <> ${ctx.sessionId} and revoked_at is null`;
  authEvent(sql, { userId: u.id, email: u.email, event: "password_changed", req, meta: { via: "account", first: !had } });
  auditLog(sql, { actorType: "user", actorId: u.id, actorLabel: u.email, action: had ? "user.password_changed" : "user.password_set",
    targetType: "user", targetId: u.id, req });
  sendEmail("password_changed", u.email, { firstName: u.first_name, resetUrl: `${appBaseUrl(req)}/forgot-password`, first: !had });
  return json(res, 200, { ok: true, ...(await summary(sql, { ...u, data: { ...(u.data || {}), password_set: true } }, ctx.sessionId)) });
}

async function unlink(sql, req, res, ctx, body) {
  const provider = String(body.provider || "").toLowerCase();
  const u = await fullUser(sql, ctx.user.id);
  const ids = await sql`select provider from user_identities where user_id = ${u.id}`;
  if (!ids.some((i) => i.provider === provider)) return json(res, 404, { error: "not-linked" });
  const remaining = ids.filter((i) => i.provider !== provider).length + (hasPassword(u) ? 1 : 0);
  if (remaining < 1) return json(res, 409, { error: "last-method" });
  await sql`delete from user_identities where user_id = ${u.id} and provider = ${provider}`;
  authEvent(sql, { userId: u.id, email: u.email, event: "provider_unlinked", req, meta: { provider } });
  auditLog(sql, { actorType: "user", actorId: u.id, actorLabel: u.email, action: "user.provider_unlinked",
    targetType: "user", targetId: u.id, detail: { provider }, req });
  return json(res, 200, { ok: true, ...(await summary(sql, u, ctx.sessionId)) });
}

async function deleteAccount(sql, req, res, ctx, body) {
  const u = await fullUser(sql, ctx.user.id);
  if (hasPassword(u)) {
    const ok = await verifyPassword(String(body.password || ""), u.password_hash);
    if (!ok) return json(res, 401, { error: "bad-password" });
  } else {
    await burnTime();
    if (normEmail(body.confirmEmail) !== u.email_norm) return json(res, 422, { error: "email-mismatch" });
  }

  const subject = "user:" + u.id;
  // Personal data and saved work.
  await sql`delete from learner_state where subject = ${subject}`;
  await sql`delete from activity where subject = ${subject}`;
  await sql`delete from entitlement_events where user_id = ${u.id}`;
  // Security logs stay (they protect other accounts too) but lose what identifies the person.
  await sql`update auth_events set email_norm = null, ip = null, user_agent = null where user_id = ${u.id}`;
  await sql`update audit_logs set actor_label = 'deleted user', ip = null where actor_id = ${u.id}`;
  // Sessions, tokens, entitlements, enrolments, access codes and linked
  // Google/Microsoft accounts all cascade from the users row.
  await sql`delete from users where id = ${u.id}`;
  auditLog(sql, { actorType: "user", actorId: u.id, actorLabel: "deleted user", action: "user.deleted",
    targetType: "user", targetId: u.id, req });

  clearUserSessionCookie(res);
  clearCookie(res, CSRF_COOKIE);
  return json(res, 200, { ok: true, deleted: true });
}
