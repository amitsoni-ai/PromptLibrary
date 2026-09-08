# Build sources for index.html

`../index.html` is generated — do not hand-edit it. Edit a part here, then:

```bash
python3 build.py
```

- `part_head.html` — `<title>`, `<style>`, gate + app markup
- `part_orgmodel.json` — organizations / programs / cohorts / learners / access codes
- `part_auth.js` — learner-account layer: the `AuthAPI` bridge to `/api/auth/*`,
  the account screens (sign-in / 2-step sign-up / verify / forgot / reset /
  `/admin/login`), the in-app status banner, and `featureAllowed()` /
  `blockIfLocked()` feature gating. Loaded right after `part_backend.js` (before
  `part_app_3`, which delegates the gate to it when `/api` is present). No-ops on
  a static host. See `../AUTH.md`.
- `part_app_1..5.js` — the application (utils+store+search+metadata / org-model+simplified-cards+filters /
  gate+home+library-landing+categories+program+learn+practice / me(saved/recent/progress)+governance+builder+action-first-detail /
  modals+shell+5-item-nav+init)
- `part_framework.js` — the data-driven Prompt Framework: the `FRAMEWORKS` object
  (levels → component keys → explanations/examples/detectors/builder), the
  detection engine that powers AI feedback + the "my prompt vs model" compare +
  the automatic mapping of every library prompt to a framework level, the
  Framework detail view, and the Practice/Builder/Progress helpers. Loaded after
  the admin module, before `part_app_5.js` (it only *defines* things). Hooks in
  the other parts are all guarded with `typeof … === "function"`.

Primary nav is exactly five: Home · Library · Learn · Practice · Me. Categories and
Create Prompt live inside Library; My Program lives inside Learn; Saved / Recently used /
Progress live inside Me (one "Saved" concept = favourites + created/improved). Governance
and the Admin console are superadmin-only and never in the learner sidebar.
- `data_blocks.html` — the three read-only `<script type="application/json">` data blocks
  (3,367 prompts, categories, stats) imported from `Prompt_Library_Catalog.xlsx`. Regenerate only
  if the Excel source changes.
- `prompts_authored.json` — editable author-managed prompts, spliced into the `data-prompts`
  block by `build.py#merge_authored()` (Excel `data_blocks.html` untouched) and seeded into the
  `prompts` table by `migrate/run.mjs`. The SUPER_ADMIN **Prompts** console tab
  (`part_admin.js#renderAdminPrompts` → `/api/admin/prompts`) writes changes to the DB; the app
  merges the delta from `GET /api/prompts` at boot. To make a change permanent: export JSON from
  that tab, replace this file, `python3 build.py`, commit `index.html`.
- `build.py` also copies the canonical `../vercel.json` into
  `../../promptlibrary-push-package/vercel.json` so the deployed SPA rewrites can't drift.

Sanity check the bundle after building:
```bash
node --check <(python3 - <<'P'
s=open('../index.html').read(); i=s.rindex('<script>'); j=s.rindex('</script>'); print(s[i+8:j])
P
)
```
