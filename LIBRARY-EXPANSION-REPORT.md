# Library Expansion Report — Synottic "Enable" / AI for Functions

**Date:** 2026-09-07
**Deliverable:** 200 framework-structured "Kickstart Prompt" records covering every function, role
and use case in Synottic's 13 "AI for Functions" enablement programs, filed under the existing 28
library categories and imported into the `data-prompts` bundle and the DB seed.

---

## 1. Sources read

| # | Source | How accessed | Result |
|---|---|---|---|
| 1 | **13 "AI for Functions" curriculum outlines** (`.docx`) — SharePoint folder `…/SYNOTTIC/4_PROGRAMS/Synottic_Web_Resources(Do-not-touch)/AI Course Curriculum/AI for Functions/` (the folder behind the shared link `synottic-my.sharepoint.com/:f:/p/amit/IgDj7TFB…`) | **Microsoft 365 / SharePoint connector** (signed in as amit@synottic.com) | ✅ All 13 read in full |
| 2 | Synottic services page `https://www.synottic.com/services/enable` (`#programs`) | WebFetch | ✅ Read — gave the top-level program taxonomy only (no use-case-level detail beyond source 1) |
| 3 | `src/part_admin.js` `FUNCTIONS{}` + `CATEGORY_TO_FUNCTIONS` | repo | ✅ Used as the role / category / program-id backbone |
| 4 | `src/part_framework.js` `FRAMEWORKS.rctf` + `deriveFrameworkLevel()` | repo | ✅ Drives the authoring format and the classification check |

The 13 outlines (each mapped to its `prog-syn-*` program):

Sales · Marketing · HR · L&D · Finance & Accounting · Legal & Compliance · IT & Engineering ·
Product Management · Project & Program Management · Customer Service · Data & Business Analysis ·
Operations & Supply Chain · Procurement.

Every outline section was mined for use cases — *Curriculum Sequence* (10 modules), *Applied
Practice (Business Use Cases)*, the *Detailed Curriculum* table, *Hands-on Activities & Business
Use Cases*, and *Target Audience* (which matches `FUNCTIONS[fn].roles`).

**Unreadable sources:** none. (The `#programs` anchor on the services page 404s on fetch, but the
page body was retrieved.)

---

## 2. What was produced

**200 new records**, `source: "Synottic Programs"`, `promptType: "Kickstart Prompt"`,
`version: "1.0"`, `aiTool: null`, `healthStatus: "Healthy"`, all `isTemplate: true`.
IDs: `syn-<functionslug>-<n>` (`syn-sales-1` … `syn-procurement-15`).

Each `originalPrompt` is written as labelled framework lines for its level
(`Role:` / `Context:` / `Task:` / `Format:` (+`Verification:` / `Validation:` for L2) (+`Goal:` /
`Constraints:` / `Examples:` for L3)). Responsible-AI is carried in the `Verification:` /
`Validation:` lines — source-grounding, "flag inference vs fact", bias/fairness checks on
screening/performance/attrition, "not legal advice / qualified lawyer must verify" on every Legal
prompt, "human owns the decision" on every roadmap.

### 2.1 Breakdown by function

| Function | Program id | Prompts |
|---|---|---:|
| Sales | prog-syn-sales | 16 |
| Marketing | prog-syn-marketing | 16 |
| HR | prog-syn-hr | 16 |
| Finance & Accounting | prog-syn-finance | 16 |
| Legal & Compliance | prog-syn-legal | 16 |
| L&D | prog-syn-ld | 15 |
| IT & Engineering | prog-syn-it-eng | 15 |
| Product Management | prog-syn-product | 15 |
| Project & Program Management | prog-syn-ppm | 15 |
| Customer Service | prog-syn-customer-service | 15 |
| Data & Business Analysis | prog-syn-data-analyst | 15 |
| Operations & Supply Chain | prog-syn-operations | 15 |
| Procurement | prog-syn-procurement | 15 |
| **Total** | | **200** |

### 2.2 Breakdown by category (before → after)

Live library counts (data-prompts + the 44 curriculum prompts), captured from the running app's
Library → Categories view. The 21 deltas sum to exactly **+200**.

| Category | Before | After | Δ |
|---|---:|---:|---:|
| Business Strategy | 92 | 115 | +23 |
| Legal & Compliance | 286 | 306 | +20 |
| Finance & Accounting | 102 | 120 | +18 |
| Productivity & Automation | 59 | 76 | +17 |
| Research & Data Analysis | 76 | 93 | +17 |
| Customer Support | 366 | 381 | +15 |
| Education & Learning | 98 | 112 | +14 |
| HR & Recruiting | 336 | 349 | +13 |
| Sales & Lead Generation | 129 | 141 | +12 |
| Product Management | 8 | 18 | +10 |
| Coding & Tech | 155 | 164 | +9 |
| Communication & Leadership | 37 | 45 | +8 |
| Marketing & Branding | 361 | 369 | +8 |
| SEO & Analytics | 114 | 119 | +5 |
| Content Writing & Copywriting | 181 | 184 | +3 |
| Email Marketing | 91 | 93 | +2 |
| UX/UI Design | 30 | 32 | +2 |
| AI & Prompt Engineering | 170 | 171 | +1 |
| Career Growth | 9 | 10 | +1 |
| Coaching & Self-Development | 34 | 35 | +1 |
| Social Media | 325 | 326 | +1 |
| *(19 other categories)* | — | — | +0 |
| **Live total** | **3,411** | **3,611** | **+200** |

`data-prompts` array (bundle, excl. curriculum): **3,367 → 3,567**.
`data-stats.totalPrompts`: **3,367 → 3,567** (bumped by `build.py`).

Every category used is one of the 28 existing `data-categories` **and** one of the categories that
function draws from in `FUNCTIONS{}`, so `functionsForCategory()` / `CATEGORY_TO_FUNCTIONS` stay
consistent. The thin categories grew meaningfully: **Product Management 8 → 18**, **Career Growth
9 → 10**, **UX/UI Design 30 → 32**.

### 2.3 Framework-level distribution

| Level | Intended (as authored) | Detected by `deriveFrameworkLevel()` |
|---|---:|---:|
| L1 (R-C-T-F) | 19 | 15 |
| L2 (R-C-T-F-V-V) | 117 | 95 |
| L3 (R-C-G-T-C-E-F-V-V) | 64 | 90 |

**All 200 records classify at a level ≥ their intended level** (verified against the real engine
in `src/part_framework.js` — see `scratchpad/check_framework.mjs`). Some L1/L2 prompts are detected
as L2/L3 because "flag / verify" and "pressure-test against a real reader" phrasing also satisfies
the looser `goal` / `constraints` detectors — over-classification is acceptable per the brief;
under-classification does not occur.

L1 is reserved for genuinely simple productivity tasks (meeting summaries, status reports,
reconciliation-exception worklists, release notes, follow-up emails). L3 is used for high-stakes
work: legal drafting/review/DPIA/DD, finance forecasting/audit/fraud-review/board pack/capex,
HR screening/calibration/succession/attrition, architecture, negotiation, every AI-adoption
roadmap and business case, and analytical root-cause / AI-output-validation.

### 2.4 Other properties

- `sensitiveCategory: true` on **48** records (Legal & Compliance — all; HR & Recruiting and
  Finance & Accounting at L2/L3; the anomaly/fraud and security-remediation prompts).
- `qualityScore`: min **81**, avg **87.5**, max **92** — all authored to the rubric, target ≥ 80.
- `flags` on every record: `modelSpecific:false, containsWebSearch:false,
  containsInteractiveQuestioning:false, embeddedMetadata:false, hasOutputCue:true,
  incompleteTitle:false`.
- Schema matches `data-prompts` exactly, plus `programId` and `track` (the same two extra keys
  `part_curriculum.json`'s Synottic records carry).

---

## 3. Dedupe

- Normalised-title comparison (lowercase, strip punctuation/whitespace) against (a) every other
  authored record and (b) every existing `data-prompts` title **in the same category**.
- **0 collisions** — no authored row was dropped or renamed for a duplicate. The authored titles
  are use-case phrases ("Rolling forecast and scenario / sensitivity analysis", "Data protection
  impact assessment (DPIA) draft") that do not clash with the Excel library's verb-first
  generated titles.

---

## 4. Import pipeline (minimal, reviewable)

| File | Change |
|---|---|
| **`src/prompts_authored.json`** *(new)* | The 200 records — the editable source of truth. |
| **`src/build.py`** | New `merge_authored()` splices `prompts_authored.json` into the `data-prompts` block at build time (immediately before the `]</script>` that closes it) and bumps `data-stats.totalPrompts`. `data_blocks.html` on disk is **never modified**. No-op if the file is absent/empty. |
| **`migrate/run.mjs`** | Added the PGlite-aware driver switch used by `run_v2`/`run_v3` (`pglite://` → `api/_pglite.js`, else `@neondatabase/serverless`), and `libPrompts.concat(authored).concat(curriculum)` so a Neon or PGlite seed matches the bundle. Idempotent via the existing `insert … on conflict (id) do update`. |
| **`scratchpad/`** *(gitignored)* | `author_prompts.py` (generator), `rows_data.py` (the hand-authored substance table), `authoring_plan.csv`, `check_framework.mjs`, `sources_read.md`. |

Generation is `python3 scratchpad/author_prompts.py` → `src/prompts_authored.json`, then
`python3 src/build.py`. Work was committed function-by-function (13 commits + pipeline + a
placeholder-tidy pass) on a fresh `git` repo (the project was not previously under version
control).

---

## 5. End-to-end verification

| Check | Result |
|---|---|
| `node --check` on the extracted bundle `<script>` (per `src/README.md`) | ✅ passes after every function |
| `index.html` `data-prompts` length | ✅ **3,567** (= 3,367 + 200) |
| `index.html` `data-stats.totalPrompts` | ✅ **3,567** |
| `DATABASE_URL=pglite:///… node migrate/run.mjs` | ✅ `prompts: 3611` (3,367 library + 200 authored + 44 curriculum); idempotent by `on conflict (id) do update` |
| App (served by `devserver.mjs`) → Library → **Categories** | ✅ "**3,611 prompts across 28 categories**"; every affected category count higher; deltas sum to +200; **Product Management 8 → 18** visible |
| Spot-check ~10 new prompts in the app | ✅ render with correct category/level chips; detail view shows the framework badge (e.g. "Written like a **Level 3** framework prompt (R-C-G-T-C-E-F-V-V)"), the **Synottic Programs** source chip, quality breakdown bars, `Written for` role, strengths/improvements, related prompts |
| Variable substitution | ✅ "Use this prompt — fill in & copy" opens a form with one field per placeholder; the live Preview substitutes values (`[COMPANY]` → typed value) |
| Framework auto-classification (`scratchpad/check_framework.mjs`, real engine) | ✅ **200/200** classify ≥ intended level |
| `node migrate/authtest.mjs` | ✅ **129/129 checks passed** (auth surface unchanged) |

---

## 6. Ten sample records

| id | title | category | role | level | vars | quality | sensitive |
|---|---|---|---|---|---:|---:|:--:|
| syn-sales-1 | AI-powered prospect research and account intelligence brief | Sales & Lead Generation | Business Development Manager | L2 | 6 | 86 | – |
| syn-marketing-7 | Brand messaging framework and voice guide | Marketing & Branding | Brand Manager | L3 | 8 | 90 | – |
| syn-hr-2 | Resume screening rubric and candidate shortlist rationale | HR & Recruiting | Recruiter | L3 | 6 | 91 | ✓ |
| syn-ld-5 | Workshop activity and discussion design | Education & Learning | Facilitator | L1 | 5 | 82 | – |
| syn-finance-2 | Rolling forecast and scenario / sensitivity analysis | Finance & Accounting | FP&A Analyst | L3 | 6 | 90 | ✓ |
| syn-legal-10 | Data protection impact assessment (DPIA) draft | Legal & Compliance | Privacy / DPO | L3 | 7 | 91 | ✓ |
| syn-it-eng-3 | Bug reproduction and root-cause debugging | Coding & Tech | Software Engineer | L3 | 5 | 90 | – |
| syn-product-4 | Roadmap and backlog prioritisation with a scoring model | Product Management | Product Manager | L3 | 6 | 90 | – |
| syn-customer-service-1 | Empathetic customer email / chat response | Customer Support | Support Agent | L2 | 7 | 88 | – |
| syn-data-analyst-10 | AI output validation checklist for an analytical result | Research & Data Analysis | Data Scientist | L3 | 5 | 90 | – |

### Full text — 3 of the 10

#### `syn-sales-1` — AI-powered prospect research and account intelligence brief
*category:* Sales & Lead Generation · *role:* Business Development Manager · *level:* L2 ·
*useCase:* "AI-powered prospect research and account intelligence brief" ·
*outcome:* "A one-page account intelligence brief you can use to personalise first outreach."

```
Role: Act as a senior B2B business development manager and account researcher.

Context: I am preparing to approach a new target account. Company: [COMPANY]. Industry: [INDUSTRY]. Approximate size: [SIZE]. What we sell: [PRODUCT_OR_SERVICE]. What I already know about them: [KNOWN_FACTS]. Buyer roles I want to reach: [BUYER_ROLES].

Task: Produce an account intelligence brief that: (1) summarises the company in 3-4 lines; (2) lists 3-5 likely business priorities or trigger events that would make our offer relevant; (3) maps the buying group (role, likely priorities, likely objections); (4) proposes one specific first-touch angle and three talking points tied to their situation; (5) lists the open questions I still need answered before outreach.

Format: A one-page brief with headed sections: Company snapshot | Priorities & triggers | Buying group | Recommended angle & talking points | Open questions. Bullets, ~350 words.

Verification: Mark every statement as [FACT] (from what I supplied) or [INFERENCE]. Do not invent revenue, headcount, funding or named individuals; label anything unverified as [ASSUMPTION TO CHECK].

Validation: Check the brief against a sceptical sales manager: is the angle specific to this account rather than something you could send anyone, and is there enough here to write a personalised opener? Name the weakest section.
```

#### `syn-hr-2` — Resume screening rubric and candidate shortlist rationale
*category:* HR & Recruiting · *role:* Recruiter · *level:* L3 · *sensitiveCategory:* true ·
*outcome:* "A screening rubric plus scored candidates with evidence-based, auditable rationale."

```
Role: Act as a recruiter designing a fair, structured resume-screening process.

Context: Role and success profile: [ROLE_PROFILE]. Essential criteria: [ESSENTIAL]. Desirable criteria: [DESIRABLE]. Evidence types that count for each: [EVIDENCE_TYPES]. Candidate summaries (anonymised where possible): [CANDIDATES]. Legal / policy constraints: [CONSTRAINTS].

Goal: Shortlist on job-relevant evidence only, consistently across candidates, with a record that would stand up to scrutiny.

Task: Produce: (1) a scoring rubric - each criterion, its weight, and what counts as strong / partial / no evidence; (2) a scored table for the candidates with a one-line evidence-based rationale per criterion; (3) a shortlist recommendation; (4) a list of information gaps to resolve at phone screen rather than assume.

Constraints: Score only on job-relevant evidence. Do not infer age, gender, ethnicity, health, caregiving status or 'culture fit'. Ignore employment gaps unless directly job-relevant. Apply the rubric identically to every candidate. Flag, do not guess, missing information.

Examples: Rubric row: 'Criterion: stakeholder management (weight 20%). Strong = led cross-functional programme with named outcomes; Partial = contributed to cross-team work; None = not evidenced.'

Format: Sections: Rubric (table) | Scored candidates (table) | Shortlist & rationale | Gaps for phone screen.

Verification: Re-check that no score relies on a protected characteristic or a proxy for one; list any criterion applied unevenly and correct it.

Validation: Have a sceptical HR business partner review two borderline candidates: is the rationale defensible and consistent? Adjust the rubric wording if it is ambiguous.
```

#### `syn-legal-10` — Data protection impact assessment (DPIA) draft
*category:* Legal & Compliance · *role:* Privacy / DPO · *level:* L3 · *sensitiveCategory:* true ·
*outcome:* "A DPIA draft: processing description, necessity/proportionality, risk assessment and mitigations."

```
Role: Act as a data protection officer drafting a DPIA for review.

Context: Processing activity and its purpose: [ACTIVITY_PURPOSE]. Data categories, subjects and volumes (including any special-category data): [DATA_SUBJECTS]. Data flows, systems, recipients and any transfers: [FLOWS]. Legal basis relied on: [LEGAL_BASIS]. Retention: [RETENTION]. Stakeholders consulted: [CONSULTED]. Applicable framework: [FRAMEWORK] (e.g. UK GDPR).

Goal: Produce a DPIA draft that a DPO and legal can finalise: a clear description, a real necessity/proportionality analysis, and risks with mitigations that reduce them to an acceptable level.

Task: Draft: (1) a systematic description of the processing and the data flows; (2) the necessity and proportionality assessment against the purpose and legal basis, including whether a less intrusive option exists; (3) a risk assessment to data subjects (each risk: source, likelihood, severity, overall) covering unauthorised access, excessive collection, loss of control, re-identification, function creep, transfers; (4) mitigations per risk and the residual risk; (5) the consultation record and the sign-off / residual-risk decisions needed.

Constraints: This is a draft for the DPO and legal to complete and approve - not a final assessment and not legal advice. Do not assert that the legal basis is valid - present the analysis. Do not minimise special-category or vulnerable-subject risks. Flag any transfer needing a transfer mechanism.

Examples: Risk row: 'Risk: re-identification of pseudonymised records via [dataset]. Source: linkage. Likelihood: medium. Severity: high. Mitigation: [k-anonymity / access controls / DPA clause]. Residual: low-medium.'

Format: Sections: Processing description & flows | Necessity & proportionality | Risk assessment (table) | Mitigations & residual risk | Consultation & sign-offs needed. ~800 words.

Verification: Check every data category, flow and recipient in the description also appears in the risk assessment; flag missing legal-basis or transfer analysis.

Validation: The DPO and legal must review and approve before processing proceeds. Pressure-test the necessity analysis: would a regulator accept that a less intrusive alternative was truly considered? Strengthen if not.
```

---

## 7. Commits

```
e324269  library: tidy placeholder hints in authored prompts
d53434e  library: add Procurement kickstart prompts (15) — completes the 200
e7be15f  library: add Operations & Supply Chain kickstart prompts (15)
d553878  library: add Data & Business Analysis kickstart prompts (15)
519c265  library: add Customer Service kickstart prompts (15)
ab2406b  library: add Project & Program Management kickstart prompts (15)
b122436  library: add Product Management kickstart prompts (15)
0bd5a8f  library: add IT & Engineering kickstart prompts (15)
6d3d071  library: add Legal & Compliance kickstart prompts (16)
265388f  library: add Finance & Accounting kickstart prompts (16)
0c9aa03  library: add L&D kickstart prompts (15)
d5d8be7  library: add HR kickstart prompts (16)
6564c10  library: add Marketing kickstart prompts (16)
8d4bfed  library: add Sales kickstart prompts (16) + authored-prompts import pipeline
24e2b02  chore: baseline snapshot before Synottic library expansion
```
