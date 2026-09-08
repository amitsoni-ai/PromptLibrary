# One database for localhost + production

Goal: localhost behaves **exactly** like `prompting.synotic.com`, and anything you
import locally (migrations, admin-console codes, entitlements) is immediately live
in production — because both point at the **same Neon Postgres**.

## How it works

- Production on Vercel already reads `DATABASE_URL` (Neon pooled string) from
  Project → Settings → Environment Variables.
- Locally, `devserver.mjs` now auto-loads `.env` / `.env.local`. Put the **same**
  `DATABASE_URL` (and the same `SESSION_SECRET` / `ADMIN_SECRET`) there and both
  environments share one database.

## One-time setup

Already done in this repo:

```bash
vercel link --project prompt-library     # wrote .vercel/project.json
vercel env pull .env.local --environment=production   # wrote .env.local (git-ignored)
npm install
```

To refresh the secrets later (e.g. after rotating the Neon string), just re-run
`vercel env pull .env.local --environment=production`.

`devserver.mjs` loads `.env` first, then `.env.local`, and **`.env` wins on
conflicts** — so local-only overrides (`APP_BASE_URL=http://localhost:8790`,
`EMAIL_TRANSPORT=console`) belong in `.env`, and the shared DB + secrets come
from `.env.local`. It also strips the `VERCEL_*` / `TURBO_*` system vars that
`vercel env pull` includes, so cookies and `/api/dev/*` still behave like dev.

> No Vercel CLI? Open the Vercel project → Settings → Environment Variables, copy
> the **Production** `DATABASE_URL`, `SESSION_SECRET` and `ADMIN_SECRET`, and put
> them in `prompt-library/.env.local` (`KEY=value` per line).

If production does **not** have a database yet, create one Neon project
([neon.tech](https://neon.tech)), then set its pooled connection string as
`DATABASE_URL` in **both** Vercel (Production + Preview) and `.env.local`, and run
the migration once (step below).

## Run locally against the shared DB

```bash
npm run dev            # http://localhost:8790 — same data as prompting.synotic.com
```

`npm run dev` now prints `DATABASE_URL set`. `/api/*` routes hit the real Neon DB,
so sign-in, admin console, codes and analytics work identically to production.

Prefer the Vercel runtime? `vercel dev` also works and pulls env automatically.

## Importing / seeding (runs against whatever DATABASE_URL points to)

```bash
# from prompt-library/, with .env.local providing DATABASE_URL
node --env-file=.env.local migrate/run.mjs        # v1 schema + prompts + seed/admin codes
node --env-file=.env.local migrate/run_v2.mjs     # v2 auth/entitlements schema
node --env-file=.env.local migrate/run_v3.mjs     # v3 function-scope schema
node --env-file=.env.local migrate/run_v5.mjs     # v5 stackable access codes + seed SYNOTTIC-* into access_codes
```

> `run_v5` is what makes the built-in `SYNOTTIC-*` course / track codes
> redeemable by a **signed-in** learner (they previously lived only in
> `admin_codes`, reachable through the anonymous gate). Review
> `migrate/schema_v5.sql` and apply on a Neon **dev branch** first.

Migrations are idempotent, so re-running after `python3 src/build.py` just upserts
the refreshed rows — and because it's the shared DB, production sees them on the
next request. No redeploy needed for data changes.

## ⚠️ This is the production database

- **Never** run `migrate/run.mjs --reset` or `apitest.mjs` / `loadtest.mjs`
  against `.env.local` — `--reset` drops every table, and the test scripts write
  throwaway rows into whatever DB they're pointed at.
- `npm run dev:auth` (the PGlite server) is the opposite of this setup — it spins
  up a throwaway in-process DB and will try to apply schema + seed a demo admin.
  Don't run it with a real `DATABASE_URL` in `.env`. Use `npm run dev` here.
- Want an isolated sandbox without losing "shared by default"? Create a **Neon
  branch** of the prod database and point `.env.local` at the branch string while
  experimenting; switch back to the main string when you want writes to be live.
