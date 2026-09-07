// Catch-all for /api/admin/* — one Serverless Function that dispatches to the
// per-action handlers in ../_adminsrc/ (kept out of Vercel's function count by
// the leading underscore). Consolidated to stay under the Hobby-plan 12-function
// limit. Each route is a literal dynamic import so the bundler traces it.
import { json } from "../_db.js";

const ROUTES = {
  "login": () => import("../_adminsrc/login.js"),
  "session": () => import("../_adminsrc/session.js"),
  "codes": () => import("../_adminsrc/codes.js"),
  "analytics": () => import("../_adminsrc/analytics.js"),
  "users": () => import("../_adminsrc/users.js"),
  "entitlements": () => import("../_adminsrc/entitlements.js"),
  "functions": () => import("../_adminsrc/functions.js"),
  "collections": () => import("../_adminsrc/collections.js"),
  "audit": () => import("../_adminsrc/audit.js"),
};

export default async function handler(req, res) {
  const action = String((req.query && req.query.action) || "").toLowerCase();
  const load = ROUTES[action];
  if (!load) return json(res, 404, { error: "not-found", action });
  const mod = await load();
  return mod.default(req, res);
}
