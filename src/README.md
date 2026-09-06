# Build sources for index.html

`../index.html` is generated — do not hand-edit it. Edit a part here, then:

```bash
python3 build.py
```

- `part_head.html` — `<title>`, `<style>`, gate + app markup
- `part_orgmodel.json` — organizations / programs / cohorts / learners / access codes
- `part_app_1..5.js` — the application (utils+store+search+metadata / org-model+cards+filters /
  gate+home+search+categories+program+learn+practice / favorites+mylibrary+governance+builder+detail /
  modals+shell+init)
- `data_blocks.html` — the three read-only `<script type="application/json">` data blocks
  (3,367 prompts, categories, stats) imported from `Prompt_Library_Catalog.xlsx`. Regenerate only
  if the Excel source changes.

Sanity check the bundle after building:
```bash
node --check <(python3 - <<'P'
s=open('../index.html').read(); i=s.rindex('<script>'); j=s.rindex('</script>'); print(s[i+8:j])
P
)
```
