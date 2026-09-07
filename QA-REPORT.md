# Synottic Prompt Library — QA Report: Collections / Function-access / Users admin

**Date:** 2026-09-07
**Scope:** Collection access codes, the "Access code" gate, per-function scope,
User Management console, "Select all" controls, load/stress, regression, security.
**Build:** static `index.html` rebuilt from `src/part_*` via `python3 prompt-library/src/build.py`;
`/api` on Neon (PGlite `pglite://` for local/dev/test).

---

## Verdict: **GO-WITH-FIXES**

The confirmed bug (#1, collection access code not recognised) and a second
same-root defect surfaced mid-QA ("CODE ACCESS is not working" — classic codes
failing on the gate) are **fixed and verified end-to-end** in the browser and by
the automated suites. The "Select all" feature is built and verified. The
load test found one real inefficiency (deep-page N+1 on the Users list) which is
**fixed** (5.2 s → 13 ms at 10 k users). Ship once the **pre-deploy checklist**
below is followed — in particular the schema order (`schema.sql` → `schema_v2.sql`
→ `schema_v3.sql`), which is the production analogue of the dev-server bug that
made the classic gate 500.

`115/115` auth E2E checks pass · load test clean at 5× scale · full learner +
admin flows reproduced in the browser.

---

## 1. Root cause — Bug #1 (collection access code not recognised)

*(Analysis completed before any code change. Traced the whole path.)*

### Symptom
Admin creates collection **EQUENTIS** (4 categories + 3 programs), saves OK, the
list shows `Codes = 1`, code `EQUENTIS-G46XD`. On the sign-in **Access code** tab a
learner enters `EQUENTIS-G46XD` → *"That code isn't recognised."*, **Enter library**
stays disabled.

### Does the collection + code persist server-side? — YES
`Backend.adminSaveCollection` → `POST /api/admin/collections {action:"create"}` →
inserts into `collections` (schema_v3). `generate_code` → inserts an `access_codes`
row with `scope_type='collection'`, `collection_id`, and a snapshot of
`category_ids` / `program_ids` / `prompt_ids`. Confirmed by direct DB/API
inspection — the row is real and server-side, not browser-only.

### Why the learner can't redeem it — THREE defects in one path

`/api/session` backs **both** the gate's live preview (`Backend.previewCode`) and
its redeem (`Backend.redeem`). It resolves codes through `resolveCode()` in
`api/_db.js`, which:

1. **Never queries `access_codes`.** It checks `admin_codes` then `seed_codes`
   only. A `scope_type='collection'` code lives in `access_codes`, so
   `resolveCode()` returns `null` → gate shows "isn't recognised", button
   disabled. The server path that *does* understand collection scope
   (`/api/auth/redeem-code` → entitlement with `category_ids`/`prompt_ids` →
   `getUserAccess` → `mode:"collection"` filtered browse) is **never reached** —
   `AuthAPI.redeemCode` is defined in `src/part_auth.js` and had **zero callers**.
   The "Access code" tab routes to `renderGate(null,{classic:true})`, the
   anonymous classic gate, not the account redeem flow `AUTH.md` specifies.

2. **Not resilient to a database without the v1 schema.** If `admin_codes` /
   `seed_codes` don't exist (any deploy where `migrate/run.mjs`/`schema.sql` was
   never applied — **including** the documented local `devserver_pglite.mjs`,
   which applied only `schema_v2.sql` + `schema_v3.sql`), `resolveCode()` throws
   `relation "admin_codes" does not exist`; `/api/session` returns HTTP 500
   `{error:"db"}`. The classic gate's `enter()` only fell back to local
   resolution on `e.soft` (network) — a 500 dead-ended as *"Couldn't reach the
   server — try again"*. **This is the `SYNOTTIC-ALL` screenshot** the user sent
   mid-QA ("CODE ACCESS is not working").

3. **Anonymous redeem cannot express a collection scope.** Even with (1) fixed,
   `/api/session` mints an anonymous HMAC session (`sessionObject()`), not an
   entitlement. The filtered category browse (`userLibraryMode()` →
   `mode:"collection"`) requires `s.user` + `getUserAccess()`. Collection codes
   are, by design (`AUTH.md`), account-bound (saved work, progress, seat limits).

### Secondary defect found while verifying the fix
Once a learner *did* hold the collection entitlement, `scopedLibrary()` in
`src/part_app_2.js` folded **every category of every attached program** into the
browsable set (`(um.programIds||[]).forEach(pid => programs[pid].categories …)`).
So "4 categories + 3 programs" rendered as **14 categories / 2 343 prompts** —
directly contradicting the admin **Scope preview** ("≈ 451 prompts") and
`AUTH.md` ("a filtered category browse of *exactly that set*").

---

## 2. Fixes (end to end)

### Server (`api/`)
| File | Change |
|---|---|
| `api/_db.js` | `resolveCode()` wraps `admin_codes`/`seed_codes` lookups in `safeRows()` — a missing relation is "no match here", not a 500. Then it looks up **`access_codes`**; a hit returns `{kind:"account", accountRequired:true, orgName, scopeType, categoryCount, programCount, disabled/expired/exhausted}`. |
| `api/session.js` | `kind:"account"` → **preview** returns `{resolved:{accountRequired:true, orgName, scopeNote:"Organisation library — 4 categories · 3 programs."}}`; **redeem** returns `409 {error:"account-required", code, orgName}`. Disabled/expired/exhausted still surface as `403 code-*`. |
| `api/_authsrc/redeem-code.js` | Seat claim is now **atomic**: a single guarded `UPDATE … WHERE (max_redemptions IS NULL OR redemptions < max_redemptions) RETURNING` replaces the check-then-increment race. Re-redeeming a code you already hold is **idempotent** (no extra seat). Grant failure after the claim releases the seat. |
| `api/_adminsrc/users.js` | `last_activity_at` moved from a **per-row correlated subquery** to a single grouped `LEFT JOIN (select user_id, max(ts) … group by user_id)` — see load-test findings. |

### Frontend (`src/part_*`, rebuilt into `index.html`)
| File | Change |
|---|---|
| `src/part_app_3.js` (classic gate) | Preview: an `accountRequired` code shows the org + scope note and a **"Continue"** button. `enter()`: on `409 account-required` → stash the code in `sessionStorage['prompt-lib:pending-code']` and route to sign-up with an inline explainer; on `404`/`5xx` → **fall through to the static org model** if it recognises the code (fixes classic seed / AdminStore codes when `/api` is reachable but doesn't know the code), else a clear message. `renderCategoriesView` trims the category grid to the collection's own `categoryIds`. |
| `src/part_app_2.js` | `scopedLibrary()` no longer folds program categories into a **collection** scope (function scope unchanged) — collection = its categories + its programs' module-linked prompts only. Learner count now matches the admin Scope preview (**451**). |
| `src/part_auth.js` | New `applyAccessCode()` / `redeemPendingCode()`. After sign-up + email verification, a stashed code is **auto-redeemed** ("Organisation library unlocked"). New in-app **"Add an access code"** control in the status banner for any verified learner without full-library scope (the previously-missing entry point for `AuthAPI.redeemCode`). Clear messages for `unknown-code` / `code-disabled` / `code-expired` / `code-exhausted` / `verify-email-first`. |
| `src/part_app_5.js` | `bootApp()` calls `redeemPendingCode()` once a user session exists. |

### Pipeline / environment
| File | Change |
|---|---|
| `migrate/devserver_pglite.mjs` | Applies **`schema.sql` first**, then `schema_v2.sql`, then `schema_v3.sql` — the classic gate's tables (`admin_codes`, `seed_codes`, `activity`, `learner_state`) now exist locally, matching the production checklist. |
| `migrate/authtest.mjs` | Loads `schema.sql` too; **new section 12** (10 checks) — see §4. |
| `migrate/loadtest.mjs` | **New.** `npm run loadtest`. |
| `migrate/schema_v3.sql` / `schema.sql` | Additive, idempotent indexes — see §6. |
| `package.json` | `npm run loadtest`, `npm run migrate:v3`. |

---

## 3. Scenario sweep

Legend: ✅ pass · ⚠️ pass with note · ❌ fail

### 3a. The confirmed bug, reproduced then re-verified in the browser
| # | Scenario | Result | Evidence |
|---|---|---|---|
| B1 | Admin → Collections → New "EQUENTIS", org EQUENTIS, 4 cat + 3 prog, Active, save | ✅ | `POST /api/admin/collections` → `collection.id`, list row `4 cat · 3 prog · 0 pinned`, `Codes 0` |
| B2 | Generate code (forced `EQUENTIS-G46XD`) | ✅ | `access_codes` row `scope_type=collection`, snapshot of cat/prog ids |
| B3 | Sign-in → **Access code** tab → type `EQUENTIS-G46XD` | ✅ (was ❌) | Panel now shows **"EQUENTIS — Organisation library — 4 categories · 3 programs"**, **Continue** enabled |
| B4 | Click Continue with no account | ✅ | Routes to **Create account**, inline note *"…the code EQUENTIS-G46XD unlocks EQUENTIS's library automatically."*, code stashed |
| B5 | Complete sign-up (Sales / EQUENTIS), unverified | ✅ | Limited access; banner *"Your access code EQUENTIS-G46XD will apply automatically once confirmed."* |
| B6 | Confirm email (dev button) | ✅ | Toast **"Organisation library unlocked"** |
| B7 | Scoped browse | ✅ | Sidebar **"451 IN YOUR PROGRAM"**, Library "**451** prompts available to you" — matches admin Scope preview |
| B8 | Category grid | ✅ (was ❌ 14) | **4 tiles** exactly: AI & Prompt Engineering, Book & Ebook Writing, General, Image & Design |
| B9 | `getUserAccess` shape | ✅ | `/api/auth/me` → `scopeType:"collection"`, `categoryIds`=the 4, `programs`=the 3, `source:"access_code"`, `active:true`; **no leak** of the prior HR/Sales function categories |
| B10 | Case / whitespace | ✅ | `" equentis-g46xd "` preview resolves identically |

### 3b. Access-code paths
| Scenario | Result | Evidence |
|---|---|---|
| Classic **seed** code (`ACME-SALES-EMEA`) while `/api` is up but code not in DB | ✅ (was ❌) | Gate resolves locally, `enter()` gets `404`, **falls through to local redeem** → app boots `view:home` |
| `/api/session` for a v1-less DB | ✅ (was 500) | Clean `404 unknown-code`, no `relation … does not exist` |
| Collection code redeem via `/api/auth/redeem-code`, clean session | ✅ | `200`, `scope_type:"collection"`, categoryIds correct (authtest §10/§12) |
| Redeem **before** email verification | ✅ | `403 verify-email-first`; code stays stashed; banner nudges |
| **Disabled** collection code | ✅ | `403 code-disabled` (redeem + gate) |
| **Expired** collection code | ✅ | `403 code-expired` (redeem + gate) |
| **Seat-limit** reached | ✅ | `403 code-exhausted` |
| **Unknown** code | ✅ | `404 unknown-code` (redeem + gate), no enumeration difference |
| Re-redeem a held code | ✅ | `200`, **no extra seat consumed** |
| In-app **"Add an access code"** banner (verified learner) | ✅ | Redeems live, `renderApp()` refresh, error strings mapped |
| Classic cohort/admin codes (existing behaviour) | ✅ | Unchanged; `/api/session` preview + redeem for `admin_codes` still issue an anonymous session |

### 3c. Admin console tabs
| Tab | Result | Notes |
|---|---|---|
| Access codes (legacy `admin_codes`) | ✅ | List/create/patch/delete; **"Select all"** added to Functions + Programs groups |
| New code editor | ✅ | Scope preview live; full-library toggle disables program grid |
| Download prompts (.xlsx) | ✅ | Export from selection unchanged |
| Function access | ✅ | Editor loads; **"Select all / filter"** on Categories + Programs; "Use default" retained; save/reapply/reset OK (authtest §8/§9) |
| Collections | ✅ | List, editor, codes sub-view; **"Select all / filter"** on Categories + Programs; scope preview count now equals the learner's browse |
| Users | ✅ | List + filters (`org`, `q`, `entSource`, `entStatus`, status, verified) + pagination; detail drawer; bulk actions; RBAC (authtest §11) |
| Analytics | ✅ | Account metrics + activity aggregates; ~105 ms at 10 k users / 50 k activity rows |

### 3d. Learner paths
| Path | Result |
|---|---|
| Sign-up + function → limited access → verify → auto function scope | ✅ (authtest §1/§8) |
| Function browse (filtered categories, Categories tab visible, Insights hidden) | ✅ |
| Access-code redeem (org collection) | ✅ (§3a) |
| Classic seed codes | ✅ (§3b) |
| Forgot / reset password, resend verification | ✅ (authtest §2/§4) |
| Suspended account blocked regardless of entitlement | ✅ (authtest §5) |

---

## 4. Automated tests

### `npm run authtest` → **115/115 ✅**
New **section 12 — "Collection code on the anonymous gate + unknown/expired + seat-limit race"** (10 checks):
- `/api/session` preview of a collection code → `accountRequired` (not 404/500)
- preview tolerates lower-case + surrounding spaces
- `/api/session` redeem of a collection code → `409 account-required` (routes to sign-up)
- unknown code on the gate → clean `404 unknown-code`
- redeem unknown code → `404 unknown-code`
- redeem **expired** code → `403 code-expired` (redeem **and** gate)
- **seat-limit race: 20 concurrent redeems on `max_redemptions=5` → exactly 5 grant, 15 refuse `403`**
- stored redemption count is exactly 5 (no over-count)
- re-redeeming a held code is idempotent (no extra seat)

`authtest.mjs` now also applies `schema.sql` so the `/api/session` path is
exercised production-faithfully.

### `npm run loadtest` → **clean** (see §6)

### `npm run apitest` → ⚠️ **pre-existing breakage, not from this work**
`migrate/apitest.mjs` imports `api/admin/login.js`, which was consolidated into
`api/_adminsrc/` by the earlier `[action].js` refactor. It fails at import.
`authtest.mjs` is the maintained suite. *Recommend deleting or rewriting
`apitest.mjs`.*

---

## 5. UX decisions made (and why)

| Decision | Why |
|---|---|
| A collection/`access_codes` code on the "Access code" tab **requires an account**; the gate shows the org + scope and routes to sign-up with the code carried across and auto-redeemed after verification. | `AUTH.md` binds collection scope to a learner entitlement (saved work, progress, seat limits). An anonymous session can't carry `category_ids`/`prompt_ids` or count a seat. Silent failure was the actual bug; a guided hop is the least-friction correct path. |
| New in-app **"Add an access code"** control in the status banner for verified learners without full-library scope. | `AuthAPI.redeemCode` existed but had **no UI**. A learner who gets a code *after* signing up had no way to use it. Dismissible; auto-shows when a code is pending. |
| Classic gate now **falls through to the static model on a `404`/`5xx`** from `/api/session`. | A built-in seed code (baked into `index.html`) or a browser-local AdminStore code must still work when `/api` is reachable but doesn't know that code. Previously any non-network error dead-ended. |
| A **collection is "exactly this set"**: its categories are the browsable grid; its programs contribute only their module-linked prompts (surfaced in search / recommendations), not extra category tiles. | Matches the admin's mental model and the **Scope preview** count. Attaching a program to widen the whole category browse was surprising and inconsistent (451 vs 2 343). |
| Distinct error copy for `code-expired` / `code-exhausted` / `code-disabled` / `verify-email-first` on both the gate and the in-app add-code control. | The old gate collapsed everything to "isn't recognised" / "couldn't reach the server". |
| "Select all / Clear" is a header-row control per group with an **indeterminate** state, a **filter** box (groups > 8 options), a live **`n/m` count**, keyboard-native (`<button>`), and **filter-aware** (only toggles visible options). | Category lists run to ~28 items and program lists to ~47; ticking them one by one was the friction the request calls out. Filter-aware select-all avoids the "select all then hunt-and-uncheck" trap. |

### Smaller issues noted (not blocking)
- `GET /api/dev/outbox?to=<email>` misses addresses containing `+` (the `+` decodes to space in the query string). Dev-only helper; unfiltered `/api/dev/outbox` is fine. Low priority.
- A non-tile category is still reachable by deep link / a recommendation click for a collection learner, and then shows only the **in-scope** subset of that category (e.g. 16 of 286 Legal prompts). Not a leak; could hide the breadcrumb for non-collection categories as a follow-up.
- `AUTH.md` "Local dev creds" still lists `DEMO-LEARNER` as a redeemable full-library code — it now (correctly) routes through the account path like any `access_codes` code. Doc nit.

---

## 6. Load / stress test — `npm run loadtest`

In-process PGlite, real `schema.sql`+`v2`+`v3`, real handlers. Default scale
seeds **2 000 users / 20 orgs / 50 collections / 200 codes / 10 000 activity
rows**; `SCALE=5` → 10 000 users / 100 orgs / 250 collections / 1 000 codes /
50 000 activity + 50 000 auth_events.

### Latency — `SCALE=5` (10 000 users), after the fix
| Operation | Rows | ms |
|---|---|---|
| users: list (limit 25) | 25 | 15 |
| users: list (limit 100) | 100 | 30 |
| users: `limit=100000` (cap check) | **100** (clamped) | 29 |
| users: + org filter | 100 | 57 |
| users: + search `user1` | 100 | 30 |
| users: + entSource / entStatus filter | 100 | 14 |
| users: page 10 (offset 250) | 25 | 14 |
| **users: deep page (offset 9 975)** | 25 | **13** *(was 5 233)* |
| users: single detail (`getUserAccess`) | — | 4 |
| admin analytics (30 d / 365 d) | — | 104 / 106 |
| collections: list + codes | 250 | 13 |
| gate: `/api/session` preview (collection code) | — | 1 |
| `auth/me` concurrency ×250 | 250 ok | 174 |
| **redeem race ×20 (`max_redemptions=5`)** | **5 ok** | 26 |

### Finding & fix
- **Deep-page N+1 on the Users list.** The row query computed
  `last_activity_at` as a **per-row correlated subquery** over `auth_events` —
  run for every row *scanned*, i.e. all `OFFSET` rows too. At `offset 9 975` /
  10 k users that was **5.2 s**. Rewritten as one grouped
  `LEFT JOIN (select user_id, max(ts) … group by user_id)` → **13 ms** (~400×).
  No behaviour change; `authtest` §11 still green.

### Indexes added (additive, idempotent)
| Index | Table | Serves |
|---|---|---|
| `access_codes_code_upper_idx` | `access_codes (upper(code))` | every redeem + `/api/session` gate (was a seq scan; the `code` unique btree can't serve `upper(code)`) |
| `access_codes_collection_idx` | `access_codes (collection_id)` | Collections console `where collection_id is not null` |
| `entitlements_user_idx` | `entitlements (user_id)` | Users list `left join entitlements` |
| `auth_events_user_ts_idx` | `auth_events (user_id, ts desc)` | the new grouped `max(ts)` |
| `admin_codes_code_upper_idx` | `admin_codes (upper(code))` *(schema.sql)* | classic gate `resolveCode()` |
| `seed_codes_code_upper_idx` | `seed_codes (upper(code))` *(schema.sql)* | classic gate `resolveCode()` |

### Checks that passed
- Every list endpoint has a **cap**: Users `limit` clamps 1–100; Collections
  `limit 500`; Collections codes `limit 2000`; analytics enrolments `limit 25`.
  `limit=100000` → 100 rows.
- No unbounded result set among the measured endpoints.
- **Redemption race: exactly 5 of 20 concurrent redeems succeed** (atomic seat
  claim); stored `redemptions = 5` — verified at both scales and in `authtest`.
- `/api/session` collection-code resolution: ~1 ms (single indexed lookup).
- SQL is parameterised throughout the paths touched.

### Not exhaustively load-tested (time-boxed) — recommended before a large rollout
- Real HTTP concurrency against Neon (this run is in-process PGlite; Neon adds
  network + cold-start latency — the retry wrapper in `api/_db.js` covers cold
  starts).
- `OFFSET`-based deep paging is now fast enough at 10 k but is still O(offset);
  keyset (`where created_at < $cursor`) is the right long-term shape for the
  Users list.
- `like '%q%'` search on `users.email` / `org_name` is a seq scan (fine ≤ ~50 k
  rows; add `pg_trgm` GIN indexes if the user base grows past that).

---

## 7. Regression & security spot-checks

| Check | Result |
|---|---|
| No-DB / static-host mode (`/api` absent) → classic gate + localStorage path unchanged | ✅ `Backend.isConfigured()` gates every call; unchanged code paths |
| Classic seed / cohort / admin codes still resolve | ✅ §3b |
| Login / reset / verify / resend | ✅ authtest §1/§2/§4 |
| CSRF on state-changing calls; Bearer legacy token exempt | ✅ authtest §6; `redeem-code` still `checkCsrf` |
| Rate limiting + progressive lockout | ✅ authtest §6 (untouched) |
| RBAC `SUPER_ADMIN > ADMIN > PROGRAM_MANAGER > CONTENT_MANAGER > VIEW_ONLY` server-side | ✅ authtest §3/§8/§9/§10/§11 — VIEW_ONLY blocked from collection create, function save, user create |
| Hard delete = SUPER_ADMIN only | ✅ authtest §11 (unchanged) |
| Learner cannot reach `/api/admin/*` | ✅ `requireAdmin` gate returns 401/403; no code path added around it |
| Learner cannot act on another user's id / entitlement | ✅ `redeem-code` / `me` operate strictly on `resolveUser(req)` |
| No user enumeration on signup / resend / forgot | ✅ unchanged; unknown vs known code both `404`/`403` with generic copy |
| SQL parameterised; no PII/token in URLs or logs | ✅ in the paths touched (`resolveCode`, `redeem-code`, `session`, `users` list). The collection code appears in `entitlement_events.detail` / `audit_logs.detail` as designed (not a URL, not a secret). |
| `redeem-code` seat claim atomic under concurrency | ✅ new guarded UPDATE; race test |

---

## 8. Ranked defect list

| # | Sev | Defect | Status |
|---|---|---|---|
| 1 | **Blocker** | Collection access code not recognised on the "Access code" tab — `resolveCode()` never queries `access_codes`; `AuthAPI.redeemCode` had no caller. | **Fixed** — server + gate + auto-redeem + in-app add-code |
| 2 | **Blocker** | `/api/session` 500s ("relation admin_codes does not exist") on any DB without the v1 schema → classic codes "Couldn't reach the server". Dev server only applied v2+v3. | **Fixed** — `safeRows()` in `resolveCode`; dev server applies `schema.sql` first; gate falls through on `5xx`/`404` |
| 3 | High | Collection scope showed **14 categories / 2 343 prompts** instead of the curated 4 / 451 — `scopedLibrary()` folded program categories in. | **Fixed** — `part_app_2.js` + `renderCategoriesView` |
| 4 | High | Seat limit was check-then-increment — 20 concurrent redeems on `max=5` all succeeded. | **Fixed** — atomic guarded UPDATE; idempotent re-redeem |
| 5 | Med | Users list: `O(users²)` deep paging (per-row correlated subquery over `auth_events`). 5.2 s at 10 k users. | **Fixed** — grouped join; +index |
| 6 | Med | No in-app way to redeem a code after signup. | **Fixed** — "Add an access code" banner control |
| 7 | Low | `apitest.mjs` broken (imports removed `api/admin/login.js`). | **Open** — recommend delete/rewrite; `authtest.mjs` is the suite |
| 8 | Low | `/api/dev/outbox?to=` fails for addresses with `+`. Dev-only. | **Open** — noted |
| 9 | Low | Non-tile category still deep-link-reachable for a collection learner (shows in-scope subset only — not a leak). | **Open** — cosmetic follow-up |
| 10 | Low | `AUTH.md` dev-creds note re `DEMO-LEARNER` is stale. | **Open** — doc nit |

---

## 9. Pre-deploy checklist

1. **Env vars** (Vercel → Project → Settings → Environment Variables):
   `DATABASE_URL` (Neon **pooled**), `SESSION_SECRET`, `ADMIN_SECRET` (legacy
   console key, optional), `APP_BASE_URL` (`https://…` — used in emails),
   `EMAIL_TRANSPORT=resend`, `RESEND_API_KEY`, `EMAIL_FROM=Synottic <info@synottic.com>`,
   `ADMIN_BOOTSTRAP_EMAIL` / `ADMIN_BOOTSTRAP_PASSWORD` (first run only).
2. **Migrations, in order** against the Neon pooled URL:
   ```bash
   DATABASE_URL="postgres://…-pooler…/neondb?sslmode=require" node migrate/run.mjs      # schema.sql  (v1 — admin_codes / seed_codes / activity / learner_state)
   DATABASE_URL="…" ADMIN_BOOTSTRAP_EMAIL=… ADMIN_BOOTSTRAP_PASSWORD=… node migrate/run_v2.mjs   # schema_v2.sql
   DATABASE_URL="…" node migrate/run_v3.mjs                                             # schema_v3.sql  (npm run migrate:v3)
   ```
   All three are idempotent; re-running is safe. **v1 must be present** — it is
   what the classic "Access code" gate resolves against.
3. **Rebuild the static app:** `python3 prompt-library/src/build.py` → commit the
   regenerated `prompt-library/index.html` (Vercel runs no build step). It also
   writes `promptlibrary-push-package/index.html`.
4. **Tests:** `npm run authtest` (expect `115/115`), `npm run loadtest` (expect
   "findings: none").
5. **Smoke test on the deployment:**
   - `POST /api/session {code:"<a classic admin code>", preview:true}` → `200` with a resolved scope (not `500`, not `db`).
   - Admin → Collections → New collection → generate a code.
   - `POST /api/session {code:"<that code>", preview:true}` → `{resolved:{accountRequired:true}}`.
   - New learner → verify email → the code auto-redeems → Library shows the curated category count matching the admin **Scope preview**.
   - Users tab: list + org filter + search + page 2 all return < ~300 ms.
6. **Optional cleanup:** delete `migrate/apitest.mjs` (broken) or exclude it from CI.
