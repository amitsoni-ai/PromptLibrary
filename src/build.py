#!/usr/bin/env python3
"""Assemble ../index.html from the parts in this directory.
Run: python3 build.py   (from prompt-library/src/)"""
import json, os
HERE = os.path.dirname(os.path.abspath(__file__))
OUT = os.path.normpath(os.path.join(HERE, "..", "index.html"))
PUSH = os.path.normpath(os.path.join(HERE, "..", "..", "promptlibrary-push-package", "index.html"))

def read(name): return open(os.path.join(HERE, name), encoding="utf-8").read()

def main():
    data_blocks = read("data_blocks.html")
    assert data_blocks.startswith('<script type="application/json" id="data-prompts">')
    assert data_blocks.rstrip().endswith("</script>")
    head = read("part_head.html")
    orgmodel = read("part_orgmodel.json"); json.loads(orgmodel)
    # order: 1-4 core, then the admin module, then 5 (closes <script> + init)
    order = ["part_app_1.js", "part_app_2.js", "part_app_3.js", "part_app_4.js",
             "part_admin.js", "part_app_5.js"]
    app = "".join(read(n) + ("\n" if i < len(order) - 1 else "") for i, n in enumerate(order))
    out = ('<!DOCTYPE html>\n<meta charset="utf-8">\n' + head + "\n" + data_blocks +
           '\n<script type="application/json" id="data-orgmodel">\n' + orgmodel + "</script>\n" + app + "\n")
    open(OUT, "w", encoding="utf-8").write(out)
    if os.path.isdir(os.path.dirname(PUSH)):
        open(PUSH, "w", encoding="utf-8").write(out)
    print("wrote", OUT, len(out), "bytes")

if __name__ == "__main__":
    main()
