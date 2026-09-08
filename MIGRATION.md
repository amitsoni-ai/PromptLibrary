# Synottic Prompt Library — Next.js migration (Phase 1 + 2 + 3 slice 1)

A **strangler** migration. A new Next.js app (`web/`) takes over **only the Library
screen**, behind the `LIBRARY_V2` flag, at the **same public origin** as the legacy app
so the `syn_session` cookie is shared. The legacy single-file SPA (`index.html`) + serverless
API (`api/**`) + Neon are **untouched** and instantly restorable. **Auth is not rewritten.**

---

## 1. Architecture & ADRs

| # | Decision | Why |
|---|---|---|
| **ADR-1** | **Strangler at the screen level.** Only the Library moves to React; Home/Learn/Practice/Me/Admin stay on the legacy SPA. | Smallest blast radius; the highest-traffic, worst-scaling screen (7.9 MB baked catalogue) goes first. |
| **ADR-2** | **Two Vercel projects, one public domain (rewrites).** The existing project is the untouched **legacy zone**; a new project rooted at `web/` owns the domain and same-origin-proxies `/api/**` + `/legacy` to legacy via `next.config` rewrites. | Legacy files literally never move → strongest guardrail compliance. Cookies are set with no `Domain` (`api/_http.js`) so they bind to the public host → shared, no cross-origin. `web/` keeps its own `package.json`. |
| **ADR-3** | **Ported reads at `/api/v2/**`; legacy owns `/api/**`.** | Legacy stays byte-for-byte; V2 bodies mirror the legacy envelope where an equivalent exists. |
| **ADR-4** | **Drizzle introspects only** (`drizzle-kit pull`); the only DB change is additive `migrate/schema_v4.sql` (indexes). | Zero schema drift; the DB is owned by `migrate/*.sql`. |
| **ADR-5** | **Cached in-memory catalogue** (module cache + 300 s TTL), filtered/paginated in JS. | Mirrors the legacy client's `scopedLibrary` semantics exactly, but server-side + cursor-paginated (small payloads). `unstable_cache` can't hold the 7.7 MB set (2 MB cap). SQL/pg_trgm is the documented scale path. |
| **ADR-6** | **Shared auth via HTTP.** `/api/v2` + middleware read identity by calling legacy `/api/auth/me` (forwarding cookies). | No import of / change to auth code; the single `getUserAccess` decision stays authoritative. |

**Stack:** Next.js 15 (App Router, RSC) · React 19 · TypeScript strict · Tailwind 3 (tokens from
`src/part_head.html`) · Drizzle (neon-http; PGlite for dev/CI) · Zod contracts · React Query · Sentry ·
Vercel Speed Insights.

## 2. Routing table (public origin)

| Path | Served by | Notes |
|---|---|---|
| `/api/**` (not `v2`/`health`) | Legacy zone (proxied) | unchanged functions |
| `/api/v2/**` | Next (`web/app/api/v2`) | ported reads + `state`/`activity` writes |
| `/api/health` | Next | DB ping |
| `/library`, `/library/**` | Next **if** flag on + authenticated; else `/legacy` | the strangler seam |
| `/legacy`, `/legacy/**` | Legacy zone (proxied) | rollback + non-Library screens |
| everything else | Legacy zone (proxied, `next.config` `fallback`) | Home/Learn/Practice/Me/Admin SPA |

`LEGACY_ORIGIN` env points Next at the legacy zone (prod: the legacy project's URL; local:
`http://localhost:8790`).

### Ported endpoints (`web/app/api/v2/`)
- `GET /prompts` — cursor-paginated, searchable, **scope-filtered** list (card projection).
- `GET /prompts/[id]` — single prompt (scope-checked; 404 if out of scope).
- `GET /categories` — categories with live in-scope counts.
- `GET /state?keys=favorites` · `PUT /state` — **cookie-keyed** learner state (`subject='user:'+id`,
  reusing `learner_state`; the AUTH.md "next step", additive).
- `POST /activity` — cookie-keyed event write (same `activity` table + event allow-list).
- `POST /revalidate` — secret-guarded catalogue cache bust.

Contracts (request **and** response) are Zod schemas in `web/src/contracts/`; the typed client
(`web/src/lib/api-client.ts`) validates both directions and throws `ApiError` carrying the legacy
`{ error }` envelope.

## 3. How auth is shared (and untouched)

- The V2 middleware and every `/api/v2` handler call legacy **`/api/auth/me`** (same origin,
  forwarding the `syn_session` cookie) → the `getUserAccess` decision. The effective entitlement is
  read from `access.access.{scopeType,categoryIds,promptIds,programIds}` (`web/src/server/auth.ts`).
- Writes (`PUT /state`, `POST /activity`) enforce the existing **double-submit CSRF**: the `syn_csrf`
  cookie must equal the `x-csrf-token` header (`web/src/server/http.ts#csrfOk`), matching
  `api/_http.js#checkCsrf`.
- **Verified end-to-end:** signing in through the proxied `/api/auth/login` sets `syn_session` on the
  Next origin; `/api/v2/prompts` then resolves the **full** library (3,567) for a `general` user, and a
  request with no CSRF token is rejected `403`.
- **Zero changes** under `api/auth/**`, `api/_access.js`, `api/_session.js`, `api/_crypto.js`.

## 4. Feature flag & rollback

`web/src/lib/flags.ts` resolves `LIBRARY_V2` — first decisive hit wins:
1. `?v2=1` / `?v2=0` (also sets a sticky `libraryV2` cookie)
2. `libraryV2` cookie
3. allowlist `LIBRARY_V2_ALLOW` (comma list of user ids / org names, matched against `/api/auth/me`)
4. `LIBRARY_V2` env (**default off**)

Enforced in `web/middleware.ts` on `/library` only:
- **off** → rewrite to `/legacy` (legacy SPA), **no redeploy**.
- **on** but unauthenticated → rewrite to `/legacy` (legacy sign-in / access-code gate).
- **on** + authenticated → Next Library.

**Rollback**
- *Instant:* set `LIBRARY_V2=off` (env) or clear the allowlist → `/library` serves legacy. No redeploy.
- *Full:* revert `web/next.config.ts` + `web/vercel.json` rewrites to legacy-only, or repoint DNS to the
  legacy zone. Every phase reverts independently.

## 5. Data source of truth

Postgres (`prompts` table) is **canonical**. `web/scripts/verify-prompts.mjs` exports the canonical
set to `web/seed/prompts.json` (also the no-DB catalogue fallback) and, with `DATABASE_URL` set, checks
the table matches the `#data-prompts` block by **row count + id checksum**. Framework level is derived
(never stored) via `web/src/lib/framework.ts`, a 1:1 port of `src/part_framework.js` (validated against
all 3,567 rows by `scripts/parity.mjs`). `data_blocks.html` / `build.py` / `run.mjs` remain for the
legacy app but are no longer the write path (Phase 3 deletes them).

## 6. Run locally

```bash
# 1. Legacy zone (provides /api + /api/auth/me), in-process PGlite, emails to console:
cd prompt-library
EMAIL_TRANSPORT=console node migrate/devserver_pglite.mjs      # http://localhost:8790

# 2. Next app (proxies /api + /legacy to the legacy zone):
cd web && npm install
cp .env.example .env.local        # set LEGACY_ORIGIN=http://localhost:8790
LIBRARY_V2=on DATABASE_URL=pglite:///tmp/web-pglite npm run dev # http://localhost:3000
```
Sign in at `/legacy` (or POST the proxied `/api/auth/login`) to get a session on the Next origin, then
open `/library`. For local `state`/`activity`, give `web` a PGlite file with the schema applied
(`node -e "…PGlite('/tmp/web-pglite').exec(schema.sql)"`); in prod `web` and legacy share the **same
Neon** `DATABASE_URL`, so no such step is needed.

### Run CI checks locally
```bash
cd web
npm run typecheck && npm run lint && npm run build
node scripts/verify-prompts.mjs      # export + (with DATABASE_URL) verify vs DB
node scripts/parity.mjs              # catalogue integrity + framework derivation
npm run db:guard                     # no generated Drizzle migrations
CI=1 npm run test:e2e               # Playwright Library API smoke
cd .. && python3 src/build.py && node migrate/authtest.mjs   # legacy intact
```

## 7. CI (`.github/workflows/ci.yml`)

Jobs: **web** (typecheck, lint, build, seed-drift check, `db:guard`, parity, Playwright smoke on
PGlite) · **legacy** (`python3 src/build.py`, `node migrate/authtest.mjs`) · **guardrails** (`git diff`
proves no changes under `api/auth/**`, `_access.js`, `_session.js`, `_crypto.js`, `migrate/schema{,_v2,_v3}.sql`,
`index.html`, `src/part_*`, `src/build.py`, `devserver*.mjs`) · **neon-preview** (opt-in; activates when
`NEON_API_KEY` is set for a per-PR Neon branch + full authenticated Library e2e).

## 8. Drizzle (introspect only)

`web/src/db/schema.ts` is the **destination of `npm run db:pull`** against a Neon **dev** branch — never
generate/push/migrate. `scripts/guard-no-migrations.mjs` (CI) fails if generated migrations appear.
`migrate/schema_v4.sql` is the **only** permitted DB change: additive, idempotent pg_trgm indexes,
**reviewed before apply**, never run by CI/build. The committed `schema.ts` currently transcribes the
read-path tables (prompts / learner_state / activity) verbatim from the SQL DDL; running `db:pull`
regenerates the complete file.

> **Action for the maintainer:** run `DATABASE_URL=<neon-dev-branch> npm run db:pull` to replace
> `schema.ts` with the full introspection, and review + apply `migrate/schema_v4.sql` on a dev branch
> before prod.

## 9. Observability & security

- **Sentry** client + server + edge (`sentry.*.config.ts`, `src/instrumentation.ts` with
  `onRequestError`). No-op unless `SENTRY_DSN` / `NEXT_PUBLIC_SENTRY_DSN` set. Server test:
  `SENTRY_DEBUG=1` + `GET /api/debug/sentry`. Client test: call `Sentry.captureException` from a page.
- **`/api/health`** — DB ping. **Speed Insights** wired in the root layout.
- **Request id** (`x-request-id`) propagated + one structured log line per request (`server/http.ts`).
- **CSP** + `X-Content-Type-Options` / `X-Frame-Options` / `Referrer-Policy` in `next.config.ts`. No
  secrets in the client bundle (only `NEXT_PUBLIC_*`; the Sentry DSN is not a secret).
- **XSS:** prompt text renders as escaped React children / in `<pre>` — no `dangerouslySetInnerHTML`.

## 10. Performance budgets

| Metric | Budget | Status |
|---|---|---|
| Library list response | < 200 KB | ✅ cursor-paginated (30/page card projection) |
| API p95 (dev branch) | < 300 ms | ✅ ~205 ms warm (module cache); first load warms the catalogue |
| Library route First Load JS | < 200 KB | ✅ ~198 KB (Sentry client ~65 KB; lazy-load it in Phase 3 for headroom) |
| LCP | < 2.5 s | RSC first paint; measure via Speed Insights on the preview |

## 11. Phase 3 backlog

1. ~~Port Home~~ — **done, slice 1** (§12 below). Learn / Practice / Me / Admin remain.
2. Move prompt data fully into the DB as the sole write path; delete `src/data_blocks.html`,
   `src/build.py`, `migrate/run.mjs`.
3. Retire `index.html` and the `/legacy` proxy; collapse to a single project if desired.
4. A separate, dedicated **auth-layer** phase (only after the UI is fully migrated).
5. Server-side scope fidelity: reproduce the classic access-code **program** curriculum rules
   (`programPromptIds`) server-side (currently full/function/collection are exact; program approximates
   via categories only — classic Bearer program users fall back to legacy today).
6. Move search to SQL ILIKE / pg_trgm once `schema_v4` is applied and the catalogue outgrows memory.

## 12. Phase 3, slice 1 — Home

Ported the app's front door — `/` itself (not a side path), gated exactly like `/library`:
- **New, independent flag `HOME_V2`** (own env/cookie/`?home=`/allowlist — `web/src/lib/flags.ts`'s
  `SCREENS` map). Flipping `HOME_V2` off does **not** affect `LIBRARY_V2` and vice versa — verified live
  (rolling Home back to legacy left `/library` serving 3,567 prompts unaffected).
- **New app shell** (`web/src/components/AppShell.tsx` + `NavSidebar.tsx`) wraps every Next-rendered
  page: Home/Library link to the real Next routes; Learn/Practice/Me link to `/legacy` (those screens
  have no deep-linkable legacy URL — it's a client `STATE.view` switch with no distinct route — so this
  is one honest extra click, not a broken link).
- **`GET /api/v2/usage`** (`server/usage.ts`) — aggregates `activity` rows (only `opened`/`copied`/
  `tested`, matching `src/part_app_1.js#recordUsage`) into `{ counts, recent }`, subject-keyed like
  `/api/v2/state`. Called server-side directly from `server/home.ts` for the RSC composition (no public
  round-trip needed).
- **`recommendedForYou`** ported 1:1 (`web/src/lib/recommend.ts`, weights/bonuses/penalty/jitter
  unchanged from `src/part_app_3.js:238`), with one documented simplification: legacy derives a
  function's bonus-category set from a static client-side `FUNCTIONS` catalogue as a fallback mirror of
  what the backend already resolved onto the entitlement; we reuse `scope.categories` (the
  already-resolved set from `getUserAccess`) directly instead of re-porting that catalogue.
- **Hero search** (`features/home/HomeSearch.tsx`) reuses the same `/api/v2/prompts` endpoint Library
  uses — verified identical result counts for the same query ("email marketing" → 122, both screens).
- **Deferred, not silently dropped**: the "Continue" card and "Program companion prompt" are
  Learn/Practice/program-model-coupled and ship with that port instead.

## Appendix — verified in this migration

- Single origin: login via proxied `/api/auth/login` → session on the Next origin → `/api/v2/prompts`
  resolves **full** library (3,567), `/api/v2/categories` 28 categories.
- Scope: anonymous → **preview** (24); authenticated `general` → **full**. Framework badges
  (e.g. `L3 · R-C-G-T-C-E-F-V-V`) match the legacy derivation.
- `state` favorites persist (`subject='user:…'`); `activity` → 202; missing CSRF → 403.
- Library UI (landing + detail) renders in light **and** dark. Build/typecheck/lint/e2e all green.
- **Fixed during live-browser testing** (all covered by `e2e/smoke.spec.ts` + `scripts/parity.mjs` now):
  - Dev CSP lacked `'unsafe-eval'`, which Next's dev client runtime (React Refresh) requires — silently
    broke all client interactivity in dev only (prod CSP is stricter and correct; the relaxation is
    `NODE_ENV`-gated in `next.config.ts`).
  - `middleware.ts` must live at `src/middleware.ts` in a `src/`-based project — at the project root it
    registers zero matchers and `LIBRARY_V2` never gates anything, with no error. Moved.
  - Search did single-substring matching (`hay.includes(q)`); any multi-word query (e.g. "churn email")
    returned 0. Fixed to AND-match each word (`server/prompts.ts`) — not the legacy relevance engine
    (IDF weighting + synonym expansion + semantic routing, `src/part_app_1.js#searchPrompts`), which
    stays a Phase 3 backlog item.
  - **"Saved only" filtered only the already-loaded page window**, not the caller's full saved set —
    a saved prompt outside the loaded cursor page silently didn't show. Fixed: the prompt list contract
    now accepts `ids` (comma-separated), enforced server-side alongside every other filter (scope-checked
    + paginated), so the client asks for the full saved set instead of post-filtering — see
    `contracts/prompts.ts`, `server/prompts.ts#matchesFilters`, `LibraryView.tsx`.
- **Phase 3 slice 1 (Home) verified live**: real personalized data end-to-end for the `general` test
  account — greeting with org, "Recommended for you" grouped by reason (e.g. "Based on what you
  saved"), "Recently used" showing the exact prompt opened during Library testing, "Saved" showing
  exactly the 3 favorited prompts — all via real DB reads, no mocked data. Hero search returns identical
  counts to the Library screen for the same query. `HOME_V2` off restores the legacy Home at `/`; with
  it off, `/library` (a separate flag) kept serving the full V2 Library unaffected — the two screens
  are genuinely independently revertable.
