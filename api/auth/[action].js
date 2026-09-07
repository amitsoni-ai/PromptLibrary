// Catch-all for /api/auth/* — one Serverless Function that dispatches to the
// per-action handlers in ../_authsrc/ (kept out of Vercel's function count by
// the leading underscore). Consolidated to stay under the Hobby-plan 12-function
// limit. Each route is a literal dynamic import so the bundler traces it.
import { json } from "../_db.js";

const ROUTES = {
  "csrf": () => import("../_authsrc/csrf.js"),
  "signup": () => import("../_authsrc/signup.js"),
  "verify-email": () => import("../_authsrc/verify-email.js"),
  "resend-verification": () => import("../_authsrc/resend-verification.js"),
  "login": () => import("../_authsrc/login.js"),
  "logout": () => import("../_authsrc/logout.js"),
  "me": () => import("../_authsrc/me.js"),
  "forgot-password": () => import("../_authsrc/forgot-password.js"),
  "reset-password": () => import("../_authsrc/reset-password.js"),
  "redeem-code": () => import("../_authsrc/redeem-code.js"),
};

export default async function handler(req, res) {
  const action = String((req.query && req.query.action) || "").toLowerCase();
  const load = ROUTES[action];
  if (!load) return json(res, 404, { error: "not-found", action });
  const mod = await load();
  return mod.default(req, res);
}
