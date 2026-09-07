// POST /api/auth/redeem-code   { code }
// Signed-in learners attach an access code to their account -> creates/updates
// their entitlement (spec §3). Verified email required.
import { db, json, readBody, normCode } from "../_db.js";
import { checkCsrf } from "../_http.js";
import { rateLimit, ipKey, tooMany } from "../_ratelimit.js";
import { resolveUser } from "../_session.js";
import { newId } from "../_crypto.js";
import { getUserAccess } from "../_access.js";
import { authEvent, auditLog, entitlementEvent } from "../_audit.js";
import { sendEmail, appBaseUrl } from "../_email.js";

export default async function handler(req, res) {
  if (req.method !== "POST") return json(res, 405, { error: "method-not-allowed" });
  let sql;
  try { sql = db(); } catch { return json(res, 503, { error: "no-backend" }); }
  if (!checkCsrf(req)) return json(res, 403, { error: "bad-csrf" });

  const ctx = await resolveUser(sql, req).catch(() => null);
  if (!ctx) return json(res, 401, { error: "auth" });
  if (!ctx.user.email_verified) return json(res, 403, { error: "verify-email-first" });
  if (ctx.user.account_status !== "active") return json(res, 403, { error: "account-" + ctx.user.account_status });

  const rl = await rateLimit(sql, "redeem_code", ipKey(req));
  if (!rl.ok) return tooMany(res, json, rl.retryAfter);

  const body = await readBody(req);
  const code = normCode(body.code);
  if (!code) return json(res, 400, { error: "missing-code" });

  const rows = await sql`select * from access_codes where upper(code) = ${code} limit 1`;
  if (!rows.length) return json(res, 404, { error: "unknown-code" });
  const c = rows[0];
  if (!c.enabled) return json(res, 403, { error: "code-disabled" });
  if (c.expires_at && new Date(c.expires_at) < new Date()) return json(res, 403, { error: "code-expired" });
  if (c.max_redemptions != null && c.redemptions >= c.max_redemptions) return json(res, 403, { error: "code-exhausted" });

  await sql`insert into entitlements (id, user_id, source, access_code, scope_type, program_ids,
              feature_flags, license_type, org_name, status, granted_by, expires_at)
            values (${newId("ent")}, ${ctx.user.id}, 'access_code', ${c.code}, ${c.scope_type},
              ${JSON.stringify(c.program_ids || [])}, ${JSON.stringify(c.feature_flags || {})},
              ${c.license_type}, ${c.org_name || ctx.user.org_name}, 'active', 'self', ${c.expires_at || null})
          on conflict (user_id) do update set
            source = 'access_code', access_code = excluded.access_code, scope_type = excluded.scope_type,
            program_ids = excluded.program_ids, feature_flags = excluded.feature_flags,
            license_type = excluded.license_type, org_name = excluded.org_name,
            status = 'active', expires_at = excluded.expires_at, updated_at = now()`;

  for (const pid of (c.program_ids || [])) {
    await sql`insert into program_enrollments (id, user_id, program_id, status, enrolled_by)
              values (${newId("enr")}, ${ctx.user.id}, ${pid}, 'active', 'self')
              on conflict (user_id, program_id) do update set status = 'active'`;
  }
  await sql`update access_codes set redemptions = redemptions + 1, updated_at = now() where id = ${c.id}`;

  authEvent(sql, { userId: ctx.user.id, email: ctx.user.email, event: "login_ok", req, meta: { redeemed: c.code } });
  entitlementEvent(sql, { userId: ctx.user.id, actor: "self", action: "code_redeemed",
    detail: { code: c.code, scope: c.scope_type, programIds: c.program_ids } });
  auditLog(sql, { actorType: "user", actorId: ctx.user.id, actorLabel: ctx.user.email, action: "access.code_redeemed",
    targetType: "user", targetId: ctx.user.id, detail: { code: c.code }, req });
  sendEmail("access_granted", ctx.user.email, { loginUrl: `${appBaseUrl(req)}/`, grantSummary: `Access code ${c.code} applied` });

  const fresh = (await sql`select * from users where id = ${ctx.user.id} limit 1`)[0];
  const access = await getUserAccess(sql, fresh);
  return json(res, 200, { ok: true, access });
}
