// The single "function / department" a learner picks at sign-up. This is the
// ONE field that drives their library scope — no access code needed. Mirrors
// the FUNCTIONS dict in src/part_admin.js (key -> Synottic "AI for <function>"
// course program). `general` = full library.
//
// On email verification (api/auth/verify-email.js) the learner is auto-granted
// an entitlement scoped to `programIds` (or full for `general`).

export const FUNCTIONS = [
  { key: "sales",            label: "Sales",                         programIds: ["prog-syn-sales"] },
  { key: "marketing",        label: "Marketing",                     programIds: ["prog-syn-marketing"] },
  { key: "hr",               label: "Human Resources (HR)",          programIds: ["prog-syn-hr"] },
  { key: "learning_dev",     label: "Learning & Development (L&D)",   programIds: ["prog-syn-ld"] },
  { key: "finance",          label: "Finance & Accounting",          programIds: ["prog-syn-finance"] },
  { key: "legal",            label: "Legal & Compliance",            programIds: ["prog-syn-legal"] },
  { key: "it_engineering",   label: "IT & Engineering",              programIds: ["prog-syn-it-eng"] },
  { key: "product",          label: "Product Management",             programIds: ["prog-syn-product"] },
  { key: "project_program",  label: "Project & Program Management",   programIds: ["prog-syn-ppm"] },
  { key: "customer_service", label: "Customer Service",               programIds: ["prog-syn-customer-service"] },
  { key: "data_analysis",    label: "Data & Business Analysis",       programIds: ["prog-syn-data-analyst"] },
  { key: "operations",       label: "Operations & Supply Chain",      programIds: ["prog-syn-operations"] },
  { key: "procurement",      label: "Procurement",                    programIds: ["prog-syn-procurement"] },
  { key: "general",          label: "General / Cross-functional",     programIds: [], full: true },
];

export const FUNCTION_KEYS = FUNCTIONS.map((f) => f.key);
const BY_KEY = Object.fromEntries(FUNCTIONS.map((f) => [f.key, f]));

export function functionByKey(key) {
  return BY_KEY[String(key || "").toLowerCase()] || null;
}

// -> { scopeType, programIds } to seed an auto entitlement from the function.
export function entitlementForFunction(key) {
  const fn = functionByKey(key);
  if (!fn || fn.full || !fn.programIds.length) return { scopeType: "full", programIds: [] };
  return { scopeType: "program", programIds: fn.programIds.slice() };
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
