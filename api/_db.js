// Neon serverless client + small helpers shared by the API routes.
import { neon as neonHttp } from "@neondatabase/serverless";

// DEV/TEST: `DATABASE_URL=pglite://memory` (or `pglite:///path`) swaps in an
// in-process Postgres with the same call surface. Production (a real
// postgres:// URL) always uses the Neon HTTP driver — the branch below is the
// only difference.
async function makeSql(url) {
  if (/^pglite:/i.test(url)) {
    const { neon } = await import("./_pglite.js");
    return neon(url);
  }
  return neonHttp(url);
}

let _sql = null;
let _sqlPromise = null;
export function db() {
  if (!process.env.DATABASE_URL) {
    const e = new Error("DATABASE_URL is not set");
    e.code = "NO_DB";
    throw e;
  }
  if (!_sql) {
    // The Neon HTTP driver constructs synchronously; the pglite shim needs a
    // dynamic import. Resolve once, reuse. The retry wrapper awaits it.
    if (!_sqlPromise) _sqlPromise = makeSql(process.env.DATABASE_URL);
    let _raw = null;
    const raw = async (...args) => (_raw || (_raw = await _sqlPromise))(...args);
    // Neon computes scale to zero; the first query after a cold start can
    // "fetch failed". Retry a couple of times with a short backoff.
    _sql = async function (...args) {
      let last;
      for (let i = 0; i < 3; i++) {
        try { return await raw(...args); }
        catch (e) {
          last = e;
          const msg = String(e && e.message || e);
          if (!/fetch failed|ECONNRESET|ETIMEDOUT|and the pooler|Connection terminated|522|503/i.test(msg)) throw e;
          await new Promise((r) => setTimeout(r, 250 * (i + 1)));
        }
      }
      throw last;
    };
  }
  return _sql;
}

export function json(res, status, body) {
  res.setHeader("content-type", "application/json; charset=utf-8");
  res.setHeader("cache-control", "no-store");
  res.status(status).send(JSON.stringify(body));
  return res;   // so `if (x) return x;` works when a helper does `return json(...)`
}

export async function readBody(req) {
  if (req.body && typeof req.body === "object") return req.body;
  const chunks = [];
  for await (const c of req) chunks.push(c);
  const raw = Buffer.concat(chunks).toString("utf8").trim();
  if (!raw) return {};
  try { return JSON.parse(raw); } catch { return {}; }
}

export function normCode(c) {
  return String(c || "").toUpperCase().trim().replace(/\s+/g, "");
}

// Resolve an access code -> the session scope object the frontend expects.
// Checks admin_codes first, then seed_codes -> cohort/program/org/learner.
export async function resolveCode(sql, rawCode) {
  const code = normCode(rawCode);
  if (!code) return null;

  const adminRows = await sql`select * from admin_codes where upper(code) = ${code} limit 1`;
  if (adminRows.length) {
    const a = adminRows[0];
    if (!a.enabled) return { disabled: true, code: a.code };
    const progs = a.program_ids && a.program_ids.length
      ? await sql`select id, name, org_id, data from programs where id = any(${a.program_ids})`
      : [];
    return {
      kind: "admin",
      code: a.code,
      subjectBase: a.code,
      orgId: a.id,
      orgName: a.org_name,
      domain: a.domain || "",
      industry: a.industry || "",
      functions: a.functions || [],
      roles: a.roles || [],
      programIds: a.program_ids || [],
      fullLibrary: !!a.full_library,
      superAdmin: !!a.super_admin,
      programs: progs.map((p) => ({ id: p.id, name: p.name })),
    };
  }

  const seedRows = await sql`select * from seed_codes where upper(code) = ${code} limit 1`;
  if (!seedRows.length) return null;
  const s = seedRows[0];
  const cohRows = await sql`select * from cohorts where id = ${s.cohort_id} limit 1`;
  if (!cohRows.length) return null;
  const coh = cohRows[0];
  const progRows = await sql`select * from programs where id = ${coh.program_id} limit 1`;
  const prog = progRows[0] || null;
  const orgRows = prog ? await sql`select * from orgs where id = ${prog.org_id} limit 1` : [];
  const org = orgRows[0] || null;
  const lrnRows = s.learner_id ? await sql`select * from learners where id = ${s.learner_id} limit 1` : [];
  const learner = lrnRows[0] || null;
  return {
    kind: "cohort",
    code: s.code,
    subjectBase: learner ? learner.id : coh.id,
    cohortId: coh.id,
    cohortName: coh.name,
    programId: prog ? prog.id : null,
    programName: prog ? prog.name : null,
    programScope: prog ? prog.scope : "program",
    orgId: org ? org.id : null,
    orgName: org ? org.name : null,
    learnerId: learner ? learner.id : null,
    learnerName: learner ? learner.name : null,
  };
}

export function subjectFor(scope, name) {
  const base = scope.subjectBase || scope.code;
  const n = String(name || "").trim().toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");
  return n ? `${base}:${n}` : base;
}

// Build the object the frontend puts into Store.setSession().
export function sessionObject(scope, name, subject) {
  if (scope.kind === "admin") {
    return {
      code: scope.code, kind: "admin",
      orgId: scope.orgId, orgName: scope.orgName,
      domain: scope.domain, industry: scope.industry,
      functions: scope.functions, roles: scope.roles,
      programIds: scope.programIds, fullLibrary: scope.fullLibrary,
      superAdmin: scope.superAdmin,
      subject, name: name || "Learner", startedAt: Date.now(), backend: true,
    };
  }
  return {
    code: scope.code,
    orgId: scope.orgId, programId: scope.programId, cohortId: scope.cohortId,
    learnerId: scope.learnerId,
    subject, name: name || scope.learnerName || "Learner",
    startedAt: Date.now(), backend: true,
  };
}
