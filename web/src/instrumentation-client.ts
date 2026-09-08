import * as Sentry from "@sentry/nextjs";

// Client-side Sentry. No-op unless NEXT_PUBLIC_SENTRY_DSN is set. The DSN is the
// only Sentry value that may appear in the client bundle (it is not a secret).
Sentry.init({
  dsn: process.env.NEXT_PUBLIC_SENTRY_DSN,
  enabled: !!process.env.NEXT_PUBLIC_SENTRY_DSN,
  tracesSampleRate: 0.1,
  environment: process.env.NEXT_PUBLIC_VERCEL_ENV || process.env.NODE_ENV,
});
