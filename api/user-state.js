// Cookie-session-keyed twin of api/state.js + api/activity.js — for ACCOUNT
// users (email+password signup/login via /api/auth/*), whose session lives in
// the httpOnly syn_session cookie, not the classic access-code Bearer token.
//
// Before this endpoint, account users' favorites / myPrompts / usage /
// improvements / feedback / progress lived in localStorage ONLY (see
// AUTH.md "Not yet done" — the schema was ready, this was the missing route).
// Signing in on a new device or clearing browser data silently lost everything
// they'd saved. This closes that gap by reusing the SAME learner_state table,
// keyed by subject = 'user:'+id (exactly the subject src/part_auth.js already
// stamps onto the client session — see applyUserSession).
//
//   GET  /api/user-state?keys=favorites,usage,...   -> { favorites: <value>, ... }
//   PUT  /api/user-state   { key, value } | { states: { key: value, ... } }
//   POST /api/user-state   { event, promptId?, meta? }   (activity log)
//
// Additive only: no schema change, no changes to the access-code Bearer flow
// (api/state.js, api/activity.js untouched), no changes to auth code — this
// only IMPORTS resolveUser (api/_session.js) and checkCsrf (api/_http.js).
import { db, json, readBody } from "./_db.js";
import { resolveUser } from "./_session.js";
import { checkCsrf } from "./_http.js";

const STATE_KEYS = new Set(["favorites", "usage", "myPrompts", "improvements", "feedback", "progress"]);
const EVENTS = new Set(["opened", "copied", "tested", "favorited", "unfavorited",
  "practice", "improved", "created", "search"]);

export default async function handler(req, res) {
  let sql;
  try { sql = db(); }
  catch { return json(res, req.method === "POST" ? 204 : 503, req.method === "POST" ? {} : { error: "no-backend" }); }

  const ctx = await resolveUser(sql, req).catch(() => null);
  if (!ctx) return json(res, req.method === "POST" ? 204 : 401, req.method === "POST" ? {} : { error: "auth" });
  const subject = "user:" + ctx.user.id;

  if (req.method === "GET") {
    const wanted = String(req.query.keys || "").split(",").map((s) => s.trim()).filter((k) => STATE_KEYS.has(k));
    const list = wanted.length ? wanted : [...STATE_KEYS];
    const rows = await sql`select key, value from learner_state where subject = ${subject} and key = any(${list})`;
    const out = {};
    for (const r of rows) out[r.key] = r.value;
    return json(res, 200, out);
  }

  if (req.method === "PUT") {
    if (!checkCsrf(req)) return json(res, 403, { error: "bad-csrf" });
    const body = await readBody(req);
    const states = body.states && typeof body.states === "object"
      ? body.states
      : (body.key ? { [body.key]: body.value } : null);
    if (!states) return json(res, 400, { error: "bad-body" });
    for (const [key, value] of Object.entries(states)) {
      if (!STATE_KEYS.has(key)) continue;
      await sql`insert into learner_state (subject, key, value, updated_at)
                values (${subject}, ${key}, ${JSON.stringify(value)}, now())
                on conflict (subject, key) do update set value = excluded.value, updated_at = now()`;
    }
    return json(res, 200, { ok: true });
  }

  if (req.method === "POST") {
    // Activity log — fire-and-forget; fails soft (never blocks the UI), same
    // spirit as api/activity.js.
    if (!checkCsrf(req)) return json(res, 204, {});
    const body = await readBody(req);
    if (!EVENTS.has(body.event)) return json(res, 204, {});
    sql`insert into activity (subject, code, org_id, program_id, event, prompt_id, meta)
        values (${subject}, null, null, null, ${body.event}, ${body.promptId || null}, ${JSON.stringify(body.meta || {})})`.catch(() => {});
    return json(res, 202, { ok: true });
  }

  return json(res, 405, { error: "method-not-allowed" });
}
