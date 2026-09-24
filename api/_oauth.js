// Social sign-in (Google / Microsoft) — OpenID Connect authorization-code flow
// with PKCE. Provider config + the lazy `user_identities` schema. A provider is
// "enabled" only when its client id + secret env vars are set, so the buttons
// never show for a half-configured deployment.
//
//   GOOGLE_CLIENT_ID / GOOGLE_CLIENT_SECRET
//   MICROSOFT_CLIENT_ID / MICROSOFT_CLIENT_SECRET / MICROSOFT_TENANT (default "common")
//
// Redirect URI to register with each provider:
//   <APP_BASE_URL>/api/auth/oauth-callback
import { createHash } from "node:crypto";

// Personal Microsoft accounts (outlook.com, hotmail.com, live.com) all sign in
// through this tenant; Microsoft owns and verifies those mailboxes.
const MSA_TENANT = "9188040d-6c67-4c5b-b112-36a304b66dad";

export const PROVIDERS = {
  google: {
    label: "Google",
    clientId: () => process.env.GOOGLE_CLIENT_ID,
    clientSecret: () => process.env.GOOGLE_CLIENT_SECRET,
    authUrl: () => "https://accounts.google.com/o/oauth2/v2/auth",
    tokenUrl: () => "https://oauth2.googleapis.com/token",
    extraAuthParams: { prompt: "select_account" },
    // Google only sets email_verified=true for addresses it has confirmed.
    emailVerified: (c) => c.email_verified === true || c.email_verified === "true",
  },
  microsoft: {
    label: "Microsoft",
    clientId: () => process.env.MICROSOFT_CLIENT_ID,
    clientSecret: () => process.env.MICROSOFT_CLIENT_SECRET,
    authUrl: () => `https://login.microsoftonline.com/${msTenant()}/oauth2/v2.0/authorize`,
    tokenUrl: () => `https://login.microsoftonline.com/${msTenant()}/oauth2/v2.0/token`,
    extraAuthParams: { prompt: "select_account" },
    // A work/school tenant admin can put any address in the `email` claim, so
    // only trust it for personal accounts or when Microsoft marks the domain
    // as verified (optional claim `xms_edov`). Unverified addresses still get
    // an account, but must confirm by email and are never linked to an
    // existing account.
    emailVerified: (c) => c.tid === MSA_TENANT || c.xms_edov === true || c.xms_edov === "1" || c.xms_edov === 1,
  },
};

function msTenant() {
  return (process.env.MICROSOFT_TENANT || "common").replace(/[^a-zA-Z0-9.-]/g, "") || "common";
}

export function providerEnabled(key) {
  const p = PROVIDERS[key];
  return !!(p && p.clientId() && p.clientSecret());
}
export function enabledProviders() {
  return Object.keys(PROVIDERS).filter(providerEnabled);
}

export function pkceChallenge(verifier) {
  return createHash("sha256").update(verifier).digest("base64url");
}

// The ID token comes straight from the provider's token endpoint over TLS,
// authenticated with our client secret, so its signature need not be checked
// (OIDC Core §3.1.3.7). We still check audience and nonce.
export function decodeIdToken(idToken) {
  const part = String(idToken || "").split(".")[1];
  if (!part) return null;
  try { return JSON.parse(Buffer.from(part, "base64url").toString("utf8")); } catch { return null; }
}

// Create `user_identities` on first use so a deploy works before anyone runs
// migrate/run_v6.mjs. Idempotent; runs once per warm function instance.
let schemaReady = null;
export function ensureIdentitySchema(sql) {
  if (!schemaReady) {
    schemaReady = (async () => {
      const stmts = IDENTITY_SCHEMA.split(/;\s*(?:\n|$)/).map((s) => s.trim()).filter(Boolean);
      for (const s of stmts) await sql(s);
    })().catch((e) => { schemaReady = null; throw e; });
  }
  return schemaReady;
}
// Same statements as migrate/schema_v6.sql (migrate/ is not deployed).
const IDENTITY_SCHEMA = `
create table if not exists user_identities (
  id text primary key,
  user_id text not null references users(id) on delete cascade,
  provider text not null,
  subject text not null,
  email text,
  created_at timestamptz not null default now(),
  last_login_at timestamptz,
  unique (provider, subject)
);
create index if not exists user_identities_user_idx on user_identities (user_id);
`;
