// /api/admin/codes    (all require a valid admin token)
//   GET                       -> { codes: [...] }
//   POST   { ...code }        -> { code }        (create; id generated if absent)
//   PATCH  { id, ...fields }  -> { code }        (partial update, merge)
//   DELETE ?id=<id>           -> { ok }
import { db, json, readBody } from "../_db.js";
import { verify, bearer, sessionSecret } from "../_auth.js";

// accept camelCase (frontend) or snake_case
function normalize(rec) {
  const m = {
    code: rec.code, org_name: rec.orgName ?? rec.org_name, domain: rec.domain,
    industry: rec.industry, functions: rec.functions, roles: rec.roles,
    program_ids: rec.programIds ?? rec.program_ids,
    full_library: rec.fullLibrary ?? rec.full_library,
    super_admin: rec.superAdmin ?? rec.super_admin,
    enabled: rec.enabled, note: rec.note,
  };
  for (const k of Object.keys(m)) if (m[k] === undefined) delete m[k];
  return m;
}
function outRow(r) {
  return {
    id: r.id, code: r.code, orgName: r.org_name, domain: r.domain, industry: r.industry,
    functions: r.functions || [], roles: r.roles || [], programIds: r.program_ids || [],
    fullLibrary: !!r.full_library, superAdmin: !!r.super_admin, enabled: !!r.enabled,
    note: r.note || "", seeded: !!r.seeded, createdAt: r.created_at, updatedAt: r.updated_at,
  };
}
async function upsertRow(sql, row) {
  const r = await sql`
    insert into admin_codes (id, code, org_name, domain, industry, functions, roles, program_ids,
                             full_library, super_admin, enabled, note, seeded, updated_at)
    values (${row.id}, ${row.code}, ${row.org_name}, ${row.domain}, ${row.industry},
            ${JSON.stringify(row.functions || [])}, ${JSON.stringify(row.roles || [])},
            ${JSON.stringify(row.program_ids || [])}, ${!!row.full_library}, ${!!row.super_admin},
            ${row.enabled === undefined ? true : !!row.enabled}, ${row.note ?? null}, ${!!row.seeded}, now())
    on conflict (id) do update set
      code = excluded.code, org_name = excluded.org_name, domain = excluded.domain,
      industry = excluded.industry, functions = excluded.functions, roles = excluded.roles,
      program_ids = excluded.program_ids, full_library = excluded.full_library,
      super_admin = excluded.super_admin, enabled = excluded.enabled, note = excluded.note,
      updated_at = now()
    returning *`;
  return r[0];
}

export default async function handler(req, res) {
  let sql;
  try { sql = db(); } catch { return json(res, 503, { error: "no-backend" }); }
  const tok = verify(bearer(req), sessionSecret());
  if (!tok || tok.t !== "a") return json(res, 401, { error: "auth" });

  if (req.method === "GET") {
    const rows = await sql`select * from admin_codes order by seeded desc, created_at desc`;
    return json(res, 200, { codes: rows.map(outRow) });
  }

  if (req.method === "POST") {
    const body = await readBody(req);
    const m = normalize(body);
    if (!m.code) return json(res, 400, { error: "code-required" });
    const norm = String(m.code).toUpperCase().trim();
    const dup = await sql`select id from admin_codes where upper(code) = ${norm} limit 1`;
    if (dup.length && dup[0].id !== body.id) return json(res, 409, { error: "duplicate-code" });
    const row = {
      id: body.id || ("adm-" + Math.random().toString(36).slice(2, 10) + Date.now().toString(36)),
      code: m.code, org_name: m.org_name ?? null, domain: m.domain ?? null, industry: m.industry ?? null,
      functions: m.functions ?? [], roles: m.roles ?? [], program_ids: m.program_ids ?? [],
      full_library: m.full_library, super_admin: m.super_admin, enabled: m.enabled, note: m.note ?? null,
      seeded: false,
    };
    return json(res, 200, { code: outRow(await upsertRow(sql, row)) });
  }

  if (req.method === "PATCH") {
    const body = await readBody(req);
    if (!body.id) return json(res, 400, { error: "id-required" });
    const cur = await sql`select * from admin_codes where id = ${body.id} limit 1`;
    if (!cur.length) return json(res, 404, { error: "not-found" });
    const m = normalize(body);
    const merged = { ...cur[0], ...m };
    return json(res, 200, { code: outRow(await upsertRow(sql, merged)) });
  }

  if (req.method === "DELETE") {
    const id = req.query.id;
    if (!id) return json(res, 400, { error: "id-required" });
    await sql`delete from admin_codes where id = ${id}`;
    return json(res, 200, { ok: true });
  }

  return json(res, 405, { error: "method" });
}
