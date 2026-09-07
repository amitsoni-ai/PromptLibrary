# Library UX redesign — report

Scope: the **Library** tab (`renderSearchView` + Categories + Category detail) and the
**Home → Recommended for you** section. No backend, data-model, routing or auth changes.
`index.html` is rebuilt from `src/part_*` via `python3 src/build.py`.

Verified on `node migrate/devserver_pglite.mjs` (localhost:8790) as a full-library user
(`SYNOTTIC-ALL`), a multi-category scoped user (`SYNOTTIC-FINANCE`, `SYNOTTIC-LEGAL` — both
resolve to ≥2 shelves so both get the grouped grid), and the single-program modules-first
branch (exercised by forcing `scopeInfo().gridEligible = false`; no seed code currently
resolves to exactly one category because linked-prompt fallbacks always pull in a second
shelf). `node migrate/authtest.mjs` → 129/129.

---

## Findings (before)

| # | Problem | Evidence |
|---|---------|----------|
| 1 | Library landing was dominated by **"Strong prompts to start from"** — 8 near-identical *Course Companion Prompt* cards that filled the viewport and read as if they were the whole library. The real size ("3,411 / 693 prompts available to you") was 12px grey text top-right. | `renderSearchView` rendered `lib.sort(qualityScore).slice(0,8)`; curriculum companion prompts always win on quality so every user saw the same 8. |
| 2 | **Categories were hidden** behind a "Browse categories" button → a separate, nav-less view. | `renderCategoriesView` only reachable via a quicklink; `SCOPED_HIDDEN_VIEWS` hid it entirely for access-code sessions. |
| 3 | **No function/role scent.** A Finance-scoped user got the same AI-literacy cards as everyone; no "Finance & Accounting, Research & Data Analysis" statement, no grouping. | Greeting said "AI for Finance & Accounting" but nothing else used the scope. |
| 4 | **Home "Recommended for you" wasn't personalised.** Finance user saw 4 generic *Course Companion Prompt* cards, all "AI & Prompt Engineering", no rationale. | `recommendedForYou()` pooled `programPromptIds()` (mostly curriculum) then ranked by `qualityScore`. |
| 5 | **Noisy cards** — category + difficulty + "Template" + "L2 · R-C-T-F-V-V" wrapped onto three lines. | `promptCardHtml` emitted all four every time. |

---

## What changed & why

### New shared helper — `scopeInfo()` (`src/part_app_2.js`)
One function all Library/Home/Categories code reads, folding the three scoping paths
(learner-account function/collection, admin access codes, classic program codes) into:
`{ restricted, mode, label, functionName, functionCats, primaryCats, inScope, gridEligible,
programId, total }`. `libraryCount()` now wraps `scopeInfo().total` so the sidebar, brand
subtitle and the new banner can never disagree. `isCurriculumPrompt()` added alongside.

### Library landing — `renderSearchView()` rewrite (`src/part_app_3.js`)
Search hero unchanged. Below it, in order:

- **Scope banner** (restricted users) — org / function label, `"693 prompts · Finance &
  Accounting · Research & Data Analysis · …"`, and a "Browse everything in scope →" link.
  Full-library users get a one-liner: `"3,411 prompts across 28 categories"`.
- **Curated starters — compact strip** (`.starter-strip`): heading *"New to the library?
  Start with these"*, **3** lighter cards tagged `Starter` (program companion first, then the
  strongest non-curriculum prompts in the user's function categories), ending in
  *"See all N prompts →"*.
- **Main body, chosen by `scopeInfo()`**:
  - `gridEligible` (full library, and any scope with ≥2 categories) → **category grid**
    (`renderCategoryGridInto`, shared with the Categories tab, live scoped counts). Scoped
    users see it split into **"In <Function>"** + a collapsed *"More categories in your
    library (N)"*.
  - single-program / single-category scope → **modules-first** list
    (`renderModuleListInto`, extracted from `renderProgramView`).
- **"Browse all N prompts"** button (a `STATE.libBrowseAll` flag) → the full filtered
  results list, from either layout.

`isViewAllowed()` (`src/part_app_5.js`) now permits the Categories tab for any scope with
`gridEligible`, so multi-category access-code users get it too.

### Categories tab + Category detail (`src/part_app_3.js`)
- Grid markup extracted to `renderCategoryGridInto()` — the tab and the landing share it,
  no duplicated logic. Header shows live `"28 categories · 3,411 prompts"`.
- `renderCategoryDetail` header condensed to one line (`"102 prompts · for Finance
  Professional"`); it already routed through `renderResultsInto` so it keeps the full filter
  bar + sort + active-filter chips.

### Home "Recommended for you" — `recommendedForYou()` rewrite (`src/part_app_3.js`)
Now returns `[{rec, reason}]`. Pool = `scopedLibrary()` minus already-seen minus **every
curriculum/companion prompt**. Score: `+18` if the prompt's category is in the user's
function; `+10` for other in-scope categories; `+12` if it matches something saved/recently
used; `qualityScore·0.25`; the existing difficulty bias; deterministic jitter. Each row gets
a caption — *"Because you work in Finance & Accounting"*, *"Based on what you saved"*,
*"Popular in your library"*. A separate **"Your program's companion prompt"** row keeps the
flagship one click away without letting it flood the mix. New users (no activity) get a
"tell us what you're working on" line + the starters.

### Card — `promptCardHtml()` (`src/part_app_2.js`)
Meta line is now **category + difficulty only**. `Template` → a small `{ }` glyph next to
the save star; the framework-level badge is gone from the card face (both remain in the
detail drawer). New `opts.starter` for the lighter starter-strip styling.

### Styles (`src/part_head.html`)
`.scope-banner`, `.lib-scopeline`, `.starter-strip` (+ 2-line title clamp),
`.tmpl-glyph`, `.prompt-card.is-starter`, `.cat-group`, `details.cat-more`, `.rec-reason`.
Responsive: starter strip becomes a horizontal snap-scroller ≤640px; category grid drops to
`minmax(150px,1fr)` ≤400px.

---

## Before → after (observed)

| View | Before | After |
|------|--------|-------|
| Library landing, **full user** | 8 companion cards fill the screen; "3,411 prompts" tiny top-right | `"3,411 prompts across 28 categories"` line → 3 `Starter` cards → **28-category grid** sorted by count → "Browse all 3,411" |
| Library landing, **Finance user** | Same 8 companion cards; no Finance signal | **Scope banner** "Synottic AI Institute · Finance & Accounting · 693 prompts · Finance & Accounting · Research & Data Analysis · …" → 3 Finance `Starter` cards → grid grouped **"In Finance & Accounting"** (2) + "More categories (3)" |
| Library landing, **single-program scope** (`gridEligible` false) | 8 companion cards | Scope banner → starters → **"<Program> — modules"** accordion (6 module cards) → "Browse all N prompts" |
| Category detail | header: `"102 prompts · skill: … · typically used by a Finance Professional"` + prompt-type chips | one-line header + full filter bar + sort + active-filter chip + `"102 prompts"` |
| Home → Recommended, **Finance user** | 4 generic *Course Companion Prompt* cards, all "AI & Prompt Engineering", no reason | caption **"Because you work in Finance & Accounting"** + 6 real Finance/Research prompts; companion prompt in its own labelled row |
| Prompt card | 3 wrapped rows of chips | `title` · one-line desc · `category` + `difficulty`; `{ }` glyph if templated |

---

## Verification run

- `python3 src/build.py` → clean · `node --check` bundle → OK · `node migrate/authtest.mjs`
  → **129/129**.
- Full user: 28-category grid by default; type `customer complaint` → 40 results, search
  keeps focus, no duplicate top-bar search; category card → Category detail with working
  filters; Home recommendations carry reasons.
- Finance user: scope banner + grouped grid + Finance starters/recommendations; Categories
  tab now reachable; sidebar count (693), banner count and `isScopeRestricted()` agree.
- Navigating to Library from a category detail / elsewhere clears a stuck category filter and
  opens the clean landing (fixed in `navigate()`).
- Modules-first branch renders `"<Program> — modules"` + 6 module accordions + "Browse all".
- "Browse all N" and "Browse everything in scope →" both open the full results list and
  clear back to the landing.
- 375px: search hero full-width, quicklinks wrap, starter strip scrolls horizontally,
  category grid 2-up. Dark mode (default on the dev host) renders correctly.
- No JS console errors. (`POST /api/session 404` on the dev host is pre-existing — the
  pglite dev server has no classic access-code endpoint; the app falls back to local
  resolution, unchanged by this work.)

---

## Follow-ups (not done here)

- `recommendedForYou` scores by category match; a co-occurrence / embedding signal would be
  sharper.
- The scoped library for an admin *function* code still pulls in peripheral shelves
  (Legal, AI & Prompt Engineering) via linked-prompt fallbacks in `adminScopeCategories` —
  presented under "More categories" now, but the scoping itself is unchanged.
- The modules-first single-program Library layout overlaps `renderProgramView`; they could
  converge on one component.
- Category detail could sub-group by prompt-type.
