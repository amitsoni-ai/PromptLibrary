import { defineConfig } from "@playwright/test";

// Smoke config. Boots the built app against in-process PGlite (no secrets, no
// Neon). Anonymous requests resolve the preview scope from the committed seed,
// so the API smoke needs no session. Full Library-UI e2e (authenticated) runs in
// the Neon-preview CI job where a seeded session is available.
export default defineConfig({
  testDir: "./e2e",
  timeout: 30_000,
  fullyParallel: true,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 1 : 0,
  reporter: process.env.CI ? "list" : "line",
  use: {
    baseURL: process.env.SMOKE_BASE_URL || "http://localhost:3000",
    trace: "on-first-retry",
  },
  webServer: process.env.SMOKE_BASE_URL
    ? undefined
    : {
        command: "npx next start -p 3000",
        url: "http://localhost:3000/api/health",
        timeout: 120_000,
        reuseExistingServer: !process.env.CI,
        env: {
          DATABASE_URL: "pglite://memory",
          LEGACY_ORIGIN: "http://localhost:8790",
          REVALIDATE_SECRET: "smoke",
        },
      },
});
