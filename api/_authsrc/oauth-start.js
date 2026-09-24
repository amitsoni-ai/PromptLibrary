// GET /api/auth/oauth-start?provider=google|microsoft
// -> 302 to the provider's consent screen. Stores state + PKCE verifier + nonce
// in a short-lived HttpOnly cookie that oauth-callback checks.
// GET /api/auth/oauth-start?provider=…&link=1
// -> same, but the callback attaches the account to the SIGNED-IN learner
//    (Account settings → "Connect Google").
// GET /api/auth/oauth-start            (no provider)
// -> 200 { providers: ["google", …] }   the providers this deployment has keys for
import { json } from "../_db.js";
import { appendCookie, serializeCookie } from "../_http.js";
import { randomToken } from "../_crypto.js";
import { PROVIDERS, providerEnabled, enabledProviders, pkceChallenge } from "../_oauth.js";
import { appBaseUrl } from "../_email.js";

export const OAUTH_COOKIE = "syn_oauth";

export default async function handler(req, res) {
  if (req.method !== "GET") return json(res, 405, { error: "method-not-allowed" });
  const key = String((req.query && req.query.provider) || "").toLowerCase();
  if (!key) return json(res, 200, { providers: enabledProviders() });
  const link = String((req.query && req.query.link) || "") === "1";
  if (!providerEnabled(key)) return redirect(res, link ? "/?account=unavailable" : "/login?oauth_error=unavailable");

  const p = PROVIDERS[key];
  const state = randomToken(18);
  const verifier = randomToken(48);
  const nonce = randomToken(18);
  const payload = Buffer.from(JSON.stringify({ p: key, s: state, v: verifier, n: nonce, l: link ? 1 : 0 })).toString("base64url");
  // Lax so the cookie comes back on the provider's top-level redirect to us.
  appendCookie(res, serializeCookie(OAUTH_COOKIE, payload, { httpOnly: true, sameSite: "Lax", maxAge: 600, path: "/api/auth" }));

  const params = new URLSearchParams({
    client_id: p.clientId(),
    response_type: "code",
    redirect_uri: `${appBaseUrl(req)}/api/auth/oauth-callback`,
    scope: "openid email profile",
    state,
    nonce,
    code_challenge: pkceChallenge(verifier),
    code_challenge_method: "S256",
    ...p.extraAuthParams,
  });
  return redirect(res, `${p.authUrl()}?${params}`);
}

export function redirect(res, location) {
  res.statusCode = 302;
  res.setHeader("Location", location);
  res.setHeader("Cache-Control", "no-store");
  res.end();
}
