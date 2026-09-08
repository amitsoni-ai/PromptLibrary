import "server-only";
import type { AccessPayload } from "./auth";

// ─────────────────────────────────────────────────────────────────────────────
// Scope resolution — server port of src/part_app_2.js userLibraryMode() +
// scopedLibrary(). Turns an access payload into "which prompts may this learner
// browse" as a set of categories + explicitly-linked prompt ids. The DB query
// (server/prompts.ts) applies it as a WHERE clause.
//
// Fidelity note: full / function / collection / preview are exact. `program`
// (classic access-code program scope) resolves categories from the programs
// table but does NOT reproduce the client-side module curriculum rules
// (programPromptIds); that path primarily serves classic Bearer users who fall
// back to legacy. Documented in MIGRATION.md.
// ─────────────────────────────────────────────────────────────────────────────

export type ScopeMode = "full" | "function" | "collection" | "program" | "preview";

export interface Scope {
  mode: ScopeMode;
  restricted: boolean;
  label: string | null;
  categories: string[];
  promptIds: string[];
}

export function resolveScope(access: AccessPayload): Scope {
  // Unauthenticated / no active entitlement → capped preview library.
  if (!access.authenticated || !access.active) {
    return { mode: "preview", restricted: true, label: "Preview library", categories: [], promptIds: [] };
  }

  if (access.scopeType === "full") {
    return { mode: "full", restricted: false, label: "Full library", categories: [], promptIds: [] };
  }

  const isFunction =
    access.scopeType === "function" ||
    access.scopeType === "collection" ||
    (access.scopeType === "program" && access.source === "auto_function");

  if (isFunction) {
    const mode: ScopeMode = access.scopeType === "collection" ? "collection" : "function";
    return {
      mode,
      restricted: true,
      label: access.org || labelFromRole(access.role) || (mode === "collection" ? "Your collection" : "Your library"),
      categories: access.categoryIds,
      promptIds: access.promptIds,
    };
  }

  if (access.scopeType === "program" || access.scopeType === "track") {
    // Categories are resolved from the programs table in server/prompts.ts.
    return {
      mode: "program",
      restricted: true,
      label: access.org || "Your program",
      categories: [], // filled by the query layer from programIds
      promptIds: access.promptIds,
    };
  }

  return { mode: "preview", restricted: true, label: "Preview library", categories: [], promptIds: [] };
}

function labelFromRole(role: string | null): string | null {
  if (!role) return null;
  // "sales_marketing" -> "Sales Marketing"
  return role
    .split(/[_\s]+/)
    .map((w) => (w ? w[0]!.toUpperCase() + w.slice(1) : w))
    .join(" ");
}
