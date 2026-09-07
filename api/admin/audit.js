// GET /api/admin/audit?type=admin|auth|entitlement&action=&actor=&target=&limit=&offset=
// (spec §9 AUDIT LOG) — admin session, "audit.read" capability.
import { db, json } from "../_db.js";
import { requireAdmin } from "../_session.js";

export default async function handler(req, res) {
  if (req.method !== "GET") return json(res, 405, { error: "method-not-allowed" });
  let sql;
  try { sql = db(); } catch { return json(res, 503, { error: "no-backend" }); }
  const gate = await requireAdmin(sql, req, "audit.read");
  if (gate.error) return json(res, gate.error, { error: gate.code });

  const limit = Math.min(200, Math.max(1, parseInt(req.query.limit || "50", 10) || 50));
  const offset = Math.max(0, parseInt(req.query.offset || "0", 10) || 0);
  const type = req.query.type || "admin";

  if (type === "auth") {
    const rows = await sql`select id, user_id, email_norm, event, ip, meta, ts
      from auth_events order by ts desc limit ${limit} offset ${offset}`;
    return json(res, 200, { type, rows });
  }
  if (type === "entitlement") {
    const rows = await sql`select id, user_id, actor, action, detail, ts
      from entitlement_events order by ts desc limit ${limit} offset ${offset}`;
    return json(res, 200, { type, rows });
  }

  const where = [], params = [];
  const add = (clause, val) => { params.push(val); where.push(clause.replace("?", "$" + params.length)); };
  if (req.query.action) add("action = ?", req.query.action);
  if (req.query.actor) add("actor_id = ?", req.query.actor);
  if (req.query.target) add("target_id = ?", req.query.target);
  const wsql = where.length ? "where " + where.join(" and ") : "";
  const rows = await sql(`select id, actor_type, actor_id, actor_label, action, target_type, target_id, detail, ip, ts
    from audit_logs ${wsql} order by ts desc limit ${limit} offset ${offset}`, params);
  const total = (await sql(`select count(*)::int as n from audit_logs ${wsql}`, params))[0].n;
  return json(res, 200, { type: "admin", rows, total, limit, offset });
}
