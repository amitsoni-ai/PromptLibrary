import { NextRequest, NextResponse } from "next/server";
import { SCREENS, isScreenEnabled, isLandingEnabled, LANDING, type Identity, type Screen } from "@/lib/flags";

// ─────────────────────────────────────────────────────────────────────────────
// Guards the ported V2 screens, each behind its own flag (SCREENS in lib/flags):
//   • `/`                → home        (HOME_V2)
//   • `/library`, `/library/**` → library (LIBRARY_V2)
//
//   • Flag OFF  → rewrite to the legacy zone at the SAME path. No redeploy.
//   • Flag ON but caller not authenticated (401/anonymous at /api/auth/me)
//               → rewrite to legacy (which offers the sign-in / access-code gate).
//   • Flag ON + authenticated → serve the Next screen.
// Auth is READ-ONLY here: we call the legacy /api/auth/me, forwarding cookies.
// Zero changes to auth code.
//
// LANDING_V2 (see lib/flags.ts) adds exactly ONE new branch, on `/` only: when
// the caller is UNAUTHENTICATED and LANDING_V2 is on (the DEFAULT), `/` is served
// by Next (the public marketing landing page) instead of being rewritten to the
// legacy gate. Independent of HOME_V2; authenticated `/` is unchanged in every
// state. Set LANDING_V2=off to roll back (anonymous `/` then rewrites to legacy,
// byte-for-byte the pre-landing behaviour); or delete `landing*`, `serveLanding`,
// and the two `serveLanding() ??` prefixes to remove it entirely.
// ─────────────────────────────────────────────────────────────────────────────

const LEGACY_ORIGIN = process.env.LEGACY_ORIGIN || "http://localhost:8790";

export const config = {
  // "/" matches ONLY the exact root (not a prefix) — every other top-level path
  // (e.g. /verify-email, /forgot-password, legacy assets) must keep proxying
  // through next.config's `fallback` rule untouched, not through this screen gate.
  matcher: ["/", "/library", "/library/:path*"],
};

function screenFor(pathname: string): Screen {
  return pathname === "/" ? "home" : "library";
}

async function fetchIdentity(req: NextRequest): Promise<Identity> {
  try {
    const res = await fetch(`${LEGACY_ORIGIN}/api/auth/me`, {
      headers: { cookie: req.headers.get("cookie") || "" },
      // Never cache an auth decision.
      cache: "no-store",
    });
    if (!res.ok) return { authenticated: false };
    const body = (await res.json()) as {
      authenticated?: boolean;
      user?: { id?: string; organization?: string } | null;
      access?: { org?: string } | null;
    };
    return {
      authenticated: !!body.authenticated,
      userId: body.user?.id ?? null,
      org: body.user?.organization ?? body.access?.org ?? null,
    };
  } catch {
    return { authenticated: false };
  }
}

export async function middleware(req: NextRequest) {
  const url = req.nextUrl;
  const screen = screenFor(url.pathname);
  const cfg = SCREENS[screen];

  const queryOverride = url.searchParams.get(cfg.queryParam);
  const cookieOverride = req.cookies.get(cfg.cookieName)?.value ?? null;

  // LANDING_V2 — resolved on the home screen only. Its own ?landing= / cookie /
  // env, independent of HOME_V2's ?home= / homeV2 / HOME_V2.
  const landingQuery = screen === "home" ? url.searchParams.get(LANDING.queryParam) : null;
  const landingCookie =
    screen === "home" ? req.cookies.get(LANDING.cookieName)?.value ?? null : null;
  const landingOn =
    screen === "home" &&
    isLandingEnabled({ queryOverride: landingQuery, cookieOverride: landingCookie });

  // Resolve identity only when it can actually change the outcome (allowlist or
  // the on+authenticated gate). Cheap short-circuits first.
  let identity: Identity | null = null;
  const needsIdentity = queryOverride == null && cookieOverride == null;
  if (needsIdentity && process.env[cfg.allowVar]) {
    identity = await fetchIdentity(req);
  }

  const enabled = isScreenEnabled(screen, { queryOverride, cookieOverride, identity });

  // Persist an explicit ?<queryParam>= override as a sticky cookie (both the
  // screen flag and, on `/`, the landing flag).
  const stick = (res: NextResponse) => {
    if (queryOverride != null) {
      res.cookies.set(cfg.cookieName, /^(1|true|on|yes)$/i.test(queryOverride) ? "1" : "0", {
        path: "/",
        sameSite: "lax",
        maxAge: 60 * 60 * 24 * 30,
      });
    }
    if (landingQuery != null) {
      res.cookies.set(LANDING.cookieName, /^(1|true|on|yes)$/i.test(landingQuery) ? "1" : "0", {
        path: "/",
        sameSite: "lax",
        maxAge: 60 * 60 * 24 * 30,
      });
    }
    return res;
  };

  // Rollback / fallback: proxy the SAME path to the legacy zone, which serves the
  // legacy SPA (index.html) for any non-/api path. No redeploy needed.
  const toLegacy = () =>
    stick(NextResponse.rewrite(new URL(url.pathname + url.search, LEGACY_ORIGIN)));

  // The one new branch: serve the Next marketing landing page to an ANONYMOUS
  // `/` visitor when LANDING_V2 is on. Returns null (→ caller falls through to
  // the unchanged legacy rewrite) whenever the landing does not apply, incl. for
  // any authenticated caller.
  const serveLanding = async (): Promise<NextResponse | null> => {
    if (!landingOn) return null;
    if (!identity) identity = await fetchIdentity(req);
    return identity.authenticated ? null : stick(NextResponse.next());
  };

  if (!enabled) return (await serveLanding()) ?? toLegacy();

  // Flag on — require a logged-in identity; fall back to legacy gate on 401
  // (or, for `/`, to the marketing landing when LANDING_V2 is on).
  if (!identity) identity = await fetchIdentity(req);
  if (!identity.authenticated) return (await serveLanding()) ?? toLegacy();

  return stick(NextResponse.next());
}
