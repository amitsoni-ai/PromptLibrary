// Small, allow-list input validation for the auth surface. Returns
// { value } or { error, field }.
import { FUNCTION_KEYS } from "./_functions.js";

// "Role" and "job function" were merged into ONE mandatory field — the
// learner's function/department. It is stored in `users.role` (column reused)
// and drives their library scope on verification. `ROLES` stays exported so
// the profile-edit validators keep working against the same list.
export const ROLES = FUNCTION_KEYS;
export const AI_LEVELS = ["beginner", "foundational", "intermediate", "advanced", "expert"];
export const ADMIN_ROLES = ["SUPER_ADMIN", "ADMIN", "PROGRAM_MANAGER", "CONTENT_MANAGER", "VIEW_ONLY"];
export const ACCOUNT_STATUSES = ["pending_verification", "active", "suspended", "disabled"];
export const ENTITLEMENT_STATUSES = ["active", "suspended", "expired", "revoked"];
export const SCOPE_TYPES = ["full", "function", "program", "track", "collection", "none"];

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;

export function normEmail(s) {
  return String(s || "").trim().toLowerCase();
}

export function validEmail(s) {
  const e = normEmail(s);
  if (!e || e.length > 254 || !EMAIL_RE.test(e)) return { error: "invalid-email", field: "email" };
  return { value: e };
}

// Password policy: >= 5 chars. Deliberately minimal (spec §15 "minimal, premium").
export const MIN_PASSWORD = 5;
export function validPassword(s) {
  const p = String(s == null ? "" : s);
  if (p.length < MIN_PASSWORD) return { error: "password-too-short", field: "password" };
  if (p.length > 200) return { error: "password-too-long", field: "password" };
  return { value: p };
}

export function str(s, { field, max = 120, min = 0, lower = false, allow = null, fallback = undefined } = {}) {
  let v = String(s == null ? "" : s).trim();
  if (lower) v = v.toLowerCase();
  if (v.length < min) {
    if (fallback !== undefined) return { value: fallback };
    return { error: "missing", field };
  }
  if (v.length > max) v = v.slice(0, max);
  if (allow && !allow.includes(v)) {
    if (fallback !== undefined) return { value: fallback };
    return { error: "invalid-" + field, field };
  }
  return { value: v };
}

export function validateSignup(body) {
  const out = {};
  const errors = [];
  const push = (r, key) => { if (r.error) errors.push(r); else out[key] = r.value; };

  push(validEmail(body.email), "email");
  push(validPassword(body.password), "password");
  if (String(body.password || "") !== String(body.confirmPassword ?? body.password_confirm ?? body.password))
    errors.push({ error: "password-mismatch", field: "confirmPassword" });
  push(str(body.firstName ?? body.first_name, { field: "firstName", min: 1, max: 80 }), "firstName");
  push(str(body.lastName ?? body.last_name, { field: "lastName", min: 1, max: 80 }), "lastName");
  // one mandatory field — function/department (accepts `function`, `role`, or `jobFunction`)
  push(str(body.function ?? body.role ?? body.jobFunction ?? body.job_function, {
    field: "function", lower: true, allow: ROLES,
  }), "role");
  push(str(body.aiLevel ?? body.ai_level, { field: "aiLevel", lower: true, allow: AI_LEVELS, fallback: "beginner" }), "aiLevel");
  push(str(body.organization ?? body.org_name ?? body.orgName, { field: "organization", min: 1, max: 120 }), "organization");

  if (body.agreeTerms !== true && body.agree_terms !== true && body.agreedTerms !== true)
    errors.push({ error: "must-accept-terms", field: "agreeTerms" });

  if (errors.length) return { error: errors[0].error, field: errors[0].field, errors };
  return { value: out };
}
