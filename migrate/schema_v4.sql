-- ─────────────────────────────────────────────────────────────────────────────
-- schema_v4.sql — INDEXES ONLY. Additive, idempotent. The ONLY permitted DB
-- change for the Next migration (Phase 1 §4). No new tables/columns/constraints.
--
-- Purpose: server-side prompt search for /api/v2/prompts. The current endpoint
-- filters the cached catalogue in JS (fine at ~3.4k rows); these trigram indexes
-- are the SQL scale path for when search moves to ILIKE / similarity in the DB.
--
-- REVIEW BEFORE APPLYING. Apply manually against a Neon DEV branch first:
--   DATABASE_URL="postgres://…-pooler…/neondb?sslmode=require" \
--     psql "$DATABASE_URL" -f migrate/schema_v4.sql
-- Every statement is guarded (IF NOT EXISTS / IF EXISTS) so re-running is safe.
-- CREATE INDEX CONCURRENTLY is intentionally NOT used (it cannot run in a txn and
-- Neon branches are small); on a large prod table, apply the CONCURRENTLY variant
-- out of band instead.
-- ─────────────────────────────────────────────────────────────────────────────

create extension if not exists pg_trgm;

-- Fast fuzzy / substring search on the prompt title.
create index if not exists prompts_title_trgm_idx
  on prompts using gin (title gin_trgm_ops);

-- Substring search on the prompt body (jsonb data->>'originalPrompt').
create index if not exists prompts_body_trgm_idx
  on prompts using gin ((data->>'originalPrompt') gin_trgm_ops);

-- Substring search on the description.
create index if not exists prompts_desc_trgm_idx
  on prompts using gin ((data->>'description') gin_trgm_ops);

-- Category + quality browse (list ordering / category counts).
create index if not exists prompts_category_quality_idx
  on prompts (category, quality_score desc);
