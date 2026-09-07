// Exercise the /api handlers directly against the live Neon DB.
process.env.SESSION_SECRET = "test-session-secret-xyz";
process.env.ADMIN_SECRET = "TEST-ADMIN-KEY";
const API = new URL("../api/", import.meta.url).pathname;

const sessionH = (await import(API + "/session.js")).default;
const stateH = (await import(API + "/state.js")).default;
const activityH = (await import(API + "/activity.js")).default;
const adminLoginH = (await import(API + "/admin/login.js")).default;
const adminCodesH = (await import(API + "/admin/codes.js")).default;
const adminAnalyticsH = (await import(API + "/admin/analytics.js")).default;

function mock(method, { body, query, headers } = {}) {
  const req = {
    method, query: query || {}, headers: headers || {},
    body: body || undefined,
    async *[Symbol.asyncIterator]() { if (body) yield Buffer.from(JSON.stringify(body)); },
  };
  let _status = 200, _body = null;
  const res = {
    setHeader() {}, status(s) { _status = s; return res; },
    send(b) { _body = b; return res; },
    get result() { return { status: _status, json: safeParse(_body) }; },
  };
  return { req, res };
}
const safeParse = (s) => { try { return JSON.parse(s); } catch { return s; } };
const results = [];
const check = (name, cond, extra) => { results.push([cond ? "PASS" : "FAIL", name, extra || ""]); };

// 1. redeem DEMO-2026
let m = mock("POST", { body: { code: "demo-2026", name: "Ada L" } });
await sessionH(m.req, m.res);
let r = m.res.result;
check("session DEMO-2026 -> 200 + token", r.status === 200 && r.json.token && r.json.session, JSON.stringify(r.json.session || r.json).slice(0, 120));
const token = r.json.token;
const subject = r.json.session && r.json.session.subject;

// 2. preview a scoped course code
m = mock("POST", { body: { code: "SYNOTTIC-SALES", preview: true } });
await sessionH(m.req, m.res);
r = m.res.result;
check("preview SYNOTTIC-SALES -> resolved, programScoped", r.status === 200 && r.json.resolved && r.json.resolved.programScoped === true, JSON.stringify(r.json.resolved));

// 3. PUT state
m = mock("PUT", { body: { states: { favorites: ["lib-1", "lib-2"], progress: { practice: [{ overall: 71 }] } } }, headers: { authorization: "Bearer " + token } });
await stateH(m.req, m.res);
check("state PUT -> 200", m.res.result.status === 200);

// 4. GET state
m = mock("GET", { query: { keys: "favorites,progress" }, headers: { authorization: "Bearer " + token } });
await stateH(m.req, m.res);
r = m.res.result;
check("state GET round-trips", r.status === 200 && Array.isArray(r.json.favorites) && r.json.favorites.length === 2 && r.json.progress.practice[0].overall === 71, JSON.stringify(r.json));

// 5. bad token
m = mock("GET", { query: { keys: "favorites" }, headers: { authorization: "Bearer garbage" } });
await stateH(m.req, m.res);
check("state GET bad token -> 401", m.res.result.status === 401);

// 6. activity + analytics
m = mock("POST", { body: { event: "opened", promptId: "lib-1" }, headers: { authorization: "Bearer " + token } });
await activityH(m.req, m.res);
check("activity opened -> 202", m.res.result.status === 202, JSON.stringify(m.res.result.json));

// 7. admin login
m = mock("POST", { body: { key: "TEST-ADMIN-KEY" } });
await adminLoginH(m.req, m.res);
r = m.res.result;
check("admin login -> token", r.status === 200 && r.json.token);
const adminTok = r.json.token;
m = mock("POST", { body: { key: "wrong" } });
await adminLoginH(m.req, m.res);
check("admin login wrong -> 401", m.res.result.status === 401);

// 8. list codes
m = mock("GET", { headers: { authorization: "Bearer " + adminTok } });
await adminCodesH(m.req, m.res);
r = m.res.result;
check("admin codes GET -> >=53", r.status === 200 && r.json.codes.length >= 53, "count=" + (r.json.codes ? r.json.codes.length : "?"));

// 9. create a code, redeem it
m = mock("POST", { body: { code: "APITEST-ORG-1", orgName: "API Test Org", industry: "Technology & SaaS", functions: ["Sales"], programIds: ["prog-syn-sales"], fullLibrary: false }, headers: { authorization: "Bearer " + adminTok } });
await adminCodesH(m.req, m.res);
r = m.res.result;
check("admin create code -> 200", r.status === 200 && r.json.code && r.json.code.id, JSON.stringify(r.json.code || r.json));
const newId = r.json.code && r.json.code.id;

m = mock("POST", { body: { code: "apitest-org-1", name: "Bo" } });
await sessionH(m.req, m.res);
r = m.res.result;
check("redeem admin-created code -> 200 kind=admin", r.status === 200 && r.json.session && r.json.session.kind === "admin" && r.json.session.orgName === "API Test Org", JSON.stringify(r.json.session || r.json));

// 10. disable it -> redeem 403
m = mock("PATCH", { body: { id: newId, enabled: false }, headers: { authorization: "Bearer " + adminTok } });
await adminCodesH(m.req, m.res);
check("admin disable -> 200", m.res.result.status === 200);
m = mock("POST", { body: { code: "APITEST-ORG-1" } });
await sessionH(m.req, m.res);
check("redeem disabled -> 403", m.res.result.status === 403);

// existing session's state call after its code is fine (DEMO-2026 still enabled)
m = mock("GET", { query: { keys: "favorites" }, headers: { authorization: "Bearer " + token } });
await stateH(m.req, m.res);
check("existing session still valid", m.res.result.status === 200);

// 11. delete the test code
m = mock("DELETE", { query: { id: newId }, headers: { authorization: "Bearer " + adminTok } });
await adminCodesH(m.req, m.res);
check("admin delete -> 200", m.res.result.status === 200);

// 12. analytics
m = mock("GET", { query: { days: "30" }, headers: { authorization: "Bearer " + adminTok } });
await adminAnalyticsH(m.req, m.res);
r = m.res.result;
check("analytics -> totals + byEvent", r.status === 200 && r.json.totals && Array.isArray(r.json.byEvent), JSON.stringify(r.json.totals));

// cleanup test state rows
const { neon } = await import("@neondatabase/serverless");
const sql = neon(process.env.DATABASE_URL);
await sql(`delete from learner_state where subject like $1`, [subject + "%"]);
await sql(`delete from learner_state where subject like $1`, ["demo-2026%"]);
await sql(`delete from activity where subject like $1 or code = $2`, [subject + "%", "APITEST-ORG-1"]);

console.log("\n" + results.map((x) => `${x[0]}  ${x[1]}${x[2] ? "\n        " + x[2] : ""}`).join("\n"));
const fails = results.filter((x) => x[0] === "FAIL").length;
console.log(`\n${results.length - fails}/${results.length} passed`);
process.exit(fails ? 1 : 0);
