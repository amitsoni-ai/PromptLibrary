/* ---------- Favorites / My Library ---------- */
function renderFavoritesView(container) {
  const tab = STATE.favoritesTab || "favorites";
  container.innerHTML = `
    <div class="tabs">
      <button class="tab-btn ${tab === "favorites" ? "active" : ""}" data-tab="favorites">Favorites</button>
      <button class="tab-btn ${tab === "recent" ? "active" : ""}" data-tab="recent">Recently Used</button>
    </div>
    <div id="fav-body"></div>`;
  container.querySelectorAll("[data-tab]").forEach((b) => b.addEventListener("click", () => { STATE.favoritesTab = b.dataset.tab; renderFavoritesView(container); }));
  const body = container.querySelector("#fav-body");
  if (tab === "favorites") {
    const items = Array.from(Store.getFavorites()).map(findPromptById).filter(Boolean);
    if (!items.length) body.innerHTML = emptyStateHtml("star", "No favorites yet", "Star a prompt anywhere and it collects here.");
    else { body.innerHTML = `<div class="result-count">${items.length} favorite${items.length === 1 ? "" : "s"}</div><div id="fav-list"></div>`; renderPaginatedList(body.querySelector("#fav-list"), items, { showSource: true }); }
  } else {
    const recent = Store.getUsage().recent.map((r) => ({ rec: findPromptById(r.id), ts: r.ts, action: r.action })).filter((x) => x.rec);
    if (!recent.length) body.innerHTML = emptyStateHtml("clock", "Nothing here yet", "Prompts you open, copy, or test show up here.");
    else body.innerHTML = `<div class="result-count">${recent.length} recent action${recent.length === 1 ? "" : "s"}</div>` +
      `<div class="results-list">` + recent.map(({ rec, ts, action }) => `
        <div class="mini-item" style="padding:10px 12px; border:1px solid var(--border); border-radius:var(--radius-sm); background:var(--surface);" data-id="${rec.id}" role="button" tabindex="0">
          <span class="chip">${escapeHtml(action)}</span>
          <span class="mini-item-title" style="font-weight:500;">${escapeHtml(rec.title)}</span>
          <span style="color:var(--text-faint); font-size:11.5px; flex:none;">${timeAgo(ts)}</span>
        </div>`).join("") + `</div>`;
    body.querySelectorAll("[data-id]").forEach((el) => el.addEventListener("click", () => openDetail(el.dataset.id)));
  }
}
function renderMyLibraryView(container) {
  const tab = STATE.myLibTab || "mine";
  const mine = Store.getMyPrompts();
  const favs = Array.from(Store.getFavorites()).map(findPromptById).filter(Boolean);
  const sc = currentScope();
  const scopeProgs = scopeProgramIds();
  const progIdSet = new Set();
  scopeProgs.forEach((pid) => programPromptIds(pid).forEach((id) => progIdSet.add(id)));
  const progIds = Array.from(progIdSet);
  container.innerHTML = `
    <div class="section-title">
      <h2>My Library</h2>
      <div style="display:flex; gap:8px;">
        ${mine.length ? `<button class="btn btn-sm btn-ghost" id="export-btn">${icon("download")} Export</button>` : ""}
        <button class="btn btn-sm btn-primary" onclick="openAddPrompt()">${icon("plus")} Add Prompt</button>
      </div>
    </div>
    <p class="prose" style="color:var(--text-muted);max-width:640px;margin-bottom:14px;">The central library and your program's picks stay read-only and versioned. Anything you save or create lives in <b>My Prompts</b> — your edits never touch a central prompt.</p>
    <div class="tabs">
      <button class="tab-btn ${tab === "mine" ? "active" : ""}" data-tab="mine">My Prompts <span class="nav-count">${mine.length}</span></button>
      <button class="tab-btn ${tab === "program" ? "active" : ""}" data-tab="program">Program Library <span class="nav-count">${progIds.length}</span></button>
      <button class="tab-btn ${tab === "favorites" ? "active" : ""}" data-tab="favorites">Favorites <span class="nav-count">${favs.length}</span></button>
      <button class="tab-btn ${tab === "central" ? "active" : ""}" data-tab="central">Central Library <span class="nav-count">${scopedLibrary().length}</span></button>
    </div>
    <div id="mylib-body"></div>`;
  container.querySelectorAll("[data-tab]").forEach((b) => b.addEventListener("click", () => { STATE.myLibTab = b.dataset.tab; renderMyLibraryView(container); }));
  const body = container.querySelector("#mylib-body");
  const exportBtn = container.querySelector("#export-btn");
  if (exportBtn) exportBtn.addEventListener("click", () => openExportModal());

  if (tab === "mine") {
    if (!mine.length) body.innerHTML = emptyStateHtml("folder", "No custom prompts yet", "Create one, or save an improved version of a library prompt.", `<button class="btn btn-primary btn-sm" style="margin-top:8px" onclick="openAddPrompt()">${icon("plus")} Add Prompt</button>`);
    else { body.innerHTML = `<div class="result-count">${mine.length} prompt${mine.length === 1 ? "" : "s"} · created prompts, saved variations and improved versions</div><div id="mine-list"></div>`; renderPaginatedList(body.querySelector("#mine-list"), mine, { showSource: true }); }
  } else if (tab === "program") {
    if (!scopeProgs.length) { body.innerHTML = emptyStateHtml("path", "No program attached", "Your code isn't linked to a program — see the Central Library tab."); return; }
    const recs = progIds.map(findPromptById).filter(Boolean).sort((a, b) => b.qualityScore - a.qualityScore);
    const progNames = scopeProgs.map((pid) => (ORG_INDEX.programs[pid] || {}).name).filter(Boolean).join(", ");
    body.innerHTML = `<div class="result-count">${recs.length} prompts recommended across ${escapeHtml(progNames)}</div><div id="prog-list"></div>`;
    renderPaginatedList(body.querySelector("#prog-list"), recs, {});
  } else if (tab === "favorites") {
    if (!favs.length) body.innerHTML = emptyStateHtml("star", "No favorites yet", "Star prompts to collect them here.");
    else { body.innerHTML = `<div class="result-count">${favs.length} favorite${favs.length === 1 ? "" : "s"}</div><div id="favx-list"></div>`; renderPaginatedList(body.querySelector("#favx-list"), favs, { showSource: true }); }
  } else {
    body.innerHTML = `<div id="central-results"></div>`;
    renderResultsInto(body.querySelector("#central-results"), {});
  }
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
function newBuilderState() { return { step: 0, answers: {}, generated: null }; }
function renderBuilderView(container) {
  if (!STATE.builder) STATE.builder = newBuilderState();
  const b = STATE.builder;
  if (b.generated) { renderBuilderResult(container); return; }
  const total = BUILDER_QUESTIONS.length;
  const step = Math.min(b.step, total - 1);
  const qn = BUILDER_QUESTIONS[step];
  container.innerHTML = `
    <div class="builder-card">
      <div class="builder-steps">${BUILDER_QUESTIONS.map((_, i) => `<div class="builder-step-dot ${i < step ? "done" : i === step ? "active" : ""}"></div>`).join("")}</div>
      <div style="font-size:11.5px; color:var(--text-faint); margin-bottom:6px;">Step ${step + 1} of ${total} · Goal → Role → Context → Inputs → Constraints → Output</div>
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
  container.querySelector("#builder-back").addEventListener("click", () => { b.answers[qn.key] = input.value; b.step = Math.max(0, step - 1); renderBuilderView(container); });
  container.querySelector("#builder-next").addEventListener("click", async () => {
    b.answers[qn.key] = input.value;
    if (step === total - 1) { await generateBuilderPrompt(); renderBuilderView(container); }
    else { b.step = step + 1; renderBuilderView(container); }
  });
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
  b.generated = { text: assembleBuilderPrompt(b.answers), method: "auto-structured" };
  if (Store.hasSample()) {
    try {
      const instructions = `You write high-quality, reusable AI prompts. Given these answers to a prompt-building questionnaire, write ONE polished prompt the user can paste into any AI tool. Keep their intent exactly — do not invent new requirements. Respond with ONLY the finished prompt text, no preamble.\n\n` +
        Object.entries(b.answers).filter(([, v]) => v).map(([k, v]) => `${k}: ${v}`).join("\n");
      const res = await Store.sample(instructions, { modelTier: "quick" });
      if (res && res.text && res.text.trim()) b.generated = { text: res.text.trim(), method: "ai-generated" };
    } catch (e) {}
  }
}
function renderBuilderResult(container) {
  const b = STATE.builder;
  const scored = scorePromptText("Custom prompt", b.generated.text);
  const why = [];
  if (b.answers.role) why.push("Opens with a role, so the model answers from the right perspective.");
  if (b.answers.context) why.push("States the context up front instead of leaving the model to guess.");
  why.push("Separates objective, inputs, constraints and output so nothing gets lost in a run-on sentence.");
  if (!b.answers.outputFormat) why.push("Adds a default output instruction since you didn't specify one.");
  container.innerHTML = `
    <div class="builder-card" style="max-width:720px;">
      <div class="section-title"><h2>Your generated prompt</h2>
        <span class="chip ${b.generated.method === "ai-generated" ? "chip-accent" : ""}">${b.generated.method === "ai-generated" ? "Generated by Claude" : "Auto-structured"}</span>
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
    const rec = buildMyPromptRecord({ title: (b.answers.objective ? truncate(b.answers.objective, 60) : "Custom built prompt"), originalPrompt: b.generated.text, category: guessCategory(b.answers.objective || "", b.generated.text), source: "User Created" });
    Store.saveMyPrompt(rec);
    showToast("Saved to My Library");
    renderSidebarFooter();
    STATE.builder = newBuilderState();
    navigate("myLibrary");
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
    root.querySelector("#detail-overlay").classList.add("show");
    root.querySelector("#detail-drawer").classList.add("show");
  });
  root.querySelector("#detail-overlay").addEventListener("click", closeDetail);
  root.querySelector("#drawer-close").addEventListener("click", closeDetail);
  root.querySelector("#drawer-fav").addEventListener("click", () => {
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

  return `
    ${rec.sensitiveCategory ? `<div class="sensitive-note">${icon("alert")}<div>This is a ${escapeHtml(rec.category)} prompt. Treat any output as a starting draft — have a qualified professional review anything used for real decisions.</div></div>` : ""}
    <div class="detail-meta-row">
      <span class="chip">${escapeHtml(rec.category)}</span>
      <span class="chip">${escapeHtml(rec.skill)}</span>
      ${renderDifficulty(rec.difficulty)}
      <span class="chip">${escapeHtml(rec.promptType)}</span>
      ${renderHealthBadge(rec.healthStatus || "Good")}
      ${renderLifecycle(rec.lifecycle)}
      ${renderQualityPill(rec.qualityScore)}
      ${rec.source && rec.source !== "Original Library" ? `<span class="chip chip-accent">${escapeHtml(rec.source)}</span>` : ""}
      ${modelNotes.map((m) => `<span class="chip">${escapeHtml(m)}</span>`).join("")}
    </div>

    <div class="detail-section"><h3>What it does</h3><div class="prose">${escapeHtml(rec.description)}</div></div>
    <div class="detail-section"><h3>When to use it</h3><div class="prose">${escapeHtml(rec.whenToUse)}</div></div>
    <div class="detail-section"><h3>Why it works</h3><div class="why-list">${(rec.whyItWorks || []).map((w) => `<div class="why-item">${icon("check")}<span>${escapeHtml(w)}</span></div>`).join("")}</div></div>
    <div class="detail-section" style="display:flex; gap:32px; flex-wrap:wrap;">
      <div><h3>Role</h3><div class="prose">${escapeHtml(rec.role || "Not specified")}</div></div>
      <div><h3>Best for</h3><div class="prose">${escapeHtml(rec.useCase)}</div></div>
      <div><h3>Expected outcome</h3><div class="prose">${escapeHtml(rec.outcome || "Not specified")}</div></div>
    </div>

    ${rec.isTemplate ? `
    <div class="detail-section">
      <h3>Variables</h3>
      <div class="var-list" style="margin-bottom:10px;">${(rec.variables || []).map((v) => `<span class="var-chip">[${escapeHtml(v)}]</span>`).join("")}</div>
      <button class="btn btn-sm" id="customize-toggle">${icon("slider")} Customize prompt</button>
      <div id="customize-panel" style="display:none; margin-top:12px;"></div>
    </div>` : ""}

    <div class="detail-section">
      <h3>Quality score</h3>
      <div style="display:flex; align-items:center; gap:10px; margin-bottom:10px;">
        <span style="font-family:var(--font-mono); font-size:22px; font-weight:600;">${rec.qualityScore}</span><span style="color:var(--text-faint); font-size:12px;">/ 100</span>
      </div>
      <div class="quality-breakdown">
        ${Object.entries(rec.qualityBreakdown || {}).map(([k, v]) => `<div class="qb-row"><span class="qb-label">${escapeHtml(breakdownLabel(k))}</span><span class="qb-bar"><i style="width:${v}%"></i></span><span class="qb-val tabular">${v}</span></div>`).join("")}
      </div>
      <div style="display:flex; gap:24px; margin-top:12px; flex-wrap:wrap;">
        <div style="flex:1; min-width:180px;"><div class="strengths-improvements">${(rec.strengths || []).map((s) => `<div class="si-item si-good">${icon("check")}<span>${escapeHtml(s)}</span></div>`).join("")}</div></div>
        <div style="flex:1; min-width:180px;"><div class="strengths-improvements">${(rec.improvements || []).map((s) => `<div class="si-item si-bad">${icon("alert")}<span>${escapeHtml(s)}</span></div>`).join("")}</div></div>
      </div>
    </div>

    <div class="detail-section">
      <div class="layer-tabs">${layers.filter((l) => l[2]).map((l) => `<button class="layer-tab ${activeLayer === l[0] ? "active" : ""}" data-layer="${l[0]}">${l[1]}</button>`).join("")}</div>
      <div class="block-header">
        <span class="label">${activeLayer === "original" ? "Original Prompt" : activeLayer === "optimized" ? "Optimized Version" : "Your Learner Version"}</span>
        ${activeLayer === "optimized" && imp ? `<span class="chip ${imp.method === "ai-generated" ? "chip-accent" : ""}">${imp.method === "ai-generated" ? "Generated by Claude" : "Auto-structured"}</span>` : ""}
        <button class="btn btn-sm" data-copy-layer>${icon("copy")} Copy ${activeLayer === "original" ? "prompt text" : activeLayer}</button>
      </div>
      <div class="prompt-block" id="layer-text">${escapeHtml(layerText)}</div>
      <div class="form-hint">Copy always copies only the prompt text of the layer shown — never the metadata around it. The Original is read-only and never changes.</div>
    </div>

    <div class="detail-section" style="display:flex; gap:8px; flex-wrap:wrap;">
      <button class="btn" id="btn-improve">${icon("wand")} ${flags.modelSpecific ? "Improve / Modernize" : "Improve"}</button>
      <button class="btn" id="btn-test">${icon("beaker")} Try it</button>
      <button class="btn" id="btn-save-learner">${icon("plus")} Save my version</button>
      <button class="btn" id="btn-versions">${icon("history")} Version history</button>
    </div>

    ${related.length ? `<div class="detail-section"><h3>Related prompts</h3><div class="related-grid">${related.map((r) => `<div class="mini-item" data-id="${r.id}" role="button" tabindex="0" style="border:1px solid var(--border); border-radius:var(--radius-sm); padding:8px 10px;">${renderQualityPill(r.qualityScore)}<span class="mini-item-title">${escapeHtml(r.title)}</span><span class="chip">${escapeHtml(r.category)}</span></div>`).join("")}</div></div>` : ""}

    <div class="provenance">${icon("link2")} ${escapeHtml(rec.source || "Original Library")}${rec.sourceNumber ? " · source #" + rec.sourceNumber : ""}${rec.version ? " · v" + rec.version : ""}</div>`;
}
function breakdownLabel(k) {
  return { clarity: "Clarity", context: "Context", specificity: "Specificity", outputDefinition: "Output Def.", reusability: "Reusability" }[k] || k;
}
function wireDetailBody(body, rec) {
  body.querySelectorAll("[data-id]").forEach((el) => el.addEventListener("click", () => openDetail(el.dataset.id)));
  body.querySelectorAll("[data-layer]").forEach((b) => b.addEventListener("click", () => { STATE.detailLayer = b.dataset.layer; renderDrawer(rec); }));
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
  const improveBtn = body.querySelector("#btn-improve");
  if (improveBtn) improveBtn.addEventListener("click", () => openImproveModal(rec));
  const testBtn = body.querySelector("#btn-test");
  if (testBtn) testBtn.addEventListener("click", () => openTestModal(rec));
  const versionsBtn = body.querySelector("#btn-versions");
  if (versionsBtn) versionsBtn.addEventListener("click", () => openVersionsModal(rec));
  const saveLearner = body.querySelector("#btn-save-learner");
  if (saveLearner) saveLearner.addEventListener("click", () => {
    const existing = Store.getMyPrompt(rec.id);
    if (existing && rec.id === existing.id) { showToast("Already in My Library"); navigate("myLibrary"); return; }
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
