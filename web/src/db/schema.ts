// ─────────────────────────────────────────────────────────────────────────────
// Drizzle schema — INTROSPECTION TARGET.
//
// This file is the destination of `npm run db:pull` (drizzle-kit pull), which
// regenerates it verbatim from the live Neon schema. We NEVER generate/push/
// migrate from it — the DB is owned by migrate/*.sql. Until a maintainer runs
// `db:pull` against Neon (needs DATABASE_URL), this hand-written subset covers
// exactly the tables the /api/v2 READ endpoints touch, transcribed 1:1 from
// migrate/schema.sql + schema_v3.sql. Pulling will additionally emit users,
// entitlements, access_codes, collections, orgs/programs/cohorts, etc.
// ─────────────────────────────────────────────────────────────────────────────
import {
  pgTable,
  text,
  integer,
  jsonb,
  timestamp,
  bigserial,
  primaryKey,
  index,
} from "drizzle-orm/pg-core";

// prompts — the library mirror; Postgres is canonical (Phase 1 §8).
export const prompts = pgTable(
  "prompts",
  {
    id: text("id").primaryKey(),
    sourceNumber: integer("source_number"),
    title: text("title"),
    category: text("category"),
    source: text("source"),
    programId: text("program_id"),
    lifecycle: text("lifecycle"),
    qualityScore: integer("quality_score"),
    data: jsonb("data").notNull(),
    // schema_v3 additions
    origin: text("origin"), // 'authored' | 'excel' | 'curriculum'
    updatedBy: text("updated_by"),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
    archivedAt: timestamp("archived_at", { withTimezone: true }),
    titleNorm: text("title_norm"),
  },
  (t) => ({
    titleNormIdx: index("prompts_title_norm_idx").on(t.titleNorm, t.category),
    originIdx: index("prompts_origin_idx").on(t.origin),
  }),
);

// learner_state — (subject, key) -> jsonb. V2 reads favorites with
// subject = 'user:'+id (cookie identity); legacy uses the code-session subject.
export const learnerState = pgTable(
  "learner_state",
  {
    subject: text("subject").notNull(),
    key: text("key").notNull(),
    value: jsonb("value").notNull(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => ({ pk: primaryKey({ columns: [t.subject, t.key] }) }),
);

// activity — append-only event log feeding the admin analytics view.
export const activity = pgTable("activity", {
  id: bigserial("id", { mode: "number" }).primaryKey(),
  subject: text("subject"),
  code: text("code"),
  orgId: text("org_id"),
  programId: text("program_id"),
  event: text("event").notNull(),
  promptId: text("prompt_id"),
  meta: jsonb("meta").notNull().default({}),
  ts: timestamp("ts", { withTimezone: true }).notNull().defaultNow(),
});
