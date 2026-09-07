# Identity & Access (v2) — learner accounts, entitlements, admin RBAC

This layer sits **on top of** the existing static `index.html` + `/api` + Neon
setup (see `BACKEND.md`). It adds real user accounts without removing the
access-code gate — both paths coexist.

```
SIGN UP (function chosen) → CONFIRM EMAIL → AUTO ENTITLEMENT → PERSONALIZED HOME
```

Sign-up asks for **one** function/department (dropdown, mandatory — the old
"role" + "job function" fields were merged; keys in `api/_functions.js`). The
new account is signed in immediately with **limited** access. Confirming the
email flips the account to `active` and **auto-grants** an entitlement scoped to
that function's Synottic program (`general` → full library) — **no access code
step**. Changing the function later in the profile re-scopes an auto entitlement
to match; an admin-assigned entitlement is never touched.

Three **independent** states per account (never mixed — combined only in
`api/_access.js#getUserAccess`):

| state | values | meaning |
|---|---|---|
| `email_verified` | bool | did they click the link |
| `account_status` | `pending_verification` · `active` · `suspended` · `disabled` | admin/lifecycle |
| entitlement `status` | `active` · `suspended` · `expired` · `revoked` | what they can open |

An unverified user has limited access; a suspended user is blocked regardless of
entitlement. `entitlements.source`: `self_signup` (pre-verify placeholder) →
`auto_function` (granted on verify) → `access_code` / `admin` (override).

## What was added

### Database — `migrate/schema_v2.sql` (additive, idempotent, no v1 changes)
`users`, `user_sessions`, `email_verification_tokens`, `password_reset_tokens`,
`entitlements`, `access_codes` (new, user-facing), `program_enrollments`,
`feature_permissions` (feature gating is **data**, not code), `entitlement_events`,
`admin_users`, `admin_sessions`, `rate_limits`, `auth_events`, `audit_logs`.

Run it **after** `migrate/run.mjs`:
```bash
DATABASE_URL="postgres://…-pooler…/neondb?sslmode=require" \
ADMIN_BOOTSTRAP_EMAIL="you@synottic.com" ADMIN_BOOTSTRAP_PASSWORD="a-long-one" \
node migrate/run_v2.mjs
```

### API routes
| route | methods | purpose |
|---|---|---|
| `/api/auth/csrf` | GET | issue the double-submit CSRF token (SPA calls once on load) |
| `/api/auth/signup` | POST | create account (`pending_verification`), **sign in immediately with limited access**, and email the verify link. Verifying flips to `active` + unlocks. Password min length **5**. |
| `/api/auth/login` | POST | learner password login **and** admin sign-in — one form. An email that matches `admin_users` returns `{ isAdmin, admin }` + the admin-session cookie (no separate `/admin/login`). |
| `/api/auth/verify-email` | POST/GET | consume the single-use token → `email_verified`, `active`, signs in |
| `/api/auth/resend-verification` | POST | fresh link; always 200 (no enumeration) |
| &nbsp;&nbsp;(login rate limits) | | per-IP + per-account rate limit + 5-fail / 15-min lockout, for learners and admins alike |
| `/api/auth/logout` | POST | revoke the session row, clear cookie |
| `/api/auth/me` | GET/PATCH | current user + `getUserAccess`; PATCH edits **safe** profile fields only |
| `/api/auth/forgot-password` | POST | send reset link; always 200 |
| `/api/auth/reset-password` | POST | single-use token → new hash, revokes **all** sessions + other reset tokens |
| `/api/auth/redeem-code` | POST | signed-in + verified learner attaches an access code → entitlement |
| `/api/admin/session` | GET/POST/DELETE | admin session check/logout + bootstrap of the first SUPER_ADMIN. **POST is legacy** — admins now sign in through `/api/auth/login`; GET/DELETE still used by the console. |
| `/api/admin/users` | GET/PATCH/DELETE | list/search/filter, detail, suspend/reactivate/disable, resend-verify, force-verify, send-reset, revoke-sessions, soft/hard delete |
| `/api/admin/entitlements` | GET/POST/PATCH/DELETE | generate/patch access codes, assign/revoke/suspend/expire entitlements, enroll/unenroll, view history |
| `/api/admin/audit` | GET | `type=admin\|auth\|entitlement` trails |
| `/api/admin/analytics` | GET | existing activity aggregates **+** a new `users` block (verified/active/unverified, by role, by AI level, verification rate, activation rate) |

### Central authorization — `api/_access.js`
`getUserAccess(sql, user)` → `{ authenticated, emailVerified, accountStatus,
access:{status,scopeType,programIds,licenseType,expiresAt,active}, programs,
features:{<key>:bool}, reasons:{<key>:why}, personalization:{tier,headline,…} }`.
`can(access, "practice")` is the only check the rest of the code makes.
Feature keys: `library.preview`, `account.manage`, `library.full`, `prompt.copy`,
`prompt.save`, `practice`, `learning`, `my_program`, `recommendations`,
`progress_tracking`, `advanced_ai`.

### Admin RBAC — `api/_session.js`
`SUPER_ADMIN` > `ADMIN` > `PROGRAM_MANAGER` > `CONTENT_MANAGER` > `VIEW_ONLY`,
enforced server-side per capability (`users.write`, `access.write`, `audit.read`,
`admins.manage`, …). The legacy `ADMIN_SECRET` console key still works and maps
to `SUPER_ADMIN`.

### Security
scrypt password hashing (`node:crypto`, no deps) · split-secret opaque sessions
(only a hash is stored) · single-use, expiring verification (24 h) and reset
(30 min) tokens · DB-backed fixed-window rate limiting on every auth endpoint ·
progressive account lockout · double-submit CSRF on all state-changing calls ·
`HttpOnly` + `SameSite=Lax` + `Secure` (in prod) cookies · no user enumeration on
signup / resend / forgot · full `audit_logs` + `auth_events` trails · all SQL is
parameterised.

### Frontend — `src/part_auth.js` (new build part)
`AuthAPI` bridge + one tabbed gate — **Sign in · Create account · Access code**
all on the same card (the "Access code" tab reuses the classic code flow;
`part_app_3`'s hint line and the old "Admin console →" link are removed). Plus
verify-pending, forgot, reset and verify-landing screens, the in-app status
banner (verify-email / add-access / on-hold), and `featureAllowed()` /
`blockIfLocked()` gating Practice/Learn/My-Program nav and prompt copy/save.
There is **no separate admin sign-in page** — an admin uses the same Sign in
form; `/api/auth/login` detects the admin role and opens the console
(`openAdmin()`). When `/api` is absent the whole module no-ops and the classic
access-code gate is used unchanged. `vercel.json` rewrites `/verify-email`,
`/reset-password`, `/forgot-password` and the legacy `/admin/login` to
`index.html` (the last just shows the unified sign-in).

## Environment variables

| name | required | notes |
|---|---|---|
| `DATABASE_URL` | yes (prod) | Neon pooled string. `pglite://memory` / `pglite:///path` for local dev/test. |
| `SESSION_SECRET` | yes | signs the legacy code-session/admin HMAC tokens |
| `ADMIN_SECRET` | keep | legacy console key; still valid as SUPER_ADMIN |
| `APP_BASE_URL` | recommended | absolute origin for links in emails (else derived from the request host) |
| `EMAIL_TRANSPORT` | no | `console` (default — prints to logs + `/api/dev/outbox`) or `resend` |
| `RESEND_API_KEY` | if `resend` | from resend.com. `synottic.com` is a verified domain, so any recipient is allowed. (A key with no verified domain can only send from `onboarding@resend.dev` to the account owner.) |
| `EMAIL_FROM` | if `resend` | An address on the verified domain — currently `Synottic <info@synottic.com>`. Failed sends are logged; the verify/reset link is still retrievable at `/api/dev/outbox` (dev) or via the in-app "Resend email" button. |
| `ADMIN_BOOTSTRAP_EMAIL` / `ADMIN_BOOTSTRAP_PASSWORD` | first run | creates the first `SUPER_ADMIN` (via `run_v2.mjs`, `devserver_pglite.mjs`, or the first `/api/admin/session` POST) |

### Create / reset an admin at any time

```bash
DATABASE_URL="postgres://…-pooler…/neondb?sslmode=require" \
ADMIN_EMAIL="info@synottic.com" ADMIN_PASSWORD="Synottic@2026" \
ADMIN_ROLE=SUPER_ADMIN node migrate/make_admin.mjs      # npm run make:admin
```
Upserts into `admin_users` (existing row → password + role reset, status forced
`active`, lockout cleared). Password is scrypt-hashed. The admin then signs in
through the **same** `/api/auth/login` form — the console opens automatically.
Warns if a learner account shares the email (learners are matched first, so that
would shadow the admin — use a distinct address).

## Local dev / test

```bash
npm install
node migrate/authtest.mjs          # in-process E2E checks (PGlite, no DB/email needed)
node migrate/devserver_pglite.mjs  # full app + /api on http://localhost:8790, emails print to console
```

Local dev creds: admin `admin@synottic.dev` / `adminDevPass123`, learner access
code `DEMO-LEARNER` (full library). Verification / reset emails print to the
server console; you can also read them at **`GET /api/dev/outbox`** (dev-only —
returns 404 in production and whenever `EMAIL_TRANSPORT` != `console`). It
returns each message plus the extracted `token` / `link`.

## Function library scope (v3)

`migrate/schema_v3.sql` (additive, idempotent — run **after** `run_v2.mjs`):

```bash
DATABASE_URL="postgres://…-pooler…/neondb?sslmode=require" node migrate/run_v3.mjs
```

It adds `entitlements.category_ids` / `prompt_ids` and
`access_codes.category_ids` / `prompt_ids` / `collection_id` (all default empty),
plus `function_scopes` (admin overrides for per-function library scope — see the
**Function access** console tab, `/api/admin/functions`) and `collections`
(per-org curated sets, for a later change). Nothing is seeded: the static
`FUNCTIONS` catalogue in `api/_functions.js` is the default, and a `function_scopes`
row exists only when an admin has customised that function. `devserver_pglite.mjs`
and `authtest.mjs` apply v3 automatically.

**What changed for a function/signup learner.** `entitlementForFunction()` now
returns `scope_type = "function"` (not `"program"`). On email verification
`verify-email.js` calls `resolveFunctionScope(sql, users.role)` — the admin
`function_scopes` row if present and non-empty, else the static
`FUNCTIONS[key].categories` (the union of the Synottic course program's
categories and the `src/part_admin.js` function catalogue) — and writes
`category_ids` / `prompt_ids` onto the `auto_function` entitlement. Changing the
function in the profile (`PATCH /api/auth/me`) re-runs the same resolver.
`getUserAccess` surfaces `access.categoryIds` / `access.promptIds` alongside
`access.scopeType` / `access.source`.

**Admin: Function access tab.** `/api/admin/functions` (`access.write`) backs a
console tab (`src/part_admin.js` `renderAdminFunctions`) that edits a function's
`categories` / `programs` / pinned `promptIds` / `enabled` flag. `action:"save"`
upserts the `fscope:<key>` row; `action:"reset"` deletes it (back to the static
default); `action:"reapply"` re-scopes every current `auto_function` entitlement
for that `users.role`. A plain save only affects **new** signups and profile
changes — existing learners keep their snapshot until re-applied or re-assigned.
All three are audited (`function.scope_update` / `_reset` / `_reapply`). The tab
is shown only when the console is Neon-backed.

**Frontend.** `userLibraryMode()` returns
`{ mode: "function", categories, programIds, promptIds }` for a
`scope_type` of `"function"` (and `mode:"collection"` for `"collection"`; a pre-v3
`auto_function` row still saying `"program"` is coerced to `"function"`).
`scopedLibrary()` filters every prompt list to those categories + linked/pinned
prompts. Unlike the access-code **program** scope, these modes keep the
**Categories** tab visible and filtered — `isViewAllowed()` allows `categories` /
`categoryDetail` when `scopeShowsCategories()` is true; `Insights` stays hidden.
With no `/api` (static host) the learner path never runs; `scopedLibrary()` falls
back to `functionScopeCategories(role)` from `src/part_admin.js` if the access
payload carries no categories.

For a curated scope (`function` / `collection`) `getUserAccess` returns
`access.programIds` from the entitlement's own `program_ids` only — stale
`program_enrollments` from a previous scope are ignored so a curated library is
never silently widened. `redeem-code.js` also prunes prior self-serve enrolments
not in the new code's `program_ids`.

## Per-organization collections + access codes (v3)

`/api/admin/collections` (`access.write` RBAC + CSRF, audited) backs a
**Collections** console tab (`src/part_admin.js` `renderAdminCollections`). A
*collection* (`collections` table) is a named `{ programIds, categoryIds,
promptIds }` set bound to an org name. `generate_code` mints an `access_codes`
row with `scope_type = 'collection'`, `collection_id`, and a **snapshot** of the
collection's scope; editing the collection re-syncs every one of its codes
(per-code label / seat limit / expiry / enabled are untouched). A learner enters
the short code on the existing **Access code** gate tab → `/api/auth/redeem-code`
writes an `access_code`-source entitlement carrying `category_ids` / `prompt_ids`
→ the same filtered category browse as a function scope. Code lifecycle
(rename / disable / re-scope / seat limit / expiry / redemption count) reuses
`PATCH /api/admin/entitlements` (now also accepts `categoryIds` / `promptIds` /
`collectionId`). Deleting a collection is blocked once any of its codes has been
redeemed (disable instead). The tab shows only when the console reaches `/api`.

**Local verify (dev).** Verification only completes when the learner opens the
emailed link. With `EMAIL_TRANSPORT=console` (recommended for local runs:
`EMAIL_TRANSPORT=console node migrate/devserver_pglite.mjs`) the link is in the
server log **and** at `GET /api/dev/outbox` (which works for any transport
outside production, 404 in prod). The verify-pending screen and the in-app
verify banner both show a **"Confirm now (dev)"** button that reads the token
from `/api/dev/outbox` and completes verification in one click.
`renderVerifyLanding` also now boots straight from the `access` in the
`verify-email` response if the follow-up `/api/auth/me` can't be reached.

## User Management console (v3)

`src/part_admin.js` `renderAdminUsers` is a full **Users** tab on
`/api/admin/{users,entitlements,audit}` (shown whenever the console reaches
`/api`). `Backend` bridge: `adminUsers` / `adminUser` / `adminUserAction` /
`adminUserCreate` / `adminUsersBulk` / `adminUserDelete` / `adminEntitlement` /
`adminEntitlementAction` / `adminAudit`.

- **Table** — paginated, searchable, filterable by organisation, function,
  account status, verified/unverified, **entitlement source**
  (`self_signup` / `auto_function` / `access_code` / `admin`) and **entitlement
  status** (incl. `none`). The list query left-joins `entitlements` and computes
  `last_activity_at` from `auth_events`; rows carry `entSource` / `entStatus` /
  `entScope` / `lastActivityAt`.
- **Row / bulk actions** — suspend · reactivate · disable · force-verify ·
  resend-verification · send-reset · revoke-sessions · **align function**
  (`POST {action:"bulk", subAction, ids}`); soft delete; hard delete
  (SUPER_ADMIN only). Entitlement controls in the drawer: assign / suspend /
  expire / revoke / reactivate, enroll / unenroll (via `/api/admin/entitlements`).
- **Add user** — `POST {action:"create"}`: creates a `pending_verification`
  account with an unusable random password, optionally a starting entitlement
  (`functionScope:true` → auto function scope, or `entitlement:{scopeType…}` →
  admin scope), and (default on) sends the `welcome` invite email.
- **Align function** — `PATCH {action:"align_function"}` (and an automatic
  re-scope when `update_profile` changes `role`) re-runs `resolveFunctionScope`
  for an `auto_function` entitlement; a `409 not-auto-entitlement` if the
  entitlement is admin- or code-assigned (never overridden).
- **Detail drawer** — identity + inline profile edit, `getUserAccess` summary,
  `entitlement_events` history, active enrollments, recent `auth_events`, and the
  per-user `audit_logs` trail.

All writes are `users.write` / `access.write` RBAC + CSRF and audited
(`user.create` / `user.align_function` / `user.bulk_<sub>` / …).

## Not yet done (follow-ups)

- **Server-side sync of learner state for user accounts.** Favourites / practice /
  progress persist in `localStorage` namespaced by `user:<id>`. The access-code
  path still syncs to Neon via `/api/state`. A `/api/user/state` keyed by the
  session cookie is the next step (schema is ready — reuse `learner_state` with
  `subject = 'user:'+id`).
- Admin console UI — **done** for Users / Function access / Collections
  (`/api/admin/{users,entitlements,functions,collections,audit}`). A dedicated
  **Audit** tab (raw `/api/admin/audit` browser) is still a follow-up; audit is
  currently surfaced per-user in the Users drawer.
- Email templates render inline-CSS HTML; wire a real provider (`EMAIL_TRANSPORT=resend`)
  before launch.
- `program_enrollments` / `access_codes.program_ids` reference `programs.id` from
  v1 — seed v1 first so program-scoped entitlements resolve to real content.
