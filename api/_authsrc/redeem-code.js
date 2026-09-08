// POST /api/auth/redeem-code   { code }
// Signed-in learners attach an access code to their account. Codes STACK — each
// one is recorded in `user_access_codes` and the merged `entitlements` snapshot
// is rebuilt as the union (api/_entitlements.js#recomputeEntitlement). Verified
// email required.
import { db, json, readBody, normCode } from "../_db.js";
import { checkCsrf } from "../_http.js";
import { rateLimit, ipKey, tooMany } from "../_ratelimit.js";
import { resolveUser } from "../_session.js";
import { newId } from "../_crypto.js";
import { getUserAccess } from "../_access.js";
import { recomputeEntitlement } from "../_entitlements.js";
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
  // A disabled collection blocks redemption of all its codes (Bug 2c). Checked
  // before the per-code flag so the learner/admin gets the actionable reason
  // ("collection-disabled" -> re-activate the collection, not the code).
  if (c.collection_id) {
    const col = (await sql`select enabled from collections where id = ${c.collection_id} limit 1`)[0];
    if (col && col.enabled === false) return json(res, 403, { error: "collection-disabled" });
  }
  if (!c.enabled) return json(res, 403, { error: "code-disabled" });
  if (c.expires_at && new Date(c.expires_at) < new Date()) return json(res, 403, { error: "code-expired" });

  // Re-applying a code you already hold (active) doesn't consume another seat —
  // just refresh the snapshot below.
  const already = await sql`select 1 from user_access_codes
    where user_id = ${ctx.user.id} and upper(code) = ${code} and status = 'active' limit 1`;
  const reapply = already.length > 0;

  // Atomic seat claim: the WHERE guard makes "exactly max_redemptions succeed"
  // hold under concurrency — a check-then-increment would let all racers pass.
  if (!reapply) {
    const claim = await sql`update access_codes
        set redemptions = redemptions + 1, updated_at = now()
      where id = ${c.id}
        and enabled = true
        and (expires_at is null or expires_at > now())
        and (max_redemptions is null or redemptions < max_redemptions)
      returning redemptions`;
    if (!claim.length) {
      const fresh = (await sql`select enabled, expires_at, max_redemptions, redemptions from access_codes where id = ${c.id} limit 1`)[0] || {};
      if (fresh.enabled === false) return json(res, 403, { error: "code-disabled" });
      if (fresh.expires_at && new Date(fresh.expires_at) < new Date()) return json(res, 403, { error: "code-expired" });
      return json(res, 403, { error: "code-exhausted" });
    }
  }

  try {

  // Record this code (one row per user+code). Re-applying reactivates a
  // previously-removed row and refreshes its scope snapshot.
  await sql`insert into user_access_codes (id, user_id, code, source, scope_type,
              program_ids, category_ids, prompt_ids, feature_flags, license_type, org_name, status, expires_at)
            values (${newId("uac")}, ${ctx.user.id}, ${c.code}, 'access_code', ${c.scope_type},
              ${JSON.stringify(c.program_ids || [])}, ${JSON.stringify(c.category_ids || [])},
              ${JSON.stringify(c.prompt_ids || [])}, ${JSON.stringify(c.feature_flags || {})},
              ${c.license_type}, ${c.org_name || ctx.user.org_name}, 'active', ${c.expires_at || null})
          on conflict (user_id, upper(code)) do update set
            status = 'active', removed_at = null, source = 'access_code', scope_type = excluded.scope_type,
            program_ids = excluded.program_ids, category_ids = excluded.category_ids,
            prompt_ids = excluded.prompt_ids, feature_flags = excluded.feature_flags,
            license_type = excluded.license_type, org_name = excluded.org_name,
            expires_at = excluded.expires_at, redeemed_at = now()`;

  // Rebuild the merged entitlement from every active code the learner holds.
  await recomputeEntitlement(sql, ctx.user.id);

  authEvent(sql, { userId: ctx.user.id, email: ctx.user.email, event: "login_ok", req, meta: { redeemed: c.code } });
  entitlementEvent(sql, { userId: ctx.user.id, actor: "self", action: "code_redeemed",
    detail: { code: c.code, scope: c.scope_type, programIds: c.program_ids } });
  auditLog(sql, { actorType: "user", actorId: ctx.user.id, actorLabel: ctx.user.email, action: "access.code_redeemed",
    targetType: "user", targetId: ctx.user.id, detail: { code: c.code }, req });
  if (!reapply) sendEmail("access_granted", ctx.user.email, { loginUrl: `${appBaseUrl(req)}/`, grantSummary: `Access code ${c.code} applied` });

  const fresh = (await sql`select * from users where id = ${ctx.user.id} limit 1`)[0];
  const access = await getUserAccess(sql, fresh);
  return json(res, 200, { ok: true, access });

  } catch (e) {
    // Grant failed after the seat was claimed — release it so the count stays true.
    if (!reapply) {
      await sql`update access_codes set redemptions = greatest(redemptions - 1, 0), updated_at = now() where id = ${c.id}`.catch(() => {});
    }
    throw e;
  }
}
