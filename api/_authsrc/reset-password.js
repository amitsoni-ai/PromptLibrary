// POST /api/auth/reset-password   { token, password, confirmPassword }
// -> 200 { ok }  |  410 { error: "expired"|"used" }  |  400 { error:"invalid" }
// On success: sets the new hash, marks the token used, and revokes ALL of the
// user's existing sessions + any other outstanding reset tokens (spec §6).
import { db, json, readBody } from "../_db.js";
import { checkCsrf } from "../_http.js";
import { rateLimit, ipKey, tooMany } from "../_ratelimit.js";
import { validPassword } from "../_validate.js";
import { hashPassword, sha256 } from "../_crypto.js";
import { authEvent, auditLog } from "../_audit.js";

export default async function handler(req, res) {
  if (req.method !== "POST") return json(res, 405, { error: "method-not-allowed" });
  let sql;
  try { sql = db(); } catch { return json(res, 503, { error: "no-backend" }); }
  if (!checkCsrf(req)) return json(res, 403, { error: "bad-csrf" });

  const rl = await rateLimit(sql, "reset_password", ipKey(req));
  if (!rl.ok) return tooMany(res, json, rl.retryAfter);

  const body = await readBody(req);
  const token = String(body.token || "").trim();
  if (!token) return json(res, 400, { error: "missing-token" });
  const pv = validPassword(body.password);
  if (pv.error) return json(res, 422, { error: pv.error, field: "password" });
  if (String(body.password) !== String(body.confirmPassword ?? body.password))
    return json(res, 422, { error: "password-mismatch", field: "confirmPassword" });

  const rows = await sql`
    select t.*, u.email from password_reset_tokens t join users u on u.id = t.user_id
    where t.token_hash = ${sha256(token)} limit 1`;
  if (!rows.length) { authEvent(sql, { event: "reset_fail", req, meta: { reason: "invalid" } }); return json(res, 400, { error: "invalid" }); }
  const t = rows[0];
  if (t.used_at) return json(res, 410, { error: "used" });
  if (new Date(t.expires_at) < new Date()) {
    authEvent(sql, { userId: t.user_id, email: t.email, event: "reset_fail", req, meta: { reason: "expired" } });
    return json(res, 410, { error: "expired" });
  }

  const hash = await hashPassword(body.password);
  await sql`update users set password_hash = ${hash}, failed_logins = 0, locked_until = null, updated_at = now() where id = ${t.user_id}`;
  await sql`update password_reset_tokens set used_at = now() where user_id = ${t.user_id} and used_at is null`;
  await sql`update user_sessions set revoked_at = now() where user_id = ${t.user_id} and revoked_at is null`;
  authEvent(sql, { userId: t.user_id, email: t.email, event: "reset_ok", req });
  auditLog(sql, { actorType: "user", actorId: t.user_id, actorLabel: t.email, action: "user.password_reset",
    targetType: "user", targetId: t.user_id, req });

  return json(res, 200, { ok: true });
}
