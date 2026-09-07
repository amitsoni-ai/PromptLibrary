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
import { str, validEmail, ROLES, AI_LEVELS, ACCOUNT_STATUSES } from "../_validate.js";
import { randomToken, sha256, newId, hashPassword } from "../_crypto.js";
import { sendEmail, appBaseUrl } from "../_email.js";
import { auditLog, authEvent, entitlementEvent } from "../_audit.js";
import { entitlementForFunction } from "../_functions.js";
import { resolveFunctionScope } from "../_funcscope.js";

// Re-scope a user's auto_function entitlement to their CURRENT role. No-op if
// the user has no entitlement or an admin/code-assigned one (never overridden).
async function realignFunction(sql, userId, actorId) {
  const u = (await sql`select id, role, email_verified, account_status from users where id = ${userId} limit 1`)[0];
  const cur = (await sql`select * from entitlements where user_id = ${userId} limit 1`)[0];
  if (!u || !cur || cur.source !== "auto_function") return { realigned: false };
  const grant = entitlementForFunction(u.role);
  const fs = grant.scopeType === "function"
    ? await resolveFunctionScope(sql, u.role)
    : { categories: [], programIds: grant.programIds, promptIds: [] };
  const programIds = fs.programIds && fs.programIds.length ? fs.programIds : grant.programIds;
  await sql`update entitlements set scope_type = ${grant.scopeType},
    program_ids = ${JSON.stringify(programIds)}, category_ids = ${JSON.stringify(fs.categories || [])},
    prompt_ids = ${JSON.stringify(fs.promptIds || [])}, status = 'active', updated_at = now()
    where user_id = ${userId}`;
  await sql`update program_enrollments set status = 'removed'
    where user_id = ${userId} and enrolled_by = 'system' and not (program_id = any(${programIds}))`;
  for (const pid of programIds) {
    await sql`insert into program_enrollments (id, user_id, program_id, status, enrolled_by)
              values (${newId("enr")}, ${userId}, ${pid}, 'active', 'system')
              on conflict (user_id, program_id) do update set status = 'active'`;
  }
  entitlementEvent(sql, { userId, actor: actorId, action: "modified",
    detail: { via: "admin_align_function", function: u.role, scopeType: grant.scopeType } });
  return { realigned: true, scopeType: grant.scopeType };
}

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
    const ENT_SOURCES = ["self_signup", "auto_function", "access_code", "admin"];
    const ENT_STATUSES = ["active", "suspended", "expired", "revoked", "none"];
    const entSource = ENT_SOURCES.includes(req.query.entSource) ? req.query.entSource : null;
    const entStatus = ENT_STATUSES.includes(req.query.entStatus) ? req.query.entStatus : null;
    const limit = Math.min(100, Math.max(1, parseInt(req.query.limit || "25", 10) || 25));
    const offset = Math.max(0, parseInt(req.query.offset || "0", 10) || 0);

    const where = [], params = [];
    const add = (clause, val) => { params.push(val); where.push(clause.replace("?", "$" + params.length)); };
    if (q) { params.push(`%${q}%`); where.push(`(lower(u.email) like $${params.length} or lower(u.first_name||' '||u.last_name) like $${params.length})`); }
    if (status) add("u.account_status = ?", status);
    if (role) add("u.role = ?", role);
    if (aiLevel) add("u.ai_level = ?", aiLevel);
    if (org) add("lower(u.org_name) like ?", `%${org}%`);
    if (verified !== null) add("u.email_verified = ?", verified);
    if (entSource) add("e.source = ?", entSource);
    if (entStatus === "none") where.push("e.id is null");
    else if (entStatus) add("e.status = ?", entStatus);
    const wsql = where.length ? "where " + where.join(" and ") : "";
    // last_activity_at as a grouped join, NOT a per-row correlated subquery —
    // the subquery form re-ran once per SCANNED row (every skipped OFFSET row
    // included), which made deep pages O(users²). One aggregate pass instead.
    const base = `from users u
        left join entitlements e on e.user_id = u.id
        left join (select user_id, max(ts) as last_activity_at from auth_events group by user_id) la on la.user_id = u.id
        ${wsql}`;
    const rows = await sql(
      `select u.*, e.source as ent_source, e.status as ent_status, e.scope_type as ent_scope,
              la.last_activity_at as last_activity_at
       ${base} order by u.created_at desc limit ${limit} offset ${offset}`, params);
    const total = (await sql(`select count(*)::int as n from users u left join entitlements e on e.user_id = u.id ${wsql}`, params))[0].n;
    return json(res, 200, {
      users: rows.map((u) => ({
        ...pub(u),
        entSource: u.ent_source || null, entStatus: u.ent_status || "none", entScope: u.ent_scope || "none",
        lastActivityAt: u.last_activity_at || null,
      })),
      total, limit, offset,
    });
  }

  // ---------- POST (create user / bulk actions) ----------
  if (req.method === "POST") {
    const body = await readBody(req);
    const actor = { actorType: "admin", actorId: admin.id, actorLabel: admin.email, req };
    const action = body.action || "create";

    if (action === "bulk") {
      const ids = Array.isArray(body.ids) ? body.ids.filter(Boolean).slice(0, 500) : [];
      const sub = body.subAction;
      const ALLOWED = ["suspend", "reactivate", "disable", "resend_verification", "force_verify", "send_reset", "revoke_sessions", "align_function"];
      if (!ids.length || !ALLOWED.includes(sub)) return json(res, 422, { error: "bad-bulk" });
      const results = [];
      for (const id of ids) {
        const u = (await sql`select * from users where id = ${id} limit 1`)[0];
        if (!u) { results.push({ id, ok: false, error: "not-found" }); continue; }
        try {
          if (sub === "suspend" || sub === "disable") {
            await sql`update users set account_status = ${sub === "disable" ? "disabled" : "suspended"}, updated_at = now() where id = ${id}`;
          } else if (sub === "reactivate") {
            await sql`update users set account_status = ${u.email_verified ? "active" : "pending_verification"}, updated_at = now() where id = ${id}`;
          } else if (sub === "force_verify") {
            await sql`update users set email_verified = true, account_status = case when account_status = 'pending_verification' then 'active' else account_status end, updated_at = now() where id = ${id}`;
          } else if (sub === "revoke_sessions") {
            await sql`update user_sessions set revoked_at = now() where user_id = ${id} and revoked_at is null`;
          } else if (sub === "resend_verification") {
            const t = randomToken(32);
            await sql`update email_verification_tokens set used_at = now() where user_id = ${id} and used_at is null`;
            await sql`insert into email_verification_tokens (id, user_id, token_hash, expires_at) values (${newId("evt")}, ${id}, ${sha256(t)}, now() + interval '24 hours')`;
            sendEmail("verify_email", u.email, { email: u.email, verifyUrl: `${appBaseUrl(req)}/verify-email?token=${t}`, expiresHours: 24 });
          } else if (sub === "send_reset") {
            const t = randomToken(32);
            await sql`update password_reset_tokens set used_at = now() where user_id = ${id} and used_at is null`;
            await sql`insert into password_reset_tokens (id, user_id, token_hash, expires_at) values (${newId("prt")}, ${id}, ${sha256(t)}, now() + interval '30 minutes')`;
            sendEmail("password_reset", u.email, { email: u.email, resetUrl: `${appBaseUrl(req)}/reset-password?token=${t}`, expiresMinutes: 30 });
          } else if (sub === "align_function") {
            await realignFunction(sql, id, admin.id);
          }
          results.push({ id, ok: true });
        } catch (e) { results.push({ id, ok: false, error: String(e && e.message || e) }); }
      }
      auditLog(sql, { ...actor, action: "user.bulk_" + sub, targetType: "user", targetId: null, detail: { count: results.filter((r) => r.ok).length, of: ids.length } });
      return json(res, 200, { ok: true, results });
    }

    if (action === "create") {
      const ev = validEmail(body.email);
      if (ev.error) return json(res, 422, { error: ev.error, field: "email" });
      const dup = await sql`select id from users where email_norm = ${ev.value} limit 1`;
      if (dup.length) return json(res, 409, { error: "email-exists" });
      const first = str(body.firstName, { field: "firstName", min: 1, max: 80, fallback: "" }).value;
      const last = str(body.lastName, { field: "lastName", min: 1, max: 80, fallback: "" }).value;
      const role = str(body.role ?? body.function, { field: "role", lower: true, allow: ROLES, fallback: "general" }).value;
      const aiLevel = str(body.aiLevel, { field: "aiLevel", lower: true, allow: AI_LEVELS, fallback: "beginner" }).value;
      const orgName = str(body.organization, { field: "organization", max: 120, fallback: "" }).value;
      const uid = newId("usr");
      const pwHash = await hashPassword(randomToken(24));   // unusable until they set one via the reset link
      await sql`insert into users (id, email, email_norm, password_hash, first_name, last_name,
                  role, ai_level, org_name, account_status, email_verified)
                values (${uid}, ${ev.value}, ${ev.value}, ${pwHash}, ${first}, ${last},
                  ${role}, ${aiLevel}, ${orgName}, 'pending_verification', false)`;
      authEvent(sql, { userId: uid, email: ev.value, event: "signup", req, meta: { by: "admin", adminId: admin.id } });
      auditLog(sql, { ...actor, action: "user.create", targetType: "user", targetId: uid, detail: { email: ev.value, role } });

      // optional starting entitlement
      const grant = body.entitlement || (body.functionScope ? { source: "auto_function" } : null);
      if (grant) {
        if (grant.source === "auto_function" || grant.functionScope) {
          const g = entitlementForFunction(role);
          const fs = g.scopeType === "function" ? await resolveFunctionScope(sql, role) : { categories: [], programIds: g.programIds, promptIds: [] };
          await sql`insert into entitlements (id, user_id, source, scope_type, program_ids, category_ids, prompt_ids, license_type, org_name, status, granted_by, note)
                    values (${newId("ent")}, ${uid}, 'auto_function', ${g.scopeType}, ${JSON.stringify(fs.programIds || g.programIds)},
                      ${JSON.stringify(fs.categories || [])}, ${JSON.stringify(fs.promptIds || [])}, 'standard', ${orgName}, 'active', ${admin.id}, 'Admin-created')`;
        } else {
          const scopeType = ["full", "function", "program", "track", "collection", "none"].includes(grant.scopeType) ? grant.scopeType : "full";
          await sql`insert into entitlements (id, user_id, source, scope_type, program_ids, category_ids, prompt_ids, license_type, org_name, status, granted_by, note)
                    values (${newId("ent")}, ${uid}, 'admin', ${scopeType}, ${JSON.stringify(grant.programIds || [])},
                      ${JSON.stringify(grant.categoryIds || [])}, ${JSON.stringify(grant.promptIds || [])}, ${grant.licenseType || "standard"},
                      ${orgName}, ${grant.status || "active"}, ${admin.id}, 'Admin-created')`;
        }
        entitlementEvent(sql, { userId: uid, actor: admin.id, action: "granted", detail: { via: "admin_create" } });
      }

      // invite / verification email (default on)
      if (body.sendInvite !== false) {
        const t = randomToken(32);
        await sql`insert into email_verification_tokens (id, user_id, token_hash, expires_at) values (${newId("evt")}, ${uid}, ${sha256(t)}, now() + interval '24 hours')`;
        await sendEmail("welcome", ev.value, { firstName: first || "there", verifyUrl: `${appBaseUrl(req)}/verify-email?token=${t}` });
        authEvent(sql, { userId: uid, email: ev.value, event: "verify_sent", req });
      }

      const fresh = (await sql`select * from users where id = ${uid} limit 1`)[0];
      return json(res, 201, { ok: true, user: pub(fresh) });
    }

    return json(res, 400, { error: "unknown-action" });
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
      // changing the function re-scopes an auto entitlement (never an admin one)
      if (body.role !== undefined && body.role !== u.role) await realignFunction(sql, id, admin.id);
    } else if (action === "align_function") {
      const r = await realignFunction(sql, id, admin.id);
      if (!r.realigned) return json(res, 409, { error: "not-auto-entitlement" });
      auditLog(sql, { ...actor, action: "user.align_function", targetType: "user", targetId: id, detail: r });
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
