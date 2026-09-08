import type { NextConfig } from "next";

// ─────────────────────────────────────────────────────────────────────────────
// SINGLE ORIGIN (strangler). This Next app owns the public domain. The legacy
// zone (the untouched index.html + /api/** deployment) is proxied same-origin
// via rewrites so the syn_session cookie and CSRF double-submit keep working
// with no cross-origin. Set LEGACY_ORIGIN to the legacy zone's URL.
//   - prod:  https://<legacy-project>.vercel.app  (no public domain of its own)
//   - local: http://localhost:8790  (node migrate/devserver_pglite.mjs)
//
// IMPORTANT ordering: /api/v2/** is served by THIS app (App Router) and must NOT
// be proxied. Next matches its own routes before `rewrites.afterFiles`, and we
// additionally scope the proxy rule with a negative lookahead for `v2/`.
// ─────────────────────────────────────────────────────────────────────────────
const LEGACY_ORIGIN = process.env.LEGACY_ORIGIN || "http://localhost:8790";

// Next's DEV client runtime (React Refresh / HMR, dev source maps) evaluates
// code via eval() and requires 'unsafe-eval' in script-src; the PRODUCTION
// client bundle does not use eval and must NOT get this relaxation.
const isDev = process.env.NODE_ENV !== "production";

const CSP = [
  "default-src 'self'",
  // Next injects inline hydration data; allow self + inline for styles/scripts.
  `script-src 'self' 'unsafe-inline'${isDev ? " 'unsafe-eval'" : ""} https://va.vercel-scripts.com`,
  "style-src 'self' 'unsafe-inline' https://fonts.googleapis.com",
  "font-src 'self' https://fonts.gstatic.com data:",
  "img-src 'self' data: blob:",
  `connect-src 'self' ${LEGACY_ORIGIN} https://*.sentry.io https://va.vercel-scripts.com${isDev ? " ws://localhost:* http://localhost:*" : ""}`,
  "frame-ancestors 'none'",
  "base-uri 'self'",
  "form-action 'self'",
].join("; ");

const nextConfig: NextConfig = {
  reactStrictMode: true,
  poweredByHeader: false,
  // web/ has its own lockfile; pin tracing to it (repo root also has one).
  outputFileTracingRoot: process.cwd(),
  // PGlite ships WASM + loads it via fs; keep it un-bundled so the dev/CI
  // pglite:// path works. Neon (prod) is unaffected.
  serverExternalPackages: ["@electric-sql/pglite"],
  async rewrites() {
    return {
      // `beforeFiles` runs before Next's own pages/routes — keep it empty so the
      // App Router owns /api/v2/** and /library/**.
      beforeFiles: [],
      afterFiles: [
        // Legacy API — everything under /api EXCEPT our new /api/v2/** and the
        // local health check — proxies to the legacy zone, unchanged.
        {
          source: "/api/:path((?!v2/|health).*)",
          destination: `${LEGACY_ORIGIN}/api/:path`,
        },
        // Rollback + non-Library legacy screens.
        { source: "/legacy", destination: `${LEGACY_ORIGIN}/` },
        { source: "/legacy/:path*", destination: `${LEGACY_ORIGIN}/:path*` },
      ],
      // Anything this app doesn't render (Home/Learn/Practice/Me/Admin, the
      // legacy SPA's own assets and client routes) falls through to legacy.
      fallback: [
        { source: "/:path*", destination: `${LEGACY_ORIGIN}/:path*` },
      ],
    };
  },
  async headers() {
    return [
      {
        source: "/:path*",
        headers: [
          { key: "Content-Security-Policy", value: CSP },
          { key: "X-Content-Type-Options", value: "nosniff" },
          { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
          { key: "X-Frame-Options", value: "DENY" },
        ],
      },
    ];
  },
};

export default nextConfig;
