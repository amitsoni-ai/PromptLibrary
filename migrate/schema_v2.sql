-- Synottic Prompt Library — Identity & Access schema (v2)
-- ADDITIVE ONLY. Every statement is `if not exists` / idempotent. This never
-- drops or alters a v1 table (orgs / programs / cohorts / learners / seed_codes
-- / admin_codes / prompts / learner_state / activity). Run via
-- `node migrate/run_v2.mjs` (after the v1 `migrate/run.mjs`).
--
-- Concept separation (see spec §11): every account carries THREE independent
-- states — `email_verified` (bool), `account_status` (pending/active/suspended/
-- disabled) and, on the entitlement, `status` (active/suspended/expired/revoked).
-- Nothing in the app mixes them; `api/_access.js#getUserAccess` is the only
-- place they are combined into an effective decision.

-- ─────────────────────────────  learners (real accounts)  ─────────────────────

create table if not exists users (
  id              text primary key,                       -- usr_<random>
  email           text not null,
  email_norm      text not null unique,                   -- lower(trim(email))
  password_hash   text not null,                          -- scrypt: scrypt$N$r$p$salt$hash (all b64url)
  first_name      text not null default '',
  last_name       text not null default '',
  role            text not null default 'other',          -- see feature_permissions / spec §1
  ai_level        text not null default 'beginner',
  org_name        text not null default '',
  job_function    text,                                   -- optional
  account_status  text not null default 'pending_verification',  -- pending_verification|active|suspended|disabled
  email_verified  boolean not null default false,
  agreed_terms_at timestamptz,
  last_login_at   timestamptz,
  failed_logins   integer not null default 0,
  locked_until    timestamptz,
  data            jsonb not null default '{}'::jsonb,      -- future profile extension (avatar, prefs…)
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now()
);
create index if not exists users_status_idx   on users (account_status);
create index if not exists users_role_idx     on users (role);
create index if not exists users_verified_idx on users (email_verified);
create index if not exists users_org_idx      on users (lower(org_name));
create index if not exists users_created_idx  on users (created_at desc);

-- Opaque server sessions. The cookie/bearer carries only a random id; the
-- secret half is stored hashed so a DB leak can't mint sessions. Revoking a
-- row (or flipping the user's status) logs the learner out on the next call.
create table if not exists user_sessions (
  id            text primary key,                         -- ses_<random>  (public half)
  user_id       text not null references users(id) on delete cascade,
  secret_hash   text not null,                            -- sha256(secret half)
  created_at    timestamptz not null default now(),
  last_seen_at  timestamptz not null default now(),
  expires_at    timestamptz not null,
  remember      boolean not null default false,
  ip            text,
  user_agent    text,
  revoked_at    timestamptz
);
create index if not exists user_sessions_user_idx on user_sessions (user_id);
create index if not exists user_sessions_exp_idx  on user_sessions (expires_at);

create table if not exists email_verification_tokens (
  id          text primary key,
  user_id     text not null references users(id) on delete cascade,
  token_hash  text not null unique,                        -- sha256(raw token)
  created_at  timestamptz not null default now(),
  expires_at  timestamptz not null,
  used_at     timestamptz
);
create index if not exists evt_user_idx on email_verification_tokens (user_id);

create table if not exists password_reset_tokens (
  id          text primary key,
  user_id     text not null references users(id) on delete cascade,
  token_hash  text not null unique,
  created_at  timestamptz not null default now(),
  expires_at  timestamptz not null,
  used_at     timestamptz,
  request_ip  text
);
create index if not exists prt_user_idx on password_reset_tokens (user_id);

-- ─────────────────────────────  entitlement / access  ────────────────────────

-- Reusable access codes issued by admins (distinct from the legacy v1
-- `admin_codes`, which still powers the old code-only gate). A learner redeems
-- one of these AFTER signing up to receive an entitlement.
create table if not exists access_codes (
  id             text primary key,                        -- acc_<random>
  code           text not null unique,
  label          text,
  org_name       text,
  scope_type     text not null default 'program',         -- full|program|track|none
  program_ids    jsonb not null default '[]'::jsonb,
  feature_flags  jsonb not null default '{}'::jsonb,       -- { "practice": true, "learning": true, ... } overrides
  license_type   text not null default 'standard',        -- trial|standard|enterprise
  max_redemptions integer,                                 -- null = unlimited
  redemptions    integer not null default 0,
  expires_at     timestamptz,
  enabled        boolean not null default true,
  note           text,
  created_by     text,
  created_at     timestamptz not null default now(),
  updated_at     timestamptz not null default now()
);
create index if not exists access_codes_enabled_idx on access_codes (enabled);

-- One row per user = their current effective entitlement. Admin-assignable,
-- revocable, expirable. A user with none gets the "verified, no access" basic
-- experience (spec §11).
create table if not exists entitlements (
  id             text primary key,                        -- ent_<random>
  user_id        text not null references users(id) on delete cascade,
  source         text not null default 'admin',           -- admin|access_code|self_signup|org_default
  access_code    text,                                    -- the code redeemed, if any
  scope_type     text not null default 'none',            -- full|program|track|none
  program_ids    jsonb not null default '[]'::jsonb,
  feature_flags  jsonb not null default '{}'::jsonb,       -- explicit per-feature grant/deny overrides
  license_type   text not null default 'standard',
  org_name       text,
  status         text not null default 'active',          -- active|suspended|expired|revoked
  granted_by     text,
  granted_at     timestamptz not null default now(),
  expires_at     timestamptz,
  note           text,
  created_at     timestamptz not null default now(),
  updated_at     timestamptz not null default now(),
  unique (user_id)
);
create index if not exists entitlements_status_idx on entitlements (status);
create index if not exists entitlements_exp_idx    on entitlements (expires_at);

-- Program-level enrolment (many per user). programs.id is text in v1.
create table if not exists program_enrollments (
  id           text primary key,
  user_id      text not null references users(id) on delete cascade,
  program_id   text not null,
  status       text not null default 'active',            -- active|completed|removed
  enrolled_by  text,
  enrolled_at  timestamptz not null default now(),
  completed_at timestamptz,
  unique (user_id, program_id)
);
create index if not exists prog_enr_user_idx on program_enrollments (user_id);

-- Reference table so feature gating is DATA, not hardcoded branches. Seeded by
-- run_v2.mjs; `api/_access.js` reads it.
create table if not exists feature_permissions (
  feature_key         text primary key,
  label               text not null,
  description         text,
  public_ok           boolean not null default false,     -- usable while signed out
  requires_verified   boolean not null default true,
  requires_entitlement boolean not null default false,
  min_ai_level        text,
  sort                integer not null default 100
);

-- Full history of every entitlement change (spec §9 "entitlement history").
create table if not exists entitlement_events (
  id        bigserial primary key,
  user_id   text,
  actor     text,                                          -- admin id / "system" / "self"
  action    text not null,   -- granted|modified|revoked|suspended|reactivated|expired|code_redeemed|enrolled|unenrolled
  detail    jsonb not null default '{}'::jsonb,
  ts        timestamptz not null default now()
);
create index if not exists ent_events_user_idx on entitlement_events (user_id);
create index if not exists ent_events_ts_idx   on entitlement_events (ts desc);

-- ─────────────────────────────  admin (separate identity plane)  ─────────────

create table if not exists admin_users (
  id            text primary key,                          -- adm_<random>
  email         text not null,
  email_norm    text not null unique,
  password_hash text not null,
  name          text not null default '',
  admin_role    text not null default 'VIEW_ONLY',         -- SUPER_ADMIN|ADMIN|PROGRAM_MANAGER|CONTENT_MANAGER|VIEW_ONLY
  status        text not null default 'active',            -- active|suspended|disabled
  last_login_at timestamptz,
  failed_logins integer not null default 0,
  locked_until  timestamptz,
  created_by    text,
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now()
);

create table if not exists admin_sessions (
  id           text primary key,
  admin_id     text not null references admin_users(id) on delete cascade,
  secret_hash  text not null,
  created_at   timestamptz not null default now(),
  last_seen_at timestamptz not null default now(),
  expires_at   timestamptz not null,
  ip           text,
  user_agent   text,
  revoked_at   timestamptz
);
create index if not exists admin_sessions_admin_idx on admin_sessions (admin_id);

-- ─────────────────────────────  security / observability  ────────────────────

-- Fixed-window counters. bucket = "<action>:<key>" e.g. "login:ip:1.2.3.4".
create table if not exists rate_limits (
  bucket       text primary key,
  count        integer not null default 0,
  window_start timestamptz not null default now()
);

-- Auth-plane event stream. Also the source for brute-force / lockout logic and
-- the analytics "activation rate".
create table if not exists auth_events (
  id         bigserial primary key,
  user_id    text,
  email_norm text,
  event      text not null,   -- signup|verify_sent|verify_ok|verify_fail|login_ok|login_fail|lockout|logout|reset_request|reset_ok|reset_fail|password_changed|admin_login_ok|admin_login_fail
  ip         text,
  user_agent text,
  meta       jsonb not null default '{}'::jsonb,
  ts         timestamptz not null default now()
);
create index if not exists auth_events_ts_idx    on auth_events (ts desc);
create index if not exists auth_events_email_idx on auth_events (email_norm);
create index if not exists auth_events_event_idx on auth_events (event);
create index if not exists auth_events_user_idx  on auth_events (user_id);

-- Admin/system action trail (spec §9 AUDIT LOG).
create table if not exists audit_logs (
  id          bigserial primary key,
  actor_type  text not null default 'system',   -- admin|user|system
  actor_id    text,
  actor_label text,
  action      text not null,                    -- e.g. user.suspend, access.grant, prompt.publish, admin.role_change
  target_type text,
  target_id   text,
  detail      jsonb not null default '{}'::jsonb,
  ip          text,
  ts          timestamptz not null default now()
);
create index if not exists audit_logs_ts_idx     on audit_logs (ts desc);
create index if not exists audit_logs_actor_idx  on audit_logs (actor_id);
create index if not exists audit_logs_action_idx on audit_logs (action);
create index if not exists audit_logs_target_idx on audit_logs (target_type, target_id);
