/* ---------- Org model resolution ---------- */
let ORG_MODEL = null;
let ORG_INDEX = { orgs: {}, programs: {}, cohorts: {}, learners: {}, codes: {} };

function buildOrgIndex(model) {
  const idx = { orgs: {}, programs: {}, cohorts: {}, learners: {}, codes: {} };
  (model.organizations || []).forEach((o) => (idx.orgs[o.id] = o));
  (model.programs || []).forEach((p) => (idx.programs[p.id] = p));
  (model.cohorts || []).forEach((c) => (idx.cohorts[c.id] = c));
  (model.learners || []).forEach((l) => (idx.learners[l.id] = l));
  (model.accessCodes || []).forEach((a) => (idx.codes[a.code.toUpperCase().trim()] = a));
  return idx;
}
function resolveStaticAccessCode(raw) {
  const code = (raw || "").toUpperCase().trim().replace(/\s+/g, "");
  const entry = ORG_INDEX.codes[code] || ORG_INDEX.codes[code.replace(/[^A-Z0-9-]/g, "")];
  if (!entry) return null;
  const cohort = ORG_INDEX.cohorts[entry.cohortId];
  if (!cohort) return null;
  const program = ORG_INDEX.programs[cohort.programId];
  const org = program ? ORG_INDEX.orgs[program.orgId] : null;
  const learner = entry.learnerId ? ORG_INDEX.learners[entry.learnerId] : null;
  return { entry, code, cohort, program, org, learner };
}
/* Merges admin-console codes (AdminStore) with the built-in seed codes.
   AdminStore is defined in the admin module, loaded before initApp runs. */
function resolveAccessCode(raw) {
  const code = (raw || "").toUpperCase().trim().replace(/\s+/g, "");
  if (typeof AdminStore !== "undefined") {
    const adm = AdminStore.getCode(code);
    if (adm) {
      if (adm.enabled === false) return { disabled: true, code: adm.code, adminCode: adm, kind: "admin" };
      const programs = (adm.programIds || []).map((id) => ORG_INDEX.programs[id]).filter(Boolean);
      return {
        kind: "admin", code: adm.code, adminCode: adm,
        org: { id: "adm-" + adm.id, name: adm.orgName, shortName: adm.orgName },
        program: programs[0] || null, programs, cohort: null, learner: null,
      };
    }
  }
  return resolveStaticAccessCode(raw);
}
function currentScope() {
  const s = Store.getSession();
  if (!s) return null;
  if (s.kind === "admin") {
    const programs = (s.programIds || []).map((id) => ORG_INDEX.programs[id]).filter(Boolean);
    return {
      session: s, admin: s,
      org: { id: s.orgId, name: s.orgName, shortName: s.orgName },
      program: programs.length === 1 ? programs[0] : null,
      programs, cohort: null,
    };
  }
  const program = ORG_INDEX.programs[s.programId] || null;
  const cohort = ORG_INDEX.cohorts[s.cohortId] || null;
  const org = ORG_INDEX.orgs[s.orgId] || null;
  return { session: s, program, cohort, org };
}
/* Categories an admin-code learner may browse (empty/null => whole library). */
function adminScopeCategories(s) {
  if (!s || s.fullLibrary) return null;
  const cats = new Set();
  (s.functions || []).forEach((f) => (typeof FUNCTIONS !== "undefined" && FUNCTIONS[f] ? FUNCTIONS[f].categories : []).forEach((c) => cats.add(c)));
  (s.programIds || []).forEach((pid) => ((ORG_INDEX.programs[pid] || {}).categories || []).forEach((c) => cats.add(c)));
  return cats;
}

/* Resolve each program module's prompt list from its rules, once. Central
   prompts are referenced by id — never copied. */
let MODULE_PROMPTS = {};   // moduleId -> [recordIds]
function resolveModulePrompts() {
  MODULE_PROMPTS = {};
  (ORG_MODEL.programs || []).forEach((prog) => {
    (prog.modules || []).forEach((mod) => {
      const r = mod.rules || {};
      const cats = new Set(r.categories || []);
      const kws = (r.keywords || []).map((k) => k.toLowerCase());
      const inCat = ALL_PROMPTS.filter((rec) => {
        if (cats.size && !cats.has(rec.category)) return false;
        if (r.difficulty && rec.difficulty !== r.difficulty) return false;
        return rec.lifecycle !== "Archived";
      });
      let pool = inCat.filter((rec) => {
        if (!kws.length) return true;
        const hay = (rec.title + " " + rec.description + " " + rec.originalPrompt + " " + (rec.tags || []).join(" ")).toLowerCase();
        return kws.some((k) => hay.includes(k));
      });
      // keyword rules can be too tight for smaller categories — fall back to
      // the strongest prompts in the module's categories so no module is thin.
      if (pool.length < 6) {
        const have = new Set(pool.map((x) => x.id));
        inCat.slice().sort((a, b) => b.qualityScore - a.qualityScore).forEach((rec) => {
          if (pool.length < (r.limit || 10) && !have.has(rec.id)) { pool.push(rec); have.add(rec.id); }
        });
      }
      pool.sort((a, b) => b.qualityScore - a.qualityScore);
      MODULE_PROMPTS[mod.id] = pool.slice(0, r.limit || 10).map((x) => x.id);
    });
  });
}
function programPromptIds(programId) {
  const prog = ORG_INDEX.programs[programId];
  if (!prog) return [];
  const ids = new Set();
  (prog.modules || []).forEach((m) => (MODULE_PROMPTS[m.id] || []).forEach((id) => ids.add(id)));
  return Array.from(ids);
}
/* Which central prompts is this learner allowed to browse?
   scope "full"  -> the whole library.
   scope "program" -> only the program's categories + explicitly linked prompts. */
function scopedLibrary() {
  const s = Store.getSession();
  if (s && s.kind === "admin") {
    const cats = adminScopeCategories(s);
    if (!cats || cats.size === 0) return ALL_PROMPTS;
    const linked = new Set();
    (s.programIds || []).forEach((pid) => programPromptIds(pid).forEach((id) => linked.add(id)));
    return ALL_PROMPTS.filter((r) => cats.has(r.category) || linked.has(r.id));
  }
  const sc = currentScope();
  if (!sc || !sc.program || sc.program.scope === "full") return ALL_PROMPTS;
  const cats = new Set(sc.program.categories || []);
  const linked = new Set(programPromptIds(sc.program.id));
  return ALL_PROMPTS.filter((r) => cats.has(r.category) || linked.has(r.id));
}
function isScopeRestricted() {
  const s = Store.getSession();
  if (s && s.kind === "admin") {
    const cats = adminScopeCategories(s);
    return !!(cats && cats.size > 0);
  }
  const sc = currentScope();
  return !!(sc && sc.program && sc.program.scope === "program");
}
function scopeProgramIds() {
  const sc = currentScope();
  if (!sc) return [];
  if (sc.programs && sc.programs.length) return sc.programs.map((p) => p.id);
  if (sc.program) return [sc.program.id];
  return [];
}

/* ---------- Inline icon set ---------- */
const ICONS = {
  home: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M3 11l9-7 9 7"/><path d="M5 10v10h5v-6h4v6h5V10"/></svg>',
  search: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="11" cy="11" r="7"/><path d="M21 21l-4.3-4.3"/></svg>',
  grid: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="3" width="7" height="7" rx="1.5"/><rect x="14" y="3" width="7" height="7" rx="1.5"/><rect x="3" y="14" width="7" height="7" rx="1.5"/><rect x="14" y="14" width="7" height="7" rx="1.5"/></svg>',
  star: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M12 2.7l2.9 6 6.6.9-4.8 4.6 1.1 6.5-5.8-3-5.8 3 1.1-6.5-4.8-4.6 6.6-.9z"/></svg>',
  starFilled: '<svg viewBox="0 0 24 24" fill="currentColor" stroke="currentColor" stroke-width="1"><path d="M12 2.7l2.9 6 6.6.9-4.8 4.6 1.1 6.5-5.8-3-5.8 3 1.1-6.5-4.8-4.6 6.6-.9z"/></svg>',
  folder: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M4 6a2 2 0 012-2h4l2 2h6a2 2 0 012 2v9a2 2 0 01-2 2H6a2 2 0 01-2-2z"/></svg>',
  build: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M14.7 6.3a4 4 0 015 5l-6.2 6.2a2 2 0 01-1.4.6H9v-3a2 2 0 01.6-1.4z"/><path d="M14 9l1 1"/></svg>',
  chart: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M4 20V10M12 20V4M20 20v-7"/></svg>',
  copy: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="8" y="8" width="12" height="12" rx="2"/><path d="M5 15.5A2 2 0 013 13.5v-8A2 2 0 015 3.5h8a2 2 0 012 2"/></svg>',
  check: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round"><path d="M4 12l5 5L20 6"/></svg>',
  x: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M6 6l12 12M18 6L6 18"/></svg>',
  chevronRight: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M9 6l6 6-6 6"/></svg>',
  sparkle: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M12 3l1.8 5.2L19 10l-5.2 1.8L12 17l-1.8-5.2L5 10l5.2-1.8z"/></svg>',
  clock: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="9"/><path d="M12 7v5l3.5 2"/></svg>',
  plus: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><path d="M12 5v14M5 12h14"/></svg>',
  alert: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M12 9v5"/><circle cx="12" cy="17" r=".2" fill="currentColor" stroke-width="2.4"/><path d="M10.3 3.9L2.5 18a1.8 1.8 0 001.6 2.7h15.8a1.8 1.8 0 001.6-2.7L13.7 3.9a1.8 1.8 0 00-3.4 0z"/></svg>',
  slider: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M4 6h10M18 6h2M4 12h2M8 12h12M4 18h14M22 18h0"/><circle cx="16" cy="6" r="2"/><circle cx="6" cy="12" r="2"/><circle cx="20" cy="18" r="2"/></svg>',
  layers: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M12 3l9 5-9 5-9-5z"/><path d="M3 13l9 5 9-5"/></svg>',
  wand: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M4 20L18 6"/><path d="M15 3l1 2 2 1-2 1-1 2-1-2-2-1 2-1z"/><path d="M18 14l.8 1.6 1.6.8-1.6.8L18 19l-.8-1.8-1.6-.8 1.6-.8z"/></svg>',
  beaker: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M9 3h6M10 3v6l-5.2 8.6A1.5 1.5 0 006.1 20h11.8a1.5 1.5 0 001.3-2.4L14 9V3"/><path d="M8 15h8"/></svg>',
  link2: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M9 17H7a5 5 0 010-10h2M15 7h2a5 5 0 010 10h-2M8 12h8"/></svg>',
  message: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M21 15a2 2 0 01-2 2H8l-5 4V5a2 2 0 012-2h14a2 2 0 012 2z"/></svg>',
  download: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M12 3v13m0 0l-4.5-4.5M12 16l4.5-4.5"/><path d="M4 19h16"/></svg>',
  history: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M3 12a9 9 0 109-9 9 9 0 00-8 5"/><path d="M3 3v5h5"/><path d="M12 7v5l4 2"/></svg>',
  book: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M4 5a2 2 0 012-2h13v16H6a2 2 0 00-2 2z"/><path d="M19 3v16"/></svg>',
  target: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="9"/><circle cx="12" cy="12" r="5"/><circle cx="12" cy="12" r="1.5"/></svg>',
  path: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="6" cy="18" r="2.5"/><circle cx="18" cy="6" r="2.5"/><path d="M8 16.5c8-1 9-2 8-9"/></svg>',
  logout: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M9 21H5a2 2 0 01-2-2V5a2 2 0 012-2h4"/><path d="M16 17l5-5-5-5M21 12H9"/></svg>',
};
function icon(name, cls) { return (ICONS[name] || "").replace("<svg ", `<svg class="${cls || ""}" `); }

/* ---------- Card + badge rendering, paginated list ---------- */
function renderHealthBadge(status) { return `<span class="badge-health ${healthClass(status)}"><span class="dot"></span>${escapeHtml(status)}</span>`; }
function renderQualityPill(score) {
  return `<span class="quality-pill ${qualityClass(score)}"><span class="quality-bar"><i style="width:${score}%"></i></span>${score}</span>`;
}
function renderDifficulty(d) { return `<span class="diff-dot diff-${d}"><i></i>${d}</span>`; }
function renderLifecycle(lc) { return `<span class="lc-badge lc-${lc}">${escapeHtml(lc)}</span>`; }

function promptCardHtml(rec, opts) {
  opts = opts || {};
  const isFav = Store.isFavorite(rec.id);
  const varBadge = rec.isTemplate ? `<span class="chip" title="${rec.variables.length} variable(s)">${icon("slider", "")} ${rec.variables.length} var</span>` : "";
  return `
  <article class="prompt-card" data-id="${rec.id}" role="button" tabindex="0" aria-label="Open ${escapeHtml(rec.title)}">
    <div class="prompt-card-top">
      <div class="prompt-card-title">${escapeHtml(rec.title)}</div>
      <div class="prompt-card-actions">
        <button class="fav-btn ${isFav ? "is-fav" : ""}" data-action="fav" data-id="${rec.id}" aria-label="${isFav ? "Remove favorite" : "Add favorite"}" title="Favorite (F)">${isFav ? icon("starFilled") : icon("star")}</button>
        <button class="fav-btn" data-action="copy" data-id="${rec.id}" aria-label="Copy prompt" title="Copy (C)">${icon("copy")}</button>
      </div>
    </div>
    <div class="prompt-card-desc">${escapeHtml(rec.description)}</div>
    <div class="prompt-card-meta">
      <span class="chip">${escapeHtml(rec.category)}</span>
      ${renderDifficulty(rec.difficulty)}
      ${renderQualityPill(rec.qualityScore)}
      ${varBadge}
      ${opts.showSource && rec.source !== "Original Library" ? `<span class="chip chip-accent">${escapeHtml(rec.source)}</span>` : ""}
    </div>
  </article>`;
}
function renderPaginatedList(container, records, opts) {
  opts = opts || {};
  const PAGE = 30;
  let shown = Math.min(PAGE, records.length);
  container.innerHTML = "";
  if (!records.length) {
    container.innerHTML = opts.emptyHtml || emptyStateHtml("search", "No prompts found", "Try a broader search, or create a new prompt.");
    return;
  }
  const list = document.createElement("div");
  list.className = "results-list";
  container.appendChild(list);
  const sentinel = document.createElement("div");
  sentinel.setAttribute("aria-hidden", "true");
  function paint() {
    list.innerHTML = records.slice(0, shown).map((r) => promptCardHtml(r, opts)).join("");
    if (shown < records.length) container.appendChild(sentinel);
    else if (sentinel.parentNode) sentinel.parentNode.removeChild(sentinel);
    wireCardActions(list);
  }
  paint();
  const io = new IntersectionObserver((entries) => {
    if (entries[0].isIntersecting && shown < records.length) {
      shown = Math.min(shown + PAGE, records.length);
      paint();
      io.observe(sentinel);
    }
  }, { rootMargin: "600px" });
  if (shown < records.length) io.observe(sentinel);
}
function emptyStateHtml(iconName, title, sub, actionHtml) {
  return `<div class="empty-state">${icon(iconName)}<h3>${escapeHtml(title)}</h3><div>${escapeHtml(sub)}</div>${actionHtml || ""}</div>`;
}

/* ---------- Shared search/filter computation + filter bar ---------- */
const GOALS = [
  { label: "Create", promptType: null, query: "create" },
  { label: "Analyze", promptType: "Analysis", query: "" },
  { label: "Research", promptType: "Research", query: "" },
  { label: "Write", promptType: "Writing", query: "" },
  { label: "Plan", promptType: "Planning", query: "" },
  { label: "Improve", promptType: null, query: "improve" },
  { label: "Decide", promptType: "Decision", query: "" },
  { label: "Brainstorm", promptType: "Brainstorm", query: "" },
];
const SEARCH_EXAMPLES = [
  "Prepare an AI strategy for leadership", "Write an executive email", "Analyze competitors",
  "Create a training program", "Handle a customer complaint", "Build a product roadmap",
];
function getSearchCorpus() { return scopedLibrary().concat(Store.getMyPrompts()); }
function getUsageForSearch() { const u = Store.getUsage(); return { counts: u.counts, favorites: Store.getFavorites() }; }

function passesFilters(rec, f) {
  if (f.category && rec.category !== f.category) return false;
  if (f.promptType && rec.promptType !== f.promptType) return false;
  if (f.role && rec.role !== f.role) return false;
  if (f.skill && rec.skill !== f.skill) return false;
  if (f.difficulty && rec.difficulty !== f.difficulty) return false;
  if (f.aiTool && rec.aiTool !== f.aiTool) return false;
  if (f.source && rec.source !== f.source) return false;
  if (f.hasVariables && !rec.isTemplate) return false;
  if (f.favoritesOnly && !Store.isFavorite(rec.id)) return false;
  return true;
}
function computeResults(query, filters, sort, baseCorpus) {
  const corpus = baseCorpus || getSearchCorpus();
  let results;
  const q = (query || "").trim();
  if (q) results = searchPrompts(corpus, q, getUsageForSearch());
  else results = corpus.slice();
  results = results.filter((r) => passesFilters(r, filters));

  if (sort === "quality") results = results.slice().sort((a, b) => b.qualityScore - a.qualityScore);
  else if (sort === "recent") {
    const usage = Store.getUsage();
    results = results.slice().sort((a, b) => {
      const ca = a.createdAt ? new Date(a.createdAt).getTime() : (usage.lastUsedTs[a.id] || 0);
      const cb = b.createdAt ? new Date(b.createdAt).getTime() : (usage.lastUsedTs[b.id] || 0);
      return cb - ca;
    });
  } else if (sort === "az") results = results.slice().sort((a, b) => a.title.localeCompare(b.title));
  else if (sort === "used") {
    const usage = Store.getUsage();
    results = results.slice().sort((a, b) => (usage.counts[b.id] || 0) - (usage.counts[a.id] || 0));
  }
  if (!q && sort === "relevance") results = results.slice().sort((a, b) => b.qualityScore - a.qualityScore);
  return results;
}
const FILTER_LABELS = { category: "Category", skill: "Skill", promptType: "Prompt Type", role: "Role", difficulty: "Difficulty", aiTool: "AI Tool", source: "Source" };
function activeFilterEntries(f) {
  const out = [];
  for (const k of ["category", "skill", "promptType", "role", "difficulty", "aiTool", "source"]) if (f[k]) out.push([k, f[k]]);
  if (f.hasVariables) out.push(["hasVariables", "Has Variables"]);
  if (f.favoritesOnly) out.push(["favoritesOnly", "Favorites Only"]);
  return out;
}
function renderFilterBar(state) {
  const f = state.filters;
  const lib = scopedLibrary();
  const uniq = (key) => Array.from(new Set(lib.map((r) => r[key]).filter(Boolean))).sort();
  const categories = uniq("category");
  const skills = uniq("skill");
  const promptTypes = uniq("promptType");
  const roles = uniq("role");
  const activeChips = activeFilterEntries(f).map(([k, v]) => `
    <span class="filter-tag">${escapeHtml(FILTER_LABELS[k] || "")}${FILTER_LABELS[k] ? ": " : ""}${escapeHtml(v)}
      <button data-clear-filter="${k}" aria-label="Remove filter">${icon("x")}</button></span>`).join("");
  return `
  <div class="filter-bar">
    <select data-filter="category" aria-label="Category"><option value="">All categories</option>${categories.map((c) => `<option value="${escapeHtml(c)}" ${f.category === c ? "selected" : ""}>${escapeHtml(c)}</option>`).join("")}</select>
    <select data-filter="skill" aria-label="Skill"><option value="">All skills</option>${skills.map((c) => `<option value="${escapeHtml(c)}" ${f.skill === c ? "selected" : ""}>${escapeHtml(c)}</option>`).join("")}</select>
    <select data-filter="role" aria-label="Role"><option value="">All roles</option>${roles.map((c) => `<option value="${escapeHtml(c)}" ${f.role === c ? "selected" : ""}>${escapeHtml(c)}</option>`).join("")}</select>
    <select data-filter="difficulty" aria-label="Difficulty"><option value="">Any difficulty</option>${["Beginner", "Intermediate", "Advanced"].map((c) => `<option value="${c}" ${f.difficulty === c ? "selected" : ""}>${c}</option>`).join("")}</select>
    <select data-filter="promptType" aria-label="Prompt type"><option value="">All types</option>${promptTypes.map((c) => `<option value="${escapeHtml(c)}" ${f.promptType === c ? "selected" : ""}>${escapeHtml(c)}</option>`).join("")}</select>
    <label class="chip" style="cursor:pointer;"><input type="checkbox" id="filter-vars" style="margin-right:5px" ${f.hasVariables ? "checked" : ""}/> Has Variables</label>
    <label class="chip" style="cursor:pointer;"><input type="checkbox" id="filter-favs" style="margin-right:5px" ${f.favoritesOnly ? "checked" : ""}/> Favorites</label>
    <div class="spacer"></div>
    <select data-sort aria-label="Sort by">
      <option value="relevance" ${state.sort === "relevance" ? "selected" : ""}>Sort: Relevance</option>
      <option value="quality" ${state.sort === "quality" ? "selected" : ""}>Highest Quality</option>
      <option value="used" ${state.sort === "used" ? "selected" : ""}>Most Used</option>
      <option value="recent" ${state.sort === "recent" ? "selected" : ""}>Recently Added</option>
      <option value="az" ${state.sort === "az" ? "selected" : ""}>A–Z</option>
    </select>
  </div>
  ${activeChips ? `<div style="display:flex;flex-wrap:wrap;gap:6px;margin:-6px 0 12px;">${activeChips}<button class="btn btn-sm btn-ghost" data-clear-all-filters>Clear all</button></div>` : ""}`;
}
function wireFilterBar(el, onChange) {
  el.querySelectorAll("[data-filter]").forEach((sel) => {
    sel.addEventListener("change", () => { STATE.filters[sel.dataset.filter] = sel.value || null; onChange(); });
  });
  const varsBox = el.querySelector("#filter-vars");
  if (varsBox) varsBox.addEventListener("change", () => { STATE.filters.hasVariables = varsBox.checked; onChange(); });
  const favsBox = el.querySelector("#filter-favs");
  if (favsBox) favsBox.addEventListener("change", () => { STATE.filters.favoritesOnly = favsBox.checked; onChange(); });
  const sortSel = el.querySelector("[data-sort]");
  if (sortSel) sortSel.addEventListener("change", () => { STATE.sort = sortSel.value; onChange(); });
  el.querySelectorAll("[data-clear-filter]").forEach((btn) => {
    btn.addEventListener("click", () => {
      const k = btn.dataset.clearFilter;
      STATE.filters[k] = (k === "hasVariables" || k === "favoritesOnly") ? false : null;
      onChange();
    });
  });
  const clearAll = el.querySelector("[data-clear-all-filters]");
  if (clearAll) clearAll.addEventListener("click", () => { STATE.filters = emptyFilters(); onChange(); });
}
function wireCardActions(el) {
  el.querySelectorAll(".prompt-card").forEach((card) => {
    if (card.__wired) return;
    card.__wired = true;
    card.addEventListener("click", (e) => { if (e.target.closest("[data-action]")) return; openDetail(card.dataset.id); });
    card.addEventListener("keydown", (e) => { if (e.key === "Enter") openDetail(card.dataset.id); });
  });
  el.querySelectorAll('[data-action="fav"]').forEach((btn) => {
    if (btn.__wired) return;
    btn.__wired = true;
    btn.addEventListener("click", (e) => {
      e.stopPropagation();
      const now = Store.toggleFavorite(btn.dataset.id);
      btn.classList.toggle("is-fav", now);
      btn.innerHTML = now ? icon("starFilled") : icon("star");
      showToast(now ? "Added to favorites" : "Removed from favorites");
      renderSidebarFooter();
    });
  });
  el.querySelectorAll('[data-action="copy"]').forEach((btn) => {
    if (btn.__wired) return;
    btn.__wired = true;
    btn.addEventListener("click", async (e) => {
      e.stopPropagation();
      const rec = findPromptById(btn.dataset.id);
      if (!rec) return;
      const ok = await copyText(rec.originalPrompt);
      Store.recordUsage(rec.id, "copied");
      showToast(ok ? "Copied prompt text" : "Couldn't copy — select and copy manually");
    });
  });
}
