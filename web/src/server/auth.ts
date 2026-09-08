import "server-only";
import { headers } from "next/headers";

// ─────────────────────────────────────────────────────────────────────────────
// Shared auth — NOT rewritten. We read the caller's identity by calling the
// legacy /api/auth/me (same origin, forwarding the syn_session cookie). This is
// the single source of the getUserAccess() decision; /api/v2 never re-derives
// access rules or touches auth code.
// ─────────────────────────────────────────────────────────────────────────────

const LEGACY_ORIGIN = process.env.LEGACY_ORIGIN || "http://localhost:8790";

export interface AccessPayload {
  authenticated: boolean;
  userId: string | null;
  org: string | null;
  role: string | null;
  scopeType: "full" | "function" | "program" | "track" | "collection" | "none";
  active: boolean;
  source: string | null;
  categoryIds: string[];
  promptIds: string[];
  programIds: string[];
}

const ANON: AccessPayload = {
  authenticated: false,
  userId: null,
  org: null,
  role: null,
  scopeType: "none",
  active: false,
  source: null,
  categoryIds: [],
  promptIds: [],
  programIds: [],
};

// /api/auth/me returns { authenticated, user, access } where `access` is the
// getUserAccess() object — and its EFFECTIVE entitlement is nested one level
// deeper at access.access.{scopeType,categoryIds,promptIds,programIds,...}.
type Inner = {
  scopeType?: AccessPayload["scopeType"];
  active?: boolean;
  source?: string | null;
  categoryIds?: string[];
  promptIds?: string[];
  programIds?: unknown; // "*" for full, else string[]
};
type MeResponse = {
  authenticated?: boolean;
  user?: { id?: string; role?: string; organization?: string } | null;
  access?: {
    userId?: string;
    org?: string;
    role?: string;
    programs?: unknown; // "*" or string[]
    access?: Inner;
  } | null;
};

function toStringArray(v: unknown): string[] {
  return Array.isArray(v) ? v.filter((x): x is string => typeof x === "string") : [];
}

/** Resolve the current caller's access by asking the legacy /api/auth/me. */
export async function getAccess(): Promise<AccessPayload> {
  const cookie = (await headers()).get("cookie") || "";
  let body: MeResponse;
  try {
    const res = await fetch(`${LEGACY_ORIGIN}/api/auth/me`, {
      headers: { cookie },
      cache: "no-store",
    });
    if (!res.ok) return ANON;
    body = (await res.json()) as MeResponse;
  } catch {
    return ANON;
  }
  const ga = body.access;
  if (!body.authenticated || !ga) return ANON;
  const inner: Inner = ga.access ?? {};
  const programsRaw = ga.programs ?? inner.programIds;
  const programs = programsRaw === "*" ? [] : toStringArray(programsRaw);
  return {
    authenticated: true,
    userId: ga.userId ?? body.user?.id ?? null,
    org: ga.org ?? body.user?.organization ?? null,
    role: ga.role ?? body.user?.role ?? null,
    scopeType: inner.scopeType ?? "none",
    active: !!inner.active,
    source: inner.source ?? null,
    categoryIds: toStringArray(inner.categoryIds),
    promptIds: toStringArray(inner.promptIds),
    programIds: programs,
  };
}

/** subject key for cookie-identity learner state / activity: 'user:'+id. */
export function subjectFor(access: AccessPayload): string | null {
  return access.userId ? `user:${access.userId}` : null;
}
