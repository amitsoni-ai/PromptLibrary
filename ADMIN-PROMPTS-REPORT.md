# Synottic Prompt Library — 3 bug fixes + SUPER_ADMIN prompt management

Scope: the two reported defects (verify-email 404, collections), the Active-toggle
sub-defect, and a new **Prompts** admin console tab for SUPER_ADMIN with bulk
import/export. `index.html` was rebuilt with `python3 src/build.py`;
`node migrate/authtest.mjs` is **150/150**.

---

## BUG 1 — email-verification link 404s in production

### Root cause

`/verify-email`, `/reset-password`, `/forgot-password` and `/admin/login` are
**SPA client routes with no static file**. They only resolve because of the
`rewrites` block in `prompt-library/vercel.json` (each → `/index.html`). The
deployed origin is **not applying those rewrites**, so Vercel's edge returns
`404: NOT_FOUND` (the `bom1::…` id is the edge 404, not the function).

Why the deployed config lacks the rewrites: the repo carries **two** `vercel.json`.

| file | `rewrites`? |
|---|---|
| `prompt-library/vercel.json` | yes (4 routes) |
| `promptlibrary-push-package/vercel.json` | **no** — only `cleanUrls` + `functions` |

`PUSH_INSTRUCTIONS.md` documents deploying by copying the **push-package** file
into `amitsoni-ai/PromptLibrary`. So the live project (and/or the
`prompting.synottic.com` domain's project/alias) runs a `vercel.json` without SPA
rewrites. `api/_authsrc/verify-email.js` is correct (GET+POST, consumes the
token, flips `pending_verification → active`, auto-grants the entitlement, signs
in) — it is simply never reached because the HTML 404s first.

### Fix (code)

- **`prompt-library/vercel.json`** — kept the 4 explicit rewrites, added a
  catch-all SPA fallback that excludes the API, and `trailingSlash: false`:
  ```json
  "rewrites": [
    { "source": "/verify-email",   "destination": "/index.html" },
    { "source": "/reset-password", "destination": "/index.html" },
    { "source": "/forgot-password","destination": "/index.html" },
    { "source": "/admin/login",    "destination": "/index.html" },
    { "source": "/((?!api/).*)",   "destination": "/index.html" }
  ]
  ```
  (Filesystem lookup runs before rewrites, so real files — `/favicon.png`,
  `/og-image.png`, `/api/**` — are still served directly.)
- **`src/build.py`** now writes the canonical `vercel.json` into
  `promptlibrary-push-package/vercel.json` on every build (like it already does
  for `index.html`), so the two copies **cannot drift again**.
- **`migrate/check_deploy.mjs`** (new) — post-deploy smoke check:
  `DEPLOY_ORIGIN=https://prompting.synottic.com node migrate/check_deploy.mjs`
  asserts `/verify-email?token=probe` (and the other 3 routes) return
  `200 text/html` with the SPA shell (`id="gate-root"`), and that
  `/api/auth/csrf` still returns JSON (not swallowed by the catch-all).

### Vercel dashboard settings you must apply (I cannot)

1. **Project → Settings → Root Directory** — must be the folder that contains the
   `vercel.json` **with `rewrites`**. If the GitHub repo `amitsoni-ai/PromptLibrary`
   is the contents of `prompt-library/`, Root Directory = repo root; if it holds
   the push-package layout, redeploy from the push package now that its
   `vercel.json` has the rewrites.
2. **Settings → Domains** — confirm `prompting.synottic.com` is attached to the
   `prompt-library` project (`prj_27l9f8yNGp0VZkA7QSYv3MC3SXzh`, team
   `team_7GTq0ZbivhaOxWuKHhAY2W8L`) and its **Production** assignment points at a
   deployment built from current `main`. Re-assign / promote if it is on an older
   deployment (one from before the rewrites were added).
3. **Settings → Environment Variables (Production)** — set
   `APP_BASE_URL = https://prompting.synottic.com` so every transactional email
   link uses the canonical host regardless of which alias the signup request hit.
4. **Settings → Redirects/Rewrites (dashboard)** — remove any rule that shadows
   `/verify-email` or `/*`.
5. **Redeploy Production**, then run `migrate/check_deploy.mjs` against the domain.

---

## BUG 2 — collections don't save / edits don't reach the learner

Three distinct problems, one report section.

### 2a — "creating a collection sometimes doesn't persist" (schema drift)

**Root cause.** Commit `6f0e6be` added `default_function` / `default_ai_level`
columns **to `schema_v3.sql`** (on `collections` *and* `access_codes`) **and in
the same commit** made `api/_adminsrc/collections.js` write them in `create`,
`update` and `generate_code`. The deployed Neon DB was migrated from the
**earlier** `schema_v3.sql` (commit `ef40a39`) and `npm run migrate:v3` was never
re-run. On that stale DB every collection write throws
`42703 column "default_function" … does not exist` → 500 → the console shows the
generic "Couldn't save". The Collections **GET** wrapped its queries in a blanket
`try { … } catch { /* tables missing -> empty */ }`, so the same error came back
as `200 { collections: [] }` — the list looked empty, i.e. "didn't persist". It
was "sometimes" because the pglite dev server and `authtest.mjs` **always
re-apply the full `schema_v3.sql`**, so local runs and CI stayed green.

**Fix.**
- **Operational (required):** run the migration on the deployed DB —
  ```bash
  DATABASE_URL="postgresql://…-pooler…/neondb?sslmode=require" npm run migrate:v3
  ```
  `run_v3.mjs` / `schema_v3.sql` are additive and idempotent (full bringup order:
  `npm run migrate && npm run migrate:v2 && npm run migrate:v3`). `run_v3` also
  back-fills `prompts.origin` / `title_norm` on existing rows.
- **Code hardening** so a schema lag can never silently blank the feature again:
  - `api/_db.js` — exported `safeRows`, `isMissingRelation`, `isMissingColumn`,
    `isSchemaBehind`.
  - `api/_adminsrc/collections.js` — GET now uses `safeRows` (swallows **only**
    `42P01`); `create`/`update`/`generate_code` are wrapped so a `42703`/`42P01`
    returns `503 { error: "schema-out-of-date", detail: "run: npm run migrate:v3" }`
    instead of a bare 500.
  - `src/part_admin.js` — the Collections editor surfaces the real error
    ("Server database is behind — run: npm run migrate:v3") instead of a generic
    toast.

### 2b — edits to a collection don't reach already-redeemed learners

**Root cause.** `collections.js#update` deliberately only re-snapshotted the
child `access_codes` ("Entitlements already granted keep their own snapshot from
redeem time"). `getUserAccess()` in `api/_access.js` reads scope arrays straight
off the frozen `entitlements` row and never consults the live `collections` row.
So editing categories / programs / pinned prompts had **zero effect** on any
learner who had already redeemed — even on a full reload / `/api/auth/me`.

**Fix.** `api/_access.js` now re-resolves a collection scope **live** on every
request: `resolveLiveCollection()` joins `entitlements.access_code →
access_codes.collection_id → collections` and, when the collection row exists,
uses its current `program_ids` / `category_ids` / `prompt_ids` in place of the
frozen snapshot. Missing collection row (legacy / manual grant) → falls back to
the stored snapshot. No schema change.

### 2c — the "Active" toggle didn't gate redemption

**Root cause.** `collections.js#update` left child codes' `enabled` untouched, and
neither `redeem-code.js` nor `grantCollectionOnVerify()` checked
`collections.enabled`. Disabling a collection blocked nothing and existing
learners kept access.

**Fix.**
- `api/_adminsrc/collections.js#update` — when the collection's Active flag
  **changes**, it cascades to every child `access_codes.enabled` (deactivate →
  all off; reactivate → all on). A plain scope edit still preserves an
  individually-disabled code.
- `api/_authsrc/redeem-code.js` + `grantCollectionOnVerify()` — reject when the
  parent collection is disabled (`403 { error: "collection-disabled" }` on redeem;
  fall through to the function auto-grant on verify).
- `api/_access.js` — a collection-scoped entitlement whose live collection is
  `enabled = false` resolves to `access.active = false`, so existing learners lose
  the library on their next request.
- `src/part_auth.js` — learner-facing copy for `collection-disabled`.

### Tests (`migrate/authtest.mjs` §10)

Added: edit collection → the **already-redeemed** learner's `/api/auth/me` shows
the new `categoryIds`/`promptIds`; deactivate → new redemption `403
collection-disabled` **and** existing learner `access.active === false`;
reactivate → access returns. §13 already round-trips `defaultFunction` /
`defaultAiLevel` through `create` + `generate_code`, which guards 2a on the
always-migrated test DB.

---

## FEATURE — Prompts admin (SUPER_ADMIN only)

New **Prompts** tab in the admin console (`src/part_admin.js#renderAdminPrompts`),
shown only when `isSuperAdmin() && Backend.isConfigured() && Backend.adminAuthed()`.
Server-side every route in `api/_adminsrc/prompts.js` requires
`requireAdmin(…, "prompts.write"|"prompts.read")` **and**
`admin.admin_role === "SUPER_ADMIN"` (RBAC alone would also admit
`CONTENT_MANAGER`). Writes need CSRF; all writes are audited
(`prompt.create | prompt.update | prompt.delete | prompt.import`).

### Storage & how the running app reflects changes

- **Source of truth:** `src/prompts_authored.json` — already spliced into
  `#data-prompts` by `src/build.py#merge_authored()` and seeded into the `prompts`
  table by `migrate/run.mjs`. `src/data_blocks.html` (Excel-derived) is never
  touched.
- **With a DB present**, admin writes land in the `prompts` table
  (`origin = 'authored'`). New **`GET /api/prompts`** (unauthenticated — these
  prompts already ship in `index.html`) returns just the author-managed delta
  `{ prompts, archivedIds, version }`. `src/part_app_5.js#loadData` →
  `mergeAuthoredPrompts()` merges it into `ALL_PROMPTS` at boot (upsert by `id`,
  drop `archivedIds`, re-`enrichRecord`) — **no rebuild needed**. Fail-soft: a
  static host or any error keeps the baked-in set.
- **Permanent inclusion / rebuild step:** *Export JSON* from the Prompts tab →
  replace `src/prompts_authored.json` with it → `python3 src/build.py` → commit
  `index.html`.
- **No-DB fallback** unchanged: the tab is hidden, the merge no-ops,
  `localStorage` path untouched.

### Schema (`migrate/schema_v3.sql`, additive + idempotent)

```sql
alter table prompts add column if not exists origin      text;   -- 'authored' | 'excel' | 'curriculum'
alter table prompts add column if not exists updated_by   text;
alter table prompts add column if not exists updated_at   timestamptz not null default now();
alter table prompts add column if not exists archived_at  timestamptz;
alter table prompts add column if not exists title_norm   text;   -- dedupe key with category
create index if not exists prompts_title_norm_idx on prompts (title_norm, category);
create index if not exists prompts_origin_idx     on prompts (origin);
```
`migrate/run_v3.mjs` back-fills `prompts.origin` / `title_norm` on existing rows
(idempotent). Framework level is **not** stored — the client's
`deriveFrameworkLevel()` (in `src/part_framework.js`) runs for every merged
record at load, so "auto-detected" holds for new prompts with no server work.

### Operations

| UI | API | Notes |
|---|---|---|
| Add prompt (form) | `POST {action:"create", prompt}` | 28-category allow-list; live framework-level preview; `409 duplicate` on same normalized `title`+`category`. |
| Edit | `POST {action:"update", id, patch, allowExcel?}` | Editing an Excel-origin title/prompt needs `allowExcel:true` (the console passes it); everything else free. |
| Archive (soft delete) | `POST {action:"delete", id}` | `lifecycle → 'Archived'`, `archived_at` set; drops out of the library and the default list; reversible via Edit → lifecycle. |
| Delete permanently | `POST {action:"delete", id, hard:true, confirm:true}` | Only `origin:'authored'`; needs the confirm dialog. |
| Import CSV / JSON | `POST {action:"import", rows, commit}` | `commit:false` → diff preview (new / update / invalid+reason / duplicate-in-file); `commit:true` → apply. Idempotent by `id`, else normalized `title`+`category`. |
| Export CSV / JSON / XLSX | `GET ?format=csv\|json` (+ filters) | XLSX is built client-side from the JSON with the existing dependency-free `buildXlsx()`. |
| Download template | `GET ?template=csv\|json` | |

### Import / export format

CSV header (and JSON object keys):

```
id, title, category, role, useCase, description, originalPrompt,
promptType, difficulty, variables, tags, lifecycle
```

- `variables` / `tags`: `|`-separated in CSV (also accepts `,` / newline); arrays
  in JSON. Export also appends `source`, `origin` (ignored on import).
- `id` optional — blank = new (`syn-<category-slug>-<rand>` assigned).
- `category` must be one of the 28 library categories; `difficulty` ∈
  {Beginner, Intermediate, Advanced} or blank (auto); `lifecycle` ∈
  {Draft, Curated, Recommended, Review, Archived}, default `Curated`.
- Re-importing an export is a no-op (all rows classify as `update`, 0 `new`).

### New tests (`migrate/authtest.mjs` §14, 17 checks)

RBAC (non-SUPER_ADMIN → 403), create + `409 duplicate` + `422 invalid-category`,
update-merge, filtered list, `/api/prompts` reflects the new prompt, JSON
export → idempotent re-import, import preview (new + invalid) then commit, soft
delete → `archivedIds`, hard-delete `confirm-required` then success, write
without CSRF → 403.

### Browser E2E (local `node migrate/devserver_pglite.mjs`)

- Signup → verify link `/verify-email?token=…` → SPA verify screen loads, account
  → `active`, `scopeType: "function"`, full library.
- Admin → **Prompts** → Add prompt ("Weekly team status update…", Productivity &
  Automation) — framework level auto-shows **Level 2**; saved; appears in the
  learner Library search after reload (merged via `/api/prompts`, no rebuild).
- Bulk import 2-row CSV → preview `{new:2}` → commit `{new:2}` → re-commit
  `{update:2}` (idempotent); CSV/JSON export + JSON round-trip re-import
  `{update:3}`; template download; learner cookie on `/api/admin/prompts` → 401.
- Collection create persists with the new default columns; GET list no longer
  swallows errors.

---

## Files changed

| Area | Files |
|---|---|
| Bug 1 | `vercel.json`, `../promptlibrary-push-package/vercel.json`, `src/build.py`, `migrate/check_deploy.mjs` (new), `.claude/launch.json` |
| Bug 2 | `api/_db.js`, `api/_access.js`, `api/_adminsrc/collections.js`, `api/_authsrc/redeem-code.js`, `api/_authsrc/verify-email.js`, `src/part_admin.js`, `src/part_auth.js`, `migrate/authtest.mjs` |
| Feature | `api/prompts.js` (new), `api/_adminsrc/prompts.js` (new), `api/admin/[action].js`, `api/_validate.js`, `migrate/schema_v3.sql`, `migrate/run.mjs`, `src/part_backend.js`, `src/part_app_5.js`, `src/part_admin.js` |
| Build output | `index.html` (rebuilt), `../promptlibrary-push-package/{index.html,vercel.json}` |

## Verify

```bash
python3 src/build.py                 # clean; "merged 200 authored prompts"; syncs vercel.json
node --check <(...bundle...)          # per src/README.md — OK
node migrate/authtest.mjs            # 150/150
# then, once the prod DB + Vercel settings are applied:
npm run migrate:v3
DEPLOY_ORIGIN=https://prompting.synottic.com node migrate/check_deploy.mjs
```
