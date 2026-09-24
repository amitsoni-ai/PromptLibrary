# Everyday Essentials + task-first search — report

**Goal:** someone who types a plain problem ("how do I make a presentation") should land on a
strong, ready-to-use prompt in one step, and feel the library covers their everyday work.

## What was wrong

- **Coverage gaps.** Across 3,567 prompts, very common jobs had little or nothing: project plan (0),
  status update (0), itinerary (0), apology (0), resignation (0), personal finance (0),
  meeting agenda (1), spreadsheet formulas (4), proofreading (1). Average quality was 64, and
  2,118 prompts are flagged "Needs Improvement".
- **Search missed intent.** "how to make a presentation" ranked *"I Want To Make A Presentation On
  Our Talent Acquisition ROI Analysis"* first. Plurals, typos ("presentaion") and everyday words
  (ppt, cv, excel) were not understood.
- **No task entry point.** Home recommended prompts like *"For A New Website"*. There was no way to
  browse by "what I need to do", only by category.

## Content: 144 "Everyday Essentials" prompts

Added to `src/prompts_authored.json` (ids `ev-<hub>-<n>`, `source: "Everyday Essentials"`), each
written as labelled framework lines:

| Level | Framework | Count | Used for |
|---|---|---:|---|
| L1 | R-C-T-F | 64 | quick jobs: reply to an email, agenda, proofread, meal plan |
| L2 | R-C-T-F-V-V | 65 | quality matters: minutes, reports, formulas, resume, feedback |
| L3 | R-C-G-T-C-E-F-V-V | 15 | high stakes: full deck, pitch, project plan, business case, salary talk, policy |

Checked against the app's own detector (`deriveFrameworkLevel`): **all 144 classify at or above
their intended level** (14 are detected one level higher). Placeholders are only taken from the
brief itself (Role, Context, Goal, Task, Format), so output markers like `[CHECK]` or
`[ASSUMPTION]` never show up as fields to fill in. Difficulty follows the level
(L1 Beginner, L2 Intermediate, L3 Advanced). Legal prompts, and prompts about health or money,
are marked `sensitiveCategory` and tell the reader to have a qualified person check the result.

The prompts are grouped into **18 task hubs** (new `hub` field), covering both individuals and
employees: presentations, email, meetings, summaries & reports, planning, Excel & data, decisions,
brainstorming, career, managing people, learning, editing, personal life & money, LinkedIn,
customers & sales, getting more from AI, focus & wellbeing, code & tech help.

## Search (`src/part_app_1.js`)

- **Task-hub intent.** `TASK_HUBS` + `detectTaskHub()`. `match` phrases name the job and `hint`
  words only name the context, so "email to my manager" counts as an email task, not a
  managing-people task. Prompts in the matching hub get a boost.
- **Plain-language queries.** More stopwords, and generic verbs (make, write, create…) are dropped
  when a more specific word is left. The phrase bonus uses the cleaned query.
- **Stemming.** Plurals and `-ing` / `-ed` forms fold together (presentations, meetings, summarizing).
- **Typo tolerance.** An unknown word is corrected to the closest word the library actually uses,
  and the results show "Showing results for …" with a one-click "search exactly instead".
- **More everyday synonyms and routes:** ppt, deck, cv, excel, okr, trip, gym, grammar, bug…
- Imported-library titles are still tidied. Authored titles now display as written (this also
  fixes the Synottic Programs titles, which were being shown as "Objection Handling and…").

Spot checks (top result): "how to make a presentation", "presentaion", "powerpoint for my boss"
→ *Build a complete presentation from scratch* · "meeting notes" → *Turn meeting notes into
minutes and action items* · "excel vlookup" → *Write an Excel or Google Sheets formula* ·
"write an email to my manager" → *Write a clear professional email* · "fix my python error"
→ *Debug my code* · "my team is burnt out" → *Motivate my team through a tough period*.

## UI / UX

- **Home:** new "Popular tasks" tile grid under the search bar (8 tasks, with a "Show all 18" option).
  Example chips are phrased as real problems, and the placeholder reads "Describe what you need to do".
  "Recommended for you" now starts new users on Everyday Essentials.
- **Library landing:** new heading, "What do you need to get done?", and a task grid above
  the starters and categories. Starters now come from Everyday Essentials first.
- **Task toolkit page** (new `task` view): a header, a three-step "how to use" strip, the curated
  prompts, then "More from the library" (quality ≥ 62, with pasted metadata filtered out),
  and links to the other tasks.
- **Results:** a "Make a presentation — Open toolkit →" banner when intent is recognised, the
  typo line, and an empty state that offers the task tiles and "Create your own prompt".
- **Cards:** an "Essential" badge on hand-built prompts.
- **Fill-in form:** `[PASTE_NOTES_OR_DOCUMENT]` becomes "Paste notes or document". Hints like
  `[TONE, e.g. warm and direct]` move into the input placeholder. Long inputs are textareas.
- Works at 375px wide: tiles show 2 per row, the banner is compact, and 3 example chips are shown.

## Verification

`python3 src/build.py` clean · bundle `node --check` OK · `node migrate/authtest.mjs` 160/160 ·
`web/scripts/verify-prompts.mjs` (seed regenerated: 3,711) · `web/scripts/parity.mjs` ✓ ·
`web` typecheck + lint ✓ · no JS errors on Home, search, toolkit, detail, Use modal and Library
at 1280px and 375px.

## Not done / follow-ups

- The Next.js Library (`web/`, behind `LIBRARY_V2`, default off) still uses its own simpler search;
  it has the new prompts through the seed but not hubs or intent search.
- Scoped learners (access codes limited to some categories) only see the essentials whose category
  is in their scope. Making Everyday Essentials available to everyone would be an entitlement decision.
- The CI `guardrails` job blocks changes to `index.html` / `src/part_*` on PRs by design. This
  change has to touch them, the same way earlier library work did.

## Library redesign: rail + grid (follow-up)

The Library now uses an "agent library" layout, so browsing takes one click instead of several screens.

- **Left rail:** "All prompts", then **Tasks** (the 18 hubs), then **Categories** (A–Z), each with
  an icon and a count. A "Find a task or category" box at the top filters the rail. The rail is
  sticky and scrolls on its own. Single-program scopes don't show the Categories group.
- **Main area:** a big title with an icon and a live count, and a search box on the right that
  searches only the current task or category (with a "Search all prompts instead" link).
  There is a grid/list toggle, remembered per browser.
- **Tabs:** All prompts · Saved · Recently used, each within the current selection.
- **Filters** fold away behind a button: level, framework, templates only, and sort.
  A dot shows when any filter is on.
- **Tiles:** an icon (task icon, or category icon), a round save star, a bold title, a 3-line
  description, and an Essential / category / difficulty / fill-in count footer.
- Task pages split into "Step-by-step prompts" and "More from the library".
- On phones the rail becomes a "Browse" dropdown grouped into Tasks and Categories, and the
  tiles show one per row.
- The old `search`, `categories`, `categoryDetail` and `task` views all render the new shell
  (`renderLibraryShell` in `src/part_app_3.js`), so existing links and Home task tiles land in
  the right place. The topbar search is gone because the shell has its own. The separate
  category-grid page and the starter strip were removed.

## Library rewrite: every imported prompt in the framework (follow-up)

All 3,367 imported library prompts were read and rewritten by hand into the house framework.
The source file `src/data_blocks.html` is untouched. `src/build.py` (and `migrate/run.mjs` for the
DB seed) overlay `src/prompts_library_rewrites.json` per prompt id.

- **Clear titles.** Every prompt has a short, plain title that says the job
  ("CEO pitch deck content", "Win back cancelled subscribers"), not the first words of the original.
- **Framework text.** Each prompt is now labelled Role / Context / Task / Format, plus
  Verification / Validation (L2) or Goal / Constraints / Example (L3). Split: L1 698, L2 2,230, L3 303.
  The app's own detector places **all 3,231 kept prompts at or above the level they were written for**.
- **What it does / What you'll get.** Every prompt has a one-line description and a specific outcome,
  shown on the prompt page.
- **Long originals kept.** When the original had real detail (920 prompts), it follows the task as
  "Follow these detailed instructions:", cleaned of front-matter, "Certainly! Here is…" lines and
  markdown noise.
- **Multi-prompt bundles.** Originals that packed several prompts into one (e.g. "1. Research
  mega prompt… 2. …") now keep only the most useful task.
- **Near-duplicates merged (111).** For example, the two copies of *ICF master coach and strategic
  advisor (MCC)*, four copyright-notice prompts, three robots.txt prompts. The kept prompt lists the old
  ids in `aliases`: old links and saved favourites open the kept prompt (`findPromptById`,
  `Store.remapFavorites`).
- **Archived (25).** Rows that were not prompts (pasted link lists, file notes, a piracy downloader,
  a gambling "grow 10 to 1000" plan, fake "100% authentic" handwriting).
- Rewritten titles are shown exactly as written (the old import title-caser no longer touches them).

Library count: 3,367 → 3,231 imported prompts (plus 344 authored and 44 curriculum).

Note: `migrate/run.mjs` upserts, so an existing database still has rows for the 136 removed ids.
The app reads the baked-in data, so nothing shows them. A `--reset` run clears them.

## Search engine, resizable rail, mobile (follow-up)

**Search index (`SearchIndex`, `src/part_app_1.js`).**
- One inverted index covers the library, authored prompts, and the viewer's own prompts and improved versions. It is built while the browser is idle after sign-in.
- A search only scores prompts that share a word (by prefix) or a synonym with the query, plus the task hub's prompts. Typical queries take 1–20 ms, where the old full scan rebuilt word counts on every keystroke.
- **Auto-indexing:**
  - Saving, editing or deleting one of your prompts updates the index at once, and so does saving an improvement.
  - Admin prompt edits pulled at runtime are indexed too.
  - Any prompt a search meets that isn't indexed yet is indexed on the spot.
  - Your improved wording of a library prompt is searchable for you (field `yourVersion`). The index resets when a different person signs in.
- **Personal ranking:** your own prompts, saved prompts, and prompts you used in the last two weeks rank a little higher.

**Search operators:** `"exact words"`, `-word`, `cat:hr` / `category:"hr & recruiting"`, `level:2` (or `L2`), `is:saved`, `is:mine`, `is:template`, `is:essential`. Operators can be used alone (`is:mine`). The active ones show as chips above the results.

**Results page:**
- "N results for "q" (0.01 s)".
- Search words are bolded as whole words in titles, descriptions and suggestions.
- On the whole library, the top 4 results sit under **Best matches**, then **More results**.
- **A prompt picked from the suggestions is pinned first under Best matches** with a "Selected" badge, and it opens at the same time.

**Suggestions:**
- Clicking into an empty box shows recent searches (with Clear) and popular searches.
- Recent searches that match what you're typing come first.
- A one-line tip lists the operators.
- Home search is now a launcher. Suggestions appear as you type, and Enter or an example chip opens the Library results.

**Resizable category bar:**
- Drag the rail's right edge to set its width (200–480 px).
- Drag it narrower than 140 px to hide the rail. A "Browse" tab brings it back.
- Double-click resets the width to 260 px.
- Arrow keys, Home and End work when the edge has focus.
- The width is remembered per browser.

**Mobile (≤ 880 px):**
- The rail becomes a swipeable row of task and category chips. The row keeps its scroll position and never scrolls the page.
- The search bar sticks to the top while you scroll, with 16 px text so iOS doesn't zoom.
- The page no longer auto-focuses the search box, so the keyboard doesn't cover the page. Enter closes the keyboard.
- Tiles are compact: icon beside the title, two-line description.
- Tap targets are 40–48 px.
