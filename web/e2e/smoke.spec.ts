import { test, expect } from "@playwright/test";

// Library smoke — API level (anonymous → preview scope from the seed) so it runs
// without a session. Asserts the app serves, the health check is green, and the
// ported prompt list returns scoped, framework-badged, paginated data.
test("health endpoint is ok", async ({ request }) => {
  const res = await request.get("/api/health");
  expect(res.ok()).toBeTruthy();
  const body = await res.json();
  expect(body.ok).toBe(true);
});

test("prompt list returns paginated, badged data", async ({ request }) => {
  const res = await request.get("/api/v2/prompts?limit=5");
  expect(res.status()).toBe(200);
  const body = await res.json();
  expect(Array.isArray(body.items)).toBe(true);
  expect(body.items.length).toBeGreaterThan(0);
  expect(body.items.length).toBeLessThanOrEqual(5);
  expect(body.scope.mode).toBe("preview"); // anonymous
  // Response is small (cursor-paginated, not the whole library).
  expect(JSON.stringify(body).length).toBeLessThan(200_000);
  // At least one prompt carries a derived framework level.
  const withLevel = body.items.filter((p: { frameworkLevel: number | null }) => p.frameworkLevel);
  expect(withLevel.length).toBeGreaterThan(0);
});

test("categories return in-scope counts", async ({ request }) => {
  const res = await request.get("/api/v2/categories");
  expect(res.status()).toBe(200);
  const body = await res.json();
  expect(Array.isArray(body.categories)).toBe(true);
  expect(body.total).toBeGreaterThan(0);
});

test("unknown /api/v2 path 404s with the legacy error envelope", async ({ request }) => {
  const res = await request.get("/api/v2/prompts/__nope__");
  expect(res.status()).toBe(404);
  const body = await res.json();
  expect(body.error).toBe("not-found");
});

test("multi-word search AND-matches every word", async ({ request }) => {
  // Regression: an earlier version did a single-substring match, so any
  // multi-word query (e.g. "email marketing") returned 0 even when both words
  // appear in a prompt. Anonymous scope only has 24 preview prompts, so this
  // just asserts the endpoint accepts and narrows on a multi-word query without
  // erroring — the AND-match logic itself is covered by scripts/parity.mjs
  // against the full catalogue.
  const res = await request.get("/api/v2/prompts?q=a+b&limit=5");
  expect(res.status()).toBe(200);
  const body = await res.json();
  expect(Array.isArray(body.items)).toBe(true);
});

test("ids filter restricts the list to exactly those ids (in scope)", async ({ request }) => {
  // Regression: "Saved only" must surface the caller's FULL saved set (scope-
  // checked + paginated), not just whatever page was already loaded client-side.
  const all = await request.get("/api/v2/prompts?limit=3").then((r) => r.json());
  const ids = all.items.map((p: { id: string }) => p.id);
  expect(ids.length).toBeGreaterThan(0);

  const res = await request.get(`/api/v2/prompts?ids=${ids.join(",")}&limit=30`);
  expect(res.status()).toBe(200);
  const body = await res.json();
  expect(body.items.map((p: { id: string }) => p.id).sort()).toEqual([...ids].sort());
  expect(body.total).toBe(ids.length);

  // A sentinel id that matches nothing returns an empty (not error) result.
  const empty = await request
    .get("/api/v2/prompts?ids=__no_such_id__&limit=30")
    .then((r) => r.json());
  expect(empty.items).toEqual([]);
  expect(empty.total).toBe(0);
});

// ── Phase 3: Home ────────────────────────────────────────────────────────────

test("usage endpoint requires auth (anonymous -> 401)", async ({ request }) => {
  // Cookie-keyed (subject = 'user:'+id) — no session, no subject, no data leak.
  const res = await request.get("/api/v2/usage");
  expect(res.status()).toBe(401);
  const body = await res.json();
  expect(body.error).toBe("auth");
});

test("HOME_V2 off (?home=0) rolls the root back to the legacy SPA", async ({ request }) => {
  const res = await request.get("/?home=0", { maxRedirects: 0 });
  expect(res.status()).toBe(200);
  const html = await res.text();
  // Legacy bakes the whole catalogue into the page (#data-prompts); the Next
  // Home page never does. Presence proves the rewrite reached the legacy zone.
  expect(html).toContain('id="data-prompts"');
});

test("HOME_V2 on but anonymous still falls back to legacy (shared-auth gate)", async ({ request }) => {
  const res = await request.get("/?home=1");
  expect(res.status()).toBe(200);
  const html = await res.text();
  expect(html).toContain('id="data-prompts"');
});
