// ─────────────────────────────────────────────────────────────────────────────
// recomputeEntitlement(sql, userId)
//
// A learner may hold SEVERAL access codes at once (`user_access_codes`); their
// effective library is the UNION of all of them. The `entitlements` table stays
// as the single merged snapshot every other reader consumes — this function
// rebuilds that row from the active `user_access_codes` rows after each
// redeem / remove. When the learner holds no codes it falls back to the
// function auto-grant (mirrors api/_authsrc/verify-email.js) so removing the
// last code never strands them.
// ─────────────────────────────────────────────────────────────────────────────
import { newId } from "./_crypto.js";
import { entitlementEvent } from "./_audit.js";
import { entitlementForFunction, functionByKey } from "./_functions.js";
import { resolveFunctionScope } from "./_funcscope.js";

const SCOPE_RANK = { none: 0, collection: 1, function: 2, program: 2, track: 2, full: 3 };
const LICENSE_RANK = { trial: 0, standard: 1, enterprise: 2 };

async function upsertEntitlement(sql, userId, e) {
  await sql`
    insert into entitlements (id, user_id, source, access_code, scope_type, program_ids,
        category_ids, prompt_ids, feature_flags, license_type, org_name, status, granted_by, note, expires_at)
    values (${newId("ent")}, ${userId}, ${e.source}, ${e.accessCode || null}, ${e.scopeType},
        ${JSON.stringify(e.programIds || [])}, ${JSON.stringify(e.categoryIds || [])},
        ${JSON.stringify(e.promptIds || [])}, ${JSON.stringify(e.featureFlags || {})},
        ${e.licenseType || "standard"}, ${e.orgName || null}, 'active', 'self', ${e.note || null}, ${e.expiresAt || null})
    on conflict (user_id) do update set
      source = excluded.source, access_code = excluded.access_code, scope_type = excluded.scope_type,
      program_ids = excluded.program_ids, category_ids = excluded.category_ids, prompt_ids = excluded.prompt_ids,
      feature_flags = excluded.feature_flags, license_type = excluded.license_type, org_name = excluded.org_name,
      status = 'active', note = excluded.note, expires_at = excluded.expires_at, updated_at = now()`;
}

// Bring program_enrollments in line with the merged program set — drop the
// self / system rows that no longer apply, (re)activate the ones that do.
async function reconcileEnrollments(sql, userId, programIds) {
  const ids = Array.from(new Set(programIds || []));
  await sql`update program_enrollments set status = 'removed'
    where user_id = ${userId} and enrolled_by in ('self', 'system')
      and not (program_id = any(${ids}))`;
  for (const pid of ids) {
    await sql`insert into program_enrollments (id, user_id, program_id, status, enrolled_by)
              values (${newId("enr")}, ${userId}, ${pid}, 'active', 'self')
              on conflict (user_id, program_id) do update set status = 'active'`;
  }
}

export async function recomputeEntitlement(sql, userId) {
  const [codes, curRows, uRows] = await Promise.all([
    sql`select * from user_access_codes where user_id = ${userId} and status = 'active' order by redeemed_at`,
    sql`select * from entitlements where user_id = ${userId} limit 1`,
    sql`select * from users where id = ${userId} limit 1`,
  ]);
  const cur = curRows[0] || null;
  const user = uRows[0] || null;

  // An admin / org-default assignment is authoritative — we record the code in
  // user_access_codes but never overwrite the admin's entitlement.
  if (cur && ["admin", "org_default"].includes(cur.source || "")) return cur;

  // ── no codes: revert to the function auto-grant ──
  if (!codes.length) {
    const grant = entitlementForFunction(user && user.role);
    const fs = grant.scopeType === "function"
      ? await resolveFunctionScope(sql, user.role).catch(() => null)
      : null;
    const programIds = (fs && fs.programIds && fs.programIds.length) ? fs.programIds : grant.programIds;
    const categoryIds = (fs && fs.categories) || grant.categories || [];
    const fn = functionByKey(user && user.role);
    await upsertEntitlement(sql, userId, {
      source: "auto_function", scopeType: grant.scopeType, programIds, categoryIds,
      promptIds: (fs && fs.promptIds) || [], featureFlags: {}, licenseType: "standard",
      orgName: (user && user.org_name) || null, expiresAt: null,
      note: fn ? "Auto: " + fn.label : "Auto: full",
    });
    await reconcileEnrollments(sql, userId, programIds);
    entitlementEvent(sql, { userId, actor: "self", action: "modified", detail: { via: "recompute", codes: [] } });
    return (await sql`select * from entitlements where user_id = ${userId} limit 1`)[0];
  }

  // ── union across every active code ──
  let scopeType = "none", licenseType = "standard";
  const programIds = new Set(), categoryIds = new Set(), promptIds = new Set();
  const featureFlags = {};
  let expiresAt = null, anyOpenEnded = false;

  // A lone admin-curated COLLECTION code defines the library exactly (its own
  // §10 contract) — no function floor, it replaces the signup scope. Any other
  // shape (a course/track/full code, or several stacked codes) is additive and
  // keeps the signup-function library as a FLOOR so a new code only widens.
  const soloCollection = codes.length === 1 && codes[0].scope_type === "collection";
  if (!soloCollection) {
    const fnGrant = entitlementForFunction(user && user.role);
    if (fnGrant.scopeType === "full") {
      scopeType = "full";
    } else {
      (fnGrant.programIds || []).forEach((p) => programIds.add(p));
      const fs = await resolveFunctionScope(sql, user && user.role).catch(() => null);
      ((fs && fs.categories) || fnGrant.categories || []).forEach((c) => categoryIds.add(c));
      (fs && fs.programIds || []).forEach((p) => programIds.add(p));
      if (programIds.size || categoryIds.size) scopeType = "program";
    }
  }

  for (const c of codes) {
    if ((SCOPE_RANK[c.scope_type] ?? 0) > (SCOPE_RANK[scopeType] ?? 0)) scopeType = c.scope_type;
    (c.program_ids || []).forEach((p) => programIds.add(p));
    (c.category_ids || []).forEach((p) => categoryIds.add(p));
    (c.prompt_ids || []).forEach((p) => promptIds.add(p));
    for (const [k, v] of Object.entries(c.feature_flags || {})) featureFlags[k] = featureFlags[k] || !!v;
    if ((LICENSE_RANK[c.license_type] ?? 1) > (LICENSE_RANK[licenseType] ?? 1)) licenseType = c.license_type;
    if (c.expires_at) { const d = new Date(c.expires_at); if (!expiresAt || d < expiresAt) expiresAt = d; }
    else anyOpenEnded = true;
  }
  if (anyOpenEnded) expiresAt = null;
  // A multi-source union is a 'program' scope, not the function-only 'function'
  // scope (which getUserAccess treats as a single filtered category browse).
  if (scopeType === "function") scopeType = "program";
  if (scopeType === "full") { programIds.clear(); categoryIds.clear(); promptIds.clear(); }

  const last = codes[codes.length - 1];
  await upsertEntitlement(sql, userId, {
    source: "access_code", accessCode: last.code, scopeType,
    programIds: [...programIds], categoryIds: [...categoryIds], promptIds: [...promptIds],
    featureFlags, licenseType,
    orgName: last.org_name || (user && user.org_name) || null,
    expiresAt: expiresAt ? expiresAt.toISOString() : null,
    note: codes.length > 1 ? `${codes.length} access codes` : `Access code ${codes[0].code}`,
  });
  await reconcileEnrollments(sql, userId, [...programIds]);
  entitlementEvent(sql, { userId, actor: "self", action: "modified",
    detail: { via: "recompute", codes: codes.map((c) => c.code), scopeType } });
  return (await sql`select * from entitlements where user_id = ${userId} limit 1`)[0];
}
