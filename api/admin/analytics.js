// GET /api/admin/analytics?days=30   (admin token)  -> aggregate activity
import { db, json } from "../_db.js";
import { verify, bearer, sessionSecret } from "../_auth.js";

export default async function handler(req, res) {
  let sql;
  try { sql = db(); } catch { return json(res, 503, { error: "no-backend" }); }
  const tok = verify(bearer(req), sessionSecret());
  if (!tok || tok.t !== "a") return json(res, 401, { error: "auth" });

  const days = Math.min(365, Math.max(1, parseInt(req.query.days || "30", 10) || 30));
  const since = new Date(Date.now() - days * 86400000).toISOString();

  const [totals, byEvent, byCode, topPrompts, learners, daily] = await Promise.all([
    sql`select count(*)::int as events,
               count(distinct subject)::int as learners,
               count(distinct code)::int as codes
        from activity where ts >= ${since}`,
    sql`select event, count(*)::int as n from activity where ts >= ${since} group by event order by n desc`,
    sql`select code, count(*)::int as n, count(distinct subject)::int as learners
        from activity where ts >= ${since} and code is not null group by code order by n desc limit 25`,
    sql`select a.prompt_id, count(*)::int as n, coalesce(p.title, a.prompt_id) as title, p.category
        from activity a left join prompts p on p.id = a.prompt_id
        where a.ts >= ${since} and a.prompt_id is not null
        group by a.prompt_id, p.title, p.category order by n desc limit 20`,
    sql`select count(distinct subject)::int as n from activity where ts >= ${since} and event = 'signin'`,
    sql`select to_char(date_trunc('day', ts), 'YYYY-MM-DD') as day, count(*)::int as n
        from activity where ts >= ${since} group by 1 order by 1`,
  ]);

  return json(res, 200, {
    since, days,
    totals: totals[0] || { events: 0, learners: 0, codes: 0 },
    signins: (learners[0] && learners[0].n) || 0,
    byEvent, byCode, topPrompts, daily,
  });
}
