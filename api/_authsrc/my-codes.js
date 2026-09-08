// GET /api/auth/my-codes  ->  { codes: [ { code, label, orgName, scopeType,
//   programNames, redeemedAt } ] }
// The access codes the signed-in learner currently holds (stackable). Powers the
// "Access codes" page in the sidebar.
import { db, json } from "../_db.js";
import { resolveUser } from "../_session.js";

export default async function handler(req, res) {
  if (req.method !== "GET") return json(res, 405, { error: "method-not-allowed" });
  let sql;
  try { sql = db(); } catch { return json(res, 503, { error: "no-backend" }); }

  const ctx = await resolveUser(sql, req).catch(() => null);
  if (!ctx) return json(res, 200, { codes: [] });

  const rows = await sql`select * from user_access_codes
    where user_id = ${ctx.user.id} and status = 'active' order by redeemed_at asc`;
  if (!rows.length) return json(res, 200, { codes: [] });

  // labels from access_codes; program names for the scope summary
  const codeKeys = rows.map((r) => String(r.code || "").toUpperCase());
  const allProgIds = Array.from(new Set(rows.flatMap((r) => r.program_ids || [])));
  const [acRows, progRows] = await Promise.all([
    sql`select code, label from access_codes where upper(code) = any(${codeKeys})`,
    allProgIds.length ? sql`select id, name from programs where id = any(${allProgIds})` : Promise.resolve([]),
  ]);
  const labelBy = Object.fromEntries(acRows.map((r) => [String(r.code).toUpperCase(), r.label]));
  const nameBy = Object.fromEntries(progRows.map((r) => [r.id, r.name]));

  const codes = rows.map((r) => ({
    code: r.code,
    label: labelBy[String(r.code).toUpperCase()] || r.org_name || null,
    orgName: r.org_name || null,
    scopeType: r.scope_type,
    programNames: (r.program_ids || []).map((id) => nameBy[id]).filter(Boolean),
    redeemedAt: r.redeemed_at,
    expiresAt: r.expires_at || null,
  }));
  return json(res, 200, { codes });
}
