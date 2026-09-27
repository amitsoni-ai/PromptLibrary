# Prompts.chat → Synottic Prompt Intelligence Audit

**Phase:** 1 (research, audit, gap analysis, recommendation). Nothing in the app, schema, UI or data was changed.
**Date:** 2026-09-27
**Sources reviewed:**

| Source | Version | How |
|---|---|---|
| Synottic library | `web/seed/prompts.json` (3,575 records) on branch `claude/synottic-prompt-audit-cxkja1` @ `0aec005` | Full read of every record |
| Synottic code and taxonomy | `migrate/schema*.sql`, `web/src/**`, `src/part_app_*.js`, `src/part_admin.js`, `src/part_framework.js`, `api/_functions.js` | Read |
| prompts.chat dataset | `f/prompts.chat` @ `f78a1c5` (2026-09-09), `prompts.csv` (2,169 prompts), `PROMPTS.md` | Full read of every prompt |
| prompts.chat app logic | `prisma/schema.prisma`, `prisma/seed.ts`, `src/lib/ai/*`, `src/lib/similarity.ts`, `src/lib/variable-detection.ts`, `src/content/book/*` | Read |

**Companion files:**

- `docs/research/PROMPTS_CHAT_MAPPING.csv`: one row for every one of the 2,169 prompts.chat prompts (no clustering reduction).
- `docs/research/tools/prompts_chat_audit.py`: the script that produced the CSV. Re-runnable, read-only.

**How to read this report.** Sections label claims as **Fact** (measured from code or data) or **Recommendation** (my judgement). Scores come from lexical heuristics, not an LLM or embeddings. Section 18 explains the limits, and section 14 gives the measured precision of the machine triage.

---

## 1. Executive Summary

**The short answer:** Synottic should use prompts.chat, but as a pattern mine, not a content feed. Roughly **10 to 15 percent** of prompts.chat (about 250 to 330 prompts) is worth transforming. After collapsing families of near-identical agent and skill files, that becomes about **150 to 200 new Synottic records**, plus about **40 improvements** to existing prompts. The other 85 to 90 percent should be ignored.

**What prompts.chat actually is (Fact).** It is not the business prompt library its reputation suggests. Of 2,169 prompts:

- 26% are image or video generation scenes (562), mostly one-off art.
- 17% are software engineering (363), plus 53 "build me this app in HTML/JS" specs and 116 agent/skill/system-prompt files.
- Only **9 prompts are HR, 4 are customer support and 18 are sales**. These are Synottic's three biggest categories (346, 371 and 135 prompts).
- 123 are not in English, 34 are unsafe (jailbreaks, sexualised image prompts, a game cheat script), and 9 are internal duplicates.

So prompts.chat is **complementary** to Synottic, not overlapping. Its value is in areas where Synottic is thin: engineering, AI/agent work, research methods, and learning. Its biggest value is not the prompts at all. It is **three product patterns** Synottic lacks: typed variables with defaults, prompt-to-prompt connections (chaining), and agent/skill definitions.

**What the audit found inside Synottic (Fact).** These matter more than the import question:

1. **A live jailbreak.** Prompt `lib-336` ("Translate resume bullets across fields", Coding & Tech) contains the full "DAN / do anything now" jailbreak text inside its body. It is marked `healthStatus: Healthy`, `qualityScore: 80`. It came in through a legacy bundle.
2. **prompts.chat content is already in Synottic without provenance.** 31 prompts.chat prompts appear verbatim inside the `legacyPrompt` of 15 Synottic records, some still carrying "Contributed by: @devisasari". prompts.chat is CC0, so this is legal, but Synottic cannot show where these came from.
3. **Categories are unreliable.** Only 27 of 152 "AI & Prompt Engineering" prompts are actually about AI or prompting. The rest include release notes, Vedic astrology and "Build trust with a wary dog". Across the library, 1,147 prompts use a persona that points to a different category than the one they are filed in.
4. **Role and category are the same field.** 16 of 28 categories have one role on 90%+ of their prompts. Role never narrows anything. The 114 enterprise roles in the function catalogue cover only 521 prompts (15%).
5. **There is no Task, Subcategory, Workflow or Agent entity.** "Tasks" exist only as 18 hard-coded Task Hubs in client JavaScript. `promptType: Workflow` is on 382 prompts, but only 27 of them have three or more steps.
6. **The rewrite made prompts uniform but generic.** Every prompt has Role/Context/Task/Format labels, but the ten most common Context lines cover 55% of the library. 461 prompts use the catch-all variable `[DESCRIBE_YOUR_SITUATION]`. 920 prompts (26%) wrap a pasted legacy body under "Follow these detailed instructions:".
7. **Quality and health signals do not discriminate.** All 3,575 prompts are "Healthy". Quality scores sit between 74 and 94. A score that never fails cannot guide anyone.

**The strategic point (Recommendation).** Adding prompts will not make Synottic better than prompts.chat. prompts.chat will always have more. Synottic wins by answering a different question: **"What is the best way to do this task in my role, safely?"** That needs a real Task layer, role-specific variants, workflows, verification and evaluation. Fix the foundation first (safety, provenance, taxonomy), then import selectively.

---

## 2. Synottic Current State

### 2.1 Architecture (Fact)

- Two front ends: the legacy single-file SPA (`index.html`, built from `src/part_*.js` by `src/build.py`) and a Next.js app in `web/` (migration in progress, see `MIGRATION.md`).
- Database: Neon Postgres. The `prompts` table stores each prompt as a `jsonb` blob (`data`) plus a few columns (`id, title, category, source, program_id, lifecycle, quality_score, origin, title_norm, archived_at`). Schema files: `migrate/schema.sql`, `schema_v3.sql`, `schema_v4.sql` (trigram indexes only).
- Access and scope: `users`, `entitlements`, `access_codes`, `collections`, `function_scopes`. A learner picks one of 14 functions at sign-up, and that sets which categories they can browse (`api/_functions.js`).
- No database credentials exist in this container, so the live DB was not queried. `web/seed/prompts.json` is the committed snapshot the Next.js app and `migrate/run.mjs` seed from. Admin edits made after that snapshot are not reflected here.

### 2.2 The prompt record (Fact)

Every record has 27 to 35 fields. The important ones:

| Field | What it holds | Observation |
|---|---|---|
| `title` | Verb-first task phrase ("Write product release notes") | Good. This is the closest thing to a Task today. |
| `category` | One of 28 values | Only classification level. No subcategory. |
| `role` | 143 distinct labels | Mostly a category alias ("Customer Support Representative"). |
| `promptType` | 13 values (Reusable Prompt, Workflow, Analysis, ...) | Mixes format (Workflow) and intent (Analysis). |
| `difficulty` | Beginner / Intermediate / Advanced (200 null) | |
| `originalPrompt` | The prompt, in labelled R-C-T-F(-V-V) lines | All 3,575 have Role, Context, Task, Format. |
| `variables` | `[UPPER_SNAKE]` names | 2,014 distinct names, no controlled vocabulary. |
| `qualityScore`, `qualityBreakdown`, `strengths`, `improvements` | Authored scores | Range 74 to 94, 65% between 80 and 84. |
| `healthStatus` | Always "Healthy" | Not a working signal. |
| `duplicateGroup` | 187 groups, 933 prompts | Groups are topical, not duplicates. `grp-18` holds 55 unrelated sales prompts. |
| `sensitiveCategory` | 782 true | 753 of them have Verification lines. Good. |
| `legacyPrompt`, `legacyTitle` | Pre-rewrite text (3,231 records) | Contains the jailbreak and the unattributed prompts.chat text. |
| `hub`, `audience` | Only on 144 Everyday Essentials | Task Hub link and work/personal split. |
| `aiTool` | Always null | |
| `source` | Original Library 3,231 · Synottic Programs 200 · Everyday Essentials 144 | No external source or licence field. |

### 2.3 How ROLE → TASK → CATEGORY → SUBCATEGORY → PROMPT → WORKFLOW is represented today (Fact)

```
FUNCTION (14, code: api/_functions.js + src/part_admin.js)
   └─ roles[] (114 enterprise roles, code only, used for admin scoping)
   └─ categories[] (which of the 28 categories a function can browse)

ROLE on prompt (143 labels) ─── effectively = CATEGORY (1:1 in 16 of 28 categories)
TASK  ─── not stored. Proxies: prompt title; 18 TASK_HUBS in src/part_app_1.js (client-side keyword router)
CATEGORY (28, a string on the prompt)
SUBCATEGORY ─── does not exist
PROMPT (3,575)
WORKFLOW ─── does not exist (promptType "Workflow" is a label on single prompts)
AGENT ─── does not exist
```

The chain the product needs exists in pieces, in different places (DB string, client JS constant, admin JS constant), and is not joined.

### 2.4 Library composition (Fact)

| Category | Prompts | Top role share | Note |
|---|---:|---:|---|
| Customer Support | 371 | 95% | |
| Marketing & Branding | 354 | 97% | |
| HR & Recruiting | 346 | 95% | |
| Social Media | 318 | 99% | |
| Legal & Compliance | 289 | 92% | |
| Content Writing & Copywriting | 177 | 95% | |
| Coding & Tech | 158 | 91% | Thin for a whole IT & Engineering function |
| AI & Prompt Engineering | 152 | 97% | Only 27 are really about AI |
| Sales & Lead Generation | 135 | 89% | |
| Business Strategy | 121 | 71% | |
| Finance & Accounting | 121 | 83% | |
| Education & Learning | 119 | 81% | |
| SEO & Analytics | 114 | 96% | |
| Research & Data Analysis | 97 | 70% | |
| Email Marketing | 91 | 98% | |
| General | 91 | 88% | A catch-all ("Funny caption", "Manage a crisis") |
| Productivity & Automation | 79 | 58% | |
| Presentation & Slides | 78 | 90% | |
| Image & Design | 65 | 100% | |
| Communication & Leadership | 62 | 53% | |
| E-Commerce | 56 | 98% | |
| Book & Ebook Writing | 39 | 100% | |
| Coaching & Self-Development | 39 | 85% | |
| UX/UI Design | 32 | 94% | |
| Health & Fitness | 28 | 89% | |
| Career Growth | 19 | 53% | |
| Product Management | 17 | 53% | A full function with 17 prompts |
| Spirituality & Wellness | 7 | 100% | |

### 2.5 Search, discovery and recommendation (Fact)

- **Search** (`src/part_app_1.js`): client-side weighted field search, a hand-written synonym table (`INTENT_SYNONYMS`, about 90 entries), intent-to-category routing (`INTENT_CATEGORY`), a light stemmer, typo correction by edit distance, and Task Hub detection. It is good lexical search. It has no semantic layer, so "help me handle a tough 1:1" only works if a synonym was hand-written for it.
- **Next.js search** (`web/src/server/prompts.ts`): filters the cached catalogue in JS. Trigram indexes are prepared in `schema_v4.sql`.
- **Recommendations** (`web/src/lib/recommend.ts`): a score from quality, saved categories, function scope and difficulty vs engagement. No collaborative signal, no task context.
- **Framework** (`src/part_framework.js`): detects L1/L2/L3 from the labelled lines and powers feedback, practice and "my prompt vs model" compare. This is a real differentiator.
- **Analytics**: an `activity` table logs opened / copied / tested / favorited / improved / searched events. Nothing feeds that back into quality scores yet.
- **Duplicate detection**: title-normalised dedupe on insert (`title_norm + category`) and the static `duplicateGroup`. No content similarity.
- **Validation**: Zod contracts in `web/src/contracts`, admin-side field checks in `api/_validate.js`. No content safety check on prompt bodies.

### 2.6 Existing quality framework (Fact)

The R-C-T-F / R-C-T-F-V-V / R-C-G-T-C-E-F-V-V three-level framework (`AI Prompting Framework_ 3 Levels.md`) is the core of Synottic's identity and is applied to 100% of prompts. Level mix: L1 781, L2 2,412, L3 382. Only the 382 L3 prompts have Goal, Constraints and Examples.

---

## 3. Prompts.chat Dataset Overview

### 3.1 What could and could not be reviewed

| Item | Reviewed? | Notes |
|---|---|---|
| `prompts.csv`, all 2,169 rows | Yes, 100% | Columns: `act, prompt, for_devs, type, contributor`. |
| `PROMPTS.md` | Yes | Same prompts in Markdown with contributor links. No extra metadata. |
| Categories | **No** | Not in the repo. `prisma/seed.ts` fetches them from `https://prompts.chat/prompts.json`. That host is blocked by this environment's network policy (`EGRESS_BLOCKED`), for both curl and WebFetch. |
| Tags | **No** | Same reason. |
| Votes, views, featured flags, `bestWithModels`, prompt connections | **No** | Live DB only. |
| App logic (schema, quality check, similarity, variables, prompt builder, improve-prompt, book) | Yes | Read from source. |

Because categories and tags were unavailable, this audit built its own **analytic domain** classification (section 4). This is also what the brief asked for: "Do not rely only on prompts.chat's website categories."

To close this gap later: run `prisma/seed.ts`'s fetch from a machine that can reach prompts.chat, save the JSON, and re-run `docs/research/tools/prompts_chat_audit.py` with a small change to read categories and tags. The CSV already has `source_category` and `source_tags` columns for this. For now `source_category` says "not in repo (live DB only)" and `source_tags` holds the flags this audit detected (interactive, skill_file, tool refs, non-English, likeness).

### 3.2 Shape of the data (Fact)

| Measure | Value |
|---|---|
| Prompts | 2,169 |
| Type | TEXT 1,836 · STRUCTURED (JSON/YAML) 312 · IMAGE 21 |
| `for_devs` = TRUE | 159 |
| Distinct contributors | 1,045 |
| Median length | 138 words (P10 42, P90 674, max 17,181) |
| Classic "I want you to act as ..." | 195 |
| Uses `${variable}` syntax | 594 (27%) |
| SKILL.md-style front matter | 95 |
| Not English | 123 |
| Likeness risk ("person from the uploaded photo") | 81 |
| Medium-risk advice (medical, legal, financial, mental health) | 188 |
| Jailbreak (after removing defensive mentions) | 2 |
| Sexualised / NSFW | 31 |
| Malicious (game cheat script) | 1 |
| Internal duplicates | 11 clusters, 22 prompts |

### 3.3 Analytic domains (Fact, from this audit's classifier)

| Domain | Prompts | Share |
|---|---:|---:|
| Visual generation (image/video scenes) | 562 | 26% |
| Software engineering | 363 | 17% |
| Other / unclassifiable (mostly non-English or very short) | 134 | 6% |
| Agent / system prompt / skill files | 116 | 5% |
| Education | 104 | 5% |
| Business strategy | 83 | 4% |
| Productivity | 80 | 4% |
| Marketing & content | 79 | 4% |
| Simulation / games / role-play | 67 | 3% |
| Research | 53 | 2% |
| Creative writing | 53 | 2% |
| App build specs ("build X in HTML/JS") | 53 | 2% |
| Health & wellbeing | 48 | 2% |
| Design / UX | 45 | 2% |
| Career | 42 | 2% |
| Finance | 42 | 2% |
| Data / ML | 41 | 2% |
| Lifestyle (travel, food, fashion) | 40 | 2% |
| Language (translation, learning) | 38 | 2% |
| Unsafe | 34 | 2% |
| Prompt engineering | 34 | 2% |
| Legal | 22 | 1% |
| Sales | 18 | 1% |
| HR & people | 9 | <1% |
| Spirituality | 5 | <1% |
| Customer support | 4 | <1% |

### 3.4 How prompts.chat organises prompts (Fact, from app code)

- `Prompt` has one `category` (hierarchical via `parentId`), many `tags`, a `type` (TEXT, IMAGE, VIDEO, AUDIO, STRUCTURED, SKILL, TASTE) and a `structuredFormat`.
- `PromptConnection` links prompts with a label and order. This is chaining.
- `PromptVersion` and `ChangeRequest` give versioning and community edits.
- `bestWithModels` (max 3) and `bestWithMCP` record which models and tools a prompt suits.
- `embedding` powers semantic search and "improve my prompt" (which retrieves 3 similar prompts as inspiration).
- `quality-check.prompt.yml` is a deliberately lenient LLM gate. It only delists non-English, gibberish, or non-prompts. It approves almost everything.
- `similarity.ts` detects duplicates with Jaccard word overlap plus character trigrams after stripping variables.
- `variable-detection.ts` recognises seven placeholder styles and normalises them to `${name:default}`.

**Takeaway (Recommendation):** prompts.chat is built for breadth and community volume, with a permissive quality gate. Synottic should copy its **mechanisms** (typed variables, connections, versions, model hints, embeddings, variable normalisation) and keep its own **strict curation**.

---

## 4. Taxonomy Comparison

### 4.1 Side by side (Fact)

| Level | Synottic | prompts.chat |
|---|---|---|
| Function / department | 14 functions (code only), drives access scope | None |
| Role | 143 labels on prompts + 114 catalogue roles; role ≈ category | None stored. The `act` title often names a persona ("Linux Terminal", "Job Interviewer"). |
| Task | Not stored. 18 Task Hubs in client JS. | None |
| Category | 28 flat values | Hierarchical categories (live DB, not reviewed) |
| Subcategory | None | Via category `parentId` |
| Tags | Auto-extracted words, noisy ("what", "adjective", "insert" on 860 prompts) | Curated tags (live DB, not reviewed) |
| Prompt type | 13 mixed intent/format values | 7 output-media types |
| Workflow | None | `PromptConnection` chains |
| Agent / skill | None | `SKILL` type, SKILL.md files |
| Model fit | `aiTool` (always null) | `bestWithModels`, `bestWithMCP` |
| Framework level | L1 / L2 / L3 (derived) | None |

### 4.2 Findings

- **Fact:** Synottic's taxonomy is deeper in the business dimension (functions, roles, framework levels) and shallower in structure (no task, subcategory, workflow or agent).
- **Fact:** prompts.chat's taxonomy is shallow in the business dimension and deeper in media type and composition (types, connections, skills).
- **Recommendation:** Do not adopt prompts.chat's categories. They are built around content type ("Image", "Coding") not work. Synottic's function → role → task direction is the right one. It just needs to be made real.

### 4.3 Mapping coverage of prompts.chat onto Synottic's existing taxonomy (Fact)

| Field | Mapped to an existing value | Flagged as unmappable |
|---|---:|---:|
| Category | 1,905 (88%) | 264 (12%): simulation, lifestyle, language, non-English "other" |
| Role (existing labels or catalogue roles) | 1,936 (89%) | 233 |
| Task Hub | 1,237 (57%) | 932 (43%) |
| Subcategory | 0 (Synottic has none) | All. Proposed values are marked `PROPOSED:` in the CSV. |

The 43% Task Hub miss rate is itself a finding: Synottic's 18 hubs are consumer-style jobs ("Make a presentation", "Personal life & money"). They cannot represent professional tasks like "Review a pull request", "Design an API" or "Run a literature review".

---

## 5. Role Comparison

**Facts:**

- prompts.chat prompts name a persona in 1,103 of 2,169 cases, with 971 distinct role strings. The most common are all engineering: software developer, web developer, software engineer, architect, full-stack developer.
- Only a handful name a Synottic business role: recruiter (2), marketing strategist (2), market research analyst (3), stock market analyst (2).
- Synottic's function catalogue has 114 enterprise roles and every one of them is used on at least one prompt, but only 521 prompts (15%) carry a catalogue role. The other 85% use a category-level label such as "Customer Support Representative" or a generic label ("Any Professional", "Working professional", "Anyone, at work or home"; 224 prompts).

**Roles prompts.chat covers that Synottic represents weakly:**

| Role (existing in Synottic catalogue) | Synottic prompts using it | prompts.chat Group A candidates |
|---|---:|---:|
| Software Engineer | 4 | 81 |
| Solutions Architect | 1 | 48 |
| Security Engineer | 1 | 27 |
| QA Engineer | 2 | 17 |
| DevOps / SRE | 2 | 16 |
| Data Scientist | 2 | 2 (plus data prompts mapped to "Analyst / Researcher") |
| UX Researcher | 2 | 1 (plus design-system audits mapped to "UX/UI Designer") |

**Recommendation:** Do not add roles from prompts.chat. The catalogue already has the right enterprise roles. The problem is that prompts are not tagged with them. Re-tag existing prompts to catalogue roles first (a role can have many prompts, and a prompt can serve several roles). Roles like "Prompt Engineer / AI Practitioner" should be split, since today it labels release notes and astrology.

---

## 6. Task Comparison

**Facts:**

- Synottic has no Task entity. The nearest things are verb-first titles (3,575 of them, effectively 3,575 tasks with no grouping) and 18 Task Hubs.
- prompts.chat has no Task entity either. Its titles are persona or artefact names ("Linux Terminal", "Product Infographic").
- Group A candidates by Task Hub: Plan a project 76, Get more from AI 69, Code & tech help 57, Learn anything faster 50, Summarize & write reports 31. 181 (29%) fit no hub.

**Tasks that prompts.chat shows demand for and Synottic lacks (from the Group A candidates):**

| Proposed task (flag, not created) | Evidence (prompts.chat IDs) | Existing Synottic neighbour |
|---|---|---|
| Review code or a pull request | pc-1268, pc-1498, pc-0527, pc-1633 | `syn-it-eng-2` Code review and refactoring recommendations |
| Write tests for code | pc-1355, pc-1495 | none |
| Diagnose a bug and plan the fix | pc-1714, pc-1715, pc-1147 | `ev-decide-2` Find the root cause of a problem (generic) |
| Design or review an API / architecture | pc-1471, pc-1472 | `lib-1982` API spec for a security feature (narrow) |
| Write a commit message / change summary | pc-0141 | `lib-369` Summarise code changes for a team |
| Hand off design to engineering | pc-1435 | none |
| Explain technical work to non-technical people | pc-1432, pc-0699 | `ev-tech-2` Explain what this code does |
| Build a context document for an AI session | pc-1001, pc-1915 | `lib-401` Export AI chats to documents |
| Design an AI agent or skill | pc-2029, pc-0999 | `lib-233` Plan a multi-agent AI business system |
| Run a literature review | pc-0816, pc-1754 | none in Research & Data Analysis |
| Handle missing data in a dataset | pc-1419 | none |
| Research an account or company before a meeting | pc-1173, pc-1364 | `syn-sales-*` (partial) |
| Organise a legal question before seeing a lawyer | pc-1143 | none |
| Audit a design system | pc-1516, pc-1426, pc-1430 | none |

**Recommendation:** Introduce Task as a first-class concept (section 19). Seed it from Synottic's own titles, grouped. Use these prompts.chat tasks to fill gaps, especially under IT & Engineering, Data & Business Analysis and Product Management.

---

## 7. Category Comparison

**Fact:** Of the 2,169 prompts, the machine triage maps Group A candidates into existing categories as follows:

| Synottic category | Group A candidates | Synottic today | Reading |
|---|---:|---:|---|
| Coding & Tech | 217 | 158 | Large gap. Needs subcategories. |
| AI & Prompt Engineering | 90 | 152 (27 real) | Real gap hidden by mis-filed prompts |
| Research & Data Analysis | 43 | 97 | Useful methods content |
| Education & Learning | 42 | 119 | Tutoring and study patterns |
| Productivity & Automation | 41 | 79 | |
| Business Strategy | 39 | 121 | Account and market research workflows |
| Marketing & Branding | 36 | 354 | Mostly SEO / ASO / content repurposing |
| Image & Design | 21 | 65 | Business visuals only |
| UX/UI Design | 18 | 32 | Design systems |
| Health & Fitness | 17 | 28 | High risk, low priority |
| Legal & Compliance | 15 | 289 | A few strong intake patterns |
| Finance & Accounting | 12 | 121 | Weak candidates |
| Sales & Lead Generation | 9 | 135 | |
| Career Growth | 7 | 19 | |
| Book & Ebook Writing | 7 | 39 | |
| HR & Recruiting | 3 | 346 | Nothing to learn here |
| Customer Support | 2 | 371 | Nothing to learn here |
| Unmapped (language, simulation) | 13 | n/a | |

**Recommendation:**

- Keep the 28 categories for now, but fix filing: move the ~125 non-AI prompts out of "AI & Prompt Engineering", and empty "General" into real homes.
- Add a **subcategory** level before importing anything into Coding & Tech or AI & Prompt Engineering (section 13).
- Social Media and Email Marketing overlap heavily with Marketing & Branding. Consider them subcategories of a Marketing category in the taxonomy redesign, not now.

---

## 8. Prompt Quality Comparison

One rubric (10 craft criteria, 0 to 2 each, scaled to 100) was applied to **both** libraries with the same code (`craft_scores()` in the tool). It rewards the presence of each element, not how good it is.

| Criterion (avg 0-2) | prompts.chat | Synottic |
|---|---:|---:|
| Clear objective | 1.12 | 2.00 |
| Role | 0.83 | 1.83 |
| Context | 0.35 | 1.47 |
| Specific task | 1.80 | 1.82 |
| Constraints | 0.85 | **0.32** |
| Output format | 0.59 | 1.75 |
| Variables | 0.58 | 1.60 |
| Examples | 0.28 | **0.27** |
| Verification | 0.43 | 1.57 |
| Reusability | 0.94 | 2.00 |
| **Craft score (0-100)** | **39** | **73** |

Distribution: prompts.chat is spread wide (46 prompts under 10, 70 at 80+). Synottic is packed between 50 and 90.

**What this means (Recommendation):**

- **Synottic is structurally stronger.** Its R-C-T-F-V-V labels guarantee the skeleton. prompts.chat has no standard at all.
- **Synottic is weaker on the two things that make outputs specific: constraints and examples.** Only 382 prompts (the L3 ones) have either, and even those reuse a few stock lines (the top Constraints line appears 75 times, the top Examples line 75 times).
- **Synottic's Context is often boilerplate.** "I'm marketing to a specific audience and need ideas and copy that sound like our brand" appears 314 times. A context line that fits 314 prompts tells the model nothing.
- **The best prompts.chat prompts beat Synottic in depth.** Examples: pc-1404 SQL Query Builder (dialect-aware, index advice, explain plan), pc-1432 "Explain It Like I Built It" (audience ladder), pc-1143 legal intake organiser (neutral, refuses advice, builds a fact sheet). These have domain constraints and edge cases that Synottic's templated rewrites lack.

---

## 9. Duplicate / Overlap Analysis

**Method (Fact):** each prompts.chat prompt was compared with every Synottic prompt by (a) TF-IDF cosine on content (title twice, task line, first 150 words, plus Synottic's description, outcome and legacy text), (b) character n-gram similarity of titles (only counted when content also overlaps), and (c) an exact check of the first 12 words against every Synottic `legacyPrompt`.

**Results (Fact):**

| Overlap with Synottic | Prompts |
|---|---:|
| Verbatim already inside Synottic legacy text (score 1.00) | 31 |
| Strong (score 0.45 to 0.99) | 92 |
| Moderate (0.28 to 0.45) | 215 |
| Weak or none (< 0.28) | 1,831 |

Classified outcomes (after safety and scope rules run first): `A` Already covered 79 (29 verbatim + 50 by similarity) · `B` Similar 120 · `C` Better version 4.

**Inside prompts.chat (Fact):** 11 duplicate clusters, 22 prompts (normalised text hash or TF-IDF ≥ 0.80). Keep the highest-scoring copy.

**Inside Synottic (Fact):** the earlier merge pass worked. Only 6 task-line pairs remain at ≥ 0.80 similarity, for example `lib-769` "Persuasive email to win a customer" and `lib-952` "Why choose us email" (1.00), `lib-870` and `lib-944` order cancellation (0.93), `lib-3345` and `lib-3348` usability testing (0.92). The `duplicateGroup` field does not reflect this. It groups by topic.

**Limitation (Fact):** lexical similarity under-detects paraphrases. Example: pc-1959 "distill" scores only 0.11 against `lib-504` "Distil a complex concept", which is the same job. Real overlap is higher than the table shows. The Phase 2 pipeline must use embeddings (section 18).

---

## 10. Missing Use Cases

Use cases with evidence in prompts.chat, low overlap with Synottic, and business value. Ranked by value to Synottic's enterprise audience.

| # | Use case | Evidence | Value | Why |
|---|---|---|---|---|
| 1 | Engineering review work (code review, tests, security review, dependency hygiene) | 45 code-review, 44 testing, 25 security candidates | High | IT & Engineering is one of 14 functions but has 158 prompts, none on these tasks |
| 2 | Working with AI itself (context handoff docs, agent design, skill authoring, prompt improvement) | 90 candidates in AI & Prompt Engineering | High | Synottic teaches AI use, but has almost no prompts about managing AI work |
| 3 | Research methods (literature review, source analysis, missing data, comparative deep-scan) | pc-0816, pc-1419, pc-1958, pc-1754 | High | Research & Data Analysis has results-oriented prompts but few method prompts |
| 4 | Explaining technical work to non-technical people | pc-1432, pc-0699, pc-1274 | High | Cross-functional, fits Synottic's human-centred angle |
| 5 | Account and market intelligence before a meeting | pc-1173, pc-1174, pc-1364 | High | Sales and strategy; needs web search, so flag capability |
| 6 | Legal intake and triage (organise the facts, not give advice) | pc-1143, pc-0668 | High | Exactly the human-in-the-loop posture Synottic wants |
| 7 | Design system audits and design-to-engineering handoff | pc-1516, pc-1426, pc-1430, pc-1435 | Medium | UX/UI has 32 prompts |
| 8 | Structured tutoring (Socratic, exam prep, course mastery) | pc-1210, pc-1851, pc-1843 | Medium | Fits L&D and the Learn section |
| 9 | Content repurposing and style matching | pc-2030, pc-0987 | Medium | Marketing |
| 10 | Business visuals with variables (product infographic, catalogue render) | pc-1837, luxury infographic | Medium | Image & Design is general art today |
| 11 | Practice and role-play simulations for training (interview, negotiation, feedback conversations) | pc-0004 (covered by `lib-1514`), debate coach | Medium | Better built as interactive agents than prompts |

---

## 11. Missing Roles

**Recommendation: create no new roles now.** Every high-value role in the evidence already exists in `src/part_admin.js` FUNCTIONS. The gap is tagging, not vocabulary.

Flags for the taxonomy redesign:

| Flag | Evidence | Suggestion |
|---|---|---|
| "Prompt Engineer / AI Practitioner" is overloaded | 147 prompts, most not about AI | Split into real AI roles (AI Practitioner, AI Product Owner, Automation Lead) only if the AI function becomes a program. Until then, re-file. |
| No "AI Champion / Enablement Lead" role | Synottic's own mission is AI enablement; 90 AI-work candidates | Worth adding if Synottic sells an AI enablement track |
| No "Technical Writer" role | pc-1481, pc-1432 | Could sit under IT & Engineering |
| Generic labels ("Any Professional", "Working professional", "Anyone, ...") | 224 prompts | Replace with a `user_type` field (Business professional / Technical / Personal) instead of a fake role |

---

## 12. Missing Tasks

Synottic has no task layer, so every task in section 6 is technically "missing". The ones worth creating first, by function:

| Function | Tasks to add (flag for approval) |
|---|---|
| IT & Engineering | Review a pull request · Write unit tests · Diagnose a bug · Security-review web code (OWASP) · Plan dependency upgrades · Design an API · Write a commit / change summary · Document a system for non-engineers · Hand off design to engineering |
| Data & Business Analysis | Handle missing data · Build and optimise a SQL query · Profile a new dataset · Compare options in a deep-scan table |
| Product Management | Write a PRD (pc-1188) · Prioritise a sprint backlog (pc-0977) · Synthesise user feedback (pc-0976) · Audit a design system |
| Cross-functional (AI work) | Write a context document for AI · Improve my prompt · Design an agent · Check an AI answer for hallucination · Export and summarise an AI chat |
| Legal & Compliance | Organise facts before seeing a lawyer · Choose an open-source licence · Check an app against store review rules |
| Sales / Strategy | Research an account before a meeting · Build an industry brief |
| L&D | Turn a lecture transcript into notes · Build a Socratic tutoring session · Build an exam-prep plan |

**Also flag (Fact):** the 18 Task Hubs cannot hold these. A Task Hub is a consumer "front door", not a task. Keep hubs as a UX layer on top of a real task list.

---

## 13. Missing Categories

**Recommendation:** add **no new top-level categories** now. Add a **subcategory** level where the evidence is strong. Every row below is a flag for approval, not a change.

| Area | Status | Proposed subcategories (flag) | Evidence |
|---|---|---|---|
| Coding & Tech | Exists, no depth | Code review · Testing & QA · Debugging · Architecture · Security · DevOps & infrastructure · Databases & SQL · Technical documentation | 217 Group A candidates |
| AI & Prompt Engineering | Exists, mis-filled | Prompt improvement · Context engineering · Agent & skill design · AI output checking | 90 candidates |
| Research & Data Analysis | Exists | Academic / literature research · Data preparation · Fact-checking | 43 candidates |
| Education & Learning | Exists | Assessment · Curriculum design · Tutoring | 42 candidates |
| Image & Design | Exists | Marketing visuals · Logo & icon · Video | 21 candidates |
| Language & translation | **No home** | Do not create. Map business translation into Content Writing & Copywriting (editing). Reject language-learning drills. | 38 prompts, low enterprise value |
| Entertainment / simulation | **No home** | Do not create. Out of scope. | 67 prompts |
| Lifestyle | **No home** | Do not create. Everyday Essentials "life" hub already covers core life admin. | 40 prompts |

**Categories to reconsider in Synottic itself (flag):** "General" (91 prompts with no real theme), "Spirituality & Wellness" (7 prompts), and "Social Media" vs "Marketing & Branding" vs "Email Marketing" (three categories for one function).

---

## 14. Prompts Worth Importing

### 14.1 Machine triage result (Fact)

| Group | Prompts | Share |
|---|---:|---:|
| **A. Import / Adapt** | 632 | 29% |
| of which P1 (High value and craft ≥ 55) | 386 | |
| of which P2 | 246 | |
| **B. Improve / Merge** | 24 | 1% |
| **C. Reject / Ignore** | 1,513 | 70% |

Group A by match type: J (agent) 151 · E (new task/area) 127 · K (needs transformation) 127 · I (workflow) 119 · D (missing use case) 108.

### 14.2 Measured precision of the triage (Fact)

I hand-checked random samples of Group A against the question "would this belong in an enterprise, human-centred Synottic library after transformation?"

| Sample | Checked | Truly belongs | Precision |
|---|---:|---:|---:|
| P1 (two independent samples) | 60 | 35 | ~58% |
| P2 (two independent samples) | 40 | 14 | ~35% |
| Group C (false-reject check) | 40 | 37 correctly rejected | ~93% |

With samples this size, treat these as ±12 points. The samples were drawn during the last two calibration rounds. The rules added after them (synthetic identity, precise jailbreak/NSFW context) only moved items out of Group A, so precision today is the same or slightly higher. **Expected true Group A: about 310 prompts (≈14% of prompts.chat).** The typical false positives are one-off project specs ("Czech invoice PDF app"), niche domains (RNA-seq, vacuum arc modelling), platform-specific builds, and odd personas. This is why section 18 puts an LLM classifier and human review between triage and import.

After collapsing families (the 32-prompt "Agent Role" series by one contributor, 85 SKILL.md files, 9 sub-agent definitions, several near-identical lead generators), **the realistic number of distinct new Synottic records is about 150 to 200.**

### 14.3 Recommended first tranche (hand-curated)

These are the strongest candidates I read in full or in large part. Titles are proposed Synottic-style, verb-first. Targets use existing values only. "New" items are flags.

| Source | Source title | Synottic title (proposed) | Category / (proposed subcat) | Role (existing) | Task Hub | Build as |
|---|---|---|---|---|---|---|
| pc-1404 | SQL Query Builder & Optimiser | Write and optimise a SQL query | Research & Data Analysis / (Databases & SQL) | Data Analyst | Excel, data & charts | Workflow |
| pc-1419 | Missing Values Handler | Decide how to handle missing data | Research & Data Analysis / (Data preparation) | Data Scientist | Excel, data & charts | Workflow |
| pc-0816 | Literature Review Writing Assistant | Run a literature review | Research & Data Analysis / (Academic research) | Analyst / Researcher | Summarize & write reports | Workflow |
| pc-1958 | diff (Deep-Scan Comparative) | Compare the main options in a field | Research & Data Analysis | Analyst / Researcher | Learn anything faster | Prompt |
| pc-1268 + pc-1498 | Principal AI Code Reviewer; Code Review Agent Role | Review a pull request | Coding & Tech / (Code review) | Software Engineer | Code & tech help | Agent + prompt (merge into `syn-it-eng-2`) |
| pc-1355 | Python Unit Test Generator | Write unit tests for this code | Coding & Tech / (Testing & QA) | QA Engineer | Code & tech help | Prompt |
| pc-1633 | Web App Security Code Review (OWASP) | Security-review web application code | Coding & Tech / (Security) | Security Engineer | Code & tech help | Prompt, sensitive |
| pc-1714 + pc-1715 | Handle bug in feature; Details of the given bug | Diagnose a bug and plan the fix | Coding & Tech / (Debugging) | Software Engineer | Code & tech help | Workflow |
| pc-1391 | Dead Code Surgeon | Plan a dead-code clean-up | Coding & Tech / (Architecture) | Software Engineer | Code & tech help | Workflow |
| pc-0141 | Conventional Commit Message Generator | Write a commit message from a diff | Coding & Tech | Software Engineer | Code & tech help | Prompt |
| pc-1471 | API Design Expert Agent Role | Design or review an API | Coding & Tech / (Architecture) | Solutions Architect | Code & tech help | Agent |
| pc-1500 | Dependency Manager Agent Role | Plan safe dependency upgrades | Coding & Tech / (DevOps) | DevOps / SRE | Code & tech help | Agent |
| pc-1432 | "Explain It Like I Built It" | Explain technical work to non-technical colleagues | Coding & Tech / (Technical documentation) | Solutions Architect | Learn anything faster | Prompt |
| pc-0699 | Non-Technical IT Help & Clarity Assistant | Get plain-English IT help | Productivity & Automation | IT Support Lead | Code & tech help | Agent |
| pc-1435 | Design Handoff Notes | Write design handoff notes for engineers | UX/UI Design | Product Designer | Summarize & write reports | Prompt |
| pc-1516 + pc-1426 | Design System Consistency Auditor; Extraction Kit | Audit a design system | UX/UI Design | UX/UI Designer | Solve a problem or decide | Workflow |
| pc-1001 + pc-1915 | Universal Context Document; Chat Summary and Export | Build a context document for your AI session | AI & Prompt Engineering / (Context engineering) | Prompt Engineer / AI Practitioner | Get more from AI | Prompt (merge with `lib-401`) |
| pc-2029 | AI Agent Architect (15 steps) | Design an AI agent before you build it | AI & Prompt Engineering / (Agent design) | Solutions Architect | Get more from AI | Workflow |
| pc-0999 | Skill Creator | Write a reusable AI skill | AI & Prompt Engineering / (Agent design) | Prompt Engineer / AI Practitioner | Get more from AI | Agent |
| pc-0992 + pc-1670 | Master Prompt Architect; PromptForge | (improve) Improve my prompt | AI & Prompt Engineering | Prompt Engineer / AI Practitioner | Get more from AI | Merge into `lib-1305` |
| pc-0976 | Feedback Synthesizer | Synthesise user feedback into themes | Product Management | Product Manager | Customers & sales | Agent |
| pc-1188 | PRD | Write a product requirements document | Product Management | Product Manager | Plan a project | Compare with `syn-product-2` first |
| pc-0977 | Sprint Prioritizer | Prioritise a sprint backlog | Product Management | Product Owner | Plan a project | Agent |
| pc-1173 + pc-1364 | Advanced Account Research; Company Intel Report | Research an account before a meeting | Sales & Lead Generation | Account Manager | Customers & sales | Workflow, needs web search |
| pc-1174 | Industry/Market Intelligence | Build an industry brief | Business Strategy | Strategist / Business Leader | Summarize & write reports | Workflow, needs web search |
| pc-1211 | Project Breakdown | Break a project into workstreams | Business Strategy | Project Manager | Plan a project | Prompt |
| pc-1969 + pc-1975 | devil adv; Probe | Stress-test an argument | Productivity & Automation | Strategist / Business Leader | Solve a problem or decide | Prompt |
| pc-1502 | Post-Implementation Audit Agent Role | Run a post-implementation review | Productivity & Automation | Project Manager | Solve a problem or decide | Agent |
| pc-1143 | I Think I Need a Lawyer: Neutral Legal Intake | Organise the facts before you see a lawyer | Legal & Compliance | Legal / Compliance Professional | Summarize & write reports | Prompt, sensitive |
| pc-0668 | License Selection Assistant | Choose an open-source licence | Legal & Compliance | Legal Counsel | Solve a problem or decide | Prompt, sensitive |
| pc-0877 | transcript_to_notes | Turn a lecture or meeting transcript into notes | Education & Learning | Instructional Designer | Learn anything faster | Prompt |
| pc-1210 | Socratic Universal Tutor | Learn a topic through Socratic questions | Education & Learning | Educator / Instructional Designer | Learn anything faster | Agent |
| pc-1843 | Personalized Exam Preparation Tutor | Build a personal exam-prep plan | Education & Learning | Educator / Instructional Designer | Learn anything faster | Workflow |
| pc-1260 | Elite SEO Blog Architect | Plan and write an SEO article | Marketing & Branding / (SEO) | SEO Specialist | Edit, rewrite & proofread | Workflow (check vs `lib-777`) |
| pc-2030 | Copy Script Style | Match the style of a reference video script | Marketing & Branding / (Social content) | Social Media Manager | LinkedIn & personal brand | Prompt |
| pc-1837 | Product Infographic | Design a product infographic | Image & Design / (Marketing visuals) | Designer | Make a presentation | Prompt |
| pc-0570 | Universal Lead & Candidate Outreach | Write personalised outreach to a lead or candidate | Sales & Lead Generation | Sales Executive | Customers & sales | Prompt |

Every item needs the standard transformation: Synottic title, R-C-T-F-V-V rewrite, `[VARIABLES]` from the controlled list, a Verification and Validation pair, a strong/weak example, removal of model and tool names, and provenance fields (section 19.3).

---

## 15. Prompts Worth Improving

### 15.1 Specific merges (triage Group B, plus Group A items that overlap an existing prompt; checked by hand)

| Source | Improves Synottic | What to take |
|---|---|---|
| pc-1784 Smart Project Timeline Builder | `lib-374` Create a project timeline | Dependency and critical-path handling, buffer rules |
| pc-2011 B2B Market Research | `lib-2429` Market research on customer needs | Segment-by-segment structure, source grading |
| pc-1762 YouTube Script Engine | `lib-3078` YouTube video script | Retention beats and hook timing |
| pc-1360 Critical Thinking (DeepThink) | `lib-1166` Build critical thinking skills | Assumption and counter-argument steps |
| pc-1342 Landing Page Copy Architect | `lib-1271` High-converting SaaS landing page copy | Conversion framework and objection handling |
| pc-0801 Google Ads Title Copywriter | `lib-2214` Start a Google Ads campaign | Character limits as hard constraints |
| pc-2038 LinkedIn "About" Section Writer | `lib-1089` LinkedIn About section | Three alternative voices |
| pc-0960 SWOT for Political Risk | `ev-decide-3` Do a SWOT analysis | PESTLE add-on for international context |
| pc-1885 Business Engineer Dashboard Creator | `lib-2835` Build a sales dashboard | KPI definition table before layout |
| pc-1498 Code Review Agent Role | `syn-it-eng-2` Code review and refactoring | Severity levels, security pass |
| pc-0992, pc-1670 prompt improvers | `lib-1305` Prompt optimiser (Lyra) | Diagnose-then-rewrite loop; remove "GPT-4" references in `lib-1305` |
| pc-1959 distill | `lib-504` Distil a complex concept | Analogy-first structure. Triage marked it "import", but it is the same job: merge, do not add |

### 15.2 Pattern-level improvements for the whole Synottic library

These come from comparing the best prompts.chat prompts with Synottic's weakest areas. No wording is copied.

| Pattern | Seen in | Synottic gap it fixes | Size of gap |
|---|---|---|---|
| **Typed variables with defaults** (`${dialect:PostgreSQL}`) | 594 prompts.chat prompts | Variables are bare names. 461 prompts use `[DESCRIBE_YOUR_SITUATION]`. | 2,014 distinct variable names |
| **Task-specific context** | best 10% of prompts.chat | Top-10 Context lines cover 55% of Synottic | ~2,000 prompts |
| **Domain constraints** (limits, must-nots, edge cases) | SQL, security, legal intake prompts | Constraints only on 382 prompts, mostly stock | 3,193 prompts without |
| **Worked examples** | few-shot and strong/weak examples | Examples only on 385 prompts, 105 distinct | 3,190 prompts without |
| **Clarify-first step** ("ask up to 3 questions if X is missing") | interactive prompts | Synottic always assumes input is complete | library-wide |
| **Output contract** (exact sections, JSON schema when it feeds another step) | STRUCTURED prompts | Format lines are generic ("Headed sections with bullets") | 64% share top-10 lines |
| **Refusal and scope rules** ("do not give legal advice; organise facts") | pc-1143 | Stated as a Constraint only in L3 | 782 sensitive prompts |
| **Replace pasted legacy bodies** | n/a | 920 prompts contain "Follow these detailed instructions:" plus old text, often with "ChatGPT" and bundled unrelated prompts | 920 prompts, 793 over 250 words |

---

## 16. Prompts to Reject

**Group C: 1,513 prompts (70%).** Reasons (Fact):

| Reason | Prompts | Examples |
|---|---:|---|
| Weak: too thin or unstructured (craft < 25 or < 15 words) | 513 | "Fancy Title Generator", "Physiology pratical" |
| One-off image / scene description | 201 | "Football Match", "Echoes of the Rust Age", selfie scenes |
| Usable but generic (uncovered topic, craft < 40) | 151 | "Revenue Model & Unit Economics Analyzer" (topic is good, cheaper to author fresh) |
| Not in English | 123 | "Escritor de Livros Completo", French banking prompts |
| Similar to a Synottic prompt and not stronger | 100 | "Debate Coach" → `lib-657` |
| Not covered, but low business value | 67 | "Movie Critic", "Film Critic" |
| Entertainment / simulation | 50 | "Linux Terminal", "JavaScript Console", text adventures |
| Already covered by Synottic (similarity) | 50 | "Job Interviewer" → `lib-1514`, "Excel Formula Sensei" → `ev-data-1` |
| Multi-step or agent, but low value or weak | 53 | |
| One-off build spec (named product, no reusable input) | 53 | "Quizflix App", "Kanban Board", "Advanced Color Picker Tool" |
| Personal lifestyle / spiritual | 32 | "Chef", "Horoscope" |
| Already inside Synottic (verbatim legacy text) | 29 | "Startup Idea Generator", "Personal Chef" |
| Unsafe: jailbreak, NSFW, malicious | 29 | "Unconstrained AI model DAN", bikini/selfie prompts, "Rust Recoil Script" |
| Gambling or fan/IP-derived content | 18 | "Stake.us Dice Strategy", Dota / Clash of Clans builds |
| Outdated / tool-specific | 18 | prompts built on Midjourney flags or "ChatGPT" persona tricks |
| Internal duplicate | 9 | "Note-Taking Assistant" copies |
| Speculative crypto / trading | 8 | crypto contract trading systems |
| Synthetic identity (face swap, voice clone) | 5 | "AI Face Swapping for E-commerce Personalization", "Voice Cloning Assistant" |
| Deception (AI-detection evasion, ghost-written coursework) | 2 | "Prompt for Humanizing AI Text", "AI Assistant for University Assignments" |
| Role-play simulation with weak craft | 2 | |
| **Total** | **1,513** | |

**A note on "not appropriate":** these are not bad prompts. "Linux Terminal" is a classic. They just do not serve an enterprise, human-centred work library.

---

## 17. Synottic Prompt Quality Framework

A proposed standard for any prompt entering Synottic, external or internal. It extends the existing R-C-T-F-V-V framework rather than replacing it.

### 17.1 Hard gates (any fail = reject, no score)

1. English (until Synottic supports localisation).
2. No jailbreak, safety bypass, or instruction to ignore system rules.
3. No sexual content, harassment, or malicious use (malware, cheats, scraping behind logins).
4. No deception (AI-detection evasion, ghost-written assessed work, fake reviews).
5. No synthetic identity without consent controls (face swap, voice clone, impersonation).
6. Not dependent on a named model, version, or tool syntax to work.
7. Licence known and compatible (prompts.chat content is CC0: compatible).

### 17.2 Scored criteria (0 = missing, 1 = present but generic, 2 = specific)

| # | Criterion | Weight | What "2" looks like |
|---|---|---:|---|
| 1 | Clear objective | 10 | One sentence stating the outcome and who it is for |
| 2 | Clear role | 5 | A role that changes the answer (not "helpful assistant") |
| 3 | Relevant context | 10 | Task-specific facts the model needs; not a category boilerplate line |
| 4 | Specific task | 10 | Steps or sub-tasks the model must do |
| 5 | Useful constraints | 10 | Domain limits, must-nots, length and scope |
| 6 | Output format | 10 | Named sections or schema; ready-to-use blocks marked |
| 7 | Variables | 10 | Controlled names, types, defaults, required/optional |
| 8 | Examples | 5 | Strong vs weak example, or a short worked sample |
| 9 | Verification | 10 | How the model checks facts, sources, maths, assumptions |
| 10 | Reusability | 5 | Works for many people in the role, not one project |
| 11 | Business usefulness | 5 | Maps to a real task for a catalogue role |
| 12 | Risk handling | 5 | Human-review and not-advice lines where the domain needs them |
| 13 | Redundancy | 3 | No existing Synottic prompt does the same job at ≥ 0.85 semantic similarity |
| 14 | Maintainability | 2 | No dates, versions, or brand names that will age |

**Score = Σ(criterion/2 × weight).** Publish at ≥ 75. L3 (Expert) requires ≥ 85 and criteria 5, 8, 9 at 2.

### 17.3 Labels

| Label | Rule |
|---|---|
| Strong | ≥ 85 and all gates pass |
| Usable but generic | 60 to 84 |
| Weak | < 60 |
| Redundant | Semantic match ≥ 0.85 to a published prompt |
| Outdated | Gate 6 fails |
| Unsafe | Gates 2 to 5 fail |
| Not appropriate for Synottic | Out of scope (entertainment, lifestyle, fandom, gambling) |

**Recommendation:** replace today's authored `qualityScore` with this computed score, and make `healthStatus` a real result of gates and usage signals, so it can actually say "Needs review".

---

## 18. Recommended Classification Pipeline

### 18.1 What this audit used (and its limits)

Deterministic regex detectors + TF-IDF similarity + rule-based decisions. It is transparent and repeatable, but lexical. Measured Group A precision is 58% (P1) and 35% (P2). It misses paraphrase duplicates, and its category mapping is only as good as Synottic's (already noisy) categories.

### 18.2 Recommended pipeline for Phase 2

```
 1. INGEST        pull source at a pinned commit; keep raw text + source metadata
 2. NORMALISE     strip front matter/markdown noise; detect language; normalise variables to one syntax
 3. GATE          hard gates (17.1) via regex + LLM safety classifier; fail fast, log reason
 4. DEDUPE-EXT    exact hash + MinHash inside the source; keep the best copy per cluster
 5. EXTRACT       LLM with a JSON schema: role, task (verb + object), inputs, output, domain,
                  capability (generate/analyse/transform/reason/converse/code/agentic), risk
 6. EMBED         embed the extracted task statement (not the raw prompt) and the full prompt
 7. MATCH         kNN vs Synottic task embeddings + prompt embeddings; return top 5 with scores
 8. CLASSIFY      LLM maps to EXISTING taxonomy only (role, task, category, subcategory) given
                  the top-5 matches and the allowed value lists; must answer UNMAPPED if unsure
 9. SCORE         framework score (17.2) by LLM rubric + deterministic checks; compare with
                  the matched Synottic prompt on the same rubric
10. DECIDE        rules: covered / merge / new prompt / new workflow / new agent / reject
11. TRANSFORM     LLM rewrite into Synottic's R-C-T-F(-V-V) house style with controlled variables;
                  never copy wording beyond short functional phrases
12. EVALUATE      run the new prompt on 3 test inputs; LLM-judge + rubric; compare with the
                  Synottic prompt it would replace
13. HUMAN REVIEW  reviewer sees source, transformation diff, scores, risk; approve / edit / reject
14. PUBLISH       insert as lifecycle "Draft" → "Published"; provenance attached; version 1
15. MONITOR       usage, copy, rating, "improved" events feed back into the quality score
```

**Why this beats the simple pipeline in the brief:**

- **Match on the task, not the text.** Two prompts that do the same job read very differently. Embedding the extracted task statement ("review a pull request for security issues") finds real duplicates that raw-text similarity misses (see pc-1959 vs `lib-504`).
- **Classify with a closed vocabulary.** The LLM chooses from Synottic's actual lists or says UNMAPPED. That prevents silent taxonomy growth.
- **Evaluate before review.** Reviewers see how the prompt performs, not just how it reads.
- **Same pipeline for internal prompts.** Run it over Synottic's own 3,575 prompts first. It will find the mis-filed categories, the jailbreak, and the boilerplate context, and it calibrates thresholds on data you know.

### 18.3 Practical thresholds to start with (tune in Phase 2)

| Signal | Threshold | Action |
|---|---|---|
| Task-embedding cosine ≥ 0.90 | | Covered (ignore) unless score +15 |
| 0.80 to 0.90 | | Merge candidate |
| 0.65 to 0.80 | | Variant (role- or industry-specific) |
| < 0.65 | | New task candidate |
| Framework score < 60 after transform | | Reject |

---

## 19. Recommended Dataset Architecture

**No schema change is proposed in this phase.** This is the target model for approval. Most of it can start inside the existing `prompts.data` jsonb plus new tables added in a later, additive migration.

### 19.1 Entities

```
Function ──< Role >──< RoleTask >── Task ──< TaskPrompt >── Prompt ──< PromptVariant
                                     │                         │
                                     ├── Category/Subcategory  ├── Variable (typed, controlled)
                                     │                         ├── QualityAssessment (versioned)
                                     └──< WorkflowStep >── Workflow   ├── Provenance
                                                                  │   └── Evaluation (test inputs, results)
                                                   AgentSpec ─────┘
```

| Entity | Why | Holds |
|---|---|---|
| **Task** | The missing centre. Users think in tasks. | verb, object, outcome, function(s), risk level, capability |
| **RoleTask** | Many-to-many; a task can matter to several roles with different priority | role, task, importance, frequency |
| **Prompt** | One way to do a task | current fields, plus task_id, subcategory, user_type, output_type, capability |
| **PromptVariant** | Same task, different context | role / industry / seniority / model-specific wording |
| **Variable** | Controlled vocabulary | name, type (text, list, enum, file), default, help text, required |
| **Workflow / WorkflowStep** | Chains (from prompts.chat `PromptConnection`) | ordered steps, each a prompt, with hand-off fields and human checkpoints |
| **AgentSpec** | For J-type items | goal, instructions, tools allowed, stop rules, escalation to human |
| **Provenance** | Required for any external content | source, source_id, source_url, commit, licence, contributor, import_date, transformation_level |
| **QualityAssessment** | Replace the static score | rubric scores, gate results, assessor (human/LLM), date |
| **Evaluation** | Proof it works | test inputs, outputs, judge scores, model used |

### 19.2 Controlled vocabularies to introduce

`user_type` (Business professional, Technical, Personal) · `output_type` (text, document, table, code, structured data, image, conversation) · `ai_capability` (generate, analyse, transform, reason/plan, research/retrieve, converse/simulate, code, agentic) · `risk_level` (Low, Medium, High) · `industry` (only when a prompt is truly industry-specific; else Cross-industry). The CSV already fills these for every prompts.chat row as proposals.

### 19.3 Provenance fields for every imported record

```json
"provenance": {
  "source": "prompts.chat",
  "source_id": "pc-1404",
  "source_locator": "prompts.csv row 1404",
  "source_commit": "f78a1c5",
  "source_url": "https://github.com/f/prompts.chat",
  "licence": "CC0-1.0",
  "contributor": "@<handle>",
  "transformation": "rewritten",          // verbatim | adapted | rewritten | pattern-only
  "imported_at": "<date>",
  "reviewed_by": "<reviewer>"
}
```

Apply the same block retroactively to the 15 Synottic records whose legacy text holds prompts.chat content.

---

## 20. Product Opportunities

The shift: from **"find a prompt"** to **"get this task done well with AI, in my role, safely."**

| Opportunity | What it is | Why Synottic can win it |
|---|---|---|
| **Task-first discovery** | Search and browse by task ("review a PR", "prepare for a tough 1:1"); prompts are ways to do it | prompts.chat has no task layer; Synottic already has verb-first titles and Task Hubs |
| **Role playbooks** | For each catalogue role: top 20 tasks, the best prompt/workflow for each, and what to verify | Synottic has the 114-role catalogue and function programs; nobody else joins roles to tasks |
| **Context-aware prompts** | Fill variables from the user's saved context (role, company, audience, tone) once, reuse everywhere | Removes the biggest friction; replaces `[DESCRIBE_YOUR_SITUATION]` |
| **Prompt variants** | Same task, variants for role, seniority, industry, model | Enterprise buyers ask "does this fit us?" |
| **Workflows** | Multi-step chains with hand-offs and human checkpoints (e.g. account research → meeting brief → follow-up email) | prompts.chat has connections but no curation; Synottic can ship tested ones |
| **Agent-ready specs** | Export a task as an agent spec or skill file (goal, tools, stop rules, escalation) | 151 J-type candidates show demand; Synottic adds the human-in-the-loop rules |
| **Verification built in** | Every prompt carries a check step and a "what to verify yourself" list; a one-click "check this answer" follow-up | Already partly true (V-V); make it visible and interactive |
| **Prompt improvement with a reason** | "Improve my prompt" that shows which framework element was missing and why it matters | Synottic already detects framework levels; prompts.chat's improver only rewrites |
| **Quality score that means something** | Computed rubric + usage + ratings; shown with reasons | Today every prompt is "Healthy 80" |
| **Comparison** | Side-by-side of two prompts or a user's prompt vs the library prompt, run on the same input | The "my prompt vs model" compare exists; extend it to live outputs |
| **Model-specific tips** | "Works best with" plus short notes per model family, kept separate from the prompt body | Keeps prompts model-neutral and maintainable |
| **Enterprise governance** | Org-private prompts, approval flows, provenance, sensitive-prompt review, audit trail | The access-code and collection model is a head start |
| **Analytics loop** | Which tasks people search for and fail to find; which prompts get copied then abandoned | `activity` table already logs the events |

---

## 21. NOW / NEXT / LATER Roadmap

### NOW (weeks 1 to 4): make the foundation safe and honest

| Area | Action |
|---|---|
| A. Dataset | Remove the DAN text from `lib-336` and review `lib-437`, `lib-2178` (AI-detection evasion). Scan all 3,575 prompts with the gates in 17.1. |
| A. Dataset | Add provenance to the 15 records that hold prompts.chat text. |
| C. Quality | Replace the 920 "Follow these detailed instructions:" bodies (start with the 793 over 250 words). |
| B. Taxonomy | Re-file the ~125 non-AI prompts out of "AI & Prompt Engineering"; empty "General". |
| B. Taxonomy | Agree the Task definition and subcategory lists (sections 12, 13). Decision only, no build. |
| C. Quality | Adopt the framework in section 17; compute it for the existing library; retire "always Healthy". |
| G. Creation | Controlled variable list (top 150 names cover most prompts); map `[DESCRIBE_YOUR_SITUATION]` to real inputs. |
| M. Analytics | Report zero-result and low-click searches weekly. They are the real gap list. |

### NEXT (months 2 to 3): add the task layer and the first import

| Area | Action |
|---|---|
| B. Taxonomy | Build Task and RoleTask (additive tables). Seed from Synottic titles clustered by embeddings. |
| D. Search | Semantic search on task embeddings alongside the current lexical search. |
| A. Dataset | Run the section 18 pipeline over Synottic first, then prompts.chat. Import the first tranche (section 14.3, ~40 records) with human review. |
| E. Discovery | Role playbooks for 3 functions with the thinnest coverage: IT & Engineering, Product Management, Data & Business Analysis. |
| H. Improvement | "Improve my prompt" that explains the missing framework element. |
| I. Workflows | Ship 5 curated workflows (account research, bug diagnosis, literature review, PRD, post-implementation review). |
| K. Personalisation | Saved context profile to prefill variables. |

### LATER (months 4 to 9): become the task intelligence layer

| Area | Action |
|---|---|
| J. Agents | Agent specs and skill export for J-type tasks, with human checkpoints. |
| F. UX | Task pages: best prompt, variants, workflow, verification checklist, examples, ratings. |
| L. Enterprise | Org-private libraries, approval workflow, provenance and review audit. |
| N. AI recommendation | Recommend next task from role, history and org patterns; "people in your role also do". |
| C. Quality | Automated evaluation on test inputs for every published prompt; regressions flagged when models change. |
| A. Dataset | Second and third import tranches, only where analytics show demand. |

---

## 22. Recommended Next Phase

**Phase 2: Foundation + pilot import. Scope for approval:**

1. **Safety and provenance fixes** (data only, through the existing admin Prompts console so it is audited): `lib-336`, `lib-437`, `lib-2178`, provenance on 15 records.
2. **Internal audit run.** Implement the section 18 pipeline (LLM extraction + embeddings + closed-vocabulary classification). Run it on Synottic's 3,575 prompts. Output: re-filing proposals, boilerplate list, true duplicates, computed quality scores. Human approves in batches.
3. **Taxonomy decision.** Approve Task definition, subcategory lists, controlled vocabularies (sections 12, 13, 19.2). Additive migration only, reviewed on a Neon branch first, per `SHARED-DB.md`.
4. **Pilot import.** Transform and review the ~40 first-tranche items in section 14.3. Measure: review time per item, rejection rate, and usage after 30 days vs comparable native prompts.
5. **Go / no-go** for wider import based on the pilot numbers.

Success measures for Phase 2: zero unsafe prompts in the library; 100% of external content with provenance; category precision ≥ 90% on a 200-prompt human sample; pilot prompts at or above the median copy rate of their category.

---

### RECOMMENDATION

**1. Should Synottic ingest prompts.chat data?**
Yes, selectively. Treat prompts.chat as a source of use cases and patterns, not as content to load. Nothing should be imported verbatim.

**2. Approximately what percentage should be considered?**
About **10 to 15 percent** (roughly 250 to 330 of 2,169 prompts). The machine triage flags 29% (632), but hand-checked precision puts the real number near 14%. After collapsing families, expect **150 to 200 new Synottic records and about 40 improvements** to existing ones. Start with a pilot of about 40.

**3. What should be transformed rather than imported?**
Everything that is kept. Specifically:
- Engineering review work (code review, testing, security, debugging, API design) into subcategorised Coding & Tech tasks.
- Agent Role and SKILL.md families into a small number of agent specs, not dozens of near-identical prompts.
- Multi-step prompts (research, account intelligence, design system audits) into workflows.
- Strong ideas with weak craft into fresh Synottic prompts built on the pattern (pattern-only provenance).
- Role-play simulations for training into interactive practice agents.

**4. What should be rejected?**
About 70 percent: image/scene prompts, entertainment and simulation, lifestyle and spiritual, non-English, unsafe or deceptive prompts (jailbreaks, NSFW, cheats, AI-detection evasion, face swap, voice cloning), speculative trading, one-off app build specs, tool-specific prompts, internal duplicates, and anything Synottic already covers as well or better (including the 31 already inside Synottic).

**5. What changes should we make to Synottic before ingestion?**
- Remove the live jailbreak and review the two AI-detection-evasion prompts.
- Add a provenance structure and backfill it.
- Fix category filing (AI & Prompt Engineering, General).
- Define Task and subcategory, and a controlled variable list.
- Replace the static quality score and "always Healthy" status with the section 17 framework.
- Add embedding-based duplicate detection so imports cannot create near-copies.

**6. What should the next implementation phase be?**
Phase 2 as in section 22: safety and provenance fixes, the classification pipeline run on Synottic's own library first, the taxonomy decisions, then a reviewed pilot import of about 40 records with usage measurement before any wider import.

**Nothing has been implemented. Waiting for your approval.**
