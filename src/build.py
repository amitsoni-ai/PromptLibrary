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
    app = "".join(read(f"part_app_{i}.js") + ("\n" if i < 5 else "") for i in range(1, 6))
    out = ('<!DOCTYPE html>\n<meta charset="utf-8">\n' + head + "\n" + data_blocks +
           '\n<script type="application/json" id="data-orgmodel">\n' + orgmodel + "</script>\n" + app + "\n")
    open(OUT, "w", encoding="utf-8").write(out)
    if os.path.isdir(os.path.dirname(PUSH)):
        open(PUSH, "w", encoding="utf-8").write(out)
    print("wrote", OUT, len(out), "bytes")

if __name__ == "__main__":
    main()
