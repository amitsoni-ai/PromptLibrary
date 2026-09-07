-- Synottic Prompt Library — Function / collection library scope (v3)
-- ADDITIVE ONLY. Every statement is `if not exists` / idempotent. Never drops or
-- alters a v1/v2 column. Run via `node migrate/run_v3.mjs` (after run_v2.mjs).
--
-- Piece 1 (function-scoped signup) uses:
--   * entitlements.category_ids / prompt_ids  — category- and prompt-level
--     curation that rides on the entitlement for scope_type in ('function','collection')
--   * function_scopes                         — admin OVERRIDES for per-function
--     library scope (id = 'fscope:<key>' for the global no-role row). No row =
--     the static default in api/_functions.js. role_key / org_id are reserved.
-- collections + access_codes.collection_id / category_ids / prompt_ids are the
-- groundwork for Piece 3 (per-organization curated collections + access codes).

-- ── entitlements: category / prompt curation ────────────────────────────────
alter table entitlements add column if not exists category_ids jsonb not null default '[]'::jsonb;
alter table entitlements add column if not exists prompt_ids   jsonb not null default '[]'::jsonb;

-- ── access_codes: category / prompt curation + collection link ──────────────
alter table access_codes add column if not exists category_ids  jsonb not null default '[]'::jsonb;
alter table access_codes add column if not exists prompt_ids    jsonb not null default '[]'::jsonb;
alter table access_codes add column if not exists collection_id text;

-- ── collection joining defaults (Piece 3, short signup) ─────────────────────
-- When a learner signs up after entering a collection access code we show only
-- step 1 (name / email / password) and take organisation + function + AI level
-- from the collection. These ride on each generated code (snapshot, kept in
-- sync by /api/admin/collections#update) so api/_authsrc/signup.js can derive
-- them from the code row alone. Null = fall back to `general` / `beginner`.
-- The matching `collections` columns are added after that table below.
alter table access_codes add column if not exists default_function text;
alter table access_codes add column if not exists default_ai_level text;

-- ── function_scopes: admin overrides for per-function library scope ─────────
-- Resolver: api/_funcscope.js#resolveFunctionScope. Falls back to the static
-- catalogue in api/_functions.js when there is no row (or the row is empty /
-- disabled). Edited via the "Function access" console tab (/api/admin/functions).
create table if not exists function_scopes (
  id           text primary key,                       -- 'fscope:<function_key>' for the global no-role row
  function_key text not null,                           -- see api/_functions.js FUNCTION_KEYS
  role_key     text,                                    -- reserved (Piece 2): per-role refinement
  org_id       text,                                    -- reserved (Piece 2): per-org override
  label        text,
  categories   jsonb not null default '[]'::jsonb,      -- library category names
  program_ids  jsonb not null default '[]'::jsonb,      -- prog-syn-* ids (module-linked prompts)
  prompt_ids   jsonb not null default '[]'::jsonb,      -- individually pinned prompt ids
  enabled      boolean not null default true,
  updated_by   text,
  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now(),
  unique (function_key, role_key, org_id)
);
create index if not exists function_scopes_fn_idx on function_scopes (function_key);

-- ── collections: named curated sets bound to an org + access code (Piece 3) ──
create table if not exists collections (
  id           text primary key,                        -- col_<random>
  org_name     text,
  name         text not null,
  program_ids  jsonb not null default '[]'::jsonb,
  category_ids jsonb not null default '[]'::jsonb,
  prompt_ids   jsonb not null default '[]'::jsonb,
  enabled      boolean not null default true,
  created_by   text,
  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now()
);
create index if not exists collections_enabled_idx on collections (enabled);
-- joining defaults inherited by short-signup learners (see access_codes above)
alter table collections add column if not exists default_function text;
alter table collections add column if not exists default_ai_level text;

-- ── access-code lookup paths (additive, idempotent) ───────────────────────────
-- Redeem + the /api/session gate both match on upper(code); the plain `code`
-- unique btree can't serve that, so it was a seq scan on every redeem.
create index if not exists access_codes_code_upper_idx on access_codes (upper(code));
-- The Collections console lists codes by collection; without this it seq-scans
-- the whole access_codes table per page load.
create index if not exists access_codes_collection_idx on access_codes (collection_id);
-- The Users console left-joins entitlements per row; make the join key indexed
-- even where the unique(user_id) constraint's shape differs.
create index if not exists entitlements_user_idx on entitlements (user_id);
-- Users list derives last_activity_at from max(ts) per user — a covering
-- (user_id, ts) index turns that group-by into an index-only scan.
create index if not exists auth_events_user_ts_idx on auth_events (user_id, ts desc);
