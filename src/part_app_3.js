/* ---------- Access gate ---------- */
function renderGate(prefillMsg, opts) {
  // With the /api backend present, the account experience (part_auth.js) is the
  // primary gate; this classic access-code card is the "Access code" tab and
  // the static-host fallback. `opts.classic` forces this card.
  if (!(opts && opts.classic) && typeof renderAuthGate === "function"
      && typeof Backend !== "undefined" && Backend.isConfigured()) {
    return renderAuthGate(prefillMsg);
  }
  const root = document.getElementById("gate-root");
  const tabs = (typeof authTabs === "function" && typeof Backend !== "undefined" && Backend.isConfigured())
    ? authTabs("code") : "";
  const aside = (typeof authBrandAside === "function") ? authBrandAside() : "";
  root.innerHTML = `
  <div class="gate auth-layout">
    <div class="auth-pane"><div class="gate-card auth-card">
      <div class="auth-brandline">
        <div class="gate-mark" role="img" aria-label="Synottic"></div>
        <span class="auth-product">Synottic Prompt Intelligence</span>
      </div>
      <h1>${tabs ? "Use an access code" : "Synottic Prompt Intelligence"}</h1>
      <p class="sub">Enter the access code from your program to open the library assigned to your cohort.</p>
      ${tabs}
      <label for="gate-code">Access code</label>
      <input id="gate-code" type="text" autocomplete="off" spellcheck="false" placeholder="e.g. SYNOTTIC-AI-01" />
      <div id="gate-resolved"></div>
      <div id="gate-name-wrap" hidden>
        <label for="gate-name" style="margin-top:14px;">Your name <span style="font-weight:400;color:var(--text-faint)">(optional — for your saved work)</span></label>
        <input id="gate-name" class="name-input" type="text" autocomplete="name" placeholder="First Last" />
      </div>
      <div class="gate-error" id="gate-error" role="alert" aria-live="polite"></div>
      <button class="btn btn-primary" id="gate-enter" disabled>Enter library</button>
    </div></div>
    ${aside}
  </div>`;
  if (tabs && typeof authNav === "function") authNav(root);
  const codeI = root.querySelector("#gate-code");
  const nameWrap = root.querySelector("#gate-name-wrap");
  const nameI = root.querySelector("#gate-name");
  const resolvedEl = root.querySelector("#gate-resolved");
  const errEl = root.querySelector("#gate-error");
  const enterBtn = root.querySelector("#gate-enter");
  let resolved = null;
  let bePreview = null;          // last Backend.previewCode result for the current input
  let beReqId = 0;

  function renderBackendPreview(r) {
    errEl.textContent = "";
    if (r.accountRequired) {
      // A collection / org access code — it attaches to a learner account.
      resolvedEl.innerHTML = `<div class="gate-resolved"><b>${escapeHtml(r.orgName || "Organisation library")}</b><br>
        <span style="opacity:.85">${escapeHtml(r.scopeNote || "Curated library access.")}</span><br>
        <span style="opacity:.7">You'll create a free account (or sign in) to use this code — it keeps your saved work and progress.</span></div>`;
      nameWrap.hidden = true;
      enterBtn.disabled = false;
      enterBtn.textContent = "Continue";
      return;
    }
    enterBtn.textContent = "Enter library";
    const scopeNote = r.superAdmin ? "Super-admin — full library and the admin console."
      : r.fullLibrary ? "Full library — all categories, functions and programs."
      : r.programScoped ? "Scoped access — only the prompts in the assigned program(s)."
      : "Full library access.";
    const line2 = r.kind === "admin"
      ? escapeHtml([r.industry, r.domain].filter(Boolean).join(" · "))
      : escapeHtml([r.programName, r.cohortName].filter(Boolean).join(" · "));
    const progs = (r.programs && r.programs.length) ? "Programs: " + r.programs.map((p) => p.name).join(", ") + ". " : "";
    resolvedEl.innerHTML = `<div class="gate-resolved"><b>${escapeHtml(r.orgName || "Access code")}</b><br>${line2}<br><span style="opacity:.8">${escapeHtml(progs)}${scopeNote}</span></div>`;
    nameWrap.hidden = false;
    enterBtn.disabled = false;
  }

  async function checkBackend() {
    const val = codeI.value.trim();
    if (!val || typeof Backend === "undefined" || !Backend.isConfigured()) return;
    const my = ++beReqId;
    const r = await Backend.previewCode(val);
    if (my !== beReqId) return;             // superseded
    if (r === undefined) return;            // backend absent — leave local result
    if (r === null) {                       // backend up, code not found
      bePreview = null;
      if (!resolved) { resolvedEl.innerHTML = ""; nameWrap.hidden = true; enterBtn.disabled = true; errEl.textContent = "That code isn't recognised."; }
      return;
    }
    bePreview = r;
    renderBackendPreview(r);
  }

  function check() {
    const val = codeI.value.trim();
    resolved = val ? resolveAccessCode(val) : null;
    if (!val) { resolvedEl.innerHTML = ""; nameWrap.hidden = true; enterBtn.disabled = true; errEl.textContent = ""; bePreview = null; return; }
    if (resolved && resolved.disabled) {
      resolvedEl.innerHTML = "";
      nameWrap.hidden = true;
      enterBtn.disabled = true;
      errEl.textContent = "That access code has been disabled. Contact your programme lead.";
      return;
    }
    if (!resolved) {
      // no local match — the backend probe (checkBackend) may still recognise it
      if (!(typeof Backend !== "undefined" && Backend.isConfigured())) {
        resolvedEl.innerHTML = "";
        nameWrap.hidden = true;
        enterBtn.disabled = true;
        errEl.textContent = "That code isn't recognised. Check with your program lead.";
      }
      return;
    }
    errEl.textContent = "";
    if (resolved.kind === "admin") {
      const a = resolved.adminCode;
      const progNames = (resolved.programs || []).map((p) => p.name).join(", ");
      const scopeNote = a.superAdmin
        ? "Super-admin — full library and the admin console."
        : a.fullLibrary
          ? "Full library — all categories, functions and programs."
          : "Scoped access — only the prompts in the assigned program(s).";
      resolvedEl.innerHTML = `<div class="gate-resolved"><b>${escapeHtml(a.orgName)}</b><br>${escapeHtml([a.industry, a.domain].filter(Boolean).join(" · "))}<br><span style="opacity:.8">${escapeHtml(progNames ? "Programs: " + progNames + ". " : "")}${scopeNote}</span></div>`;
      nameWrap.hidden = false;
      enterBtn.disabled = false;
      return;
    }
    const scopeNote = resolved.program.scope === "program"
      ? "Access is limited to this program's categories."
      : "Full library access, with content recommended for your program.";
    resolvedEl.innerHTML = `<div class="gate-resolved"><b>${escapeHtml(resolved.org.name)}</b><br>${escapeHtml(resolved.program.name)} · ${escapeHtml(resolved.cohort.name)}<br><span style="opacity:.8">${scopeNote}</span></div>`;
    nameWrap.hidden = false;
    if (resolved.learner && !nameI.value) nameI.value = resolved.learner.name;
    enterBtn.disabled = false;
  }
  const checkBackendDebounced = debounce(checkBackend, 260);
  codeI.addEventListener("input", () => { check(); checkBackendDebounced(); });

  async function enter() {
    const val = codeI.value.trim();
    if (!val) return;
    // Backend path: redeem through /api/session (authoritative, knows
    // admin-created + disabled codes). Falls back to local on network failure.
    if (typeof Backend !== "undefined" && Backend.isConfigured()) {
      enterBtn.disabled = true;
      try {
        const session = await Backend.redeem(val, nameI.value.trim());
        if (session.superAdmin) { try { sessionStorage.setItem("prompt-lib:admin-ok", "1"); } catch (e) {} }
        Store.setSession(session);
        bootApp();
        return;
      } catch (e) {
        enterBtn.disabled = false;
        // Collection / org access code -> needs a learner account. Stash the
        // code and route to sign-up; part_auth redeems it after verification.
        if (e.status === 409 && e.data && e.data.error === "account-required") {
          try { sessionStorage.setItem("prompt-lib:pending-code", val); } catch (_) {}
          try { sessionStorage.setItem("prompt-lib:pending-code-org", e.data.orgName || ""); } catch (_) {}
          // part_auth's renderSignUp sees the pending code and shows the short
          // signup (step 1 only); the code is applied server-side on verify.
          if (typeof renderSignUp === "function") renderSignUp();
          return;
        }
        if (e.status === 403 && e.data && e.data.error === "code-expired") { errEl.textContent = "That access code has expired. Ask your programme lead for a new one."; return; }
        if (e.status === 403 && e.data && e.data.error === "code-exhausted") { errEl.textContent = "That access code has reached its seat limit. Ask your programme lead."; return; }
        if (e.status === 403) { errEl.textContent = "That access code has been disabled."; return; }
        if (e.status === 404 || (e.status && e.status >= 500)) {
          // The backend doesn't recognise this code (or errored). Fall through
          // to the static org model — it still resolves the built-in seed codes.
          if (!resolved) resolved = resolveAccessCode(val);
          if (!resolved || resolved.disabled) {
            errEl.textContent = e.status === 404
              ? "That code isn't recognised. Check with your program lead."
              : "Couldn't reach the server — try again.";
            return;
          }
          // local match -> fall through to the local redeem below
        } else if (!e.soft) {
          errEl.textContent = "Couldn't reach the server — try again."; return;
        }
        // e.soft (backend absent) or a valid local fall-through -> local redeem
      }
    }
    if (!resolved) { resolved = resolveAccessCode(codeI.value); check(); }
    if (!resolved || resolved.disabled) return;
    let s;
    if (resolved.kind === "admin") {
      const a = resolved.adminCode;
      s = {
        code: a.code, kind: "admin",
        orgId: "adm-" + a.id, orgName: a.orgName,
        domain: a.domain || "", industry: a.industry || "",
        functions: a.functions || [], roles: a.roles || [],
        programIds: a.programIds || [], fullLibrary: !!a.fullLibrary,
        superAdmin: !!a.superAdmin,
        name: (nameI.value.trim() || "Learner"), startedAt: Date.now(),
      };
      if (a.superAdmin) { try { sessionStorage.setItem("prompt-lib:admin-ok", "1"); } catch (e) {} }
    } else {
      s = {
        code: resolved.code,
        orgId: resolved.org.id,
        programId: resolved.program.id,
        cohortId: resolved.cohort.id,
        learnerId: resolved.learner ? resolved.learner.id : null,
        name: (nameI.value.trim() || (resolved.learner && resolved.learner.name) || "Learner"),
        startedAt: Date.now(),
      };
    }
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
  const s = Store.getSession && Store.getSession();
  const done = () => { Store.clearSession();
    try { sessionStorage.removeItem("prompt-lib:vbanner-dismissed"); } catch (e) {}
    location.assign("/"); };
  if (s && s.user && typeof AuthAPI !== "undefined") { AuthAPI.logout().then(done, done); }
  else done();
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
/* Function/category + activity driven, each pick carries a plain-language
   reason. Curriculum "companion" prompts never enter this mix — they surface
   in their own labelled row on Home. Returns [{rec, reason}]. */
function recommendedForYou(limit) {
  limit = limit || 6;
  const usage = Store.getUsage();
  const seen = new Set(Object.keys(usage.counts));
  const favs = Store.getFavorites();
  const favRecs = Array.from(favs).map(findPromptById).filter(Boolean);
  const recentRecs = (usage.recent || []).map((r) => findPromptById(r.id)).filter(Boolean);
  const savedCats = new Set(favRecs.concat(recentRecs).map((r) => r.category));
  const savedSkills = new Set(favRecs.map((r) => r.skill));

  const si = (typeof scopeInfo === "function") ? scopeInfo() : { primaryCats: [], functionName: null, restricted: false };
  const primary = new Set(si.primaryCats || []);
  const fnCats = new Set();
  if (si.functionName && typeof FUNCTIONS !== "undefined" && FUNCTIONS[si.functionName]) {
    FUNCTIONS[si.functionName].categories.forEach((c) => fnCats.add(c));
  }

  const engaged = seen.size + favs.size;
  const levelRank = engaged < 4 ? { Beginner: 0, Intermediate: 1, Advanced: 2 }
    : engaged < 15 ? { Intermediate: 0, Beginner: 1, Advanced: 1 }
    : { Advanced: 0, Intermediate: 1, Beginner: 2 };

  const pool = scopedLibrary().filter((r) =>
    !seen.has(r.id) && r.lifecycle !== "Archived" && (r.source === "Original Library" || r.source === "Everyday Essentials") && !isCurriculumPrompt(r));

  const scored = pool.map((r) => {
    let s = (r.qualityScore || 0) * 0.25;
    let reason = "Popular in your library";
    // New learners start with the hand-built everyday prompts — the fastest
    // way to see what a well-structured prompt does for real work.
    if (r.source === "Everyday Essentials") { s += engaged < 4 ? 16 : 6; reason = "Everyday essentials"; }
    const inFn = si.functionName && fnCats.has(r.category);
    const inScopeFocus = si.restricted && !si.functionName && primary.has(r.category);
    if (savedCats.has(r.category) || savedSkills.has(r.skill)) { s += 12; reason = "Based on what you saved"; }
    if (inFn) {
      s += 18;
      if (reason === "Popular in your library") reason = "Because you work in " + si.functionName;
    } else if (inScopeFocus) {
      s += 10;
      if (reason === "Popular in your library") reason = "Central to your library";
    }
    s -= (levelRank[r.difficulty] || 1) * 8;
    s += (hashStr(r.id) % 7);
    return { rec: r, reason, s: s };
  });
  scored.sort((a, b) => b.s - a.s);
  return scored.slice(0, limit).map((x) => ({ rec: x.rec, reason: x.reason }));
}
function programCompanionPrompt() {
  const ids = (typeof scopeProgramIds === "function") ? scopeProgramIds() : [];
  for (const pid of ids) {
    if (typeof PROGRAM_FLAGSHIP !== "undefined" && PROGRAM_FLAGSHIP[pid]) {
      const rec = findPromptById(PROGRAM_FLAGSHIP[pid]);
      if (rec) return rec;
    }
  }
  return null;
}
/* What the learner should pick back up — most recently opened module, else
   their next unreviewed Learn principle, else a first-run nudge. */
function continueLearning() {
  const prog = Store.getProgress();
  const sc = currentScope();
  const progs = (sc && sc.programs && sc.programs.length) ? sc.programs : (sc && sc.program ? [sc.program] : []);
  const touched = Object.entries(prog.modulesTouched || {}).sort((a, b) => b[1] - a[1]);
  for (const [mid] of touched) {
    for (const p of progs) {
      const m = (p.modules || []).find((x) => x.id === mid);
      if (m) return { kind: "module", title: m.name, sub: "Resume in " + p.name, nav: "program", programId: p.id };
    }
  }
  if (typeof LESSONS !== "undefined") {
    const next = LESSONS.find((L) => !prog.learnedLessons || !prog.learnedLessons[L.key]);
    if (next) return { kind: "lesson", title: next.principle, sub: Object.keys(prog.learnedLessons || {}).length ? "Next principle in Learn" : "Start with the fundamentals", nav: "learn" };
  }
  if (progs.length) return { kind: "module", title: progs[0].name, sub: "Open your program", nav: "program", programId: progs[0].id };
  return { kind: "lesson", title: "How good prompts are built", sub: "5 short principles", nav: "learn" };
}
function renderHome(container) {
  const q = STATE.query.trim();
  const s = Store.getSession();
  const sc = currentScope();
  let html = `
  <div class="hero">
    <div class="greeting">${greeting()}${s && s.name ? ", " + escapeHtml(s.name.split(" ")[0]) : ""}${sc && sc.program ? " · " + escapeHtml(sc.program.name) : sc && sc.programs && sc.programs.length ? " · " + escapeHtml(sc.org.name) : ""}</div>
    <h1>What do you want to accomplish?</h1>
    <div class="search-hero" role="combobox" aria-expanded="false" aria-haspopup="listbox">
      <div class="suggest-panel" id="hero-suggest" role="listbox" hidden></div>
      ${icon("search", "icon-search")}
      <input type="text" id="hero-search" aria-label="Describe what you need to do" placeholder="Describe what you need to do, e.g. make a presentation for my team" value="${escapeHtml(STATE.query)}" autocomplete="off"/>
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
    const recPicks = recommendedForYou(6);
    const si = (typeof scopeInfo === "function") ? scopeInfo() : { restricted: false, mode: "full" };
    const isNew = Store.getFavorites().size === 0 && Object.keys(Store.getUsage().counts).length === 0;
    const companion = programCompanionPrompt();
    const recent = Store.getUsage().recent.map((r) => findPromptById(r.id)).filter(Boolean).slice(0, 5);
    const saved = Array.from(Store.getFavorites()).map(findPromptById).filter(Boolean).slice(0, 5);
    const cont = continueLearning();

    // group consecutive picks that share a reason so each row gets one caption
    const groups = [];
    recPicks.forEach(({ rec, reason }) => {
      const last = groups[groups.length - 1];
      if (last && last.reason === reason) last.recs.push(rec);
      else groups.push({ reason, recs: [rec] });
    });

    const taskGrid = taskGridHtml({ limit: 8 });
    html += (taskGrid ? `
    <div class="task-block" id="home-tasks">
      <div class="section-title"><div><h2>Popular tasks</h2><p>Pick what you're doing. Each one opens a ready-made toolkit of prompts.</p></div></div>
      ${taskGrid}
    </div>` : "") + `
    <div class="continue-card" data-cont="1" role="button" tabindex="0">
      <div class="cc-ico">${icon(cont.kind === "module" ? "path" : "book")}</div>
      <div>
        <h3>Continue: ${escapeHtml(cont.title)}</h3>
        <p>${escapeHtml(cont.sub)}</p>
      </div>
      <span class="cc-go">${icon("chevronRight")}</span>
    </div>

    <div class="home-block">
      <div class="section-title"><h2>Recommended for you</h2><button class="linklike" data-nav="search">Browse the library</button></div>
      ${isNew ? `<div class="empty-mini" style="margin-bottom:10px;">Tell us what you're working on and we'll tailor this. For now, here's a strong place to start.</div>` : ""}
      ${groups.length ? groups.map((g) => `
        <div class="rec-reason">${escapeHtml(g.reason)}</div>
        <div class="rec-grid">${g.recs.map((r) => promptCardHtml(r)).join("")}</div>`).join("")
        : `<div class="empty-mini">Save and use a few prompts and this list will sharpen.</div>`}
    </div>

    ${companion ? `
    <div class="home-block">
      <div class="section-title"><h2>Your program's companion prompt</h2></div>
      <div class="potd" data-id="${companion.id}" role="button" tabindex="0">
        <div>
          <div class="potd-badge">Course companion</div>
          <h3>${escapeHtml(companion.title.replace(" — Course Companion Prompt", ""))}</h3>
          <p>${escapeHtml(companion.description)}</p>
        </div>
      </div>
    </div>` : ""}

    <div class="home-cols">
      <div class="home-block">
        <div class="section-title"><h2>Recently used</h2>${recent.length ? `<button class="linklike" data-nav="me">See all</button>` : ""}</div>
        <div class="mini-list">
          ${recent.length ? recent.map((r) => `<div class="mini-item" data-id="${r.id}" role="button" tabindex="0"><span class="mini-item-title">${escapeHtml(r.title)}</span><span class="chip">${escapeHtml(r.category)}</span></div>`).join("")
            : `<div class="empty-mini">Prompts you open, copy, or use show up here.</div>`}
        </div>
      </div>
      <div class="home-block">
        <div class="section-title"><h2>Saved</h2>${saved.length ? `<button class="linklike" data-nav="me">See all</button>` : ""}</div>
        <div class="mini-list">
          ${saved.length ? saved.map((r) => `<div class="mini-item" data-id="${r.id}" role="button" tabindex="0"><span class="mini-item-title">${escapeHtml(r.title)}</span><span class="chip">${escapeHtml(r.category)}</span></div>`).join("")
            : `<div class="empty-mini">Tap the star on any prompt to keep it here.</div>`}
        </div>
      </div>
    </div>`;
    container.innerHTML = html;
    wireHomeStatic(container);
    wireCardActions(container);
    const tasksEl = container.querySelector("#home-tasks");
    if (tasksEl) wireTaskGrid(tasksEl);
  }

  const input = container.querySelector("#hero-search");
  if (input) {
    input.focus();
    input.setSelectionRange(input.value.length, input.value.length);
    input.addEventListener("input", debounce((e) => { setQuery(e.target.value); }, 180));
  }
  // type-ahead is only useful before results take over the page
  if (input && !q) attachSearchSuggest(input, container.querySelector("#hero-suggest"), {});
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
  const contEl = container.querySelector("[data-cont]");
  if (contEl) {
    const go = () => { const c = continueLearning(); if (c.programId) STATE.activeProgramId = c.programId; navigate(c.nav); };
    contEl.addEventListener("click", go);
    contEl.addEventListener("keydown", (e) => { if (e.key === "Enter") go(); });
  }
  container.querySelectorAll("[data-nav]").forEach((el) => el.addEventListener("click", () => navigate(el.dataset.nav)));
  container.querySelectorAll(".mini-item, .potd").forEach((el) => {
    if (!el.dataset.id) return;
    el.addEventListener("click", () => openDetail(el.dataset.id));
    el.addEventListener("keydown", (e) => { if (e.key === "Enter") openDetail(el.dataset.id); });
  });
}

function renderResultsInto(el, opts) {
  opts = opts || {};
  const results = computeResults(STATE.query, STATE.filters, STATE.sort, opts.baseCorpus);
  let html = "";
  if (!opts.compactFilters) html += renderFilterBar(STATE);
  const scopeTag = isScopeRestricted() && !opts.baseCorpus ? ` · scoped to ${escapeHtml(((currentScope() || {}).program || {}).name || ((currentScope() || {}).org || {}).name || "your program")}` : "";
  const q = (STATE.query || "").trim();
  if (q && !opts.baseCorpus) html += searchUnderstoodHtml(results);
  html += `<div class="result-count">${results.length.toLocaleString()} prompt${results.length === 1 ? "" : "s"}${scopeTag}</div><div id="results-list-target"></div>`;
  el.innerHTML = html;
  wireFilterBar(el, () => renderResultsInto(el, opts));
  el.querySelectorAll(".intent-banner[data-hub]").forEach((b) => b.addEventListener("click", () => openHub(b.dataset.hub)));
  const lit = el.querySelector("[data-search-literal]");
  if (lit) lit.addEventListener("click", () => { STATE.searchLiteral = STATE.query.trim(); renderResultsInto(el, opts); });
  const tasks = taskGridHtml({ limit: 6 });
  const emptyHtml = emptyStateHtml("search", q ? `Nothing matched “${q}” yet` : "No prompts found",
      "Try describing the task in a few plain words, or start from one of these popular tasks.",
      `<button class="btn btn-sm" data-nav-builder style="margin-top:4px;">${icon("build")} Create your own prompt</button>`) +
    (tasks ? `<div class="task-block" id="empty-tasks">${tasks}</div>` : "");
  const target = el.querySelector("#results-list-target");
  renderPaginatedList(target, results, { emptyHtml });
  const et = target.querySelector("#empty-tasks");
  if (et) wireTaskGrid(et);
  const nb = target.querySelector("[data-nav-builder]");
  if (nb) nb.addEventListener("click", () => navigate("builder"));
}
function scopeSummaryLine(si) {
  if (!si.restricted) {
    const nCats = new Set(scopedLibrary().map((r) => r.category)).size;
    return `${si.total.toLocaleString()} prompts across ${nCats} categories`;
  }
  const cats = si.primaryCats.slice(0, 4).join(" · ");
  const more = si.primaryCats.length > 4 ? ` +${si.primaryCats.length - 4} more` : "";
  return `${si.total.toLocaleString()} prompts · ${cats}${more}`;
}

/* Modules-first Library body for a single-program scope (no category grid). */
function renderModuleListInto(el, prog) {
  const mods = prog.modules || [];
  const progress = Store.getProgress();
  const open = STATE.libOpenModules || (STATE.libOpenModules = {});
  function paint() {
    el.innerHTML = mods.map((m, i) => {
      const ids = MODULE_PROMPTS[m.id] || [];
      const isOpen = open[m.id];
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
        ${isOpen ? `<div class="module-body" id="lib-mb-${m.id}"></div>` : ""}
      </div>`;
    }).join("");
    el.querySelectorAll("[data-mod]").forEach((h) => h.addEventListener("click", () => {
      const id = h.dataset.mod;
      open[id] = !open[id];
      if (open[id]) Store.markModuleViewed(id);
      paint();
    }));
    mods.forEach((m) => {
      if (!open[m.id]) return;
      const body = el.querySelector("#lib-mb-" + m.id);
      if (body) renderPaginatedList(body, (MODULE_PROMPTS[m.id] || []).map(findPromptById).filter(Boolean), {});
    });
  }
  paint();
}

/* ---------- Library: rail + main (Home · Library → one browsing surface) ----------
   Left rail: All prompts, then TASKS (everyday jobs), then CATEGORIES, with a
   filter box. Main: title + count, search scoped to the current selection,
   grid/list toggle, All / Saved / Recently used tabs, and the prompt tiles.
   The old `search`, `categories`, `categoryDetail` and `task` views all render
   this shell; the selection is derived from the view:
     search / categories → All · categoryDetail → STATE.activeCategory · task → STATE.activeHub */
function libSelection() {
  if (STATE.view === "categoryDetail" && STATE.activeCategory) return { kind: "category", id: STATE.activeCategory };
  if (STATE.view === "task" && STATE.activeHub && TASK_HUBS_BY_ID[STATE.activeHub]) return { kind: "hub", id: STATE.activeHub };
  return { kind: "all", id: null };
}
function selectLibrary(sel) {
  const rail = document.querySelector(".lib-rail");
  if (rail) STATE.railScroll = rail.scrollTop;
  STATE.query = "";
  STATE.searchLiteral = null;
  STATE.libBrowseAll = false;
  const f = emptyFilters();
  f.difficulty = STATE.filters.difficulty; f.fwLevel = STATE.filters.fwLevel; f.hasVariables = STATE.filters.hasVariables;
  STATE.filters = f;
  if (sel.kind === "category") { STATE.activeCategory = sel.id; STATE.view = "categoryDetail"; }
  else if (sel.kind === "hub") { STATE.activeHub = sel.id; STATE.view = "task"; }
  else STATE.view = "search";
  renderApp();
  window.scrollTo({ top: 0, behavior: "auto" });
}
function libLayout() {
  if (STATE.libLayout) return STATE.libLayout;
  try { STATE.libLayout = localStorage.getItem("prompt-lib:libLayout") || "grid"; } catch (e) { STATE.libLayout = "grid"; }
  return STATE.libLayout;
}
function setLibLayout(v) {
  STATE.libLayout = v;
  try { localStorage.setItem("prompt-lib:libLayout", v); } catch (e) {}
}
function libCategoryList() {
  const counts = {};
  scopedLibrary().forEach((r) => { counts[r.category] = (counts[r.category] || 0) + 1; });
  const um = typeof userLibraryMode === "function" ? userLibraryMode() : null;
  const only = um && um.mode === "collection" && Array.isArray(um.categories) && um.categories.length ? new Set(um.categories) : null;
  return CATEGORIES.filter((c) => counts[c.name] && (!only || only.has(c.name)))
    .map((c) => ({ name: c.name, count: counts[c.name], role: c.role }))
    .sort((a, b) => a.name.localeCompare(b.name));
}
/* Base records for a selection, before tab / search / filters. For a task the
   hand-built prompts come first, then the best of the wider library. */
function libBaseRecords(sel) {
  if (sel.kind === "category") return getSearchCorpus().filter((r) => r.category === sel.id);
  if (sel.kind === "hub") { const h = TASK_HUBS_BY_ID[sel.id]; return hubEssentials(h.id).concat(hubLibraryMatches(h, 24)); }
  return getSearchCorpus();
}
function libFilterRowHtml() {
  const f = STATE.filters;
  const levels = typeof FRAMEWORK !== "undefined" ? FRAMEWORK.levels : [];
  return `
    <select data-lf="difficulty" aria-label="Difficulty"><option value="">Any level</option>${["Beginner", "Intermediate", "Advanced"].map((d) => `<option ${f.difficulty === d ? "selected" : ""}>${d}</option>`).join("")}</select>
    <select data-lf="fwLevel" aria-label="Framework level"><option value="">Any framework</option>${levels.map((L) => `<option value="${L.level}" ${String(f.fwLevel) === String(L.level) ? "selected" : ""}>Level ${L.level} · ${escapeHtml(L.code)}</option>`).join("")}</select>
    <label class="chip" style="cursor:pointer;"><input type="checkbox" data-lf-check="hasVariables" style="margin-right:5px" ${f.hasVariables ? "checked" : ""}/> Fill-in templates</label>
    <span class="spacer"></span>
    <select data-lsort aria-label="Sort by">
      ${[["relevance", "Best match"], ["quality", "Highest quality"], ["used", "Most used"], ["az", "A–Z"]].map(([v, l]) => `<option value="${v}" ${STATE.sort === v ? "selected" : ""}>Sort: ${l}</option>`).join("")}
    </select>`;
}
function renderLibraryShell(container) {
  const sel = libSelection();
  const si = (typeof scopeInfo === "function") ? scopeInfo() : { restricted: false, gridEligible: true, total: scopedLibrary().length, label: "Full library", primaryCats: [] };
  const hubs = hubsInScope();
  // single-program scopes have no category browse (see isViewAllowed)
  const cats = isViewAllowed("categoryDetail") ? libCategoryList() : [];
  const hub = sel.kind === "hub" ? TASK_HUBS_BY_ID[sel.id] : null;
  const catMeta = sel.kind === "category" ? CATEGORIES.find((c) => c.name === sel.id) : null;
  if (sel.kind === "category" && !cats.some((c) => c.name === sel.id)) { selectLibrary({ kind: "all" }); return; }
  const tab = STATE.libTab || "all";
  const layout = libLayout();
  const title = hub ? hub.label : sel.kind === "category" ? sel.id : "All prompts";
  const icon0 = hub ? hub.icon : sel.kind === "category" ? (CATEGORY_ICONS[sel.id] || "📝") : "📚";
  const blurb = hub ? hub.blurb
    : catMeta ? `Prompts for ${catMeta.role || CATEGORY_SKILL[sel.id] || "any professional"}.`
    : si.restricted ? `${si.label}${si.functionName && si.functionName !== si.label ? " · " + si.functionName : ""}`
    : "Every prompt, built to be copied, filled in and used.";
  const isActive = (k, id) => sel.kind === k && (k === "all" || sel.id === id);
  const railItem = (k, id, ico, label, count) => `
    <button class="rail-item ${isActive(k, id) ? "active" : ""}" data-sel-kind="${k}" ${id ? `data-sel-id="${escapeHtml(id)}"` : ""} data-rail-text="${escapeHtml(label.toLowerCase())}" ${isActive(k, id) ? 'aria-current="true"' : ""}>
      <span class="ri-ico" aria-hidden="true">${ico}</span><span class="ri-label">${escapeHtml(label)}</span><span class="ri-count">${count.toLocaleString()}</span>
    </button>`;
  const pickOpts = `<option value="all|" ${sel.kind === "all" ? "selected" : ""}>📚 All prompts</option>` +
    (hubs.length ? `<optgroup label="Tasks">${hubs.map((h) => `<option value="hub|${h.id}" ${isActive("hub", h.id) ? "selected" : ""}>${h.icon} ${escapeHtml(h.label)}</option>`).join("")}</optgroup>` : "") +
    (cats.length ? `<optgroup label="Categories">${cats.map((c) => `<option value="category|${escapeHtml(c.name)}" ${isActive("category", c.name) ? "selected" : ""}>${CATEGORY_ICONS[c.name] || "📝"} ${escapeHtml(c.name)}</option>`).join("")}</optgroup>` : "");
  const crumb = sel.kind === "all" ? "" : `
    <div class="lib-crumb">
      <button class="lc-link" data-crumb-all>Library</button><span aria-hidden="true">›</span>
      <span>${sel.kind === "hub" ? "Tasks" : "Categories"}</span><span aria-hidden="true">›</span>
      <span class="lc-current">${icon0} ${escapeHtml(title)}<button class="lc-clear" data-crumb-all aria-label="Clear ${escapeHtml(title)}" title="Show all prompts">${icon("x")}</button></span>
    </div>`;

  container.innerHTML = `
  <div class="lib-shell">
    <aside class="lib-rail" aria-label="Browse the library">
      <div class="rail-find">${icon("search", "rf-ico")}<input type="text" id="rail-filter" placeholder="Filter tasks & categories" aria-label="Filter tasks and categories" autocomplete="off"/></div>
      ${railItem("all", null, "📚", "All prompts", si.total)}
      ${hubs.length ? `<div class="rail-label"><span>Tasks</span><small>What you need to do</small></div>${hubs.map((h) => railItem("hub", h.id, h.icon, h.label, h.count)).join("")}` : ""}
      ${cats.length ? `<div class="rail-label"><span>Categories</span><small>Browse by field</small></div>` : ""}
      ${cats.map((c) => railItem("category", c.name, CATEGORY_ICONS[c.name] || "📝", c.name, c.count)).join("")}
      <div class="rail-empty" hidden>No match. Try another word.</div>
    </aside>
    <section class="lib-main">
      <div class="lib-searchbar">
        <div class="lib-search" role="combobox" aria-expanded="false" aria-owns="lib-suggest" aria-haspopup="listbox">
          ${icon("search", "ls-ico")}
          <input type="text" id="lib-search" aria-label="Search all prompts" aria-autocomplete="list" aria-controls="lib-suggest" autocomplete="off" value="${escapeHtml(STATE.query)}"
            placeholder="Search ${si.total.toLocaleString()} prompts: describe your task, e.g. “ICF coach” or “meeting minutes”"/>
          <button class="ls-clear" id="lib-clear" aria-label="Clear search" ${STATE.query ? "" : "hidden"}>${icon("x")}</button>
          <div class="suggest-panel" id="lib-suggest" role="listbox" hidden></div>
        </div>
        <div class="layout-toggle" role="group" aria-label="Layout">
          <button data-layout="grid" class="${layout === "grid" ? "on" : ""}" aria-label="Grid view" title="Grid view">${icon("grid")}</button>
          <button data-layout="list" class="${layout === "list" ? "on" : ""}" aria-label="List view" title="List view">${icon("listView")}</button>
        </div>
      </div>
      <label class="lib-pick"><span>Browse</span><select id="lib-pick" aria-label="Browse by task or category">${pickOpts}</select></label>
      ${crumb}
      <div class="lib-head">
        <div class="lh-title">
          <span class="lh-ico" aria-hidden="true">${icon0}</span>
          <div><h1>${escapeHtml(title)}</h1><div class="lh-sub"><span id="lib-count"></span> · ${escapeHtml(blurb)}</div></div>
        </div>
      </div>
      <div class="lib-tabbar">
        <div class="lib-tabs" role="tablist">
          ${[["all", "All prompts"], ["saved", "Saved"], ["recent", "Recently used"]].map(([k, l]) => `<button role="tab" aria-selected="${tab === k}" class="${tab === k ? "on" : ""}" data-tab="${k}">${l}</button>`).join("")}
        </div>
        <div class="lib-tab-actions">
          <button class="btn btn-sm btn-ghost" id="lib-filter-btn" aria-expanded="false">${icon("slider")} Filters<span class="lf-dot" hidden></span></button>
          <button class="btn btn-sm btn-ghost" data-build-own>${icon("build")} Build your own</button>
        </div>
      </div>
      <div class="lib-filters" id="lib-filters" hidden>${libFilterRowHtml()}</div>
      <div id="lib-body"></div>
    </section>
  </div>`;

  const body = container.querySelector("#lib-body");
  const countEl = container.querySelector("#lib-count");
  const byTab = (recs) => {
    if (tab === "saved") recs = recs.filter((r) => Store.isFavorite(r.id));
    if (tab === "recent") {
      const order = (Store.getUsage().recent || []).map((x) => x.id);
      const pos = {}; order.forEach((id, i) => { if (!(id in pos)) pos[id] = i; });
      recs = recs.filter((r) => r.id in pos).sort((a, b) => pos[a.id] - pos[b.id]);
    }
    return recs;
  };
  function currentRecords() {
    const q = STATE.query.trim();
    const f = Object.assign({}, STATE.filters, { category: null });
    const base = byTab(libBaseRecords(sel));
    if (q) return computeResults(q, f, STATE.sort, base);
    if (tab === "all" && sel.kind !== "hub") return computeResults("", f, STATE.sort, base);
    return base.filter((r) => passesFilters(r, f));
  }
  function paint() {
    const q = STATE.query.trim();
    const recs = currentRecords();
    const f = Object.assign({}, STATE.filters, { category: null });
    // Searching is library-wide: matches inside the selected task / category
    // come first, the rest of the library follows so nothing is ever hidden.
    let elsewhere = [], lead = [];
    if (q && sel.kind !== "all") {
      const own = new Set(recs.map((r) => r.id));
      const global = computeResults(q, f, STATE.sort, byTab(getSearchCorpus()));
      // the strongest hits outside the selection lead when they outrank
      // everything inside it (e.g. "ICF coach" searched from Presentations)
      for (const r of global.slice(0, 6)) { if (own.has(r.id)) break; lead.push(r); }
      const leadIds = new Set(lead.map((r) => r.id));
      elsewhere = global.filter((r) => !own.has(r.id) && !leadIds.has(r.id));
    }
    const total = recs.length + elsewhere.length + lead.length;
    countEl.textContent = q ? `${total.toLocaleString()} match${total === 1 ? "" : "es"} for “${q}”`
      : `${recs.length.toLocaleString()} prompt${recs.length === 1 ? "" : "s"}${tab === "saved" ? " saved" : tab === "recent" ? " used recently" : ""}`;
    const opts = { layout: libLayout(), hideCategory: sel.kind === "category" && !q };
    let html = "";
    if (q) html += searchUnderstoodHtml(recs.concat(lead, elsewhere));
    const showModules = !q && tab === "all" && sel.kind === "all" && !si.gridEligible && si.programId && ORG_INDEX.programs[si.programId];
    if (showModules) html += `<div class="section-title"><h2>${escapeHtml(ORG_INDEX.programs[si.programId].name)} — modules</h2></div><div id="lib-modules" style="margin-bottom:24px;"></div>`;
    const split = sel.kind === "hub" && !q && tab === "all";
    const ess = split ? recs.filter((r) => r.hub === sel.id) : [];
    const main = split ? recs.filter((r) => r.hub !== sel.id) : recs;
    if (split && ess.length) html += `<div class="section-title"><h2>Step-by-step prompts</h2><span class="st-note">Hand-built with the prompt framework</span></div><div id="lib-ess" class="lib-section"></div>`;
    if (split && main.length) html += `<div class="section-title"><h2>More from the library</h2></div>`;
    if (lead.length) html += `<div class="section-title"><h2>Best matches <small>${lead.length}</small></h2><span class="st-note">From the whole library</span></div><div id="lib-lead" class="lib-section"></div>`;
    if (q && sel.kind !== "all") html += `<div class="section-title"><h2>In ${escapeHtml(title)} <small>${recs.length}</small></h2></div>`;
    html += `<div id="lib-list" class="lib-section"></div>`;
    if (elsewhere.length) html += `<div class="section-title"><h2>Across the library <small>${elsewhere.length}</small></h2><span class="st-note">Matches outside ${escapeHtml(title)}</span></div><div id="lib-else" class="lib-section"></div>`;
    // few or no matches → close alternatives + build-your-own
    const similar = q && total < 6 && tab === "all" ? similarForQuery(q, new Set(recs.concat(elsewhere, lead).map((r) => r.id)), 6) : [];
    if (similar.length) html += `<div class="section-title"><h2>${total ? "You might also like" : "Closest prompts we have"}</h2><span class="st-note">Related to “${escapeHtml(q)}”</span></div><div id="lib-similar" class="lib-section"></div>`;
    if (q && tab === "all") html += buildOwnCardHtml(q, total);
    body.innerHTML = html;
    if (showModules) renderModuleListInto(body.querySelector("#lib-modules"), ORG_INDEX.programs[si.programId]);
    if (split && ess.length) renderPaginatedList(body.querySelector("#lib-ess"), ess, opts);
    const emptyTitle = tab === "saved" ? "Nothing saved here yet" : tab === "recent" ? "Nothing used here yet"
      : q ? (elsewhere.length ? `Nothing in ${title} for “${q}”` : `No exact match for “${q}”`) : "No prompts here yet";
    const emptySub = tab === "saved" ? "Tap the star on any prompt to keep it here."
      : tab === "recent" ? "Prompts you open, copy or use show up here."
      : elsewhere.length ? "See the matches from the rest of the library below."
      : "Try a few plain words about the task, or look at the closest prompts below.";
    const listEl = body.querySelector("#lib-list");
    if (!(split && !main.length && ess.length)) renderPaginatedList(listEl, main, Object.assign({ emptyHtml: `<div class="empty-inline"><b>${escapeHtml(emptyTitle)}</b><span>${escapeHtml(emptySub)}</span></div>` }, opts));
    if (lead.length) renderPaginatedList(body.querySelector("#lib-lead"), lead, { layout: libLayout() });
    if (elsewhere.length) renderPaginatedList(body.querySelector("#lib-else"), elsewhere, { layout: libLayout() });
    if (similar.length) renderPaginatedList(body.querySelector("#lib-similar"), similar, { layout: libLayout() });
    body.querySelectorAll(".intent-banner[data-hub]").forEach((b) => b.addEventListener("click", () => selectLibrary({ kind: "hub", id: b.dataset.hub })));
    const lit = body.querySelector("[data-search-literal]");
    if (lit) lit.addEventListener("click", () => { STATE.searchLiteral = STATE.query.trim(); paint(); });
    body.querySelectorAll("[data-build-own]").forEach((b) => b.addEventListener("click", () => startBuilderFrom(b.dataset.seed || STATE.query)));
  }
  paint();

  // rail — keep its own scroll position across selections; never scroll the page
  const rail = container.querySelector(".lib-rail");
  if (typeof STATE.railScroll === "number") rail.scrollTop = STATE.railScroll;
  const active = rail.querySelector(".rail-item.active");
  if (active) {
    const top = active.offsetTop, bottom = top + active.offsetHeight;
    if (top < rail.scrollTop || bottom > rail.scrollTop + rail.clientHeight) rail.scrollTop = Math.max(0, top - rail.clientHeight / 3);
  }
  rail.addEventListener("scroll", () => { STATE.railScroll = rail.scrollTop; }, { passive: true });
  rail.querySelectorAll(".rail-item").forEach((b) => b.addEventListener("click", () =>
    selectLibrary({ kind: b.dataset.selKind, id: b.dataset.selId || null })));
  const rf = container.querySelector("#rail-filter");
  rf.addEventListener("input", () => {
    const t = rf.value.trim().toLowerCase();
    let shown = 0;
    rail.querySelectorAll(".rail-item").forEach((b) => {
      const hit = !t || b.dataset.railText.includes(t);
      b.hidden = !hit; if (hit) shown++;
    });
    rail.querySelectorAll(".rail-label").forEach((l) => { l.hidden = !!t; });
    rail.querySelector(".rail-empty").hidden = shown > 0;
  });
  container.querySelector("#lib-pick").addEventListener("change", (e) => {
    const [kind, id] = e.target.value.split("|");
    selectLibrary({ kind, id: id || null });
  });
  container.querySelectorAll("[data-crumb-all]").forEach((b) => b.addEventListener("click", () => selectLibrary({ kind: "all" })));
  // search (repaints the body only, so the input keeps focus) + suggestions
  const sInput = container.querySelector("#lib-search");
  const clr = container.querySelector("#lib-clear");
  sInput.addEventListener("input", debounce((e) => {
    STATE.query = e.target.value; STATE.searchLiteral = null;
    clr.hidden = !STATE.query; paint();
  }, 180));
  attachSearchSuggest(sInput, container.querySelector("#lib-suggest"), {
    onPickHub: (id) => selectLibrary({ kind: "hub", id }),
    onPickCategory: (name) => selectLibrary({ kind: "category", id: name }),
  });
  clr.addEventListener("click", () => { STATE.query = ""; sInput.value = ""; clr.hidden = true; paint(); sInput.focus(); });
  if (STATE.query || sel.kind === "all") { sInput.focus({ preventScroll: true }); sInput.setSelectionRange(sInput.value.length, sInput.value.length); }
  // layout, tabs, filters
  container.querySelectorAll("[data-layout]").forEach((b) => b.addEventListener("click", () => {
    setLibLayout(b.dataset.layout);
    container.querySelectorAll("[data-layout]").forEach((x) => x.classList.toggle("on", x === b));
    paint();
  }));
  container.querySelectorAll("[data-tab]").forEach((b) => b.addEventListener("click", () => { STATE.libTab = b.dataset.tab; renderLibraryShell(container); }));
  const fBtn = container.querySelector("#lib-filter-btn");
  const fRow = container.querySelector("#lib-filters");
  const dot = fBtn.querySelector(".lf-dot");
  const syncDot = () => { dot.hidden = !(STATE.filters.difficulty || STATE.filters.fwLevel || STATE.filters.hasVariables || STATE.sort !== "relevance"); };
  syncDot();
  if (!dot.hidden) { fRow.hidden = false; fBtn.setAttribute("aria-expanded", "true"); }
  fBtn.addEventListener("click", () => { fRow.hidden = !fRow.hidden; fBtn.setAttribute("aria-expanded", String(!fRow.hidden)); });
  fRow.querySelectorAll("[data-lf]").forEach((x) => x.addEventListener("change", () => { STATE.filters[x.dataset.lf] = x.value || null; syncDot(); paint(); }));
  fRow.querySelectorAll("[data-lf-check]").forEach((x) => x.addEventListener("change", () => { STATE.filters[x.dataset.lfCheck] = x.checked; syncDot(); paint(); }));
  fRow.querySelector("[data-lsort]").addEventListener("change", (e) => { STATE.sort = e.target.value; syncDot(); paint(); });
  container.querySelector(".lib-tab-actions [data-build-own]").addEventListener("click", () => startBuilderFrom(STATE.query));
}
function renderSearchView(container) { renderLibraryShell(container); }
function renderCategoriesView(container) { renderLibraryShell(container); }
function renderCategoryDetail(container) { renderLibraryShell(container); }
function renderTaskView(container) { renderLibraryShell(container); }


/* ---------- Program Library ---------- */
function renderProgramView(container) {
  const sc = currentScope();
  const progs = (sc && sc.programs && sc.programs.length) ? sc.programs : (sc && sc.program ? [sc.program] : []);
  if (!progs.length) {
    container.innerHTML = emptyStateHtml("path", "No program assigned", "Your access code isn't linked to a program — browse everything in the Library.");
    return;
  }
  let prog = progs.length === 1 ? progs[0] : (STATE.activeProgramId ? progs.find((p) => p.id === STATE.activeProgramId) : null);
  if (!prog) {
    container.innerHTML = `
      <div class="section-title"><h2>Your programs</h2><span style="font-size:12px;color:var(--text-faint)">${progs.length} assigned to ${escapeHtml(sc.org.name)}</span></div>
      <div class="rec-grid">${progs.map((p) => `
        <button class="quick-action" data-prog="${p.id}" style="align-items:flex-start;">
          ${icon("path")}
          <span class="quick-action-label">${escapeHtml(p.name)}</span>
          <span style="font-size:11.5px;color:var(--text-muted);">${escapeHtml((p.modules || []).length + " modules · " + ((ORG_INDEX.orgs[p.orgId] || {}).name || ""))}</span>
        </button>`).join("")}</div>`;
    container.querySelectorAll("[data-prog]").forEach((b) => b.addEventListener("click", () => { STATE.activeProgramId = b.dataset.prog; renderProgramView(container); }));
    return;
  }
  const multi = progs.length > 1;
  const progress = Store.getProgress();
  const mods = prog.modules || [];
  const touched = mods.filter((m) => progress.modulesTouched[m.id]).length;
  const pct = mods.length ? Math.round((touched / mods.length) * 100) : 0;
  const openMods = STATE.openModules || (STATE.openModules = {});
  const pathTail = sc.cohort ? sc.cohort.name : (sc.session && sc.session.industry) || "Organisation access";

  container.innerHTML = `
    ${multi ? `<button class="btn btn-ghost btn-sm" id="prog-back" style="margin-bottom:10px;">← Your programs</button>` : ""}
    <div class="program-header">
      <div class="ph-path">${escapeHtml(sc.org.name)} › ${escapeHtml(prog.name)} › ${escapeHtml(pathTail)}</div>
      <h2>${escapeHtml(prog.name)}</h2>
      <div class="ph-desc">${escapeHtml(prog.description)}</div>
      <div style="display:flex;gap:6px;flex-wrap:wrap;margin-top:10px;">${(prog.skillFocus || []).map((s) => `<span class="chip chip-blue">${escapeHtml(s)}</span>`).join("")}</div>
      <div class="progress-track"><i style="width:${pct}%"></i></div>
      <div style="font-size:11.5px;color:var(--text-faint);margin-top:6px;">${touched} of ${mods.length} modules opened${pct ? " · " + pct + "%" : ""} — progress reflects only modules you've actually viewed.</div>
    </div>
    ${(typeof PROGRAM_FLAGSHIP !== "undefined" && PROGRAM_FLAGSHIP[prog.id] && findPromptById(PROGRAM_FLAGSHIP[prog.id])) ? (function () {
      const fp = findPromptById(PROGRAM_FLAGSHIP[prog.id]);
      return `<div class="potd" data-id="${fp.id}" role="button" tabindex="0" style="background:linear-gradient(150deg,var(--good-blue-soft),var(--surface) 70%);">
        <div><div class="potd-badge" style="color:var(--good-blue);">Course companion prompt</div>
        <h3>${escapeHtml(fp.title.replace(" — Course Companion Prompt", ""))}</h3>
        <p>${escapeHtml(fp.description)}</p>
        <div style="margin-top:8px;">${renderDifficulty(fp.difficulty)} &nbsp; <span class="chip chip-blue">${escapeHtml(fp.source)}</span></div></div>
      </div>`;
    })() : ""}
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

  const backBtn = container.querySelector("#prog-back");
  if (backBtn) backBtn.addEventListener("click", () => { STATE.activeProgramId = null; renderProgramView(container); });
  const fpCard = container.querySelector(".potd[data-id]");
  if (fpCard) {
    fpCard.addEventListener("click", () => openDetail(fpCard.dataset.id));
    fpCard.addEventListener("keydown", (e) => { if (e.key === "Enter") openDetail(fpCard.dataset.id); });
  }
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
  const sc = currentScope();
  const progs = (sc && sc.programs && sc.programs.length) ? sc.programs : (sc && sc.program ? [sc.program] : []);
  let programHtml = "";
  if (progs.length) {
    programHtml = `<div class="section-title"><h2>Your program</h2><button class="linklike" data-nav="program">Open</button></div>` +
      progs.map((p) => {
        const mods = p.modules || [];
        const touched = mods.filter((m) => progress.modulesTouched[m.id]).length;
        const pct = mods.length ? Math.round((touched / mods.length) * 100) : 0;
        return `<div class="continue-card" data-nav="program" role="button" tabindex="0" style="background:linear-gradient(150deg,var(--good-blue-soft),var(--surface) 72%);">
          <div class="cc-ico">${icon("path")}</div>
          <div style="flex:1;">
            <h3>${escapeHtml(p.name)}</h3>
            <p>${touched} of ${mods.length} modules opened${pct ? " · " + pct + "%" : ""}</p>
            <div class="progress-track" style="margin-top:8px;max-width:320px;"><i style="width:${pct}%"></i></div>
          </div>
          <span class="cc-go">${icon("chevronRight")}</span>
        </div>`;
      }).join("") + `<div style="height:14px;"></div>`;
  }
  container.innerHTML = `
    ${typeof frameworkLearnModuleHtml === "function" ? frameworkLearnModuleHtml() : ""}
    ${programHtml}
    <div class="section-title"><h2>How good prompts are built</h2><span style="font-size:12px;color:var(--text-faint)">${done} of ${LESSONS.length} reviewed</span></div>
    <p class="prose" style="max-width:640px;margin-bottom:20px;color:var(--text-muted);">Five things separate a prompt that works from one that doesn't. Each principle is shown with real prompts from the library that demonstrate it. Open any prompt to read its full <b>Why it works</b> breakdown, then try writing your own in <b>Practice</b>.</p>
    <div id="lesson-list"></div>
    <div class="section-title" style="margin-top:10px;"><h2>Keep going</h2></div>
    <div style="display:flex;gap:8px;flex-wrap:wrap;">
      <button class="btn" data-nav="practice">${icon("target")} Practice writing prompts</button>
      <button class="btn" data-nav="builder">${icon("build")} Create a prompt</button>
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
          <span class="mini-item-title">${escapeHtml(r.title)}</span><span class="chip">${escapeHtml(r.category)}</span></div>`).join("")}
      </div>
      <button class="btn btn-sm ${progress.learnedLessons[L.key] ? "" : "btn-primary"}" data-lesson="${L.key}" style="margin-top:12px;">${progress.learnedLessons[L.key] ? icon("check") + " Reviewed" : "Mark as reviewed"}</button>
    </div>`;
  }).join("");
  list.querySelectorAll("[data-id]").forEach((el) => el.addEventListener("click", () => openDetail(el.dataset.id)));
  list.querySelectorAll("[data-lesson]").forEach((b) => b.addEventListener("click", () => { Store.markLessonLearned(b.dataset.lesson); renderLearnView(container); }));
  container.querySelectorAll("[data-nav]").forEach((el) => el.addEventListener("click", () => navigate(el.dataset.nav)));
  if (typeof wireFrameworkLearnModule === "function") wireFrameworkLearnModule(container);
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
  if (!STATE.practice) STATE.practice = { scenarioId: SCENARIOS[0].id, draft: "", result: null, showModel: false, level: 0, compare: false };
  const P = STATE.practice;
  if (P.level == null) P.level = 0;
  const fwOn = P.level > 0 && typeof FRAMEWORK !== "undefined";
  const scenarios = fwOn ? fwScenarios() : SCENARIOS;
  let sc = scenarios.find((s) => s.id === P.scenarioId);
  if (!sc) { sc = scenarios[0]; P.scenarioId = sc.id; }
  const scGoal = sc.goal || sc.task || "";
  const history = Store.getProgress().practice;
  const levelBtns = typeof FRAMEWORK !== "undefined" ? `
    <div class="fw-selector">
      <button class="${P.level === 0 ? "active" : ""}" data-pr-level="0">Open rubric</button>
      ${FRAMEWORK.levels.map((L) => `<button class="${P.level === L.level ? "active" : ""}" data-pr-level="${L.level}">Level ${L.level} · ${escapeHtml(L.code)}</button>`).join("")}
    </div>` : "";
  container.innerHTML = `
    <div class="section-title"><h2>Practice</h2><span style="font-size:12px;color:var(--text-faint)">${history.length} attempt${history.length === 1 ? "" : "s"} logged</span></div>
    <p class="prose" style="max-width:640px;color:var(--text-muted);margin-bottom:10px;">Pick a framework to practise against — your prompt is scored on that level's components — or use the open rubric.</p>
    ${levelBtns}
    ${fwOn ? `<div class="prose" style="font-size:12.5px;color:var(--text-muted);margin:-4px 0 12px;">Scoring against <b>Level ${P.level} · ${escapeHtml(fwLevel(P.level).code)}</b> — ${escapeHtml(fwLevel(P.level).useWhen)} <button class="linklike" data-fw-open="${P.level}" style="background:none;border:none;color:var(--accent-strong);font-weight:600;">Review the framework</button></div>` : ""}
    <div class="form-field" style="max-width:420px;">
      <label>Scenario</label>
      <select id="pr-scenario">${scenarios.map((s) => `<option value="${s.id}" ${s.id === P.scenarioId ? "selected" : ""}>${escapeHtml(s.title)}</option>`).join("")}</select>
    </div>
    <div class="scenario-card">
      <div class="sc-role">${escapeHtml(sc.role)}</div>
      <h3>${escapeHtml(sc.title)}</h3>
      <p><b>Situation.</b> ${escapeHtml(sc.situation)}</p>
      <p style="margin-top:6px;"><b>Your task.</b> ${escapeHtml(scGoal)}${fwOn ? ` Write it using <b>Level ${P.level} (${escapeHtml(fwLevel(P.level).code)})</b>.` : " Write the prompt you'd give an AI assistant."}</p>
    </div>
    <div class="form-field">
      <label>Your prompt</label>
      <textarea id="pr-draft" rows="8" placeholder="Write your prompt here…">${escapeHtml(P.draft)}</textarea>
    </div>
    <div style="display:flex;gap:8px;flex-wrap:wrap;">
      <button class="btn btn-primary" id="pr-feedback">${icon("check")} Get feedback</button>
      <button class="btn" id="pr-model">${P.showModel ? "Hide" : "Show"} ${fwOn ? "model prompt" : "a model answer"}</button>
      ${fwOn ? `<button class="btn" id="pr-compare">${P.compare ? "Hide" : "Show"} My prompt vs model</button>` : ""}
      <button class="btn btn-ghost" id="pr-reset">Clear</button>
    </div>
    <div id="pr-result" style="margin-top:18px;"></div>
    <div id="pr-model-box" style="margin-top:16px;"></div>
    <div id="pr-compare-box"></div>
    ${history.length ? `<div class="section-title" style="margin-top:24px;"><h2>Your recent attempts</h2></div>
      <div class="results-list">${history.slice(0, 6).map((h) => `<div class="mini-item" style="border:1px solid var(--border);border-radius:var(--radius-sm);padding:8px 12px;">
        <span class="quality-pill ${qualityClass(h.overall)}"><span class="quality-bar"><i style="width:${h.overall}%"></i></span>${h.overall}</span>
        <span class="mini-item-title">${escapeHtml(h.scenarioTitle)}</span>
        <span style="color:var(--text-faint);font-size:11px;flex:none;">${timeAgo(h.ts)}</span></div>`).join("")}</div>` : ""}`;

  const draftEl = container.querySelector("#pr-draft");
  container.querySelectorAll("[data-pr-level]").forEach((b) => b.addEventListener("click", () => {
    P.level = parseInt(b.dataset.prLevel, 10); P.result = null; P.scenarioId = null;
    renderPracticeView(container); window.scrollTo({ top: 0 });
  }));
  container.querySelectorAll("[data-fw-open]").forEach((b) => b.addEventListener("click", () => { STATE.frameworkLevel = parseInt(b.dataset.fwOpen, 10); navigate("framework"); }));
  container.querySelector("#pr-scenario").addEventListener("change", (e) => { P.scenarioId = e.target.value; P.result = null; renderPracticeView(container); });
  draftEl.addEventListener("input", () => { P.draft = draftEl.value; });
  container.querySelector("#pr-model").addEventListener("click", () => { P.showModel = !P.showModel; renderPracticeView(container); });
  const cmpBtn = container.querySelector("#pr-compare");
  if (cmpBtn) cmpBtn.addEventListener("click", () => { P.compare = !P.compare; renderPracticeView(container); });
  container.querySelector("#pr-reset").addEventListener("click", () => { P.draft = ""; P.result = null; renderPracticeView(container); });

  function paintModel() {
    const box = container.querySelector("#pr-model-box");
    if (!P.showModel) { box.innerHTML = ""; return; }
    const modelText = fwOn ? frameworkModelAnswer(sc, P.level) : modelAnswerFor(sc);
    box.innerHTML = `<div class="detail-section"><div class="block-header"><span class="label">${fwOn ? "Model prompt · Level " + P.level : "One way to write it"}</span><button class="btn btn-sm" id="pr-copy-model">${icon("copy")} Copy</button></div><div class="prompt-block">${escapeHtml(modelText)}</div></div>`;
    box.querySelector("#pr-copy-model").addEventListener("click", async () => { const ok = await copyText(modelText); showToast(ok ? "Copied" : "Couldn't copy"); });
  }
  function paintCompare() {
    const box = container.querySelector("#pr-compare-box");
    if (!fwOn || !P.compare) { box.innerHTML = ""; return; }
    box.innerHTML = frameworkCompareHtml(P.draft.trim(), sc, P.level);
    const cm = box.querySelector("#fw-copy-model");
    if (cm) cm.addEventListener("click", async () => { const ok = await copyText(frameworkModelAnswer(sc, P.level)); showToast(ok ? "Copied model" : "Couldn't copy"); });
  }
  function paintResult() {
    const box = container.querySelector("#pr-result");
    if (!P.result) { box.innerHTML = ""; return; }
    if (P.result.fw) {
      box.innerHTML = practiceFrameworkFeedbackHtml(P.result.ev);
      const cp = box.querySelector("#fw-copy-improved");
      if (cp) cp.addEventListener("click", async () => { const ok = await copyText(P.result.ev.improved); showToast(ok ? "Copied improved prompt" : "Couldn't copy"); });
    } else {
      box.innerHTML = practiceFeedbackHtml(P.result);
    }
  }
  container.querySelector("#pr-feedback").addEventListener("click", () => {
    const text = draftEl.value.trim();
    if (text.length < 15) { showToast("Write a bit more first"); return; }
    if (fwOn) {
      const ev = evaluateFramework(text, P.level);
      P.result = { fw: true, ev };
      Store.addFrameworkAttempt({ ts: Date.now(), level: P.level, scenarioId: sc.id, scenarioTitle: sc.title, score: ev.score });
      Store.addPracticeAttempt({ ts: Date.now(), scenarioId: sc.id, scenarioTitle: sc.title + " · L" + P.level, overall: ev.score, axes: ev.axes });
    } else {
      P.result = rubricScore(text);
      Store.addPracticeAttempt({ ts: Date.now(), scenarioId: sc.id, scenarioTitle: sc.title, overall: P.result.overall, axes: P.result.axes });
    }
    paintResult();
    if (fwOn && P.compare) paintCompare();
    renderSidebarFooter();
  });
  paintResult();
  paintModel();
  paintCompare();
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
