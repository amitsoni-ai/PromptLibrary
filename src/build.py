#!/usr/bin/env python3
"""Assemble ../index.html from the parts in this directory.
Run: python3 build.py   (from prompt-library/src/)"""
import base64, json, os, re
HERE = os.path.dirname(os.path.abspath(__file__))
ASSETS = os.path.normpath(os.path.join(HERE, ".."))
OUT = os.path.normpath(os.path.join(HERE, "..", "index.html"))
VERCEL_JSON = os.path.normpath(os.path.join(HERE, "..", "vercel.json"))
PUSH = os.path.normpath(os.path.join(HERE, "..", "..", "promptlibrary-push-package", "index.html"))
PUSH_VERCEL = os.path.normpath(os.path.join(HERE, "..", "..", "promptlibrary-push-package", "vercel.json"))

def read(name): return open(os.path.join(HERE, name), encoding="utf-8").read()

def data_uri(name):
    p = os.path.join(ASSETS, name)
    return "data:image/png;base64," + base64.b64encode(open(p, "rb").read()).decode("ascii")

def merge_authored(data_blocks):
    """Splice src/prompts_authored.json into the data-prompts block at build time.
    data_blocks.html on disk is never touched. No-op if the file is absent/empty."""
    path = os.path.join(HERE, "prompts_authored.json")
    if not os.path.exists(path):
        return data_blocks
    authored = json.loads(open(path, encoding="utf-8").read())
    if not authored:
        return data_blocks
    marker = ']</script>\n<script type="application/json" id="data-categories"'
    assert marker in data_blocks, "data-prompts / data-categories boundary not found"
    extra = ",".join(json.dumps(r, ensure_ascii=False) for r in authored)
    data_blocks = data_blocks.replace(marker, "," + extra + marker, 1)
    # keep data-stats.totalPrompts honest
    data_blocks = re.sub(r'("totalPrompts":\s*)(\d+)',
                         lambda m: m.group(1) + str(int(m.group(2)) + len(authored)),
                         data_blocks, count=1)
    print(f"  + merged {len(authored)} authored prompts from prompts_authored.json")
    return data_blocks


def main():
    data_blocks = read("data_blocks.html")
    assert data_blocks.startswith('<script type="application/json" id="data-prompts">')
    assert data_blocks.rstrip().endswith("</script>")
    data_blocks = merge_authored(data_blocks)
    head = read("part_head.html")
    head = head.replace("{{LOGO_DATA_URI}}", data_uri("Synottic_Logo.png"))
    head = head.replace("{{FAVICON_DATA_URI}}", data_uri("favicon.png"))
    orgmodel = read("part_orgmodel.json"); json.loads(orgmodel)
    curriculum = read("part_curriculum.json"); json.loads(curriculum)
    admin_seed = read("part_admin_seed.json"); json.loads(admin_seed)
    # order: 1-4 core, the admin module, the prompt-framework module, then 5
    # (part_app_5 closes the <script> and calls initApp). part_framework only
    # *defines* things, so it is safe anywhere before part_app_5.
    order = ["part_app_1.js", "part_backend.js", "part_auth.js", "part_app_2.js", "part_app_3.js",
             "part_app_4.js", "part_admin.js", "part_framework.js", "part_app_5.js"]
    app = "".join(read(n) + ("\n" if i < len(order) - 1 else "") for i, n in enumerate(order))
    out = ('<!DOCTYPE html>\n<meta charset="utf-8">\n' + head + "\n" + data_blocks +
           '\n<script type="application/json" id="data-orgmodel">\n' + orgmodel + "</script>\n" +
           '<script type="application/json" id="data-curriculum">\n' + curriculum + "</script>\n" +
           '<script type="application/json" id="data-admin-seed">\n' + admin_seed + "</script>\n" +
           app + "\n")
    open(OUT, "w", encoding="utf-8").write(out)
    if os.path.isdir(os.path.dirname(PUSH)):
        open(PUSH, "w", encoding="utf-8").write(out)
        # Keep the deploy package's vercel.json byte-identical to the canonical
        # one so the SPA rewrites (/verify-email etc.) can never drift out of the
        # deployed config again. See prompt-library/ADMIN-PROMPTS-REPORT.md.
        if os.path.exists(VERCEL_JSON):
            open(PUSH_VERCEL, "w", encoding="utf-8").write(
                open(VERCEL_JSON, encoding="utf-8").read())
            print("  + synced vercel.json ->", PUSH_VERCEL)
    print("wrote", OUT, len(out), "bytes")

if __name__ == "__main__":
    main()
