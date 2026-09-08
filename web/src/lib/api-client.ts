import { z } from "zod";
import {
  ApiError,
  LegacyErrorSchema,
  PromptsListRequestSchema,
  PromptsListResponseSchema,
  PromptByIdResponseSchema,
  CategoriesResponseSchema,
  StateResponseSchema,
  ActivityRequestSchema,
  ActivityResponseSchema,
  type PromptsListRequest,
  type PromptsListResponse,
  type PromptByIdResponse,
  type CategoriesResponse,
  type StateResponse,
  type ActivityRequest,
} from "@/contracts";

// ─────────────────────────────────────────────────────────────────────────────
// Typed fetch client for the ported /api/v2 endpoints. Each method validates the
// request (dev safety) and the response (both directions in CI) with the shared
// Zod contracts, and throws ApiError carrying the legacy `{error}` envelope on
// any non-2xx. Same-origin (relative URLs) so the syn_session cookie rides along.
// ─────────────────────────────────────────────────────────────────────────────

const BASE = "/api/v2";

function readCookie(name: string): string | null {
  if (typeof document === "undefined") return null;
  const m = document.cookie.match(new RegExp("(?:^|; )" + name + "=([^;]*)"));
  return m?.[1] ? decodeURIComponent(m[1]) : null;
}

async function request<S extends z.ZodTypeAny>(
  path: string,
  schema: S,
  init?: RequestInit,
): Promise<z.output<S>> {
  const res = await fetch(`${BASE}${path}`, {
    credentials: "same-origin",
    ...init,
    headers: { accept: "application/json", ...(init?.headers || {}) },
  });
  const text = await res.text();
  const json = text ? JSON.parse(text) : {};
  if (!res.ok) {
    throw new ApiError(res.status, LegacyErrorSchema.parse(json));
  }
  return schema.parse(json) as z.output<S>;
}

function qs(params: Record<string, unknown>): string {
  const sp = new URLSearchParams();
  for (const [k, v] of Object.entries(params)) {
    if (v === undefined || v === null || v === "") continue;
    sp.set(k, String(v));
  }
  const s = sp.toString();
  return s ? `?${s}` : "";
}

export const api = {
  listPrompts(input: PromptsListRequest): Promise<PromptsListResponse> {
    const parsed = PromptsListRequestSchema.parse(input);
    return request(`/prompts${qs(parsed)}`, PromptsListResponseSchema);
  },

  getPrompt(id: string): Promise<PromptByIdResponse> {
    return request(`/prompts/${encodeURIComponent(id)}`, PromptByIdResponseSchema);
  },

  categories(): Promise<CategoriesResponse> {
    return request(`/categories`, CategoriesResponseSchema);
  },

  getState(keys: string[] = ["favorites"]): Promise<StateResponse> {
    return request(`/state${qs({ keys: keys.join(",") })}`, StateResponseSchema);
  },

  putState(body: { key: string; value: unknown }): Promise<{ ok: true }> {
    return request(
      `/state`,
      z.object({ ok: z.literal(true) }),
      {
        method: "PUT",
        headers: {
          "content-type": "application/json",
          "x-csrf-token": readCookie("syn_csrf") || "",
        },
        body: JSON.stringify(body),
      },
    );
  },

  logActivity(input: ActivityRequest): Promise<{ ok: true }> {
    const body = ActivityRequestSchema.parse(input);
    return request(`/activity`, ActivityResponseSchema, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "x-csrf-token": readCookie("syn_csrf") || "",
      },
      body: JSON.stringify(body),
    });
  },
};
