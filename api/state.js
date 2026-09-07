// GET  /api/state?keys=favorites,usage,...   -> { favorites: <value>, ... }
// PUT  /api/state   { key, value } | { states: { key: value, ... } }
// Bearer token from /api/session. The code is re-checked every call, so a
// disabled/deleted code evicts the learner immediately.
import { db, json, readBody, resolveCode } from "./_db.js";
import { verify, bearer, sessionSecret } from "./_auth.js";

const KEYS = new Set(["favorites", "usage", "myPrompts", "improvements", "feedback", "progress"]);

export default async function handler(req, res) {
  let sql;
  try { sql = db(); } catch { return json(res, 503, { error: "no-backend" }); }

  const tok = verify(bearer(req), sessionSecret());
  if (!tok || tok.t !== "s") return json(res, 401, { error: "auth" });

  const scope = await resolveCode(sql, tok.code).catch(() => null);
  if (!scope || scope.disabled) return json(res, 401, { error: "code-revoked" });
  const subject = tok.subject;

  if (req.method === "GET") {
    const wanted = String(req.query.keys || "").split(",").map((s) => s.trim()).filter((k) => KEYS.has(k));
    const list = wanted.length ? wanted : [...KEYS];
    const rows = await sql`select key, value from learner_state where subject = ${subject} and key = any(${list})`;
    const out = {};
    for (const r of rows) out[r.key] = r.value;
    return json(res, 200, out);
  }

  if (req.method === "PUT") {
    const body = await readBody(req);
    const states = body.states && typeof body.states === "object"
      ? body.states
      : (body.key ? { [body.key]: body.value } : null);
    if (!states) return json(res, 400, { error: "bad-body" });
    for (const [key, value] of Object.entries(states)) {
      if (!KEYS.has(key)) continue;
      await sql`insert into learner_state (subject, key, value, updated_at)
                values (${subject}, ${key}, ${JSON.stringify(value)}, now())
                on conflict (subject, key) do update set value = excluded.value, updated_at = now()`;
    }
    return json(res, 200, { ok: true });
  }

  return json(res, 405, { error: "method" });
}
