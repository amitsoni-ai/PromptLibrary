// Local dev: static files + /api/* routed to the serverless handlers.
// Not shipped. Usage: DATABASE_URL=... ADMIN_SECRET=... SESSION_SECRET=... node devserver.mjs
//
// If a .env / .env.local file is present it is loaded automatically, so a plain
// `npm run dev` picks up the same DATABASE_URL / *_SECRET values as production
// (pull them once with `vercel env pull .env.local` — see SHARED-DB.md). Real
// env vars passed on the command line still win; .env wins over .env.local.
import { createServer } from "node:http";
import { readFile, stat } from "node:fs/promises";
import { existsSync } from "node:fs";
import { join, extname, normalize } from "node:path";

for (const f of [".env", ".env.local"]) {
  const p = new URL(f, import.meta.url).pathname;
  if (existsSync(p)) {
    try { process.loadEnvFile(p); } catch (e) { console.warn(`could not load ${f}:`, e.message); }
  }
}

// `vercel env pull` also writes the deployment's system vars (VERCEL_ENV=production,
// VERCEL_URL, TURBO_*, …). Left in place they flip the API into "prod mode" locally
// — Secure-only cookies that a browser won't send over http://localhost, and a 404
// on /api/dev/outbox. Strip them so localhost stays localhost while still sharing
// the production database.
for (const k of Object.keys(process.env)) {
  if (/^(VERCEL|NX_|TURBO_)/.test(k)) delete process.env[k];
}
delete process.env.NODE_ENV;
if (process.env.APP_BASE_URL && !/localhost|127\.0\.0\.1/.test(process.env.APP_BASE_URL)) {
  delete process.env.APP_BASE_URL;   // fall back to the request host (http://localhost:PORT)
}

const ROOT = new URL(".", import.meta.url).pathname;
const PORT = process.env.PORT || 8790;
const MIME = { ".html": "text/html", ".js": "text/javascript", ".css": "text/css",
  ".json": "application/json", ".png": "image/png", ".svg": "image/svg+xml", ".md": "text/plain" };

const server = createServer(async (req, res) => {
  const url = new URL(req.url, "http://localhost");
  res.status = (c) => { res.statusCode = c; return res; };
  res.send = (b) => res.end(b);

  if (url.pathname.startsWith("/api/")) {
    const rel = url.pathname.slice(5).replace(/[^a-zA-Z0-9/_-]/g, "");
    req.query = Object.fromEntries(url.searchParams);
    try {
      let mod;
      try {
        mod = await import("./api/" + rel + ".js");
      } catch (e) {
        // Fall back to a catch-all: /api/auth/login -> ./api/auth/[action].js
        // with req.query.action = "login" (mirrors Vercel dynamic routes).
        const slash = rel.indexOf("/");
        if (e.code === "ERR_MODULE_NOT_FOUND" && slash > 0) {
          req.query.action = rel.slice(slash + 1);
          mod = await import("./api/" + rel.slice(0, slash) + "/[action].js");
        } else throw e;
      }
      await mod.default(req, res);
    } catch (e) {
      console.error("api error", url.pathname, e);
      res.setHeader("content-type", "application/json");
      res.status(e.code === "ERR_MODULE_NOT_FOUND" ? 404 : 500).send(JSON.stringify({ error: "dev-" + (e.code || "err") }));
    }
    return;
  }

  let p = normalize(join(ROOT, url.pathname === "/" ? "index.html" : url.pathname));
  if (!p.startsWith(ROOT)) { res.status(403).send("no"); return; }
  // SPA client routes (/verify-email, /reset-password, /admin/login, …) have no
  // file — mirror vercel.json's rewrites and serve index.html for any
  // extension-less path.
  const looksLikeRoute = !extname(url.pathname);
  try {
    if ((await stat(p)).isDirectory()) p = join(p, "index.html");
    const buf = await readFile(p);
    res.setHeader("content-type", MIME[extname(p)] || "application/octet-stream");
    res.setHeader("cache-control", "no-store");
    res.status(200).send(buf);
  } catch {
    if (looksLikeRoute) {
      try {
        const buf = await readFile(join(ROOT, "index.html"));
        res.setHeader("content-type", "text/html");
        res.setHeader("cache-control", "no-store");
        res.status(200).send(buf);
        return;
      } catch {}
    }
    res.status(404).send("not found");
  }
});
server.listen(PORT, () => console.log(`dev server http://localhost:${PORT}  (DATABASE_URL ${process.env.DATABASE_URL ? "set" : "MISSING"})`));
