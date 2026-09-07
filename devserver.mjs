// Local dev: static files + /api/* routed to the serverless handlers.
// Not shipped. Usage: DATABASE_URL=... ADMIN_SECRET=... SESSION_SECRET=... node _devserver.mjs
import { createServer } from "node:http";
import { readFile, stat } from "node:fs/promises";
import { join, extname, normalize } from "node:path";

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
    try {
      const mod = await import("./api/" + rel + ".js");
      req.query = Object.fromEntries(url.searchParams);
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
  try {
    if ((await stat(p)).isDirectory()) p = join(p, "index.html");
    const buf = await readFile(p);
    res.setHeader("content-type", MIME[extname(p)] || "application/octet-stream");
    res.setHeader("cache-control", "no-store");
    res.status(200).send(buf);
  } catch { res.status(404).send("not found"); }
});
server.listen(PORT, () => console.log(`dev server http://localhost:${PORT}  (DATABASE_URL ${process.env.DATABASE_URL ? "set" : "MISSING"})`));
