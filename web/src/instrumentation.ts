import * as Sentry from "@sentry/nextjs";

// Loads the right Sentry config per runtime and captures server route errors.
export async function register() {
  if (process.env.NEXT_RUNTIME === "nodejs") {
    await import("../sentry.server.config");
  } else if (process.env.NEXT_RUNTIME === "edge") {
    await import("../sentry.edge.config");
  }
}

// Auto-captures unhandled errors thrown from App Router route handlers / RSC.
export const onRequestError = Sentry.captureRequestError;
