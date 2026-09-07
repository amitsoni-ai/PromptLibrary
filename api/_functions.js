// The single "function / department" a learner picks at sign-up. This is the
// ONE field that drives their library scope — no access code needed. Mirrors
// the FUNCTIONS dict in src/part_admin.js (key -> Synottic "AI for <function>"
// course program). `general` = full library.
//
// On email verification (api/auth/verify-email.js) the learner is auto-granted
// an entitlement scoped to `programIds` (or full for `general`).

// `categories` = the browsable library categories for the function. It is the
// UNION of the Synottic course program's categories (src/part_orgmodel.json
// prog-syn-<fn>.categories) and the function catalogue in src/part_admin.js
// (FUNCTIONS["<Display>"].categories). Kept in sync with the frontend by hand;
// admins can override per function in `function_scopes` (schema_v3) — see
// api/_funcscope.js. `general` = the whole library (no category filter).
export const FUNCTIONS = [
  { key: "sales",            label: "Sales",                         programIds: ["prog-syn-sales"],
    categories: ["AI & Prompt Engineering", "Communication & Leadership", "Email Marketing", "Legal & Compliance", "Productivity & Automation", "Sales & Lead Generation"] },
  { key: "marketing",        label: "Marketing",                     programIds: ["prog-syn-marketing"],
    categories: ["AI & Prompt Engineering", "Content Writing & Copywriting", "Email Marketing", "Legal & Compliance", "Marketing & Branding", "Productivity & Automation", "SEO & Analytics", "Social Media"] },
  { key: "hr",               label: "Human Resources (HR)",          programIds: ["prog-syn-hr"],
    categories: ["AI & Prompt Engineering", "Career Growth", "Coaching & Self-Development", "Communication & Leadership", "HR & Recruiting", "Legal & Compliance", "Productivity & Automation"] },
  { key: "learning_dev",     label: "Learning & Development (L&D)",   programIds: ["prog-syn-ld"],
    categories: ["AI & Prompt Engineering", "Coaching & Self-Development", "Education & Learning", "HR & Recruiting", "Legal & Compliance", "Productivity & Automation"] },
  { key: "finance",          label: "Finance & Accounting",          programIds: ["prog-syn-finance"],
    categories: ["AI & Prompt Engineering", "Finance & Accounting", "Legal & Compliance", "Productivity & Automation", "Research & Data Analysis"] },
  { key: "legal",            label: "Legal & Compliance",            programIds: ["prog-syn-legal"],
    categories: ["AI & Prompt Engineering", "Legal & Compliance", "Productivity & Automation"] },
  { key: "it_engineering",   label: "IT & Engineering",              programIds: ["prog-syn-it-eng"],
    categories: ["AI & Prompt Engineering", "Coding & Tech", "Legal & Compliance", "Productivity & Automation"] },
  { key: "product",          label: "Product Management",             programIds: ["prog-syn-product"],
    categories: ["AI & Prompt Engineering", "Legal & Compliance", "Product Management", "Productivity & Automation", "Research & Data Analysis", "UX/UI Design"] },
  { key: "project_program",  label: "Project & Program Management",   programIds: ["prog-syn-ppm"],
    categories: ["AI & Prompt Engineering", "Business Strategy", "Communication & Leadership", "Legal & Compliance", "Productivity & Automation"] },
  { key: "customer_service", label: "Customer Service",               programIds: ["prog-syn-customer-service"],
    categories: ["AI & Prompt Engineering", "Customer Support", "Legal & Compliance", "Productivity & Automation"] },
  { key: "data_analysis",    label: "Data & Business Analysis",       programIds: ["prog-syn-data-analyst"],
    categories: ["AI & Prompt Engineering", "Legal & Compliance", "Productivity & Automation", "Research & Data Analysis", "SEO & Analytics"] },
  { key: "operations",       label: "Operations & Supply Chain",      programIds: ["prog-syn-operations"],
    categories: ["AI & Prompt Engineering", "Business Strategy", "Legal & Compliance", "Productivity & Automation"] },
  { key: "procurement",      label: "Procurement",                    programIds: ["prog-syn-procurement"],
    categories: ["AI & Prompt Engineering", "Business Strategy", "Finance & Accounting", "Legal & Compliance", "Productivity & Automation"] },
  { key: "general",          label: "General / Cross-functional",     programIds: [], categories: [], full: true },
];

export const FUNCTION_KEYS = FUNCTIONS.map((f) => f.key);
const BY_KEY = Object.fromEntries(FUNCTIONS.map((f) => [f.key, f]));

export function functionByKey(key) {
  return BY_KEY[String(key || "").toLowerCase()] || null;
}

// -> { scopeType, programIds, categories } to seed an auto entitlement from the
// function. A scoped function now uses scope_type = "function" (distinct from an
// access-code "program" scope): the learner keeps a filtered CATEGORY browse.
export function entitlementForFunction(key) {
  const fn = functionByKey(key);
  if (!fn || fn.full || !fn.programIds.length) return { scopeType: "full", programIds: [], categories: [] };
  return { scopeType: "function", programIds: fn.programIds.slice(), categories: (fn.categories || []).slice() };
}

// Role-flavoured topic hints for the personalized Home (spec §7).
export const FUNCTION_TOPICS = {
  sales: ["prospecting emails", "discovery calls", "proposals"],
  marketing: ["campaign briefs", "content drafts", "positioning"],
  hr: ["job descriptions", "interview guides", "feedback"],
  learning_dev: ["learning design", "facilitation", "assessments"],
  finance: ["variance analysis", "board summaries", "forecasting"],
  legal: ["contract review", "policy drafting", "risk notes"],
  it_engineering: ["code review", "specs", "incident summaries"],
  product: ["PRDs", "user research synthesis", "roadmap narratives"],
  project_program: ["status updates", "risk logs", "steering decks"],
  customer_service: ["reply drafts", "macros", "escalation summaries"],
  data_analysis: ["SQL drafting", "dashboard narratives", "insight write-ups"],
  operations: ["process SOPs", "capacity planning", "vendor comms"],
  procurement: ["RFP drafts", "supplier evaluations", "negotiation prep"],
  general: ["summaries", "email drafts", "research"],
};
