// POST /api/auth/verify-email   { token }
// GET  /api/auth/verify-email?token=...   (convenience; same logic)
// -> { ok, status: "verified" | "already" }  or 4xx { error: "expired"|"invalid"|"used" }
// On success: email_verified = true, account_status pending -> active, the
// learner is auto-granted an entitlement scoped to the function they chose at
// sign-up (no access code step), and is signed in.
import { db, json, readBody } from "../_db.js";
import { rateLimit, ipKey, tooMany } from "../_ratelimit.js";
import { sha256, newId } from "../_crypto.js";
import { createUserSession, attachUserSessionCookie } from "../_session.js";
import { issueCsrf } from "../_http.js";
import { authEvent, auditLog, entitlementEvent } from "../_audit.js";
import { getUserAccess } from "../_access.js";
import { entitlementForFunction, functionByKey } from "../_functions.js";
import { sendEmail, appBaseUrl } from "../_email.js";

export default async function handler(req, res) {
  let sql;
  try { sql = db(); } catch { return json(res, 503, { error: "no-backend" }); }
  if (req.method !== "POST" && req.method !== "GET") return json(res, 405, { error: "method-not-allowed" });

  const rl = await rateLimit(sql, "verify", ipKey(req));
  if (!rl.ok) return tooMany(res, json, rl.retryAfter);

  const body = req.method === "POST" ? await readBody(req) : {};
  const token = (body.token || (req.query && req.query.token) || "").trim();
  if (!token) return json(res, 400, { error: "missing-token" });

  const rows = await sql`
    select t.*, u.email, u.email_verified, u.account_status, u.first_name
    from email_verification_tokens t join users u on u.id = t.user_id
    where t.token_hash = ${sha256(token)} limit 1`;
  if (!rows.length) {
    authEvent(sql, { email: null, event: "verify_fail", req, meta: { reason: "invalid" } });
    return json(res, 400, { error: "invalid" });
  }
  const t = rows[0];

  if (t.email_verified && t.account_status === "active") {
    return json(res, 200, { ok: true, status: "already" });
  }
  if (t.used_at) return json(res, 410, { error: "used" });
  if (new Date(t.expires_at) < new Date()) {
    authEvent(sql, { userId: t.user_id, email: t.email, event: "verify_fail", req, meta: { reason: "expired" } });
    return json(res, 410, { error: "expired" });
  }

  await sql`update email_verification_tokens set used_at = now() where id = ${t.id}`;
  await sql`update users set email_verified = true,
            account_status = case when account_status = 'pending_verification' then 'active' else account_status end,
            updated_at = now() where id = ${t.user_id}`;
  authEvent(sql, { userId: t.user_id, email: t.email, event: "verify_ok", req });
  auditLog(sql, { actorType: "user", actorId: t.user_id, actorLabel: t.email, action: "user.email_verified",
    targetType: "user", targetId: t.user_id, req });

  const uRows = await sql`select * from users where id = ${t.user_id} limit 1`;
  const u = uRows[0];

  // ── Auto-entitlement (spec: no access code). The function chosen at sign-up
  //    (stored in users.role) decides the library scope. Only touch entitlements
  //    that are still self-serve — never overwrite an admin assignment.
  const cur = (await sql`select * from entitlements where user_id = ${u.id} limit 1`)[0];
  const selfServe = !cur || ["self_signup", "auto_function", "none"].includes(cur.source || "none");
  if (selfServe && (!cur || cur.scope_type === "none" || cur.status !== "active")) {
    const grant = entitlementForFunction(u.role);
    const fn = functionByKey(u.role);
    await sql`
      insert into entitlements (id, user_id, source, scope_type, program_ids, license_type,
        org_name, status, granted_by, note)
      values (${newId("ent")}, ${u.id}, 'auto_function', ${grant.scopeType},
        ${JSON.stringify(grant.programIds)}, 'standard', ${u.org_name}, 'active', 'system',
        ${fn ? "Auto: " + fn.label : "Auto: full"})
      on conflict (user_id) do update set
        source = 'auto_function', scope_type = excluded.scope_type, program_ids = excluded.program_ids,
        status = 'active', granted_by = 'system', note = excluded.note, updated_at = now()`;
    for (const pid of grant.programIds) {
      await sql`insert into program_enrollments (id, user_id, program_id, status, enrolled_by)
                values (${newId("enr")}, ${u.id}, ${pid}, 'active', 'system')
                on conflict (user_id, program_id) do update set status = 'active'`;
    }
    entitlementEvent(sql, { userId: u.id, actor: "system", action: "granted",
      detail: { via: "verify_email", function: u.role, scopeType: grant.scopeType, programIds: grant.programIds } });
    auditLog(sql, { actorType: "system", actorId: "system", actorLabel: "auto", action: "access.auto_grant",
      targetType: "user", targetId: u.id, detail: { function: u.role, scopeType: grant.scopeType }, req });
  }

  const access = await getUserAccess(sql, u);
  if (access.access.active) {
    sendEmail("access_granted", t.email, {
      loginUrl: `${appBaseUrl(req)}/`,
      grantSummary: "Your email is confirmed and your library is ready",
    });
  }

  // sign them in
  const { value, ttl } = await createUserSession(sql, t.user_id, { remember: false, req });
  attachUserSessionCookie(res, value, ttl);
  issueCsrf(res, req);

  return json(res, 200, { ok: true, status: "verified", access });
}
