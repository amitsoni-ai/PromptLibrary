// GET /api/admin/analytics?days=30   (admin session, "analytics.read")
// Learner-account metrics (spec §9 ANALYTICS) + the original activity aggregates.
import { db, json } from "../_db.js";
import { requireAdmin } from "../_session.js";
import { verify, bearer, sessionSecret } from "../_auth.js";

export default async function handler(req, res) {
  let sql;
  try { sql = db(); } catch { return json(res, 503, { error: "no-backend" }); }

  // new admin session OR legacy console token
  const gate = await requireAdmin(sql, req, "analytics.read").catch(() => ({ error: 401, code: "auth" }));
  if (gate.error) {
    const legacy = verify(bearer(req), sessionSecret());
    if (!legacy || legacy.t !== "a") return json(res, gate.error, { error: gate.code });
  }

  const days = Math.min(365, Math.max(1, parseInt(req.query.days || "30", 10) || 30));
  const since = new Date(Date.now() - days * 86400000).toISOString();

  // ---- account metrics ----
  let users = null;
  try {
    const [tot, byRole, byLevel, byStatus, ent, enr, newUsers, activ] = await Promise.all([
      sql`select
            count(*)::int as total,
            count(*) filter (where email_verified)::int as verified,
            count(*) filter (where not email_verified)::int as unverified,
            count(*) filter (where account_status = 'active')::int as active,
            count(*) filter (where account_status = 'suspended')::int as suspended,
            count(*) filter (where account_status = 'disabled')::int as disabled,
            count(*) filter (where last_login_at >= ${since})::int as active_period
          from users`,
      sql`select role, count(*)::int as n from users group by role order by n desc`,
      sql`select ai_level, count(*)::int as n from users group by ai_level order by n desc`,
      sql`select account_status, count(*)::int as n from users group by account_status order by n desc`,
      sql`select status, count(*)::int as n from entitlements group by status order by n desc`,
      sql`select program_id, count(*)::int as n from program_enrollments where status = 'active' group by program_id order by n desc limit 25`,
      sql`select to_char(date_trunc('day', created_at), 'YYYY-MM-DD') as day, count(*)::int as n
          from users where created_at >= ${since} group by 1 order by 1`,
      sql`select
            count(*) filter (where e.status = 'active' and e.scope_type <> 'none')::int as entitled,
            count(*)::int as total
          from users u left join entitlements e on e.user_id = u.id`,
    ]);
    const t = tot[0] || {};
    users = {
      total: t.total || 0, verified: t.verified || 0, unverified: t.unverified || 0,
      active: t.active || 0, suspended: t.suspended || 0, disabled: t.disabled || 0,
      activeInPeriod: t.active_period || 0,
      byRole, byAiLevel: byLevel, byStatus, entitlementStatus: ent, programEnrollment: enr,
      signupsDaily: newUsers,
      verificationRate: t.total ? +(t.verified / t.total).toFixed(3) : 0,
      activationRate: activ[0] && activ[0].total ? +(activ[0].entitled / activ[0].total).toFixed(3) : 0,
    };
  } catch (e) { users = { error: String(e && e.message || e) }; }

  // ---- activity aggregates (unchanged shape) ----
  let activity = null;
  try {
    const [totals, byEvent, byCode, topPrompts, signin, daily] = await Promise.all([
      sql`select count(*)::int as events, count(distinct subject)::int as learners, count(distinct code)::int as codes
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
    activity = { totals: totals[0] || { events: 0, learners: 0, codes: 0 }, signins: (signin[0] && signin[0].n) || 0, byEvent, byCode, topPrompts, daily };
  } catch (e) { activity = { error: String(e && e.message || e) }; }

  // Back-compat: the existing Analytics tab reads totals/byEvent/byCode/topPrompts/daily
  // at the top level. Keep those, add `users` + `activity` for the new console.
  return json(res, 200, { since, days, users, activity, ...(activity && !activity.error ? activity : {}) });
}
