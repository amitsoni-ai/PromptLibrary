// POST /api/activity  { event, promptId?, meta? }   (bearer session token)
// Fire-and-forget event logging for the admin analytics view.
import { db, json, readBody, resolveCode } from "./_db.js";
import { verify, bearer, sessionSecret } from "./_auth.js";

const EVENTS = new Set(["opened", "copied", "tested", "favorited", "unfavorited",
  "practice", "improved", "created", "search"]);

export default async function handler(req, res) {
  if (req.method !== "POST") return json(res, 405, { error: "method" });
  let sql;
  try { sql = db(); } catch { return json(res, 204, {}); }

  const tok = verify(bearer(req), sessionSecret());
  if (!tok || tok.t !== "s") return json(res, 204, {});
  const body = await readBody(req);
  if (!EVENTS.has(body.event)) return json(res, 204, {});

  const scope = await resolveCode(sql, tok.code).catch(() => null);
  if (!scope || scope.disabled) return json(res, 204, {});

  sql`insert into activity (subject, code, org_id, program_id, event, prompt_id, meta)
      values (${tok.subject}, ${scope.code}, ${scope.orgId || null},
              ${(scope.programIds && scope.programIds[0]) || scope.programId || null},
              ${body.event}, ${body.promptId || null}, ${JSON.stringify(body.meta || {})})`.catch(() => {});

  return json(res, 202, { ok: true });
}
