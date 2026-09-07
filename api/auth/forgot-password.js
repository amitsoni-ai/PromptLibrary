// POST /api/auth/forgot-password   { email }
// Always 200 { ok } — never reveals whether the address exists (spec §6).
import { db, json, readBody } from "../_db.js";
import { checkCsrf, clientIp } from "../_http.js";
import { rateLimit, ipKey, emailKey, tooMany } from "../_ratelimit.js";
import { validEmail } from "../_validate.js";
import { randomToken, sha256, newId } from "../_crypto.js";
import { sendEmail, appBaseUrl } from "../_email.js";
import { authEvent } from "../_audit.js";

const RESET_TTL_MIN = 30;

export default async function handler(req, res) {
  if (req.method !== "POST") return json(res, 405, { error: "method-not-allowed" });
  let sql;
  try { sql = db(); } catch { return json(res, 503, { error: "no-backend" }); }
  if (!checkCsrf(req)) return json(res, 403, { error: "bad-csrf" });

  const body = await readBody(req);
  const ev = validEmail(body.email);
  if (ev.error) return json(res, 200, { ok: true });

  const rlIp = await rateLimit(sql, "forgot_password", ipKey(req));
  const rlEmail = await rateLimit(sql, "forgot_password", emailKey(ev.value));
  if (!rlIp.ok || !rlEmail.ok) return tooMany(res, json, Math.max(rlIp.retryAfter, rlEmail.retryAfter));

  const rows = await sql`select id, email, account_status from users where email_norm = ${ev.value} limit 1`;
  authEvent(sql, { email: ev.value, event: "reset_request", req, meta: { known: rows.length > 0 } });

  if (rows.length && rows[0].account_status !== "disabled") {
    const u = rows[0];
    const token = randomToken(32);
    await sql`update password_reset_tokens set used_at = now() where user_id = ${u.id} and used_at is null`;
    await sql`insert into password_reset_tokens (id, user_id, token_hash, expires_at, request_ip)
              values (${newId("prt")}, ${u.id}, ${sha256(token)},
                      now() + (${RESET_TTL_MIN * 60} || ' seconds')::interval, ${clientIp(req)})`;
    await sendEmail("password_reset", u.email, {
      email: u.email, resetUrl: `${appBaseUrl(req)}/reset-password?token=${token}`, expiresMinutes: RESET_TTL_MIN,
    });
  }
  return json(res, 200, { ok: true });
}
