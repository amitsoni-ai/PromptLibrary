// POST /api/session
//   { code, name }            -> { token, session }        (redeem, issues a session token)
//   { code, preview: true }   -> { ok, resolved }          (gate live-preview, no token)
import { db, json, readBody, resolveCode, subjectFor, sessionObject } from "./_db.js";
import { sign, sessionSecret } from "./_auth.js";

export default async function handler(req, res) {
  if (req.method !== "POST") return json(res, 405, { error: "method" });
  let sql;
  try { sql = db(); } catch (e) { return json(res, 503, { error: "no-backend" }); }

  const body = await readBody(req);
  const scope = await resolveCode(sql, body.code).catch((e) => ({ _err: String(e) }));
  if (scope && scope._err) return json(res, 500, { error: "db", detail: scope._err });
  if (!scope) return json(res, 404, { error: "unknown-code" });
  if (scope.disabled) return json(res, 403, { error: "disabled" });

  if (body.preview) {
    return json(res, 200, {
      ok: true,
      resolved: {
        kind: scope.kind,
        orgName: scope.orgName || null,
        programName: scope.programName || null,
        programs: scope.programs || null,
        cohortName: scope.cohortName || null,
        industry: scope.industry || null,
        domain: scope.domain || null,
        fullLibrary: !!scope.fullLibrary,
        superAdmin: !!scope.superAdmin,
        programScoped: scope.kind === "cohort" ? scope.programScope === "program" : !scope.fullLibrary,
      },
    });
  }

  const subject = subjectFor(scope, body.name);
  const session = sessionObject(scope, body.name, subject);
  const token = sign({ t: "s", code: scope.code, subject }, sessionSecret());

  sql`insert into activity (subject, code, org_id, program_id, event, meta)
      values (${subject}, ${scope.code}, ${scope.orgId || null},
              ${(scope.programIds && scope.programIds[0]) || scope.programId || null},
              'signin', ${JSON.stringify({ name: body.name || null })})`.catch(() => {});

  return json(res, 200, { token, session });
}
