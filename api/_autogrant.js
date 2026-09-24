// The function-scoped auto-entitlement (spec: no access code). The function
// stored in users.role decides the library scope. Only touches entitlements that
// are still self-serve — never overwrites an admin assignment. Shared by
// verify-email (password sign-up) and oauth-callback (Google / Microsoft).
import { newId } from "./_crypto.js";
import { auditLog, entitlementEvent } from "./_audit.js";
import { entitlementForFunction, functionByKey } from "./_functions.js";
import { resolveFunctionScope } from "./_funcscope.js";

export async function grantAutoEntitlement(sql, u, cur, { req, via }) {
  const selfServe = !cur || ["self_signup", "auto_function", "none", "collection_signup"].includes(cur.source || "none");
  if (!selfServe || (cur && cur.scope_type !== "none" && cur.status === "active")) return false;
  const grant = entitlementForFunction(u.role);
  const fn = functionByKey(u.role);
  const fs = grant.scopeType === "function"
    ? await resolveFunctionScope(sql, u.role)
    : { categories: [], programIds: grant.programIds, promptIds: [] };
  const programIds = fs.programIds && fs.programIds.length ? fs.programIds : grant.programIds;
  await sql`
    insert into entitlements (id, user_id, source, scope_type, program_ids, category_ids, prompt_ids,
      license_type, org_name, status, granted_by, note)
    values (${newId("ent")}, ${u.id}, 'auto_function', ${grant.scopeType},
      ${JSON.stringify(programIds)}, ${JSON.stringify(fs.categories || [])}, ${JSON.stringify(fs.promptIds || [])},
      'standard', ${u.org_name}, 'active', 'system',
      ${fn ? "Auto: " + fn.label : "Auto: full"})
    on conflict (user_id) do update set
      source = 'auto_function', scope_type = excluded.scope_type, program_ids = excluded.program_ids,
      category_ids = excluded.category_ids, prompt_ids = excluded.prompt_ids,
      status = 'active', granted_by = 'system', note = excluded.note, updated_at = now()`;
  for (const pid of programIds) {
    await sql`insert into program_enrollments (id, user_id, program_id, status, enrolled_by)
              values (${newId("enr")}, ${u.id}, ${pid}, 'active', 'system')
              on conflict (user_id, program_id) do update set status = 'active'`;
  }
  entitlementEvent(sql, { userId: u.id, actor: "system", action: "granted",
    detail: { via, function: u.role, scopeType: grant.scopeType,
      programIds, categories: fs.categories || [] } });
  auditLog(sql, { actorType: "system", actorId: "system", actorLabel: "auto", action: "access.auto_grant",
    targetType: "user", targetId: u.id, detail: { function: u.role, scopeType: grant.scopeType }, req });
  return true;
}
