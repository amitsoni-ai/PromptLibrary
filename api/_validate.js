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

// ── Prompt library curation (SUPER_ADMIN "Prompts" console) ─────────────────
// The 28 library categories (data-categories block). A prompt's category MUST be
// one of these; framework level is derived on the client at load time
// (deriveFrameworkLevel), never stored here.
export const PROMPT_CATEGORIES = [
  "AI & Prompt Engineering", "Book & Ebook Writing", "Business Strategy", "Career Growth",
  "Coaching & Self-Development", "Coding & Tech", "Communication & Leadership",
  "Content Writing & Copywriting", "Customer Support", "E-Commerce", "Education & Learning",
  "Email Marketing", "Finance & Accounting", "General", "Health & Fitness", "HR & Recruiting",
  "Image & Design", "Legal & Compliance", "Marketing & Branding", "Presentation & Slides",
  "Product Management", "Productivity & Automation", "Research & Data Analysis",
  "Sales & Lead Generation", "SEO & Analytics", "Social Media", "Spirituality & Wellness",
  "UX/UI Design",
];
export const PROMPT_LIFECYCLES = ["Draft", "Curated", "Recommended", "Review", "Archived"];
export const PROMPT_DIFFICULTIES = ["Beginner", "Intermediate", "Advanced"];

export function normTitle(s) {
  return String(s == null ? "" : s).trim().toLowerCase().replace(/\s+/g, " ");
}
const toList = (v) => Array.isArray(v)
  ? v.map((x) => String(x == null ? "" : x).trim()).filter(Boolean)
  : String(v == null ? "" : v).split(/[|,\n]/).map((x) => x.trim()).filter(Boolean);

// Validate + normalize one prompt row (single add or one bulk-import row).
// Returns { value } (a clean prompt object) or { error, field }.
export function validatePromptRow(row, { partial = false } = {}) {
  row = row || {};
  const out = {};
  const title = String(row.title ?? row.originalTitle ?? "").trim();
  if (!partial || row.title !== undefined) {
    if (title.length < 3) return { error: "title-too-short", field: "title" };
    if (title.length > 300) return { error: "title-too-long", field: "title" };
    out.title = title;
  }
  const category = String(row.category ?? "").trim();
  if (!partial || row.category !== undefined) {
    if (!PROMPT_CATEGORIES.includes(category)) return { error: "invalid-category", field: "category" };
    out.category = category;
  }
  const prompt = String(row.originalPrompt ?? row.prompt ?? "").trim();
  if (!partial || row.originalPrompt !== undefined || row.prompt !== undefined) {
    if (prompt.length < 10) return { error: "prompt-too-short", field: "originalPrompt" };
    if (prompt.length > 20000) return { error: "prompt-too-long", field: "originalPrompt" };
    out.originalPrompt = prompt;
  }
  const optStr = (k, src, max) => {
    if (src === undefined || src === null) return;
    const v = String(src).trim().slice(0, max);
    if (v) out[k] = v;
  };
  optStr("role", row.role, 160);
  optStr("useCase", row.useCase ?? row.use_case, 400);
  optStr("description", row.description, 1000);
  optStr("promptType", row.promptType ?? row.prompt_type, 60);
  optStr("outcome", row.outcome, 400);
  if (row.difficulty !== undefined && row.difficulty !== null && String(row.difficulty).trim()) {
    const d = String(row.difficulty).trim();
    const hit = PROMPT_DIFFICULTIES.find((x) => x.toLowerCase() === d.toLowerCase());
    if (!hit) return { error: "invalid-difficulty", field: "difficulty" };
    out.difficulty = hit;
  }
  if (row.lifecycle !== undefined && row.lifecycle !== null && String(row.lifecycle).trim()) {
    const lc = String(row.lifecycle).trim();
    const hit = PROMPT_LIFECYCLES.find((x) => x.toLowerCase() === lc.toLowerCase());
    if (!hit) return { error: "invalid-lifecycle", field: "lifecycle" };
    out.lifecycle = hit;
  }
  if (row.variables !== undefined) out.variables = toList(row.variables).slice(0, 60);
  if (row.tags !== undefined) out.tags = toList(row.tags).slice(0, 40);
  if (row.id !== undefined && row.id !== null && String(row.id).trim()) {
    out.id = String(row.id).trim().slice(0, 120);
  }
  return { value: out };
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
