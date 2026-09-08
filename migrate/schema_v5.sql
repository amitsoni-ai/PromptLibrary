-- ─────────────────────────────────────────────────────────────────────────────
-- schema_v5.sql — STACKABLE ACCESS CODES. Additive, idempotent.
--
-- Purpose: a signed-in learner may hold MORE THAN ONE access code at a time and
-- their library is the UNION of all of them. The `entitlements` table stays as
-- the single merged/effective snapshot per user (every existing reader keeps
-- working); this table records each individual code the learner has applied.
-- `api/_entitlements.js#recomputeEntitlement()` rebuilds the merged row from the
-- active rows here on every redeem / remove.
--
-- REVIEW BEFORE APPLYING. Apply manually against a Neon DEV branch first:
--   DATABASE_URL="postgres://…-pooler…/neondb?sslmode=require" \
--     psql "$DATABASE_URL" -f migrate/schema_v5.sql
-- Every statement is guarded (IF NOT EXISTS) so re-running is safe.
-- Run AFTER migrate/run_v3.mjs. `migrate/run_v5.mjs` applies this file and then
-- seeds the built-in SYNOTTIC-* codes into `access_codes`.
-- ─────────────────────────────────────────────────────────────────────────────

-- One row per (user, code) the learner has redeemed. `status='removed'` rows are
-- kept for history / seat accounting.
create table if not exists user_access_codes (
  id            text primary key,                        -- uac_<random>
  user_id       text not null references users(id) on delete cascade,
  code          text not null,
  source        text not null default 'access_code',
  scope_type    text not null default 'none',            -- full|program|track|collection|none
  program_ids   jsonb not null default '[]'::jsonb,
  category_ids  jsonb not null default '[]'::jsonb,
  prompt_ids    jsonb not null default '[]'::jsonb,
  feature_flags jsonb not null default '{}'::jsonb,
  license_type  text not null default 'standard',
  org_name      text,
  status        text not null default 'active',          -- active|removed|expired
  redeemed_at   timestamptz not null default now(),
  removed_at    timestamptz,
  expires_at    timestamptz
);
create unique index if not exists user_access_codes_uc_idx  on user_access_codes (user_id, upper(code));
create index        if not exists user_access_codes_usr_idx on user_access_codes (user_id, status);

-- Marks an access_codes row as seeded from the built-in catalogue so
-- `run_v5.mjs` can refresh those without ever touching an admin-authored code.
alter table access_codes add column if not exists managed_by text;
