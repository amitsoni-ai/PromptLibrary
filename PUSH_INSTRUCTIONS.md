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

## Synottic course catalogue

`src/curriculum.py` holds the Synottic AI Institute course catalogue (7 tracks, 44 courses,
sourced from the OneDrive `AI Course Curriculum` folder). Running it regenerates:

- `part_orgmodel.json` — the 44 courses as programs (`prog-syn-*`), each with a house
  Learn -> Demonstrate -> Practice -> Apply module set and category rules.
- `part_curriculum.json` — one **Course Companion Prompt** per course (`crs-*`, source
  "Synottic Curriculum"): a reusable template that turns any in-scope task into a governed,
  step-by-step AI workflow with the exact prompts to run. These join the central library as a
  separate curated layer — the 3,367 Excel originals are never touched.
- `part_admin_seed.json` — one editable admin access code per track
  (`SYNOTTIC-FUNCTIONS`, `SYNOTTIC-LEADERS`, `SYNOTTIC-TOOLS`, `SYNOTTIC-ESSENTIALS`,
  `SYNOTTIC-WORK`, `SYNOTTIC-GOVERNANCE`, `SYNOTTIC-AGENTIC`), each mapped to every course in
  that track with full-library access. AdminStore merges these on first run.

The admin console's **Functions** list is the 13 Synottic "AI for Functions" functions
(Sales, Marketing, HR, L&D, Finance & Accounting, Legal & Compliance, IT & Engineering,
Product Management, Project & Program Management, Customer Service, Data & Business Analysis,
Operations & Supply Chain, Procurement), each carrying its target roles (from the course
outlines) and the library categories + course program it draws prompts from.

To change the catalogue: edit the `CATALOGUE` dict in `src/curriculum.py`, then
`python3 curriculum.py && python3 build.py`.

## Admin console

Open it from the "Admin console →" link on the sign-in screen. Default admin key: `SYNOTTIC-ADMIN`
(change it by setting `adminKey` in the stored `admin/config`, or edit the seed in `src/part_admin.js`).

The console lets you:
- **Create / edit organisation access codes** — map each code to Organisation, Domain, Industry,
  Functions, Roles and Programs; tick "Full library" to bypass scoping.
- **Enable / disable** codes (disabled codes are refused at sign-in, and any learner already on one
  is bounced to the gate on next load).
- **View all codes** — organisation codes plus the built-in seed codes (read-only).
- **Download prompts as .xlsx** (or .csv) filtered by access code / industry / domain / function /
  role / program. The .xlsx writer is dependency-free.

Admin-created codes are stored in `admin/config` via the `db` runtime capability when the host
provides one, otherwise in this browser's `localStorage` (shared, not per-learner). Learners then
sign in with those codes exactly like the built-in ones, and see only the programs / prompts the
code allows.

> Functions & Roles are seeded from a standard taxonomy in `src/part_admin.js` (`FUNCTIONS`).
> The SharePoint functions/roles catalogue could not be read in this build — paste its
> function → {categories, roles} mapping into `FUNCTIONS` to align exactly.

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
