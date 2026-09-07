// Resolve an opaque session cookie/bearer -> live user (or admin) row.
// Every call re-reads the DB, so suspending an account or revoking a session
// takes effect on the very next request.
import { sha256, splitSessionValue, newSessionParts } from "./_crypto.js";
import { parseCookies, SESSION_COOKIE, ADMIN_COOKIE, setSessionCookie, clearCookie, clientIp, userAgent } from "./_http.js";

const DAY = 86400;
const SESSION_TTL = 12 * 3600;          // 12h
const REMEMBER_TTL = 30 * DAY;          // 30d
const ADMIN_TTL = 8 * 3600;             // 8h — admin sessions are shorter

function bearer(req) {
  const h = req.headers.authorization || "";
  return h.startsWith("Bearer ") ? h.slice(7) : null;
}

// ---- learner sessions ----

export async function createUserSession(sql, userId, { remember, req }) {
  const { id, secretHash, value } = newSessionParts("ses");
  const ttl = remember ? REMEMBER_TTL : SESSION_TTL;
  await sql`insert into user_sessions (id, user_id, secret_hash, expires_at, remember, ip, user_agent)
            values (${id}, ${userId}, ${secretHash}, now() + (${ttl} || ' seconds')::interval,
                    ${!!remember}, ${clientIp(req)}, ${userAgent(req)})`;
  return { value, ttl };
}

export function attachUserSessionCookie(res, value, ttl) {
  setSessionCookie(res, SESSION_COOKIE, value, { maxAge: ttl });
}

export async function resolveUser(sql, req) {
  const cookies = parseCookies(req);
  const raw = cookies[SESSION_COOKIE] || bearer(req);
  const parts = splitSessionValue(raw);
  if (!parts) return null;
  const rows = await sql`
    select s.id as sid, s.expires_at, s.revoked_at, s.remember,
           u.* from user_sessions s join users u on u.id = s.user_id
    where s.id = ${parts.id} and s.secret_hash = ${sha256(parts.secret)} limit 1`;
  if (!rows.length) return null;
  const r = rows[0];
  if (r.revoked_at || new Date(r.expires_at) < new Date()) return null;
  sql`update user_sessions set last_seen_at = now() where id = ${parts.sid}`.catch(() => {});
  const user = { ...r };
  delete user.sid; delete user.expires_at; delete user.revoked_at; delete user.password_hash;
  return { user, sessionId: r.sid };
}

export async function revokeUserSession(sql, req) {
  const cookies = parseCookies(req);
  const parts = splitSessionValue(cookies[SESSION_COOKIE] || bearer(req));
  if (parts) await sql`update user_sessions set revoked_at = now() where id = ${parts.id}`.catch(() => {});
}

export function clearUserSessionCookie(res) { clearCookie(res, SESSION_COOKIE); }

// ---- admin sessions (separate plane) ----

export async function createAdminSession(sql, adminId, { req }) {
  const { id, secretHash, value } = newSessionParts("asn");
  await sql`insert into admin_sessions (id, admin_id, secret_hash, expires_at, ip, user_agent)
            values (${id}, ${adminId}, ${secretHash}, now() + (${ADMIN_TTL} || ' seconds')::interval,
                    ${clientIp(req)}, ${userAgent(req)})`;
  return { value, ttl: ADMIN_TTL };
}
export function attachAdminSessionCookie(res, value, ttl) {
  setSessionCookie(res, ADMIN_COOKIE, value, { maxAge: ttl });
}
export function clearAdminSessionCookie(res) { clearCookie(res, ADMIN_COOKIE); }

export async function resolveAdmin(sql, req) {
  const cookies = parseCookies(req);
  const parts = splitSessionValue(cookies[ADMIN_COOKIE] || bearer(req));
  if (!parts) return null;
  const rows = await sql`
    select s.id as sid, s.expires_at, s.revoked_at, a.*
    from admin_sessions s join admin_users a on a.id = s.admin_id
    where s.id = ${parts.id} and s.secret_hash = ${sha256(parts.secret)} limit 1`;
  if (!rows.length) return null;
  const r = rows[0];
  if (r.revoked_at || new Date(r.expires_at) < new Date() || r.status !== "active") return null;
  sql`update admin_sessions set last_seen_at = now() where id = ${parts.sid}`.catch(() => {});
  const admin = { ...r };
  delete admin.sid; delete admin.expires_at; delete admin.revoked_at; delete admin.password_hash;
  return { admin, sessionId: r.sid };
}

export async function revokeAdminSession(sql, req) {
  const cookies = parseCookies(req);
  const parts = splitSessionValue(cookies[ADMIN_COOKIE] || bearer(req));
  if (parts) await sql`update admin_sessions set revoked_at = now() where id = ${parts.id}`.catch(() => {});
}

// RBAC. Capability -> minimum roles allowed.
const RBAC = {
  "users.read":        ["SUPER_ADMIN", "ADMIN", "PROGRAM_MANAGER", "CONTENT_MANAGER", "VIEW_ONLY"],
  "users.write":       ["SUPER_ADMIN", "ADMIN"],
  "users.delete":      ["SUPER_ADMIN"],
  "access.read":       ["SUPER_ADMIN", "ADMIN", "PROGRAM_MANAGER", "VIEW_ONLY"],
  "access.write":      ["SUPER_ADMIN", "ADMIN", "PROGRAM_MANAGER"],
  "programs.read":     ["SUPER_ADMIN", "ADMIN", "PROGRAM_MANAGER", "CONTENT_MANAGER", "VIEW_ONLY"],
  "programs.write":    ["SUPER_ADMIN", "ADMIN", "PROGRAM_MANAGER"],
  "prompts.read":      ["SUPER_ADMIN", "ADMIN", "PROGRAM_MANAGER", "CONTENT_MANAGER", "VIEW_ONLY"],
  "prompts.write":     ["SUPER_ADMIN", "ADMIN", "CONTENT_MANAGER"],
  "analytics.read":    ["SUPER_ADMIN", "ADMIN", "PROGRAM_MANAGER", "VIEW_ONLY"],
  "audit.read":        ["SUPER_ADMIN", "ADMIN"],
  "admins.manage":     ["SUPER_ADMIN"],
};
export function adminCan(admin, capability) {
  if (!admin) return false;
  if (admin.admin_role === "SUPER_ADMIN") return true;
  const allowed = RBAC[capability];
  return !!allowed && allowed.includes(admin.admin_role);
}
export { RBAC };

// Resolve an admin from EITHER the new admin_sessions cookie OR the legacy
// HMAC console token (`/api/admin/login` with ADMIN_SECRET) — the latter is
// treated as a full SUPER_ADMIN so the existing console keeps working.
export async function requireAdmin(sql, req, capability) {
  const ctx = await resolveAdmin(sql, req).catch(() => null);
  let admin = ctx && ctx.admin;
  if (!admin) {
    const { verify, bearer, sessionSecret } = await import("./_auth.js");
    const legacy = verify(bearer(req), sessionSecret());
    if (legacy && legacy.t === "a") {
      admin = { id: "legacy-console", email: "console", name: "Console (legacy key)", admin_role: "SUPER_ADMIN", status: "active" };
    }
  }
  if (!admin) return { error: 401, code: "auth" };
  if (capability && !adminCan(admin, capability)) return { error: 403, code: "forbidden", admin };
  return { admin };
}
