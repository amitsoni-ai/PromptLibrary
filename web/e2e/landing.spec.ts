import { test, expect } from "@playwright/test";

// Public marketing landing page (LANDING_V2). Default ON — the smoke webServer
// sets no env, so anonymous `/` already renders the landing; the rollback path
// is exercised with the ?landing=0 override. Anonymous throughout — the landing
// is only ever served to logged-out `/` visitors.

// A phrase unique to the Next landing (the brand line itself also appears in the
// legacy <meta description>, so it can't be used as a discriminator).
const LANDING_MARKER = "A prompt is a way of thinking";

test("default ON + anonymous → `/` renders the marketing landing", async ({ request }) => {
  const res = await request.get("/"); // no override — landing is the default
  expect(res.status()).toBe(200);
  const html = await res.text();

  expect(html).toContain("just use AI. Think with it."); // brand hero line
  expect(html).toContain(LANDING_MARKER); // landing-only
  expect(html).toContain("From prompt to progress"); // the workflow band
  // CTAs, pointing at the legacy auth gate.
  expect(html).toContain("Sign up free");
  expect(html).toContain("Log in");
  expect(html).toContain('href="/legacy"');
  // It is the Next page, NOT the legacy SPA (legacy bakes in #data-prompts).
  expect(html).not.toContain('id="data-prompts"');
});

test("free prompts are copyable, premium prompts are locked", async ({ page }) => {
  await page.goto("/");

  // CTAs are real links to the gate.
  await expect(page.getByRole("link", { name: "Sign up free" }).first()).toHaveAttribute(
    "href",
    "/legacy",
  );
  await expect(page.getByRole("link", { name: "Log in" }).first()).toHaveAttribute("href", "/legacy");

  // Free tier: at least one working copy button.
  expect(await page.getByRole("button", { name: "Copy prompt" }).count()).toBeGreaterThan(0);

  // Premium tier: locked cards with a non-interactive unlock affordance that
  // links to the gate — no prompt-detail / library navigation anywhere.
  await expect(page.getByText("Sign up to unlock").first()).toBeVisible();
  expect(await page.locator('a[href*="/library"]').count()).toBe(0);
  expect(await page.locator('a[href*="/prompt/"]').count()).toBe(0);
});

test("rollback: ?landing=0 + anonymous → `/` proxies the legacy gate", async ({ request }) => {
  const res = await request.get("/?landing=0");
  expect(res.status()).toBe(200);
  const html = await res.text();
  // The rewrite reached the legacy zone (it bakes the catalogue into the page).
  expect(html).toContain('id="data-prompts"');
  // The Next landing did NOT render.
  expect(html).not.toContain(LANDING_MARKER);
});
