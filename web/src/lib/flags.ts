// ─────────────────────────────────────────────────────────────────────────────
// Per-screen feature flags — the rollback switch, one per ported screen so each
// is independently revertable (Phase 1 guardrail: flipping one off must not
// affect another). Currently: `library` (LIBRARY_V2) and `home` (HOME_V2).
//
// Resolution order per screen (first decisive hit wins):
//   1. ?<query>=1 / =0   → explicit per-request override (also drops a sticky
//                          cookie so it survives client-side nav)
//   2. <cookie> cookie    → sticky per-browser override from a prior query hit
//   3. allowlist          → <ENV>_ALLOW = comma list of user ids / org names,
//                          matched against the identity from /api/auth/me
//   4. <ENV> env          → default OFF
//
// Off → the screen's path rewrites to the legacy zone, no redeploy needed.
// This module is import-safe in both middleware (edge) and server components.
// ─────────────────────────────────────────────────────────────────────────────

export type Screen = "library" | "home";

export interface ScreenFlagConfig {
  path: string; // the middleware matcher path this screen owns
  envVar: string;
  allowVar: string;
  cookieName: string;
  queryParam: string;
}

export const SCREENS: Record<Screen, ScreenFlagConfig> = {
  library: {
    path: "/library",
    envVar: "LIBRARY_V2",
    allowVar: "LIBRARY_V2_ALLOW",
    cookieName: "libraryV2",
    queryParam: "v2",
  },
  home: {
    path: "/",
    envVar: "HOME_V2",
    allowVar: "HOME_V2_ALLOW",
    cookieName: "homeV2",
    queryParam: "home",
  },
};

export type Identity = {
  authenticated: boolean;
  userId?: string | null;
  org?: string | null;
};

function truthy(v: string | null | undefined): boolean | null {
  if (v == null) return null;
  const s = String(v).trim().toLowerCase();
  if (["1", "true", "on", "yes"].includes(s)) return true;
  if (["0", "false", "off", "no"].includes(s)) return false;
  return null;
}

export function envDefault(screen: Screen): boolean {
  return truthy(process.env[SCREENS[screen].envVar]) === true;
}

/** Comma-separated allowlist of user ids and/or org names (case-insensitive). */
export function allowlistHit(screen: Screen, identity: Identity | null): boolean {
  const raw = process.env[SCREENS[screen].allowVar];
  if (!raw || !identity || !identity.authenticated) return false;
  const allow = raw
    .split(",")
    .map((s) => s.trim().toLowerCase())
    .filter(Boolean);
  if (!allow.length) return false;
  const uid = String(identity.userId || "").toLowerCase();
  const org = String(identity.org || "").toLowerCase();
  return (!!uid && allow.includes(uid)) || (!!org && allow.includes(org));
}

/**
 * Decide whether a screen's V2 is enabled for this request.
 * `queryOverride` = the raw ?<queryParam>= value, `cookieOverride` = the
 * screen's cookie value.
 */
export function isScreenEnabled(
  screen: Screen,
  opts: {
    queryOverride?: string | null;
    cookieOverride?: string | null;
    identity?: Identity | null;
  },
): boolean {
  const q = truthy(opts.queryOverride);
  if (q !== null) return q;
  const c = truthy(opts.cookieOverride);
  if (c !== null) return c;
  if (allowlistHit(screen, opts.identity ?? null)) return true;
  return envDefault(screen);
}

// ─────────────────────────────────────────────────────────────────────────────
// LANDING_V2 — the public marketing landing page for LOGGED-OUT visitors to `/`.
//
// This is NOT a screen of its own (no matcher, no allowlist): it is a narrow
// sub-branch of the `home` gate in middleware.ts that only ever changes what an
// UNAUTHENTICATED request to `/` sees — the Next marketing page instead of the
// legacy sign-in / access-code gate. It is fully INDEPENDENT of HOME_V2 (which
// governs only the authenticated Home dashboard): the landing renders whether
// HOME_V2 is on or off. Authenticated users are never affected.
//
// Resolution precedence (mirrors the screen flags, minus the allowlist):
//   1. ?landing=1 / =0   → explicit per-request override (drops a sticky
//                          `landingV2` cookie so it survives client-side nav)
//   2. `landingV2` cookie
//   3. LANDING_V2 env      → default OFF  ⇒ today's behaviour, byte-for-byte
// ─────────────────────────────────────────────────────────────────────────────
export const LANDING = {
  envVar: "LANDING_V2",
  cookieName: "landingV2",
  queryParam: "landing",
} as const;

export function isLandingEnabled(opts: {
  queryOverride?: string | null;
  cookieOverride?: string | null;
}): boolean {
  const q = truthy(opts.queryOverride);
  if (q !== null) return q;
  const c = truthy(opts.cookieOverride);
  if (c !== null) return c;
  return truthy(process.env[LANDING.envVar]) === true;
}
