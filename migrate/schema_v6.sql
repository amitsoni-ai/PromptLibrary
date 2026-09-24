-- Synottic Prompt Library — social sign-in (v6)
-- ADDITIVE ONLY. Links a Google / Microsoft account to a `users` row so the
-- learner can sign up / sign in without a password. One row per provider
-- account; a user may have several (e.g. Google + Microsoft + a password).
-- Run via `node migrate/run_v6.mjs` (after run_v5.mjs). api/_oauth.js also
-- applies it lazily on first use, so a deploy without the migration still works.

create table if not exists user_identities (
  id           text primary key,                          -- uid_<random>
  user_id      text not null references users(id) on delete cascade,
  provider     text not null,                             -- google | microsoft
  subject      text not null,                             -- provider's stable user id (sub / oid)
  email        text,
  created_at   timestamptz not null default now(),
  last_login_at timestamptz,
  unique (provider, subject)
);
create index if not exists user_identities_user_idx on user_identities (user_id);
