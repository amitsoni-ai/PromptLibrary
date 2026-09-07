-- Synottic Prompt Library — Neon Postgres schema
-- Idempotent: safe to run repeatedly. Run via `node migrate/run.mjs`.

create table if not exists orgs (
  id          text primary key,
  name        text not null,
  short_name  text,
  data        jsonb not null default '{}'::jsonb
);

create table if not exists programs (
  id          text primary key,
  org_id      text references orgs(id) on delete cascade,
  name        text not null,
  track       text,
  scope       text not null default 'program',   -- 'program' | 'full'
  access_code text,
  data        jsonb not null default '{}'::jsonb  -- description, skillFocus, audienceRoles, categories, modules
);

create table if not exists cohorts (
  id          text primary key,
  program_id  text references programs(id) on delete cascade,
  name        text not null,
  starts_on   date,
  data        jsonb not null default '{}'::jsonb
);

create table if not exists learners (
  id          text primary key,
  cohort_id   text references cohorts(id) on delete set null,
  name        text,
  email       text,
  data        jsonb not null default '{}'::jsonb
);

-- Built-in cohort/learner access codes (from part_orgmodel.json).
create table if not exists seed_codes (
  code       text primary key,
  cohort_id  text references cohorts(id) on delete cascade,
  learner_id text references learners(id) on delete set null,
  kind       text not null default 'cohort'
);

-- Admin-console access codes. Replaces the old browser-local AdminStore.
create table if not exists admin_codes (
  id           text primary key,
  code         text unique not null,
  org_name     text,
  domain       text,
  industry     text,
  functions    jsonb not null default '[]'::jsonb,
  roles        jsonb not null default '[]'::jsonb,
  program_ids  jsonb not null default '[]'::jsonb,
  full_library boolean not null default false,
  super_admin  boolean not null default false,
  enabled      boolean not null default true,
  note         text,
  seeded       boolean not null default false,
  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now()
);
-- The classic gate / resolveCode() matches on upper(code); the plain unique
-- btree on `code` can't serve that. (Idempotent — safe on re-run.)
create index if not exists admin_codes_code_upper_idx on admin_codes (upper(code));
create index if not exists seed_codes_code_upper_idx on seed_codes (upper(code));

-- Central prompt library mirror (Excel + curriculum). The running app still
-- ships prompts inline for fast client search; this table is the source of
-- truth for future in-UI curation and for analytics joins.
create table if not exists prompts (
  id            text primary key,
  source_number integer,
  title         text,
  category      text,
  source        text,
  program_id    text,
  lifecycle     text,
  quality_score integer,
  data          jsonb not null
);

-- Per-learner saved state. subject = learnerId | cohortId | code[:name]
-- (mirrors the old client nsKey()). key in
-- (favorites, usage, myPrompts, improvements, feedback, progress).
create table if not exists learner_state (
  subject    text not null,
  key        text not null,
  value      jsonb not null,
  updated_at timestamptz not null default now(),
  primary key (subject, key)
);

-- Activity events for the admin analytics view.
create table if not exists activity (
  id         bigserial primary key,
  subject    text,
  code       text,
  org_id     text,
  program_id text,
  event      text not null,   -- opened|copied|tested|favorited|unfavorited|practice|improved|created|search|signin
  prompt_id  text,
  meta       jsonb not null default '{}'::jsonb,
  ts         timestamptz not null default now()
);
create index if not exists activity_ts_idx    on activity (ts desc);
create index if not exists activity_code_idx  on activity (code);
create index if not exists activity_event_idx on activity (event);
create index if not exists activity_prompt_idx on activity (prompt_id);
