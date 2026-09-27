# Working with AI: pilot collection

First collection built from the prompts.chat audit (`docs/research/PROMPTS_CHAT_SYNOTTIC_AUDIT.md`). It fills Synottic's biggest gap: prompts about **working with AI itself**. It is delivered as an **admin Collection**, with provenance kept internal.

Nothing here changes the app, the schema or `index.html`. Loading happens through the existing admin console, which records every change in the audit log.

## What's in this folder

| File | Purpose |
|---|---|
| `review.xlsx` | **Start here.** Side-by-side review: rewritten prompt vs prompts.chat source, what changed, nearest existing Synottic prompt, and Approve / Notes columns. Also covers the clean-up rewrites and the legacy provenance list. |
| `import/01_cleanup.json` | Updates 3 live prompts in place (see below). |
| `import/02_working_with_ai.json` | The 20 new prompts, ids `syn-wwai-01` to `syn-wwai-20`. |
| `collection.md` | What to enter in Admin → Collections, including the 20 pinned ids. |
| `provenance.csv` | Internal provenance register for the 20 prompts (source, commit, licence, contributor, what changed). Not loaded into the product. |
| `../../research/LEGACY_PROVENANCE.csv` | Internal provenance for the 16 existing records that already hold prompts.chat text in their hidden legacy field. |
| `pack_source.py` | Editable source of all prompt text. |
| `build_pack.py` | Rebuilds everything above and runs the checks. |
| `load_test.mjs` | Dry run of the full load on an in-memory database using the real admin code. |
| `check_framework.mjs` | Runs Synottic's own framework-level detector from `src/part_framework.js`. |

## The 20 prompts

| # | Id | Title | Level | Role |
|---:|---|---|---|---|
| 1 | syn-wwai-01 | Build a context brief for a long AI project | L3 | Any Professional |
| 2 | syn-wwai-02 | Hand over an AI chat to a new session or a colleague | L2 | Any Professional |
| 3 | syn-wwai-03 | Write standing instructions for an AI assistant on a project | L3 | Prompt Engineer / AI Practitioner |
| 4 | syn-wwai-04 | Diagnose why a prompt gave a poor answer | L3 | Any Professional |
| 5 | syn-wwai-05 | Refine a prompt over several test rounds | L3 | Prompt Engineer / AI Practitioner |
| 6 | syn-wwai-06 | Check a prompt for places the AI could make things up | L3 | Prompt Engineer / AI Practitioner |
| 7 | syn-wwai-07 | Build a test set to check a prompt before you share it | L3 | Prompt Engineer / AI Practitioner |
| 8 | syn-wwai-08 | Compare two versions of a prompt on the same inputs | L2 | Prompt Engineer / AI Practitioner |
| 9 | syn-wwai-09 | Pressure-test a plan with an AI red team | L2 | Strategist / Business Leader |
| 10 | syn-wwai-10 | Answer a question using only the documents I share | L2 | Analyst / Researcher |
| 11 | syn-wwai-11 | Break a big task into steps an AI can do one at a time | L3 | Project Manager |
| 12 | syn-wwai-12 | Design an AI agent before anyone builds it | L3 | Solutions Architect |
| 13 | syn-wwai-13 | Decide which workflow steps need AI and which don't | L2 | Operations Manager |
| 14 | syn-wwai-14 | Write a reusable skill for an AI assistant | L3 | Prompt Engineer / AI Practitioner |
| 15 | syn-wwai-15 | Security-check an AI assistant or agent before launch | L3 | Security Engineer |
| 16 | syn-wwai-16 | Create realistic test data without using real people's data | L2 | QA Engineer |
| 17 | syn-wwai-17 | Review how an AI tool rollout went | L2 | Project Manager |
| 18 | syn-wwai-18 | Compare AI tools for a specific use case | L3 | Operations Manager |
| 19 | syn-wwai-19 | Decide how to fix a disappointing AI result | L3 | Any Professional |
| 20 | syn-wwai-20 | Shorten a long prompt without losing quality | L2 | Any Professional |

Level is what Synottic's own detector reports. Every role is an existing value in the library or the function catalogue. Category for all 20: **AI & Prompt Engineering**.

**How they were chosen:** from the audit's Group A candidates in AI and prompt work, skipping jobs Synottic already covers (improve my prompt, fact-check an AI answer, reusable team template, export chats, rate AI output, system prompt, custom expert persona). The highest overlap with any existing prompt is 0.22 (lexical), well below the 0.45 "same job" warning line.

**How they were written:** fresh, in the house R-C-T-F-V-V / R-C-G-T-C-E-F-V-V style. The prompts.chat source informed the task and method only. Tool and model names were removed, and manipulative wording was dropped (for example, the source of #9 told the AI it "must not refuse"). Human checkpoints and privacy rules were added where they matter.

## Clean-up (3 live prompts, updated in place)

| Id | Title | Problem | Fix |
|---|---|---|---|
| `lib-336` | Translate resume bullets across fields | Full "DAN / do anything now" jailbreak pasted into the live prompt body | Clean rewrite of the same task |
| `lib-437` | Avoid plagiarism in written content | Taught how to evade AI-detection tools | Rewritten around honest citation and AI disclosure |
| `lib-2178` | Make AI text read naturally | Taught how to bypass AI detectors | Rewritten around clarity, voice and a confirm-before-publishing list |

Title, id and category stay the same, so nobody's library scope changes. `collection.md` suggests better categories for a later re-filing pass.

## Shipped in the build (current route)

The pack is baked into the app build, so it deploys with `main` and needs no console import:

- `bake_into_build.py` writes the 20 prompts to `src/prompts_authored.json` and the 3 fixes (including scrubbing the old jailbreak and detector-evasion text from the hidden legacy field) to `src/prompts_library_rewrites.json`.
- `python3 src/build.py` rebuilds `index.html`, and `web/scripts/verify-prompts.mjs` regenerates `web/seed/prompts.json` (3,575 → 3,595).
- The Neon database is not changed by a deploy. `index.html` is what the live library reads, so the prompts appear there. To keep the database mirror in step (for the Next.js app and admin analytics), run `node migrate/run.mjs` against Neon when convenient. It is idempotent.
- The admin **Collection** still has to be created once in the console (see `collection.md`), because collections live in the database.

The console import route below remains a valid alternative, and is still the way to update prompts without a deploy.

## How to load through the admin console (alternative)

1. Remove any rows you marked N from the two JSON files, or tell me and I'll rebuild them.
2. **Admin console → Prompts → Import** → `import/01_cleanup.json`. The preview must show **3 update, 0 new**. Commit.
3. **Admin console → Prompts → Import** → `import/02_working_with_ai.json`. The preview must show **20 new**. Commit.
4. **Admin console → Collections → New collection**: follow `collection.md`. Save, then **Generate code**.
5. Redeem the code with a test learner account and confirm the 20 prompts appear.

Imported prompts go live in the library as soon as step 3 is committed. Only "Archived" hides a prompt, so do the review first.

## What was verified

`node docs/collections/working-with-ai/load_test.mjs` runs steps 2 to 5 against an in-memory database with the real admin handlers. **17/17 checks pass**:

- Clean-up previews as 3 updates and commits cleanly. The jailbreak and detector-evasion text is gone from the live prompts, and no rows are added.
- The pilot previews as 20 new, commits with the planned ids, and re-importing is harmless (20 updates, 0 new).
- The records are stored as authored, Curated, AI & Prompt Engineering, with variables and tags intact.
- No source name or provenance ends up in the product record.
- The public delta feed carries the 20 new prompts and the 3 fixes, so the running app picks them up without a rebuild.
- The Collection accepts the 20 pinned ids, a code generates, and a learner who redeems it gets those prompts in scope.

`build_pack.py` also checks every row against the server's validation rules, id and title collisions with the library, framework level, and the audit's safety detectors.

## Known limits

- **Hidden legacy text stays.** `lib-336` still carries the old jailbreak text in its hidden `legacyPrompt` field, in the database and in `index.html`. It is never displayed, but it does ship in the page data and the public feed. The admin import cannot remove fields. Removing it needs either a one-off database edit or an `index.html` rebuild, which is a guarded path in CI. Worth a separate, reviewed change.
- **Source label.** The admin import labels new prompts `source: "Synottic Programs"` (its default). Provenance is only in `provenance.csv`, as agreed.
- **Framework detector ceiling.** Three prompts written as L2 (#4, #18, #19) are detected as L3, because their constraint wording satisfies the L3 detectors. The level tag follows the detector.

## Test locally before loading production

Uses a throwaway local database (PGlite), never Neon. Always set `DATABASE_URL` explicitly as shown. Plain `npm run dev` reads `.env.local`, which points at the **production** database (see `SHARED-DB.md`).

```bash
git checkout claude/synottic-prompt-audit-cxkja1
npm install

# 1. fresh local database with the full library (about 10 s)
rm -rf /tmp/synottic-dev-pglite
DATABASE_URL=pglite:///tmp/synottic-dev-pglite node migrate/run.mjs

# 2. start the local server (leave this terminal running)
DATABASE_URL=pglite:///tmp/synottic-dev-pglite EMAIL_TRANSPORT=console npm run dev:auth

# 3. in a second terminal: clean-up + pilot import, Collection, code, test learner
node docs/collections/working-with-ai/load_local.mjs
```

Then open http://localhost:8790:

- **Learner** `learner.test@example.com` / `Learner!Pass123` sees only the 20 collection prompts.
- **Admin** `admin@synottic.dev` / `adminDevPass123` at `/admin/login` sees the imported prompts in Prompts and the Collection in Collections.

`load_local.mjs` refuses to run against anything but localhost, and running it twice is safe.

## Rebuild

```bash
python3 docs/collections/working-with-ai/build_pack.py --pc <checkout of f/prompts.chat at f78a1c5>
node docs/collections/working-with-ai/load_test.mjs
```
