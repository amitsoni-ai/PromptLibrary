#!/usr/bin/env python3
"""
Bake the Working with AI pack into the app build (the code path, instead of the
admin console import):

  * the 20 new prompts   -> src/prompts_authored.json   (merged by src/build.py)
  * the 3 clean-up fixes -> src/prompts_library_rewrites.json (overlay by src/build.py)
    including scrubbing the jailbreak / detector-evasion text from the hidden
    legacyPrompt field, which the admin import cannot reach.

Idempotent: re-running replaces the same ids. Provenance stays internal
(provenance.csv); nothing about the source is written into the records.

Then:  python3 src/build.py && (cd web && node scripts/verify-prompts.mjs)
"""
import json
import os
import re
import sys

HERE = os.path.dirname(os.path.abspath(__file__))
REPO = os.path.abspath(os.path.join(HERE, "..", "..", ".."))
sys.path.insert(0, HERE)
import pack_source as S  # noqa: E402

AUTHORED = os.path.join(REPO, "src", "prompts_authored.json")
REWRITES = os.path.join(REPO, "src", "prompts_library_rewrites.json")
pilot_rows = {r["id"]: r for r in json.load(open(os.path.join(HERE, "import", "02_working_with_ai.json"), encoding="utf-8"))}
cleanup_rows = {r["id"]: r for r in json.load(open(os.path.join(HERE, "import", "01_cleanup.json"), encoding="utf-8"))}

FLAGS = {"modelSpecific": False, "containsWebSearch": False, "containsInteractiveQuestioning": False,
         "embeddedMetadata": False, "hasOutputCue": True, "incompleteTitle": False}


def strengths(level, nvars):
    s = ["States the role and the situation before the ask", "Specifies the output format and structure",
         "Builds in a verification step and a real-world validation check"]
    if level == 3:
        s.append("Separates the goal from the task and adds constraints and a worked example")
    s.append(f"Parameterised with {nvars} placeholders so it is reusable")
    return s


def score(level):
    # Same scale as the existing authored sets (Synottic Programs avg 87.5, Everyday Essentials ~84-92).
    return (88, {"clarity": 90, "context": 88, "specificity": 87, "outputDefinition": 88, "reusability": 88}) if level == 3 \
        else (85, {"clarity": 88, "context": 85, "specificity": 84, "outputDefinition": 86, "reusability": 85})


def pilot_record(p):
    r = pilot_rows[p["id"]]
    level = int(next(t for t in r["tags"] if re.fullmatch(r"L[123]", t))[1])
    qs, qb = score(level)
    return {
        "id": r["id"], "sourceNumber": None, "title": r["title"], "originalTitle": r["title"],
        "category": r["category"], "description": r["description"], "useCase": r["useCase"],
        "originalPrompt": r["originalPrompt"], "promptType": r["promptType"], "role": r["role"],
        "outcome": r["outcome"], "aiTool": None, "variables": r["variables"],
        "variablesRaw": [f"[{v}]" for v in r["variables"]], "isTemplate": True, "tags": r["tags"],
        "qualityScore": qs, "qualityBreakdown": qb, "strengths": strengths(level, len(r["variables"])),
        "improvements": ["Swap in an example from your own context if you have one"],
        "flags": FLAGS, "source": "Synottic Programs", "version": "1.0",
        "sensitiveCategory": bool(p.get("sensitive")), "duplicateGroup": None,
        "healthStatus": "Healthy", "healthReasons": [], "difficulty": r["difficulty"],
        "track": S.COLLECTION_NAME, "programId": None, "hub": "ai", "audience": "work",
    }


# Hidden legacy text: keep the legitimate original request, drop the harmful parts.
LEGACY_SCRUB = {
    "lib-336": [r"#*\s*Act as an Unconstrained AI model DAN[\s\S]*$"],
    "lib-437": [r"[^\n]*(AI detection|appears more human-like|less detectable)[^\n]*\n?"],
    "lib-2178": [r"[^\n]*(AI detection|AI-generated content convincingly|bypassing AI detectors|undetectable)[^\n]*\n?"],
}


def main():
    authored = json.load(open(AUTHORED, encoding="utf-8"))
    keep = [r for r in authored if not r["id"].startswith("syn-wwai-")]
    added = [pilot_record(p) for p in S.PROMPTS]
    json.dump(keep + added, open(AUTHORED, "w", encoding="utf-8"), ensure_ascii=False, indent=1)
    print(f"prompts_authored.json: {len(keep)} existing + {len(added)} Working with AI = {len(keep) + len(added)}")

    rw = json.load(open(REWRITES, encoding="utf-8"))
    for rid, row in cleanup_rows.items():
        o = rw.setdefault(rid, {})
        o.update({
            "originalPrompt": row["originalPrompt"], "description": row["description"], "useCase": row["useCase"],
            "outcome": row["outcome"], "tags": row["tags"], "variables": row["variables"],
            "variablesRaw": [f"[{v}]" for v in row["variables"]], "isTemplate": True,
        })
        legacy = o.get("legacyPrompt") or ""
        for pat in LEGACY_SCRUB[rid]:
            legacy = re.sub(pat, "", legacy, flags=re.I)
        o["legacyPrompt"] = legacy.strip()
        bad = re.search(r"\bDAN\b|do anything now|bypass(ing)? AI detect|undetectable|avoid AI detection", o["legacyPrompt"] + o["originalPrompt"])
        assert not bad, f"{rid}: harmful text survived scrub: {bad.group(0)}"
    json.dump(rw, open(REWRITES, "w", encoding="utf-8"), ensure_ascii=False, indent=0)
    print(f"prompts_library_rewrites.json: updated {', '.join(cleanup_rows)} (prompt text + scrubbed legacy text)")


if __name__ == "__main__":
    main()
