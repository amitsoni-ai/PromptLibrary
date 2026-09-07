// GET /api/auth/csrf -> { csrfToken } + sets the syn_csrf cookie.
// The SPA calls this once on load, then echoes the token in `x-csrf-token`
// on every state-changing request (double-submit cookie pattern).
import { json } from "../_db.js";
import { issueCsrf } from "../_http.js";

export default async function handler(req, res) {
  if (req.method !== "GET") return json(res, 405, { error: "method-not-allowed" });
  const token = issueCsrf(res, req);
  return json(res, 200, { csrfToken: token });
}
