# Neon backend

The app is a **static frontend (`index.html`) + Vercel serverless functions (`/api`) on Neon Postgres**.
Without `DATABASE_URL` set, every `/api` route returns `503` and the frontend silently falls
back to browser `localStorage` — i.e. exactly the pre-backend behaviour.

## What the backend gives you

| Before (localStorage) | With Neon |
|---|---|
| Admin-created access codes live only in the admin's browser | Codes live in Postgres — usable by any learner, on any device |
| Favorites / saved prompts / practice history are per-browser | Follow the learner (keyed by access code + optional name) |
| No usage data | `activity` table → **Analytics** tab in the admin console |
| Admin key is in the page source | Verified server-side against `ADMIN_SECRET` |

## One-time setup

### 1. Create a Neon project
[neon.tech](https://neon.tech) → new project. Copy the **pooled** connection string
(`...-pooler...`), e.g.
`postgresql://user:pass@ep-xxx-pooler.eu-central-1.aws.neon.tech/neondb?sslmode=require`

### 2. Run the migration (creates tables + seeds everything)
```bash
cd prompt-library                     # repo root
npm install
DATABASE_URL="postgresql://…-pooler…/neondb?sslmode=require" npm run migrate
# add --reset to drop & recreate:  npm run migrate -- --reset
```
Seeds: 3 orgs, 47 programs, cohorts, seed codes, 53 built-in admin codes, and all
3,411 prompt rows (Excel + curriculum). Idempotent — safe to re-run after `python3 src/build.py`.

### 3. Set Vercel environment variables
Project → Settings → Environment Variables (Production + Preview):

| Name | Value |
|---|---|
| `DATABASE_URL` | the pooled Neon string |
| `ADMIN_SECRET` | the real admin-console key (replaces `SYNOTTIC-ADMIN`) |
| `SESSION_SECRET` | any long random string (signs session/admin tokens) |

Redeploy. `/api/session` etc. go live; the frontend detects them automatically.

## API routes

| Route | Method | Purpose |
|---|---|---|
| `/api/session` | POST | `{code,name}` → `{token,session}`; `{code,preview:true}` → gate resolution |
| `/api/state` | GET / PUT | learner favorites / usage / myPrompts / improvements / feedback / progress |
| `/api/activity` | POST | log an event (opened/copied/tested/favorited/practice/…) |
| `/api/admin/login` | POST | `{key}` → admin token |
| `/api/admin/codes` | GET / POST / PATCH / DELETE | access-code CRUD (admin token) |
| `/api/admin/analytics` | GET | aggregates for the Analytics tab |

Tokens are HMAC-signed (`SESSION_SECRET`), 12 h TTL, stored in `sessionStorage`. The session
token carries only the code + subject; every request re-resolves the code, so **disabling a code
in the admin console evicts its learners on their next action**.

## Local dev with the functions

Either the Vercel CLI:
```bash
npm i -g vercel && DATABASE_URL=… ADMIN_SECRET=… SESSION_SECRET=… vercel dev
```
…or the bundled zero-dep dev server (static files + `/api/*` routed to the handlers):
```bash
DATABASE_URL=… ADMIN_SECRET=… SESSION_SECRET=… node devserver.mjs   # http://localhost:8790
```

## Tests

```bash
DATABASE_URL=… node migrate/apitest.mjs     # 16 checks against the live DB (creates + cleans test rows)
```

## Schema

`migrate/schema.sql`. Notable tables: `orgs / programs / cohorts / learners` (taxonomy),
`seed_codes` (built-in cohort codes), `admin_codes` (console-managed), `prompts` (library mirror,
for future in-UI curation + analytics joins), `learner_state` (`subject,key → jsonb`), `activity`.
