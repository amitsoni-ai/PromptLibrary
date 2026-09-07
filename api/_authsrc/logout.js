// POST /api/auth/logout   -> 200 { ok }   (revokes the current session row +
// clears the cookie). Idempotent.
import { db, json } from "../_db.js";
import { revokeUserSession, clearUserSessionCookie } from "../_session.js";
import { clearCookie, CSRF_COOKIE } from "../_http.js";
import { authEvent } from "../_audit.js";

export default async function handler(req, res) {
  if (req.method !== "POST") return json(res, 405, { error: "method-not-allowed" });
  let sql;
  try { sql = db(); } catch { return json(res, 200, { ok: true }); }
  try {
    await revokeUserSession(sql, req);
    authEvent(sql, { event: "logout", req });
  } catch { /* ignore */ }
  clearUserSessionCookie(res);
  clearCookie(res, CSRF_COOKIE);
  return json(res, 200, { ok: true });
}
