// /api/admin/collections  — per-organization curated libraries + their access
// codes (spec Piece 3). A collection is a named set of programs / categories /
// individual prompts bound to an org name. Generating a code snapshots the
// collection onto an `access_codes` row with `scope_type = 'collection'`; a
// learner who redeems it (via the existing /api/auth/redeem-code gate) gets an
// entitlement scoped to that snapshot — shown as a filtered category browse
// (frontend `mode:"collection"`, same as a function scope).
//
//   GET                                   -> { collections: [{ …, codes:[…] }] }
//   POST { action:"create", name, orgName, programIds?, categoryIds?, promptIds? }
//   POST { action:"update", id, …fields }               (rename / re-scope / enabled)
//   POST { action:"delete", id }                        (blocked if a code was redeemed)
//   POST { action:"generate_code", id, label?, maxRedemptions?, expiresAt?, note? }
//
// Access-code lifecycle after generation (rename / disable / seat limit / expiry)
// reuses PATCH /api/admin/entitlements. Writes need `access.write` + CSRF
// (skipped for a Bearer legacy-console token, matching _adminsrc/codes.js).
import { db, json, readBody, safeRows, isSchemaBehind } from "../_db.js";
import { checkCsrf } from "../_http.js";
import { requireAdmin } from "../_session.js";
import { newId } from "../_crypto.js";
import { auditLog } from "../_audit.js";
import { FUNCTION_KEYS } from "../_functions.js";
import { AI_LEVELS } from "../_validate.js";

const MAX = 4000;
const cleanList = (v, cap = MAX) =>
  Array.isArray(v)
    ? Array.from(new Set(v.map((x) => String(x || "").trim()).filter(Boolean))).slice(0, cap)
    : [];

// Collection join defaults — the function / AI level a short-signup learner
// inherits (see api/_authsrc/signup.js). `undefined` = leave unchanged on an
// update; `null` / "" = clear; anything off the allow-list is rejected.
function cleanEnum(v, allow) {
  if (v === undefined) return undefined;
  if (v === null || v === "") return null;
  const s = String(v).trim().toLowerCase();
  return allow.includes(s) ? s : { error: true };
}

function genCode(label) {
  const base = String(label || "ORG").toUpperCase().replace(/[^A-Z0-9]+/g, "").slice(0, 10) || "ORG";
  return `${base}-${Math.random().toString(36).slice(2, 7).toUpperCase()}`;
}
const colOut = (c, codes) => ({
  id: c.id, name: c.name, orgName: c.org_name,
  programIds: c.program_ids || [], categoryIds: c.category_ids || [], promptIds: c.prompt_ids || [],
  defaultFunction: c.default_function || null, defaultAiLevel: c.default_ai_level || null,
  enabled: c.enabled !== false, createdAt: c.created_at, updatedAt: c.updated_at,
  codes: (codes || []).map((k) => ({
    id: k.id, code: k.code, label: k.label, enabled: k.enabled !== false,
    maxRedemptions: k.max_redemptions, redemptions: k.redemptions, expiresAt: k.expires_at,
    createdAt: k.created_at,
  })),
});

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
    // safeRows swallows ONLY a missing relation (42P01) — a real error must not
    // be masked as an empty list (that made a failed create look like it didn't
    // persist; see ADMIN-PROMPTS-REPORT.md "Bug 2a").
    const [cols, codes] = await Promise.all([
      safeRows(sql`select * from collections order by created_at desc limit 500`),
      safeRows(sql`select * from access_codes where collection_id is not null order by created_at desc limit 2000`),
    ]);
    const byCol = {};
    for (const k of codes) (byCol[k.collection_id] = byCol[k.collection_id] || []).push(k);
    return json(res, 200, { collections: cols.map((c) => colOut(c, byCol[c.id])) });
  }

  // ---------- POST ----------
  const b = await readBody(req);
  const action = b.action || "create";
  try {
    return await handlePost(sql, res, b, action, actor, admin);
  } catch (e) {
    // A missing column/table means the deployed DB is behind the code's
    // migrations (schema_v3 adds collections.default_function etc.). Surface it
    // instead of a bare 500 so the console can tell the operator what to do.
    if (isSchemaBehind(e)) return json(res, 503, { error: "schema-out-of-date", detail: "run: npm run migrate:v3" });
    throw e;
  }
}

async function handlePost(sql, res, b, action, actor, admin) {
  if (action === "create") {
    const name = String(b.name || "").trim();
    if (!name) return json(res, 422, { error: "name-required" });
    const dfn = cleanEnum(b.defaultFunction, FUNCTION_KEYS);
    const dlv = cleanEnum(b.defaultAiLevel, AI_LEVELS);
    if (dfn && dfn.error) return json(res, 422, { error: "invalid-default-function" });
    if (dlv && dlv.error) return json(res, 422, { error: "invalid-default-ai-level" });
    const id = newId("col");
    const row = (await sql`
      insert into collections (id, org_name, name, program_ids, category_ids, prompt_ids,
        default_function, default_ai_level, enabled, created_by)
      values (${id}, ${b.orgName || null}, ${name},
        ${JSON.stringify(cleanList(b.programIds))}, ${JSON.stringify(cleanList(b.categoryIds))},
        ${JSON.stringify(cleanList(b.promptIds))}, ${dfn || null}, ${dlv || null},
        ${b.enabled !== false}, ${admin.id})
      returning *`)[0];
    auditLog(sql, { ...actor, action: "collection.create", targetType: "collection", targetId: id, detail: { name, orgName: b.orgName || null } });
    return json(res, 200, { collection: colOut(row, []) });
  }

  if (action === "update") {
    if (!b.id) return json(res, 400, { error: "id-required" });
    const cur = (await sql`select * from collections where id = ${b.id} limit 1`)[0];
    if (!cur) return json(res, 404, { error: "not-found" });
    const dfn = cleanEnum(b.defaultFunction, FUNCTION_KEYS);
    const dlv = cleanEnum(b.defaultAiLevel, AI_LEVELS);
    if (dfn && dfn.error) return json(res, 422, { error: "invalid-default-function" });
    if (dlv && dlv.error) return json(res, 422, { error: "invalid-default-ai-level" });
    const m = {
      name: b.name != null ? String(b.name).trim() || cur.name : cur.name,
      org_name: b.orgName !== undefined ? (b.orgName || null) : cur.org_name,
      program_ids: b.programIds !== undefined ? cleanList(b.programIds) : cur.program_ids,
      category_ids: b.categoryIds !== undefined ? cleanList(b.categoryIds) : cur.category_ids,
      prompt_ids: b.promptIds !== undefined ? cleanList(b.promptIds) : cur.prompt_ids,
      default_function: dfn === undefined ? cur.default_function : dfn,
      default_ai_level: dlv === undefined ? cur.default_ai_level : dlv,
      enabled: b.enabled !== undefined ? !!b.enabled : cur.enabled,
    };
    const enabledChanged = (cur.enabled !== false) !== (m.enabled !== false);
    const row = (await sql`
      update collections set name=${m.name}, org_name=${m.org_name},
        program_ids=${JSON.stringify(m.program_ids || [])}, category_ids=${JSON.stringify(m.category_ids || [])},
        prompt_ids=${JSON.stringify(m.prompt_ids || [])},
        default_function=${m.default_function || null}, default_ai_level=${m.default_ai_level || null},
        enabled=${m.enabled}, updated_at=now()
      where id=${b.id} returning *`)[0];
    // The collection is the source of truth: sync ALL its codes' scope snapshot
    // (per-code label / seat limit / expiry are left untouched). Only when the
    // collection's Active flag actually CHANGES do we cascade it to every child
    // code — deactivating blocks redemption (Bug 2c), reactivating restores it —
    // so a plain scope edit still preserves an individually-disabled code.
    // Existing learners are re-resolved live against the collection in
    // api/_access.js.
    await sql`update access_codes set program_ids=${JSON.stringify(m.program_ids || [])},
        category_ids=${JSON.stringify(m.category_ids || [])}, prompt_ids=${JSON.stringify(m.prompt_ids || [])},
        org_name=${m.org_name}, default_function=${m.default_function || null},
        default_ai_level=${m.default_ai_level || null},
        enabled = case when ${enabledChanged} then ${!!m.enabled} else enabled end, updated_at=now()
      where collection_id=${b.id}`;
    const codes = await sql`select * from access_codes where collection_id = ${b.id} order by created_at desc`;
    auditLog(sql, { ...actor, action: "collection.update", targetType: "collection", targetId: b.id });
    return json(res, 200, { collection: colOut(row, codes) });
  }

  if (action === "delete") {
    if (!b.id) return json(res, 400, { error: "id-required" });
    const redeemed = (await sql`select coalesce(sum(redemptions),0)::int as n from access_codes where collection_id = ${b.id}`)[0].n;
    if (redeemed > 0) return json(res, 422, { error: "has-redemptions", redemptions: redeemed });
    await sql`delete from access_codes where collection_id = ${b.id}`;
    await sql`delete from collections where id = ${b.id}`;
    auditLog(sql, { ...actor, action: "collection.delete", targetType: "collection", targetId: b.id });
    return json(res, 200, { ok: true });
  }

  if (action === "generate_code") {
    if (!b.id) return json(res, 400, { error: "id-required" });
    const col = (await sql`select * from collections where id = ${b.id} limit 1`)[0];
    if (!col) return json(res, 404, { error: "not-found" });
    let code = String(b.code || "").toUpperCase().trim() || genCode(col.org_name || col.name);
    for (let i = 0; i < 5; i++) {
      const dup = await sql`select 1 from access_codes where upper(code) = ${code} limit 1`;
      if (!dup.length) break;
      code = genCode(col.org_name || col.name);
    }
    const id = newId("acc");
    const row = (await sql`
      insert into access_codes (id, code, label, org_name, scope_type, program_ids, category_ids, prompt_ids,
        collection_id, default_function, default_ai_level, license_type, max_redemptions, expires_at, enabled, note, created_by)
      values (${id}, ${code}, ${b.label || col.name}, ${col.org_name}, 'collection',
        ${JSON.stringify(col.program_ids || [])}, ${JSON.stringify(col.category_ids || [])},
        ${JSON.stringify(col.prompt_ids || [])}, ${col.id}, ${col.default_function || null}, ${col.default_ai_level || null},
        ${b.licenseType || "standard"},
        ${b.maxRedemptions ?? null}, ${b.expiresAt || null}, ${b.enabled !== false}, ${b.note || null}, ${admin.id})
      returning *`)[0];
    auditLog(sql, { ...actor, action: "collection.code_generate", targetType: "access_code", targetId: id,
      detail: { code, collectionId: col.id } });
    return json(res, 200, { code: {
      id: row.id, code: row.code, label: row.label, enabled: row.enabled !== false,
      maxRedemptions: row.max_redemptions, redemptions: row.redemptions, expiresAt: row.expires_at, createdAt: row.created_at,
    } });
  }

  return json(res, 400, { error: "unknown-action" });
}
