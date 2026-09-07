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
node migrate/authtest.mjs          # 48 in-process E2E checks (PGlite, no DB/email needed)
node migrate/devserver_pglite.mjs  # full app + /api on http://localhost:8790, emails print to console
```

Local dev creds: admin `admin@synottic.dev` / `adminDevPass123`, learner access
code `DEMO-LEARNER` (full library). Verification / reset emails print to the
server console; you can also read them at **`GET /api/dev/outbox`** (dev-only —
returns 404 in production and whenever `EMAIL_TRANSPORT` != `console`). It
returns each message plus the extracted `token` / `link`.

## Not yet done (follow-ups)

- **Server-side sync of learner state for user accounts.** Favourites / practice /
  progress persist in `localStorage` namespaced by `user:<id>`. The access-code
  path still syncs to Neon via `/api/state`. A `/api/user/state` keyed by the
  session cookie is the next step (schema is ready — reuse `learner_state` with
  `subject = 'user:'+id`).
- Admin **console UI** for the new endpoints. The APIs are complete and tested;
  the in-app admin screens still show the legacy access-code console. Build new
  tabs (Users / Access / Audit) against `/api/admin/*`.
- Email templates render inline-CSS HTML; wire a real provider (`EMAIL_TRANSPORT=resend`)
  before launch.
- `program_enrollments` / `access_codes.program_ids` reference `programs.id` from
  v1 — seed v1 first so program-scoped entitlements resolve to real content.
