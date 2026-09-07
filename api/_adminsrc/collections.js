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
import { db, json, readBody } from "../_db.js";
import { checkCsrf } from "../_http.js";
import { requireAdmin } from "../_session.js";
import { newId } from "../_crypto.js";
import { auditLog } from "../_audit.js";

const MAX = 4000;
const cleanList = (v, cap = MAX) =>
  Array.isArray(v)
    ? Array.from(new Set(v.map((x) => String(x || "").trim()).filter(Boolean))).slice(0, cap)
    : [];

function genCode(label) {
  const base = String(label || "ORG").toUpperCase().replace(/[^A-Z0-9]+/g, "").slice(0, 10) || "ORG";
  return `${base}-${Math.random().toString(36).slice(2, 7).toUpperCase()}`;
}
const colOut = (c, codes) => ({
  id: c.id, name: c.name, orgName: c.org_name,
  programIds: c.program_ids || [], categoryIds: c.category_ids || [], promptIds: c.prompt_ids || [],
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
    let cols = [], codes = [];
    try {
      [cols, codes] = await Promise.all([
        sql`select * from collections order by created_at desc limit 500`,
        sql`select * from access_codes where collection_id is not null order by created_at desc limit 2000`,
      ]);
    } catch { /* tables missing -> empty */ }
    const byCol = {};
    for (const k of codes) (byCol[k.collection_id] = byCol[k.collection_id] || []).push(k);
    return json(res, 200, { collections: cols.map((c) => colOut(c, byCol[c.id])) });
  }

  // ---------- POST ----------
  const b = await readBody(req);
  const action = b.action || "create";

  if (action === "create") {
    const name = String(b.name || "").trim();
    if (!name) return json(res, 422, { error: "name-required" });
    const id = newId("col");
    const row = (await sql`
      insert into collections (id, org_name, name, program_ids, category_ids, prompt_ids, enabled, created_by)
      values (${id}, ${b.orgName || null}, ${name},
        ${JSON.stringify(cleanList(b.programIds))}, ${JSON.stringify(cleanList(b.categoryIds))},
        ${JSON.stringify(cleanList(b.promptIds))}, ${b.enabled !== false}, ${admin.id})
      returning *`)[0];
    auditLog(sql, { ...actor, action: "collection.create", targetType: "collection", targetId: id, detail: { name, orgName: b.orgName || null } });
    return json(res, 200, { collection: colOut(row, []) });
  }

  if (action === "update") {
    if (!b.id) return json(res, 400, { error: "id-required" });
    const cur = (await sql`select * from collections where id = ${b.id} limit 1`)[0];
    if (!cur) return json(res, 404, { error: "not-found" });
    const m = {
      name: b.name != null ? String(b.name).trim() || cur.name : cur.name,
      org_name: b.orgName !== undefined ? (b.orgName || null) : cur.org_name,
      program_ids: b.programIds !== undefined ? cleanList(b.programIds) : cur.program_ids,
      category_ids: b.categoryIds !== undefined ? cleanList(b.categoryIds) : cur.category_ids,
      prompt_ids: b.promptIds !== undefined ? cleanList(b.promptIds) : cur.prompt_ids,
      enabled: b.enabled !== undefined ? !!b.enabled : cur.enabled,
    };
    const row = (await sql`
      update collections set name=${m.name}, org_name=${m.org_name},
        program_ids=${JSON.stringify(m.program_ids || [])}, category_ids=${JSON.stringify(m.category_ids || [])},
        prompt_ids=${JSON.stringify(m.prompt_ids || [])}, enabled=${m.enabled}, updated_at=now()
      where id=${b.id} returning *`)[0];
    // the collection is the source of truth: sync ALL its codes' scope snapshot
    // (per-code label / seat limit / expiry / enabled are left untouched).
    // Entitlements already granted keep their own snapshot from redeem time.
    await sql`update access_codes set program_ids=${JSON.stringify(m.program_ids || [])},
        category_ids=${JSON.stringify(m.category_ids || [])}, prompt_ids=${JSON.stringify(m.prompt_ids || [])},
        org_name=${m.org_name}, updated_at=now()
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
        collection_id, license_type, max_redemptions, expires_at, enabled, note, created_by)
      values (${id}, ${code}, ${b.label || col.name}, ${col.org_name}, 'collection',
        ${JSON.stringify(col.program_ids || [])}, ${JSON.stringify(col.category_ids || [])},
        ${JSON.stringify(col.prompt_ids || [])}, ${col.id}, ${b.licenseType || "standard"},
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
