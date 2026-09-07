// POST /api/auth/resend-verification   { email }
// Always 200 { ok } (no enumeration). Sends a fresh single-use link only if the
// address exists and is still unverified.
import { db, json, readBody } from "../_db.js";
import { checkCsrf } from "../_http.js";
import { rateLimit, ipKey, emailKey, tooMany } from "../_ratelimit.js";
import { validEmail } from "../_validate.js";
import { randomToken, sha256, newId } from "../_crypto.js";
import { sendEmail, appBaseUrl } from "../_email.js";
import { authEvent } from "../_audit.js";

const VERIFY_TTL_HOURS = 24;

export default async function handler(req, res) {
  if (req.method !== "POST") return json(res, 405, { error: "method-not-allowed" });
  let sql;
  try { sql = db(); } catch { return json(res, 503, { error: "no-backend" }); }
  if (!checkCsrf(req)) return json(res, 403, { error: "bad-csrf" });

  const body = await readBody(req);
  const ev = validEmail(body.email);
  if (ev.error) return json(res, 200, { ok: true });   // stay generic

  const rlIp = await rateLimit(sql, "resend_verify", ipKey(req));
  const rlEmail = await rateLimit(sql, "resend_verify", emailKey(ev.value));
  if (!rlIp.ok || !rlEmail.ok) return tooMany(res, json, Math.max(rlIp.retryAfter, rlEmail.retryAfter));

  const rows = await sql`select id, email, email_verified, account_status, first_name from users where email_norm = ${ev.value} limit 1`;
  if (rows.length && !rows[0].email_verified && rows[0].account_status === "pending_verification") {
    const u = rows[0];
    const token = randomToken(32);
    await sql`update email_verification_tokens set used_at = now() where user_id = ${u.id} and used_at is null`;
    await sql`insert into email_verification_tokens (id, user_id, token_hash, expires_at)
              values (${newId("evt")}, ${u.id}, ${sha256(token)}, now() + (${VERIFY_TTL_HOURS * 3600} || ' seconds')::interval)`;
    await sendEmail("verify_email", u.email, {
      email: u.email, verifyUrl: `${appBaseUrl(req)}/verify-email?token=${token}`, expiresHours: VERIFY_TTL_HOURS,
    });
    authEvent(sql, { userId: u.id, email: u.email, event: "verify_sent", req, meta: { resend: true } });
  }
  return json(res, 200, { ok: true });
}
