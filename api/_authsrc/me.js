// GET  /api/auth/me    -> { authenticated, user, access }   (or { authenticated:false })
// PATCH /api/auth/me    { firstName?, lastName?, role?, aiLevel?, organization? }
//   -> updates the safe profile fields only. email / status / verification are
//   NOT editable here. Changing `role` (the function) re-scopes an auto-granted
//   library to match; an admin-assigned entitlement is left untouched.
import { db, json, readBody } from "../_db.js";
import { checkCsrf, issueCsrf } from "../_http.js";
import { resolveUser } from "../_session.js";
import { getUserAccess } from "../_access.js";
import { entitlementForFunction } from "../_functions.js";
import { resolveFunctionScope } from "../_funcscope.js";
import { newId } from "../_crypto.js";
import { str, ROLES, AI_LEVELS } from "../_validate.js";
import { auditLog, entitlementEvent } from "../_audit.js";

const SAFE = {
  firstName: (b) => str(b.firstName ?? b.first_name, { field: "firstName", min: 1, max: 80 }),
  lastName:  (b) => str(b.lastName ?? b.last_name, { field: "lastName", min: 1, max: 80 }),
  // "role" = the learner's function/department (one field; see _functions.js)
  role:      (b) => str(b.function ?? b.role, { field: "function", lower: true, allow: ROLES }),
  aiLevel:   (b) => str(b.aiLevel ?? b.ai_level, { field: "aiLevel", lower: true, allow: AI_LEVELS }),
  organization: (b) => str(b.organization ?? b.org_name, { field: "organization", min: 1, max: 120 }),
};
const COL = { firstName: "first_name", lastName: "last_name", role: "role", aiLevel: "ai_level", organization: "org_name" };

function publicUser(u, access) {
  return {
    id: u.id, email: u.email,
    firstName: u.first_name, lastName: u.last_name,
    role: u.role, function: u.role, aiLevel: u.ai_level, organization: u.org_name,
    emailVerified: !!u.email_verified, accountStatus: u.account_status,
    createdAt: u.created_at, lastLoginAt: u.last_login_at,
    profileCompletion: profilePct(u),
    access,
  };
}
function profilePct(u) {
  const fields = [u.first_name, u.last_name, u.role, u.ai_level, u.org_name];
  const done = fields.filter((f) => f && String(f).trim()).length + (u.email_verified ? 1 : 0);
  return Math.round((done / (fields.length + 1)) * 100);
}

export default async function handler(req, res) {
  let sql;
  try { sql = db(); } catch { return json(res, 503, { error: "no-backend" }); }

  issueCsrf(res, req);   // any caller can bootstrap a CSRF token from here
  const ctx = await resolveUser(sql, req).catch(() => null);
  if (!ctx) return json(res, 200, { authenticated: false });

  if (req.method === "GET") {
    const access = await getUserAccess(sql, ctx.user);
    return json(res, 200, { authenticated: true, user: publicUser(ctx.user, access), access });
  }

  if (req.method === "PATCH") {
    if (!checkCsrf(req)) return json(res, 403, { error: "bad-csrf" });
    const body = await readBody(req);
    const ALIAS = { role: ["function"] };   // accept `function` for the role/function field
    const sets = [], vals = [];
    for (const [key, parse] of Object.entries(SAFE)) {
      const keys = [key, COL[key], ...(ALIAS[key] || [])];
      if (keys.every((k) => body[k] === undefined)) continue;
      const r = parse(body);
      if (r.error) return json(res, 422, { error: r.error, field: r.field });
      sets.push(key); vals.push(r.value);
    }
    if (!sets.length) return json(res, 400, { error: "no-fields" });
    // build a parameterised UPDATE
    const assignments = sets.map((k, i) => `${COL[k]} = $${i + 1}`).join(", ");
    await sql(`update users set ${assignments}, updated_at = now() where id = $${sets.length + 1}`, [...vals, ctx.user.id]);
    auditLog(sql, { actorType: "user", actorId: ctx.user.id, actorLabel: ctx.user.email,
      action: "user.profile_update", targetType: "user", targetId: ctx.user.id, detail: { fields: sets }, req });
    const fresh = (await sql`select * from users where id = ${ctx.user.id} limit 1`)[0];

    // If the learner changed their function AND their entitlement is still the
    // auto one, re-scope the library to the new function (no code, no admin).
    if (sets.includes("role") && fresh.email_verified && fresh.account_status === "active") {
      const cur = (await sql`select * from entitlements where user_id = ${fresh.id} limit 1`)[0];
      if (cur && cur.source === "auto_function") {
        const grant = entitlementForFunction(fresh.role);
        const fs = grant.scopeType === "function"
          ? await resolveFunctionScope(sql, fresh.role)
          : { categories: [], programIds: grant.programIds, promptIds: [] };
        const programIds = fs.programIds && fs.programIds.length ? fs.programIds : grant.programIds;
        await sql`update entitlements set scope_type = ${grant.scopeType},
          program_ids = ${JSON.stringify(programIds)}, category_ids = ${JSON.stringify(fs.categories || [])},
          prompt_ids = ${JSON.stringify(fs.promptIds || [])}, status = 'active', updated_at = now()
          where user_id = ${fresh.id}`;
        // drop system enrolments that no longer match the chosen function
        await sql`update program_enrollments set status = 'removed'
          where user_id = ${fresh.id} and enrolled_by = 'system'
          and not (program_id = any(${programIds}))`;
        for (const pid of programIds) {
          await sql`insert into program_enrollments (id, user_id, program_id, status, enrolled_by)
                    values (${newId("enr")}, ${fresh.id}, ${pid}, 'active', 'system')
                    on conflict (user_id, program_id) do update set status = 'active'`;
        }
        entitlementEvent(sql, { userId: fresh.id, actor: "self", action: "modified",
          detail: { via: "profile_function_change", function: fresh.role, scopeType: grant.scopeType,
            programIds, categories: fs.categories || [] } });
      }
    }

    const access = await getUserAccess(sql, fresh);
    return json(res, 200, { ok: true, user: publicUser(fresh, access), access });
  }

  return json(res, 405, { error: "method-not-allowed" });
}
