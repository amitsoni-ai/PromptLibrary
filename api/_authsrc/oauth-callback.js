// GET /api/auth/oauth-callback?code=…&state=…   (the provider redirects here)
// Exchanges the code, reads the verified identity from the ID token, then:
//   • a known Google/Microsoft account          -> signs that learner in
//   • a verified email that matches a learner   -> links it and signs them in
//     (and confirms their email if it was still pending)
//   • anyone else                               -> creates the account and signs in
// New accounts land on `/?oauth=new` so the SPA can ask for their function.
// Failures land on `/login?oauth_error=<code>`.
import { db } from "../_db.js";
import { appendCookie, serializeCookie, parseCookies, issueCsrf } from "../_http.js";
import { hashPassword, randomToken, sha256, newId } from "../_crypto.js";
import { createUserSession, attachUserSessionCookie } from "../_session.js";
import { rateLimit, ipKey } from "../_ratelimit.js";
import { authEvent, auditLog, entitlementEvent } from "../_audit.js";
import { sendEmail, appBaseUrl } from "../_email.js";
import { validEmail } from "../_validate.js";
import { grantAutoEntitlement } from "../_autogrant.js";
import { PROVIDERS, providerEnabled, decodeIdToken, ensureIdentitySchema } from "../_oauth.js";
import { OAUTH_COOKIE, redirect } from "./oauth-start.js";

const fail = (res, code) => redirect(res, `/login?oauth_error=${encodeURIComponent(code)}`);

export default async function handler(req, res) {
  if (req.method !== "GET") return fail(res, "failed");
  // one-shot: the state cookie is cleared whatever happens next
  appendCookie(res, serializeCookie(OAUTH_COOKIE, "", { httpOnly: true, sameSite: "Lax", maxAge: 0, path: "/api/auth" }));

  const q = req.query || {};
  if (q.error) return fail(res, q.error === "access_denied" ? "cancelled" : "failed");

  let st = null;
  try { st = JSON.parse(Buffer.from(parseCookies(req)[OAUTH_COOKIE] || "", "base64url").toString("utf8")); } catch {}
  if (!st || !st.s || !q.state || sha256(st.s) !== sha256(String(q.state)) || !q.code) return fail(res, "expired");
  const key = st.p;
  if (!providerEnabled(key)) return fail(res, "unavailable");
  const p = PROVIDERS[key];

  let sql;
  try { sql = db(); } catch { return fail(res, "failed"); }
  const rl = await rateLimit(sql, "oauth", ipKey(req));
  if (!rl.ok) return fail(res, "rate-limited");

  // ── code -> tokens ──────────────────────────────────────────────────────
  let claims;
  try {
    const r = await fetch(p.tokenUrl(), {
      method: "POST",
      headers: { "content-type": "application/x-www-form-urlencoded", accept: "application/json" },
      body: new URLSearchParams({
        grant_type: "authorization_code",
        code: String(q.code),
        redirect_uri: `${appBaseUrl(req)}/api/auth/oauth-callback`,
        client_id: p.clientId(),
        client_secret: p.clientSecret(),
        code_verifier: st.v,
      }),
    });
    const tok = await r.json().catch(() => ({}));
    if (!r.ok || !tok.id_token) {
      console.error("oauth token exchange failed", key, r.status, tok.error || "", tok.error_description || "");
      return fail(res, "failed");
    }
    claims = decodeIdToken(tok.id_token);
  } catch (e) {
    console.error("oauth token exchange error", key, String(e && e.message || e));
    return fail(res, "failed");
  }
  const aud = Array.isArray(claims && claims.aud) ? claims.aud : [claims && claims.aud];
  if (!claims || !claims.sub || !aud.includes(p.clientId()) || claims.nonce !== st.n) return fail(res, "failed");

  const rawEmail = claims.email || (key === "microsoft" ? claims.preferred_username : "") || "";
  const ev = validEmail(rawEmail);
  if (ev.error) return fail(res, "no-email");
  const email = ev.value;
  const verified = p.emailVerified(claims);
  const firstName = String(claims.given_name || (claims.name || "").split(" ")[0] || "").slice(0, 80);
  const lastName = String(claims.family_name || (claims.name || "").split(" ").slice(1).join(" ") || "").slice(0, 80);

  try {
    await ensureIdentitySchema(sql);

    // ── 1. known provider account ─────────────────────────────────────────
    let user = (await sql`select u.* from user_identities i join users u on u.id = i.user_id
                          where i.provider = ${key} and i.subject = ${String(claims.sub)} limit 1`)[0];
    let isNew = false;

    // ── 2. existing learner with the same email ───────────────────────────
    if (!user) {
      const existing = (await sql`select * from users where email_norm = ${email} limit 1`)[0];
      if (existing) {
        // Never attach an unproven address to someone else's account.
        if (!verified) return fail(res, "email-in-use");
        user = existing;
      }
    }

    // ── 3. brand-new learner ──────────────────────────────────────────────
    if (!user) {
      isNew = true;
      const id = newId("usr");
      // No password: an unguessable hash. "Forgot password" can set one later.
      const passwordHash = await hashPassword(randomToken(32));
      await sql`insert into users (id, email, email_norm, password_hash, first_name, last_name,
                  role, ai_level, org_name, job_function, account_status, email_verified, agreed_terms_at)
                values (${id}, ${email}, ${email}, ${passwordHash}, ${firstName}, ${lastName},
                  'general', 'beginner', '', null,
                  ${verified ? "active" : "pending_verification"}, ${verified}, now())`;
      await sql`insert into entitlements (id, user_id, source, scope_type, status, org_name, granted_by)
                values (${newId("ent")}, ${id}, 'self_signup', 'none', 'active', '', 'system')
                on conflict (user_id) do nothing`;
      authEvent(sql, { userId: id, email, event: "signup", req, meta: { provider: key } });
      auditLog(sql, { actorType: "user", actorId: id, actorLabel: email, action: "user.signup",
        targetType: "user", targetId: id, detail: { provider: key }, req });
      entitlementEvent(sql, { userId: id, actor: "system", action: "granted", detail: { scope: "none", source: "self_signup" } });
      user = (await sql`select * from users where id = ${id} limit 1`)[0];

      if (!verified) {
        const token = randomToken(32);
        await sql`insert into email_verification_tokens (id, user_id, token_hash, expires_at)
                  values (${newId("evt")}, ${id}, ${sha256(token)}, now() + interval '24 hours')`;
        sendEmail("welcome", email, { firstName, verifyUrl: `${appBaseUrl(req)}/verify-email?token=${token}` });
        authEvent(sql, { userId: id, email, event: "verify_sent", req });
      }
    }

    if (user.account_status === "disabled") {
      authEvent(sql, { userId: user.id, email, event: "login_fail", req, meta: { reason: "disabled", provider: key } });
      return fail(res, "account-disabled");
    }

    await sql`insert into user_identities (id, user_id, provider, subject, email, last_login_at)
              values (${newId("uid")}, ${user.id}, ${key}, ${String(claims.sub)}, ${email}, now())
              on conflict (provider, subject) do update set last_login_at = now(), email = excluded.email`;

    // The provider proved they own the address: confirm a still-pending account.
    if (verified && !user.email_verified) {
      await sql`update users set email_verified = true,
                account_status = case when account_status = 'pending_verification' then 'active' else account_status end,
                updated_at = now() where id = ${user.id}`;
      await sql`update email_verification_tokens set used_at = now() where user_id = ${user.id} and used_at is null`;
      authEvent(sql, { userId: user.id, email, event: "verify_ok", req, meta: { provider: key } });
      user = (await sql`select * from users where id = ${user.id} limit 1`)[0];
    }
    if (user.email_verified && user.account_status === "active") {
      const cur = (await sql`select * from entitlements where user_id = ${user.id} limit 1`)[0];
      await grantAutoEntitlement(sql, user, cur, { req, via: "oauth_" + key });
    }

    await sql`update users set failed_logins = 0, locked_until = null, last_login_at = now(), updated_at = now() where id = ${user.id}`;
    const { value, ttl } = await createUserSession(sql, user.id, { remember: true, req });
    attachUserSessionCookie(res, value, ttl);
    issueCsrf(res, req);
    authEvent(sql, { userId: user.id, email, event: "login_ok", req, meta: { provider: key } });
    auditLog(sql, { actorType: "user", actorId: user.id, actorLabel: email, action: "user.login",
      targetType: "user", targetId: user.id, detail: { provider: key }, req });
    return redirect(res, isNew ? "/?oauth=new" : "/");
  } catch (e) {
    console.error("oauth callback error", key, String(e && e.message || e));
    return fail(res, "failed");
  }
}
