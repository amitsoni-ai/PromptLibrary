// POST /api/auth/remove-code   { code }
// Detach one access code from the signed-in learner. The merged entitlement is
// rebuilt from whatever codes remain (api/_entitlements.js#recomputeEntitlement);
// removing the last one reverts to the function auto-grant.
import { db, json, readBody, normCode } from "../_db.js";
import { checkCsrf } from "../_http.js";
import { resolveUser } from "../_session.js";
import { getUserAccess } from "../_access.js";
import { recomputeEntitlement } from "../_entitlements.js";
import { auditLog, entitlementEvent } from "../_audit.js";

export default async function handler(req, res) {
  if (req.method !== "POST") return json(res, 405, { error: "method-not-allowed" });
  let sql;
  try { sql = db(); } catch { return json(res, 503, { error: "no-backend" }); }
  if (!checkCsrf(req)) return json(res, 403, { error: "bad-csrf" });

  const ctx = await resolveUser(sql, req).catch(() => null);
  if (!ctx) return json(res, 401, { error: "auth" });
  if (ctx.user.account_status !== "active") return json(res, 403, { error: "account-" + ctx.user.account_status });

  const body = await readBody(req);
  const code = normCode(body.code);
  if (!code) return json(res, 400, { error: "missing-code" });

  const removed = await sql`update user_access_codes
      set status = 'removed', removed_at = now()
    where user_id = ${ctx.user.id} and upper(code) = ${code} and status = 'active'
    returning id`;
  if (!removed.length) return json(res, 404, { error: "code-not-applied" });

  // Free the seat on the shared code.
  await sql`update access_codes set redemptions = greatest(redemptions - 1, 0), updated_at = now()
    where upper(code) = ${code}`.catch(() => {});

  await recomputeEntitlement(sql, ctx.user.id);

  entitlementEvent(sql, { userId: ctx.user.id, actor: "self", action: "code_removed", detail: { code } });
  auditLog(sql, { actorType: "user", actorId: ctx.user.id, actorLabel: ctx.user.email, action: "access.code_removed",
    targetType: "user", targetId: ctx.user.id, detail: { code }, req });

  const fresh = (await sql`select * from users where id = ${ctx.user.id} limit 1`)[0];
  const access = await getUserAccess(sql, fresh);
  return json(res, 200, { ok: true, access });
}
