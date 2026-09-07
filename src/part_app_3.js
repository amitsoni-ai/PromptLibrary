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
    !seen.has(r.id) && r.lifecycle !== "Archived" && r.source === "Original Library" && !isCurriculumPrompt(r));

  const scored = pool.map((r) => {
    let s = (r.qualityScore || 0) * 0.25;
    let reason = "Popular in your library";
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
    <div class="search-hero">
      ${icon("search", "icon-search")}
      <input type="text" id="hero-search" placeholder="Describe your task in your own words — e.g. write a launch email to unhappy customers" value="${escapeHtml(STATE.query)}" autocomplete="off"/>
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

    html += `
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
  html += `<div class="result-count">${results.length.toLocaleString()} prompt${results.length === 1 ? "" : "s"}${scopeTag}</div><div id="results-list-target"></div>`;
  el.innerHTML = html;
  wireFilterBar(el, () => renderResultsInto(el, opts));
  renderPaginatedList(el.querySelector("#results-list-target"), results, {});
}
/* Up to 3 gentle starters: the program companion prompt first, then the
   highest-quality non-curriculum prompts in the learner's primary categories. */
function starterPrompts(si) {
  const out = [];
  const comp = programCompanionPrompt();
  if (comp) out.push(comp);
  const base = scopedLibrary()
    .filter((r) => r.source === "Original Library" && r.lifecycle !== "Archived" && !isCurriculumPrompt(r))
    .sort((a, b) => (b.qualityScore || 0) - (a.qualityScore || 0));
  const fnSet = new Set((si.functionCats && si.functionCats.length ? si.functionCats : si.primaryCats) || []);
  const take = (r) => { if (out.length < 3 && !out.some((x) => x.id === r.id)) out.push(r); };
  base.filter((r) => !fnSet.size || fnSet.has(r.category)).forEach(take);
  base.forEach(take); // fill any remaining slots from the wider scope
  return out.slice(0, 3);
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

/* Shared category grid — used by the Library landing and the Categories tab. */
function renderCategoryGridInto(el, opts) {
  opts = opts || {};
  const lib = scopedLibrary();
  const counts = {};
  lib.forEach((r) => { counts[r.category] = (counts[r.category] || 0) + 1; });
  const um = typeof userLibraryMode === "function" ? userLibraryMode() : null;
  const onlyCats = um && um.mode === "collection" && Array.isArray(um.categories) && um.categories.length
    ? new Set(um.categories) : null;
  let cats = CATEGORIES.filter((c) => counts[c.name] && (!onlyCats || onlyCats.has(c.name)))
    .map((c) => Object.assign({}, c, { count: counts[c.name] }));
  const q = (opts.filter || "").trim().toLowerCase();
  if (q) cats = cats.filter((c) => c.name.toLowerCase().includes(q) || (c.role || "").toLowerCase().includes(q));
  const maxCount = Math.max(1, ...cats.map((c) => c.count));
  const card = (c) => `
    <button class="category-card" data-category="${escapeHtml(c.name)}">
      <div class="category-card-name">${escapeHtml(c.name)}</div>
      <div class="category-card-count">${c.count.toLocaleString()} prompt${c.count === 1 ? "" : "s"} · ${escapeHtml(c.role || CATEGORY_SKILL[c.name] || "")}</div>
      <div class="category-card-bar"><i style="width:${(c.count / maxCount) * 100}%"></i></div>
    </button>`;
  const si = (typeof scopeInfo === "function") ? scopeInfo() : { functionName: null, functionCats: [] };
  let html = "";
  if (opts.grouped && !q && si.functionName && (si.functionCats || []).length) {
    const primary = new Set(si.functionCats);
    const inFn = cats.filter((c) => primary.has(c.name)).sort((a, b) => b.count - a.count);
    const other = cats.filter((c) => !primary.has(c.name)).sort((a, b) => b.count - a.count);
    html = `
      <div class="cat-group">In ${escapeHtml(si.functionName)}</div>
      <div class="category-grid">${inFn.map(card).join("")}</div>
      ${other.length ? `<details class="cat-more"><summary>More categories in your library (${other.length})</summary>
        <div class="category-grid" style="margin-top:12px;">${other.map(card).join("")}</div></details>` : ""}`;
  } else {
    cats.sort((a, b) => b.count - a.count);
    html = `<div class="category-grid">${cats.map(card).join("")}</div>`;
  }
  el.innerHTML = html + (!cats.length ? emptyStateHtml("grid", "No categories match", "Try a different word, or clear the search.") : "");
  el.querySelectorAll("[data-category]").forEach((x) => x.addEventListener("click", () => {
    STATE.activeCategory = x.dataset.category;
    STATE.query = "";
    STATE.filters = emptyFilters();
    STATE.filters.category = x.dataset.category;
    navigate("categoryDetail");
  }));
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

function renderSearchView(container) {
  const q = STATE.query.trim();
  const hasFilters = activeFilterEntries(STATE.filters).length > 0;
  const active = q || hasFilters || STATE.libBrowseAll;
  const si = (typeof scopeInfo === "function") ? scopeInfo() : { restricted: false, gridEligible: true, primaryCats: [], total: scopedLibrary().length, label: "Full library", functionName: null };
  const catsHidden = !isViewAllowed("categories");

  const searchHero = `
    <div class="lib-landing" ${active ? 'style="margin:0 0 12px;max-width:none;"' : ""}>
      ${active ? "" : `<h1>Find a prompt for what you're doing</h1>`}
      <div class="search-hero">
        ${icon("search", "icon-search")}
        <input type="text" id="lib-search" placeholder="Search by goal, task, role or keyword…" autocomplete="off" value="${escapeHtml(STATE.query)}"/>
        ${q ? `<button class="icon-clear" id="lib-clear" aria-label="Clear search">${icon("x")}</button>` : ""}
      </div>
      ${active ? "" : `<div class="lib-quicklinks">
        ${catsHidden ? "" : `<button class="btn btn-sm" data-nav="categories">${icon("grid")} All categories</button>`}
        <button class="btn btn-sm" data-nav="builder">${icon("build")} Create a prompt</button>
        <button class="btn btn-sm" data-nav="me">${icon("star")} Saved</button>
        <button class="btn btn-sm" id="lib-ask">${icon("message")} Describe your situation</button>
      </div>`}
    </div>`;

  let bodyHtml;
  if (active) {
    bodyHtml = `<div id="search-results"></div>`;
  } else {
    const starters = starterPrompts(si);
    const banner = si.restricted
      ? `<div class="scope-banner">
           <div class="sb-label">${escapeHtml(si.label)}${si.functionName && si.functionName !== si.label ? " · " + escapeHtml(si.functionName) : ""}</div>
           <div class="sb-line">${escapeHtml(scopeSummaryLine(si))}</div>
           <button class="linklike" data-browse-all>Browse everything in scope →</button>
         </div>`
      : `<div class="lib-scopeline">${escapeHtml(scopeSummaryLine(si))}</div>`;
    const starterBlock = starters.length ? `
      <div class="home-block">
        <div class="section-title"><h2>New to the library? Start with these</h2>
          <button class="linklike" data-browse-all>See all ${si.total.toLocaleString()} prompts →</button></div>
        <div class="starter-strip">${starters.map((r) => promptCardHtml(r, { starter: true })).join("")}</div>
      </div>` : "";
    let mainBody, browseAllBtn = "";
    if (!si.gridEligible && si.programId && ORG_INDEX.programs[si.programId]) {
      const prog = ORG_INDEX.programs[si.programId];
      mainBody = `<div class="section-title"><h2>${escapeHtml(prog.name)} — modules</h2>
        <span style="font-size:12px;color:var(--text-faint)">Prompts grouped by your program</span></div>
        <div id="lib-modules"></div>`;
      browseAllBtn = `<button class="btn" data-browse-all style="margin-top:14px;">${icon("layers")} Browse all ${si.total.toLocaleString()} prompts</button>`;
    } else {
      mainBody = `<div class="section-title"><h2>Browse by category</h2></div><div id="lib-grid"></div>`;
    }
    bodyHtml = banner + starterBlock + mainBody + browseAllBtn;
  }

  container.innerHTML = searchHero + bodyHtml;

  if (active) {
    renderResultsInto(container.querySelector("#search-results"), {});
  } else {
    const gridEl = container.querySelector("#lib-grid");
    if (gridEl) renderCategoryGridInto(gridEl, { grouped: si.restricted });
    const modEl = container.querySelector("#lib-modules");
    if (modEl && si.programId) renderModuleListInto(modEl, ORG_INDEX.programs[si.programId]);
  }

  container.querySelectorAll("[data-nav]").forEach((el) => el.addEventListener("click", () => navigate(el.dataset.nav)));
  container.querySelectorAll("[data-browse-all]").forEach((el) => el.addEventListener("click", () => { STATE.libBrowseAll = true; renderContent(); }));
  const askBtn = container.querySelector("#lib-ask");
  if (askBtn) askBtn.addEventListener("click", () => openAskLibrary());
  const sInput = container.querySelector("#lib-search");
  if (sInput) {
    sInput.focus();
    sInput.setSelectionRange(sInput.value.length, sInput.value.length);
    sInput.addEventListener("input", debounce((e) => { STATE.query = e.target.value; renderContent(); }, 160));
  }
  const clr = container.querySelector("#lib-clear");
  if (clr) clr.addEventListener("click", () => { STATE.query = ""; STATE.libBrowseAll = false; renderContent(); });
}

/* ---------- Categories ---------- */
function renderCategoriesView(container) {
  const lib = scopedLibrary();
  const nCats = new Set(lib.map((r) => r.category)).size;
  const q = STATE.query.trim();
  container.innerHTML = `
    <div class="section-title"><h2>Categories</h2><span style="font-size:12px;color:var(--text-faint)">${q ? `matching “${escapeHtml(q)}”` : `${nCats} categories · ${lib.length.toLocaleString()} prompts`}</span></div>
    <div id="cats-grid"></div>`;
  renderCategoryGridInto(container.querySelector("#cats-grid"), { filter: q, grouped: isScopeRestricted() });
}
function renderCategoryDetail(container) {
  const cat = STATE.activeCategory;
  const meta = CATEGORIES.find((c) => c.name === cat);
  if (!meta) { navigate("categories"); return; }
  const inCat = scopedLibrary().filter((r) => r.category === cat);
  container.innerHTML = `
    <button class="btn btn-ghost btn-sm" data-nav="categories" style="margin-bottom:12px;">← All categories</button>
    <div class="section-title" style="margin-bottom:4px;"><h2 style="font-size:20px;">${escapeHtml(cat)}</h2>
      <span style="font-size:12px;color:var(--text-faint)">${inCat.length.toLocaleString()} prompts · for ${escapeHtml(meta.role || CATEGORY_SKILL[cat] || "any professional")}</span></div>
    <div id="cat-results"></div>`;
  container.querySelector("[data-nav]").addEventListener("click", () => { STATE.query = ""; navigate("categories"); });
  renderResultsInto(container.querySelector("#cat-results"), {});
}

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
