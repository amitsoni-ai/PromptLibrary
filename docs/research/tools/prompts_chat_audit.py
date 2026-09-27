#!/usr/bin/env python3
"""
prompts.chat -> Synottic audit (Phase 1, read-only).

Reads:
  * the prompts.chat repository checkout (prompts.csv) -- the complete public dataset
  * Synottic's library snapshot web/seed/prompts.json and the taxonomy that lives in code
    (TASK_HUBS in src/part_app_1.js, FUNCTIONS in src/part_admin.js)

Writes:
  * docs/research/PROMPTS_CHAT_MAPPING.csv  (one row per prompts.chat prompt)
  * a stats JSON (path given by --stats) used to write the audit report

Nothing here touches the database, the schema, the UI or production data.

Method (see PROMPTS_CHAT_SYNOTTIC_AUDIT.md section 18 for the reasoning):
  1. normalise + language / safety / tool-dependency detection (regex, deterministic)
  2. analytic domain classification (weighted keyword rules; title counts 3x)
  3. one prompt-craft rubric (10 craft criteria, 0-2 each) applied to BOTH libraries
  4. duplicate detection inside prompts.chat (exact hash + TF-IDF cosine >= 0.80)
  5. nearest Synottic prompt (TF-IDF cosine over title + task text) = duplicate_score
  6. rule-based decision -> match_type A..K and Group A / B / C
All scores are lexical heuristics. No embeddings or LLM calls were available offline;
treat duplicate_score as a lower bound on semantic overlap (see report, limitations).

Usage:
  python3 docs/research/tools/prompts_chat_audit.py --pc <prompts.chat checkout> \
      --repo . --out docs/research/PROMPTS_CHAT_MAPPING.csv --stats /tmp/stats.json
Requires: scikit-learn, numpy.
"""
import argparse
import collections as C
import csv
import hashlib
import json
import re
import subprocess

import numpy as np
from sklearn.feature_extraction.text import TfidfVectorizer
from sklearn.metrics.pairwise import cosine_similarity

csv.field_size_limit(10**9)

# ─────────────────────────── detectors ───────────────────────────
EN_STOP = set("the and to of you a in is for that with your be as on this are will it i an or not can my me".split())

# Case-sensitive "DAN"; the rest case-insensitive. Mentions of jailbreaks in defensive/security prompts are NOT flagged.
JAILBREAK_CS = re.compile(r"\bDAN\b|\bSTAN\b|\bDUDE\b mode")
JAILBREAK = re.compile(r"do anything now|jailbroken|ignore (all |any )?(the )?(previous|prior|above) (instructions|rules|prompts|guidelines)|"
                       r"no (ethical|moral) (guidelines|restrictions|limits|boundaries)|without (any )?(ethical |moral )?(restrictions|filters|censorship|limitations)|"
                       r"(you are|you're|act as|become|respond (as|in)) (an? )?(completely )?(unfiltered|uncensored|amoral)|developer mode (enabled|activated|on)|"
                       r"bypass (the |any |all )?(content )?(filters?|safety|guidelines|restrictions|policies)|not bound by (any )?(rules|policies|guidelines)|"
                       r"free from (all )?(openai|the) (rules|policies)|stay in character no matter", re.I)
NSFW = re.compile(r"\bnsfw\b|\bsexy|\bsexual|\berotic|\bnude\b|\bnaked\b|lingerie|seductive|\bporn|hentai|fetish|\bbikini\b|cleavage|onlyfans", re.I)
MALICIOUS = re.compile(r"malware|keylogger|ransomware|phishing|\bddos\b|aimbot|recoil script|wallhack|cheat (engine|menu)|"
                       r"crack(ing)? (passwords?|software|licen[cs]e)|hack(ing)? into|steal (credentials|passwords|data)|"
                       r"bypass (anti-?cheat|drm|paywall)|credit card numbers|fake (id|reviews|documents)", re.I)
LIKENESS = re.compile(r"(person|subject|face|woman|man|people) (from|in) the (uploaded|provided|attached|reference) (photo|image|picture)|"
                      r"uploaded (photo|image|selfie)|mirror[- ]selfie|keep (the )?(facial|face) (features|identity)", re.I)
HIGH_STAKES = re.compile(r"\bdoctor\b|diagnos|medical|symptom|therap(y|ist)|psychiatr|psycholog|mental health|medication|"
                         r"lawyer|legal advi|attorney|financial advi|invest(ing|ment|or)|\bstocks?\b|trading|crypto|\btax(es)?\b|"
                         r"suicid|self-harm", re.I)
TOOLISH = re.compile(r"\bChatGPT\b|\bGPT-?3(\.5)?\b|\bGPT-?4o?\b|\bBard\b|Midjourney|--ar \d|--v \d|--style \w|--stylize|DALL[-·]?E|"
                     r"Stable Diffusion|\bSDXL\b|Nano Banana|\bSora\b|\bVeo ?\d?\b|\bKling\b|\bRunway\b|Leonardo AI|"
                     r"\bplugins?\b|web ?pilot|browsing mode|OpenAI'?s? (content )?polic", re.I)
APP_BUILD_STRONG = re.compile(r"\b(build|create|develop|make)\b[^.\n]{0,80}\b(using|with|in) (html5?|css3?|vanilla javascript|javascript|react|next\.?js|vue|flutter|swiftui|react native)\b", re.I)
ONE_OFF_SPEC = re.compile(r"(^|\.\s+|\n)\s*(your (main )?task is to|you are tasked with|you are responsible for|tasked with)?\s*"
                          r"(build|create|develop|developing|design|implement|make|code|generate|building|creating)\s+(a|an|the|this|my)\s+"
                          r"(?:[^.\n]|\.(?=\S)){0,90}\b(app|application|website|web ?site|tool|game|system|platform|portal|dashboard|library|plugin|extension|"
                          r"bot|script|clone|api|backend|frontend|saas|site|page|component|widget|engine|simulator|calculator|tracker|manager)\b", re.I)
GAMBLING_FANDOM = re.compile(r"\bdice\b|casino|\bbetting\b|\bbets?\b|stake\.us|lottery|sportsbook|roulette|slot machine|"
                             r"\bdota\b|clash of clans|pok[eé]mon|marvel|star wars|harry potter|\bgta\b|red dead|fortnite|minecraft|"
                             r"league of legends|genshin|ghibli|naruto|one piece|anime", re.I)
DECEPTIVE = re.compile(r"bypass (ai |the )?(ai )?detect|undetectable|pass (as|for) human|avoid (ai )?detection|"
                       r"(assignments?|homework|essays?)[^.\n]{0,80}(copied|submit|hand in)|write my (essay|assignment|thesis)|fake (reviews?|testimonials?)", re.I)
SPECULATIVE = re.compile(r"crypto|bitcoin|\bbtc\b|altcoin|memecoin|forex|day ?trad|scalp|leverage|futures|contract trad|signals?\b.*\b(buy|sell)", re.I)
LANG_LEARN = re.compile(r"(learn|learning|teach|tutor|practi[cs]e|lessons?|vocabulary|pronunciation)[^.\n]{0,40}\b(english|japanese|spanish|french|german|chinese|korean|language)|language (learning|tutor|teacher)|\b(ielts|toefl|yks)\b", re.I)
SIM_STRONG = re.compile(r"act as (a |an )?[\w .+#-]{0,25}\b(terminal|console|interpreter|shell|emulator|repl)\b|\bemulate (a |an |two |\d )", re.I)
USER_INPUT_RE = re.compile(r"(the|my|your|given|provided|following|attached|pasted|existing) (code|codebase|repo|repository|pr|pull request|diff|logs?|error|stack ?trace|"
                           r"data|dataset|document|text|draft|file|spreadsheet|transcript|notes|feedback|requirements?|spec)|"
                           r"(i|user|you) will (provide|paste|share|give|send)|provided by the user|user (provides|will provide|input)|\$\{(code|text|input|data|document)", re.I)
SYNTHETIC_IDENTITY = re.compile(r"face ?swap|deep ?fake|voice clon|clone (my|a|the|their) voice|swap (the )?faces?|impersonat", re.I)
DATED = re.compile(r"\b(2023|2024|2025)\b")

ROLE_RE = re.compile(r"\b(act as|acting as|you are (an?|the)|assume the role|adopt the role|role\s*[:：]|persona\s*[:：]|you will be (an?|my))\b", re.I)
OBJECTIVE_RE = re.compile(r"your (main )?(task|goal|objective|job|mission) (is|will be)|\bobjective\s*[:：]|\bgoal\s*[:：]|\btask\s*[:：]|"
                          r"\b(create|write|draft|generate|analy[sz]e|review|design|build|develop|summari[sz]e|explain|plan|evaluate|compare|identify|produce|translate|help me)\b", re.I)
CONTEXT_RE = re.compile(r"\bcontext\s*[:：]|\bbackground\s*[:：]|\baudience\b|target (users?|readers?|market)|\bI am (an?|the|working)|"
                        r"\bI'm (an?|the|working)|my (company|team|business|organi[sz]ation|client|product|role|situation)|"
                        r"\bfor (a|an) (team|company|business|client|beginner|executive)|stakeholders?|\buse case\b", re.I)
CONSTRAINT_RE = re.compile(r"\bdo not\b|\bdon'?t\b|\bmust\b|\bnever\b|\bavoid\b|\bonly\b|\blimit\b|\bno more than\b|\bat most\b|"
                           r"\bconstraints?\b|\brules?\b|\bguardrails?\b|\bmaximum\b|\bwithin \d+|\bunder \d+ words", re.I)
FORMAT_RE = re.compile(r"\bformat\b|\btable\b|\bjson\b|\byaml\b|\bmarkdown\b|bullet|\bheadings?\b|\bsections?\b|numbered list|"
                       r"respond (with|in)|reply (with|in|only)|output\s*[:：]|\boutput (should|must|format|structure)|"
                       r"structure(d)? (as|like)|\btemplate\b|\bcode block\b|word count|\bwords?\b.*\blong\b", re.I)
EXAMPLE_RE = re.compile(r"\bfor example\b|\be\.g\.|\bfor instance\b|\bexamples?\s*[:：]|\bsample (output|input|response)|"
                        r"\bexample (output|input|response)\b|few-?shot", re.I)
VERIFY_RE = re.compile(r"\bverif(y|ication)\b|double-?check|\bvalidat(e|ion)\b|\bcite\b|\bcitations?\b|\bsources?\b|"
                       r"\bassumptions?\b|\bconfidence\b|if (you are |you're )?(unsure|uncertain|not sure)|don'?t (invent|make up|fabricate)|"
                       r"\bhallucinat|\bfact-?check|\bself-?(check|review|critique)|\bquality (check|gate)|\bsanity check|\bflag (any|anything|uncertain)", re.I)
VAR_RE = re.compile(r"\$\{[^}]{1,60}\}|\{\{[^}]{1,60}\}\}|\[[A-Z][A-Z0-9 _/]{2,40}\]|<[A-Z][A-Z0-9 _]{2,40}>|\{[A-Z][A-Z0-9_ ]{2,40}\}")
HARDCODED_INPUT = re.compile(r"my first (request|sentence|command|question|suggestion|prompt|line|query|word|message|topic)", re.I)
INTERACTIVE_RE = re.compile(r"wait for (my|the user'?s?)|one (question )?at a time|one by one|ask me (questions|clarifying)|"
                            r"do not write (all|the whole)|i will (type|provide|give|write|tell|say)|reply (only )?as the|stay in character", re.I)
STEPS_RE = re.compile(r"^\s*(step|phase|stage)\s*\d|^\s*\d+[.)]\s+\S|^\s*#{1,4} ", re.I | re.M)
SKILL_FM = re.compile(r"^---\s*\nname:\s*\S+.*?\ndescription:", re.S)
AGENT_RE = re.compile(r"\bagent\b|system prompt|\bMCP\b|tool (use|calls?|calling)|\btools?\s*[:：]|autonomous|sub-?agents?|"
                      r"\bworkflow\b.*\bagent|claude code|cursor rules|\.cursorrules|AGENTS\.md|\bSKILL\.md", re.I)
TRAINING_ROLEPLAY = re.compile(r"interview(er)?|negotiat|customer|sales|debate|coach|mentor|practice|mock|role-?play (a|an|the) (customer|client|candidate|manager)|"
                               r"difficult conversation|feedback", re.I)

# Analytic domains (the audit's own lens, NOT a proposal for Synottic's taxonomy).
DOMAINS = [
    ("unsafe", None),  # set by detectors
    ("visual_generation", r"photoreal|hyper-?realistic|4k|8k|cinematic|aspect ratio|--ar|camera|lens|\bf/\d|bokeh|lighting|portrait|selfie|wallpaper|poster|"
                          r"illustration|render(ing)?|\bimage\b|photo(graph)?|anime|pixar|ghibli|watercolor|\bscene\b|close-?up|\bshot\b|video|"
                          r"\bframe\b|thumbnail|logo design|3d|isometric|texture|studio"),
    ("app_build", r"(build|create|develop) (a|an) [\w\s-]{0,40}(app|application|tool|game|website|dashboard|timer|calculator|clone|extension|board)|"
                  r"html5|css3|using (html|react|javascript|flutter|swift|kotlin)|landing page|single-page|responsive (ui|design|interface)"),
    ("agent_system", r"^---\s*\nname:|system prompt|\bagent\b|\bMCP\b|autonomous|sub-?agent|tool calls?|claude code|cursor|copilot instructions|"
                     r"operating (mode|principles)|you are an ai assistant|assistant (behaviou?r|persona)"),
    ("prompt_engineering", r"\bprompts?\b.*(engineer|generat|improv|optimi[sz]|refin|rewrite|craft)|prompt engineer|meta-?prompt|\bLLM\b|chain of thought|"
                           r"few-?shot|prompt (template|framework)"),
    ("software_eng", r"\bcode\b|coding|developer|programm|debug|refactor|\bapi\b|backend|frontend|devops|kubernetes|docker|\bci/?cd\b|"
                     r"unit tests?|\btesting\b|\bQA\b|architect|microservice|python|javascript|typescript|java\b|golang|\brust\b|"
                     r"c\+\+|\bsql\b|database|git\b|linux|network|cloud|\baws\b|azure|infrastructure|sysadmin|nixos|security (review|audit)|vulnerab|pull request|code review|spring boot|react|solidity|smart contract"),
    ("data_ml", r"data (analy|scien)|machine learning|\bml\b|dataset|statistic|regression|\bexcel\b|spreadsheet|dashboard|\bkpi\b|visuali[sz]|pandas|tableau|power bi|forecast"),
    ("simulation_game", r"act as (a |an )?(linux |sql |javascript |python |r |php )?(terminal|console|interpreter|shell)|text[- ]based adventure|"
                        r"\badventure game|\bgame\b|tic-?tac-?toe|\bchess\b|\brpg\b|dungeon|role-?play|roleplay|\bcharacter\b|pretend (to be|you are)|"
                        r"fictional|\bsimulat|\bemoji\b|riddle|trivia|magician|fortune|drunk|gaslight|\bgirlfriend\b|\bboyfriend\b|fan ?fic"),
    ("creative_writing", r"\bstory|stories|novel|poem|poet|\bpoetry|screenplay|screenwriter|script ?writer|lyrics|song|rapper|fiction|"
                         r"storyteller|plot|chapter|comedian|stand-?up|\bjokes?\b|fairy ?tale|worldbuild"),
    ("language", r"translat|translator|grammar|spelling|pronunciation|english teacher|language (learning|tutor|teacher)|vocabulary|"
                 r"\bIELTS\b|\bTOEFL\b|proofread|rephrase|paraphras|synonym|etymolog"),
    ("education", r"teacher|tutor|\bteach|student|lesson|curriculum|course|study|\bquiz|exam\b|learn(ing)? (plan|path)|explain (like|to a)|"
                  r"instructional|classroom|homework|\bmath\b|mathematic|academic|university|school"),
    ("career", r"\binterview|resume|\bcv\b|cover letter|career|job (search|application|seeker)|linkedin profile|salary negotiation|recruiter"),
    ("hr_people", r"\bhr\b|human resources|employee|hiring|recruit|onboarding|performance review|job description|workplace|"
                  r"people manager|team building|org(ani[sz]ational)? (design|development)|talent"),
    ("customer_support", r"customer (support|service|success|experience)|support ticket|help ?desk|complaint|refund|\bcsat\b|\bfaq\b"),
    ("sales", r"\bsales\b|\bleads?\b|prospect|cold (email|call|outreach)|\bpitch\b|negotiat|\bcrm\b|\bdeal\b|objection|account executive|b2b"),
    ("marketing_content", r"marketing|\bseo\b|copywrit|\bcopy\b|social media|instagram|tiktok|youtube|linkedin post|twitter|\btweet|advert|\bads?\b|"
                          r"brand(ing)?|campaign|content (strategy|calendar|creator|writer)|blog|newsletter|email (campaign|marketing)|"
                          r"\bASO\b|app store|landing copy|headline|slogan|tagline|influencer|growth hack"),
    ("business_strategy", r"business (plan|model|analyst|idea|strategy)|startup|entrepreneur|consultant|strategy|strategic|\bokrs?\b|swot|"
                          r"market (research|analysis|size)|competitor|product manag|\bprd\b|roadmap|go-to-market|\bgtm\b|pricing|investor|pitch deck|"
                          r"feasibility|operations|supply chain|procurement|\bvendor|project manag|stakeholder|executive"),
    ("finance", r"financ|accountant|accounting|budget|invest|stock (market|price|portfolio|exchange)|trading|crypto|bitcoin|\btax|portfolio|valuation|"
                r"cash ?flow|p&l|balance sheet|\bloan|mortgage|insurance|econom"),
    ("legal", r"legal|lawyer|attorney|contract|compliance|gdpr|privacy (policy|law)|terms of service|regulat|\blaw\b|litigation|intellectual property"),
    ("health_wellbeing", r"doctor|medical|health|fitness|workout|personal trainer|nutrition|diet|meal plan|therapist|mental|psycholog|"
                         r"meditat|mindful|sleep|yoga|dentist|symptom|wellness|stress"),
    ("productivity", r"productiv|planner|schedule|to-?do|habit|time management|\bnotes?\b|summari[sz]|meeting|agenda|minutes|email (reply|writer|draft)|"
                     r"organi[sz]e|checklist|decision|prioriti"),
    ("research", r"research(er)?|literature review|academic (writing|paper)|thesis|dissertation|citation|scientific|hypothes|"
                 r"fact-?check|analy[sz]e (the )?(paper|article|study)|deep research"),
    ("design_ux", r"\bux\b|\bui\b|user experience|user interface|wireframe|usability|figma|design system|product design|accessibility|persona"),
    ("lifestyle", r"travel|trip|itinerary|tour guide|recipe|chef|cook|fashion|stylist|outfit|interior|decor|garden|\bpet\b|\bdog\b|\bcat\b|"
                  r"relationship|dating|parent|wedding|gift|real estate|car\b|home"),
    ("spirituality", r"astrolog|horoscope|tarot|zodiac|religio|bible|quran|spiritual|prayer|\bgod\b|numerolog|dream interpret"),
]
DOMAIN_RX = [(d, re.compile(p, re.I | re.M)) for d, p in DOMAINS if p]
DOMAIN_PRIORITY = {d: i for i, (d, _) in enumerate(DOMAINS)}

# Domain -> Synottic category (EXISTING 28 categories only). None = no home in Synottic -> flagged.
DOMAIN_TO_CATEGORY = {
    "visual_generation": "Image & Design", "app_build": "Coding & Tech", "agent_system": "AI & Prompt Engineering",
    "prompt_engineering": "AI & Prompt Engineering", "software_eng": "Coding & Tech", "data_ml": "Research & Data Analysis",
    "simulation_game": None, "creative_writing": "Book & Ebook Writing", "language": None, "education": "Education & Learning",
    "career": "Career Growth", "hr_people": "HR & Recruiting", "customer_support": "Customer Support",
    "sales": "Sales & Lead Generation", "marketing_content": "Marketing & Branding", "business_strategy": "Business Strategy",
    "finance": "Finance & Accounting", "legal": "Legal & Compliance", "health_wellbeing": "Health & Fitness",
    "productivity": "Productivity & Automation", "research": "Research & Data Analysis", "design_ux": "UX/UI Design",
    "lifestyle": None, "spirituality": "Spirituality & Wellness", "other": None, "unsafe": None,
}
# Where a domain's nearest Synottic home is only partial, we say so (flag, don't create).
DOMAIN_GAP_NOTE = {
    "simulation_game": "No Synottic home: entertainment/simulation. Do not create a category.",
    "language": "No Synottic home: translation / language learning. Closest: Content Writing & Copywriting (editing) or Education & Learning.",
    "lifestyle": "No Synottic home: personal lifestyle. Everyday Essentials 'life' hub covers a slice.",
    "agent_system": "Partial: AI & Prompt Engineering holds prompts, but Synottic has no agent/system-prompt/skill object.",
    "app_build": "Partial: Coding & Tech has no 'build/prototype an app' task family.",
    "software_eng": "Partial: Coding & Tech has no subcategories (code review, testing, DevOps, security, architecture).",
    "creative_writing": "Partial: Book & Ebook Writing (39) is long-form only; no fiction/scriptwriting subcategory.",
}
DOMAIN_VALUE = {  # business value for an enterprise, human-centred AI library
    "hr_people": "High", "customer_support": "High", "sales": "High", "marketing_content": "High", "business_strategy": "High",
    "finance": "High", "legal": "High", "research": "High", "data_ml": "High", "productivity": "High", "software_eng": "High",
    "agent_system": "High", "prompt_engineering": "High", "design_ux": "High", "education": "High",
    "career": "Medium", "language": "Medium", "health_wellbeing": "Medium", "app_build": "Medium", "visual_generation": "Medium",
    "creative_writing": "Low", "lifestyle": "Low", "spirituality": "Low", "simulation_game": "Low", "other": "Low", "unsafe": "Low",
}
PROPOSED_SUBCAT = {
    "software_eng": [("code review", "Code review"), ("review", "Code review"), ("debug", "Debugging"), ("test", "Testing & QA"),
                     ("devops|kubernetes|docker|ci/?cd|deploy", "DevOps & infrastructure"), ("secur|vulnerab", "Security"),
                     ("architect|design pattern|microservice|solid", "Architecture"), ("sql|database", "Databases & SQL"),
                     ("refactor", "Refactoring"), ("document", "Technical documentation")],
    "agent_system": [("^---\\s*\\nname:", "Agent skills (SKILL.md)"), ("system prompt", "System prompts"), ("agent", "Agent instructions")],
    "visual_generation": [("product|brand|marketing|ad\\b|packag", "Marketing visuals"), ("logo|icon", "Logo & icon"),
                          ("portrait|headshot|id photo", "Portraits & headshots"), ("video", "Video generation")],
    "education": [("quiz|exam|assess", "Assessment"), ("lesson|curriculum|course", "Curriculum design"), ("tutor|explain", "Tutoring & explanation")],
    "marketing_content": [("seo|aso", "SEO & ASO"), ("social|instagram|tiktok|linkedin|twitter", "Social content"), ("email|newsletter", "Email"),
                          ("ad\\b|ads\\b|advert", "Advertising"), ("brand", "Brand")],
    "research": [("literature|academic|thesis|paper", "Academic research"), ("fact", "Fact-checking"), ("deep research", "Deep research")],
}

# Synottic role refinement from the FUNCTIONS catalogue roles (existing values in src/part_admin.js).
ROLE_RULES = [
    (r"code review", "Software Engineer"), (r"devops|kubernetes|docker|ci/?cd|\bsre\b|terraform", "DevOps / SRE"),
    (r"\btest(ing|s)?\b|\bqa\b", "QA Engineer"), (r"secur|vulnerab|pentest", "Security Engineer"),
    (r"architect", "Solutions Architect"), (r"data scien|machine learning", "Data Scientist"),
    (r"\bsql\b|dashboard|\bbi\b|power bi|tableau", "Data Analyst"), (r"business analyst|requirements", "Business Analyst"),
    (r"fp&a|forecast|financial model", "FP&A Analyst"), (r"accountant|bookkeep|reconcil", "Accountant"),
    (r"contract", "Contracts Manager"), (r"privacy|gdpr|data protection", "Privacy / DPO"), (r"compliance|regulat", "Compliance Officer"),
    (r"\bseo\b", "SEO Specialist"), (r"social media|instagram|tiktok", "Social Media Manager"), (r"content market|blog", "Content Marketer"),
    (r"product marketing|go-to-market|\bgtm\b", "Product Marketer"), (r"recruit|interview|job description|candidate", "Recruiter"),
    (r"instructional|curriculum|course design|e-?learning", "Instructional Designer"), (r"trainer|workshop|facilitat", "Corporate Trainer"),
    (r"product manag|\bprd\b|roadmap|user stor", "Product Manager"), (r"ux research|usability", "UX Researcher"),
    (r"project manag", "Project Manager"), (r"scrum|agile|sprint", "Scrum Master"), (r"supply chain|logistic|inventory", "Supply Chain Manager"),
    (r"procure|sourcing|supplier|rfp", "Procurement Manager"), (r"customer success", "Customer Success Manager"),
    (r"customer (support|service)|help ?desk|ticket", "Support Agent"), (r"sales|prospect|lead gen|cold (email|call)", "Sales Executive"),
    (r"software|developer|programm|coding", "Software Engineer"),
]


def rr_ok(role, cat, role_to_fn, cat_to_fn):
    """Only accept a function-catalogue role if its function draws on the mapped category."""
    fn = role_to_fn.get(role)
    return cat is None or (fn is not None and fn in cat_to_fn.get(cat, []))


def parse_task_hubs(repo):
    s = open(f"{repo}/src/part_app_1.js", encoding="utf-8").read()
    blk = s[s.index("const TASK_HUBS = ["):s.index("const TASK_HUBS_BY_ID")]
    hubs = []
    for m in re.finditer(r'\{ id: "(\w+)", label: "([^"]+)".*?match: \[([^\]]*)\](?:,\s*hint: \[([^\]]*)\])?', blk, re.S):
        hubs.append({"id": m.group(1), "label": m.group(2), "match": re.findall(r'"([^"]+)"', m.group(3)),
                     "hint": re.findall(r'"([^"]+)"', m.group(4) or "")})
    return hubs


def parse_functions(repo):
    s = open(f"{repo}/src/part_admin.js", encoding="utf-8").read()
    fns = {}
    for m in re.finditer(r'^\s*"([^"]+)": \{ program: "[^"]+", categories: \[([^\]]*)\], roles: \[([^\]]*)\] \}', s, re.M):
        fns[m.group(1)] = {"categories": re.findall(r'"([^"]+)"', m.group(2)), "roles": re.findall(r'"([^"]+)"', m.group(3))}
    return fns


def detect_hub(text, hubs):
    """Python port of src/part_app_1.js#detectTaskHub (same scoring: match len*2, hint 2)."""
    q = " " + re.sub(r"[^a-z0-9: -]+", " ", text.lower()) + " "
    q = re.sub(r"\s+", " ", q)
    best, best_s = None, 0
    for h in hubs:
        s = 0
        for m in h["match"]:
            if re.search(r" " + re.escape(m) + r"(s|es|ed|ing|er|ers)?[ :]", q):
                s = max(s, len(m) * 2)
        for m in h["hint"]:
            if re.search(r" " + re.escape(m) + r"(s|es|ed|ing|er|ers)?[ :]", q):
                s = max(s, 2)
        if s > best_s:
            best, best_s = h, s
    return best


DEFENSIVE_CTX = re.compile(r"never|do not|don'?t|must not|detect|such as|e\.g\.|for example|like [\"'“]|test(s|ing)?|resist|block|prevent|against|"
                           r"injection|attack|refuse|flag|vulnerab|red[- ]team|adversarial", re.I)


def is_jailbreak(title, text):
    if JAILBREAK_CS.search(title + " " + text[:3000]):
        return True
    for m in JAILBREAK.finditer(title + " " + text):
        window = (title + " " + text)[max(0, m.start() - 120):m.start()]
        if not DEFENSIVE_CTX.search(window):
            return True
    return False


NEG_CTX = re.compile(r"\bno\b|\bnot\b|\bnon-?|avoid|without|never|exclude|free of|must not|do not|don'?t|safe|appropriate|detect|filter|flag|protect|"
                     r"report|awareness|notif|prevent|defen[cs]|secur|analy[sz]", re.I)


AFTER_CTX = re.compile(r"^\W{0,3}(protection|detection|indicators?|awareness|prevention|defen[cs]e|attacks?,|acronyms?|or suggestive|content (filter|detection)|.{0,25}(notification|alert|detector|awareness))", re.I)


def flagged(rx, text, window=100):
    for m in rx.finditer(text):
        before, after = text[max(0, m.start() - window):m.start()], text[m.end():m.end() + 40]
        if NEG_CTX.search(before) or AFTER_CTX.search(after) or re.search(r"(attacks?|spoofing|mitm|dos)\W", before[-40:], re.I):
            continue
        return True
    return False


def is_english(t):
    letters = [c for c in t if c.isalpha()]
    if not letters:
        return True
    non_ascii = sum(ord(c) > 127 for c in letters) / len(letters)
    toks = re.findall(r"[a-zA-Z']+", t.lower())
    stop = sum(w in EN_STOP for w in toks) / max(1, len(toks))
    if non_ascii > 0.30:
        return False
    if len(toks) >= 20 and stop < 0.07:
        return False
    return True


def classify_domain(title, text, flags):
    if flags["unsafe"]:
        return "unsafe"
    scores = C.Counter()
    head = text[:3000]
    for d, rx in DOMAIN_RX:
        t_hits = len(set(m.group(0).lower() for m in rx.finditer(title)))
        b_hits = len(set(m.group(0).lower() for m in rx.finditer(head)))
        if t_hits or b_hits:
            scores[d] = t_hits * 3 + min(b_hits, 6)
    if SKILL_FM.search(text[:400]):
        scores["agent_system"] += 6
    if SIM_STRONG.search(text[:300]):
        return "simulation_game"
    if APP_BUILD_STRONG.search(text[:600]):
        return "app_build"
    if not scores:
        return "other"
    top = max(scores.values())
    cands = [d for d, s in scores.items() if s == top]
    return sorted(cands, key=lambda d: DOMAIN_PRIORITY[d])[0]


def craft_scores(text):
    """10 prompt-craft criteria, 0..2 each. Same function scores Synottic and prompts.chat."""
    words = len(text.split())
    nvars = len(set(VAR_RE.findall(text)))
    c = {}
    c["objective"] = 2 if re.search(r"your (main )?(task|goal|objective|job|mission)|\b(goal|objective|task)\s*[:：]", text, re.I) else (1 if OBJECTIVE_RE.search(text) else 0)
    role = ROLE_RE.search(text)
    c["role"] = 2 if role and re.search(r"(senior|expert|experienced|specialist|professional|\d+ years)", text[:600], re.I) else (1 if role else 0)
    ctx = len(CONTEXT_RE.findall(text))
    c["context"] = 2 if ctx >= 2 else (1 if ctx == 1 or nvars >= 2 else 0)
    c["specific_task"] = 2 if words >= 60 else (1 if words >= 25 else 0)
    k = len(CONSTRAINT_RE.findall(text))
    c["constraints"] = 2 if k >= 3 else (1 if k >= 1 else 0)
    f = len(FORMAT_RE.findall(text))
    c["output_format"] = 2 if f >= 2 else (1 if f == 1 else 0)
    c["variables"] = 2 if nvars >= 2 else (1 if nvars == 1 or HARDCODED_INPUT.search(text) else 0)
    e = EXAMPLE_RE.findall(text)
    c["examples"] = 2 if re.search(r"\bexamples?\s*[:：]|few-?shot|sample (output|input)|strong\s*[:：].*weak\s*[:：]", text, re.I) else (1 if e else 0)
    v = len(VERIFY_RE.findall(text))
    c["verification"] = 2 if v >= 2 else (1 if v == 1 else 0)
    if nvars >= 1:
        c["reusability"] = 2
    elif HARDCODED_INPUT.search(text) or INTERACTIVE_RE.search(text) or words < 120:
        c["reusability"] = 1
    else:
        c["reusability"] = 0  # long, no inputs: usually written for one situation
    total = round(sum(c.values()) / 20 * 100)
    return c, total


def extract_role(title, text):
    m = re.search(r"(?:act as|acting as|you are|assume the role of|adopt the role of)\s+(?:an?|the)?\s*\**([A-Za-z][\w &/+\-]{2,60}?)(?:[.,;:\n*]|\s(?:who|with|that|and you|specializ|specialis|tasked|for))", text[:800], re.I)
    if m:
        return m.group(1).strip()
    m = re.search(r"role\s*[:：]\s*\**([^\n.]{3,60})", text[:800], re.I)
    return m.group(1).strip("* ") if m else ""


def extract_task(title, text):
    m = re.search(r"(?:your (?:main )?(?:task|goal|objective|job|mission) (?:is|will be) to|task\s*[:：]|objective\s*[:：]|goal\s*[:：])\s*([^\n]{10,200})", text, re.I)
    if m:
        s = m.group(1)
    else:
        sents = re.split(r"(?<=[.!?])\s+|\n+", text.strip())
        s = next((x for x in sents if OBJECTIVE_RE.search(x) and not re.match(r"^(#|---|\{|<)", x.strip())), sents[0] if sents else title)
    s = re.sub(r"\s+", " ", s).strip()
    return s[:200]


def synottic_doc(r):
    t = r["originalPrompt"] or ""
    task = re.search(r"^Task:\s*(.*)$", t, re.M)
    legacy = " ".join((r.get("legacyPrompt") or "").split()[:150])
    return " ".join([r["title"]] * 2 + [r.get("legacyTitle") or "", r.get("description") or "", task.group(1) if task else "",
                     r.get("outcome") or "", legacy])


def prompt_type_for(text, decision_hint):
    if decision_hint == "I":
        return "Workflow"
    tl = text[:1500].lower()
    for rx, pt in [(r"\banaly[sz]|\breview\b|\baudit|\bevaluat|\bassess", "Analysis"), (r"\bplan\b|\bschedule|\broadmap", "Planning"),
                   (r"\bstrateg", "Strategy"), (r"brainstorm|\bideas\b", "Brainstorm"), (r"\bcoach|\bmentor|\bpractice", "Coaching"),
                   (r"\bresearch", "Research"), (r"\bdecid|\bdecision|\bchoose\b", "Decision"),
                   (r"\bstory|\bpoem|\bimage\b|illustrat|creative", "Creative"), (r"\bwrite\b|\bdraft\b|\bcopy\b", "Writing")]:
        if re.search(rx, tl):
            return pt
    return "Reusable Prompt"


def output_type_for(domain, text, pc_type):
    if pc_type == "IMAGE" or domain == "visual_generation":
        return "video" if re.search(r"\bvideo\b|\bclip\b|\bfootage", text[:1500], re.I) else "image"
    if domain in ("app_build", "software_eng"):
        return "code"
    if pc_type == "STRUCTURED" or re.search(r"\bjson\b|\byaml\b|\bcsv\b", text[:2000], re.I):
        return "structured data"
    if INTERACTIVE_RE.search(text) or domain == "simulation_game":
        return "conversation"
    if re.search(r"\btable\b|\breport\b|\bplan\b|\bdocument\b", text[:2000], re.I):
        return "document"
    return "text"


def capability_for(domain, text):
    tl = text[:1500].lower()
    if domain in ("visual_generation",):
        return "image/video generation"
    if domain in ("app_build", "software_eng"):
        return "code generation"
    if domain == "agent_system":
        return "agentic / tool use"
    if re.search(r"translat|rewrite|paraphras|proofread|convert", tl):
        return "transform"
    if re.search(r"analy[sz]|review|evaluat|assess|audit|compare", tl):
        return "analyze / evaluate"
    if re.search(r"research|search the web|sources", tl):
        return "research / retrieval"
    if INTERACTIVE_RE.search(text):
        return "converse / simulate"
    if re.search(r"plan|strategy|decide|decision|reason", tl):
        return "reason / plan"
    return "generate"


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--pc", required=True)
    ap.add_argument("--repo", default=".")
    ap.add_argument("--out", required=True)
    ap.add_argument("--stats", required=True)
    a = ap.parse_args()

    pc_commit = subprocess.run(["git", "-C", a.pc, "rev-parse", "HEAD"], capture_output=True, text=True).stdout.strip()
    pc_rows = list(csv.DictReader(open(f"{a.pc}/prompts.csv", encoding="utf-8")))
    syn = json.load(open(f"{a.repo}/web/seed/prompts.json", encoding="utf-8"))
    hubs = parse_task_hubs(a.repo)
    fns = parse_functions(a.repo)
    role_to_fn = {r: f for f, v in fns.items() for r in v["roles"]}
    cat_to_fn = C.defaultdict(list)
    for f, v in fns.items():
        for c in v["categories"]:
            cat_to_fn[c].append(f)
    cat_role = {c: C.Counter(r["role"] for r in syn if r["category"] == c).most_common(1)[0][0] for c in set(r["category"] for r in syn)}

    # ── Synottic craft scores with the same rubric
    syn_craft = []
    for r in syn:
        _, tot = craft_scores(r["originalPrompt"] or "")
        syn_craft.append(tot)
    syn_crit = C.Counter()
    for r in syn:
        cs, _ = craft_scores(r["originalPrompt"] or "")
        for k, v in cs.items():
            syn_crit[k] += v

    # ── prompts.chat features
    recs = []
    for i, r in enumerate(pc_rows, 1):
        title, text = (r["act"] or "").strip(), (r["prompt"] or "").strip()
        flags = {
            "english": is_english(title + " " + text),
            "jailbreak": is_jailbreak(title, text),
            "nsfw": flagged(NSFW, title + " " + text[:3000], 60),
            "malicious": flagged(MALICIOUS, title + " " + text[:4000]),
            "likeness": bool(LIKENESS.search(text[:3000])),
            "high_stakes": bool(HIGH_STAKES.search(title + " " + text[:3000])),
            "tool_refs": len(set(m.group(0).lower() for m in TOOLISH.finditer(title + " " + text))),
            "tool_in_title": bool(TOOLISH.search(title)),
            "dated": bool(DATED.search(title + " " + text[:2000])),
            "skill_file": bool(SKILL_FM.search(text[:400])),
            "interactive": bool(INTERACTIVE_RE.search(text) or HARDCODED_INPUT.search(text)),
            "steps": len(STEPS_RE.findall(text)),
            "agentish": bool(AGENT_RE.search(title + " " + text[:3000])),
        }
        flags["unsafe"] = flags["jailbreak"] or flags["nsfw"] or flags["malicious"]
        crit, craft = craft_scores(text)
        domain = classify_domain(title, text, flags)
        recs.append({"i": i, "title": title, "text": text, "type": r["type"], "for_devs": r["for_devs"], "contributor": r["contributor"],
                     "words": len(text.split()), "flags": flags, "crit": crit, "craft": craft, "domain": domain})

    # ── duplicates inside prompts.chat
    def norm(t):
        t = re.sub(r"\$\{[^}]+\}|\{\{[^}]+\}\}|\[[^\]]+\]", "", t.lower())
        return re.sub(r"\s+", " ", re.sub(r"[^\w\s]", "", t)).strip()
    pc_docs = [(x["title"] + " ") * 2 + x["text"][:4000] for x in recs]
    vec_pc = TfidfVectorizer(ngram_range=(1, 2), stop_words="english", sublinear_tf=True, min_df=1, max_features=200000)
    Xpc = vec_pc.fit_transform(pc_docs)
    S = cosine_similarity(Xpc, dense_output=False).tocoo()
    parent = list(range(len(recs)))

    def find(x):
        while parent[x] != x:
            parent[x] = parent[parent[x]]
            x = parent[x]
        return x
    hashes = {}
    for k, x in enumerate(recs):
        h = hashlib.sha1(norm(x["text"]).encode()).hexdigest()
        if h in hashes:
            parent[find(k)] = find(hashes[h])
        else:
            hashes[h] = k
    for p, q, v in zip(S.row, S.col, S.data):
        if p < q and v >= 0.80:
            parent[find(p)] = find(q)
    groups = C.defaultdict(list)
    for k in range(len(recs)):
        groups[find(k)].append(k)
    dup_cluster = {}
    for gid, (root, members) in enumerate(sorted(groups.items(), key=lambda kv: min(kv[1])), 1):
        canon = max(members, key=lambda k: (recs[k]["craft"], recs[k]["words"]))
        for k in members:
            recs[k]["dup_cluster"] = f"pcdup-{gid:04d}" if len(members) > 1 else ""
            recs[k]["dup_canonical"] = (k == canon)
            recs[k]["dup_size"] = len(members)

    # ── nearest Synottic prompt
    syn_docs = [synottic_doc(r) for r in syn]
    pc_q = [(x["title"] + " ") * 2 + extract_task(x["title"], x["text"]) + " " + " ".join(x["text"].split()[:150]) for x in recs]
    vec = TfidfVectorizer(ngram_range=(1, 2), stop_words="english", sublinear_tf=True, min_df=2).fit(syn_docs + pc_q)
    Xs, Xq = vec.transform(syn_docs), vec.transform(pc_q)
    sim_content = cosine_similarity(Xq, Xs)
    tvec = TfidfVectorizer(analyzer="char_wb", ngram_range=(3, 5), sublinear_tf=True).fit(
        [r["title"] + " " + (r.get("legacyTitle") or "") for r in syn] + [x["title"] for x in recs])
    sim_title = cosine_similarity(tvec.transform([x["title"] for x in recs]), tvec.transform([r["title"] for r in syn]))
    # title agreement only counts when the content agrees at least a little
    sim = np.maximum(sim_content, np.where(sim_content >= 0.12, sim_title * 0.85, 0))
    legacy_norm = [re.sub(r"\s+", " ", (r.get("legacyPrompt") or "").lower()) for r in syn]
    for k, x in enumerate(recs):
        w = re.sub(r"\s+", " ", x["text"].lower()).split()
        x["verbatim_in"] = None
        if len(w) >= 14:
            opening = " ".join(w[:12])
            for j, lt in enumerate(legacy_norm):
                if lt and opening in lt:
                    x["verbatim_in"] = j
                    sim[k, j] = 1.0
                    break
    for k, x in enumerate(recs):
        order = np.argsort(-sim[k])[:15]
        j = int(order[0])
        x["near_id"], x["near_title"], x["dup_score"] = syn[j]["id"], syn[j]["title"], float(sim[k, j])
        x["near_cat"], x["near_craft"] = syn[j]["category"], syn_craft[j]
        votes = C.Counter()
        for jj in order:
            votes[syn[jj]["category"]] += float(sim[k, jj])
        x["knn_cat"] = votes.most_common(1)[0][0] if votes else None

    # ── decide
    for x in recs:
        f, d, dup = x["flags"], x["domain"], x["dup_score"]
        cat = DOMAIN_TO_CATEGORY.get(d)
        if d == "other" or cat is None and d not in ("simulation_game", "lifestyle", "language", "unsafe"):
            cat = x["knn_cat"] if dup >= 0.15 else cat
        x["syn_cat"] = cat
        value = DOMAIN_VALUE.get(d, "Low")
        blob = (x["title"] + " " + x["text"][:2000]).lower()
        if d == "visual_generation" and re.search(r"product (photo|shot|image)|brand|marketing|advert|packag|logo|headshot|corporate|infographic", blob):
            value = "Medium"
        elif d == "visual_generation":
            value = "Low"
        if d == "finance" and SPECULATIVE.search(blob):
            value = "Low"
        if d == "language":
            value = "Low" if LANG_LEARN.search(blob) else "Medium"
        if d == "creative_writing" and re.search(r"marketing|brand|business|speech|presentation|story ?tell", blob):
            value = "Medium"
        if d == "simulation_game" and TRAINING_ROLEPLAY.search(x["title"] + " " + x["text"][:600]):
            value = "Medium"
        x["value"] = value

        risk = "Low"
        if f["high_stakes"] or f["likeness"] or d in ("legal", "finance", "health_wellbeing", "hr_people"):
            risk = "Medium"
        if f["unsafe"]:
            risk = "High"
        x["risk"] = risk

        tool_dep = f["tool_in_title"] or f["tool_refs"] >= 2 or bool(re.search(r"--ar \d|--v \d|--style", x["text"]))
        workflow = x["words"] >= 250 and f["steps"] >= 5 and not f["skill_file"] and d not in ("visual_generation", "app_build")
        agent = (f["skill_file"] or d == "agent_system" or (f["agentish"] and x["words"] >= 300)) and d != "unsafe"
        roleplay_training = d == "simulation_game" and value == "Medium"
        operates_on_input = bool(USER_INPUT_RE.search(x["text"][:2500]))
        one_off = (not f["interactive"] and not f["skill_file"] and not operates_on_input
                   and d in ("software_eng", "app_build", "data_ml", "design_ux", "business_strategy", "education", "other", "productivity")
                   and bool(ONE_OFF_SPEC.search(x["text"][:700])))

        reasons, mt, action = [], None, None
        strong = x["craft"] >= 55
        usable = x["craft"] >= 40
        if not f["english"]:
            mt, action = "F", "Reject"; reasons.append("Not in English; Synottic library is English-only")
        elif f["unsafe"]:
            mt, action = "F", "Reject"
            reasons.append("Unsafe: " + ", ".join(k for k in ("jailbreak", "nsfw", "malicious") if f[k]))
        elif x["dup_cluster"] and not x["dup_canonical"]:
            mt, action = "G", "Reject"; reasons.append(f"Duplicate inside prompts.chat ({x['dup_cluster']}, {x['dup_size']} copies); keep the canonical copy only")
        elif x["verbatim_in"] is not None:
            mt, action = "A", "Ignore (covered)"
            reasons.append(f"Already inside Synottic: its text is in the legacy body of {x['near_id']} (imported earlier without provenance)")
        elif x["words"] < 15 or x["craft"] < 25:
            mt, action = "F", "Reject"; reasons.append(f"Weak: too thin to be useful ({x['words']} words, craft {x['craft']})")
        elif flagged(SYNTHETIC_IDENTITY, x["title"] + " " + x["text"][:2000]):
            mt, action = "F", "Reject"; reasons.append("Unsafe/misuse: synthetic identity (face swap, voice cloning or impersonation) needs consent controls Synottic cannot enforce")
        elif DECEPTIVE.search(x["title"] + " " + x["text"][:3000]):
            mt, action = "F", "Reject"; reasons.append("Unsafe/misuse: deception (AI-detection evasion, ghost-written assessed work or fake reviews)")
        elif SPECULATIVE.search(x["title"] + " " + x["text"][:600]) and d in ("finance", "business_strategy", "other", "marketing_content"):
            mt, action = "F", "Reject"; reasons.append("Not appropriate: speculative crypto / trading content")
        elif GAMBLING_FANDOM.search(x["title"] + " " + x["text"][:800]):
            mt, action = "F", "Reject"; reasons.append("Not appropriate: gambling or fan/IP-derived entertainment content")
        elif d == "simulation_game" and not roleplay_training:
            mt, action = "F", "Reject"; reasons.append("Not appropriate: entertainment / simulation, outside Synottic's enterprise scope")
        elif d in ("lifestyle", "spirituality"):
            mt, action = "F", "Reject"; reasons.append("Not appropriate: personal lifestyle/spiritual use (Everyday Essentials already covers core life-admin)")
        elif d == "visual_generation" and (value == "Low" or x["crit"]["variables"] == 0):
            mt, action = "F", "Reject"; reasons.append("One-off image/scene description, not a reusable work task")
        elif d == "app_build" and not operates_on_input:
            mt, action = "H", "Reject"; reasons.append("One-off app build spec (vibe-coding); the pattern is captured once as a transformed template instead")
        elif one_off:
            mt, action = "H", "Reject"; reasons.append("One-off build spec for a single named artefact (no inputs); not reusable. Pattern captured once as a transformed template")
        elif tool_dep and d != "agent_system":
            mt, action = "H", "Reject"; reasons.append(f"Outdated / tool-specific: depends on named model or tool syntax ({f['tool_refs']} refs)")
        elif dup >= 0.45:
            if x["craft"] >= x["near_craft"] + 10 and value != "Low":
                mt, action = "C", "Improve/Merge"; reasons.append(f"Better version of {x['near_id']} '{x['near_title']}' (craft {x['craft']} vs {x['near_craft']}): merge its stronger elements")
            else:
                mt, action = "A", "Ignore (covered)"; reasons.append(f"Already covered by {x['near_id']} '{x['near_title']}'")
        elif roleplay_training:
            mt, action = "J", "Import/Adapt" if usable else "Reject"
            reasons.append("Practice/role-play simulation: fits as an interactive coaching agent, not a static prompt")
        elif agent:
            mt = "J"
            action = "Import/Adapt" if (value == "High" and usable) else "Reject"
            reasons.append("Agent / system-prompt / skill artefact: better as an agent definition than a library prompt" +
                           ("" if action != "Reject" else " (low value or weak craft)"))
        elif workflow:
            mt = "I"
            action = "Import/Adapt" if (value == "High" and usable) else "Reject"
            reasons.append(f"Multi-step ({f['steps']} steps/sections): better as a workflow" + ("" if action != "Reject" else " (low value or weak craft)"))
        elif dup >= 0.28:
            if x["craft"] >= x["near_craft"] - 5 and value != "Low" and usable:
                mt, action = "B", "Improve/Merge"; reasons.append(f"Similar to {x['near_id']} '{x['near_title']}'; mine for a variant or missing elements")
            else:
                mt, action = "B", "Ignore (covered)"; reasons.append(f"Similar to {x['near_id']} '{x['near_title']}' and not stronger")
        else:
            gap = DOMAIN_TO_CATEGORY.get(d) is None or d in DOMAIN_GAP_NOTE
            if value == "Low":
                mt, action = "F", "Reject"; reasons.append("Not covered, but low business value for Synottic's audience")
            elif not usable:
                mt, action = "F", "Reject"; reasons.append(f"Usable but generic: uncovered topic, but weak craft ({x['craft']}); cheaper to author fresh")
            elif gap:
                mt, action = "E", "Import/Adapt"; reasons.append("Missing use case in a weakly-represented area: " + DOMAIN_GAP_NOTE.get(d, "no Synottic home"))
            elif value == "High" and strong:
                mt, action = "D", "Import/Adapt"; reasons.append("Missing use case; strong source prompt")
            else:
                mt, action = "K", "Import/Adapt"; reasons.append("Missing use case; valuable but needs full rewrite into R-C-T-F(-V-V)")
        x["match_type"], x["action"], x["reason"] = mt, action, "; ".join(reasons)
        x["group"] = {"Import/Adapt": "A", "Improve/Merge": "B"}.get(action, "C")
        x["priority"] = ("P1" if value == "High" and strong else "P2") if x["group"] in ("A", "B") else ""

        # transformation needed
        cr = x["crit"]
        need = []
        if cr["role"] < 2: need.append("add specific role")
        if cr["context"] < 2: need.append("add context")
        if cr["variables"] < 2: need.append("parameterise inputs as [VARIABLES]")
        if cr["output_format"] < 2: need.append("define output format")
        if cr["verification"] < 1: need.append("add Verification + Validation")
        if cr["examples"] < 1 and x["value"] == "High": need.append("add strong/weak example")
        if f["tool_refs"]: need.append("strip tool/model references")
        if f["interactive"] and mt not in ("J",): need.append("replace 'my first request is…' with variables")
        if mt == "I": need.append("split into workflow steps with hand-offs")
        if mt == "J": need.append("convert to agent spec (goal, tools, stop rules, human checkpoints)")
        if x["risk"] == "Medium": need.append("add human-review / not-advice guardrail")
        x["transform"] = "; ".join(need) if x["group"] in ("A", "B") else ""

        # taxonomy mapping
        role = cat_role.get(cat or "", "")
        # title first, then the prompt's own persona line, then its opening; first tier with a hit wins
        for blob_r in (x["title"], extract_role(x["title"], x["text"]), x["text"][:400]):
            hit = next((rr for rx, rr in ROLE_RULES if re.search(rx, blob_r.lower())), None)
            if hit:
                if rr_ok(hit, cat, role_to_fn, cat_to_fn):
                    role = hit
                break
        x["syn_role"] = role or "UNMAPPED"
        x["syn_function"] = role_to_fn.get(role) or (cat_to_fn.get(cat or "") or ["General / Cross-functional"])[0]
        hub = detect_hub(x["title"] + " " + extract_task(x["title"], x["text"]), hubs)
        x["syn_task"] = hub["label"] if hub else "UNMAPPED (no matching task hub)"
        sub = ""
        for rx, lab in PROPOSED_SUBCAT.get(d, []):
            if re.search(rx, x["title"] + " " + x["text"][:1500], re.I | re.M):
                sub = "PROPOSED: " + lab
                break
        x["syn_subcat"] = sub or "n/a (Synottic has no subcategory level)"
        if "Task-Oriented Execution Model" in x["text"]:
            fam = "family: 'Agent Role' series"
        elif f["skill_file"]:
            fam = "family: SKILL.md"
        elif "Use this agent when" in x["text"]:
            fam = "family: sub-agent definition"
        elif re.match(r"\s*I want you to act as", x["text"], re.I):
            fam = "family: classic 'I want you to act as'"
        elif x["type"] == "STRUCTURED":
            fam = "family: JSON/YAML structured"
        else:
            fam = sub.replace("PROPOSED: ", "") if sub else "general"
        x["theme"] = f"{d} / {fam}"
        lvl = "Advanced" if x["craft"] >= 70 and x["words"] >= 250 else ("Beginner" if x["words"] < 80 and x["craft"] < 55 else "Intermediate")
        x["difficulty"] = lvl
        x["prompt_type"] = prompt_type_for(x["text"], mt)
        x["output_type"] = output_type_for(d, x["text"], x["type"])
        x["capability"] = capability_for(d, x["text"])
        x["user_type"] = "Developer / technical" if (x["for_devs"] == "TRUE" or d in ("software_eng", "app_build", "agent_system")) else \
                         ("Personal" if d in ("lifestyle", "spirituality", "health_wellbeing") else "Business professional")
        ind = re.search(r"\b(healthcare|hospital|bank(ing)?|insurance|retail|e-?commerce|real estate|education|saas|manufactur\w*|legal|pharma\w*|hospitality|restaurant|logistics|government|non-?profit|automotive|gaming|crypto)\b", blob_r)
        x["industry"] = ("detected: " + ind.group(1)) if ind else "Cross-industry"
        x["src_role"] = extract_role(x["title"], x["text"])
        x["src_task"] = extract_task(x["title"], x["text"])

    # ── write CSV
    cols = ["source_prompt_id", "source_title", "source_category", "source_tags", "source_role", "source_task",
            "synottic_match", "synottic_role", "synottic_task", "synottic_category", "synottic_subcategory",
            "match_type", "duplicate_score", "quality_score", "business_value", "recommended_action",
            "transformation_required", "reason", "provenance",
            # extra analysis columns
            "group", "priority", "analytic_domain", "synottic_function", "synottic_prompt_type", "difficulty", "user_type",
            "output_type", "ai_capability", "industry", "risk_level", "source_type", "source_for_devs", "word_count",
            "internal_duplicate_cluster", "theme_cluster", "craft_breakdown"]
    with open(a.out, "w", newline="", encoding="utf-8") as fh:
        w = csv.writer(fh)
        w.writerow(cols)
        for x in recs:
            f = x["flags"]
            tags = [k for k in ("interactive", "skill_file", "likeness", "high_stakes", "dated") if f[k]]
            if f["tool_refs"]: tags.append(f"tool_refs:{f['tool_refs']}")
            if not f["english"]: tags.append("non_english")
            w.writerow([
                f"pc-{x['i']:04d}", x["title"], "not in repo (live DB only)", "|".join(tags), x["src_role"], x["src_task"],
                f"{x['near_id']} | {x['near_title']}", x["syn_role"], x["syn_task"],
                x["syn_cat"] or f"UNMAPPED ({DOMAIN_GAP_NOTE.get(x['domain'], 'no Synottic home')})", x["syn_subcat"],
                x["match_type"], f"{x['dup_score']:.2f}", x["craft"], x["value"], x["action"],
                x["transform"], x["reason"],
                f"prompts.chat prompts.csv row {x['i']} @ {pc_commit[:7]}; contributor @{x['contributor']}; CC0-1.0",
                x["group"], x["priority"], x["domain"], x["syn_function"], x["prompt_type"], x["difficulty"], x["user_type"],
                x["output_type"], x["capability"], x["industry"], x["risk"], x["type"], x["for_devs"], x["words"],
                x["dup_cluster"], x["theme"], json.dumps(x["crit"], separators=(",", ":")),
            ])

    # ── stats for the report
    def cnt(key, sub=None):
        return C.Counter((x[key] if sub is None else x[key][sub]) for x in recs)
    by_domain = C.defaultdict(C.Counter)
    for x in recs:
        by_domain[x["domain"]][x["group"]] += 1
        by_domain[x["domain"]]["_n"] += 1
    stats = {
        "pc_commit": pc_commit, "pc_rows": len(recs), "syn_rows": len(syn),
        "type": cnt("type"), "for_devs": cnt("for_devs"),
        "english": sum(x["flags"]["english"] for x in recs),
        "unsafe": {k: sum(x["flags"][k] for x in recs) for k in ("jailbreak", "nsfw", "malicious", "likeness", "high_stakes", "skill_file", "interactive")},
        "tool_dependent": sum(1 for x in recs if x["flags"]["tool_in_title"] or x["flags"]["tool_refs"] >= 2),
        "dup_clusters": len([g for g in groups.values() if len(g) > 1]), "dup_members": sum(len(g) for g in groups.values() if len(g) > 1),
        "domain": cnt("domain"), "match_type": cnt("match_type"), "action": cnt("action"), "group": cnt("group"), "value": cnt("value"),
        "risk": cnt("risk"), "syn_cat": cnt("syn_cat"), "syn_task": cnt("syn_task"), "syn_role": cnt("syn_role"), "syn_subcat": cnt("syn_subcat"),
        "domain_x_group": {d: dict(v) for d, v in by_domain.items()},
        "words_median": int(np.median([x["words"] for x in recs])),
        "craft_pc_mean": float(np.mean([x["craft"] for x in recs])), "craft_syn_mean": float(np.mean(syn_craft)),
        "craft_pc_hist": C.Counter(x["craft"] // 10 * 10 for x in recs), "craft_syn_hist": C.Counter(c // 10 * 10 for c in syn_craft),
        "crit_pc": {k: sum(x["crit"][k] for x in recs) / len(recs) for k in recs[0]["crit"]},
        "crit_syn": {k: v / len(syn) for k, v in syn_crit.items()},
        "dup_score_hist": C.Counter(round(min(x["dup_score"], 0.99) // 0.1 * 0.1, 1) for x in recs),
        "group_A_by_cat": C.Counter(x["syn_cat"] or "UNMAPPED" for x in recs if x["group"] == "A"),
        "group_A_by_mt": C.Counter(x["match_type"] for x in recs if x["group"] == "A"),
        "group_B_by_cat": C.Counter(x["syn_cat"] or "UNMAPPED" for x in recs if x["group"] == "B"),
        "group_B_targets": C.Counter(x["near_id"] + " | " + x["near_title"] for x in recs if x["group"] == "B"),
        "group_C_reasons": C.Counter(x["reason"].split(":")[0].split("(")[0].strip()[:70] for x in recs if x["group"] == "C"),
        "top_A": sorted([{"id": f"pc-{x['i']:04d}", "title": x["title"], "cat": x["syn_cat"], "mt": x["match_type"], "craft": x["craft"],
                          "dup": round(x["dup_score"], 2), "domain": x["domain"], "role": x["syn_role"], "task": x["syn_task"], "sub": x["syn_subcat"]}
                         for x in recs if x["group"] == "A"], key=lambda r: -r["craft"]),
        "top_B": sorted([{"id": f"pc-{x['i']:04d}", "title": x["title"], "near": x["near_id"] + " | " + x["near_title"], "mt": x["match_type"],
                          "craft": x["craft"], "near_craft": x["near_craft"], "dup": round(x["dup_score"], 2)}
                         for x in recs if x["group"] == "B"], key=lambda r: -(r["craft"] - r["near_craft"])),
        "themes": C.Counter(x["theme"] for x in recs).most_common(90),
        "theme_groups": {t: dict(C.Counter(x["group"] for x in recs if x["theme"] == t)) for t, _ in C.Counter(x["theme"] for x in recs).most_common(90)},
        "unmapped_task": sum(1 for x in recs if x["syn_task"].startswith("UNMAPPED")),
        "unmapped_task_A": sum(1 for x in recs if x["group"] == "A" and x["syn_task"].startswith("UNMAPPED")),
        "subcat_A": C.Counter(x["syn_subcat"] for x in recs if x["group"] == "A"),
        "domain_A": C.Counter(x["domain"] for x in recs if x["group"] == "A"),
        "role_A": C.Counter(x["syn_role"] for x in recs if x["group"] == "A"),
        "task_A": C.Counter(x["syn_task"] for x in recs if x["group"] == "A"),
    }
    json.dump(stats, open(a.stats, "w"), indent=1, default=str)
    print(json.dumps({k: stats[k] for k in ("pc_rows", "english", "unsafe", "tool_dependent", "dup_clusters", "dup_members",
                                            "domain", "match_type", "action", "group", "craft_pc_mean", "craft_syn_mean")}, indent=1, default=str))


if __name__ == "__main__":
    main()
