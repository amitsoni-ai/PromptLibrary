// Request/response plumbing shared by the auth routes: cookies, CSRF, client
// IP, body-size guard. Kept dependency-free.
import { randomToken, sha256 } from "./_crypto.js";

export const SESSION_COOKIE = "syn_session";
export const ADMIN_COOKIE = "syn_admin";
export const CSRF_COOKIE = "syn_csrf";

const isProd = () => process.env.VERCEL_ENV === "production" || process.env.NODE_ENV === "production";

export function parseCookies(req) {
  const raw = req.headers.cookie || "";
  const out = {};
  raw.split(/; */).forEach((pair) => {
    if (!pair) return;
    const eq = pair.indexOf("=");
    if (eq < 0) return;
    const k = pair.slice(0, eq).trim();
    let v = pair.slice(eq + 1).trim();
    if (v.startsWith('"') && v.endsWith('"')) v = v.slice(1, -1);
    try { out[k] = decodeURIComponent(v); } catch { out[k] = v; }
  });
  return out;
}

export function serializeCookie(name, value, opts = {}) {
  const o = {
    path: "/",
    httpOnly: true,
    sameSite: "Lax",
    secure: isProd(),
    ...opts,
  };
  let s = `${name}=${encodeURIComponent(value)}`;
  if (o.maxAge != null) s += `; Max-Age=${Math.floor(o.maxAge)}`;
  if (o.expires) s += `; Expires=${o.expires.toUTCString()}`;
  if (o.path) s += `; Path=${o.path}`;
  if (o.domain) s += `; Domain=${o.domain}`;
  if (o.httpOnly) s += "; HttpOnly";
  if (o.sameSite) s += `; SameSite=${o.sameSite}`;
  if (o.secure) s += "; Secure";
  return s;
}

export function appendCookie(res, cookieStr) {
  const prev = res.getHeader("Set-Cookie");
  if (!prev) res.setHeader("Set-Cookie", cookieStr);
  else res.setHeader("Set-Cookie", Array.isArray(prev) ? [...prev, cookieStr] : [prev, cookieStr]);
}

export function setSessionCookie(res, name, value, { maxAge } = {}) {
  appendCookie(res, serializeCookie(name, value, { maxAge, httpOnly: true }));
}
export function clearCookie(res, name) {
  appendCookie(res, serializeCookie(name, "", { maxAge: 0, httpOnly: true }));
}

// Double-submit CSRF: a non-HttpOnly cookie the SPA echoes in `x-csrf-token`.
// Idempotent — if the caller already holds a token we refresh its TTL and hand
// back the SAME value, so a response never invalidates the client's token.
export function issueCsrf(res, req) {
  let token = req ? parseCookies(req)[CSRF_COOKIE] : null;
  if (!token || token.length < 16) token = randomToken(18);
  appendCookie(res, serializeCookie(CSRF_COOKIE, token, { httpOnly: false, maxAge: 60 * 60 * 24 * 7 }));
  return token;
}
export function checkCsrf(req) {
  // Same-origin only API; enforce for state-changing verbs.
  if (["GET", "HEAD", "OPTIONS"].includes(req.method)) return true;
  const cookies = parseCookies(req);
  const cookieTok = cookies[CSRF_COOKIE];
  const headerTok = req.headers["x-csrf-token"] || req.headers["x-xsrf-token"];
  if (!cookieTok || !headerTok) return false;
  return sha256(cookieTok) === sha256(headerTok);
}

export function clientIp(req) {
  const xff = (req.headers["x-forwarded-for"] || "").split(",")[0].trim();
  return xff || req.headers["x-real-ip"] || (req.socket && req.socket.remoteAddress) || "0.0.0.0";
}

export function userAgent(req) {
  return String(req.headers["user-agent"] || "").slice(0, 400);
}

export function methodNotAllowed(res, allow) {
  res.setHeader("Allow", allow.join(", "));
  res.statusCode = 405;
  res.setHeader("content-type", "application/json");
  res.end(JSON.stringify({ error: "method-not-allowed" }));
}
