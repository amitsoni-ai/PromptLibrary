import { z } from "zod";

// Legacy error envelope (api/_http.js + handlers): always `{ error: <slug> }`,
// sometimes with extra fields (detail, field, code, action, orgName). We mirror
// it exactly so /api/v2 responses are drop-in compatible.
export const LegacyErrorSchema = z
  .object({
    error: z.string(),
    detail: z.string().optional(),
    field: z.string().optional(),
    code: z.string().optional(),
  })
  .passthrough();

export type LegacyError = z.infer<typeof LegacyErrorSchema>;

/** Thrown by the typed client on any non-2xx; carries the legacy envelope. */
export class ApiError extends Error {
  status: number;
  body: LegacyError;
  constructor(status: number, body: LegacyError) {
    super(body?.error || `http-${status}`);
    this.name = "ApiError";
    this.status = status;
    this.body = body;
  }
}
