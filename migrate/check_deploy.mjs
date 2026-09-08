// Post-deploy smoke check for the SPA deep-link rewrites (Bug 1).
//
//   DEPLOY_ORIGIN=https://prompting.synottic.com node migrate/check_deploy.mjs
//
// Asserts that every extension-less auth route is rewritten to the SPA shell
// (200 + text/html + the gate markup) instead of a Vercel edge 404. If any of
// these fail, the deployed project's vercel.json is missing the `rewrites`
// block — see prompt-library/ADMIN-PROMPTS-REPORT.md ("Bug 1").
const ORIGIN = (process.env.DEPLOY_ORIGIN || process.argv[2] || "").replace(/\/$/, "");
if (!ORIGIN) {
  console.error("Set DEPLOY_ORIGIN (e.g. https://prompting.synottic.com)");
  process.exit(2);
}

const ROUTES = [
  "/verify-email?token=probe",
  "/reset-password?token=probe",
  "/forgot-password",
  "/admin/login",
];
const MARKER = 'id="gate-root"';   // present in the built index.html shell

let failed = 0;
for (const path of ROUTES) {
  let status = 0, ct = "", body = "";
  try {
    const r = await fetch(ORIGIN + path, { redirect: "follow", headers: { accept: "text/html" } });
    status = r.status;
    ct = r.headers.get("content-type") || "";
    body = await r.text();
  } catch (e) {
    console.log(`FAIL  ${path}  (fetch error: ${e.message})`);
    failed++;
    continue;
  }
  const ok = status === 200 && /text\/html/i.test(ct) && body.includes(MARKER);
  console.log(`${ok ? "PASS" : "FAIL"}  ${path}  -> ${status} ${ct.split(";")[0]}${ok ? "" : "  (expected 200 text/html with the SPA shell)"}`);
  if (!ok) failed++;
}

// The API itself must still resolve (not be swallowed by the catch-all rewrite).
try {
  const r = await fetch(ORIGIN + "/api/auth/csrf", { headers: { accept: "application/json" } });
  const ctOk = /application\/json/i.test(r.headers.get("content-type") || "");
  console.log(`${ctOk ? "PASS" : "FAIL"}  /api/auth/csrf  -> ${r.status} ${(r.headers.get("content-type") || "").split(";")[0]}`);
  if (!ctOk) failed++;
} catch (e) {
  console.log(`FAIL  /api/auth/csrf  (fetch error: ${e.message})`);
  failed++;
}

console.log(failed ? `\n${failed} check(s) failed` : "\nall deploy checks passed");
process.exit(failed ? 1 : 0);
