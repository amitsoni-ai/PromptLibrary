# Synottic Prompt Library — deploy

Two files in this folder: `index.html` (the whole app) and `vercel.json` (clean URLs on Vercel).
The app is a single self-contained HTML file — no build step, no server code. Every prompt from
`Prompt_Library_Catalog.xlsx` (3,367 rows) is embedded and read-only; learner-created content
lives in browser storage (or the `db` runtime capability when the host provides one).

## Push to GitHub + Vercel

```bash
git clone https://github.com/amitsoni-ai/PromptLibrary
cd PromptLibrary
cp /path/to/index.html .
cp /path/to/vercel.json .
git add index.html vercel.json
git commit -m "Synottic Prompt Library: learner platform (access codes, program library, Learn, Practice)"
git push origin main
```

Then vercel.com → Add New Project → import `amitsoni-ai/PromptLibrary` → deploy. Root `index.html`
is picked up automatically.

## Access codes (seed data, editable in the `data-orgmodel` <script> block)

| Code | Organization | Program | Scope |
|------|--------------|---------|-------|
| `SYNOTTIC-AI-01` / `-02` | Synottic AI Institute | AI Fluency for Leaders (Cohort A / B) | Full library |
| `SYNOTTIC-PM-01` | Synottic AI Institute | AI for Product Managers | Full library |
| `ACME-SALES-EMEA` / `-AMER` | Acme Corporation | AI-Assisted Sales Enablement | Program-scoped (5 categories) |
| `NORTHWIND-WRITE` | Northwind Institute | Professional Writing with AI | Program-scoped |
| `AMIT-AIL-2026` | Synottic | AI Fluency for Leaders (named learner) | Full library |
| `DEMO-2026` | Demo | AI Fluency for Leaders | Full library |

The data model (organizations → programs → cohorts → learners → access codes, plus
program/module → prompt links resolved by rule) lives entirely in the `data-orgmodel`
`<script type="application/json">` block near the end of `index.html`. Add rows there to onboard
new orgs/cohorts; module prompt lists are computed from category + keyword rules at load, so no
central prompt is ever duplicated per learner. Designed to lift into Postgres/Supabase later —
the JSON shape maps 1:1 to tables.

## What's in the app

Access-code gate · learner home (intelligent search, recommendations, prompt of the day) ·
central prompt library with generated metadata (description, use case, skill, role, outcome,
difficulty, type, tags, variables, quality score, lifecycle) · intent-aware search + filters ·
prompt detail (what it does / when to use / why it works / Original→Optimized→Learner layers) ·
Program library (module-by-module) · Learn (five principles with live examples) · Practice
(scenarios + deterministic rubric feedback) · Prompt Builder · My Library (My Prompts / Program /
Favorites / Central) · Library Governance (lifecycle stages, duplicates, needs-review). Original
prompt text and titles are never mutated.
