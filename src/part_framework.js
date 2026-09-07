/* =========================================================================
   Prompt Framework — a data-driven learning + practice capability.

   Everything the UI needs comes from FRAMEWORKS below. A new framework can be
   added as another entry in that object without touching any render code:
     framework → levels → ordered component keys
              → components (letter / name / explanation / why / example /
                            common mistake / detectors / builder + assemble)
              → practice scenarios (shared with the existing Practice view)
   The detectors drive three things at once: the AI-feedback rubric, the
   "My prompt vs model" comparison, and the automatic mapping of the 3,400+
   library prompts to a framework level (computed once at load, never saved).
   ========================================================================= */
const FRAMEWORKS = {
  rctf: {
    id: "rctf",
    name: "Synottic Prompt Framework",
    blurb: "A progressive way to build better prompts — add structure as the stakes rise.",
    components: {
      role: {
        letter: "R", name: "Role",
        short: "Tell the AI who it should act as.",
        why: "A role sets the AI's perspective, vocabulary and quality bar. The same question answered “as a CFO” and “as a marketer” produces very different, more useful output.",
        example: "Act as a senior marketing strategist with 10 years in B2B SaaS.",
        mistake: "Help me with marketing.",
        missingHint: "Tell the AI who to act as.",
        improve: "Add one line naming the role, its seniority and its specialism.",
        praise: "Clearly defined.",
        builderLabel: "Who should the AI act as?",
        builderPlaceholder: "e.g. A senior marketing strategist with B2B SaaS experience",
        builderType: "text",
        fix: "Act as [an experienced practitioner in this area — name the role and seniority].",
        assemble: (v) => "Role: Act as " + v.replace(/^act as\s+/i, "").replace(/\.$/, "") + ".",
        detect: /\b(act as|acting as|you are (an?|my|acting)|as an? (experienced|senior|expert|professional|seasoned|world[- ]class)|role\s*[:=]|imagine you(?:'re| are)|play the role of|take on the role|assume the role|you'?re an? \w+ (expert|specialist|strategist|analyst|manager|consultant|coach))/i,
        soft: /\b(as an? (marketer|engineer|designer|writer|lawyer|teacher|recruiter|founder|manager|analyst|consultant|coach|strategist|advisor))\b/i,
      },
      context: {
        letter: "C", name: "Context",
        short: "Give the AI the background it needs — audience, situation, goal.",
        why: "The AI can only tailor an answer to what you tell it. Context is what turns a generic reply into one that fits your actual situation.",
        example: "Context: We're a 40-person B2B SaaS company. Our audience is RevOps leaders. Churn rose 3 points last quarter.",
        mistake: "Write me a churn email. (nothing about who it's for or what's going on)",
        missingHint: "Add the background the AI needs.",
        improve: "Add 1–2 sentences on who it's for, what's happening, and why it matters now.",
        praise: "Good background.",
        builderLabel: "What background does the AI need?",
        builderPlaceholder: "Audience, situation, what's happened so far, why it matters",
        builderType: "textarea",
        fix: "Context: [2–3 sentences on your audience, your situation, and what's happened so far].",
        assemble: (v) => "Context: " + v,
        detect: /\b(context\s*[:=]|background\s*[:=]|the situation is|currently we|we are|we're a|our (company|team|product|audience|customers|users|clients|org)|my (company|team|role|manager|client)|for (my|our) (team|company|org|audience)|the audience is|target audience|given that|based on the|here'?s (the|what)|to give you context)/i,
        soft: /\[[A-Za-z][A-Za-z0-9 _\/'\-]{1,40}\]|\b(because|since|so far|last (quarter|month|week|year))\b/i,
      },
      goal: {
        letter: "G", name: "Goal",
        short: "State the outcome you want, not just the task.",
        why: "The task is what to do; the goal is what success looks like. Naming it lets the AI make better trade-offs on your behalf.",
        example: "Goal: A shortlist we can act on this week — fewer, higher-confidence options rather than a long list.",
        mistake: "List some ideas. (no definition of a good outcome)",
        missingHint: "Define the desired outcome.",
        improve: "Add a “Goal:” line describing what a good result lets you do next.",
        praise: "Outcome is clear.",
        builderLabel: "What outcome do you want?",
        builderPlaceholder: "What a good result lets you do next",
        builderType: "textarea",
        fix: "Goal: [what a good result enables you to do — the outcome, not the task].",
        assemble: (v) => "Goal: " + v,
        detect: /\b(goal\s*[:=]|the (goal|objective|aim|outcome) is|so that (i|we)|in order to|success looks like|the (result|output|answer) should (help|let|enable)|i want to be able to|end goal|desired outcome|what i'?m trying to achieve)/i,
        soft: /\b(objective|outcome|so we can|to help (me|us)|ultimately)\b/i,
      },
      task: {
        letter: "T", name: "Task",
        short: "Say exactly what the AI should do.",
        why: "A precise, single instruction — ideally starting with a verb — keeps the response focused on what you actually need.",
        example: "Task: Draft a 150-word announcement email and 3 subject-line options.",
        mistake: "Something about our launch. (vague, no verb, no deliverable)",
        missingHint: "State the task as one clear instruction.",
        improve: "Start with a verb and name the deliverable: “Draft…”, “Analyse…”, “Compare…”.",
        praise: "Clear action.",
        builderLabel: "What exactly should the AI do?",
        builderPlaceholder: "e.g. Draft a 150-word announcement email and 3 subject lines",
        builderType: "textarea",
        fix: "Task: [one clear instruction starting with a verb, naming the deliverable].",
        assemble: (v) => "Task: " + v,
        detect: /\b(task\s*[:=]|your task is|please (write|draft|create|produce|analy|compare|summar|list|design|build|plan|review|rewrite|generate|outline|explain|evaluate)|^\s*(write|draft|create|produce|analy[sz]e|compare|summari[sz]e|list|design|build|plan|review|rewrite|generate|outline|explain|evaluate)\b|step 1[:.)]|^\s*1[.)]\s)/im,
        soft: /\b(help me (write|draft|create|build|plan|make|analy)|i need (a|an|to|help)|can you (write|make|help|create|draft|give))\b/i,
      },
      constraints: {
        letter: "C", name: "Constraints",
        short: "Set the rules, limits and boundaries.",
        why: "Constraints keep the output usable straight away: length, tone, what to avoid, what must stay true.",
        example: "Constraints: Under 150 words. Warm but not apologetic. No jargon. Don't promise delivery dates.",
        mistake: "Leaving length, tone and no-gos unstated, then re-editing the reply by hand.",
        missingHint: "Add boundaries.",
        improve: "Add limits: length, tone, and 1–2 things to avoid.",
        praise: "Boundaries are set.",
        builderLabel: "What rules or limits must it follow?",
        builderPlaceholder: "Length, tone, things to avoid, what must stay true",
        builderType: "textarea",
        fix: "Constraints: [length, tone, and 1–2 things to avoid].",
        assemble: (v) => "Constraints: " + v,
        detect: /\b(constraint|limit(ed)? to|no more than|under \d|within \d|at most \d|word count|keep it (short|brief|concise|under|to)|tone\s*[:=]|in a \w+ tone|avoid|do not|don'?t|must not|only use|no jargon|stay under|maximum of|minimum of)/i,
        soft: /\b(concise|brief|short|formal|informal|professional tone|friendly tone|no filler)\b/i,
      },
      examples: {
        letter: "E", name: "Examples",
        short: "Show what good looks like.",
        why: "One or two examples communicate style and standard faster than a paragraph of description.",
        example: "Example of the tone we want: “We changed our pricing. Here's exactly what it means for you.”",
        mistake: "Make it sound good. (no reference point for “good”)",
        missingHint: "Add an example.",
        improve: "Paste one short example of the style, format or answer you're aiming for.",
        praise: "A reference example is included.",
        builderLabel: "What does a good result look like?",
        builderPlaceholder: "Paste one short example of the tone, format or answer you want",
        builderType: "textarea",
        fix: "Examples: [paste one short example of the tone / format / answer you're aiming for].",
        assemble: (v) => "Examples: " + v,
        detect: /\b(example\s*[:=]|for example|e\.g\.|for instance|such as|sample (input|output|answer|response)|like this\s*[:=]|here'?s an example|as an example|reference example|model it on)/i,
        soft: /["“][^"”]{12,}["”]/,
      },
      format: {
        letter: "F", name: "Format",
        short: "Say how the answer should be structured.",
        why: "Without a format you get a wall of text. Ask for a table, a numbered list, sections, or a word count.",
        example: "Format: A markdown table with columns Theme | Evidence | Recommended action.",
        mistake: "Not saying — then reformatting the reply by hand every time.",
        missingHint: "Say how the answer should look.",
        improve: "Add a “Format:” line naming the structure — list, table, sections, length.",
        praise: "Output structure is clear.",
        builderLabel: "How should the output be structured?",
        builderPlaceholder: "e.g. A markdown table with 3 columns, then a one-line summary",
        builderType: "textarea",
        fix: "Format: [name the structure — list, table, sections, word count].",
        assemble: (v) => "Format: " + v,
        detect: /\b(format\s*[:=]|as a (table|list|bulleted list|numbered list|checklist)|bullet points?|numbered list|in \d+ (words|sentences|paragraphs|bullets)|markdown|json|as headings|in sections|use headings|a template|word count|respond with (a|only)|structure(d)? as|output\s*[:=])/i,
        soft: /\b(table|list|bullets?|sections?|headings?|steps?|template|columns?)\b/i,
      },
      verification: {
        letter: "V", name: "Verification",
        short: "Ask the AI to check its own work.",
        why: "A verification step catches errors, unsupported claims and gaps before you rely on the answer.",
        example: "Verification: After drafting, list any claim you're not fully sure of and flag anything you assumed.",
        mistake: "Taking the first answer as final, with no self-check.",
        missingHint: "Ask the AI to check its work.",
        improve: "Add a step: “Then review your answer for accuracy and list what you're unsure about.”",
        praise: "A self-check step is included.",
        builderLabel: "How should the AI check its work?",
        builderPlaceholder: "e.g. Flag any uncertain claims and list the assumptions made",
        builderType: "textarea",
        fix: "Verification: [ask the AI to review its answer and flag uncertain claims + assumptions].",
        assemble: (v) => "Verification: " + v,
        detect: /\b(verif|double.?check|check your (work|answer|response|facts)|review your (answer|work|response|draft)|self.?review|self.?check|flag (any|anything|any claim)|list (any )?assumptions|state your assumptions|cite (your )?sources|show your (working|reasoning)|make sure (you|the|everything)|confirm that|sanity.?check your)/i,
        soft: /\b(accuracy|accurate|check for errors|before you finish)\b/i,
      },
      validation: {
        letter: "V", name: "Validation",
        short: "Ask the AI to test the result against real-world needs.",
        why: "Validation checks whether the answer would actually work in your situation — not just whether it reads tidily.",
        example: "Validation: Check the email against a sceptical customer — would it reduce or increase support tickets?",
        mistake: "Shipping output that reads well but was never pressure-tested.",
        missingHint: "Ask the AI to test the result.",
        improve: "Add a step: “Then test this against [a real scenario or reader] and note where it breaks.”",
        praise: "A real-world test is included.",
        builderLabel: "How should the AI test the result?",
        builderPlaceholder: "e.g. Check it against a sceptical reader and note where it falls down",
        builderType: "textarea",
        fix: "Validation: [ask the AI to test the result against a real scenario or reader and note where it breaks].",
        assemble: (v) => "Validation: " + v,
        detect: /\b(validat|pressure.?test|stress.?test|test (it|this|the (answer|result|output|draft)) against|would this (actually )?work|does this hold up|edge case|in practice|real.?world|from the (customer|reader|user|buyer|board)'?s (point of view|perspective|angle)|red.?team|poke holes|where (it|this) (breaks|falls down))/i,
        soft: /\b(realistic|would a \w+ (accept|buy|believe)|practical(ity)?)\b/i,
      },
    },
    levels: [
      {
        level: 1, code: "R-C-T-F", name: "Clear prompt", tagline: "Build a clear prompt",
        useWhen: "You need a quick, clear response.",
        summary: "Tell the AI what to do — who to be, what it needs to know, the task, and the shape of the answer.",
        componentKeys: ["role", "context", "task", "format"],
      },
      {
        level: 2, code: "R-C-T-F-V-V", name: "Reliable prompt", tagline: "Build a reliable prompt",
        useWhen: "Accuracy, quality and reliability matter.",
        summary: "Everything in Level 1, plus two checks: have the AI verify its own work and validate the result against real needs.",
        componentKeys: ["role", "context", "task", "format", "verification", "validation"],
      },
      {
        level: 3, code: "R-C-G-T-C-E-F-V-V", name: "Expert prompt", tagline: "Build an expert-level prompt",
        useWhen: "High-quality, repeatable, professional or business-critical results.",
        summary: "The full brief: role, context, an explicit goal, the task, constraints, examples of good, the output format, and both checks.",
        componentKeys: ["role", "context", "goal", "task", "constraints", "examples", "format", "verification", "validation"],
      },
    ],
    scenarios: [
      { id: "fw-sc-interviews", role: "Product manager", title: "Turn customer interviews into insights",
        situation: "You have 8 raw customer-interview transcripts and need cross-cutting themes, not a summary of each call.",
        task: "Write a prompt that gets the AI to synthesise themes across all 8 transcripts with supporting quotes." },
      { id: "fw-sc-announce", role: "Marketing manager", title: "Announce a pricing change",
        situation: "You're raising prices for 40,000 existing customers next Tuesday. Some will be unhappy.",
        task: "Write a prompt that drafts a clear, non-defensive announcement email plus subject-line options." },
      { id: "fw-sc-retro", role: "Team lead", title: "Run a blameless retro",
        situation: "Your squad just shipped a delayed feature and morale is low. You want a retro that ends with 3 concrete changes.",
        task: "Write a prompt that designs and facilitates the retro agenda." },
      { id: "fw-sc-strategy", role: "Founder", title: "Pressure-test a market-entry plan",
        situation: "You've written a one-page plan to enter a new market and want the holes found before the board sees it.",
        task: "Write a prompt that critiques the plan the way a sceptical investor would." },
      { id: "fw-sc-1to1", role: "People partner", title: "Prepare a difficult 1:1",
        situation: "A strong performer has been dismissive in meetings. You have a 1:1 with them tomorrow.",
        task: "Write a prompt that helps you plan the conversation and anticipate reactions." },
      { id: "fw-sc-macro", role: "Support lead", title: "Rewrite a robotic macro",
        situation: "Your refund macro sounds robotic and customers escalate after receiving it.",
        task: "Write a prompt that rewrites the macro to be warm but still policy-accurate." },
    ],
  },
};
const FRAMEWORK = FRAMEWORKS.rctf;
const FRAMEWORK_KEYS_ALL = FRAMEWORK.levels[FRAMEWORK.levels.length - 1].componentKeys;
function fwLevel(n) { return FRAMEWORK.levels[(n || 1) - 1] || FRAMEWORK.levels[0]; }
function fwComp(key) { return FRAMEWORK.components[key]; }
function fwScenarios() { return FRAMEWORK.scenarios; }

/* ---------- Detection: one component -> strong | weak | missing ---------- */
function fwStatus(key, text) {
  const c = fwComp(key);
  if (!c || !text) return "missing";
  if (c.detect && c.detect.test(text)) return "strong";
  if (c.soft && c.soft.test(text)) return "weak";
  return "missing";
}
function fwStatusMap(text, keys) {
  const out = {};
  (keys || FRAMEWORK_KEYS_ALL).forEach((k) => { out[k] = fwStatus(k, text || ""); });
  return out;
}
const FW_STATUS_WEIGHT = { strong: 1, weak: 0.5, missing: 0 };

/* ---------- Library mapping (computed in enrichRecord, never persisted) ---- */
function deriveFrameworkLevel(rec) {
  const text = (rec.originalPrompt || "") + "";
  const map = fwStatusMap(text, FRAMEWORK_KEYS_ALL);
  const present = FRAMEWORK_KEYS_ALL.filter((k) => map[k] !== "missing");
  const covered = (keys) => keys.filter((k) => map[k] !== "missing").length / keys.length;
  let level = null;
  if (covered(fwLevel(3).componentKeys) >= 0.78) level = 3;
  else if (covered(fwLevel(2).componentKeys) >= 0.8) level = 2;
  else if (covered(fwLevel(1).componentKeys) >= 0.75 || (map.task !== "missing" && present.length >= 3)) level = 1;
  rec.frameworkLevel = level;
  rec.frameworkComponents = present;
  return rec;
}
function fwLevelBadge(rec) {
  if (!rec || !rec.frameworkLevel) return "";
  const L = fwLevel(rec.frameworkLevel);
  return '<span class="chip" title="Written like a Level ' + rec.frameworkLevel + ' framework prompt (' + L.code + ')">L' + rec.frameworkLevel + " · " + escapeHtml(L.code) + "</span>";
}

/* ---------- AI feedback: evaluate a prompt against a level ---------- */
function evaluateFramework(text, levelNum) {
  const L = fwLevel(levelNum);
  const keys = L.componentKeys;
  const seen = {};                         // dedupe repeated letters (C, V)
  const rows = keys.map((k) => {
    const c = fwComp(k), st = fwStatus(k, text);
    const dupIdx = seen[k] || 0; seen[k] = dupIdx + 1;
    return {
      key: k, letter: c.letter, name: c.name, status: st,
      feedback: st === "strong" ? c.praise : st === "weak" ? c.improve : c.missingHint,
    };
  });
  const score = Math.round(
    (rows.reduce((s, r) => s + FW_STATUS_WEIGHT[r.status], 0) / rows.length) * 100
  );
  const axes = {}; rows.forEach((r) => { axes[r.key] = Math.round(FW_STATUS_WEIGHT[r.status] * 100); });
  const strong = rows.filter((r) => r.status === "strong");
  const weak = rows.filter((r) => r.status === "weak");
  const missing = rows.filter((r) => r.status === "missing");
  const didWell = strong.length
    ? strong.map((r) => r.name + " — " + fwComp(r.key).praise)
    : ["You've made a start — the feedback below is where to build next."];
  const missingText = missing.map((r) => r.name + " — " + fwComp(r.key).why);
  const improveText = weak.concat(missing).map((r) => fwComp(r.key).improve);
  const whyText = weak.concat(missing).slice(0, 3).map((r) => r.name + ": " + fwComp(r.key).why);
  return {
    level: levelNum, score, rows, axes,
    didWell, missing: missingText, improve: improveText, why: whyText,
    improved: fwImprovePrompt(text, levelNum),
  };
}
/* Keep the learner's own words as the core; scaffold the missing pieces
   around them with bracketed prompts. Never a wholesale replacement. */
function fwImprovePrompt(text, levelNum) {
  const L = fwLevel(levelNum);
  const map = fwStatusMap(text, L.componentKeys);
  const core = (text || "").trim();
  const lines = [];
  if (map.role === "missing") lines.push(fwComp("role").fix);
  lines.push(core || "[your prompt]");
  L.componentKeys.forEach((k) => {
    if (k === "role") return;
    if (map[k] === "missing") lines.push(fwComp(k).fix);
  });
  return lines.join("\n\n");
}

/* ---------- Model answer that demonstrates the selected level ---------- */
function frameworkModelAnswer(sc, levelNum) {
  const L = fwLevel(levelNum);
  const role = (sc.role || "professional").toLowerCase();
  const taskLine = (sc.task || sc.goal || "Complete the task described above.").replace(/^write a prompt that /i, "").replace(/^a prompt that /i, "");
  const parts = {
    role: "Role: Act as an experienced " + role + " who has done this many times.",
    context: "Context: " + sc.situation,
    goal: "Goal: A result I can act on immediately — practical over exhaustive, and defensible if challenged.",
    task: "Task: " + taskLine.charAt(0).toUpperCase() + taskLine.slice(1).replace(/\.?$/, "."),
    constraints: "Constraints: Be specific and concrete; keep a calm, professional tone; no filler; don't invent facts I haven't given you.",
    examples: "Examples: If it helps, model the structure on a strong version you've seen work before, and mirror that level of detail.",
    format: "Format: Give me (1) a short plan, (2) the finished artefact, (3) two risks and how to handle each.",
    verification: "Verification: Before finishing, review your draft and list any claim you're not sure of and every assumption you made.",
    validation: "Validation: Then test the result against the real audience above — where would it fall down, and what would you change?",
  };
  return L.componentKeys.map((k) => parts[k]).join("\n");
}

/* ---------- Progress helpers (state lives in Store.progress.framework) ----- */
function frameworkLevelPct(levelNum) {
  const L = fwLevel(levelNum);
  const f = Store.getFrameworkProgress();
  const compKeys = Array.from(new Set(L.componentKeys));
  const learned = compKeys.filter((k) => f.comps[k]).length;
  let pct = (learned / compKeys.length) * 50;
  if (f.levels[levelNum]) pct += 15;
  if ((f.attempts || []).some((a) => a.level === levelNum)) pct += 15;
  const best = (f.best || {})[levelNum] || 0;
  pct += Math.min(20, (best / 75) * 20);
  return Math.max(0, Math.min(100, Math.round(pct)));
}
function frameworkOverallPct() {
  const n = FRAMEWORK.levels.length;
  return Math.round(FRAMEWORK.levels.reduce((s, L) => s + frameworkLevelPct(L.level), 0) / n);
}

/* ---------- Learn: the Prompt Framework module ---------- */
function frameworkLearnModuleHtml() {
  const overall = frameworkOverallPct();
  return `
  <div class="fw-module">
    <div class="fw-module-head">
      <div>
        <h2>Prompt Framework</h2>
        <p>Learn to build better prompts step by step.</p>
      </div>
      <span class="chip chip-accent">${overall}% complete</span>
    </div>
    <div class="fw-levels">
      ${FRAMEWORK.levels.map((L) => {
        const pct = frameworkLevelPct(L.level);
        return `<button class="fw-level-row" data-fw-level="${L.level}">
          <span class="fw-level-code">${escapeHtml(L.code)}</span>
          <span class="fw-level-meta"><b>Level ${L.level}</b><span>${escapeHtml(L.tagline)}</span></span>
          <span class="fw-level-prog"><span class="progress-track"><i style="width:${pct}%"></i></span><span class="fw-level-pct">${pct}%</span></span>
          ${icon("chevronRight")}
        </button>`;
      }).join("")}
    </div>
  </div>`;
}
function wireFrameworkLearnModule(container) {
  container.querySelectorAll("[data-fw-level]").forEach((b) => b.addEventListener("click", () => {
    STATE.frameworkLevel = parseInt(b.dataset.fwLevel, 10);
    navigate("framework");
  }));
}

/* ---------- Framework detail view ---------- */
function frameworkExamplePrompt(levelNum) {
  return frameworkModelAnswer(
    { role: "practitioner", situation: "[your audience, your situation, and what has happened so far]", task: "[the one thing you need done]" },
    levelNum
  );
}
function frameworkWhyItWorks(levelNum) {
  return fwLevel(levelNum).componentKeys
    .filter((k, i, a) => a.indexOf(k) === i)
    .map((k) => fwComp(k).name + " — " + fwComp(k).why);
}
function renderFrameworkView(container) {
  const levelNum = STATE.frameworkLevel || 1;
  const L = fwLevel(levelNum);
  Store.markFrameworkLevelViewed(levelNum);
  const f = Store.getFrameworkProgress();
  const compKeys = L.componentKeys;
  const pct = frameworkLevelPct(levelNum);
  container.innerHTML = `
    <button class="btn btn-ghost btn-sm" data-nav="learn" style="margin-bottom:12px;">← Prompt Framework</button>
    <div class="fw-selector">
      ${FRAMEWORK.levels.map((x) => `<button class="${x.level === levelNum ? "active" : ""}" data-fw-switch="${x.level}">Level ${x.level} · ${escapeHtml(x.code)}</button>`).join("")}
    </div>
    <div class="section-title" style="margin-bottom:4px;"><h2 style="font-size:20px;">Level ${levelNum} · ${escapeHtml(L.name)}</h2>
      <span style="font-size:12px;color:var(--text-faint);">${pct}% complete</span></div>
    <p class="prose" style="max-width:640px;color:var(--text-muted);margin-bottom:6px;">${escapeHtml(L.summary)}</p>
    <p class="prose" style="max-width:640px;margin-bottom:4px;"><b>Use when:</b> ${escapeHtml(L.useWhen)}</p>

    <div class="detail-section" style="margin-top:16px;"><h3>The framework</h3>
      <div class="fw-hero-visual">
        ${compKeys.map((k) => { const c = fwComp(k); return `<button class="fw-tile" data-fw-jump="fw-c-${k}-${compKeys.indexOf(k)}"><span class="l">${c.letter}</span><span class="n">${escapeHtml(c.name)}</span></button>`; }).join("")}
      </div>
    </div>

    <details class="detail-expand" style="margin-bottom:20px;">
      <summary>A prompt written at this level <span class="chev">${icon("chevronRight")}</span></summary>
      <div class="expand-body">
        <div class="prompt-block" style="margin-top:10px;">${escapeHtml(frameworkExamplePrompt(levelNum))}</div>
        <h3 style="margin-top:14px;">Why this works</h3>
        <div class="why-list">${frameworkWhyItWorks(levelNum).map((w) => `<div class="why-item">${icon("check")}<span>${escapeHtml(w)}</span></div>`).join("")}</div>
      </div>
    </details>

    <div class="section-title"><h2>Components</h2><span style="font-size:12px;color:var(--text-faint);">${Array.from(new Set(compKeys)).filter((k) => f.comps[k]).length} of ${Array.from(new Set(compKeys)).length} understood</span></div>
    <div id="fw-comp-list">
      ${compKeys.map((k, idx) => {
        const c = fwComp(k), learned = !!f.comps[k];
        return `
        <div class="fw-comp" id="fw-c-${k}-${idx}">
          <div class="fw-comp-head">
            <span class="fw-letter">${c.letter}</span>
            <h3>${escapeHtml(c.name)}</h3>
            <button class="btn btn-sm ${learned ? "" : "btn-primary"}" data-fw-comp="${k}">${learned ? icon("check") + " Understood" : "Mark as understood"}</button>
          </div>
          <div class="fw-comp-short">${escapeHtml(c.short)}</div>
          <div class="fw-comp-grid">
            <div><h4>Why it matters</h4><p>${escapeHtml(c.why)}</p></div>
            <div><h4>Example</h4><div class="fw-good">${escapeHtml(c.example)}</div></div>
            <div><h4>Common mistake</h4><div class="fw-bad">${escapeHtml(c.mistake)}</div></div>
          </div>
        </div>`;
      }).join("")}
    </div>

    <div class="section-title" style="margin-top:18px;"><h2>Next</h2></div>
    <div style="display:flex;gap:8px;flex-wrap:wrap;">
      <button class="btn btn-primary" data-fw-practice="${levelNum}">${icon("target")} Practice this level</button>
      <button class="btn" data-fw-build="${levelNum}">${icon("build")} Build a prompt with this framework</button>
      ${levelNum < FRAMEWORK.levels.length ? `<button class="btn btn-ghost" data-fw-switch="${levelNum + 1}">Next: Level ${levelNum + 1} →</button>` : ""}
    </div>`;

  container.querySelectorAll("[data-nav]").forEach((el) => el.addEventListener("click", () => navigate(el.dataset.nav)));
  container.querySelectorAll("[data-fw-switch]").forEach((b) => b.addEventListener("click", () => { STATE.frameworkLevel = parseInt(b.dataset.fwSwitch, 10); renderFrameworkView(container); window.scrollTo({ top: 0 }); }));
  container.querySelectorAll("[data-fw-jump]").forEach((b) => b.addEventListener("click", () => { const t = document.getElementById(b.dataset.fwJump); if (t) t.scrollIntoView({ behavior: "smooth", block: "start" }); }));
  container.querySelectorAll("[data-fw-comp]").forEach((b) => b.addEventListener("click", () => { Store.markFrameworkComponent(b.dataset.fwComp); renderFrameworkView(container); renderSidebarFooter(); }));
  container.querySelectorAll("[data-fw-practice]").forEach((b) => b.addEventListener("click", () => {
    const lv = parseInt(b.dataset.fwPractice, 10);
    STATE.practice = Object.assign({ scenarioId: fwScenarios()[0].id, draft: "", result: null, showModel: false, compare: false }, STATE.practice || {}, { level: lv, result: null });
    navigate("practice");
  }));
  container.querySelectorAll("[data-fw-build]").forEach((b) => b.addEventListener("click", () => {
    STATE.builder = { mode: "fw", level: parseInt(b.dataset.fwBuild, 10), step: 0, answers: {}, generated: null };
    navigate("builder");
  }));
}

/* ---------- Practice: framework-aware feedback + compare ---------- */
function fwCoverageTableHtml(rows) {
  return `
  <table class="fw-cov-table">
    <thead><tr><th>Component</th><th>Status</th><th>Feedback</th></tr></thead>
    <tbody>
      ${rows.map((r) => {
        const cls = r.status === "strong" ? "s-strong" : r.status === "weak" ? "s-weak" : "s-missing";
        const label = r.status === "strong" ? "Strong" : r.status === "weak" ? "Weak" : "Missing";
        return `<tr>
          <td><b>${escapeHtml(r.name)}</b></td>
          <td><span class="fw-status ${cls}"><span class="dot"></span>${label}</span></td>
          <td>${escapeHtml(r.feedback)}</td>
        </tr>`;
      }).join("")}
    </tbody>
  </table>`;
}
function practiceFrameworkFeedbackHtml(ev) {
  const teach = (title, items, good) => items && items.length ? `
    <div class="detail-section" style="margin-bottom:12px;">
      <h3>${escapeHtml(title)}</h3>
      <div class="strengths-improvements">${items.map((t) => `<div class="si-item ${good ? "si-good" : "si-bad"}">${icon(good ? "check" : "alert")}<span>${escapeHtml(t)}</span></div>`).join("")}</div>
    </div>` : "";
  return `
    <div class="detail-section">
      <div class="block-header">
        <span class="label">Prompt score</span>
        <span class="quality-pill ${qualityClass(ev.score)}"><span class="quality-bar"><i style="width:${ev.score}%"></i></span>${ev.score}</span>
        <span style="font-size:11.5px;color:var(--text-faint);">/ 100 · against Level ${ev.level} (${escapeHtml(fwLevel(ev.level).code)})</span>
      </div>
    </div>
    <div class="detail-section">
      <h3>Framework coverage</h3>
      ${fwCoverageTableHtml(ev.rows)}
    </div>
    ${teach("What you did well", ev.didWell, true)}
    ${teach("What is missing", ev.missing, false)}
    ${teach("How to improve it", ev.improve, false)}
    ${teach("Why the improvement matters", ev.why, true)}
    <div class="detail-section">
      <div class="block-header"><span class="label">Improved prompt</span><span class="chip">keeps your intent</span>
        <button class="btn btn-sm" id="fw-copy-improved">${icon("copy")} Copy</button></div>
      <div class="prompt-block" id="fw-improved-text">${escapeHtml(ev.improved)}</div>
      <div class="form-hint">Your wording is kept as the core — the bracketed lines are the pieces to add.</div>
    </div>`;
}
function fwLetterTilesHtml(text, levelNum) {
  const L = fwLevel(levelNum);
  return `<div class="fw-hero-visual" style="margin:6px 0 8px;">` + L.componentKeys.map((k) => {
    const c = fwComp(k), st = fwStatus(k, text);
    return `<div class="fw-tile ${st !== "missing" ? "lit" : ""}" title="${escapeHtml(c.name)}: ${st}"><span class="l">${c.letter}</span><span class="n">${escapeHtml(c.name)}</span></div>`;
  }).join("") + `</div>`;
}
function frameworkCompareHtml(myText, sc, levelNum) {
  const model = frameworkModelAnswer(sc, levelNum);
  return `
    <div class="detail-section" style="margin-top:16px;">
      <div class="block-header"><span class="label">My prompt vs model prompt</span><span class="chip">Level ${levelNum} · ${escapeHtml(fwLevel(levelNum).code)}</span></div>
      <div class="fw-compare">
        <div>
          <h4>My prompt</h4>
          ${fwLetterTilesHtml(myText, levelNum)}
          <div class="prompt-block" style="max-height:320px;">${escapeHtml(myText || "—")}</div>
        </div>
        <div>
          <h4>Model prompt</h4>
          ${fwLetterTilesHtml(model, levelNum)}
          <div class="prompt-block" style="max-height:320px;">${escapeHtml(model)}</div>
          <button class="btn btn-sm" id="fw-copy-model" style="margin-top:8px;">${icon("copy")} Copy model</button>
        </div>
      </div>
      <div class="form-hint" style="margin-top:8px;">A lit tile means that component is present. Aim to light every tile for the level.</div>
    </div>`;
}
