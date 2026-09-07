#!/usr/bin/env python3
"""Assemble ../index.html from the parts in this directory.
Run: python3 build.py   (from prompt-library/src/)"""
import base64, json, os
HERE = os.path.dirname(os.path.abspath(__file__))
ASSETS = os.path.normpath(os.path.join(HERE, ".."))
OUT = os.path.normpath(os.path.join(HERE, "..", "index.html"))
PUSH = os.path.normpath(os.path.join(HERE, "..", "..", "promptlibrary-push-package", "index.html"))

def read(name): return open(os.path.join(HERE, name), encoding="utf-8").read()

def data_uri(name):
    p = os.path.join(ASSETS, name)
    return "data:image/png;base64," + base64.b64encode(open(p, "rb").read()).decode("ascii")

def main():
    data_blocks = read("data_blocks.html")
    assert data_blocks.startswith('<script type="application/json" id="data-prompts">')
    assert data_blocks.rstrip().endswith("</script>")
    head = read("part_head.html")
    head = head.replace("{{LOGO_DATA_URI}}", data_uri("Synottic_Logo.png"))
    head = head.replace("{{FAVICON_DATA_URI}}", data_uri("favicon.png"))
    orgmodel = read("part_orgmodel.json"); json.loads(orgmodel)
    curriculum = read("part_curriculum.json"); json.loads(curriculum)
    admin_seed = read("part_admin_seed.json"); json.loads(admin_seed)
    # order: 1-4 core, then the admin module, then 5 (closes <script> + init)
    order = ["part_app_1.js", "part_backend.js", "part_app_2.js", "part_app_3.js",
             "part_app_4.js", "part_admin.js", "part_app_5.js"]
    app = "".join(read(n) + ("\n" if i < len(order) - 1 else "") for i, n in enumerate(order))
    out = ('<!DOCTYPE html>\n<meta charset="utf-8">\n' + head + "\n" + data_blocks +
           '\n<script type="application/json" id="data-orgmodel">\n' + orgmodel + "</script>\n" +
           '<script type="application/json" id="data-curriculum">\n' + curriculum + "</script>\n" +
           '<script type="application/json" id="data-admin-seed">\n' + admin_seed + "</script>\n" +
           app + "\n")
    open(OUT, "w", encoding="utf-8").write(out)
    if os.path.isdir(os.path.dirname(PUSH)):
        open(PUSH, "w", encoding="utf-8").write(out)
    print("wrote", OUT, len(out), "bytes")

if __name__ == "__main__":
    main()
