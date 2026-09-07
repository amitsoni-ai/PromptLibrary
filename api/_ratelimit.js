// DB-backed fixed-window rate limiter. One row per bucket; the window resets
// lazily on the first hit after it elapses. Good enough for auth endpoints on
// serverless (no shared memory) without a Redis dependency.
import { clientIp } from "./_http.js";

// action -> { limit, windowSec }
const RULES = {
  signup:            { limit: 5,  windowSec: 3600 },
  login:             { limit: 10, windowSec: 900 },
  login_email:       { limit: 8,  windowSec: 900 },   // per-account, feeds lockout
  verify:            { limit: 20, windowSec: 900 },
  resend_verify:     { limit: 4,  windowSec: 3600 },
  forgot_password:   { limit: 5,  windowSec: 3600 },
  reset_password:    { limit: 10, windowSec: 3600 },
  redeem_code:       { limit: 15, windowSec: 3600 },
  admin_login:       { limit: 8,  windowSec: 900 },
  default:           { limit: 60, windowSec: 900 },
};

// Returns { ok, remaining, retryAfter }. Fails OPEN if the DB errors — a limiter
// outage must not lock everyone out.
export async function rateLimit(sql, action, key) {
  const rule = RULES[action] || RULES.default;
  const bucket = `${action}:${key}`;
  try {
    const rows = await sql`
      insert into rate_limits (bucket, count, window_start)
      values (${bucket}, 1, now())
      on conflict (bucket) do update set
        count = case
          when rate_limits.window_start < now() - (${rule.windowSec} || ' seconds')::interval then 1
          else rate_limits.count + 1 end,
        window_start = case
          when rate_limits.window_start < now() - (${rule.windowSec} || ' seconds')::interval then now()
          else rate_limits.window_start end
      returning count, window_start`;
    const { count, window_start } = rows[0];
    const resetAt = new Date(new Date(window_start).getTime() + rule.windowSec * 1000);
    const retryAfter = Math.max(1, Math.ceil((resetAt - Date.now()) / 1000));
    return { ok: count <= rule.limit, remaining: Math.max(0, rule.limit - count), retryAfter, limit: rule.limit };
  } catch {
    return { ok: true, remaining: rule.limit, retryAfter: 0, limit: rule.limit };
  }
}

export function ipKey(req) { return "ip:" + clientIp(req); }
export function emailKey(email) { return "email:" + String(email || "").toLowerCase().trim(); }

export function tooMany(res, json, retryAfter) {
  res.setHeader("Retry-After", String(retryAfter || 60));
  return json(res, 429, { error: "rate-limited", retryAfter: retryAfter || 60,
    message: "Too many attempts. Please wait a moment and try again." });
}
