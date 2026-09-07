// /api/admin/entitlements  (spec §9 ACCESS MANAGEMENT) — admin session required.
//   GET  ?userId=usr_x            -> { entitlement, history, enrollments }
//   GET  ?codes=1                 -> { codes: [...] }
//   POST { action, ... }          -> generate_code | assign | revoke | suspend |
//                                    reactivate | expire | enroll | unenroll
//   PATCH { codeId, ...fields }   -> update an access code
//   DELETE ?codeId=acc_x         -> delete an (unredeemed) access code
import { db, json, readBody } from "../_db.js";
import { checkCsrf } from "../_http.js";
import { requireAdmin } from "../_session.js";
import { newId } from "../_crypto.js";
import { SCOPE_TYPES, ENTITLEMENT_STATUSES } from "../_validate.js";
import { auditLog, entitlementEvent } from "../_audit.js";
import { sendEmail, appBaseUrl } from "../_email.js";

function genCode(label) {
  const base = String(label || "SYN").toUpperCase().replace(/[^A-Z0-9]+/g, "").slice(0, 10) || "SYN";
  const rand = Math.random().toString(36).slice(2, 7).toUpperCase();
  return `${base}-${rand}`;
}
const codeOut = (c) => ({
  id: c.id, code: c.code, label: c.label, orgName: c.org_name, scopeType: c.scope_type,
  programIds: c.program_ids || [], featureFlags: c.feature_flags || {}, licenseType: c.license_type,
  maxRedemptions: c.max_redemptions, redemptions: c.redemptions, expiresAt: c.expires_at,
  enabled: c.enabled, note: c.note, createdAt: c.created_at,
});

export default async function handler(req, res) {
  let sql;
  try { sql = db(); } catch { return json(res, 503, { error: "no-backend" }); }
  const write = req.method !== "GET";
  const gate = await requireAdmin(sql, req, write ? "access.write" : "access.read");
  if (gate.error) return json(res, gate.error, { error: gate.code });
  const admin = gate.admin;
  if (write && !checkCsrf(req)) return json(res, 403, { error: "bad-csrf" });
  const actor = { actorType: "admin", actorId: admin.id, actorLabel: admin.email, req };

  if (req.method === "GET") {
    if (req.query.codes) {
      const rows = await sql`select * from access_codes order by created_at desc limit 500`;
      return json(res, 200, { codes: rows.map(codeOut) });
    }
    const userId = req.query.userId;
    if (!userId) return json(res, 400, { error: "userId-or-codes-required" });
    const [ent, history, enr] = await Promise.all([
      sql`select * from entitlements where user_id = ${userId} limit 1`,
      sql`select action, actor, detail, ts from entitlement_events where user_id = ${userId} order by ts desc limit 50`,
      sql`select * from program_enrollments where user_id = ${userId}`,
    ]);
    return json(res, 200, { entitlement: ent[0] || null, history, enrollments: enr });
  }

  if (req.method === "POST") {
    const b = await readBody(req);
    const action = b.action;

    if (action === "generate_code") {
      const scopeType = SCOPE_TYPES.includes(b.scopeType) ? b.scopeType : "program";
      const id = newId("acc");
      let code = String(b.code || "").toUpperCase().trim() || genCode(b.label || b.orgName);
      for (let i = 0; i < 5; i++) {
        const dup = await sql`select 1 from access_codes where upper(code) = ${code} limit 1`;
        if (!dup.length) break;
        code = genCode(b.label || b.orgName);
      }
      const row = (await sql`
        insert into access_codes (id, code, label, org_name, scope_type, program_ids, feature_flags,
          license_type, max_redemptions, expires_at, enabled, note, created_by)
        values (${id}, ${code}, ${b.label || null}, ${b.orgName || null}, ${scopeType},
          ${JSON.stringify(b.programIds || [])}, ${JSON.stringify(b.featureFlags || {})},
          ${b.licenseType || "standard"}, ${b.maxRedemptions ?? null}, ${b.expiresAt || null},
          ${b.enabled !== false}, ${b.note || null}, ${admin.id})
        returning *`)[0];
      auditLog(sql, { ...actor, action: "access.code_generate", targetType: "access_code", targetId: id, detail: { code } });
      return json(res, 200, { code: codeOut(row) });
    }

    if (action === "assign") {
      const userId = b.userId;
      if (!userId) return json(res, 400, { error: "userId-required" });
      const u = (await sql`select id, email, org_name from users where id = ${userId} limit 1`)[0];
      if (!u) return json(res, 404, { error: "user-not-found" });
      const scopeType = SCOPE_TYPES.includes(b.scopeType) ? b.scopeType : "program";
      const status = ENTITLEMENT_STATUSES.includes(b.status) ? b.status : "active";
      await sql`
        insert into entitlements (id, user_id, source, access_code, scope_type, program_ids, feature_flags,
          license_type, org_name, status, granted_by, expires_at, note)
        values (${newId("ent")}, ${userId}, 'admin', ${b.accessCode || null}, ${scopeType},
          ${JSON.stringify(b.programIds || [])}, ${JSON.stringify(b.featureFlags || {})},
          ${b.licenseType || "standard"}, ${b.orgName || u.org_name}, ${status}, ${admin.id},
          ${b.expiresAt || null}, ${b.note || null})
        on conflict (user_id) do update set
          source = 'admin', access_code = excluded.access_code, scope_type = excluded.scope_type,
          program_ids = excluded.program_ids, feature_flags = excluded.feature_flags,
          license_type = excluded.license_type, org_name = excluded.org_name, status = excluded.status,
          granted_by = excluded.granted_by, expires_at = excluded.expires_at, note = excluded.note,
          updated_at = now()`;
      for (const pid of (b.programIds || [])) {
        await sql`insert into program_enrollments (id, user_id, program_id, status, enrolled_by)
                  values (${newId("enr")}, ${userId}, ${pid}, 'active', ${admin.id})
                  on conflict (user_id, program_id) do update set status = 'active'`;
      }
      entitlementEvent(sql, { userId, actor: admin.id, action: "granted", detail: { scopeType, programIds: b.programIds, status } });
      auditLog(sql, { ...actor, action: "access.assign", targetType: "user", targetId: userId, detail: { scopeType, status } });
      if (status === "active") sendEmail("access_granted", u.email, { loginUrl: `${appBaseUrl(req)}/`, grantSummary: `Access updated (${scopeType})` });
      const ent = (await sql`select * from entitlements where user_id = ${userId} limit 1`)[0];
      return json(res, 200, { ok: true, entitlement: ent });
    }

    if (["revoke", "suspend", "reactivate", "expire"].includes(action)) {
      const userId = b.userId;
      if (!userId) return json(res, 400, { error: "userId-required" });
      const next = action === "revoke" ? "revoked" : action === "suspend" ? "suspended"
        : action === "expire" ? "expired" : "active";
      await sql`update entitlements set status = ${next}, updated_at = now() where user_id = ${userId}`;
      entitlementEvent(sql, { userId, actor: admin.id, action: action === "reactivate" ? "reactivated" : action === "revoke" ? "revoked" : action === "suspend" ? "suspended" : "expired", detail: {} });
      auditLog(sql, { ...actor, action: "access." + action, targetType: "user", targetId: userId });
      return json(res, 200, { ok: true, status: next });
    }

    if (action === "enroll" || action === "unenroll") {
      const { userId, programId } = b;
      if (!userId || !programId) return json(res, 400, { error: "userId-and-programId-required" });
      if (action === "enroll") {
        await sql`insert into program_enrollments (id, user_id, program_id, status, enrolled_by)
                  values (${newId("enr")}, ${userId}, ${programId}, 'active', ${admin.id})
                  on conflict (user_id, program_id) do update set status = 'active'`;
      } else {
        await sql`update program_enrollments set status = 'removed' where user_id = ${userId} and program_id = ${programId}`;
      }
      entitlementEvent(sql, { userId, actor: admin.id, action: action === "enroll" ? "enrolled" : "unenrolled", detail: { programId } });
      auditLog(sql, { ...actor, action: "program." + action, targetType: "user", targetId: userId, detail: { programId } });
      return json(res, 200, { ok: true });
    }

    return json(res, 400, { error: "unknown-action" });
  }

  if (req.method === "PATCH") {
    const b = await readBody(req);
    if (!b.codeId) return json(res, 400, { error: "codeId-required" });
    const cur = (await sql`select * from access_codes where id = ${b.codeId} limit 1`)[0];
    if (!cur) return json(res, 404, { error: "not-found" });
    const m = {
      label: b.label ?? cur.label, org_name: b.orgName ?? cur.org_name,
      scope_type: SCOPE_TYPES.includes(b.scopeType) ? b.scopeType : cur.scope_type,
      program_ids: b.programIds ?? cur.program_ids, feature_flags: b.featureFlags ?? cur.feature_flags,
      license_type: b.licenseType ?? cur.license_type, max_redemptions: b.maxRedemptions ?? cur.max_redemptions,
      expires_at: b.expiresAt ?? cur.expires_at, enabled: b.enabled ?? cur.enabled, note: b.note ?? cur.note,
    };
    const row = (await sql`
      update access_codes set label=${m.label}, org_name=${m.org_name}, scope_type=${m.scope_type},
        program_ids=${JSON.stringify(m.program_ids || [])}, feature_flags=${JSON.stringify(m.feature_flags || {})},
        license_type=${m.license_type}, max_redemptions=${m.max_redemptions}, expires_at=${m.expires_at},
        enabled=${m.enabled}, note=${m.note}, updated_at=now()
      where id=${b.codeId} returning *`)[0];
    auditLog(sql, { ...actor, action: "access.code_update", targetType: "access_code", targetId: b.codeId });
    return json(res, 200, { code: codeOut(row) });
  }

  if (req.method === "DELETE") {
    const codeId = req.query.codeId;
    if (!codeId) return json(res, 400, { error: "codeId-required" });
    await sql`delete from access_codes where id = ${codeId} and redemptions = 0`;
    auditLog(sql, { ...actor, action: "access.code_delete", targetType: "access_code", targetId: codeId });
    return json(res, 200, { ok: true });
  }

  return json(res, 405, { error: "method-not-allowed" });
}
