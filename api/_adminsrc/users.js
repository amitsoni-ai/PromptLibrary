// /api/admin/users  (spec §9 USER MANAGEMENT)  — requires an admin session.
//   GET   ?id=usr_x                         -> full profile + entitlement + activity
//   GET   ?q=&status=&role=&aiLevel=&org=&verified=&limit=&offset=  -> paged list
//   PATCH { id, action, ... }               -> update_profile | set_status | suspend |
//         reactivate | disable | resend_verification | force_verify | send_reset | revoke_sessions
//   DELETE ?id=usr_x[&hard=1]               -> disable (soft) or hard-delete (SUPER_ADMIN)
import { db, json, readBody } from "../_db.js";
import { checkCsrf } from "../_http.js";
import { requireAdmin } from "../_session.js";
import { getUserAccess } from "../_access.js";
import { str, ROLES, AI_LEVELS, ACCOUNT_STATUSES } from "../_validate.js";
import { randomToken, sha256, newId } from "../_crypto.js";
import { sendEmail, appBaseUrl } from "../_email.js";
import { auditLog, authEvent, entitlementEvent } from "../_audit.js";

function pub(u) {
  return {
    id: u.id, email: u.email, firstName: u.first_name, lastName: u.last_name,
    role: u.role, aiLevel: u.ai_level, organization: u.org_name, jobFunction: u.job_function || "",
    accountStatus: u.account_status, emailVerified: !!u.email_verified,
    createdAt: u.created_at, lastLoginAt: u.last_login_at, failedLogins: u.failed_logins,
    lockedUntil: u.locked_until,
  };
}

export default async function handler(req, res) {
  let sql;
  try { sql = db(); } catch { return json(res, 503, { error: "no-backend" }); }

  const write = req.method !== "GET";
  const gate = await requireAdmin(sql, req, write ? "users.write" : "users.read");
  if (gate.error) return json(res, gate.error, { error: gate.code });
  const admin = gate.admin;
  if (write && !checkCsrf(req)) return json(res, 403, { error: "bad-csrf" });

  // ---------- GET ----------
  if (req.method === "GET") {
    const id = req.query.id;
    if (id) {
      const u = (await sql`select * from users where id = ${id} limit 1`)[0];
      if (!u) return json(res, 404, { error: "not-found" });
      const [ent, enr, events, sessions] = await Promise.all([
        sql`select * from entitlements where user_id = ${id} limit 1`,
        sql`select * from program_enrollments where user_id = ${id}`,
        sql`select event, ip, ts, meta from auth_events where user_id = ${id} order by ts desc limit 20`,
        sql`select id, created_at, last_seen_at, expires_at, revoked_at, ip, user_agent from user_sessions where user_id = ${id} order by created_at desc limit 10`,
      ]);
      const access = await getUserAccess(sql, u);
      return json(res, 200, {
        user: pub(u), entitlement: ent[0] || null, enrollments: enr,
        recentEvents: events, sessions, access,
      });
    }

    const q = String(req.query.q || "").trim().toLowerCase();
    const status = ACCOUNT_STATUSES.includes(req.query.status) ? req.query.status : null;
    const role = ROLES.includes(req.query.role) ? req.query.role : null;
    const aiLevel = AI_LEVELS.includes(req.query.aiLevel) ? req.query.aiLevel : null;
    const org = String(req.query.org || "").trim().toLowerCase() || null;
    const verified = req.query.verified === "true" ? true : req.query.verified === "false" ? false : null;
    const limit = Math.min(100, Math.max(1, parseInt(req.query.limit || "25", 10) || 25));
    const offset = Math.max(0, parseInt(req.query.offset || "0", 10) || 0);

    const where = [], params = [];
    const add = (clause, val) => { params.push(val); where.push(clause.replace("?", "$" + params.length)); };
    if (q) { params.push(`%${q}%`); where.push(`(lower(email) like $${params.length} or lower(first_name||' '||last_name) like $${params.length})`); }
    if (status) add("account_status = ?", status);
    if (role) add("role = ?", role);
    if (aiLevel) add("ai_level = ?", aiLevel);
    if (org) add("lower(org_name) like ?", `%${org}%`);
    if (verified !== null) add("email_verified = ?", verified);
    const wsql = where.length ? "where " + where.join(" and ") : "";
    const rows = await sql(
      `select * from users ${wsql} order by created_at desc limit ${limit} offset ${offset}`, params);
    const total = (await sql(`select count(*)::int as n from users ${wsql}`, params))[0].n;
    return json(res, 200, { users: rows.map(pub), total, limit, offset });
  }

  // ---------- PATCH ----------
  if (req.method === "PATCH") {
    const body = await readBody(req);
    const id = body.id;
    if (!id) return json(res, 400, { error: "id-required" });
    const u = (await sql`select * from users where id = ${id} limit 1`)[0];
    if (!u) return json(res, 404, { error: "not-found" });
    const action = body.action || "update_profile";
    const actor = { actorType: "admin", actorId: admin.id, actorLabel: admin.email, req };

    if (action === "update_profile") {
      const map = { firstName: "first_name", lastName: "last_name", role: "role", aiLevel: "ai_level", organization: "org_name", jobFunction: "job_function" };
      const checks = {
        firstName: () => str(body.firstName, { field: "firstName", min: 1, max: 80 }),
        lastName: () => str(body.lastName, { field: "lastName", min: 1, max: 80 }),
        role: () => str(body.role, { field: "role", lower: true, allow: ROLES }),
        aiLevel: () => str(body.aiLevel, { field: "aiLevel", lower: true, allow: AI_LEVELS }),
        organization: () => str(body.organization, { field: "organization", min: 1, max: 120 }),
        jobFunction: () => str(body.jobFunction, { field: "jobFunction", max: 120, fallback: "" }),
      };
      const sets = [], vals = [];
      for (const k of Object.keys(map)) {
        if (body[k] === undefined) continue;
        const r = checks[k]();
        if (r.error) return json(res, 422, { error: r.error, field: r.field });
        sets.push(`${map[k]} = $${sets.length + 1}`); vals.push(r.value);
      }
      if (!sets.length) return json(res, 400, { error: "no-fields" });
      await sql(`update users set ${sets.join(", ")}, updated_at = now() where id = $${sets.length + 1}`, [...vals, id]);
      auditLog(sql, { ...actor, action: "user.profile_update", targetType: "user", targetId: id, detail: { fields: sets } });
    } else if (action === "suspend" || action === "reactivate" || action === "disable" || action === "set_status") {
      let next = action === "suspend" ? "suspended"
        : action === "disable" ? "disabled"
        : action === "reactivate" ? "active"
        : (ACCOUNT_STATUSES.includes(body.status) ? body.status : null);
      if (!next) return json(res, 422, { error: "bad-status" });
      if (next === "active" && !u.email_verified) next = "pending_verification";
      await sql`update users set account_status = ${next}, updated_at = now() where id = ${id}`;
      auditLog(sql, { ...actor, action: "user." + action, targetType: "user", targetId: id, detail: { from: u.account_status, to: next, reason: body.reason || null } });
      authEvent(sql, { userId: id, email: u.email, event: next === "suspended" ? "lockout" : "login_ok", req, meta: { adminAction: action } });
      if (next === "suspended") sendEmail("account_suspended", u.email, { email: u.email, reason: body.reason || "" });
    } else if (action === "resend_verification") {
      const token = randomToken(32);
      await sql`update email_verification_tokens set used_at = now() where user_id = ${id} and used_at is null`;
      await sql`insert into email_verification_tokens (id, user_id, token_hash, expires_at)
                values (${newId("evt")}, ${id}, ${sha256(token)}, now() + interval '24 hours')`;
      await sendEmail("verify_email", u.email, { email: u.email, verifyUrl: `${appBaseUrl(req)}/verify-email?token=${token}`, expiresHours: 24 });
      auditLog(sql, { ...actor, action: "user.resend_verification", targetType: "user", targetId: id });
    } else if (action === "force_verify") {
      await sql`update users set email_verified = true,
                account_status = case when account_status = 'pending_verification' then 'active' else account_status end,
                updated_at = now() where id = ${id}`;
      auditLog(sql, { ...actor, action: "user.force_verify", targetType: "user", targetId: id });
    } else if (action === "send_reset") {
      const token = randomToken(32);
      await sql`update password_reset_tokens set used_at = now() where user_id = ${id} and used_at is null`;
      await sql`insert into password_reset_tokens (id, user_id, token_hash, expires_at)
                values (${newId("prt")}, ${id}, ${sha256(token)}, now() + interval '30 minutes')`;
      await sendEmail("password_reset", u.email, { email: u.email, resetUrl: `${appBaseUrl(req)}/reset-password?token=${token}`, expiresMinutes: 30 });
      auditLog(sql, { ...actor, action: "user.send_reset", targetType: "user", targetId: id });
    } else if (action === "revoke_sessions") {
      await sql`update user_sessions set revoked_at = now() where user_id = ${id} and revoked_at is null`;
      auditLog(sql, { ...actor, action: "user.revoke_sessions", targetType: "user", targetId: id });
    } else {
      return json(res, 400, { error: "unknown-action" });
    }

    const fresh = (await sql`select * from users where id = ${id} limit 1`)[0];
    return json(res, 200, { ok: true, user: pub(fresh) });
  }

  // ---------- DELETE ----------
  if (req.method === "DELETE") {
    const id = req.query.id;
    if (!id) return json(res, 400, { error: "id-required" });
    const u = (await sql`select * from users where id = ${id} limit 1`)[0];
    if (!u) return json(res, 404, { error: "not-found" });
    const hard = req.query.hard === "1" || req.query.hard === "true";
    if (hard) {
      if (admin.admin_role !== "SUPER_ADMIN") return json(res, 403, { error: "forbidden" });
      await sql`delete from users where id = ${id}`;   // cascades sessions/tokens/entitlements
      auditLog(sql, { actorType: "admin", actorId: admin.id, actorLabel: admin.email, action: "user.hard_delete", targetType: "user", targetId: id, detail: { email: u.email }, req });
      return json(res, 200, { ok: true, deleted: "hard" });
    }
    await sql`update users set account_status = 'disabled', updated_at = now() where id = ${id}`;
    await sql`update user_sessions set revoked_at = now() where user_id = ${id} and revoked_at is null`;
    auditLog(sql, { actorType: "admin", actorId: admin.id, actorLabel: admin.email, action: "user.deactivate", targetType: "user", targetId: id, req });
    entitlementEvent(sql, { userId: id, actor: admin.id, action: "revoked", detail: { via: "user.deactivate" } });
    return json(res, 200, { ok: true, deleted: "soft" });
  }

  return json(res, 405, { error: "method-not-allowed" });
}
