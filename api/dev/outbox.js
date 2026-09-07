// GET /api/dev/outbox        -> recent emails captured locally (any transport)
// GET /api/dev/outbox?to=x@y -> latest for that address, with any token link extracted
//
// DEV ONLY. Returns 404 in production (VERCEL_ENV=production / NODE_ENV=production).
// Outside production every sent message is also copied to an in-memory outbox
// (see _email.js) so you can grab the verify / reset link even if the provider
// rejected delivery (e.g. Resend domain not verified yet).
import { json } from "../_db.js";
import { __outbox } from "../_email.js";

export default async function handler(req, res) {
  const isProd = process.env.VERCEL_ENV === "production" || process.env.NODE_ENV === "production";
  if (isProd) return json(res, 404, { error: "not-found" });
  const to = req.query && req.query.to;
  const list = to ? __outbox.filter((m) => m.to === to) : __outbox;
  const recent = list.slice(-10).reverse().map((m) => {
    const link = (String(m.text || "").match(/https?:\/\/\S+/) || [])[0] || null;
    let token = null;
    try { if (link) token = new URL(link).searchParams.get("token"); } catch {}
    return { to: m.to, subject: m.subject, ts: m.ts, link, token, text: m.text };
  });
  return json(res, 200, { count: recent.length, messages: recent, latest: recent[0] || null });
}
