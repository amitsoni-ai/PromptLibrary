// POST /api/auth/signup
// Body: firstName,lastName,email,password,confirmPassword,
//       function (mandatory — the learner's function/department; also accepted
//       as `role`), aiLevel, organization, agreeTerms
// -> 201 { ok, pending:true, access }   for a NEW account: creates the user
//    (account_status = pending_verification), signs them in immediately with
//    LIMITED / basic access, and emails the verification link. Verifying the
//    email later flips the account to `active` and unlocks full functionality.
//    For an existing address the response stays generic and issues NO session
//    (no enumeration); a still-unverified account just gets a fresh link.
import { db, json, readBody } from "../_db.js";
import { checkCsrf, issueCsrf } from "../_http.js";
import { rateLimit, ipKey, tooMany } from "../_ratelimit.js";
import { validateSignup } from "../_validate.js";
import { hashPassword, randomToken, sha256, newId } from "../_crypto.js";
import { createUserSession, attachUserSessionCookie } from "../_session.js";
import { getUserAccess } from "../_access.js";
import { sendEmail, appBaseUrl } from "../_email.js";
import { authEvent, auditLog, entitlementEvent } from "../_audit.js";

const VERIFY_TTL_HOURS = 24;

export default async function handler(req, res) {
  if (req.method !== "POST") return json(res, 405, { error: "method-not-allowed" });
  let sql;
  try { sql = db(); } catch { return json(res, 503, { error: "no-backend" }); }
  if (!checkCsrf(req)) return json(res, 403, { error: "bad-csrf" });

  const rl = await rateLimit(sql, "signup", ipKey(req));
  if (!rl.ok) return tooMany(res, json, rl.retryAfter);

  const body = await readBody(req);
  const v = validateSignup(body);
  if (v.error) return json(res, 422, { error: v.error, field: v.field, errors: v.errors });
  const d = v.value;

  const existing = await sql`select id, email_verified, account_status from users where email_norm = ${d.email} limit 1`;

  let userId;
  let isNew = false;
  if (existing.length) {
    const u = existing[0];
    authEvent(sql, { email: d.email, event: "signup", req, meta: { duplicate: true } });
    if (u.email_verified || u.account_status !== "pending_verification") {
      return json(res, 201, { ok: true, pending: true });   // generic, no session
    }
    userId = u.id;                                            // resend for the still-pending account
  } else {
    isNew = true;
    userId = newId("usr");
    const passwordHash = await hashPassword(d.password);
    await sql`insert into users (id, email, email_norm, password_hash, first_name, last_name,
                role, ai_level, org_name, job_function, account_status, email_verified, agreed_terms_at)
              values (${userId}, ${d.email}, ${d.email}, ${passwordHash}, ${d.firstName}, ${d.lastName},
                ${d.role}, ${d.aiLevel}, ${d.organization}, null,
                'pending_verification', false, now())`;
    await sql`insert into entitlements (id, user_id, source, scope_type, status, org_name, granted_by)
              values (${newId("ent")}, ${userId}, 'self_signup', 'none', 'active', ${d.organization}, 'system')
              on conflict (user_id) do nothing`;
    authEvent(sql, { userId, email: d.email, event: "signup", req });
    auditLog(sql, { actorType: "user", actorId: userId, actorLabel: d.email, action: "user.signup",
      targetType: "user", targetId: userId, detail: { role: d.role, org: d.organization }, req });
    entitlementEvent(sql, { userId, actor: "system", action: "granted", detail: { scope: "none", source: "self_signup" } });
  }

  // Single-use verification link.
  const token = randomToken(32);
  await sql`update email_verification_tokens set used_at = now() where user_id = ${userId} and used_at is null`;
  await sql`insert into email_verification_tokens (id, user_id, token_hash, expires_at)
            values (${newId("evt")}, ${userId}, ${sha256(token)},
                    now() + (${VERIFY_TTL_HOURS * 3600} || ' seconds')::interval)`;
  const verifyUrl = `${appBaseUrl(req)}/verify-email?token=${token}`;
  const mail = await sendEmail("welcome", d.email, { firstName: d.firstName, verifyUrl });
  authEvent(sql, { userId, email: d.email, event: "verify_sent", req });

  if (!isNew) return json(res, 201, { ok: true, pending: true });

  // New account -> sign in now with limited access.
  const { value, ttl } = await createUserSession(sql, userId, { remember: false, req });
  attachUserSessionCookie(res, value, ttl);
  issueCsrf(res, req);
  const u = (await sql`select * from users where id = ${userId} limit 1`)[0];
  const access = await getUserAccess(sql, u);
  return json(res, 201, { ok: true, pending: true, signedIn: true, access, emailSent: !!(mail && mail.ok) });
}
