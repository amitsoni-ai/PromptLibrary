// resolveFunctionScope(sql, functionKey) — the effective library scope for a
// function/signup learner: admin-curated `function_scopes` row when present,
// otherwise the static default from api/_functions.js. Fails soft to the static
// default on any DB error so the auto-grant on verify never breaks.
//
// One global row per function for now (id = "fscope:<key>"); the schema_v3
// table also carries reserved `role_key` / `org_id` columns for later.
import { functionByKey } from "./_functions.js";

function staticScope(key) {
  const fn = functionByKey(key);
  if (!fn || fn.full) return { scopeType: "full", categories: [], programIds: [], promptIds: [] };
  return {
    scopeType: "function",
    categories: (fn.categories || []).slice(),
    programIds: (fn.programIds || []).slice(),
    promptIds: [],
  };
}

const asArray = (v) => (Array.isArray(v) ? v : []);

export async function resolveFunctionScope(sql, functionKey) {
  const base = staticScope(functionKey);
  if (base.scopeType === "full") return base;
  try {
    const rows = await sql`
      select categories, program_ids, prompt_ids, enabled
      from function_scopes
      where id = ${"fscope:" + String(functionKey || "").toLowerCase()} limit 1`;
    const r = rows[0];
    if (r && r.enabled !== false) {
      const categories = asArray(r.categories);
      const programIds = asArray(r.program_ids);
      const promptIds = asArray(r.prompt_ids);
      // an override with no categories/prompts is treated as "not configured"
      if (categories.length || promptIds.length) {
        return {
          scopeType: "function",
          categories: categories.length ? categories : base.categories,
          programIds: programIds.length ? programIds : base.programIds,
          promptIds,
        };
      }
    }
  } catch { /* fall through to static default */ }
  return base;
}
