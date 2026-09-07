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

  // A v2 access_codes / collection code binds to a learner entitlement — the
  // anonymous session gate can't complete it. Tell the client to route the
  // learner through sign-in / sign-up, then /api/auth/redeem-code.
  if (scope.kind === "account") {
    if (scope.expired) return json(res, 403, { error: "code-expired" });
    if (scope.exhausted) return json(res, 403, { error: "code-exhausted" });
    if (body.preview) {
      const bits = [];
      if (scope.categoryCount) bits.push(`${scope.categoryCount} categor${scope.categoryCount === 1 ? "y" : "ies"}`);
      if (scope.programCount) bits.push(`${scope.programCount} program${scope.programCount === 1 ? "" : "s"}`);
      return json(res, 200, {
        ok: true,
        resolved: {
          kind: "account",
          accountRequired: true,
          orgName: scope.orgName || null,
          scopeType: scope.scopeType,
          scopeNote: bits.length
            ? `Organisation library — ${bits.join(" · ")}.`
            : "Organisation library — a curated set of prompts.",
        },
      });
    }
    return json(res, 409, { error: "account-required", code: scope.code, orgName: scope.orgName || null });
  }

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
