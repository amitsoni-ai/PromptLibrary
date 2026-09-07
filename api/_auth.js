// Tiny signed-token helper (HMAC-SHA256 over base64url JSON). No deps.
import { createHmac, timingSafeEqual } from "node:crypto";

const b64url = (buf) => Buffer.from(buf).toString("base64url");
const unb64url = (s) => Buffer.from(s, "base64url");

export function sign(payload, secret, ttlSeconds = 60 * 60 * 12) {
  const body = { ...payload, exp: Math.floor(Date.now() / 1000) + ttlSeconds };
  const p = b64url(JSON.stringify(body));
  const mac = b64url(createHmac("sha256", secret).update(p).digest());
  return `${p}.${mac}`;
}

export function verify(token, secret) {
  if (!token || typeof token !== "string" || !token.includes(".")) return null;
  const [p, mac] = token.split(".");
  const expected = createHmac("sha256", secret).update(p).digest();
  let ok = false;
  try {
    const got = unb64url(mac);
    ok = got.length === expected.length && timingSafeEqual(got, expected);
  } catch { ok = false; }
  if (!ok) return null;
  let body;
  try { body = JSON.parse(unb64url(p).toString("utf8")); } catch { return null; }
  if (!body.exp || body.exp < Math.floor(Date.now() / 1000)) return null;
  return body;
}

export function bearer(req) {
  const h = req.headers.authorization || req.headers.Authorization || "";
  return h.startsWith("Bearer ") ? h.slice(7) : null;
}

export function sessionSecret() {
  return process.env.SESSION_SECRET || process.env.ADMIN_SECRET || "dev-insecure-session-secret";
}
export function adminSecret() {
  return process.env.ADMIN_SECRET || "SYNOTTIC-ADMIN";
}
