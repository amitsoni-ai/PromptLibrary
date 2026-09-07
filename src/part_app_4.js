/* ---------- Me — one place for Saved, Recently used and Progress ----------
   Replaces the old "Favorites" + "My Library" split. "Saved" is a single
   concept: everything the learner has kept (starred from the library) or
   authored (created / improved), in one list with a light source filter. */
function renderMeView(container) {
  // migrate any legacy nav target onto the Me tabs
  if (STATE.view === "favorites") STATE.meTab = "saved";
  if (STATE.view === "myLibrary") STATE.meTab = STATE.meTab || "saved";
  const tab = STATE.meTab || "overview";
  const s = Store.getSession();
  const TABS = [["overview", "Overview"], ["saved", "Saved"], ["recent", "Recently used"], ["progress", "Progress"]];
  container.innerHTML = `
    <div class="section-title"><h2>${escapeHtml((s && s.name) || "Me")}</h2></div>
    <div class="seg" role="tablist">
      ${TABS.map(([k, l]) => `<button class="${tab === k ? "active" : ""}" data-metab="${k}">${l}</button>`).join("")}
    </div>
    <div id="me-body"></div>`;
  container.querySelectorAll("[data-metab]").forEach((b) => b.addEventListener("click", () => { STATE.meTab = b.dataset.metab; renderMeView(container); }));
  container.querySelectorAll("[data-nav]").forEach((b) => b.addEventListener("click", () => navigate(b.dataset.nav)));
  const body = container.querySelector("#me-body");
  if (tab === "overview") renderMeOverview(body);
  else if (tab === "saved") renderMeSaved(body);
  else if (tab === "recent") renderMeRecent(body);
  else renderMeProgress(body);
}
function savedItems() {
  const favs = Array.from(Store.getFavorites()).map(findPromptById).filter(Boolean);
  const favIds = new Set(favs.map((r) => r.id));
  const mine = Store.getMyPrompts().filter((r) => !favIds.has(r.id));
  return favs.concat(mine);
}
function renderMeOverview(body) {
  const prog = Store.getProgress();
  const favN = Store.getFavorites().size;
  const mineN = Store.getMyPrompts().length;
  const practiceN = prog.practice.length;
  const modN = Object.keys(prog.modulesTouched || {}).length;
  const recent = Store.getUsage().recent.map((r) => findPromptById(r.id)).filter(Boolean).slice(0, 6);
  body.innerHTML = `
    <div class="me-grid">
      <button class="me-stat" data-metab="saved" style="text-align:left;cursor:pointer;"><div class="num tabular">${favN + mineN}</div><div class="label">Saved & created</div></button>
      <div class="me-stat"><div class="num tabular">${practiceN}</div><div class="label">Practice attempts</div></div>
      <div class="me-stat"><div class="num tabular">${modN}</div><div class="label">Modules opened</div></div>
      <div class="me-stat"><div class="num tabular">${Object.keys(prog.learnedLessons || {}).length}</div><div class="label">Principles reviewed</div></div>
    </div>
    <div class="section-title"><h2>Jump back in</h2></div>
    <div class="mini-list" style="margin-bottom:8px;">
      ${recent.length ? recent.map((r) => `<div class="mini-item" data-id="${r.id}" role="button" tabindex="0"><span class="mini-item-title">${escapeHtml(r.title)}</span><span class="chip">${escapeHtml(r.category)}</span></div>`).join("")
        : `<div class="empty-mini">Prompts you use will appear here for quick access.</div>`}
    </div>`;
  body.querySelectorAll("[data-id]").forEach((el) => el.addEventListener("click", () => openDetail(el.dataset.id)));
  body.querySelectorAll("[data-metab]").forEach((el) => el.addEventListener("click", () => { STATE.meTab = el.dataset.metab; renderMeView(document.getElementById("content")); }));
}
function renderMeSaved(body) {
  const filter = STATE.savedFilter || "all";
  const all = savedItems();
  const isMine = (r) => r.source === "User Created" || r.source === "Modified" || r.source === "Optimized" || String(r.id).startsWith("my-");
  let items = all;
  if (filter === "library") items = all.filter((r) => !isMine(r));
  else if (filter === "mine") items = all.filter(isMine);
  const mine = Store.getMyPrompts();
  body.innerHTML = `
    <div style="display:flex;align-items:center;gap:10px;flex-wrap:wrap;margin-bottom:6px;">
      <div class="seg" style="margin-bottom:0;">
        <button class="${filter === "all" ? "active" : ""}" data-sf="all">All (${all.length})</button>
        <button class="${filter === "library" ? "active" : ""}" data-sf="library">From library</button>
        <button class="${filter === "mine" ? "active" : ""}" data-sf="mine">My prompts</button>
      </div>
      <div class="spacer" style="flex:1;"></div>
      ${mine.length ? `<button class="btn btn-sm btn-ghost" id="export-btn">${icon("download")} Export</button>` : ""}
    </div>
    <div id="saved-list"></div>`;
  body.querySelectorAll("[data-sf]").forEach((b) => b.addEventListener("click", () => { STATE.savedFilter = b.dataset.sf; renderMeSaved(body); }));
  const exportBtn = body.querySelector("#export-btn");
  if (exportBtn) exportBtn.addEventListener("click", () => openExportModal());
  const target = body.querySelector("#saved-list");
  if (!items.length) {
    target.innerHTML = emptyStateHtml("star", "Nothing saved yet",
      filter === "mine" ? "Create a prompt or save an improved version of one from the library." : "Tap the star on any prompt to keep it here.",
      `<button class="btn btn-primary btn-sm" style="margin-top:8px" data-nav="search">${icon("search")} Browse the library</button>`);
    target.querySelectorAll("[data-nav]").forEach((b) => b.addEventListener("click", () => navigate(b.dataset.nav)));
    return;
  }
  target.innerHTML = `<div class="result-count">${items.length} item${items.length === 1 ? "" : "s"}</div><div id="saved-list-inner"></div>`;
  renderPaginatedList(target.querySelector("#saved-list-inner"), items, { showSource: true });
}
function renderMeRecent(body) {
  const recent = Store.getUsage().recent.map((r) => ({ rec: findPromptById(r.id), ts: r.ts, action: r.action })).filter((x) => x.rec);
  if (!recent.length) { body.innerHTML = emptyStateHtml("clock", "Nothing here yet", "Prompts you open, copy, or use show up here."); return; }
  body.innerHTML = `<div class="result-count">${recent.length} recent action${recent.length === 1 ? "" : "s"}</div>` +
    `<div class="results-list">` + recent.map(({ rec, ts, action }) => `
      <div class="mini-item" style="padding:10px 12px; border:1px solid var(--border); border-radius:var(--radius-sm); background:var(--surface);" data-id="${rec.id}" role="button" tabindex="0">
        <span class="chip">${escapeHtml(action)}</span>
        <span class="mini-item-title" style="font-weight:500;">${escapeHtml(rec.title)}</span>
        <span style="color:var(--text-faint); font-size:11.5px; flex:none;">${timeAgo(ts)}</span>
      </div>`).join("") + `</div>`;
  body.querySelectorAll("[data-id]").forEach((el) => el.addEventListener("click", () => openDetail(el.dataset.id)));
}
function renderMeProgress(body) {
  const prog = Store.getProgress();
  const sc = currentScope();
  const progs = (sc && sc.programs && sc.programs.length) ? sc.programs : (sc && sc.program ? [sc.program] : []);
  let html = "";
  if (progs.length) {
    html += progs.map((p) => {
      const mods = p.modules || [];
      const touched = mods.filter((m) => prog.modulesTouched[m.id]).length;
      const pct = mods.length ? Math.round((touched / mods.length) * 100) : 0;
      return `<div class="program-header" style="margin-bottom:14px;">
        <h2 style="font-size:15px;">${escapeHtml(p.name)}</h2>
        <div class="progress-track"><i style="width:${pct}%"></i></div>
        <div style="font-size:11.5px;color:var(--text-faint);margin-top:6px;">${touched} of ${mods.length} modules opened${pct ? " · " + pct + "%" : ""}</div>
        <button class="btn btn-sm" data-nav="program" style="margin-top:10px;">Open program</button>
      </div>`;
    }).join("");
  }
  const lessonsDone = Object.keys(prog.learnedLessons || {}).length;
  const totalLessons = (typeof LESSONS !== "undefined") ? LESSONS.length : 5;
  html += `<div class="program-header" style="margin-bottom:14px;">
      <h2 style="font-size:15px;">Prompt-writing principles</h2>
      <div class="progress-track"><i style="width:${Math.round((lessonsDone / totalLessons) * 100)}%"></i></div>
      <div style="font-size:11.5px;color:var(--text-faint);margin-top:6px;">${lessonsDone} of ${totalLessons} reviewed</div>
      <button class="btn btn-sm" data-nav="learn" style="margin-top:10px;">Go to Learn</button>
    </div>`;
  if (typeof FRAMEWORK !== "undefined") {
    const fwp = Store.getFrameworkProgress();
    html += `<div class="program-header" style="margin-bottom:14px;">
      <h2 style="font-size:15px;">Prompt Framework</h2>
      ${FRAMEWORK.levels.map((L) => {
        const p = frameworkLevelPct(L.level);
        const best = (fwp.best || {})[L.level];
        return `<div style="display:flex;align-items:center;gap:10px;margin-top:8px;">
          <span style="font-family:var(--font-mono);font-size:11px;min-width:132px;color:var(--text-muted);">Level ${L.level} · ${escapeHtml(L.code)}</span>
          <span class="progress-track" style="flex:1;margin-top:0;"><i style="width:${p}%"></i></span>
          <span style="font-size:11px;font-family:var(--font-mono);color:var(--text-faint);width:34px;text-align:right;">${p}%</span>
          ${best != null ? `<span class="chip" style="flex:none;" title="Best practice score">best ${best}</span>` : ""}
        </div>`;
      }).join("")}
      <div style="font-size:11.5px;color:var(--text-faint);margin-top:8px;">${Object.keys(fwp.comps || {}).length} component${Object.keys(fwp.comps || {}).length === 1 ? "" : "s"} understood · ${(fwp.attempts || []).length} framework practice attempt${(fwp.attempts || []).length === 1 ? "" : "s"}</div>
      <button class="btn btn-sm" data-fw-goto="1" style="margin-top:10px;">Open Prompt Framework</button>
    </div>`;
  }
  const hist = prog.practice.slice(0, 8);
  html += `<div class="section-title" style="margin-top:8px;"><h2>Practice history</h2><button class="btn btn-sm" data-nav="practice">Practice</button></div>`;
  html += hist.length ? `<div class="results-list">${hist.map((h) => `
      <div class="mini-item" style="border:1px solid var(--border);border-radius:var(--radius-sm);padding:8px 12px;">
        <span class="quality-pill ${qualityClass(h.overall)}"><span class="quality-bar"><i style="width:${h.overall}%"></i></span>${h.overall}</span>
        <span class="mini-item-title">${escapeHtml(h.scenarioTitle || "Practice attempt")}</span>
        <span style="color:var(--text-faint);font-size:11px;flex:none;">${timeAgo(h.ts)}</span></div>`).join("")}</div>`
    : `<div class="empty-mini">No practice attempts yet — try one in Practice.</div>`;
  body.innerHTML = html;
  body.querySelectorAll("[data-nav]").forEach((b) => b.addEventListener("click", () => navigate(b.dataset.nav)));
  body.querySelectorAll("[data-fw-goto]").forEach((b) => b.addEventListener("click", () => { STATE.frameworkLevel = parseInt(b.dataset.fwGoto, 10) || 1; navigate("framework"); }));
}

/* ---------- Governance / Insights ---------- */
function renderInsightsView(container) {
  const tab = STATE.insightsTab || "overview";
  container.innerHTML = `
    <div class="tabs">
      <button class="tab-btn ${tab === "overview" ? "active" : ""}" data-tab="overview">Overview</button>
      <button class="tab-btn ${tab === "lifecycle" ? "active" : ""}" data-tab="lifecycle">Lifecycle</button>
      <button class="tab-btn ${tab === "duplicates" ? "active" : ""}" data-tab="duplicates">Duplicates</button>
      <button class="tab-btn ${tab === "review" ? "active" : ""}" data-tab="review">Needs Review</button>
    </div>
    <div id="insights-body"></div>`;
  container.querySelectorAll("[data-tab]").forEach((b) => b.addEventListener("click", () => { STATE.insightsTab = b.dataset.tab; renderInsightsView(container); }));
  const body = container.querySelector("#insights-body");
  if (tab === "overview") renderInsightsOverview(body);
  else if (tab === "lifecycle") renderInsightsLifecycle(body);
  else if (tab === "duplicates") renderInsightsDuplicates(body);
  else renderInsightsReview(body);
}
function renderInsightsOverview(body) {
  const lib = ALL_PROMPTS;
  const withVars = lib.filter((r) => r.isTemplate).length;
  const needsReview = lib.filter((r) => r.healthStatus === "Review" || r.healthStatus === "Needs Improvement").length;
  const avgQ = Math.round(lib.reduce((s, r) => s + r.qualityScore, 0) / lib.length);
  const diffCounts = { Beginner: 0, Intermediate: 0, Advanced: 0 };
  lib.forEach((r) => diffCounts[r.difficulty]++);
  const catCounts = CATEGORIES.slice().sort((a, b) => b.count - a.count).slice(0, 8);
  const maxCat = Math.max(...catCounts.map((c) => c.count));
  const mostReusable = lib.slice().sort((a, b) => b.qualityBreakdown.reusability - a.qualityBreakdown.reusability).slice(0, 8);
  body.innerHTML = `
    <div class="stat-grid">
      <div class="stat-tile"><div class="num tabular">${lib.length.toLocaleString()}</div><div class="label">Central prompts (never mutated)</div></div>
      <div class="stat-tile"><div class="num tabular">${CATEGORIES.length}</div><div class="label">Categories</div></div>
      <div class="stat-tile"><div class="num tabular">${withVars.toLocaleString()}</div><div class="label">Reusable templates</div></div>
      <div class="stat-tile"><div class="num tabular">${avgQ}</div><div class="label">Avg. quality score</div></div>
      <div class="stat-tile"><div class="num tabular">${needsReview.toLocaleString()}</div><div class="label">Flagged for review</div></div>
      <div class="stat-tile"><div class="num tabular">${Store.getMyPrompts().length}</div><div class="label">Your saved / created</div></div>
    </div>
    <div class="section-title"><h2>Difficulty spread</h2></div>
    <div style="margin-bottom:26px;">${Object.entries(diffCounts).map(([k, n]) => `<div class="bar-row"><span class="bar-label">${k}</span><span class="bar-track"><i style="width:${(n / lib.length) * 100}%"></i></span><span class="bar-val tabular">${n}</span></div>`).join("")}</div>
    <div class="section-title"><h2>Top categories</h2></div>
    <div style="margin-bottom:26px;">${catCounts.map((c) => `<div class="bar-row"><span class="bar-label">${escapeHtml(c.name)}</span><span class="bar-track"><i style="width:${(c.count / maxCat) * 100}%"></i></span><span class="bar-val tabular">${c.count}</span></div>`).join("")}</div>
    <div class="section-title"><h2>Most reusable prompts</h2></div>
    <div id="reusable-list"></div>`;
  renderPaginatedList(body.querySelector("#reusable-list"), mostReusable, {});
}
function renderInsightsLifecycle(body) {
  const stages = ["Draft", "Review", "Curated", "Recommended", "Archived"];
  const all = ALL_PROMPTS.concat(Store.getMyPrompts());
  const buckets = {}; stages.forEach((s) => (buckets[s] = []));
  all.forEach((r) => { (buckets[r.lifecycle] || (buckets[r.lifecycle] = [])).push(r); });
  STATE.lcStage = STATE.lcStage || "Recommended";
  body.innerHTML = `
    <p class="prose" style="color:var(--text-muted);max-width:640px;margin-bottom:14px;">Every prompt carries a lifecycle stage: <b>Draft → Review → Curated → Recommended → Archived</b>. Stages are derived from quality, flags and program links. Source prompts are never deleted — weak or outdated ones are archived, and stay visible here.</p>
    <div class="lifecycle-legend">
      ${stages.map((s) => `<button class="lc-badge lc-${s}" data-stage="${s}" style="border:1px solid ${STATE.lcStage === s ? "var(--accent)" : "transparent"};">${s} · ${(buckets[s] || []).length}</button>`).join("")}
    </div>
    <div id="lc-list"></div>`;
  body.querySelectorAll("[data-stage]").forEach((b) => b.addEventListener("click", () => { STATE.lcStage = b.dataset.stage; renderInsightsLifecycle(body); }));
  const list = (buckets[STATE.lcStage] || []).slice().sort((a, b) => b.qualityScore - a.qualityScore);
  const target = body.querySelector("#lc-list");
  target.innerHTML = `<div class="result-count">${list.length.toLocaleString()} prompt${list.length === 1 ? "" : "s"} at stage “${STATE.lcStage}”</div><div id="lc-list-inner"></div>`;
  renderPaginatedList(target.querySelector("#lc-list-inner"), list, { showSource: true });
}
function renderInsightsDuplicates(body) {
  const groups = {};
  ALL_PROMPTS.forEach((r) => { if (r.duplicateGroup) (groups[r.duplicateGroup] = groups[r.duplicateGroup] || []).push(r); });
  const groupList = Object.values(groups).sort((a, b) => b.length - a.length);
  if (!groupList.length) { body.innerHTML = emptyStateHtml("layers", "No duplicate groups found", ""); return; }
  body.innerHTML = `<div class="result-count">${groupList.length} groups of duplicate or near-duplicate prompts — nothing is deleted; review and pick the best.</div>` +
    groupList.slice(0, 60).map((g) => `
      <div class="dup-group">
        <div class="dup-group-head">${icon("layers")} ${g.length} similar prompts · ${escapeHtml(g[0].category)}</div>
        ${g.map((r) => `<div class="mini-item" data-id="${r.id}" role="button" tabindex="0" style="padding:6px 4px;">${renderQualityPill(r.qualityScore)}<span class="mini-item-title">${escapeHtml(r.title)}</span></div>`).join("")}
      </div>`).join("");
  body.querySelectorAll("[data-id]").forEach((el) => el.addEventListener("click", () => openDetail(el.dataset.id)));
}
function renderInsightsReview(body) {
  const items = ALL_PROMPTS.filter((r) => r.healthStatus === "Review" || r.healthStatus === "Needs Improvement").sort((a, b) => a.qualityScore - b.qualityScore);
  body.innerHTML = `<div class="result-count">${items.length.toLocaleString()} prompts flagged — vague objectives, outdated tool references, missing context, or embedded metadata. Nothing is hidden or removed.</div><div id="review-list"></div>`;
  renderPaginatedList(body.querySelector("#review-list"), items, {});
}

/* ---------- Prompt Builder ---------- */
const BUILDER_QUESTIONS = [
  { key: "objective", q: "What do you want AI to accomplish?", ph: "e.g. Draft a follow-up email after a sales demo", type: "textarea" },
  { key: "role", q: "Who should the AI act as?", ph: "e.g. An experienced B2B sales rep", type: "text" },
  { key: "context", q: "What context does it need?", ph: "e.g. Mid-market SaaS, the prospect saw a demo yesterday and went quiet", type: "textarea" },
  { key: "inputs", q: "What information will you provide?", ph: "e.g. Prospect name, company, key objection raised", type: "textarea" },
  { key: "constraints", q: "What constraints matter?", ph: "e.g. Under 150 words, no pressure tactics, friendly tone", type: "textarea" },
  { key: "outputFormat", q: "What should the output look like?", ph: "e.g. A ready-to-send email with a subject line", type: "textarea" },
];
function newBuilderState() { return { mode: null, step: 0, answers: {}, generated: null }; }
/* Which questions this builder run asks. Framework mode drives the fields
   straight off the selected level's components; freeform keeps the original
   6-step flow so advanced users aren't boxed in. */
function builderQuestions(b) {
  if (b.mode === "fw" && typeof FRAMEWORK !== "undefined") {
    return fwLevel(b.level).componentKeys.map((k) => {
      const c = fwComp(k);
      return { key: k + "_" + fwLevel(b.level).componentKeys.indexOf(k), compKey: k, q: c.builderLabel, ph: c.builderPlaceholder, type: c.builderType || "textarea" };
    });
  }
  return BUILDER_QUESTIONS;
}
function builderPathLabel(b) {
  if (b.mode === "fw" && typeof FRAMEWORK !== "undefined") return "Level " + b.level + " · " + fwLevel(b.level).code;
  return "Goal → Role → Context → Inputs → Constraints → Output";
}
function renderBuilderChooser(container) {
  container.innerHTML = `
    <div class="builder-card" style="max-width:640px;">
      <div class="builder-question">How do you want to build this prompt?</div>
      <p class="prose" style="color:var(--text-muted);margin:6px 0 18px;">Use the Prompt Framework for guided, structured fields — or write it yourself.</p>
      <div class="fw-levels" style="margin-bottom:18px;">
        ${(typeof FRAMEWORK !== "undefined" ? FRAMEWORK.levels : []).map((L) => `
          <button class="fw-level-row" data-bmode="fw" data-blevel="${L.level}">
            <span class="fw-level-code">${escapeHtml(L.code)}</span>
            <span class="fw-level-meta"><b>Level ${L.level} · ${escapeHtml(L.name)}</b><span>${escapeHtml(L.tagline)}</span></span>
            ${icon("chevronRight")}
          </button>`).join("")}
      </div>
      <button class="btn" data-bmode="free">${icon("build")} Write it myself (6 open questions)</button>
    </div>`;
  container.querySelectorAll("[data-bmode]").forEach((el) => el.addEventListener("click", () => {
    STATE.builder = { mode: el.dataset.bmode, level: el.dataset.blevel ? parseInt(el.dataset.blevel, 10) : null, step: 0, answers: {}, generated: null };
    renderBuilderView(container);
  }));
}
function renderBuilderView(container) {
  if (!STATE.builder) STATE.builder = newBuilderState();
  const b = STATE.builder;
  if (!b.mode) { renderBuilderChooser(container); return; }
  if (b.generated) { renderBuilderResult(container); return; }
  const QS = builderQuestions(b);
  const total = QS.length;
  const step = Math.min(b.step, total - 1);
  const qn = QS[step];
  container.innerHTML = `
    <div class="builder-card">
      <button class="btn btn-ghost btn-sm" id="builder-mode-back" style="margin-bottom:10px;">← Change approach</button>
      <div class="builder-steps">${QS.map((_, i) => `<div class="builder-step-dot ${i < step ? "done" : i === step ? "active" : ""}"></div>`).join("")}</div>
      <div style="font-size:11.5px; color:var(--text-faint); margin-bottom:6px;">Step ${step + 1} of ${total} · ${escapeHtml(builderPathLabel(b))}</div>
      <div class="builder-question">${escapeHtml(qn.q)}</div>
      <div class="form-field" style="margin-top:16px;">
        ${qn.type === "textarea"
          ? `<textarea id="builder-input" rows="4" placeholder="${escapeHtml(qn.ph)}">${escapeHtml(b.answers[qn.key] || "")}</textarea>`
          : `<input type="text" id="builder-input" placeholder="${escapeHtml(qn.ph)}" value="${escapeHtml(b.answers[qn.key] || "")}"/>`}
        <div class="form-hint">Optional — leave blank and the generator keeps it general.</div>
      </div>
      <div class="builder-nav">
        <button class="btn" id="builder-back" ${step === 0 ? "disabled" : ""}>Back</button>
        <button class="btn btn-primary" id="builder-next">${step === total - 1 ? "Generate prompt" : "Next"}</button>
      </div>
    </div>`;
  const input = container.querySelector("#builder-input");
  input.focus();
  input.addEventListener("input", () => { b.answers[qn.key] = input.value; });
  container.querySelector("#builder-mode-back").addEventListener("click", () => { STATE.builder = newBuilderState(); renderBuilderView(container); });
  container.querySelector("#builder-back").addEventListener("click", () => { b.answers[qn.key] = input.value; b.step = Math.max(0, step - 1); renderBuilderView(container); });
  container.querySelector("#builder-next").addEventListener("click", async () => {
    b.answers[qn.key] = input.value;
    if (step === total - 1) { await generateBuilderPrompt(); renderBuilderView(container); }
    else { b.step = step + 1; renderBuilderView(container); }
  });
}
function assembleFrameworkBuilderPrompt(b) {
  const L = fwLevel(b.level);
  const lines = [];
  L.componentKeys.forEach((k, i) => {
    const v = (b.answers[k + "_" + i] || "").trim();
    if (v) lines.push(fwComp(k).assemble(v));
  });
  return lines.length ? lines.join("\n") : "[Fill in at least one field to generate a prompt.]";
}
function assembleBuilderPrompt(a) {
  const lines = [];
  if (a.role) lines.push(`Role: Act as ${a.role}.`);
  if (a.objective) lines.push(`Objective: ${a.objective}`);
  if (a.context) lines.push(`Context: ${a.context}`);
  if (a.inputs) lines.push(`Inputs I'll provide: ${a.inputs}`);
  if (a.constraints) lines.push(`Constraints: ${a.constraints}`);
  if (a.outputFormat) lines.push(`Output format: ${a.outputFormat}`);
  if (!a.outputFormat) lines.push(`Output format: Respond in clear, well-structured sections.`);
  return lines.join("\n");
}
async function generateBuilderPrompt() {
  const b = STATE.builder;
  const fw = b.mode === "fw";
  b.generated = { text: fw ? assembleFrameworkBuilderPrompt(b) : assembleBuilderPrompt(b.answers), method: "auto-structured" };
  if (Store.hasSample()) {
    try {
      const instructions = fw
        ? `You write high-quality prompts using the "${fwLevel(b.level).code}" framework (${fwLevel(b.level).componentKeys.map((k) => fwComp(k).name).join(", ")}). Turn these answers into ONE polished prompt the user can paste into any AI tool. Keep every framework section the user filled in, in that order, labelled. Keep their intent exactly — invent nothing. Respond with ONLY the finished prompt.\n\n` +
          fwLevel(b.level).componentKeys.map((k, i) => [fwComp(k).name, (b.answers[k + "_" + i] || "").trim()]).filter(([, v]) => v).map(([n, v]) => `${n}: ${v}`).join("\n")
        : `You write high-quality, reusable AI prompts. Given these answers to a prompt-building questionnaire, write ONE polished prompt the user can paste into any AI tool. Keep their intent exactly — do not invent new requirements. Respond with ONLY the finished prompt text, no preamble.\n\n` +
          Object.entries(b.answers).filter(([, v]) => v).map(([k, v]) => `${k}: ${v}`).join("\n");
      const res = await Store.sample(instructions, { modelTier: "quick" });
      if (res && res.text && res.text.trim()) b.generated = { text: res.text.trim(), method: "ai-generated" };
    } catch (e) {}
  }
}
function builderTitleGuess(b) {
  if (b.mode === "fw") {
    const L = fwLevel(b.level);
    const taskIdx = L.componentKeys.indexOf("task");
    const t = (b.answers["task_" + taskIdx] || "").trim();
    return t ? truncate(t, 60) : "Framework prompt (Level " + b.level + ")";
  }
  return b.answers.objective ? truncate(b.answers.objective, 60) : "Custom built prompt";
}
function renderBuilderResult(container) {
  const b = STATE.builder;
  const fw = b.mode === "fw";
  const scored = scorePromptText("Custom prompt", b.generated.text);
  const why = [];
  if (fw) {
    const L = fwLevel(b.level);
    const filled = L.componentKeys.filter((k, i) => (b.answers[k + "_" + i] || "").trim());
    why.push(`Follows the ${L.code} framework — ${filled.map((k) => fwComp(k).name).join(", ") || "no sections filled yet"}.`);
    if (filled.includes("verification")) why.push("Includes a self-check step, so the AI reviews its own work before you rely on it.");
    if (filled.includes("validation")) why.push("Asks the AI to pressure-test the result against the real situation.");
    why.push("Each section is labelled, so nothing gets lost in a run-on instruction.");
  } else {
    if (b.answers.role) why.push("Opens with a role, so the model answers from the right perspective.");
    if (b.answers.context) why.push("States the context up front instead of leaving the model to guess.");
    why.push("Separates objective, inputs, constraints and output so nothing gets lost in a run-on sentence.");
    if (!b.answers.outputFormat) why.push("Adds a default output instruction since you didn't specify one.");
  }
  container.innerHTML = `
    <div class="builder-card" style="max-width:720px;">
      <div class="section-title"><h2>Your generated prompt</h2>
        <span style="display:flex;gap:6px;">${fw ? `<span class="chip">Level ${b.level} · ${escapeHtml(fwLevel(b.level).code)}</span>` : ""}<span class="chip ${b.generated.method === "ai-generated" ? "chip-accent" : ""}">${b.generated.method === "ai-generated" ? "Generated by Claude" : "Auto-structured"}</span></span>
      </div>
      <div class="block-header"><span class="label">Prompt</span>${renderQualityPill(scored.score)}</div>
      <div class="prompt-block" id="builder-generated-text">${escapeHtml(b.generated.text)}</div>
      <div class="detail-section" style="margin-top:14px;">
        <h3>Why this is effective</h3>
        <div class="why-list">${why.map((w) => `<div class="why-item">${icon("check")}<span>${escapeHtml(w)}</span></div>`).join("")}</div>
      </div>
      <div style="display:flex; gap:8px; flex-wrap:wrap;">
        <button class="btn" id="builder-copy">${icon("copy")} Copy</button>
        <button class="btn" id="builder-test">${icon("beaker")} Try</button>
        <button class="btn btn-primary" id="builder-save">${icon("plus")} Save to My Library</button>
        <button class="btn btn-ghost" id="builder-restart">Start over</button>
      </div>
    </div>`;
  container.querySelector("#builder-copy").addEventListener("click", async () => { const ok = await copyText(b.generated.text); showToast(ok ? "Copied prompt text" : "Couldn't copy"); });
  container.querySelector("#builder-restart").addEventListener("click", () => { STATE.builder = newBuilderState(); renderBuilderView(container); });
  container.querySelector("#builder-save").addEventListener("click", () => {
    const rec = buildMyPromptRecord({ title: builderTitleGuess(b), originalPrompt: b.generated.text, category: guessCategory(builderTitleGuess(b), b.generated.text), source: "User Created" });
    Store.saveMyPrompt(rec);
    showToast("Saved to your prompts");
    renderSidebarFooter();
    STATE.builder = newBuilderState();
    STATE.meTab = "saved"; STATE.savedFilter = "mine";
    navigate("me");
  });
  container.querySelector("#builder-test").addEventListener("click", () => openTestModal({ id: "builder-draft", title: "Custom built prompt", originalPrompt: b.generated.text }));
}

/* ---------- Detail drawer ---------- */
function relatedPrompts(rec, n) {
  n = n || 5;
  const corpus = getSearchCorpus().filter((r) => r.id !== rec.id);
  const recTags = new Set((rec.tags || []).map((t) => t.toLowerCase()));
  const scored = corpus.map((r) => {
    let s = 0;
    if (r.category === rec.category) s += 3;
    if (r.skill === rec.skill) s += 2;
    if (r.promptType === rec.promptType) s += 2;
    if (r.difficulty === rec.difficulty) s += 0.5;
    const shared = (r.tags || []).filter((t) => recTags.has(t.toLowerCase())).length;
    s += shared * 1.6;
    s += (r.qualityScore || 0) * 0.01;
    return [s, r];
  }).filter((x) => x[0] > 0);
  scored.sort((a, b) => b[0] - a[0]);
  return scored.slice(0, n).map((x) => x[1]);
}
function openDetail(id) {
  const rec = findPromptById(id);
  if (!rec) return;
  STATE.detailId = id;
  STATE.detailLayer = "original";
  Store.recordUsage(id, "opened");
  renderDrawer(rec);
}
function closeDetail() {
  const overlay = document.getElementById("detail-overlay");
  const drawer = document.getElementById("detail-drawer");
  if (overlay) overlay.classList.remove("show");
  if (drawer) drawer.classList.remove("show");
  STATE.detailId = null;
  setTimeout(() => { const r = document.getElementById("drawer-root"); if (r) r.innerHTML = ""; }, 200);
}
function renderDrawer(rec) {
  const root = document.getElementById("drawer-root");
  const isFav = Store.isFavorite(rec.id);
  root.innerHTML = `
    <div class="overlay" id="detail-overlay"></div>
    <div class="drawer" id="detail-drawer" role="dialog" aria-modal="true" aria-label="${escapeHtml(rec.title)}">
      <div class="drawer-header">
        <h2>${escapeHtml(rec.title)}</h2>
        <button class="fav-btn ${isFav ? "is-fav" : ""}" id="drawer-fav" title="Favorite (F)">${isFav ? icon("starFilled") : icon("star")}</button>
        <button class="drawer-close" id="drawer-close" aria-label="Close (Esc)">${icon("x")}</button>
      </div>
      <div class="drawer-body" id="drawer-body"></div>
    </div>`;
  const body = root.querySelector("#drawer-body");
  body.innerHTML = detailBodyHtml(rec);
  requestAnimationFrame(() => {
    const ov = root.querySelector("#detail-overlay");
    const dr = root.querySelector("#detail-drawer");
    if (ov) ov.classList.add("show");
    if (dr) dr.classList.add("show");
  });
  root.querySelector("#detail-overlay").addEventListener("click", closeDetail);
  root.querySelector("#drawer-close").addEventListener("click", closeDetail);
  root.querySelector("#drawer-fav").addEventListener("click", () => {
    if (typeof blockIfLocked === "function" && blockIfLocked("prompt.save")) return;
    const now = Store.toggleFavorite(rec.id);
    const btn = root.querySelector("#drawer-fav");
    btn.classList.toggle("is-fav", now);
    btn.innerHTML = now ? icon("starFilled") : icon("star");
    showToast(now ? "Added to favorites" : "Removed from favorites");
    renderSidebarFooter();
  });
  wireDetailBody(body, rec);
}
function currentLayerText(rec) {
  const imp = Store.getImprovement(rec.id);
  const mine = Store.getMyPrompt(rec.id);
  if (STATE.detailLayer === "optimized" && imp) return imp.improvedPrompt;
  if (STATE.detailLayer === "learner" && mine) return mine.originalPrompt;
  return rec.originalPrompt;
}
function detailBodyHtml(rec) {
  const flags = rec.flags || {};
  const imp = Store.getImprovement(rec.id);
  const mine = Store.getMyPrompt(rec.id);
  const related = relatedPrompts(rec);
  const modelNotes = [];
  if (flags.modelSpecific) modelNotes.push("Model-specific");
  if (flags.containsWebSearch) modelNotes.push("Contains web-search instruction");
  if (flags.containsInteractiveQuestioning) modelNotes.push("Contains interactive questioning");
  if (flags.incompleteTitle) modelNotes.push("Source title looks incomplete");

  const layers = [["original", "Original", true], ["optimized", "Optimized", !!imp], ["learner", "Learner version", !!mine]];
  const activeLayer = STATE.detailLayer || "original";
  const layerText = currentLayerText(rec);

  const shownLayers = layers.filter((l) => l[2]);
  return `
    ${rec.sensitiveCategory ? `<div class="sensitive-note">${icon("alert")}<div>This is a ${escapeHtml(rec.category)} prompt. Treat any output as a starting draft — have a qualified professional review anything used for real decisions.</div></div>` : ""}
    <div class="detail-meta-row">
      <span class="chip">${escapeHtml(rec.category)}</span>
      ${renderDifficulty(rec.difficulty)}
      ${rec.isTemplate ? `<span class="chip" title="${(rec.variables || []).length} fill-in field${(rec.variables || []).length === 1 ? "" : "s"}">Template</span>` : ""}
      ${typeof fwLevelBadge === "function" ? fwLevelBadge(rec) : ""}
      ${rec.source && rec.source !== "Original Library" ? `<span class="chip chip-accent">${escapeHtml(rec.source === "Modified" || rec.source === "Optimized" ? "My version" : rec.source)}</span>` : ""}
    </div>

    <div class="detail-section" style="margin-bottom:14px;"><h3>What it does</h3><div class="prose">${escapeHtml(rec.description)}</div></div>

    <div class="detail-hero-actions">
      <button class="btn-use" id="btn-use">${icon("sparkle")} ${rec.isTemplate ? "Use this prompt — fill in & copy" : "Use this prompt"}</button>
      <div class="detail-secondary">
        <button class="btn" id="btn-copy">${icon("copy")} Copy</button>
        <button class="btn" id="btn-improve">${icon("wand")} ${flags.modelSpecific ? "Modernize" : "Improve"}</button>
        <button class="btn" id="btn-test">${icon("beaker")} Try it</button>
      </div>
    </div>

    ${rec.outcome && rec.outcome !== "Not specified" ? `<div class="detail-outcome">${icon("check")}<div><b>What you'll get:</b> ${escapeHtml(rec.outcome)}</div></div>` : ""}

    <div class="detail-section">
      ${shownLayers.length > 1 ? `<div class="layer-tabs">${shownLayers.map((l) => `<button class="layer-tab ${activeLayer === l[0] ? "active" : ""}" data-layer="${l[0]}">${l[1]}</button>`).join("")}</div>` : ""}
      <div class="block-header">
        <span class="label">${activeLayer === "original" ? "Prompt text" : activeLayer === "optimized" ? "Optimized version" : "Your version"}</span>
        ${activeLayer === "optimized" && imp ? `<span class="chip ${imp.method === "ai-generated" ? "chip-accent" : ""}">${imp.method === "ai-generated" ? "Generated by Claude" : "Auto-structured"}</span>` : ""}
        <button class="btn btn-sm" data-copy-layer>${icon("copy")} Copy</button>
      </div>
      <div class="prompt-block" id="layer-text">${escapeHtml(layerText)}</div>
      ${rec.isTemplate ? `<button class="btn btn-sm" id="customize-toggle" style="margin-top:8px;">${icon("slider")} Fill in the ${(rec.variables || []).length} field${(rec.variables || []).length === 1 ? "" : "s"}</button><div id="customize-panel" style="display:none; margin-top:12px;"></div>` : ""}
    </div>

    <details class="detail-expand">
      <summary>Details, quality &amp; why it works <span class="chev">${icon("chevronRight")}</span></summary>
      <div class="expand-body">
        <div class="detail-section"><h3>When to use it</h3><div class="prose">${escapeHtml(rec.whenToUse)}</div></div>
        <div class="detail-section"><h3>Why it works</h3><div class="why-list">${(rec.whyItWorks || []).map((w) => `<div class="why-item">${icon("check")}<span>${escapeHtml(w)}</span></div>`).join("")}</div></div>
        ${typeof FRAMEWORK !== "undefined" ? `<div class="detail-section"><h3>Framework fit</h3><div class="prose">${rec.frameworkLevel
          ? `This prompt is structured like a <b>Level ${rec.frameworkLevel}</b> prompt (${escapeHtml(fwLevel(rec.frameworkLevel).code)}). Detected components: ${(rec.frameworkComponents || []).map((k) => escapeHtml(fwComp(k).name)).join(", ") || "—"}.`
          : "This prompt doesn't yet follow the R-C-T-F framework — it's a good candidate to rebuild in <b>Practice</b> or the <b>Create Prompt</b> guided builder."}
          <button class="linklike" id="btn-fw-learn" style="display:block;margin-top:6px;background:none;border:none;color:var(--accent-strong);font-weight:600;padding:0;">Learn the Prompt Framework →</button></div></div>` : ""}
        <div class="detail-section" style="display:flex; gap:32px; flex-wrap:wrap;">
          <div><h3>Written for</h3><div class="prose">${escapeHtml(rec.role || "Any professional")}</div></div>
          <div><h3>Best for</h3><div class="prose">${escapeHtml(rec.useCase)}</div></div>
        </div>
        <div class="detail-section">
          <h3>Prompt quality</h3>
          <div class="quality-line" style="margin-bottom:10px;"><b>${rec.qualityScore}</b><span>/ 100 · how completely this prompt is written (clarity, context, specifics, output, reusability)</span></div>
          <div class="quality-breakdown">
            ${Object.entries(rec.qualityBreakdown || {}).map(([k, v]) => `<div class="qb-row"><span class="qb-label">${escapeHtml(breakdownLabel(k))}</span><span class="qb-bar"><i style="width:${v}%"></i></span><span class="qb-val tabular">${v}</span></div>`).join("")}
          </div>
          <div style="display:flex; gap:24px; margin-top:12px; flex-wrap:wrap;">
            <div style="flex:1; min-width:180px;"><div class="strengths-improvements">${(rec.strengths || []).map((s) => `<div class="si-item si-good">${icon("check")}<span>${escapeHtml(s)}</span></div>`).join("")}</div></div>
            <div style="flex:1; min-width:180px;"><div class="strengths-improvements">${(rec.improvements || []).map((s) => `<div class="si-item si-bad">${icon("alert")}<span>${escapeHtml(s)}</span></div>`).join("")}</div></div>
          </div>
        </div>
        <div class="detail-section" style="display:flex; gap:8px; flex-wrap:wrap;">
          <button class="btn btn-sm" id="btn-save-learner">${icon("plus")} Save my version</button>
          <button class="btn btn-sm" id="btn-versions">${icon("history")} Version history</button>
        </div>
        ${related.length ? `<div class="detail-section"><h3>Related prompts</h3><div class="related-grid">${related.map((r) => `<div class="mini-item" data-id="${r.id}" role="button" tabindex="0" style="border:1px solid var(--border); border-radius:var(--radius-sm); padding:8px 10px;"><span class="mini-item-title">${escapeHtml(r.title)}</span><span class="chip">${escapeHtml(r.category)}</span></div>`).join("")}</div></div>` : ""}
        ${modelNotes.length ? `<div class="detail-section"><h3>Notes</h3><div style="display:flex;gap:6px;flex-wrap:wrap;">${modelNotes.map((m) => `<span class="chip">${escapeHtml(m)}</span>`).join("")}</div></div>` : ""}
        <div class="provenance">${icon("link2")} ${escapeHtml(rec.source || "Original Library")}${rec.sourceNumber ? " · source #" + rec.sourceNumber : ""}${rec.version ? " · v" + rec.version : ""}</div>
      </div>
    </details>`;
}
function breakdownLabel(k) {
  return { clarity: "Clarity", context: "Context", specificity: "Specificity", outputDefinition: "Output Def.", reusability: "Reusability" }[k] || k;
}
/* The primary action. Templates open a fill-in sheet; plain prompts copy
   straight to the clipboard. Either way it's logged as real usage. */
async function usePrompt(rec) {
  if (rec.isTemplate && (rec.variables || []).length) { openUseModal(rec); return; }
  const ok = await copyText(currentLayerText(rec));
  Store.recordUsage(rec.id, "used");
  renderSidebarFooter();
  showToast(ok ? "Copied — paste it into your AI assistant" : "Couldn't copy — select the text and copy manually");
}
function openUseModal(rec) {
  const vars = rec.variablesRaw && rec.variablesRaw.length ? rec.variablesRaw : (rec.variables || []).map((v) => `[${v}]`);
  const base = currentLayerText(rec);
  const { root, close } = openModal(`
    <div class="modal-header"><h2>Use “${escapeHtml(truncate(rec.title, 48))}”</h2><button class="btn btn-icon btn-ghost" id="modal-close">${icon("x")}</button></div>
    <p class="prose" style="color:var(--text-muted);margin-bottom:12px;">Fill in what you can — anything you leave blank stays as a <code>[placeholder]</code> for you to edit later.</p>
    ${vars.map((v, i) => {
      const label = v.replace(/[\[\]{}<>]/g, "");
      return `<div class="form-field"><label>${escapeHtml(label)}</label><input type="text" data-var-raw="${escapeHtml(v)}" placeholder="Enter ${escapeHtml(label.toLowerCase())}…"/></div>`;
    }).join("")}
    <div class="block-header" style="margin-top:6px;"><span class="label">Preview</span></div>
    <div class="prompt-block" id="use-preview" style="max-height:240px;">${escapeHtml(base)}</div>
    <div style="display:flex; gap:8px; justify-content:flex-end; margin-top:14px;">
      <button class="btn" id="use-cancel">Cancel</button>
      <button class="btn btn-primary" id="use-copy">${icon("copy")} Copy prompt</button>
    </div>`);
  const inputs = root.querySelectorAll("[data-var-raw]");
  const preview = root.querySelector("#use-preview");
  function update() {
    let text = base;
    inputs.forEach((inp) => { if (inp.value.trim()) text = text.split(inp.dataset.varRaw).join(inp.value.trim()); });
    preview.textContent = text;
  }
  inputs.forEach((inp) => inp.addEventListener("input", update));
  root.querySelector("#modal-close").addEventListener("click", close);
  root.querySelector("#use-cancel").addEventListener("click", close);
  root.querySelector("#use-copy").addEventListener("click", async () => {
    const ok = await copyText(preview.textContent);
    Store.recordUsage(rec.id, "used");
    renderSidebarFooter();
    close();
    showToast(ok ? "Copied — paste it into your AI assistant" : "Couldn't copy");
  });
  if (inputs[0]) inputs[0].focus();
}
function wireDetailBody(body, rec) {
  body.querySelectorAll("[data-id]").forEach((el) => el.addEventListener("click", () => openDetail(el.dataset.id)));
  body.querySelectorAll("[data-layer]").forEach((b) => b.addEventListener("click", () => { STATE.detailLayer = b.dataset.layer; renderDrawer(rec); }));
  const useBtn = body.querySelector("#btn-use");
  if (useBtn) useBtn.addEventListener("click", () => usePrompt(rec));
  const copyBtn = body.querySelector("#btn-copy");
  if (copyBtn) copyBtn.addEventListener("click", async () => {
    const ok = await copyText(currentLayerText(rec));
    Store.recordUsage(rec.id, "copied");
    showToast(ok ? "Copied prompt text" : "Couldn't copy");
  });
  const copyLayer = body.querySelector("[data-copy-layer]");
  if (copyLayer) copyLayer.addEventListener("click", async () => {
    const ok = await copyText(currentLayerText(rec));
    Store.recordUsage(rec.id, "copied");
    showToast(ok ? "Copied prompt text" : "Couldn't copy");
  });
  const custToggle = body.querySelector("#customize-toggle");
  if (custToggle) custToggle.addEventListener("click", () => {
    const panel = body.querySelector("#customize-panel");
    const showing = panel.style.display !== "none";
    if (showing) { panel.style.display = "none"; return; }
    panel.style.display = "block";
    panel.innerHTML = customizePanelHtml(rec);
    wireCustomizePanel(panel, rec);
  });
  const fwLearnBtn = body.querySelector("#btn-fw-learn");
  if (fwLearnBtn) fwLearnBtn.addEventListener("click", () => {
    STATE.frameworkLevel = rec.frameworkLevel || 1;
    closeDetail();
    navigate("framework");
  });
  const improveBtn = body.querySelector("#btn-improve");
  if (improveBtn) improveBtn.addEventListener("click", () => openImproveModal(rec));
  const testBtn = body.querySelector("#btn-test");
  if (testBtn) testBtn.addEventListener("click", () => openTestModal(rec));
  const versionsBtn = body.querySelector("#btn-versions");
  if (versionsBtn) versionsBtn.addEventListener("click", () => openVersionsModal(rec));
  const saveLearner = body.querySelector("#btn-save-learner");
  if (saveLearner) saveLearner.addEventListener("click", () => {
    const existing = Store.getMyPrompt(rec.id);
    if (existing && rec.id === existing.id) { showToast("Already in your prompts"); STATE.meTab = "saved"; navigate("me"); return; }
    const newRec = buildMyPromptRecord({
      title: rec.title, originalPrompt: currentLayerText(rec), category: rec.category,
      role: rec.role, outcome: rec.outcome, source: "Modified", sourceId: rec.id, versionNote: "Saved from library",
    });
    Store.saveMyPrompt(newRec);
    showToast("Saved your own copy to My Library — the central prompt is untouched");
    renderSidebarFooter();
  });
}
function customizePanelHtml(rec) {
  const vars = rec.variablesRaw && rec.variablesRaw.length ? rec.variablesRaw : (rec.variables || []).map((v) => `[${v}]`);
  return `
    <div style="border:1px solid var(--border); border-radius:var(--radius); padding:14px; background:var(--surface-2);">
      ${vars.map((v, i) => {
        const label = v.replace(/[\[\]{}<>]/g, "");
        return `<div class="form-field"><label>${escapeHtml(label)}</label><input type="text" data-var-idx="${i}" data-var-raw="${escapeHtml(v)}" placeholder="Enter ${escapeHtml(label.toLowerCase())}…"/></div>`;
      }).join("")}
      <div class="block-header" style="margin-top:6px;"><span class="label">Preview</span></div>
      <div class="prompt-block" id="customize-preview" style="max-height:220px;">${escapeHtml(rec.originalPrompt)}</div>
      <button class="btn btn-primary btn-sm" id="copy-customized" style="margin-top:10px;">${icon("copy")} Copy customized prompt</button>
    </div>`;
}
function wireCustomizePanel(panel, rec) {
  const inputs = panel.querySelectorAll("[data-var-raw]");
  const preview = panel.querySelector("#customize-preview");
  function update() {
    let text = rec.originalPrompt;
    inputs.forEach((inp) => { if (inp.value.trim()) text = text.split(inp.dataset.varRaw).join(inp.value.trim()); });
    preview.textContent = text;
  }
  inputs.forEach((inp) => inp.addEventListener("input", update));
  panel.querySelector("#copy-customized").addEventListener("click", async () => {
    const ok = await copyText(preview.textContent);
    Store.recordUsage(rec.id, "copied");
    showToast(ok ? "Copied customized prompt" : "Couldn't copy");
  });
}
