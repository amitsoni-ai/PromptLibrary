// ─────────────────────────────────────────────────────────────────────────────
// Curated prompts shown on the public marketing landing page, in two tiers:
//
//   PUBLIC_FREE_IDS     — "common / everyday" prompts, shown FULLY UNLOCKED
//                         (whole body visible + copy button). Real value up
//                         front — try before you sign up.
//   PUBLIC_PREMIUM_IDS  — higher-value / role-specific prompts, shown GRAYED
//                         (blurred body + "Sign up to unlock").
//
// server/catalogue.ts#enrich stamps `publicFree: PUBLIC_LANDING_IDS.includes(p.id)`
// onto every enriched prompt; server/landing.ts buckets them by tier. Nothing
// else reads these lists. To change what the landing showcases, edit the arrays
// here — no schema, API, or seed change needed.
//
// Selection rules (2026-09): all `isTemplate`, high `qualityScore`, spread
// across the top consumer categories; EXCLUDES every Synottic-programme-scoped
// row (ids `syn-*` / `crs-*`, or source "Synottic Programs" /
// "Synottic Curriculum"). The id · title · category breakdown is in
// MIGRATION.md §"Public landing page (LANDING_V2)".
// ─────────────────────────────────────────────────────────────────────────────

/** Free tier — shown unlocked with a working copy button. */
export const PUBLIC_FREE_IDS: readonly string[] = [
  "lib-1303", // Email Marketing · Brainstorm writing Email Subject Lines
  "lib-546", //  Content Writing & Copywriting · Create concise Structure
  "lib-1232", // Email Marketing · Create creating Email Templates
  "lib-2610", // Presentation & Slides · Improve public Speaking
  "lib-293", //  Career Growth · Plan writing Career Development Plans
  "lib-1148", // Education & Learning · Creating Personalized Learning Plans
  "lib-3315", // Social Media · Write Lessons Learned Post
  "lib-2715", // Research & Data Analysis · Create Project Status Report
];

// Premium tier — a small set of grayed / locked EXAMPLE cards under the category
// directory (the directory itself carries the "breadth" story now). Keep ~8.
export const PUBLIC_PREMIUM_IDS: readonly string[] = [
  "lib-2457", // Marketing & Branding · Write prompts I Use Daily That Changed Everything:
  "lib-581", //  Content Writing & Copywriting · Write drafting Press Releases For Maximum Impact
  "lib-1261", // Email Marketing · Brainstorm generating Google Ads Keywords
  "lib-2253", // Marketing & Branding · Write cold Email Copy
  "lib-3047", // Social Media · Develop content Marketing Strategy
  "lib-2678", // Productivity & Automation · Create project Management
  "lib-260", //  Business Strategy · Recommended Implementation Strategy For
  "lib-2809", // SEO & Analytics · Generating Product Performance Reports
];

/** Every id the landing references — used by the catalogue `publicFree` flag. */
export const PUBLIC_LANDING_IDS: readonly string[] = [
  ...PUBLIC_FREE_IDS,
  ...PUBLIC_PREMIUM_IDS,
];
