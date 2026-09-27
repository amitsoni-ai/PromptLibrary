// Load the Working with AI pack into a LOCAL dev server and create a test learner.
// Refuses to talk to anything but localhost, so it can never touch production.
//
//   1) DATABASE_URL=pglite:///tmp/synottic-dev-pglite node migrate/run.mjs
//   2) DATABASE_URL=pglite:///tmp/synottic-dev-pglite npm run dev:auth      (leave running)
//   3) node docs/collections/working-with-ai/load_local.mjs                  (in a second terminal)
//
// Does what an admin would do in the console: clean-up import, pilot import,
// Collection with the 20 pinned ids, access code. Then signs up and verifies a
// test learner and redeems the code, and prints the logins to use in the browser.
import fs from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const BASE = process.env.LOCAL_BASE || "http://localhost:8790";
if (!/^http:\/\/(localhost|127\.0\.0\.1)(:\d+)?$/.test(BASE)) {
  console.error(`Refusing to run against ${BASE}: this script is for a local dev server only.`);
  process.exit(1);
}
const HERE = dirname(fileURLToPath(import.meta.url));
const ADMIN = { email: process.env.ADMIN_BOOTSTRAP_EMAIL || "admin@synottic.dev", password: process.env.ADMIN_BOOTSTRAP_PASSWORD || "adminDevPass123" };
const LEARNER = { email: "learner.test@example.com", password: "Learner!Pass123" };

function client() {
  let cookie = "";
  return async function req(path, opts = {}) {
    const r = await fetch(BASE + path, { ...opts, headers: { "content-type": "application/json", cookie, ...(opts.headers || {}) } });
    for (const c of r.headers.getSetCookie?.() || []) {
      const [pair] = c.split(";"); const [k] = pair.split("=");
      cookie = cookie.split("; ").filter((x) => x && !x.startsWith(k + "=")).concat(pair).join("; ");
    }
    const t = await r.text();
    try { return { status: r.status, json: JSON.parse(t) }; } catch { return { status: r.status, json: t.slice(0, 300) }; }
  };
}
const fail = (msg) => { console.error("✗ " + msg); process.exit(1); };

// ── admin
const admin = client();
const acsrf = (await admin("/api/auth/csrf")).json.csrfToken;
const AH = { "x-csrf-token": acsrf };
const login = await admin("/api/admin/session", { method: "POST", headers: AH, body: JSON.stringify(ADMIN) });
if (login.status !== 200) fail(`admin sign-in failed (${login.status}). Is the dev server running with npm run dev:auth?`);
console.log("✓ admin signed in");

for (const f of ["01_cleanup.json", "02_working_with_ai.json"]) {
  const rows = JSON.parse(fs.readFileSync(join(HERE, "import", f), "utf8"));
  const prev = await admin("/api/admin/prompts", { method: "POST", headers: AH, body: JSON.stringify({ action: "import", rows, commit: false }) });
  const done = await admin("/api/admin/prompts", { method: "POST", headers: AH, body: JSON.stringify({ action: "import", rows, commit: true }) });
  console.log(`✓ ${f}: preview ${JSON.stringify(prev.json.counts)} → committed ${JSON.stringify(done.json.counts)}`);
}

const ids = JSON.parse(fs.readFileSync(join(HERE, "import", "02_working_with_ai.json"), "utf8")).map((r) => r.id);
const existing = (await admin("/api/admin/collections")).json.collections || [];
let col = existing.find((c) => c.name === "Working with AI");
if (!col) {
  const r = await admin("/api/admin/collections", { method: "POST", headers: AH, body: JSON.stringify({
    action: "create", name: "Working with AI", orgName: "Local Test Org", promptIds: ids, categoryIds: [], programIds: [],
    defaultFunction: "general", defaultAiLevel: "beginner" }) });
  if (r.status !== 200) fail("collection create failed: " + JSON.stringify(r.json));
  col = r.json.collection;
}
let code = (col.codes || []).find((k) => k.enabled)?.code;
if (!code) {
  const g = await admin("/api/admin/collections", { method: "POST", headers: AH, body: JSON.stringify({ action: "generate_code", id: col.id, label: "Local test" }) });
  code = g.json.code?.code;
}
console.log(`✓ collection "Working with AI" (${col.promptIds.length} pinned) · access code ${code}`);

// ── test learner
const learner = client();
const lcsrf = (await learner("/api/auth/csrf")).json.csrfToken;
const LH = { "x-csrf-token": lcsrf };
const su = await learner("/api/auth/signup", { method: "POST", headers: LH, body: JSON.stringify({
  firstName: "Test", lastName: "Learner", email: LEARNER.email, password: LEARNER.password, confirmPassword: LEARNER.password,
  function: "general", aiLevel: "beginner", organization: "Local Test Org", agreeTerms: true }) });
if (su.status === 201) {
  const ob = await learner("/api/dev/outbox");
  const mails = Array.isArray(ob.json) ? ob.json : (ob.json.outbox || ob.json.messages || []);
  const m = mails.filter((x) => (x.to || "").includes(LEARNER.email)).pop();
  const token = decodeURIComponent((String(m?.text || m?.html || "").match(/token=([A-Za-z0-9._%-]+)/) || [])[1] || "");
  // On a re-run the account already exists and signup still answers 201 (no account
  // enumeration); verifying an old token is then a harmless no-op.
  await learner("/api/auth/verify-email", { method: "POST", headers: LH, body: JSON.stringify({ token }) });
}
// Always sign in explicitly; signing in rotates the CSRF token, so refetch it after.
const li = await learner("/api/auth/login", { method: "POST", headers: { "x-csrf-token": (await learner("/api/auth/csrf")).json.csrfToken }, body: JSON.stringify(LEARNER) });
if (li.status !== 200 || li.json.needsVerification) fail(`learner sign-in failed (${li.status}): is the server running with EMAIL_TRANSPORT=console?`);
const fresh = { "x-csrf-token": (await learner("/api/auth/csrf")).json.csrfToken };
const red = await learner("/api/auth/redeem-code", { method: "POST", headers: fresh, body: JSON.stringify({ code }) });
if (red.status !== 200) fail(`redeem failed (${red.status}): ${JSON.stringify(red.json)}`);
console.log("✓ test learner has the collection code");

console.log(`
Open ${BASE} and sign in:
  Learner (sees only the 20 collection prompts): ${LEARNER.email} / ${LEARNER.password}
  Admin console (/admin/login):                  ${ADMIN.email} / ${ADMIN.password}
  Collection access code for other test accounts: ${code}`);
