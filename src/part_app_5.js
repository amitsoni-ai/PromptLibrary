/* ---------- Modal scaffold ---------- */
function openModal(html, opts) {
  opts = opts || {};
  const root = document.getElementById("modal-root");
  root.innerHTML = `<div class="overlay show" id="modal-overlay"></div><div class="modal" id="modal-wrap"><div class="modal-card">${html}</div></div>`;
  const close = () => { root.innerHTML = ""; document.removeEventListener("keydown", escHandler); };
  const escHandler = (e) => { if (e.key === "Escape") close(); };
  document.addEventListener("keydown", escHandler);
  if (!opts.persistent) root.querySelector("#modal-overlay").addEventListener("click", close);
  window.__closeModal = close;
  return { root, close };
}
function buildMyPromptRecord(fields) {
  const now = new Date().toISOString();
  const scored = scorePromptText(fields.title, fields.originalPrompt);
  const catMeta = CATEGORIES.find((c) => c.name === fields.category) || { role: "Any Professional", outcome: "A response you can adapt to your task" };
  const id = uid("my");
  const base = {
    id, sourceNumber: null, title: fields.title, originalTitle: fields.title,
    category: fields.category || "General",
    description: fields.description || truncate(fields.originalPrompt, 160),
    useCase: fields.useCase || `Useful for: ${fields.title}`,
    originalPrompt: fields.originalPrompt,
    promptType: fields.promptType || guessPromptType(fields.originalPrompt),
    role: fields.role || catMeta.role,
    outcome: fields.outcome || catMeta.outcome,
    aiTool: "General AI",
    variables: scored.variables.map(normalizeVarName),
    variablesRaw: scored.variables,
    isTemplate: scored.variables.length > 0,
    tags: fields.tags || guessTags(fields.title, fields.category),
    qualityScore: scored.score,
    qualityBreakdown: scored.breakdown,
    strengths: scored.score >= 70 ? ["Usable as written"] : ["Usable with light editing"],
    improvements: scored.score < 70 ? ["Consider adding more context or a clearer output format"] : [],
    flags: { modelSpecific: false, containsWebSearch: false, containsInteractiveQuestioning: false, embeddedMetadata: false, incompleteTitle: false, hasOutputCue: scored.hasOutput },
    source: fields.source || "User Created",
    sourceId: fields.sourceId || null,
    version: "1.0",
    versions: [{ version: "1.0", prompt: fields.originalPrompt, note: fields.versionNote || "Original", ts: now }],
    sensitiveCategory: false,
    duplicateGroup: null,
    healthStatus: healthFromScore(scored.score, false),
    healthReasons: [],
    createdAt: now, updatedAt: now,
  };
  return enrichRecord(Object.assign(base, fields.overrides || {}));
}
function guessPromptType(text) {
  const p = text.toLowerCase();
  if (/analy[sz]e|analysis/.test(p)) return "Analysis";
  if (/research/.test(p)) return "Research";
  if (/strategy|strategic|roadmap/.test(p)) return "Strategy";
  if (/plan(ning)?/.test(p)) return "Planning";
  if (/should i|decide|decision/.test(p)) return "Decision";
  if (/step[- ]by[- ]step|workflow|process/.test(p)) return "Workflow";
  if (/coach|feedback|mentor/.test(p)) return "Coaching";
  if (/brainstorm|ideas?/.test(p)) return "Brainstorm";
  if (/write|draft|compose/.test(p)) return "Writing";
  if (text.length < 90) return "Quick Prompt";
  return "Reusable Prompt";
}
function guessCategory(title, text) {
  const hay = (title + " " + text).toLowerCase();
  let best = null, bestScore = 0;
  CATEGORIES.forEach((c) => {
    const words = c.name.toLowerCase().split(/[^a-z]+/).filter((w) => w.length > 3);
    let score = 0;
    words.forEach((w) => { if (hay.includes(w)) score++; });
    if (score > bestScore) { bestScore = score; best = c.name; }
  });
  return best || "General";
}
function guessTags(title, category) {
  const catWord = (category || "General").split("&")[0].trim();
  const words = (title.match(/[A-Za-z]{4,}/g) || []).slice(0, 3);
  return Array.from(new Set([catWord, ...words])).slice(0, 5);
}

/* ---------- Add Prompt ---------- */
function openAddPrompt() {
  const { root, close } = openModal(`
    <div class="modal-header"><h2>Add Prompt</h2><button class="btn btn-icon btn-ghost" id="modal-close">${icon("x")}</button></div>
    <div class="form-field"><label>Prompt title *</label><input type="text" id="ap-title" placeholder="e.g. Draft a sales follow-up email"/></div>
    <div class="form-field"><label>Prompt *</label><textarea id="ap-prompt" rows="6" placeholder="Paste or write your prompt here…"></textarea></div>
    <div id="ap-suggestions" style="display:none;">
      <div class="form-field"><label>Category</label><select id="ap-category"></select></div>
      <div class="form-field"><label>Description</label><input type="text" id="ap-desc"/></div>
      <div class="form-field"><label>Tags (comma-separated)</label><input type="text" id="ap-tags"/></div>
      <div style="display:flex; gap:14px; color:var(--text-muted); font-size:12.5px; margin-bottom:14px; flex-wrap:wrap;">
        <span id="ap-type-out"></span><span id="ap-diff-out"></span><span id="ap-quality-out"></span><span id="ap-vars-out"></span>
      </div>
    </div>
    <div style="display:flex; justify-content:flex-end; gap:8px;">
      <button class="btn" id="ap-cancel">Cancel</button>
      <button class="btn btn-primary" id="ap-save" disabled>Save prompt</button>
    </div>`);
  const catSel = root.querySelector("#ap-category");
  catSel.innerHTML = CATEGORIES.map((c) => `<option value="${escapeHtml(c.name)}">${escapeHtml(c.name)}</option>`).join("");
  const titleI = root.querySelector("#ap-title"), promptI = root.querySelector("#ap-prompt");
  const suggBox = root.querySelector("#ap-suggestions"), saveBtn = root.querySelector("#ap-save");
  const refresh = debounce(() => {
    const title = titleI.value.trim(), text = promptI.value.trim();
    saveBtn.disabled = !(title && text);
    if (!title || !text) { suggBox.style.display = "none"; return; }
    suggBox.style.display = "block";
    const scored = scorePromptText(title, text);
    const cat = guessCategory(title, text);
    catSel.value = cat;
    root.querySelector("#ap-desc").value = truncate(text, 140);
    root.querySelector("#ap-tags").value = guessTags(title, cat).join(", ");
    root.querySelector("#ap-type-out").textContent = "Type: " + guessPromptType(text);
    const tmpRec = { variables: scored.variables, qualityScore: scored.score, promptType: guessPromptType(text), originalPrompt: text };
    root.querySelector("#ap-diff-out").textContent = "Difficulty: " + deriveDifficulty(tmpRec);
    root.querySelector("#ap-quality-out").textContent = "Quality: " + scored.score + "/100";
    root.querySelector("#ap-vars-out").textContent = scored.variables.length ? scored.variables.length + " variable(s) detected" : "No variables detected";
  }, 200);
  titleI.addEventListener("input", refresh);
  promptI.addEventListener("input", refresh);
  root.querySelector("#modal-close").addEventListener("click", close);
  root.querySelector("#ap-cancel").addEventListener("click", close);
  saveBtn.addEventListener("click", () => {
    const title = titleI.value.trim(), text = promptI.value.trim();
    if (!title || !text) return;
    const rec = buildMyPromptRecord({
      title, originalPrompt: text, category: catSel.value,
      description: root.querySelector("#ap-desc").value.trim(),
      tags: root.querySelector("#ap-tags").value.split(",").map((s) => s.trim()).filter(Boolean),
      source: "User Created",
    });
    Store.saveMyPrompt(rec);
    close();
    showToast("Prompt saved to My Library");
    renderSidebarFooter();
    if (STATE.view === "myLibrary") renderContent();
  });
}

/* ---------- Improve Prompt ---------- */
function openImproveModal(rec) {
  let imp = Store.getImprovement(rec.id);
  if (!imp) {
    const data = quickImprove(rec);
    imp = { improvedPrompt: data.improvedPrompt, problems: data.problems, whyBetter: data.whyBetter, method: "auto-structured", createdAt: new Date().toISOString() };
    Store.saveImprovement(rec.id, imp);
  }
  const { root, close } = openModal(improveModalHtml(rec, imp));
  wireImproveModal(root, rec, close);
}
function improveModalHtml(rec, imp) {
  return `
    <div class="modal-header"><h2>Improve Prompt</h2><button class="btn btn-icon btn-ghost" id="modal-close">${icon("x")}</button></div>
    <div class="detail-section"><h3>Original</h3><div class="prompt-block" style="max-height:140px;">${escapeHtml(rec.originalPrompt)}</div></div>
    <div class="detail-section"><h3>What could improve</h3><div class="strengths-improvements">${imp.problems.map((p) => `<div class="si-item si-bad">${icon("alert")}<span>${escapeHtml(p)}</span></div>`).join("")}</div></div>
    <div class="detail-section">
      <div class="block-header"><span class="label">Better prompt</span><span class="chip ${imp.method === "ai-generated" ? "chip-accent" : ""}">${imp.method === "ai-generated" ? "Generated by Claude" : "Auto-structured"}</span></div>
      <div class="prompt-block" id="improve-text" style="max-height:220px;">${escapeHtml(imp.improvedPrompt)}</div>
    </div>
    <div class="detail-section"><h3>What changed</h3><div class="strengths-improvements">${imp.whyBetter.map((p) => `<div class="si-item si-good">${icon("check")}<span>${escapeHtml(p)}</span></div>`).join("")}</div></div>
    <div style="display:flex; gap:8px; flex-wrap:wrap; justify-content:flex-end;">
      ${Store.hasSample() && imp.method !== "ai-generated" ? `<button class="btn" id="improve-ai">${icon("sparkle")} Regenerate with AI</button>` : ""}
      <button class="btn" id="improve-copy">${icon("copy")} Copy better prompt</button>
      <button class="btn btn-primary" id="improve-save">Save as my version</button>
    </div>`;
}
function wireImproveModal(root, rec, close) {
  root.querySelector("#modal-close").addEventListener("click", close);
  const copyBtn = root.querySelector("#improve-copy");
  if (copyBtn) copyBtn.addEventListener("click", async () => {
    const imp = Store.getImprovement(rec.id);
    const ok = await copyText(imp.improvedPrompt);
    showToast(ok ? "Copied prompt text" : "Couldn't copy");
  });
  const saveBtn = root.querySelector("#improve-save");
  if (saveBtn) saveBtn.addEventListener("click", () => {
    const imp = Store.getImprovement(rec.id);
    saveImprovedAsVersion(rec, imp.improvedPrompt, "Improved via " + (imp.method === "ai-generated" ? "AI" : "auto-structure"));
    close();
    showToast("Saved as your version in My Library");
    renderSidebarFooter();
    if (STATE.detailId === rec.id) { STATE.detailLayer = "optimized"; renderDrawer(rec); }
  });
  const aiBtn = root.querySelector("#improve-ai");
  if (aiBtn) aiBtn.addEventListener("click", async () => {
    aiBtn.disabled = true; aiBtn.textContent = "Generating…";
    try {
      const instructions = `Analyze this AI prompt and rewrite it to be clearer and more useful, WITHOUT changing its intent or making it needlessly longer. Return strict JSON with keys: problems (array of short strings), improvedPrompt (string), whyBetter (array of short strings).\n\nTitle: ${rec.title}\nCategory: ${rec.category}\nOriginal prompt:\n${rec.originalPrompt}`;
      const data = await Store.sample(instructions, { modelTier: "default" });
      let parsed = null;
      try { parsed = JSON.parse(data.text); } catch (e) { const m = data.text && data.text.match(/\{[\s\S]*\}/); if (m) try { parsed = JSON.parse(m[0]); } catch (e2) {} }
      if (parsed && parsed.improvedPrompt) {
        Store.saveImprovement(rec.id, { improvedPrompt: parsed.improvedPrompt, problems: parsed.problems || [], whyBetter: parsed.whyBetter || [], method: "ai-generated", createdAt: new Date().toISOString() });
        close();
        openImproveModal(rec);
      } else { showToast("Couldn't parse AI response — keeping auto-structured version"); aiBtn.disabled = false; aiBtn.textContent = "Regenerate with AI"; }
    } catch (e) { showToast("AI improve isn't available right now"); aiBtn.disabled = false; aiBtn.textContent = "Regenerate with AI"; }
  });
}
function saveImprovedAsVersion(rec, improvedText, note) {
  const existing = Store.getMyPrompt(rec.id);
  if (rec.source === "Original Library" || !existing) {
    const newRec = buildMyPromptRecord({
      title: rec.title + " (Improved)", originalPrompt: improvedText, category: rec.category,
      role: rec.role, outcome: rec.outcome, source: "Optimized", sourceId: rec.id, versionNote: note,
    });
    Store.saveMyPrompt(newRec);
  } else {
    const versions = (existing.versions || []).slice();
    const nextVersion = (parseFloat(versions[versions.length - 1].version) + 0.1).toFixed(1);
    versions.push({ version: nextVersion, prompt: improvedText, note, ts: new Date().toISOString() });
    Store.updateMyPrompt(rec.id, { versions, version: nextVersion, originalPrompt: improvedText, updatedAt: new Date().toISOString(), source: "Modified" });
  }
}

/* ---------- Try / Test ---------- */
function openTestModal(rec) {
  const { root, close } = openModal(`
    <div class="modal-header"><h2>Try it</h2><button class="btn btn-icon btn-ghost" id="modal-close">${icon("x")}</button></div>
    <div class="form-field"><label>Your real context (optional)</label><textarea id="test-context" rows="3" placeholder="Add the specifics you'd actually use — a real audience, product, or situation…"></textarea></div>
    <button class="btn btn-primary" id="test-run">${icon("beaker")} Run</button>
    <div id="test-result" style="margin-top:16px;"></div>`);
  root.querySelector("#modal-close").addEventListener("click", close);
  root.querySelector("#test-run").addEventListener("click", async () => {
    const ctx = root.querySelector("#test-context").value.trim();
    const resultBox = root.querySelector("#test-result");
    Store.recordUsage(rec.id, "tested");
    if (Store.hasSample()) {
      resultBox.innerHTML = `<div class="block-header"><span class="label">Result</span></div><div class="prompt-block" id="test-output">Thinking…</div>`;
      const outEl = resultBox.querySelector("#test-output");
      try {
        const fullPrompt = rec.originalPrompt + (ctx ? `\n\n(Additional context for this test: ${ctx})` : "");
        await Store.sample(fullPrompt, { modelTier: "quick", onText: ({ text }) => { outEl.textContent = text; } });
        renderFeedbackRow(resultBox, rec);
      } catch (e) { outEl.textContent = "Couldn't get a live result right now."; }
    } else {
      const scored = scorePromptText(rec.title, rec.originalPrompt);
      resultBox.innerHTML = `
        <div class="block-header"><span class="label">Result</span><span class="chip">No live AI in this view</span></div>
        <div class="prompt-block" style="font-family:var(--font-body);">Live testing needs AI access, which isn't available in this view. Based on the prompt, a strong response should include:
        <br>• ${scored.hasOutput ? "The output format the prompt already asks for" : "A clear structure (the prompt doesn't specify one — consider adding it)"}
        <br>• Direct handling of: ${escapeHtml(rec.outcome || "the stated goal")}
        <br>• Specifics for each variable you filled in${ctx ? ", plus your added context" : ""}</div>`;
      renderFeedbackRow(resultBox, rec);
    }
  });
}
function renderFeedbackRow(container, rec) {
  const existing = Store.getFeedback(rec.id);
  const row = document.createElement("div");
  row.style.cssText = "margin-top:12px; display:flex; align-items:center; gap:8px; font-size:12.5px; color:var(--text-muted); flex-wrap:wrap;";
  row.innerHTML = `How useful was this? ${["Excellent", "Good", "Needs Improvement"].map((r) => `<button class="btn btn-sm ${existing === r ? "btn-primary" : ""}" data-rate="${r}">${r}</button>`).join("")}`;
  container.appendChild(row);
  row.querySelectorAll("[data-rate]").forEach((b) => b.addEventListener("click", () => {
    Store.saveFeedback(rec.id, b.dataset.rate);
    row.querySelectorAll("[data-rate]").forEach((x) => x.classList.remove("btn-primary"));
    b.classList.add("btn-primary");
    showToast("Thanks — noted");
  }));
}

/* ---------- Version history ---------- */
function openVersionsModal(rec) {
  const stored = Store.getMyPrompt(rec.id);
  const versions = (stored && stored.versions) || rec.versions || [{ version: rec.version || "1.0", prompt: rec.originalPrompt, note: "Original", ts: rec.createdAt }];
  const { root, close } = openModal(`
    <div class="modal-header"><h2>Version history</h2><button class="btn btn-icon btn-ghost" id="modal-close">${icon("x")}</button></div>
    ${versions.slice().reverse().map((v, ri) => {
      const i = versions.length - 1 - ri;
      return `<div class="detail-section">
        <div class="block-header"><span class="label">Version ${escapeHtml(v.version)}${i === versions.length - 1 ? " (current)" : ""}</span><span class="chip">${escapeHtml(v.note || "")}</span></div>
        <div class="prompt-block" style="max-height:140px;">${escapeHtml(v.prompt)}</div>
        ${stored && i !== versions.length - 1 ? `<button class="btn btn-sm" data-restore="${i}" style="margin-top:6px;">Restore this version</button>` : ""}
      </div>`;
    }).join("")}`);
  root.querySelector("#modal-close").addEventListener("click", close);
  root.querySelectorAll("[data-restore]").forEach((b) => b.addEventListener("click", () => {
    const idx = parseInt(b.dataset.restore, 10);
    const v = versions[idx];
    Store.updateMyPrompt(rec.id, { originalPrompt: v.prompt, version: v.version, updatedAt: new Date().toISOString() });
    close();
    showToast("Restored version " + v.version);
    if (STATE.detailId === rec.id) openDetail(rec.id);
  }));
}

/* ---------- Export ---------- */
function openExportModal() {
  const items = Store.getMyPrompts();
  const { root, close } = openModal(`
    <div class="modal-header"><h2>Export My Prompts</h2><button class="btn btn-icon btn-ghost" id="modal-close">${icon("x")}</button></div>
    <div class="prose" style="margin-bottom:14px;">${items.length} prompt${items.length === 1 ? "" : "s"} will be exported.</div>
    <div style="display:flex; gap:8px;">
      <button class="btn" data-export="csv">CSV</button>
      <button class="btn" data-export="json">JSON</button>
      <button class="btn" data-export="txt">TXT</button>
    </div>
    ${!Store.hasDownloads() ? `<div class="form-hint" style="margin-top:12px;">This view can't save files directly — export shows the content here for you to copy instead.</div>` : ""}
    <div id="export-fallback" style="margin-top:14px;"></div>`);
  root.querySelector("#modal-close").addEventListener("click", close);
  root.querySelectorAll("[data-export]").forEach((b) => b.addEventListener("click", async () => {
    const fmt = b.dataset.export;
    const content = fmt === "csv" ? toCsv(items) : fmt === "json" ? JSON.stringify(items, null, 2) : toTxt(items);
    const filename = `my-prompts.${fmt}`;
    if (Store.hasDownloads()) {
      try { await Store.downloadsSave({ filename, data: content }); showToast("Export saved"); }
      catch (e) { showToast("Save was cancelled or unavailable"); }
    } else root.querySelector("#export-fallback").innerHTML = `<div class="prompt-block" style="max-height:260px;">${escapeHtml(content)}</div>`;
  }));
}
function toCsv(items) {
  const cols = ["title", "category", "promptType", "difficulty", "qualityScore", "originalPrompt"];
  const esc = (v) => `"${String(v == null ? "" : v).replace(/"/g, '""')}"`;
  const lines = [cols.join(",")];
  items.forEach((r) => lines.push(cols.map((c) => esc(r[c])).join(",")));
  return lines.join("\n");
}
function toTxt(items) { return items.map((r) => `${r.title}\n${"-".repeat(r.title.length)}\n${r.originalPrompt}\n`).join("\n\n"); }

/* ---------- Ask the Library ---------- */
function openAskLibrary() {
  const { root, close } = openModal(`
    <div class="modal-header"><h2>Ask the Library</h2><button class="btn btn-icon btn-ghost" id="modal-close">${icon("x")}</button></div>
    <div class="form-field"><label>Describe your situation</label><textarea id="ask-input" rows="3" placeholder="e.g. I have a meeting tomorrow with senior HR leaders and need to prepare an AI transformation proposal."></textarea></div>
    <button class="btn btn-primary" id="ask-run">${icon("search")} Find prompts</button>
    <div id="ask-result" style="margin-top:16px;"></div>`);
  root.querySelector("#modal-close").addEventListener("click", close);
  root.querySelector("#ask-input").focus();
  root.querySelector("#ask-run").addEventListener("click", async () => {
    const text = root.querySelector("#ask-input").value.trim();
    if (!text) return;
    const resultBox = root.querySelector("#ask-result");
    resultBox.innerHTML = `<div class="skel" style="height:80px;"></div>`;
    const candidates = searchPrompts(getSearchCorpus(), text, getUsageForSearch()).slice(0, 12);
    let why = "These prompts share the most relevant category, skill, role and keywords with what you described.";
    if (Store.hasSample() && candidates.length) {
      try {
        const instructions = `A user described this situation:\n"${text}"\n\nCandidate prompts (id, title, category, use case):\n` +
          candidates.slice(0, 12).map((c) => `${c.id} | ${c.title} | ${c.category} | ${c.useCase}`).join("\n") +
          `\n\nPick the best match id and up to 4 other useful ids from this list ONLY (never invent new ones). Respond as strict JSON: {"best":"<id>","also":["id1","id2"],"why":"one sentence"}`;
        const res = await Store.sample(instructions, { modelTier: "quick" });
        let parsed = null;
        try { parsed = JSON.parse(res.text); } catch (e) { const m = res.text.match(/\{[\s\S]*\}/); if (m) try { parsed = JSON.parse(m[0]); } catch (e2) {} }
        if (parsed && parsed.best) {
          const bestRec = candidates.find((c) => c.id === parsed.best);
          const alsoRecs = (parsed.also || []).map((id) => candidates.find((c) => c.id === id)).filter(Boolean);
          resultBox.innerHTML = askResultHtml(bestRec, alsoRecs, parsed.why || why);
          wireAskResult(resultBox, close);
          return;
        }
      } catch (e) {}
    }
    resultBox.innerHTML = askResultHtml(candidates[0], candidates.slice(1, 5), why);
    wireAskResult(resultBox, close);
  });
}
function askResultHtml(best, also, why) {
  if (!best) return emptyStateHtml("search", "No close match found", "Try describing the outcome you want, or search directly.");
  return `
    <div class="detail-section"><h3>Best match</h3>
      <div class="prompt-card" data-id="${best.id}" style="cursor:pointer;">
        <div class="prompt-card-top"><div class="prompt-card-title">${escapeHtml(best.title)}</div></div>
        <div class="prompt-card-desc">${escapeHtml(best.description)}</div>
        <div class="prompt-card-meta"><span class="chip">${escapeHtml(best.category)}</span>${renderQualityPill(best.qualityScore)}</div>
      </div>
    </div>
    ${also.length ? `<div class="detail-section"><h3>Also useful</h3><div class="related-grid">${also.map((r) => `<div class="mini-item" data-id="${r.id}" role="button" tabindex="0" style="border:1px solid var(--border); border-radius:var(--radius-sm); padding:8px 10px;">${renderQualityPill(r.qualityScore)}<span class="mini-item-title">${escapeHtml(r.title)}</span><span class="chip">${escapeHtml(r.category)}</span></div>`).join("")}</div></div>` : ""}
    <div class="detail-section"><h3>Why these</h3><div class="prose">${escapeHtml(why)}</div></div>`;
}
function wireAskResult(box, close) {
  box.querySelectorAll("[data-id]").forEach((el) => el.addEventListener("click", () => { close(); openDetail(el.dataset.id); }));
}

/* ---------- App shell: state, router, nav, init ---------- */
const NAV_GROUPS = [
  { label: "Discover", items: [
    { key: "home", label: "Home", icon: "home" },
    { key: "search", label: "Prompt Library", icon: "search", kbd: "/" },
    { key: "categories", label: "Categories", icon: "grid" },
    { key: "program", label: "My Program", icon: "path" },
  ]},
  { label: "Learn", items: [
    { key: "learn", label: "Learn", icon: "book" },
    { key: "practice", label: "Practice", icon: "target" },
    { key: "builder", label: "Prompt Builder", icon: "build" },
  ]},
  { label: "My Library", items: [
    { key: "myLibrary", label: "My Library", icon: "folder" },
    { key: "favorites", label: "Favorites", icon: "star" },
  ]},
  { label: "Manage", items: [
    { key: "insights", label: "Library Governance", icon: "chart" },
  ]},
];
const VIEW_TITLES = {
  home: "Home", search: "Prompt Library", categories: "Categories", categoryDetail: "Category",
  program: "My Program", learn: "Learn", practice: "Practice", builder: "Prompt Builder",
  myLibrary: "My Library", favorites: "Favorites", insights: "Library Governance",
};
let STATE = {
  view: "home", query: "", filters: emptyFilters(), sort: "relevance",
  activeCategory: null, favoritesTab: "favorites", myLibTab: "mine", insightsTab: "overview",
  detailId: null, detailLayer: "original", builder: null, practice: null, openModules: null, lcStage: "Recommended",
};
function emptyFilters() { return { category: null, skill: null, promptType: null, role: null, difficulty: null, aiTool: null, source: null, hasVariables: false, favoritesOnly: false }; }

let ALL_PROMPTS = [], ALL_PROMPTS_BY_ID = {}, CATEGORIES = [], STATS = {};
function findPromptById(id) {
  if (!id) return null;
  return ALL_PROMPTS_BY_ID[id] || Store.getMyPrompts().find((p) => p.id === id) || null;
}
const SHARED_QUERY_VIEWS = new Set(["home", "search"]);
// Views a scoped learner never sees — they discover through their program,
// search, Learn and Practice, not by browsing the whole library.
const SCOPED_HIDDEN_VIEWS = new Set(["categories", "categoryDetail", "insights"]);
function isViewAllowed(view) {
  return !(isScopeRestricted() && SCOPED_HIDDEN_VIEWS.has(view));
}
function navigate(view) {
  if (!isViewAllowed(view)) view = "search";
  if (!(SHARED_QUERY_VIEWS.has(view) && SHARED_QUERY_VIEWS.has(STATE.view))) STATE.query = "";
  STATE.view = view;
  renderApp();
  window.scrollTo({ top: 0 });
}
function setQuery(q) {
  STATE.query = q;
  if (q && STATE.view !== "search" && STATE.view !== "home") STATE.view = "home";
  renderApp();
}
function renderNav() {
  const nav = document.getElementById("nav");
  const s = Store.getSession();
  const groups = NAV_GROUPS
    .map((g) => ({ label: g.label, items: g.items.filter((it) => isViewAllowed(it.key)) }))
    .filter((g) => g.items.length);
  if (s && s.superAdmin) {
    groups.push({ label: "Admin", items: [{ key: "__admin", label: "Admin console", icon: "slider" }] });
  }
  nav.innerHTML = groups.map((g) => `
    <div class="nav-group-label">${g.label}</div>
    ${g.items.map((item) => `
      <button class="nav-item ${STATE.view === item.key || (STATE.view === "categoryDetail" && item.key === "categories") ? "active" : ""}" data-nav="${item.key}">
        ${icon(item.icon)}<span>${item.label}</span>${item.kbd ? `<span class="nav-kbd">${item.kbd}</span>` : ""}
      </button>`).join("")}`).join("");
  nav.querySelectorAll("[data-nav]").forEach((b) => b.addEventListener("click", () => {
    closeSidebar();
    if (b.dataset.nav === "__admin") { openAdmin(); return; }
    navigate(b.dataset.nav);
  }));
}
const TOPBAR_SEARCH_VIEWS = new Set(["search", "categories", "categoryDetail"]);
function renderTopbar() {
  document.getElementById("topbar-title").textContent = VIEW_TITLES[STATE.view] || "";
  const wrap = document.getElementById("topbar-search-wrap");
  if (!TOPBAR_SEARCH_VIEWS.has(STATE.view)) { wrap.innerHTML = ""; return; }
  const existing = wrap.querySelector("#topbar-search");
  if (existing && existing.dataset.view === STATE.view) {
    if (document.activeElement !== existing && existing.value !== STATE.query) existing.value = STATE.query;
    return;
  }
  wrap.innerHTML = `<input type="text" id="topbar-search" data-view="${STATE.view}" placeholder="${STATE.view === "categories" ? "Filter categories…" : "Search prompts…"}" value="${escapeHtml(STATE.query)}"/>`;
  const input = wrap.querySelector("#topbar-search");
  input.addEventListener("input", debounce((e) => { STATE.query = e.target.value; renderContent(); }, 150));
}
function renderContent() {
  const content = document.getElementById("content");
  if (!isViewAllowed(STATE.view)) STATE.view = "search";
  content.className = "content" + (STATE.view === "insights" || STATE.view === "myLibrary" ? " wide" : "");
  const map = {
    home: renderHome, search: renderSearchView, categories: renderCategoriesView, categoryDetail: renderCategoryDetail,
    program: renderProgramView, learn: renderLearnView, practice: renderPracticeView, builder: renderBuilderView,
    myLibrary: renderMyLibraryView, favorites: renderFavoritesView, insights: renderInsightsView,
  };
  (map[STATE.view] || renderHome)(content);
}
function renderLearnerBox() {
  const sc = currentScope();
  const s = Store.getSession();
  const box = document.getElementById("learner-box");
  if (!s) { box.innerHTML = ""; return; }
  const line2 = sc && sc.program ? sc.program.name
    : sc && sc.programs && sc.programs.length ? sc.programs.length + " program" + (sc.programs.length === 1 ? "" : "s")
    : "";
  const line3 = sc && sc.cohort ? sc.cohort.name : (s.kind === "admin" ? (s.industry || s.domain || "Organisation access") : "");
  box.innerHTML = `
    <div class="lb-name">${escapeHtml(s.name)}</div>
    <div class="lb-meta">${escapeHtml((sc && sc.org && sc.org.shortName) || "")}${line2 ? " · " + escapeHtml(line2) : ""}</div>
    <div class="lb-meta">${escapeHtml(line3)}${isScopeRestricted() ? " · scoped" : ""}</div>
    <button class="lb-signout" id="lb-signout">Sign out</button>`;
  box.querySelector("#lb-signout").addEventListener("click", signOut);
}
function renderSidebarFooter() {
  const lib = scopedLibrary();
  document.getElementById("sidebar-footer").innerHTML = `
    <div class="stat-row"><span>Prompts in scope</span><b class="tabular">${lib.length.toLocaleString()}</b></div>
    <div class="stat-row"><span>Favorites</span><b class="tabular">${Store.getFavorites().size}</b></div>
    <div class="stat-row"><span>My prompts</span><b class="tabular">${Store.getMyPrompts().length}</b></div>
    <div class="stat-row"><span>Practice attempts</span><b class="tabular">${Store.getProgress().practice.length}</b></div>
    <div class="stat-row" style="margin-top:6px;color:var(--text-faint)"><span>${Store.getBackendLabel()}</span></div>`;
  document.getElementById("brand-sub").textContent = STATS.totalPrompts.toLocaleString() + " prompts";
}
function renderApp() {
  if (typeof renderPreviewBanner === "function") renderPreviewBanner();
  renderNav();
  renderLearnerBox();
  renderTopbar();
  renderSidebarFooter();
  renderContent();
}
function openSidebar() { document.getElementById("sidebar").classList.add("open"); document.getElementById("sidebar-overlay").classList.add("show"); }
function closeSidebar() { document.getElementById("sidebar").classList.remove("open"); document.getElementById("sidebar-overlay").classList.remove("show"); }

document.addEventListener("keydown", (e) => {
  const tag = (e.target.tagName || "").toLowerCase();
  const typing = tag === "input" || tag === "textarea" || e.target.isContentEditable;
  if (e.key === "Escape") {
    if (document.getElementById("modal-root").innerHTML) { window.__closeModal && window.__closeModal(); return; }
    if (STATE.detailId) { closeDetail(); return; }
  }
  if (typing) return;
  if (!document.getElementById("app") || document.getElementById("app").hidden) return;
  if (e.key === "/") {
    e.preventDefault();
    if (STATE.view !== "home" && STATE.view !== "search") navigate("search");
    const el = document.getElementById("hero-search") || document.getElementById("topbar-search");
    if (el) el.focus();
  } else if ((e.key === "c" || e.key === "C") && STATE.detailId) {
    const rec = findPromptById(STATE.detailId);
    if (rec) copyText(currentLayerText(rec)).then(() => { Store.recordUsage(rec.id, "copied"); showToast("Copied prompt text"); });
  } else if ((e.key === "f" || e.key === "F") && STATE.detailId) {
    const btn = document.getElementById("drawer-fav");
    if (btn) btn.click();
  }
});

/* ---------- Init ---------- */
let CURRICULUM_PROMPTS = [];
let PROGRAM_FLAGSHIP = {};
function loadData() {
  ALL_PROMPTS = JSON.parse(document.getElementById("data-prompts").textContent);
  CATEGORIES = JSON.parse(document.getElementById("data-categories").textContent);
  STATS = JSON.parse(document.getElementById("data-stats").textContent);
  ORG_MODEL = JSON.parse(document.getElementById("data-orgmodel").textContent);
  ORG_INDEX = buildOrgIndex(ORG_MODEL);
  const curEl = document.getElementById("data-curriculum");
  CURRICULUM_PROMPTS = curEl ? JSON.parse(curEl.textContent) : [];
  // Synottic course-companion prompts join the central library as their own
  // curated source layer (the Excel originals are never touched).
  ALL_PROMPTS = ALL_PROMPTS.concat(CURRICULUM_PROMPTS);
  ALL_PROMPTS.forEach((r) => { enrichRecord(r); ALL_PROMPTS_BY_ID[r.id] = r; });
  PROGRAM_FLAGSHIP = {};
  CURRICULUM_PROMPTS.forEach((r) => { if (r.programId) PROGRAM_FLAGSHIP[r.programId] = r.id; });
  resolveModulePrompts();
}
async function bootApp() {
  document.getElementById("gate-root").innerHTML = "";
  const adminRoot = document.getElementById("admin-root");
  if (adminRoot) adminRoot.hidden = true;
  document.getElementById("app").hidden = false;
  const info = await Store.init();
  if (info && info.backend === "revoked") {
    // the Neon backend says this session's code is gone/disabled
    document.getElementById("app").hidden = true;
    Store.clearSession();
    renderGate("Your access code is no longer active. Ask your programme lead for a new one.");
    return;
  }
  Store.getMyPrompts().forEach((r) => enrichRecord(r));
  STATE.view = "home";
  renderApp();
  const menuBtn = document.getElementById("mobile-menu-btn");
  const syncMenu = () => { menuBtn.style.display = window.innerWidth <= 880 ? "flex" : "none"; };
  syncMenu();
  window.addEventListener("resize", syncMenu);
  window.addEventListener("pagehide", () => { try { Store.flush(); } catch (e) {} });
  document.getElementById("sidebar-overlay").addEventListener("click", closeSidebar);
}
async function initApp() {
  loadData();
  try { await AdminStore.init(); } catch (e) {}
  let adminOk = false;
  try { adminOk = sessionStorage.getItem("prompt-lib:admin-ok") === "1"; } catch (e) {}
  let session = null;
  try { const v = localStorage.getItem("prompt-lib:session"); session = v ? JSON.parse(v) : null; } catch (e) {}
  // pure admin (key entered at the gate, no learner session) -> straight to console
  if (adminOk && !session) { openAdmin(); return; }
  // Backend session: Store.init() re-validates the token/code with Neon and
  // bootApp() bounces to the gate if it's revoked.
  if (session && session.preview) {
    // a preview only makes sense with its stashed real session (sessionStorage,
    // gone when the tab closed) — otherwise drop it.
    let hasStash = false;
    try { hasStash = sessionStorage.getItem("prompt-lib:realsession") !== null; } catch (e) {}
    if (hasStash) { Store.setSession(session); bootApp(); return; }
    Store.clearSession();
    renderGate();
    return;
  }
  if (session && session.backend) { Store.setSession(session); bootApp(); return; }
  const r = session && resolveAccessCode(session.code);
  if (session && r && !r.disabled) {
    Store.setSession(session);
    bootApp();
  } else {
    if (session) { try { localStorage.removeItem("prompt-lib:session"); } catch (e) {} }
    renderGate(r && r.disabled ? "Your previous access code has been disabled." : "");
  }
}
initApp();
</script>
