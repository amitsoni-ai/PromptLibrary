/* ---------- Access gate ---------- */
function renderGate(prefillMsg) {
  const root = document.getElementById("gate-root");
  root.innerHTML = `
  <div class="gate">
    <div class="gate-card">
      <div class="gate-mark">
        <svg viewBox="0 0 24 24" fill="none" stroke="#fff" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M12 3v3M12 18v3M4.2 4.2l2.1 2.1M17.7 17.7l2.1 2.1M3 12h3M18 12h3M4.2 19.8l2.1-2.1M17.7 6.3l2.1-2.1"/><circle cx="12" cy="12" r="3.4"/></svg>
      </div>
      <h1>Synottic Prompt Library</h1>
      <p class="sub">Enter the access code from your program to open the library assigned to your cohort.</p>
      <label for="gate-code">Access code</label>
      <input id="gate-code" type="text" autocomplete="off" spellcheck="false" placeholder="e.g. SYNOTTIC-AI-01" />
      <div id="gate-resolved"></div>
      <div id="gate-name-wrap" hidden>
        <label for="gate-name" style="margin-top:14px;">Your name <span style="font-weight:400;color:var(--text-faint)">(optional — for your saved work)</span></label>
        <input id="gate-name" class="name-input" type="text" autocomplete="name" placeholder="First Last" />
      </div>
      <div class="gate-error" id="gate-error"></div>
      <button class="btn btn-primary" id="gate-enter" disabled>Enter library</button>
      <div class="gate-hint">
        Evaluating? Try <code data-fill="DEMO-2026">DEMO-2026</code> ·
        <code data-fill="SYNOTTIC-PM-01">SYNOTTIC-PM-01</code> ·
        <code data-fill="ACME-SALES-EMEA">ACME-SALES-EMEA</code> (program-scoped) ·
        <code data-fill="NORTHWIND-WRITE">NORTHWIND-WRITE</code>
      </div>
    </div>
  </div>`;
  const codeI = root.querySelector("#gate-code");
  const nameWrap = root.querySelector("#gate-name-wrap");
  const nameI = root.querySelector("#gate-name");
  const resolvedEl = root.querySelector("#gate-resolved");
  const errEl = root.querySelector("#gate-error");
  const enterBtn = root.querySelector("#gate-enter");
  let resolved = null;

  function check() {
    const val = codeI.value.trim();
    resolved = val ? resolveAccessCode(val) : null;
    if (!val) { resolvedEl.innerHTML = ""; nameWrap.hidden = true; enterBtn.disabled = true; errEl.textContent = ""; return; }
    if (!resolved) {
      resolvedEl.innerHTML = "";
      nameWrap.hidden = true;
      enterBtn.disabled = true;
      errEl.textContent = "That code isn't recognised. Check with your program lead.";
      return;
    }
    errEl.textContent = "";
    const scopeNote = resolved.program.scope === "program"
      ? "Access is limited to this program's categories."
      : "Full library access, with content recommended for your program.";
    resolvedEl.innerHTML = `<div class="gate-resolved"><b>${escapeHtml(resolved.org.name)}</b><br>${escapeHtml(resolved.program.name)} · ${escapeHtml(resolved.cohort.name)}<br><span style="opacity:.8">${scopeNote}</span></div>`;
    nameWrap.hidden = false;
    if (resolved.learner && !nameI.value) nameI.value = resolved.learner.name;
    enterBtn.disabled = false;
  }
  codeI.addEventListener("input", check);
  root.querySelectorAll("[data-fill]").forEach((c) => c.addEventListener("click", () => { codeI.value = c.dataset.fill; check(); codeI.focus(); }));
  function enter() {
    if (!resolved) { resolved = resolveAccessCode(codeI.value); check(); }
    if (!resolved) return;
    const s = {
      code: resolved.code,
      orgId: resolved.org.id,
      programId: resolved.program.id,
      cohortId: resolved.cohort.id,
      learnerId: resolved.learner ? resolved.learner.id : null,
      name: (nameI.value.trim() || (resolved.learner && resolved.learner.name) || "Learner"),
      startedAt: Date.now(),
    };
    Store.setSession(s);
    bootApp();
  }
  enterBtn.addEventListener("click", enter);
  codeI.addEventListener("keydown", (e) => { if (e.key === "Enter") { e.preventDefault(); enter(); } });
  nameI.addEventListener("keydown", (e) => { if (e.key === "Enter") { e.preventDefault(); enter(); } });
  codeI.focus();
  if (prefillMsg) errEl.textContent = prefillMsg;
}
function signOut() {
  Store.clearSession();
  location.reload();
}

/* ---------- Home ---------- */
function greeting() {
  const h = new Date().getHours();
  return h < 12 ? "Good morning" : h < 18 ? "Good afternoon" : "Good evening";
}
function promptOfTheDay() {
  const pool = scopedLibrary().filter((r) => r.qualityScore >= 72 && r.lifecycle !== "Archived" && !(r.flags && r.flags.modelSpecific));
  if (!pool.length) return scopedLibrary()[0];
  const day = Math.floor(Date.now() / 86400000);
  return pool[hashStr("potd" + day) % pool.length];
}
function recommendedForYou(limit) {
  limit = limit || 6;
  const usage = Store.getUsage();
  const seen = new Set(Object.keys(usage.counts));
  const favs = Store.getFavorites();
  const sc = currentScope();
  let pool;
  if (sc && sc.program) {
    pool = programPromptIds(sc.program.id).map(findPromptById).filter(Boolean);
  } else pool = scopedLibrary().slice();
  // skill-level bias: learners who've engaged little get Beginner/Intermediate first
  const engaged = seen.size + favs.size;
  const levelRank = engaged < 4 ? { Beginner: 0, Intermediate: 1, Advanced: 2 } : engaged < 15 ? { Intermediate: 0, Beginner: 1, Advanced: 1 } : { Advanced: 0, Intermediate: 1, Beginner: 2 };
  const scored = pool
    .filter((r) => !seen.has(r.id))
    .map((r) => {
      let s = r.qualityScore * 0.4;
      s -= (levelRank[r.difficulty] || 1) * 12;
      // nudge toward categories/skills the learner already favorited
      const favRecs = Array.from(favs).map(findPromptById).filter(Boolean);
      if (favRecs.some((fr) => fr.category === r.category)) s += 10;
      if (favRecs.some((fr) => fr.skill === r.skill)) s += 6;
      s += (hashStr(r.id) % 7);
      return [s, r];
    });
  scored.sort((a, b) => b[0] - a[0]);
  return scored.slice(0, limit).map((x) => x[1]);
}
function renderHome(container) {
  const q = STATE.query.trim();
  const s = Store.getSession();
  const sc = currentScope();
  let html = `
  <div class="hero">
    <div class="greeting">${greeting()}${s && s.name ? ", " + escapeHtml(s.name.split(" ")[0]) : ""}${sc && sc.program ? " · " + escapeHtml(sc.program.name) : ""}</div>
    <h1>What do you want to accomplish?</h1>
    <div class="search-hero">
      ${icon("search", "icon-search")}
      <input type="text" id="hero-search" placeholder="Search by goal, task, role, problem, outcome, or keyword…" value="${escapeHtml(STATE.query)}" autocomplete="off"/>
      ${q ? `<button class="icon-clear" id="hero-clear" aria-label="Clear search">${icon("x")}</button>` : ""}
    </div>
    ${!q ? `<div class="search-examples">${SEARCH_EXAMPLES.map((x) => `<button class="search-example-chip" data-example="${escapeHtml(x)}">${escapeHtml(x)}</button>`).join("")}</div>` : ""}
  </div>`;

  if (q) {
    html += `<div id="home-results"></div>`;
    container.innerHTML = html;
    renderResultsInto(container.querySelector("#home-results"), { compactFilters: true });
    wireHomeStatic(container);
  } else {
    const potd = promptOfTheDay();
    const recs = recommendedForYou(6);
    const recent = Store.getUsage().recent.map((r) => findPromptById(r.id)).filter(Boolean).slice(0, 5);
    html += `
    <div class="quick-actions">
      <button class="quick-action" data-nav="search">${icon("search")}<span class="quick-action-label">Prompt Library</span></button>
      <button class="quick-action" data-nav="program">${icon("path")}<span class="quick-action-label">My Program</span></button>
      <button class="quick-action" data-nav="learn">${icon("book")}<span class="quick-action-label">Learn</span></button>
      <button class="quick-action" data-nav="practice">${icon("target")}<span class="quick-action-label">Practice</span></button>
      <button class="quick-action" data-nav="myLibrary">${icon("folder")}<span class="quick-action-label">My Library</span></button>
      <button class="quick-action" data-nav="favorites">${icon("star")}<span class="quick-action-label">Favorites</span></button>
    </div>

    ${potd ? `<div class="potd" data-id="${potd.id}" role="button" tabindex="0">
      <div>
        <div class="potd-badge">Prompt of the day</div>
        <h3>${escapeHtml(potd.title)}</h3>
        <p>${escapeHtml(potd.description)}</p>
        <div style="margin-top:8px;">${renderDifficulty(potd.difficulty)} &nbsp; ${renderQualityPill(potd.qualityScore)}</div>
      </div>
    </div>` : ""}

    <div class="section-title"><h2>Recommended for you</h2><button class="linklike" data-nav="${sc && sc.program ? "program" : "search"}">See more</button></div>
    ${recs.length ? `<div class="rec-grid" id="rec-grid">${recs.map((r) => promptCardHtml(r)).join("")}</div>`
      : `<div class="empty-mini">As you favorite and use prompts, recommendations will sharpen. For now, start from your program or a search.</div>`}

    <div class="section-title"><h2>Explore by goal</h2></div>
    <div class="goal-grid">${GOALS.map((g) => `<button class="goal-chip" data-goal="${escapeHtml(g.label)}">${escapeHtml(g.label)}</button>`).join("")}</div>

    <div class="section-title"><h2>Recently used</h2>${recent.length ? `<button class="linklike" data-nav="favorites">See all</button>` : ""}</div>
    <div class="mini-list" style="margin-bottom:24px;">
      ${recent.length ? recent.map((r) => `<div class="mini-item" data-id="${r.id}" role="button" tabindex="0">${renderQualityPill(r.qualityScore)}<span class="mini-item-title">${escapeHtml(r.title)}</span></div>`).join("")
        : `<div class="empty-mini">Prompts you open, copy, or test show up here.</div>`}
    </div>`;
    container.innerHTML = html;
    wireHomeStatic(container);
    wireCardActions(container.querySelector("#rec-grid") || container);
  }

  const input = container.querySelector("#hero-search");
  if (input) {
    input.focus();
    input.setSelectionRange(input.value.length, input.value.length);
    input.addEventListener("input", debounce((e) => { setQuery(e.target.value); }, 180));
  }
  const clearBtn = container.querySelector("#hero-clear");
  if (clearBtn) clearBtn.addEventListener("click", () => setQuery(""));
}
function wireHomeStatic(container) {
  container.querySelectorAll("[data-example]").forEach((el) => el.addEventListener("click", () => setQuery(el.dataset.example)));
  container.querySelectorAll("[data-goal]").forEach((el) => el.addEventListener("click", () => {
    const g = GOALS.find((x) => x.label === el.dataset.goal);
    STATE.filters = emptyFilters();
    if (g.promptType) STATE.filters.promptType = g.promptType;
    STATE.query = g.query || "";
    navigate("search");
  }));
  container.querySelectorAll("[data-nav]").forEach((el) => el.addEventListener("click", () => navigate(el.dataset.nav)));
  container.querySelectorAll(".mini-item, .potd").forEach((el) => {
    el.addEventListener("click", () => openDetail(el.dataset.id));
    el.addEventListener("keydown", (e) => { if (e.key === "Enter") openDetail(el.dataset.id); });
  });
}

function renderResultsInto(el, opts) {
  opts = opts || {};
  const results = computeResults(STATE.query, STATE.filters, STATE.sort, opts.baseCorpus);
  let html = "";
  if (!opts.compactFilters) html += renderFilterBar(STATE);
  const scopeTag = isScopeRestricted() && !opts.baseCorpus ? ` · scoped to ${escapeHtml((currentScope().program || {}).name || "your program")}` : "";
  html += `<div class="result-count">${results.length.toLocaleString()} prompt${results.length === 1 ? "" : "s"}${scopeTag}</div><div id="results-list-target"></div>`;
  el.innerHTML = html;
  wireFilterBar(el, () => renderResultsInto(el, opts));
  renderPaginatedList(el.querySelector("#results-list-target"), results, {});
}
function renderSearchView(container) {
  container.innerHTML = `<div id="search-results"></div>`;
  renderResultsInto(container.querySelector("#search-results"), {});
}

/* ---------- Categories ---------- */
function renderCategoriesView(container) {
  const lib = scopedLibrary();
  const counts = {};
  lib.forEach((r) => { counts[r.category] = (counts[r.category] || 0) + 1; });
  let cats = CATEGORIES.filter((c) => counts[c.name]).map((c) => Object.assign({}, c, { count: counts[c.name] }));
  const maxCount = Math.max(1, ...cats.map((c) => c.count));
  const q = STATE.query.trim().toLowerCase();
  const shown = q ? cats.filter((c) => c.name.toLowerCase().includes(q) || (c.role || "").toLowerCase().includes(q)) : cats;
  container.innerHTML = `
    <div class="section-title"><h2>Categories</h2><span style="font-size:12px;color:var(--text-faint)">${q ? `${shown.length} of ${cats.length} match "${escapeHtml(STATE.query.trim())}"` : `${cats.length} categories${isScopeRestricted() ? " in your program scope" : " · preserved from the source library"}`}</span></div>
    <div class="category-grid">
      ${shown.map((c) => `
        <button class="category-card" data-category="${escapeHtml(c.name)}">
          <div class="category-card-name">${escapeHtml(c.name)}</div>
          <div class="category-card-count">${c.count.toLocaleString()} prompts · ${escapeHtml(c.role || CATEGORY_SKILL[c.name] || "")}</div>
          <div class="category-card-bar"><i style="width:${(c.count / maxCount) * 100}%"></i></div>
        </button>`).join("")}
    </div>
    ${!shown.length ? emptyStateHtml("grid", "No categories match", "Try a different word, or clear the search.") : ""}`;
  container.querySelectorAll("[data-category]").forEach((el) => el.addEventListener("click", () => {
    STATE.activeCategory = el.dataset.category;
    STATE.query = "";
    STATE.filters = emptyFilters();
    STATE.filters.category = el.dataset.category;
    navigate("categoryDetail");
  }));
}
function renderCategoryDetail(container) {
  const cat = STATE.activeCategory;
  const meta = CATEGORIES.find((c) => c.name === cat);
  if (!meta) { navigate("categories"); return; }
  const inCat = scopedLibrary().filter((r) => r.category === cat);
  const byType = {};
  inCat.forEach((r) => { byType[r.promptType] = (byType[r.promptType] || 0) + 1; });
  const topTypes = Object.entries(byType).sort((a, b) => b[1] - a[1]).slice(0, 4);
  container.innerHTML = `
    <button class="btn btn-ghost btn-sm" data-nav="categories" style="margin-bottom:12px;">← All categories</button>
    <div class="section-title" style="margin-bottom:6px;"><h2 style="font-size:20px;">${escapeHtml(cat)}</h2></div>
    <div style="color:var(--text-muted); font-size:13px; margin-bottom:14px;">${inCat.length.toLocaleString()} prompts · skill: ${escapeHtml(CATEGORY_SKILL[cat] || "General")} · typically used by a ${escapeHtml(meta.role)}</div>
    <div style="display:flex; gap:6px; flex-wrap:wrap; margin-bottom:20px;">${topTypes.map(([t, n]) => `<span class="chip">${escapeHtml(t)} · ${n}</span>`).join("")}</div>
    <div id="cat-results"></div>`;
  container.querySelector("[data-nav]").addEventListener("click", () => { STATE.query = ""; navigate("categories"); });
  renderResultsInto(container.querySelector("#cat-results"), {});
}

/* ---------- Program Library ---------- */
function renderProgramView(container) {
  const sc = currentScope();
  if (!sc || !sc.program) { container.innerHTML = emptyStateHtml("path", "No program attached", "Your access code isn't linked to a program."); return; }
  const prog = sc.program;
  const progress = Store.getProgress();
  const mods = prog.modules || [];
  const touched = mods.filter((m) => progress.modulesTouched[m.id]).length;
  const pct = mods.length ? Math.round((touched / mods.length) * 100) : 0;
  const openMods = STATE.openModules || (STATE.openModules = {});

  container.innerHTML = `
    <div class="program-header">
      <div class="ph-path">${escapeHtml(sc.org.name)} › ${escapeHtml(prog.name)} › ${escapeHtml(sc.cohort.name)}</div>
      <h2>${escapeHtml(prog.name)}</h2>
      <div class="ph-desc">${escapeHtml(prog.description)}</div>
      <div style="display:flex;gap:6px;flex-wrap:wrap;margin-top:10px;">${(prog.skillFocus || []).map((s) => `<span class="chip chip-blue">${escapeHtml(s)}</span>`).join("")}</div>
      <div class="progress-track"><i style="width:${pct}%"></i></div>
      <div style="font-size:11.5px;color:var(--text-faint);margin-top:6px;">${touched} of ${mods.length} modules opened${pct ? " · " + pct + "%" : ""} — progress reflects only modules you've actually viewed.</div>
    </div>
    <div class="section-title"><h2>Modules</h2><span style="font-size:12px;color:var(--text-faint)">Prompts recommended for this program</span></div>
    <div id="module-list"></div>`;

  const list = container.querySelector("#module-list");
  list.innerHTML = mods.map((m, i) => {
    const ids = MODULE_PROMPTS[m.id] || [];
    const isOpen = openMods[m.id];
    return `
    <div class="module-card">
      <div class="module-head" data-mod="${m.id}">
        <div class="module-num">${i + 1}</div>
        <div style="flex:1;">
          <div class="module-title">${escapeHtml(m.name)}</div>
          <div style="font-size:12px;color:var(--text-muted);">${escapeHtml(m.summary)}</div>
        </div>
        <span class="nav-count">${ids.length} prompts</span>
        ${progress.modulesTouched[m.id] ? `<span class="chip chip-accent">Opened</span>` : ""}
        <span style="transform:rotate(${isOpen ? 90 : 0}deg);transition:transform .15s;color:var(--text-faint);">${icon("chevronRight")}</span>
      </div>
      ${isOpen ? `<div class="module-body" id="mb-${m.id}"></div>` : ""}
    </div>`;
  }).join("");

  list.querySelectorAll("[data-mod]").forEach((head) => head.addEventListener("click", () => {
    const id = head.dataset.mod;
    openMods[id] = !openMods[id];
    if (openMods[id]) Store.markModuleViewed(id);
    renderProgramView(container);
  }));
  mods.forEach((m) => {
    if (!openMods[m.id]) return;
    const body = container.querySelector("#mb-" + m.id);
    if (!body) return;
    const recs = (MODULE_PROMPTS[m.id] || []).map(findPromptById).filter(Boolean);
    renderPaginatedList(body, recs, {});
  });
}

/* ---------- Learn ---------- */
const LESSONS = [
  { key: "role", principle: "Give the model a role", dim: "clarity",
    text: "Prompts that open with “Act as a…” put the model in a specific point of view. The same request answered “as a CFO” versus “as a marketer” produces different, more useful output. Look at how these prompts set a role up front.",
    match: (r) => /\b(act as|you are an?|as an? (expert|experienced|senior|professional)|role[:]|imagine you)\b/i.test(r.originalPrompt) },
  { key: "context", principle: "Supply real context", dim: "context",
    text: "The model can only tailor an answer to what you tell it. Strong prompts state the audience, the situation, and the goal — not just the task. Notice how much situational detail these carry before they ask for anything.",
    match: (r) => (r.qualityBreakdown || {}).context >= 70 && CONTEXT_CUES.test(r.originalPrompt) },
  { key: "specificity", principle: "Be concrete, not general", dim: "specificity",
    text: "Vague prompts get vague answers. Effective prompts name numbers, formats, examples and boundaries. These examples show how specificity narrows the response to something you can actually use.",
    match: (r) => (r.qualityBreakdown || {}).specificity >= 80 && /\d/.test(r.originalPrompt) },
  { key: "output", principle: "Define the output shape", dim: "outputDefinition",
    text: "If you don't say what the answer should look like, you get a wall of text. Strong prompts ask for a table, a numbered list, a word count, or a template. See how these state the format explicitly.",
    match: (r) => (r.qualityBreakdown || {}).outputDefinition >= 80 && OUTPUT_CUES.test(r.originalPrompt) },
  { key: "reuse", principle: "Build it to be reused", dim: "reusability",
    text: "A prompt with [placeholders] becomes a pattern you run again and again. These templated prompts turn a one-time answer into a repeatable workflow.",
    match: (r) => r.isTemplate && (r.variables || []).length >= 2 },
];
function renderLearnView(container) {
  const lib = scopedLibrary();
  const progress = Store.getProgress();
  const done = Object.keys(progress.learnedLessons).length;
  container.innerHTML = `
    <div class="section-title"><h2>Learn</h2><span style="font-size:12px;color:var(--text-faint)">${done} of ${LESSONS.length} principles reviewed</span></div>
    <p class="prose" style="max-width:640px;margin-bottom:20px;color:var(--text-muted);">Five things separate a prompt that works from one that doesn't. Each principle below is shown with real prompts from the library that demonstrate it well. Open any prompt to read its full <b>Why it works</b> breakdown, then try writing your own in <b>Practice</b>.</p>
    <div id="lesson-list"></div>
    <div class="section-title" style="margin-top:10px;"><h2>Keep going</h2></div>
    <div style="display:flex;gap:8px;flex-wrap:wrap;">
      <button class="btn" data-nav="practice">${icon("target")} Practice writing prompts</button>
      <button class="btn" data-nav="builder">${icon("build")} Open the Prompt Builder</button>
    </div>`;
  const list = container.querySelector("#lesson-list");
  const usedIds = new Set();
  list.innerHTML = LESSONS.map((L) => {
    const examples = lib.slice()
      .filter((r) => r.lifecycle !== "Archived" && !usedIds.has(r.id) && L.match(r))
      .sort((a, b) => ((b.qualityBreakdown || {})[L.dim] - (a.qualityBreakdown || {})[L.dim]) || (b.qualityScore - a.qualityScore))
      .slice(0, 3);
    examples.forEach((r) => usedIds.add(r.id));
    return `
    <div class="lesson-card">
      <div class="lesson-principle">Principle · ${escapeHtml(L.principle)}</div>
      <h3>${escapeHtml(L.principle)}</h3>
      <div class="lesson-text">${escapeHtml(L.text)}</div>
      <div class="related-grid">
        ${examples.map((r) => `<div class="mini-item" data-id="${r.id}" role="button" tabindex="0" style="border:1px solid var(--border);border-radius:var(--radius-sm);padding:8px 10px;">
          ${renderQualityPill(r.qualityScore)}<span class="mini-item-title">${escapeHtml(r.title)}</span><span class="chip">${escapeHtml(r.category)}</span></div>`).join("")}
      </div>
      <button class="btn btn-sm ${progress.learnedLessons[L.key] ? "" : "btn-primary"}" data-lesson="${L.key}" style="margin-top:12px;">${progress.learnedLessons[L.key] ? icon("check") + " Reviewed" : "Mark as reviewed"}</button>
    </div>`;
  }).join("");
  list.querySelectorAll("[data-id]").forEach((el) => el.addEventListener("click", () => openDetail(el.dataset.id)));
  list.querySelectorAll("[data-lesson]").forEach((b) => b.addEventListener("click", () => { Store.markLessonLearned(b.dataset.lesson); renderLearnView(container); }));
  container.querySelectorAll("[data-nav]").forEach((el) => el.addEventListener("click", () => navigate(el.dataset.nav)));
}

/* ---------- Practice ---------- */
const SCENARIOS = [
  { id: "sc-1", role: "Team lead", title: "Kick off a project retro", situation: "Your squad just shipped a delayed feature. Morale is low and you want a blameless retrospective that produces 3 concrete changes.", goal: "A prompt that gets AI to design and facilitate the retro agenda." },
  { id: "sc-2", role: "Marketing manager", title: "Launch announcement email", situation: "You're launching a pricing change to 40,000 existing customers next Tuesday. Some will be unhappy.", goal: "A prompt that drafts a clear, non-defensive announcement email." },
  { id: "sc-3", role: "Product manager", title: "Turn interviews into insights", situation: "You have 8 raw customer-interview transcripts and need themes, not a summary of each call.", goal: "A prompt that synthesises cross-cutting themes with supporting quotes." },
  { id: "sc-4", role: "People partner", title: "Prep a hard conversation", situation: "A strong performer has been dismissive in meetings. You have a 1:1 tomorrow.", goal: "A prompt that helps you plan the conversation and anticipate reactions." },
  { id: "sc-5", role: "Founder", title: "Pressure-test a strategy", situation: "You've written a one-page plan to enter a new market and want the holes found before the board sees it.", goal: "A prompt that critiques the plan as a skeptical investor would." },
  { id: "sc-6", role: "Support lead", title: "Rewrite a canned response", situation: "Your refund macro sounds robotic and customers escalate after receiving it.", goal: "A prompt that rewrites the macro to be warm but still policy-accurate." },
];
function rubricScore(text) {
  const t = text.trim();
  const low = t.toLowerCase();
  const wc = t.split(/\s+/).filter(Boolean).length;
  const nVars = extractPlaceholders(t).length;
  function clamp(n) { return Math.max(5, Math.min(100, Math.round(n))); }
  const goal = clamp((/\b(act as|you are|your task|objective|goal is|help me|write|draft|create|design|analyse|analyze|summar)/i.test(low) ? 62 : 30) + Math.min(wc, 40) * 0.4);
  const context = clamp((/\b(context|audience|situation|currently|background|our|my team|customers?|stakeholders?|because|given)/i.test(low) ? 55 : 22) + (nVars >= 1 ? 15 : 0) + (wc > 40 ? 15 : 0));
  const specificity = clamp((/\d/.test(t) ? 20 : 0) + (nVars * 10) + (/\b(example|specifically|such as|e\.g\.|include|must|exactly|tone|audience)\b/i.test(low) ? 35 : 18) + Math.min(wc, 60) * 0.35);
  const constraints = clamp((/\b(don'?t|do not|avoid|no more than|under \d|within|limit|keep it|concise|word|constraint|must not|only)\b/i.test(low) ? 60 : 20) + (/\btone\b/i.test(low) ? 15 : 0));
  const output = clamp((OUTPUT_CUES.test(t) ? 58 : 22) + (/\b(format|bullet|table|numbered|sections?|headings?|steps?|template|json|markdown)\b/i.test(low) ? 25 : 0));
  const overall = Math.round(goal * 0.2 + context * 0.25 + specificity * 0.22 + constraints * 0.16 + output * 0.17);
  const notes = {
    goal: goal >= 65 ? "The ask is clear." : "State plainly what you want the AI to do — start with a verb or a role.",
    context: context >= 65 ? "Good situational detail." : "Add who it's for and what's going on around this task.",
    specificity: specificity >= 65 ? "Concrete enough to act on." : "Name specifics: numbers, examples, tone, or [placeholders] for reuse.",
    constraints: constraints >= 60 ? "Boundaries are set." : "Add limits — length, what to avoid, tone to hold.",
    output: output >= 60 ? "Output shape is defined." : "Say what the answer should look like (list, table, sections, word count).",
  };
  return { axes: { goal, context, specificity, constraints, output }, overall: clamp(overall), notes };
}
function modelAnswerFor(sc) {
  return [
    `Role: Act as an experienced ${sc.role.toLowerCase()}.`,
    `Objective: ${sc.goal.replace(/^A prompt that /, "").replace(/\.$/, "")}.`,
    `Context: ${sc.situation}`,
    `Inputs I'll provide: [any specifics — names, numbers, prior drafts].`,
    `Constraints: Be direct and practical; no filler; hold a calm, professional tone.`,
    `Output format: Give me (1) a short plan, then (2) the finished artefact, then (3) two things that could go wrong and how to handle them.`,
  ].join("\n");
}
function renderPracticeView(container) {
  if (!STATE.practice) STATE.practice = { scenarioId: SCENARIOS[0].id, draft: "", result: null, showModel: false };
  const P = STATE.practice;
  const sc = SCENARIOS.find((s) => s.id === P.scenarioId) || SCENARIOS[0];
  const history = Store.getProgress().practice;
  container.innerHTML = `
    <div class="section-title"><h2>Practice</h2><span style="font-size:12px;color:var(--text-faint)">${history.length} attempt${history.length === 1 ? "" : "s"} logged</span></div>
    <div class="form-field" style="max-width:420px;">
      <label>Scenario</label>
      <select id="pr-scenario">${SCENARIOS.map((s) => `<option value="${s.id}" ${s.id === P.scenarioId ? "selected" : ""}>${escapeHtml(s.title)}</option>`).join("")}</select>
    </div>
    <div class="scenario-card">
      <div class="sc-role">${escapeHtml(sc.role)}</div>
      <h3>${escapeHtml(sc.title)}</h3>
      <p><b>Situation.</b> ${escapeHtml(sc.situation)}</p>
      <p style="margin-top:6px;"><b>Your job.</b> Write the prompt you'd give an AI assistant. ${escapeHtml(sc.goal)}</p>
    </div>
    <div class="form-field">
      <label>Your prompt</label>
      <textarea id="pr-draft" rows="7" placeholder="Write your prompt here…">${escapeHtml(P.draft)}</textarea>
    </div>
    <div style="display:flex;gap:8px;flex-wrap:wrap;">
      <button class="btn btn-primary" id="pr-feedback">${icon("check")} Get feedback</button>
      <button class="btn" id="pr-model">${P.showModel ? "Hide" : "Show"} a model answer</button>
      <button class="btn btn-ghost" id="pr-reset">Clear</button>
    </div>
    <div id="pr-result" style="margin-top:18px;"></div>
    ${P.showModel ? `<div class="detail-section" style="margin-top:16px;"><div class="block-header"><span class="label">One way to write it</span><button class="btn btn-sm" id="pr-copy-model">${icon("copy")} Copy</button></div><div class="prompt-block">${escapeHtml(modelAnswerFor(sc))}</div></div>` : ""}
    ${history.length ? `<div class="section-title" style="margin-top:24px;"><h2>Your recent attempts</h2></div>
      <div class="results-list">${history.slice(0, 6).map((h) => `<div class="mini-item" style="border:1px solid var(--border);border-radius:var(--radius-sm);padding:8px 12px;">
        <span class="quality-pill ${qualityClass(h.overall)}"><span class="quality-bar"><i style="width:${h.overall}%"></i></span>${h.overall}</span>
        <span class="mini-item-title">${escapeHtml(h.scenarioTitle)}</span>
        <span style="color:var(--text-faint);font-size:11px;flex:none;">${timeAgo(h.ts)}</span></div>`).join("")}</div>` : ""}`;

  const draftEl = container.querySelector("#pr-draft");
  container.querySelector("#pr-scenario").addEventListener("change", (e) => { P.scenarioId = e.target.value; P.result = null; renderPracticeView(container); });
  draftEl.addEventListener("input", () => { P.draft = draftEl.value; });
  container.querySelector("#pr-model").addEventListener("click", () => { P.showModel = !P.showModel; renderPracticeView(container); });
  container.querySelector("#pr-reset").addEventListener("click", () => { P.draft = ""; P.result = null; renderPracticeView(container); });
  const copyModel = container.querySelector("#pr-copy-model");
  if (copyModel) copyModel.addEventListener("click", async () => { const ok = await copyText(modelAnswerFor(sc)); showToast(ok ? "Copied" : "Couldn't copy"); });
  container.querySelector("#pr-feedback").addEventListener("click", () => {
    const text = draftEl.value.trim();
    if (text.length < 15) { showToast("Write a bit more first"); return; }
    const r = rubricScore(text);
    P.result = r;
    Store.addPracticeAttempt({ ts: Date.now(), scenarioId: sc.id, scenarioTitle: sc.title, overall: r.overall, axes: r.axes });
    const box = container.querySelector("#pr-result");
    box.innerHTML = practiceFeedbackHtml(r);
    renderSidebarFooter();
  });
  if (P.result) container.querySelector("#pr-result").innerHTML = practiceFeedbackHtml(P.result);
}
function practiceFeedbackHtml(r) {
  const rows = [["goal", "Goal"], ["context", "Context"], ["specificity", "Specificity"], ["constraints", "Constraints"], ["output", "Output"]];
  return `
    <div class="detail-section">
      <div class="block-header"><span class="label">Feedback</span><span class="quality-pill ${qualityClass(r.overall)}"><span class="quality-bar"><i style="width:${r.overall}%"></i></span>${r.overall}</span><span style="font-size:11.5px;color:var(--text-faint)">deterministic rubric — no score is invented</span></div>
      <div class="rubric">
        ${rows.map(([k, label]) => `
          <div class="rubric-row">
            <span class="rl">${label}</span>
            <span class="rt"><i class="${qualityClass(r.axes[k])}" style="width:${r.axes[k]}%;background:${r.axes[k] >= 65 ? "var(--accent)" : r.axes[k] >= 45 ? "var(--good-blue)" : "var(--warn)"};"></i></span>
            <span class="rv">${r.axes[k]}</span>
            <span class="rubric-note">${escapeHtml(r.notes[k])}</span>
          </div>`).join("")}
      </div>
    </div>`;
}
