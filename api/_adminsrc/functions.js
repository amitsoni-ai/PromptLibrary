// /api/admin/functions  — admin-curated per-function library scope (spec Piece 2).
// Backs the "Function access" tab in the console. Rows live in `function_scopes`
// (schema_v3); the learner path reads them via api/_funcscope.js on verify /
// profile change, so a save here changes what new function/signup learners see.
//
//   GET                              -> { functions: [{ key,label, default:{categories,programIds},
//                                                       scope:{categories,programIds,promptIds,enabled,label,updatedAt}|null,
//                                                       learners }] }
//   POST { action:"save", functionKey, categories?, programIds?, promptIds?, enabled? }
//   POST { action:"reset", functionKey }        -> revert to the static default
//   POST { action:"reapply", functionKey }      -> re-scope every current auto_function
//                                                  entitlement for that function
// Writes require the `access.write` capability + CSRF (skipped for a Bearer
// legacy-console token, matching _adminsrc/codes.js).
import { db, json, readBody } from "../_db.js";
import { checkCsrf } from "../_http.js";
import { requireAdmin } from "../_session.js";
import { FUNCTIONS, FUNCTION_KEYS, functionByKey } from "../_functions.js";
import { auditLog, entitlementEvent } from "../_audit.js";

const MAX_CATS = 60;
const MAX_PROGRAMS = 60;
const MAX_PROMPTS = 4000;

const cleanList = (v, cap) =>
  Array.isArray(v)
    ? Array.from(new Set(v.map((x) => String(x || "").trim()).filter(Boolean))).slice(0, cap)
    : [];

function scopeOut(row) {
  if (!row) return null;
  return {
    categories: Array.isArray(row.categories) ? row.categories : [],
    programIds: Array.isArray(row.program_ids) ? row.program_ids : [],
    promptIds: Array.isArray(row.prompt_ids) ? row.prompt_ids : [],
    enabled: row.enabled !== false,
    label: row.label || null,
    updatedAt: row.updated_at || null,
    updatedBy: row.updated_by || null,
  };
}

export default async function handler(req, res) {
  let sql;
  try { sql = db(); } catch { return json(res, 503, { error: "no-backend" }); }

  const write = req.method !== "GET";
  const gate = await requireAdmin(sql, req, write ? "access.write" : "access.read");
  if (gate.error) return json(res, gate.error, { error: gate.code });
  const admin = gate.admin;
  if (write && !req.headers.authorization && !checkCsrf(req)) return json(res, 403, { error: "bad-csrf" });
  const actor = { actorType: "admin", actorId: admin.id, actorLabel: admin.email, req };

  // ---------- GET ----------
  if (req.method === "GET") {
    let rows = [], counts = [];
    try {
      [rows, counts] = await Promise.all([
        sql`select * from function_scopes where role_key is null and org_id is null`,
        sql`select u.role as fn, count(*)::int as n
            from users u join entitlements e on e.user_id = u.id
            where e.source = 'auto_function' and e.status = 'active'
            group by u.role`,
      ]);
    } catch { /* table missing -> defaults only */ }
    const byKey = Object.fromEntries(rows.map((r) => [r.function_key, r]));
    const learners = Object.fromEntries(counts.map((c) => [c.fn, c.n]));
    const functions = FUNCTIONS.filter((f) => !f.full).map((f) => ({
      key: f.key,
      label: f.label,
      default: { categories: f.categories || [], programIds: f.programIds || [] },
      scope: scopeOut(byKey[f.key]),
      learners: learners[f.key] || 0,
    }));
    return json(res, 200, { functions });
  }

  // ---------- POST ----------
  const b = await readBody(req);
  const action = b.action || "save";
  const key = String(b.functionKey || "").toLowerCase();
  if (!FUNCTION_KEYS.includes(key) || key === "general") return json(res, 422, { error: "bad-function" });
  const id = "fscope:" + key;
  const fn = functionByKey(key);

  if (action === "save") {
    const categories = cleanList(b.categories, MAX_CATS);
    const programIds = cleanList(b.programIds, MAX_PROGRAMS);
    const promptIds = cleanList(b.promptIds, MAX_PROMPTS);
    const enabled = b.enabled !== false;
    await sql`
      insert into function_scopes (id, function_key, label, categories, program_ids, prompt_ids, enabled, updated_by, updated_at)
      values (${id}, ${key}, ${b.label || ("Custom: " + (fn ? fn.label : key))},
        ${JSON.stringify(categories)}, ${JSON.stringify(programIds)}, ${JSON.stringify(promptIds)},
        ${enabled}, ${admin.id}, now())
      on conflict (id) do update set
        categories = excluded.categories, program_ids = excluded.program_ids,
        prompt_ids = excluded.prompt_ids, enabled = excluded.enabled,
        label = excluded.label, updated_by = excluded.updated_by, updated_at = now()`;
    auditLog(sql, { ...actor, action: "function.scope_update", targetType: "function", targetId: key,
      detail: { categories: categories.length, programIds: programIds.length, promptIds: promptIds.length, enabled } });
    const row = (await sql`select * from function_scopes where id = ${id} limit 1`)[0];
    return json(res, 200, { ok: true, scope: scopeOut(row) });
  }

  if (action === "reset") {
    await sql`delete from function_scopes where id = ${id}`;
    auditLog(sql, { ...actor, action: "function.scope_reset", targetType: "function", targetId: key });
    return json(res, 200, { ok: true, scope: null });
  }

  if (action === "reapply") {
    const { resolveFunctionScope } = await import("../_funcscope.js");
    const fs = await resolveFunctionScope(sql, key);
    const affected = await sql`
      update entitlements set
        scope_type = 'function',
        program_ids = ${JSON.stringify(fs.programIds || [])},
        category_ids = ${JSON.stringify(fs.categories || [])},
        prompt_ids = ${JSON.stringify(fs.promptIds || [])},
        updated_at = now()
      where source = 'auto_function' and status = 'active'
        and user_id in (select id from users where role = ${key})
      returning user_id`;
    for (const r of affected) {
      entitlementEvent(sql, { userId: r.user_id, actor: admin.id, action: "modified",
        detail: { via: "function_scope_reapply", function: key } });
    }
    auditLog(sql, { ...actor, action: "function.scope_reapply", targetType: "function", targetId: key,
      detail: { learners: affected.length } });
    return json(res, 200, { ok: true, reapplied: affected.length });
  }

  return json(res, 400, { error: "unknown-action" });
}
