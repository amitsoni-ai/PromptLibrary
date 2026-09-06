#!/usr/bin/env python3
"""
Generates part_orgmodel.json (3 orgs + demo tenants + the full Synottic
curriculum as programs) and part_curriculum.json (one flagship "course
companion" prompt per course), from the course catalogue below.

Source: Synottic AI Institute course outlines, OneDrive
  .../SYNOTTIC/4_PROGRAMS/Synottic_Web_Resources(Do-not-touch)/AI Course Curriculum/
Run:  python3 curriculum.py   (then build.py)
"""
import json, os, re

HERE = os.path.dirname(os.path.abspath(__file__))

# ---- fixed content --------------------------------------------------------
ORGS = [
    {"id": "org-synottic", "name": "Synottic AI Institute", "shortName": "Synottic"},
    {"id": "org-acme", "name": "Acme Corporation", "shortName": "Acme"},
    {"id": "org-northwind", "name": "Northwind Institute", "shortName": "Northwind"},
]

DEMO_PROGRAMS = [
    {
        "id": "prog-acme-sales", "orgId": "org-acme", "name": "AI-Assisted Sales Enablement",
        "track": "Client program",
        "description": "Prospecting, discovery, objection handling and follow-up with AI in the loop.",
        "scope": "program",
        "skillFocus": ["Sales & Lead Generation", "Email Marketing", "Communication & Leadership"],
        "categories": ["Sales & Lead Generation", "Email Marketing", "Customer Support", "Communication & Leadership", "Marketing & Branding"],
        "modules": [
            {"id": "m-as-1", "name": "Prospecting & Outreach", "summary": "Research accounts and write first-touch outreach.", "rules": {"categories": ["Sales & Lead Generation"], "keywords": ["prospect", "outreach", "cold", "lead", "research"], "limit": 12}},
            {"id": "m-as-2", "name": "Discovery & Qualification", "summary": "Question banks and qualification frameworks.", "rules": {"categories": ["Sales & Lead Generation", "Communication & Leadership"], "keywords": ["discovery", "qualif", "question", "need", "pain"], "limit": 10}},
            {"id": "m-as-3", "name": "Objections & Negotiation", "summary": "Handle pushback and hold value in negotiation.", "rules": {"categories": ["Sales & Lead Generation", "Communication & Leadership"], "keywords": ["objection", "negotiat", "pricing", "discount", "close"], "limit": 10}},
            {"id": "m-as-4", "name": "Follow-up & Nurture", "summary": "Follow-up sequences and re-engagement emails.", "rules": {"categories": ["Email Marketing", "Sales & Lead Generation"], "keywords": ["follow-up", "follow up", "nurture", "sequence", "re-engage"], "limit": 10}},
        ],
    },
    {
        "id": "prog-northwind-writing", "orgId": "org-northwind", "name": "Professional Writing with AI",
        "track": "Client program",
        "description": "Content, copy and long-form writing craft, using AI as a drafting partner.",
        "scope": "program",
        "skillFocus": ["Content Writing & Copywriting", "Book & Ebook Writing", "SEO & Analytics"],
        "categories": ["Content Writing & Copywriting", "Book & Ebook Writing", "SEO & Analytics", "Social Media", "Email Marketing"],
        "modules": [
            {"id": "m-nw-1", "name": "Copywriting Fundamentals", "summary": "Headlines, hooks and short-form copy.", "rules": {"categories": ["Content Writing & Copywriting"], "keywords": ["headline", "copy", "hook", "cta", "landing"], "limit": 12}},
            {"id": "m-nw-2", "name": "Long-form & Structure", "summary": "Outlines, drafts and editing at length.", "rules": {"categories": ["Book & Ebook Writing", "Content Writing & Copywriting"], "keywords": ["outline", "chapter", "draft", "article", "structure"], "limit": 12}},
            {"id": "m-nw-3", "name": "SEO & Distribution", "summary": "Search-aware writing and repurposing.", "rules": {"categories": ["SEO & Analytics", "Social Media"], "keywords": ["seo", "keyword", "repurpose", "meta", "rank"], "limit": 10}},
        ],
    },
]

# ---- Synottic course catalogue -----------------------------------------------
# track -> list of courses. Each course:
#   name, slug, cat (primary library category), desc,
#   specs: [(module name, keyword string)]  (function courses use 3),
#   roles: [role, ...]  (empty -> inherit track default roles)
GENERIC_ROLES = ["Individual Contributor", "People Manager", "Team Lead", "Executive Assistant", "Consultant"]

CATALOGUE = {
    "AI for Functions": {
        "default_modules": "function",
        "courses": [
            {"name": "AI for Sales", "slug": "sales", "cat": "Sales & Lead Generation",
             "desc": "Apply AI across the full sales lifecycle — prospecting, engagement, proposals, CRM intelligence and forecasting.",
             "specs": [("Prospecting & Lead Generation", "prospect lead outreach research account"),
                       ("Customer Engagement & Conversations", "discovery objection negotiat meeting follow-up"),
                       ("Proposal Development & Enablement", "proposal pitch business case roi presentation")],
             "roles": ["Chief Sales Officer", "Sales Director", "Sales Manager", "Business Development Manager", "Account Manager", "Key Account Manager", "Sales Executive", "Inside Sales", "Enterprise Sales", "Customer Success Manager", "Pre-Sales Consultant", "Sales Operations", "Revenue Operations (RevOps)"]},
            {"name": "AI for Marketing", "slug": "marketing", "cat": "Marketing & Branding",
             "desc": "Use AI for campaign creation, brand and positioning, SEO and organic growth, and marketing analytics.",
             "specs": [("Content & Campaign Creation", "campaign content copy ad headline social"),
                       ("Brand, Positioning & Messaging", "brand positioning messaging voice tagline"),
                       ("SEO & Marketing Analytics", "seo keyword analytics attribution report")],
             "roles": ["CMO", "Marketing Director", "Brand Manager", "Content Marketer", "Growth Marketer", "SEO Specialist", "Social Media Manager", "Lifecycle / Email Marketer", "Marketing Operations", "Product Marketer", "PR & Communications"]},
            {"name": "AI for HR", "slug": "hr", "cat": "HR & Recruiting",
             "desc": "Bring AI to recruitment, workforce planning, employee experience and HR analytics — responsibly.",
             "specs": [("Talent Acquisition & Recruitment", "recruit hiring job description resume interview candidate"),
                       ("Skills Intelligence & Workforce Planning", "skills workforce planning succession competency"),
                       ("Employee Experience & HR Analytics", "engagement sentiment attrition survey dashboard")],
             "roles": ["HR Director", "HR Manager", "Talent Acquisition Specialist", "Recruiter", "L&D Team", "HR Business Partner", "Talent Management", "Employee Experience Team", "Organisational Development", "People Analytics Specialist", "HR Operations"]},
            {"name": "AI for L&D", "slug": "ld", "cat": "Education & Learning",
             "desc": "Design personalised learning, AI coaching, competency frameworks and learning analytics.",
             "specs": [("Learning Design & Content", "curriculum module lesson learning design content"),
                       ("Personalised Pathways & Coaching", "personalis pathway coaching mentor development plan"),
                       ("Learning Analytics & ROI", "learning analytics assessment roi outcome")],
             "roles": ["L&D Director", "L&D Manager", "Instructional Designer", "Learning Experience Designer", "Corporate Trainer", "Facilitator", "Capability Building Lead", "Talent Development Partner"]},
            {"name": "AI for Finance & Accounting", "slug": "finance", "cat": "Finance & Accounting",
             "desc": "Apply AI to FP&A, reporting and close, forecasting and scenario modelling, and controls.",
             "specs": [("Financial Planning & Analysis", "budget forecast variance fp&a analysis plan"),
                       ("Reporting & Month-end Close", "report close reconciliation statement ledger"),
                       ("Forecasting & Scenario Modelling", "forecast scenario model projection sensitivity")],
             "roles": ["CFO", "Finance Director", "Financial Controller", "FP&A Analyst", "Accountant", "Management Accountant", "Treasury", "Finance Business Partner", "Audit & Assurance"]},
            {"name": "AI for Legal & Compliance", "slug": "legal", "cat": "Legal & Compliance",
             "desc": "Contract drafting and review, legal research and memos, compliance, policy, and AI risk governance.",
             "specs": [("Contract Drafting & Review", "contract clause draft review redline nda agreement"),
                       ("Legal Research & Memos", "research memo case statute precedent brief"),
                       ("Compliance, Policy & Risk", "compliance policy risk regulation governance audit")],
             "roles": ["General Counsel", "Legal Counsel", "Contracts Manager", "Compliance Officer", "Privacy / DPO", "Company Secretary", "Paralegal", "Regulatory Affairs"]},
            {"name": "AI for IT & Engineering", "slug": "it-eng", "cat": "Coding & Tech",
             "desc": "AI for code and development, system design, DevOps and automation, and technical documentation.",
             "specs": [("Code & Development", "code debug refactor test function api"),
                       ("System Design & Architecture", "architecture design system diagram scalability"),
                       ("DevOps, Docs & Support", "devops pipeline automation documentation runbook incident")],
             "roles": ["CTO", "Engineering Manager", "Software Engineer", "DevOps / SRE", "QA Engineer", "Solutions Architect", "IT Support Lead", "Platform Engineer", "Security Engineer"]},
            {"name": "AI for Product Management", "slug": "product", "cat": "Product Management",
             "desc": "Discovery and research, specs and requirements, roadmap and prioritisation, product analytics.",
             "specs": [("Discovery & Research", "discovery research interview user insight problem"),
                       ("Specs & Requirements", "requirement spec user story prd acceptance feature"),
                       ("Roadmap, Prioritisation & Analytics", "roadmap prioriti backlog okr metric experiment")],
             "roles": ["Head of Product", "Product Manager", "Product Owner", "Technical Product Manager", "Product Marketing Manager", "UX Researcher", "Product Designer", "Product Operations"]},
            {"name": "AI for Project & Program Management", "slug": "ppm", "cat": "Business Strategy",
             "desc": "Planning and estimation, risk and dependency management, status reporting, and delivery retrospectives.",
             "specs": [("Planning & Estimation", "plan estimate schedule milestone scope charter"),
                       ("Risk & Dependency Management", "risk dependency issue mitigation raid blocker"),
                       ("Status Reporting & Retrospectives", "status report stakeholder update retrospective lesson")],
             "roles": ["Programme Director", "Project Manager", "Programme Manager", "Scrum Master", "Delivery Lead", "PMO Analyst", "Portfolio Manager", "Agile Coach"]},
            {"name": "AI for Customer Service", "slug": "customer-service", "cat": "Customer Support",
             "desc": "Response drafting and macros, knowledge base and self-service, escalation handling, and support QA.",
             "specs": [("Response Drafting & Macros", "reply macro template response tone apology"),
                       ("Knowledge Base & Self-Service", "knowledge base article faq self-service how-to"),
                       ("Escalation, Complaints & QA", "escalation complaint refund quality assurance sentiment")],
             "roles": ["Head of Customer Support", "Support Team Lead", "Support Agent", "CX Manager", "Knowledge Base Manager", "Quality Analyst", "Community Manager"]},
            {"name": "AI for Data & Business Analysts", "slug": "data-analyst", "cat": "Research & Data Analysis",
             "desc": "Data exploration and cleaning, analysis and insight, dashboards and reporting, and data storytelling.",
             "specs": [("Data Exploration & Analysis", "data analysis explore clean sql query trend"),
                       ("Dashboards & Reporting", "dashboard report kpi visualis metric"),
                       ("Insight & Storytelling", "insight story recommendation narrative summary")],
             "roles": ["Head of Analytics", "Data Analyst", "Business Analyst", "BI Analyst", "Data Scientist", "Insights Manager", "Reporting Analyst"]},
            {"name": "AI for Operations & Supply Chain", "slug": "operations", "cat": "Productivity & Automation",
             "desc": "Process documentation and SOPs, demand and inventory planning, workflow automation, and ops analytics.",
             "specs": [("Process Docs & SOPs", "process sop procedure workflow document standardis"),
                       ("Planning & Automation", "demand inventory planning automation forecast schedule"),
                       ("Operations Analytics", "operations analytics metric efficiency bottleneck report")],
             "roles": ["COO", "Operations Director", "Operations Manager", "Supply Chain Manager", "Logistics Manager", "Process Improvement Lead", "S&OP Planner", "Warehouse Manager"]},
            {"name": "AI for Procurement", "slug": "procurement", "cat": "Finance & Accounting",
             "desc": "Sourcing and supplier research, RFx and tender documents, contract and negotiation support, spend analysis.",
             "specs": [("Sourcing & Supplier Research", "supplier sourcing vendor market research shortlist"),
                       ("RFx & Contracts", "rfp rfq tender contract negotiat sow terms"),
                       ("Spend Analysis & Compliance", "spend analysis savings compliance category")],
             "roles": ["CPO", "Procurement Director", "Procurement Manager", "Category Manager", "Buyer", "Sourcing Specialist", "Vendor Manager", "Contracts & Compliance Analyst"]},
        ],
    },
    "AI for Leaders": {
        "default_modules": "leader",
        "courses": [
            {"name": "AI for Business Leaders", "slug": "business-leaders", "cat": "Business Strategy",
             "desc": "How to set AI direction, spot high-value use cases, and lead responsible adoption across a business.",
             "roles": ["Founder / CEO", "Managing Director", "Business Unit Head", "VP / Director", "General Manager", "Board Member"]},
            {"name": "AI for Executives Mastery Program", "slug": "executives-mastery", "cat": "Business Strategy",
             "desc": "An executive intensive: AI strategy, portfolio bets, operating model and governance for the C-suite.",
             "roles": ["CEO", "COO", "CFO", "CHRO", "CIO / CTO", "Chief Strategy Officer", "Chief of Staff"]},
            {"name": "AI for Leaders", "slug": "leaders", "cat": "Communication & Leadership",
             "desc": "Practical AI fluency for leaders — decisions, communication, team enablement and change.",
             "roles": ["Senior Manager", "Head of Department", "Director", "Team Lead", "Chief of Staff"]},
            {"name": "AI for People Managers", "slug": "people-managers", "cat": "Communication & Leadership",
             "desc": "AI for the manager's job: 1:1s, feedback, hiring, planning, and coaching a team through AI adoption.",
             "roles": ["People Manager", "First-line Manager", "Team Lead", "Engineering Manager", "Sales Manager", "Support Team Lead"]},
        ],
    },
    "AI at Work": {
        "default_modules": "generic",
        "courses": [
            {"name": "Advanced Prompt and Context Engineering", "slug": "advanced-prompt-context", "cat": "AI & Prompt Engineering",
             "desc": "Structured prompting, context engineering, evaluation and reusable prompt systems.", "roles": []},
            {"name": "AI for Data Analysis and Decision Support", "slug": "data-analysis-decision", "cat": "Research & Data Analysis",
             "desc": "Use AI to explore data, run analysis, and build decision-support recommendations.", "roles": []},
            {"name": "AI Productivity at Work", "slug": "productivity-at-work", "cat": "Productivity & Automation",
             "desc": "Redesign daily work with AI — email, docs, meetings, research and personal workflows.", "roles": []},
            {"name": "AI Research and Deep Research", "slug": "deep-research", "cat": "Research & Data Analysis",
             "desc": "Run rigorous AI-assisted research: sourcing, synthesis, verification and briefing.", "roles": []},
            {"name": "Generative AI Tools Mastery", "slug": "genai-tools-mastery", "cat": "AI & Prompt Engineering",
             "desc": "Get fluent across the major AI assistants and pick the right tool for each job.", "roles": []},
            {"name": "Prompt Engineering Mastery Program", "slug": "prompt-engineering-mastery", "cat": "AI & Prompt Engineering",
             "desc": "From first prompts to advanced techniques, context engineering and prompt libraries.", "roles": []},
        ],
    },
    "AI Essentials": {
        "default_modules": "generic",
        "courses": [
            {"name": "AI Literacy Essentials", "slug": "ai-literacy-essentials", "cat": "AI & Prompt Engineering",
             "desc": "What AI is, what it can and can't do, and how to use it safely and well at work.", "roles": []},
            {"name": "Advance AI Literacy", "slug": "advance-ai-literacy", "cat": "AI & Prompt Engineering",
             "desc": "Deeper AI literacy: how models work, their limits, evaluation and responsible use.", "roles": []},
            {"name": "Generative AI Essentials", "slug": "genai-essentials", "cat": "AI & Prompt Engineering",
             "desc": "Hands-on foundations of generative AI for everyday professional tasks.", "roles": []},
            {"name": "AI Security and Responsible Use", "slug": "ai-security-responsible-use", "cat": "Legal & Compliance",
             "desc": "Data protection, confidentiality, prompt hygiene and safe AI use for every employee.", "roles": []},
        ],
    },
    "AI Tools": {
        "default_modules": "tool",
        "courses": [
            {"name": "ChatGPT Mastery Course", "slug": "chatgpt-mastery", "cat": "AI & Prompt Engineering", "desc": "Master ChatGPT for professional productivity, analysis, writing and workflows.", "roles": []},
            {"name": "Claude AI Mastery", "slug": "claude-mastery", "cat": "AI & Prompt Engineering", "desc": "Master Claude for enterprise productivity, context engineering, long documents and agentic work.", "roles": []},
            {"name": "Gemini Mastery Course", "slug": "gemini-mastery", "cat": "AI & Prompt Engineering", "desc": "Master Google Gemini for content, research, data and Workspace productivity.", "roles": []},
            {"name": "Copilot Mastery Course", "slug": "copilot-mastery", "cat": "Productivity & Automation", "desc": "Master Microsoft 365 Copilot across Outlook, Word, Excel, PowerPoint and Teams.", "roles": []},
            {"name": "Perplexity Mastery Course", "slug": "perplexity-mastery", "cat": "Research & Data Analysis", "desc": "Master Perplexity for sourced research, comparisons and up-to-date answers.", "roles": []},
            {"name": "NotebookLM Mastery", "slug": "notebooklm-mastery", "cat": "Research & Data Analysis", "desc": "Master NotebookLM to turn your own documents into briefings, summaries and Q&A.", "roles": []},
            {"name": "Grok Mastery Course", "slug": "grok-mastery", "cat": "AI & Prompt Engineering", "desc": "Master Grok for real-time information, analysis and content.", "roles": []},
            {"name": "DeepSeek Mastery", "slug": "deepseek-mastery", "cat": "AI & Prompt Engineering", "desc": "Master DeepSeek for reasoning, coding and cost-efficient AI workflows.", "roles": []},
            {"name": "AI Productivity Stack", "slug": "ai-productivity-stack", "cat": "Productivity & Automation", "desc": "Assemble a personal AI tool stack and connect it into repeatable workflows.", "roles": []},
        ],
    },
    "Responsible AI & Governance": {
        "default_modules": "governance",
        "courses": [
            {"name": "Responsible AI Essentials", "slug": "responsible-ai-essentials", "cat": "Legal & Compliance", "desc": "Core principles of fairness, transparency, privacy and human oversight for everyone using AI.", "roles": []},
            {"name": "AI Risk & Governance for Leaders", "slug": "ai-risk-governance-leaders", "cat": "Legal & Compliance", "desc": "Set risk appetite, controls and governance for AI at the leadership level.",
             "roles": ["Executive Sponsor", "Risk Officer", "General Counsel", "CISO", "Head of Compliance", "Board Member"]},
            {"name": "AI Governance Practitioner", "slug": "ai-governance-practitioner", "cat": "Legal & Compliance", "desc": "Operate an AI governance program: policy, model inventory, assessments and audits.",
             "roles": ["AI Governance Lead", "Compliance Manager", "Risk Analyst", "Privacy Officer", "Model Risk Manager", "Internal Audit"]},
            {"name": "Enterprise AI Governance Academy", "slug": "enterprise-ai-governance", "cat": "Legal & Compliance", "desc": "Stand up an enterprise-wide governance operating model aligned to NIST AI RMF and ISO/IEC 42001.",
             "roles": ["Chief AI Officer", "Head of AI Governance", "Enterprise Risk", "Legal & Compliance", "Security", "Data Protection"]},
        ],
    },
    "Agentic AI": {
        "default_modules": "agentic",
        "courses": [
            {"name": "AI Agents Essentials", "slug": "ai-agents-essentials", "cat": "AI & Prompt Engineering", "desc": "What AI agents are, where they help, and how to brief and supervise them safely.", "roles": []},
            {"name": "AI Agent Builder", "slug": "ai-agent-builder", "cat": "Coding & Tech", "desc": "Design, build and evaluate task agents with tools, memory and guardrails.",
             "roles": ["Software Engineer", "AI Engineer", "Automation Specialist", "Solutions Architect", "Product Manager"]},
            {"name": "Advanced Agentic AI", "slug": "advanced-agentic-ai", "cat": "AI & Prompt Engineering", "desc": "Multi-agent systems, planning, tool orchestration and evaluation at depth.", "roles": []},
            {"name": "Enterprise Agentic AI", "slug": "enterprise-agentic-ai", "cat": "Business Strategy", "desc": "Adopt agentic AI across an enterprise: use-case selection, operating model, risk and ROI.",
             "roles": ["Transformation Lead", "Enterprise Architect", "Operations Director", "Head of Automation", "Risk & Governance"]},
        ],
    },
}

TRACK_CATS = {
    "AI for Leaders": ["Business Strategy", "Communication & Leadership", "AI & Prompt Engineering", "Productivity & Automation"],
    "AI at Work": ["AI & Prompt Engineering", "Productivity & Automation", "Research & Data Analysis", "Content Writing & Copywriting"],
    "AI Essentials": ["AI & Prompt Engineering", "Productivity & Automation", "General"],
    "AI Tools": ["AI & Prompt Engineering", "Productivity & Automation", "Research & Data Analysis", "Content Writing & Copywriting"],
    "Responsible AI & Governance": ["Legal & Compliance", "Business Strategy", "AI & Prompt Engineering"],
    "Agentic AI": ["AI & Prompt Engineering", "Productivity & Automation", "Coding & Tech", "Business Strategy"],
}

RAI_MODULE = {"id": "", "name": "Responsible AI & Governance", "summary": "Bias, privacy, confidentiality and human-oversight checks you never skip.",
              "rules": {"categories": ["Legal & Compliance", "AI & Prompt Engineering"], "keywords": ["responsible", "ethic", "privacy", "bias", "governance", "compliance"], "limit": 8}}


def kw(*words):
    return list(dict.fromkeys([w for w in words if w]))


def function_modules(c):
    cat = c["cat"]
    mods = [
        {"id": "", "name": "Prompt & Context Engineering", "summary": "Structured prompts and context for reliable, role-specific output.",
         "rules": {"categories": ["AI & Prompt Engineering"], "keywords": [], "limit": 10}},
        dict(RAI_MODULE),
        {"id": "", "name": c["name"].replace("AI for ", "") + " Productivity", "summary": "Automate the repetitive parts of the job — docs, comms, summaries.",
         "rules": {"categories": [cat, "Productivity & Automation"], "keywords": ["automat", "template", "summary", "document", "report"], "limit": 10}},
    ]
    for name, kws in c["specs"]:
        mods.append({"id": "", "name": name, "summary": "Applied AI workflows for " + name.lower() + ".",
                     "rules": {"categories": [cat], "keywords": kws.split(), "limit": 12}})
    return mods


def generic_modules(c, track):
    cats = TRACK_CATS.get(track, [c["cat"]])
    slugwords = [w for w in re.split(r"[^a-z0-9]+", c["slug"]) if len(w) > 2]
    return [
        {"id": "", "name": "Foundations", "summary": "Core concepts and where this helps most.",
         "rules": {"categories": [c["cat"], "AI & Prompt Engineering"], "keywords": [], "difficulty": "Beginner", "limit": 10}},
        {"id": "", "name": "Prompting & Context", "summary": "How to ask well and supply the right context.",
         "rules": {"categories": ["AI & Prompt Engineering"], "keywords": [], "limit": 10}},
        dict(RAI_MODULE),
        {"id": "", "name": "Core Workflows", "summary": "The everyday tasks this course speeds up.",
         "rules": {"categories": cats, "keywords": slugwords, "limit": 14}},
        {"id": "", "name": "Advanced & Applied", "summary": "Deeper techniques and a capstone application.",
         "rules": {"categories": cats, "keywords": kw("advanced", "workflow", "framework", *slugwords), "limit": 12}},
    ]


ADMIN_KEY = "SYNOTTIC-ADMIN"

# One memorable access code per course. Pattern: SYNOTTIC-<TOPIC>.
COURSE_CODE = {
    # AI for Functions
    "sales": "SYNOTTIC-SALES", "marketing": "SYNOTTIC-MARKETING", "hr": "SYNOTTIC-HR",
    "ld": "SYNOTTIC-LD", "finance": "SYNOTTIC-FINANCE", "legal": "SYNOTTIC-LEGAL",
    "it-eng": "SYNOTTIC-IT", "product": "SYNOTTIC-PRODUCT", "ppm": "SYNOTTIC-PROJECTS",
    "customer-service": "SYNOTTIC-SUPPORT", "data-analyst": "SYNOTTIC-DATA",
    "operations": "SYNOTTIC-OPS", "procurement": "SYNOTTIC-PROCUREMENT",
    # AI for Leaders
    "business-leaders": "SYNOTTIC-BIZLEADERS", "executives-mastery": "SYNOTTIC-EXECUTIVES",
    "leaders": "SYNOTTIC-LEADER", "people-managers": "SYNOTTIC-MANAGERS",
    # AI at Work
    "advanced-prompt-context": "SYNOTTIC-CONTEXT", "data-analysis-decision": "SYNOTTIC-DECISIONS",
    "productivity-at-work": "SYNOTTIC-PRODUCTIVITY", "deep-research": "SYNOTTIC-RESEARCH",
    "genai-tools-mastery": "SYNOTTIC-GENAI-TOOLS", "prompt-engineering-mastery": "SYNOTTIC-PROMPTING",
    # AI Essentials
    "ai-literacy-essentials": "SYNOTTIC-LITERACY", "advance-ai-literacy": "SYNOTTIC-LITERACY-ADV",
    "genai-essentials": "SYNOTTIC-GENAI", "ai-security-responsible-use": "SYNOTTIC-SECURITY",
    # AI Tools
    "chatgpt-mastery": "SYNOTTIC-CHATGPT", "claude-mastery": "SYNOTTIC-CLAUDE",
    "gemini-mastery": "SYNOTTIC-GEMINI", "copilot-mastery": "SYNOTTIC-COPILOT",
    "perplexity-mastery": "SYNOTTIC-PERPLEXITY", "notebooklm-mastery": "SYNOTTIC-NOTEBOOKLM",
    "grok-mastery": "SYNOTTIC-GROK", "deepseek-mastery": "SYNOTTIC-DEEPSEEK",
    "ai-productivity-stack": "SYNOTTIC-STACK",
    # Responsible AI & Governance
    "responsible-ai-essentials": "SYNOTTIC-RESPONSIBLE", "ai-risk-governance-leaders": "SYNOTTIC-RISK",
    "ai-governance-practitioner": "SYNOTTIC-GOV-PRACTITIONER", "enterprise-ai-governance": "SYNOTTIC-GOV-ENTERPRISE",
    # Agentic AI
    "ai-agents-essentials": "SYNOTTIC-AGENTS", "ai-agent-builder": "SYNOTTIC-AGENT-BUILDER",
    "advanced-agentic-ai": "SYNOTTIC-AGENTIC-ADV", "enterprise-agentic-ai": "SYNOTTIC-AGENTIC-ENT",
}
TRACK_CODE = {
    "AI for Functions": "SYNOTTIC-FUNCTIONS", "AI for Leaders": "SYNOTTIC-LEADERS",
    "AI at Work": "SYNOTTIC-WORK", "AI Essentials": "SYNOTTIC-ESSENTIALS",
    "AI Tools": "SYNOTTIC-TOOLS", "Responsible AI & Governance": "SYNOTTIC-GOVERNANCE",
    "Agentic AI": "SYNOTTIC-AGENTIC",
}
# The 13 "AI for Functions" course slugs -> admin-console function name.
SLUG_FUNCTION = {
    "sales": "Sales", "marketing": "Marketing", "hr": "HR", "ld": "L&D",
    "finance": "Finance & Accounting", "legal": "Legal & Compliance",
    "it-eng": "IT & Engineering", "product": "Product Management",
    "ppm": "Project & Program Management", "customer-service": "Customer Service",
    "data-analyst": "Data & Business Analysis", "operations": "Operations & Supply Chain",
    "procurement": "Procurement",
}

TRACK_ORDER = ["AI Essentials", "AI at Work", "AI Tools", "AI for Leaders", "AI for Functions", "Responsible AI & Governance", "Agentic AI"]
TRACK_SKILL = {
    "AI for Functions": "Applied AI by function",
    "AI for Leaders": "AI leadership",
    "AI at Work": "AI productivity",
    "AI Essentials": "AI literacy",
    "AI Tools": "AI tools",
    "Responsible AI & Governance": "AI governance",
    "Agentic AI": "Agentic AI",
}


def build_programs():
    progs = []
    for track in TRACK_ORDER:
        blk = CATALOGUE[track]
        for c in blk["courses"]:
            pid = "prog-syn-" + c["slug"]
            mods = function_modules(c) if blk["default_modules"] == "function" else generic_modules(c, track)
            for i, m in enumerate(mods, 1):
                m["id"] = pid.replace("prog-", "m-") + "-" + str(i)
            roles = c.get("roles") or GENERIC_ROLES
            cats = sorted(set([c["cat"]] + [x for mm in mods for x in mm["rules"]["categories"]]))
            progs.append({
                "id": pid, "orgId": "org-synottic", "name": c["name"], "track": track,
                "description": c["desc"], "scope": "program",
                "accessCode": COURSE_CODE.get(c["slug"]),
                "skillFocus": [TRACK_SKILL[track], c["cat"]],
                "audienceRoles": roles,
                "categories": cats,
                "modules": mods,
            })
    return progs


def track_program_ids(track):
    return ["prog-syn-" + c["slug"] for c in CATALOGUE[track]["courses"]]


FLAGSHIP_TEMPLATE = """Role: Act as a senior {rolehint} and AI enablement coach trained in Synottic's Learn -> Demonstrate -> Practice -> Apply method.

Objective: Help me apply AI to {focus} for my organisation.

Context I will provide:
- My role: [ROLE]
- Team / organisation: [ORGANISATION] in the [INDUSTRY] industry
- The task or decision in front of me: [TASK]
- Constraints (tools available, data I can use, policy, tone): [CONSTRAINTS]

What to do:
1. Restate, in one line, the business outcome this task should move.
2. Give me a step-by-step, AI-assisted workflow to get it done, organised around these stages: {stages}.
3. For each step, give the exact prompt I should run next, with [placeholders] for my inputs.
4. Call out the Responsible-AI checks I must not skip for this task (confidentiality, personal data, bias, and where a human must review before anything goes out).
5. Finish with two concrete ways I can measure whether it worked.

Output format: a numbered workflow. For each step show: goal | prompt to run | what to watch out for. Keep it specific enough to use today."""


def flagship_prompt(course, track):
    cat = course["cat"]
    if course.get("specs"):
        stages = ", ".join(s[0] for s in course["specs"])
        rolehint = course["name"].replace("AI for ", "").strip() + " practitioner"
    else:
        stages = "understand the goal, draft with AI, pressure-test the output, and finalise for use"
        rolehint = {"AI for Leaders": "business leader", "AI Tools": "AI power user",
                    "Responsible AI & Governance": "AI governance practitioner",
                    "Agentic AI": "AI automation architect"}.get(track, "AI practitioner")
    focus = course["name"].replace("AI for ", "").replace(" Course", "").replace(" Mastery Program", "").replace(" Mastery", "").strip().lower()
    text = FLAGSHIP_TEMPLATE.format(rolehint=rolehint, focus=focus, stages=stages)
    roles = course.get("roles") or GENERIC_ROLES
    return {
        "id": "crs-" + course["slug"],
        "sourceNumber": None,
        "title": course["name"] + " — Course Companion Prompt",
        "originalTitle": course["name"] + " — Course Companion Prompt",
        "category": cat,
        "description": "A reusable prompt for learners on the " + course["name"] + " program: turns any task in scope into an AI-assisted, governed workflow with the exact prompts to run.",
        "useCase": "Use on the " + course["name"] + " program whenever you have a real task and want a step-by-step AI workflow, the prompts to run, and the Responsible-AI checks for it.",
        "originalPrompt": text,
        "promptType": "Workflow",
        "role": roles[0],
        "outcome": "A step-by-step AI-assisted workflow with ready-to-run prompts and Responsible-AI checks",
        "aiTool": "General AI",
        "variables": ["ROLE", "ORGANISATION", "INDUSTRY", "TASK", "CONSTRAINTS"],
        "variablesRaw": ["[ROLE]", "[ORGANISATION]", "[INDUSTRY]", "[TASK]", "[CONSTRAINTS]"],
        "isTemplate": True,
        "tags": kw("Synottic", "curriculum", track.replace("AI for ", "").replace(" & Governance", ""), *[w for w in re.split(r"[^A-Za-z]+", course["name"]) if len(w) > 3][:3]),
        "qualityScore": 92,
        "qualityBreakdown": {"clarity": 92, "context": 88, "specificity": 84, "outputDefinition": 95, "reusability": 96},
        "strengths": ["Explicit role and method", "Asks for real context via placeholders", "Defines the output shape precisely", "Builds in Responsible-AI checks"],
        "improvements": [],
        "flags": {"modelSpecific": False, "containsWebSearch": False, "containsInteractiveQuestioning": False, "embeddedMetadata": False, "incompleteTitle": False, "hasOutputCue": True},
        "source": "Synottic Curriculum",
        "programId": "prog-syn-" + course["slug"],
        "track": track,
        "version": "1.0",
        "sensitiveCategory": cat in ("Legal & Compliance", "Finance & Accounting", "Health & Fitness"),
        "duplicateGroup": None,
        "healthStatus": "Excellent",
        "healthReasons": [],
        "difficulty": "Intermediate",
        "skill": None,
        "lifecycle": "Recommended",
    }


ALL_CATEGORIES = [
    "AI & Prompt Engineering", "Book & Ebook Writing", "Business Strategy", "Career Growth",
    "Coaching & Self-Development", "Coding & Tech", "Communication & Leadership",
    "Content Writing & Copywriting", "Customer Support", "E-Commerce", "Education & Learning",
    "Email Marketing", "Finance & Accounting", "General", "HR & Recruiting", "Health & Fitness",
    "Image & Design", "Legal & Compliance", "Marketing & Branding", "Presentation & Slides",
    "Product Management", "Productivity & Automation", "Research & Data Analysis", "SEO & Analytics",
    "Sales & Lead Generation", "Social Media", "Spirituality & Wellness", "UX/UI Design",
]

FULL_PROGRAM = {
    "id": "prog-full", "orgId": "org-synottic", "name": "Full Library", "track": "All access",
    "description": "Full access to every category, function, program and the whole prompt library — the global / all-roles view.",
    "scope": "full", "accessCode": "SYNOTTIC-ALL",
    "skillFocus": ["All access"], "audienceRoles": ["All roles"],
    "categories": ALL_CATEGORIES,
    "modules": [
        {"id": "m-full-1", "name": "Everything, ranked by quality", "summary": "The strongest prompts across all 28 categories.",
         "rules": {"categories": [], "keywords": [], "limit": 20}},
        {"id": "m-full-2", "name": "Reusable templates", "summary": "Prompts with variables you can run again and again.",
         "rules": {"categories": [], "keywords": ["template"], "limit": 16}},
    ],
}


def main():
    progs = build_programs()
    org_model = {
        "_note": "Multi-tenant model. Access codes resolve Organization -> Program -> Cohort -> Learner. Module prompt lists resolve at load from rules (category+keyword) against the central library — no central prompt is duplicated per learner. prog-syn-* programs (scope 'program') scope a learner to that course's categories; prog-full (scope 'full') is the global / all-roles view. The admin console maps org codes to any subset by domain / industry / function / role.",
        "organizations": ORGS,
        "programs": DEMO_PROGRAMS + [FULL_PROGRAM] + progs,
        "cohorts": [
            {"id": "coh-acme-emea", "programId": "prog-acme-sales", "name": "EMEA Sales · 2026", "startsOn": "2026-05-04"},
            {"id": "coh-acme-amer", "programId": "prog-acme-sales", "name": "AMER Sales · 2026", "startsOn": "2026-05-04"},
            {"id": "coh-nw-fall", "programId": "prog-northwind-writing", "name": "Fall Writers 2026", "startsOn": "2026-09-08"},
            {"id": "coh-demo", "programId": "prog-full", "name": "Demo / Evaluation", "startsOn": "2026-01-01"},
            {"id": "coh-syn-functions", "programId": "prog-syn-sales", "name": "Synottic · AI for Sales · 2026", "startsOn": "2026-09-01"},
        ],
        "learners": [
            {"id": "lrn-amit", "cohortId": "coh-syn-functions", "name": "Amit Soni", "email": "amitsoni.id@gmail.com"},
        ],
        "accessCodes": [
            {"code": "ACME-SALES-EMEA", "cohortId": "coh-acme-emea", "kind": "cohort"},
            {"code": "ACME-SALES-AMER", "cohortId": "coh-acme-amer", "kind": "cohort"},
            {"code": "NORTHWIND-WRITE", "cohortId": "coh-nw-fall", "kind": "cohort"},
            {"code": "DEMO-2026", "cohortId": "coh-demo", "kind": "cohort"},
        ],
    }
    open(os.path.join(HERE, "part_orgmodel.json"), "w", encoding="utf-8").write(json.dumps(org_model, indent=2))

    curriculum = []
    for track in TRACK_ORDER:
        for c in CATALOGUE[track]["courses"]:
            curriculum.append(flagship_prompt(c, track))
    open(os.path.join(HERE, "part_curriculum.json"), "w", encoding="utf-8").write(json.dumps(curriculum, indent=2))

    # admin-console seed codes. Merged by AdminStore on first run.
    #  - per-course & per-track codes: SCOPED (fullLibrary false) — the learner
    #    sees only that program's / track's prompts, Categories nav is hidden.
    #  - SYNOTTIC-ALL: the global / all-roles view (full library, Categories on).
    #  - SYNOTTIC-SUPERADMIN: full library + the admin console.
    def base(**kw):
        d = {"orgName": "Synottic AI Institute", "domain": "synottic.com", "industry": "Education",
             "functions": [], "roles": [], "programIds": [], "fullLibrary": False, "enabled": True,
             "createdAt": "2026-09-01T00:00:00.000Z"}
        d.update(kw)
        return d

    seed = [
        base(id="seed-all", code="SYNOTTIC-ALL", roles=["All roles"], programIds=["prog-full"],
             fullLibrary=True, note="Global / all-roles view — every category, function and program"),
        base(id="seed-superadmin", code="SYNOTTIC-SUPERADMIN", roles=["Super-admin"], programIds=["prog-full"],
             fullLibrary=True, superAdmin=True, note="Super-admin — full library + admin console"),
    ]
    for track in TRACK_ORDER:
        seed.append(base(id="seed-" + re.sub(r"[^a-z0-9]+", "-", track.lower()).strip("-"),
                         code=TRACK_CODE[track], programIds=track_program_ids(track),
                         note=track + " track — all courses (scoped)"))
    for track in TRACK_ORDER:
        for c in CATALOGUE[track]["courses"]:
            fn = SLUG_FUNCTION.get(c["slug"])
            seed.append(base(id="seed-" + c["slug"], code=COURSE_CODE[c["slug"]],
                             functions=[fn] if fn else [], roles=c.get("roles") or [],
                             programIds=["prog-syn-" + c["slug"]],
                             note=track + " · " + c["name"] + " (scoped)"))
    open(os.path.join(HERE, "part_admin_seed.json"), "w", encoding="utf-8").write(json.dumps(seed, indent=2))

    # --- human reference sheet -------------------------------------------------
    lines = [
        "# Synottic Prompt Library — access codes",
        "",
        "_Generated from the course catalogue. Codes are case-insensitive; spaces are ignored._",
        "",
        "## Admin & all-access",
        "",
        "| Purpose | Code | What it opens |",
        "|---|---|---|",
        "| **Super-admin** | `SYNOTTIC-SUPERADMIN` | Full library **and** the admin console (an \"Admin console\" link appears in the app). |",
        "| Admin console only | `" + ADMIN_KEY + "` | The admin console (enter on the sign-in screen → \"Admin console →\"). |",
        "| Global / all-roles learner | `SYNOTTIC-ALL` | The whole library with every category, function and program (Categories browsing on). |",
        "| Evaluation | `DEMO-2026` | Same as `SYNOTTIC-ALL` — full library, for demos. |",
        "",
        "> Every other `SYNOTTIC-*` code below is **scoped**: the learner sees only that course's / track's",
        "> prompts as part of their program. The **Categories** and **Library Governance** tabs are hidden for",
        "> scoped learners — they discover prompts through their program, search, Learn and Practice.",
        "",
        "## Whole-track codes (all courses in the track, scoped to the track)",
        "",
        "| Track | Code | Courses |",
        "|---|---|---|",
    ]
    for track in TRACK_ORDER:
        lines.append("| " + track + " | `" + TRACK_CODE[track] + "` | " + str(len(CATALOGUE[track]["courses"])) + " |")
    lines += ["", "## Per-course codes", ""]
    for track in TRACK_ORDER:
        lines += ["### " + track, "", "| Course | Access code |", "|---|---|"]
        for c in CATALOGUE[track]["courses"]:
            lines.append("| " + c["name"] + " | `" + COURSE_CODE[c["slug"]] + "` |")
        lines.append("")
    lines += [
        "## Client codes (built-in)",
        "",
        "| Code | Scope |",
        "|---|---|",
        "| `ACME-SALES-EMEA` / `ACME-SALES-AMER` | Acme Corp — program-scoped sales enablement |",
        "| `NORTHWIND-WRITE` | Northwind — program-scoped writing |",
        "",
        "> All `SYNOTTIC-*` course/track codes are editable in the Admin console (rename, disable, "
        "re-scope, add domain/industry/functions/roles). Changes there override this sheet.",
        "",
    ]
    sheet = "\n".join(lines) + "\n"
    for path in [os.path.join(HERE, "..", "..", "ACCESS-CODES.md"),
                 os.path.join(HERE, "..", "..", "promptlibrary-push-package", "ACCESS-CODES.md")]:
        try:
            open(os.path.normpath(path), "w", encoding="utf-8").write(sheet)
        except OSError:
            pass

    print("programs:", len(org_model["programs"]), "| cohorts:", len(org_model["cohorts"]),
          "| codes:", len(org_model["accessCodes"]), "| curriculum:", len(curriculum),
          "| admin seed:", len(seed), "| wrote ACCESS-CODES.md")


if __name__ == "__main__":
    main()
