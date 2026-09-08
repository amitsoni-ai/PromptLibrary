import type { Config } from "drizzle-kit";

// INTROSPECT ONLY. `npm run db:pull` reads the live Neon schema into
// src/db/schema.ts. We never generate/push/migrate — the DB is owned by
// migrate/*.sql. `scripts/guard-no-migrations.mjs` (CI) fails if a generated
// migration ever appears under drizzle/.
export default {
  dialect: "postgresql",
  schema: "./src/db/schema.ts",
  out: "./drizzle",
  dbCredentials: {
    // Use a Neon DEV branch — never prod. pglite:// is not introspectable here;
    // point this at the Neon dev branch string when running db:pull.
    url: process.env.DATABASE_URL || "",
  },
  // Keep the pull focused on the app schema.
  schemaFilter: ["public"],
} satisfies Config;
