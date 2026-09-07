// POST /api/admin/login  { key }  -> { token }   (admin-console token, 12h)
import { json, readBody } from "../_db.js";
import { sign, sessionSecret, adminSecret } from "../_auth.js";
import { timingSafeEqual } from "node:crypto";

function eq(a, b) {
  const x = Buffer.from(String(a)); const y = Buffer.from(String(b));
  return x.length === y.length && timingSafeEqual(x, y);
}

export default async function handler(req, res) {
  if (req.method !== "POST") return json(res, 405, { error: "method" });
  const body = await readBody(req);
  if (!body.key || !eq(body.key.trim(), adminSecret())) {
    return json(res, 401, { error: "bad-key" });
  }
  const token = sign({ t: "a" }, sessionSecret(), 60 * 60 * 12);
  return json(res, 200, { token });
}
