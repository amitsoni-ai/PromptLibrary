import * as Sentry from "@sentry/nextjs";

// No-ops when SENTRY_DSN is unset (local/dev), so nothing is required to run.
Sentry.init({
  dsn: process.env.SENTRY_DSN,
  enabled: !!process.env.SENTRY_DSN,
  tracesSampleRate: 0.1,
  environment: process.env.VERCEL_ENV || process.env.NODE_ENV,
});
