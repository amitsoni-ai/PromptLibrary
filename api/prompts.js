// GET /api/prompts — public delta feed for author-managed prompt changes.
//
// The app bakes the full library into index.html (#data-prompts). When a
// SUPER_ADMIN adds / edits / archives prompts via /api/admin/prompts the change
// lands in the `prompts` table; this endpoint returns just those rows so the
// running app can merge them at boot (src/part_app_5.js#loadData) without a
// rebuild. Nothing here is secret — the same prompts ship in the HTML.
//
//   -> { prompts: [ …full records… ], archivedIds: [ id… ], version, count }
//
// 503 when there is no database (static host) — the caller then simply keeps
// the baked-in set.
import { db, json, safeRows } from "./_db.js";

export default async function handler(req, res) {
  if (req.method !== "GET") return json(res, 405, { error: "method-not-allowed" });
  let sql;
  try { sql = db(); } catch { return json(res, 503, { error: "no-backend" }); }

  const rows = await safeRows(sql`
    select id, data, coalesce(lifecycle, data->>'lifecycle') as lifecycle, archived_at,
           extract(epoch from updated_at)::bigint as updated_epoch
    from prompts
    where origin = 'authored' or updated_by is not null
    order by updated_at desc nulls last
    limit 20000`);

  const prompts = [];
  const archivedIds = [];
  let version = 0;
  for (const r of rows) {
    if (r.updated_epoch && Number(r.updated_epoch) > version) version = Number(r.updated_epoch);
    if (r.lifecycle === "Archived" || r.archived_at) { archivedIds.push(r.id); continue; }
    if (r.data && typeof r.data === "object") prompts.push(r.data);
  }
  return json(res, 200, { prompts, archivedIds, version, count: prompts.length });
}
