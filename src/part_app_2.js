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
// Learner-account (part_auth.js) scoping. Returns null for non-user sessions so
// the classic access-code logic below is used unchanged.
function userLibraryMode() {
  const s = Store.getSession && Store.getSession();
  if (!s || !s.user) return null;
  const a = (typeof userAccess === "function" && userAccess()) || s.access || null;
  const acc = a && a.access;
  if (acc && acc.active && acc.scopeType === "full") return { mode: "full" };
  // Function / signup scope and org "collection" scope both keep a FILTERED
  // category browse (Categories tab stays visible). `auto_function` rows created
  // before schema_v3 still say scopeType:"program" — coerce them to "function".
  if (acc && acc.active && (acc.scopeType === "function" || acc.scopeType === "collection"
      || (acc.scopeType === "program" && acc.source === "auto_function"))) {
    return {
      mode: acc.scopeType === "collection" ? "collection" : "function",
      categories: Array.isArray(acc.categoryIds) ? acc.categoryIds : [],
      programIds: Array.isArray(a.programs) ? a.programs : [],
      promptIds: Array.isArray(acc.promptIds) ? acc.promptIds : [],
    };
  }
  if (acc && acc.active && (acc.scopeType === "program" || acc.scopeType === "track")) {
    const ids = Array.isArray(a.programs) ? a.programs : [];
    // A stacked-access-code scope (source 'access_code') also carries a category
    // union on the entitlement — fold it in so the browse is the sum of every
    // applied code plus the signup function, not just the programmes' prompts.
    return {
      mode: "program", programIds: ids,
      categories: Array.isArray(acc.categoryIds) ? acc.categoryIds : [],
      promptIds: Array.isArray(acc.promptIds) ? acc.promptIds : [],
    };
  }
  return { mode: "preview" };   // unverified / no entitlement / suspended
}
// True when the scope is a filtered CATEGORY browse (function / org collection),
// as opposed to the access-code program scope which hides Categories.
function scopeShowsCategories() {
  const um = userLibraryMode();
  return !!(um && (um.mode === "function" || um.mode === "collection"));
}
function userPreviewLibrary() {
  return ALL_PROMPTS
    .filter((r) => r.lifecycle !== "Archived" && !(r.flags && r.flags.modelSpecific))
    .slice()
    .sort((a, b) => (b.qualityScore || 0) - (a.qualityScore || 0))
    .slice(0, 24);
}
function currentScope() {
  const s = Store.getSession();
  if (!s) return null;
  if (s.user) {
    const org = { id: s.orgId || "org-user", name: s.orgName || "Your organization", shortName: s.orgName || "" };
    const m = userLibraryMode();
    const programs = (m && m.mode === "program" ? m.programIds : []).map((id) => ORG_INDEX.programs[id]).filter(Boolean);
    return { session: s, user: s, org, program: programs.length === 1 ? programs[0] : null, programs, cohort: null };
  }
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
  const flag = (typeof PROGRAM_FLAGSHIP !== "undefined") && PROGRAM_FLAGSHIP[programId];
  if (flag) ids.add(flag);
  (prog.modules || []).forEach((m) => (MODULE_PROMPTS[m.id] || []).forEach((id) => ids.add(id)));
  return Array.from(ids);
}
/* Which central prompts is this learner allowed to browse?
   scope "full"  -> the whole library.
   scope "program" -> only the program's categories + explicitly linked prompts. */
function scopedLibrary() {
  const s = Store.getSession();
  const um = userLibraryMode();
  if (um) {
    if (um.mode === "full") return ALL_PROMPTS;
    if (um.mode === "preview") return userPreviewLibrary();
    // program | function | collection: categories + explicitly linked prompts.
    const linked = new Set(um.promptIds || []);
    (um.programIds || []).forEach((pid) => programPromptIds(pid).forEach((id) => linked.add(id)));
    const cats = new Set(um.categories || []);
    // A COLLECTION is "exactly this set": its programs contribute only their
    // module-linked prompts (above), never their whole category span — that
    // keeps the learner browse matched to the admin Scope preview count.
    // A function scope's category list is already the program-derived union, so
    // folding program categories in there stays a harmless no-op / edge fallback.
    if (um.mode !== "collection") {
      (um.programIds || []).forEach((pid) => ((ORG_INDEX.programs[pid] || {}).categories || []).forEach((c) => cats.add(c)));
    }
    // no-DB / pre-v3 fallback: derive the function's categories from the static catalogue
    if (!cats.size && (um.mode === "function" || um.mode === "collection") && typeof functionScopeCategories === "function") {
      functionScopeCategories(s && s.role).forEach((c) => cats.add(c));
    }
    const out = ALL_PROMPTS.filter((r) => cats.has(r.category) || linked.has(r.id));
    return out.length ? out : userPreviewLibrary();
  }
  if (s && s.kind === "admin") {
    const cats = adminScopeCategories(s);
    if (!cats || cats.size === 0) return ALL_PROMPTS;
    const linked = new Set();
    (s.programIds || []).forEach((pid) => programPromptIds(pid).forEach((id) => linked.add(id)));
    (s.functions || []).forEach((f) => {
      const p = (typeof FUNCTIONS !== "undefined" && FUNCTIONS[f]) ? FUNCTIONS[f].program : null;
      if (p) programPromptIds(p).forEach((id) => linked.add(id));
    });
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
  const um = userLibraryMode();
  if (um) return um.mode !== "full";
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

/* ---------- Unified scope description ----------
   One shape the Library landing, Home recommendations, Categories tab and the
   sidebar all read, so "what's in scope and how much" is stated the same way
   everywhere. Folds together the three scoping paths: learner-account
   function/collection (userLibraryMode), admin access codes (adminScopeCategories)
   and classic program access codes (program.categories). */
let __CURRICULUM_IDS = null;
function isCurriculumPrompt(rec) {
  if (!rec) return false;
  if (__CURRICULUM_IDS === null) {
    __CURRICULUM_IDS = new Set((typeof CURRICULUM_PROMPTS !== "undefined" ? CURRICULUM_PROMPTS : []).map((r) => r.id));
  }
  return __CURRICULUM_IDS.has(rec.id) || (!!rec.programId && rec.source && /curriculum|companion/i.test(rec.source));
}
function scopeInfo() {
  const lib = scopedLibrary();
  const total = lib.length;
  const liveCounts = {};
  lib.forEach((r) => { liveCounts[r.category] = (liveCounts[r.category] || 0) + 1; });
  const orderByCount = (cats) => Array.from(cats).filter((c) => liveCounts[c]).sort((a, b) => liveCounts[b] - liveCounts[a]);

  const s = Store.getSession();
  const sc = currentScope();
  const um = typeof userLibraryMode === "function" ? userLibraryMode() : null;

  let mode = "full", label = "Full library", functionName = null, inScope = null, programId = null;

  if (um) {
    mode = um.mode;
    if (um.mode === "full") { /* defaults */ }
    else if (um.mode === "preview") { label = "Preview library"; }
    else {
      // function / collection / program user account
      const fn = (s && s.role && typeof FUNCTION_SNAKE_TO_NAME !== "undefined") ? FUNCTION_SNAKE_TO_NAME[String(s.role).toLowerCase()] : null;
      functionName = fn || null;
      label = (s && s.orgName) || fn || (um.mode === "collection" ? "Your collection" : "Your library");
      const cats = new Set(um.categories || []);
      (um.programIds || []).forEach((pid) => ((ORG_INDEX.programs[pid] || {}).categories || []).forEach((c) => cats.add(c)));
      if (!cats.size && fn && typeof FUNCTIONS !== "undefined" && FUNCTIONS[fn]) FUNCTIONS[fn].categories.forEach((c) => cats.add(c));
      // fall back to whatever categories the scoped library actually contains
      if (!cats.size) Object.keys(liveCounts).forEach((c) => cats.add(c));
      inScope = cats;
      if ((um.programIds || []).length === 1) programId = um.programIds[0];
    }
  } else if (s && s.kind === "admin") {
    const cats = adminScopeCategories(s);
    if (cats && cats.size) {
      mode = "program";
      label = s.orgName || "Your library";
      functionName = (s.functions && s.functions.length === 1) ? s.functions[0] : null;
      inScope = cats;
      if ((s.programIds || []).length === 1) programId = s.programIds[0];
    }
  } else if (sc && sc.program && sc.program.scope === "program") {
    mode = "program";
    label = sc.program.name || (sc.org && sc.org.name) || "Your program";
    inScope = new Set(sc.program.categories || Object.keys(liveCounts));
    programId = sc.program.id;
  }

  // Categories that belong to the named function — the "In <Function>" group
  // and the recommendation focus boost. Distinct from `inScope`, which can be
  // wider (linked-prompt fallbacks pull in extra shelves).
  let functionCats = [];
  if (functionName && typeof FUNCTIONS !== "undefined" && FUNCTIONS[functionName]) {
    functionCats = FUNCTIONS[functionName].categories.filter((c) => liveCounts[c]);
  }
  const inScopeList = inScope ? orderByCount(inScope) : orderByCount(Object.keys(liveCounts));
  const fnSet = new Set(functionCats);
  // primaryCats: function categories first (by count), then the rest of scope.
  const primaryCats = orderByCount(functionCats).concat(inScopeList.filter((c) => !fnSet.has(c)));
  return {
    restricted: mode !== "full",
    mode, label, functionName,
    inScope, functionCats: orderByCount(functionCats), primaryCats,
    gridEligible: mode === "full" || primaryCats.length >= 2,
    programId,
    total,
  };
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
  listView: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M9 6h11M9 12h11M9 18h11"/><path d="M4 6h.01M4 12h.01M4 18h.01"/></svg>',
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
  eye: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M2 12s3.5-7 10-7 10 7 10 7-3.5 7-10 7-10-7-10-7z"/><circle cx="12" cy="12" r="3"/></svg>',
  key: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="8" cy="8" r="5"/><path d="M11.5 11.5L21 21M17 17l2-2M14 14l2-2"/></svg>',
};
function icon(name, cls) { return (ICONS[name] || "").replace("<svg ", `<svg class="${cls || ""}" `); }

/* ---------- Card + badge rendering, paginated list ---------- */
function renderHealthBadge(status) { return `<span class="badge-health ${healthClass(status)}"><span class="dot"></span>${escapeHtml(status)}</span>`; }
function renderQualityPill(score) {
  return `<span class="quality-pill ${qualityClass(score)}"><span class="quality-bar"><i style="width:${score}%"></i></span>${score}</span>`;
}
function renderDifficulty(d) { return `<span class="diff-dot diff-${d}"><i></i>${d}</span>`; }
function renderLifecycle(lc) { return `<span class="lc-badge lc-${lc}">${escapeHtml(lc)}</span>`; }

/* Simplified card: title + one-line intent + a calm meta line. The quality
   score, variable count and layer details live in the detail drawer
   (progressive disclosure). Save is the only on-card action; "Use" happens
   in the detail. */
function promptCardHtml(rec, opts) {
  opts = opts || {};
  const isFav = Store.isFavorite(rec.id);
  const srcTag = opts.showSource && rec.source && rec.source !== "Original Library"
    ? `<span class="chip chip-accent">${escapeHtml(rec.source === "Modified" || rec.source === "Optimized" ? "My version" : rec.source)}</span>` : "";
  const tmpl = rec.isTemplate
    ? `<span class="tmpl-glyph" title="Reusable template with ${(rec.variables || []).length} fill-in field${(rec.variables || []).length === 1 ? "" : "s"}" aria-label="Template">{ }</span>` : "";
  return `
  <article class="prompt-card${opts.starter ? " is-starter" : ""}${opts.pinnedId === rec.id ? " is-pinned" : ""}" data-id="${rec.id}" role="button" tabindex="0" aria-label="Open ${escapeHtml(rec.title)}">
    <div class="prompt-card-top">
      <div class="prompt-card-title">${opts.pinnedId === rec.id ? `<span class="pt-pin">Selected</span> ` : ""}${highlightHtml(rec.title, opts.hl)}</div>
      <div class="prompt-card-actions">
        ${tmpl}
        <button class="fav-btn ${isFav ? "is-fav" : ""}" data-action="fav" data-id="${rec.id}" aria-label="${isFav ? "Remove from Saved" : "Save"}" title="Save (F)">${isFav ? icon("starFilled") : icon("star")}</button>
      </div>
    </div>
    <div class="prompt-card-desc">${highlightHtml(rec.description, opts.hl)}</div>
    <div class="prompt-card-meta">
      ${opts.starter ? `<span class="chip chip-blue">Starter</span>` : ""}
      ${rec.source === "Everyday Essentials" && !opts.starter ? `<span class="chip chip-essential" title="Hand-written, framework-built prompt for an everyday task">Essential</span>` : ""}
      ${opts.hideCategory ? "" : `<span class="chip">${escapeHtml(rec.category)}</span>`}
      ${renderDifficulty(rec.difficulty)}
      ${srcTag}
    </div>
  </article>`;
}
/* Icon per category for the library tiles (hub prompts use their task icon). */
const CATEGORY_ICONS = {
  "Customer Support": "🎧", "Marketing & Branding": "📣", "HR & Recruiting": "🧑‍💼", "Social Media": "📱",
  "Legal & Compliance": "⚖️", "Content Writing & Copywriting": "✍️", "AI & Prompt Engineering": "🤖",
  "Coding & Tech": "💻", "Sales & Lead Generation": "🤝", "SEO & Analytics": "🔎", "Finance & Accounting": "💰",
  "Business Strategy": "♟️", "Education & Learning": "🎓", "Email Marketing": "📧", "Research & Data Analysis": "📊",
  "General": "✨", "Presentation & Slides": "🎤", "Productivity & Automation": "⚡", "Image & Design": "🎨",
  "E-Commerce": "🛒", "Communication & Leadership": "💬", "Book & Ebook Writing": "📚",
  "Coaching & Self-Development": "🌱", "UX/UI Design": "🧩", "Health & Fitness": "💪", "Product Management": "🧭",
  "Career Growth": "🚀", "Spirituality & Wellness": "🧘",
};
function promptIcon(rec) {
  if (rec.hub && typeof TASK_HUBS_BY_ID !== "undefined" && TASK_HUBS_BY_ID[rec.hub]) return TASK_HUBS_BY_ID[rec.hub].icon;
  return CATEGORY_ICONS[rec.category] || "📝";
}
/* Bold the query words in a title or description (word-start matches, the
   same rule search ranks by). Works on escaped text, so markup stays safe. */
function highlightHtml(text, words) {
  const safe = escapeHtml(text || "");
  const ws = (words || []).filter((w) => w && w.length >= 2 && !/^(amp|quot|lt|gt|39)$/.test(w));
  if (!ws.length) return safe;
  const re = new RegExp("(^|[^a-z0-9&#])(" + ws.map((w) => w.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")).sort((x, y) => y.length - x.length).join("|") + ")([a-z0-9]*)", "gi");
  // bold the whole word, as a search engine does ("meet" → "meeting")
  return safe.replace(re, (m, pre, hit, rest) => pre + "<mark>" + hit + rest + "</mark>");
}
/* Grid tile: icon, save star, bold title, 3-line description, calm footer. */
function promptTileHtml(rec, opts) {
  opts = opts || {};
  const isFav = Store.isFavorite(rec.id);
  const nVars = (rec.variables || []).length;
  return `
  <article class="prompt-card prompt-tile${opts.pinnedId === rec.id ? " is-pinned" : ""}" data-id="${rec.id}" role="button" tabindex="0" aria-label="Open ${escapeHtml(rec.title)}">
    <div class="pt-top">
      <span class="pt-ico" aria-hidden="true">${promptIcon(rec)}</span>
      <button class="fav-btn pt-fav ${isFav ? "is-fav" : ""}" data-action="fav" data-id="${rec.id}" aria-label="${isFav ? "Remove from Saved" : "Save"}" title="Save">${isFav ? icon("starFilled") : icon("star")}</button>
    </div>
    ${opts.pinnedId === rec.id ? `<span class="pt-pin">Selected</span>` : ""}
    <h3 class="pt-title">${highlightHtml(rec.title, opts.hl)}</h3>
    <p class="pt-desc">${highlightHtml(rec.description || "", opts.hl)}</p>
    <div class="pt-meta">
      ${rec.source === "Everyday Essentials" ? `<span class="chip chip-essential">Essential</span>` : ""}
      ${rec.source === "User Created" || rec.source === "Modified" ? `<span class="chip chip-accent">Yours</span>` : ""}
      ${opts.hideCategory ? "" : `<span class="chip">${escapeHtml(rec.category)}</span>`}
      ${renderDifficulty(rec.difficulty)}
      ${rec.isTemplate && nVars ? `<span class="pt-fill" title="Fill-in fields">{ } ${nVars}</span>` : ""}
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
  const grid = opts.layout === "grid";
  list.className = grid ? "tile-grid" : "results-list";
  container.appendChild(list);
  const sentinel = document.createElement("div");
  sentinel.setAttribute("aria-hidden", "true");
  function paint() {
    list.innerHTML = records.slice(0, shown).map((r) => grid ? promptTileHtml(r, opts) : promptCardHtml(r, opts)).join("");
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
  "How do I make a presentation?", "Reply to a difficult email", "Turn meeting notes into action items",
  "Excel formula for my data", "Improve my resume", "Give feedback to a team member",
];

/* ---------- Task hubs (TASK_HUBS lives in part_app_1 with the search) ---------- */
/* Prompts for a hub inside the learner's scope: the curated Everyday
   Essentials first (in authored order), then — when `withLibrary` — the best
   of the wider library for the hub's query, de-duplicated. */
function hubEssentials(hubId) {
  return scopedLibrary().filter((r) => r.hub === hubId);
}
function hubLibraryMatches(hub, limit) {
  const own = new Set(hubEssentials(hub.id).map((r) => r.id));
  // Only strong neighbours: skip weak imports and ones whose text still
  // carries pasted file metadata ("--- date: … tags: …").
  const res = searchPrompts(scopedLibrary(), hub.query, null, { quiet: true }).filter((r) =>
    !own.has(r.id) && r.lifecycle !== "Archived" && (r.qualityScore || 0) >= 62 &&
    !(r.flags && r.flags.embeddedMetadata) && !/^\s*(---|\*\*|certainly)/i.test(r.description || ""));
  return typeof limit === "number" ? res.slice(0, limit) : res;
}
function hubsInScope() {
  const counts = {};
  scopedLibrary().forEach((r) => { if (r.hub) counts[r.hub] = (counts[r.hub] || 0) + 1; });
  return TASK_HUBS.filter((h) => counts[h.id]).map((h) => Object.assign({ count: counts[h.id] }, h));
}
/* Roles: browse by who you are. Each role groups the categories that person
   reaches for, so a marketer sees marketing, social, SEO, email and copy
   prompts together. A category can sit in more than one role. */
const ROLES = [
  { id: "marketing", label: "Marketing", icon: "📣", sub: "Campaigns, social, SEO, email, copy",
    cats: ["Marketing & Branding", "Social Media", "SEO & Analytics", "Email Marketing", "Content Writing & Copywriting"] },
  { id: "sales", label: "Sales & customers", icon: "🤝", sub: "Leads, pitches, support, e-commerce",
    cats: ["Sales & Lead Generation", "Customer Support", "E-Commerce"] },
  { id: "leaders", label: "Managers & leaders", icon: "🧭", sub: "Strategy, teams, decisions, decks",
    cats: ["Business Strategy", "Communication & Leadership", "Presentation & Slides"] },
  { id: "people", label: "HR & people", icon: "🧑‍💼", sub: "Hiring, reviews, policies, culture",
    cats: ["HR & Recruiting"] },
  { id: "tech", label: "Tech & product", icon: "💻", sub: "Code, AI, product, UX design",
    cats: ["Coding & Tech", "AI & Prompt Engineering", "Product Management", "UX/UI Design"] },
  { id: "ops", label: "Finance & operations", icon: "📊", sub: "Numbers, legal, automation, data",
    cats: ["Finance & Accounting", "Legal & Compliance", "Productivity & Automation", "Research & Data Analysis"] },
  { id: "creators", label: "Writers & creators", icon: "✍️", sub: "Books, content, design, images",
    cats: ["Book & Ebook Writing", "Image & Design", "Content Writing & Copywriting"] },
  { id: "growth", label: "Learning & growth", icon: "🌱", sub: "Career, coaching, study, wellbeing",
    cats: ["Education & Learning", "Career Growth", "Coaching & Self-Development", "Health & Fitness", "Spirituality & Wellness"] },
];
const ROLES_BY_ID = {};
ROLES.forEach((r) => { ROLES_BY_ID[r.id] = r; });
function rolesInScope() {
  if (typeof isViewAllowed === "function" && !isViewAllowed("categoryDetail")) return [];
  const counts = {};
  scopedLibrary().forEach((r) => { counts[r.category] = (counts[r.category] || 0) + 1; });
  return ROLES.map((r) => Object.assign({}, r, { count: r.cats.reduce((n, c) => n + (counts[c] || 0), 0) })).filter((r) => r.count);
}
function openRole(roleId) {
  if (!ROLES_BY_ID[roleId]) return;
  STATE.activeRole = roleId;
  STATE.query = "";
  STATE.filters = emptyFilters();
  navigate("role");
}
/* A grid of task tiles. `limit` shows the first N with a "Show all" toggle. */
function taskGridHtml(opts) {
  opts = opts || {};
  const hubs = hubsInScope();
  if (!hubs.length) return "";
  const tile = (h) => `
    <button class="task-tile" data-hub="${h.id}">
      <span class="tt-ico" aria-hidden="true">${h.icon}</span>
      <span class="tt-body"><span class="tt-label">${escapeHtml(h.label)}</span>
        <span class="tt-sub">${h.count} ready-to-use prompt${h.count === 1 ? "" : "s"}</span></span>
    </button>`;
  const limit = opts.limit && hubs.length > opts.limit + 1 ? opts.limit : hubs.length;
  const head = hubs.slice(0, limit), rest = hubs.slice(limit);
  return `<div class="task-grid">${head.map(tile).join("")}</div>` +
    (rest.length ? `<div class="task-grid task-grid-more" data-hub-more hidden>${rest.map(tile).join("")}</div>
      <button class="btn btn-sm btn-ghost" data-hub-toggle data-show-all="Show all ${hubs.length} tasks" style="margin-top:8px;">Show all ${hubs.length} tasks</button>` : "");
}
function wireTaskGrid(el) {
  el.querySelectorAll("[data-hub]").forEach((b) => b.addEventListener("click", () => openHub(b.dataset.hub)));
  const t = el.querySelector("[data-hub-toggle]");
  if (t) t.addEventListener("click", () => {
    const more = el.querySelector("[data-hub-more]");
    more.hidden = !more.hidden;
    t.textContent = more.hidden ? t.dataset.showAll : "Show fewer tasks";
  });
}
function openHub(hubId) {
  if (!TASK_HUBS_BY_ID[hubId]) return;
  STATE.activeHub = hubId;
  STATE.query = "";
  STATE.filters = emptyFilters();
  navigate("task");
  if (typeof Backend !== "undefined" && Backend.logActivity) { try { Backend.logActivity("task_hub", hubId, {}); } catch (e) {} }
}
/* Closest alternatives when a search comes up short: the matching task hub,
   the categories the query routes to, and loose word-stem hits in titles/tags
   ("icf coach" → coaching prompts), ranked by quality. */
function similarForQuery(q, exclude, n) {
  exclude = exclude || new Set();
  const norm = normalizeQuery(q);
  const hub = detectTaskHub(norm);
  const routed = routedCategories(norm);
  const stems = tokenize(norm).map((w) => w.slice(0, Math.max(4, Math.min(w.length, 5)))).filter((w) => w.length >= 3);
  const scored = [];
  for (const r of getSearchCorpus()) {
    if (exclude.has(r.id) || r.lifecycle === "Archived") continue;
    const hay = (r.title + " " + (r.tags || []).join(" ") + " " + r.category).toLowerCase();
    let s = 0;
    for (const st of stems) if (wordHit(hay, st)) s += 12;
    if (hub && r.hub === hub.id) s += 20;
    if (routed.has(r.category)) s += 8;
    if (!s) continue;
    scored.push([s + (r.qualityScore || 0) * 0.12, r]);
  }
  scored.sort((a, b) => b[0] - a[0]);
  return scored.slice(0, n || 6).map((x) => x[1]);
}
function buildOwnCardHtml(q, total) {
  return `
  <div class="build-own">
    <div class="bo-ico" aria-hidden="true">🛠️</div>
    <div class="bo-text">
      <b>${total ? "Not quite right?" : "Don't have it yet?"} Build your own prompt with the framework.</b>
      <span>We'll start it from “${escapeHtml(q)}” and guide you through Role, Context, Task, Format, then how the AI should check its work. It takes about 2 minutes.</span>
    </div>
    <button class="btn btn-primary btn-sm" data-build-own data-seed="${escapeHtml(q)}">${icon("build")} Build it with me</button>
  </div>`;
}
/* Open the guided Level 2 framework builder, pre-filled from a search. */
function startBuilderFrom(seed) {
  seed = (seed || "").trim();
  const L2 = typeof fwLevel === "function" ? fwLevel(2) : null;
  const answers = {};
  if (seed && L2) {
    const ti = L2.componentKeys.indexOf("task");
    if (ti >= 0) answers["task_" + ti] = seed.charAt(0).toUpperCase() + seed.slice(1);
    const cats = Array.from(routedCategories(normalizeQuery(seed)));
    const meta = cats.length ? CATEGORIES.find((c) => c.name === cats[0]) : null;
    const ri = L2.componentKeys.indexOf("role");
    if (meta && meta.role && ri >= 0) answers["role_" + ri] = "an experienced " + meta.role.split(" / ")[0].toLowerCase();
  }
  STATE.builder = L2 ? { mode: "fw", level: 2, step: 0, answers, generated: null, seed } : null;
  navigate("builder");
}
/* Type-ahead under a search box: matching tasks, categories and the top
   prompts, with arrow-key navigation. Picking a prompt opens it. */
/* Recent searches: a per-browser convenience (like a search engine's
   history), so it lives in localStorage and fails soft. */
const RECENT_SEARCH_KEY = "prompt-lib:recentSearches";
function recentSearches() {
  try { const v = JSON.parse(localStorage.getItem(RECENT_SEARCH_KEY) || "[]"); return Array.isArray(v) ? v.slice(0, 8) : []; } catch (e) { return []; }
}
function rememberSearch(q) {
  q = String(q || "").trim();
  if (q.length < 2) return;
  const list = [q].concat(recentSearches().filter((x) => x.toLowerCase() !== q.toLowerCase())).slice(0, 8);
  try { localStorage.setItem(RECENT_SEARCH_KEY, JSON.stringify(list)); } catch (e) {}
}
function forgetSearches() { try { localStorage.removeItem(RECENT_SEARCH_KEY); } catch (e) {} }
/* Open a prompt picked from search and keep it on screen in the results:
   the query is committed and the prompt is pinned first under Best matches. */
function openFromSearch(q, id) {
  q = String(q || "").trim();
  rememberSearch(q);
  STATE.query = q;
  STATE.searchLiteral = null;
  STATE.searchPin = id;
  STATE.libTab = "all";
  if (!{ search: 1, categories: 1, categoryDetail: 1, task: 1, role: 1 }[STATE.view]) navigate("search");
  else renderApp();
  openDetail(id);
}
const SEARCH_TIP = `Tip: <code>"exact words"</code> · <code>-word</code> to leave out · <code>cat:hr</code> · <code>level:2</code> · <code>is:saved</code> · <code>is:mine</code>`;
function attachSearchSuggest(input, panel, handlers) {
  if (!input || !panel) return;
  handlers = handlers || {};
  const box = input.closest("[role=combobox]");
  let items = [], idx = -1;
  const hide = () => { panel.hidden = true; idx = -1; if (box) box.setAttribute("aria-expanded", "false"); };
  const show = (html) => { panel.innerHTML = html; panel.hidden = false; idx = -1; if (box) box.setAttribute("aria-expanded", "true"); };
  const opt = (it, ico, main, sub, cls) => { items.push(it); return `<button class="sg-item${cls ? " " + cls : ""}" role="option" data-i="${items.length - 1}"><span class="sg-ico">${ico}</span><span class="sg-main"><b>${main}</b>${sub ? `<small>${sub}</small>` : ""}</span></button>`; };
  // empty box: recent searches first, then popular ones
  function renderStart() {
    items = [];
    const recent = recentSearches();
    let html = "";
    if (recent.length) {
      html += `<div class="sg-head">Recent searches<button class="sg-clear" data-forget>Clear</button></div>`;
      recent.forEach((q) => { html += opt({ kind: "query", q }, "🕘", escapeHtml(q), ""); });
    }
    html += `<div class="sg-head">Popular searches</div>`;
    SEARCH_EXAMPLES.slice(0, recent.length ? 3 : 6).forEach((q) => { html += opt({ kind: "query", q }, "🔎", escapeHtml(q), ""); });
    html += `<div class="sg-tip">${SEARCH_TIP}</div>`;
    show(html);
  }
  function render() {
    const q = input.value.trim();
    if (q.length < 2) { if (document.activeElement === input) renderStart(); else hide(); return; }
    const nq = normalizeQuery(parseSearchQuery(q).text || q);
    const hubHit = detectTaskHub(nq);
    const hubs = hubsInScope().filter((h) => (hubHit && h.id === hubHit.id) || h.label.toLowerCase().includes(nq)).slice(0, 2);
    const cats = (isViewAllowed("categoryDetail") ? libCategoryList() : []).filter((c) => c.name.toLowerCase().includes(nq) ||
      nq.split(" ").some((w) => w.length >= 4 && c.name.toLowerCase().includes(w))).slice(0, 2);
    const prompts = searchPrompts(getSearchCorpus(), q, getUsageForSearch(), { quiet: true }).slice(0, 6);
    const hl = expandQueryTerms(parseSearchQuery(q).text || q, null, true).words;
    items = [];
    let html = "";
    const past = recentSearches().filter((x) => x.toLowerCase() !== q.toLowerCase() && x.toLowerCase().startsWith(q.toLowerCase())).slice(0, 2);
    past.forEach((x) => { html += opt({ kind: "query", q: x }, "🕘", escapeHtml(x), ""); });
    if (prompts.length) {
      html += `<div class="sg-head">Prompts</div>`;
      prompts.forEach((r) => {
        const tag = r.source === "User Created" || r.source === "Modified" ? " · Yours" : r.source === "Everyday Essentials" ? " · Essential" : "";
        html += opt({ kind: "prompt", id: r.id }, promptIcon(r), highlightHtml(r.title, hl), escapeHtml(r.category) + tag);
      });
    }
    if (hubs.length || cats.length) {
      html += `<div class="sg-head">Tasks & categories</div>`;
      hubs.forEach((h) => { html += opt({ kind: "hub", id: h.id }, h.icon, escapeHtml(h.label), `Task · ${h.count} prompts`); });
      cats.forEach((c) => { html += opt({ kind: "category", id: c.name }, CATEGORY_ICONS[c.name] || "📝", escapeHtml(c.name), `Category · ${c.count} prompts`); });
    }
    html += opt({ kind: "build" }, "🛠️", `Build “${escapeHtml(truncate(q, 40))}” with the framework`, "Can't find it? Create your own prompt, step by step", "sg-build");
    html += `<div class="sg-tip">${SEARCH_TIP}</div>`;
    show(html);
  }
  function pick(i) {
    const it = items[i]; if (!it) return;
    hide();
    if (it.kind === "prompt") (handlers.onPickPrompt || openFromSearch)(input.value, it.id);
    else if (it.kind === "query") { input.value = it.q; rememberSearch(it.q); (handlers.onQuery || ((q) => { input.dispatchEvent(new Event("input", { bubbles: true })); }))(it.q); }
    else if (it.kind === "hub") (handlers.onPickHub || openHub)(it.id);
    else if (it.kind === "category") (handlers.onPickCategory || ((n) => { STATE.activeCategory = n; navigate("categoryDetail"); }))(it.id);
    else startBuilderFrom(input.value);
  }
  function mark() { panel.querySelectorAll(".sg-item").forEach((b, j) => b.classList.toggle("on", j === idx)); const on = panel.querySelector(".sg-item.on"); if (on) on.scrollIntoView({ block: "nearest" }); }
  input.addEventListener("input", debounce(render, 120));
  // a page that focuses the box for you shouldn't pop the panel open; the
  // recent / popular list shows when the viewer taps or clicks into it
  input.addEventListener("focus", () => { if (input.value.trim().length >= 2) render(); });
  input.addEventListener("click", () => { if (panel.hidden) render(); });
  input.addEventListener("keydown", (e) => {
    if (e.key === "Enter" && (panel.hidden || idx < 0)) { rememberSearch(input.value); if (handlers.onSubmit) handlers.onSubmit(input.value); hide(); return; }
    if (panel.hidden) { if (e.key === "ArrowDown") render(); return; }
    if (e.key === "ArrowDown") { e.preventDefault(); idx = Math.min(items.length - 1, idx + 1); mark(); }
    else if (e.key === "ArrowUp") { e.preventDefault(); idx = Math.max(-1, idx - 1); mark(); }
    else if (e.key === "Enter") { e.preventDefault(); pick(idx); }
    else if (e.key === "Escape") hide();
  });
  panel.addEventListener("mousedown", (e) => e.preventDefault()); // keep focus in the input
  panel.addEventListener("click", (e) => {
    if (e.target.closest("[data-forget]")) { forgetSearches(); render(); return; }
    const b = e.target.closest(".sg-item"); if (b) pick(+b.dataset.i);
  });
  input.addEventListener("blur", () => setTimeout(hide, 120));
}
/* "Looks like you want to…" shortcut + typo line above search results. */
function searchUnderstoodHtml(results) {
  const m = SEARCH_META || {};
  let html = "";
  const o = m.ops;
  if (o) {
    const bits = [];
    o.exact.forEach((x) => bits.push(`contains “${escapeHtml(x)}”`));
    o.exclude.forEach((x) => bits.push(`without “${escapeHtml(x)}”`));
    o.cats.forEach((x) => bits.push(`category: ${escapeHtml(x)}`));
    if (o.level) bits.push(`framework level ${o.level}`);
    o.is.forEach((x) => bits.push({ saved: "saved by you", mine: "your own prompts", template: "fill-in templates", essential: "Everyday Essentials" }[x]));
    if (bits.length) html += `<div class="search-ops">Search filters: ${bits.map((b) => `<span class="chip">${b}</span>`).join(" ")}</div>`;
  }
  if (m.corrected) {
    html += `<div class="search-fix">Showing results for <b>${escapeHtml(m.corrected)}</b>. <button data-search-literal>Search “${escapeHtml(m.query)}” exactly instead</button></div>`;
  }
  if (m.hub && hubEssentials(m.hub.id).length) {
    const n = hubEssentials(m.hub.id).length;
    html += `<button class="intent-banner" data-hub="${m.hub.id}">
      <span class="ib-ico" aria-hidden="true">${m.hub.icon}</span>
      <span class="ib-text"><b>${escapeHtml(m.hub.label)}</b><span>${n} step-by-step prompt${n === 1 ? "" : "s"} for this, plus the best of the library</span></span>
      <span class="ib-go">Open toolkit →</span></button>`;
  }
  return html;
}
function getSearchCorpus() { return scopedLibrary().concat(Store.getMyPrompts()); }
function getUsageForSearch() { const u = Store.getUsage(); return { counts: u.counts, lastUsedTs: u.lastUsedTs, favorites: Store.getFavorites() }; }

function passesFilters(rec, f) {
  if (f.category && rec.category !== f.category) return false;
  if (f.promptType && rec.promptType !== f.promptType) return false;
  if (f.role && rec.role !== f.role) return false;
  if (f.skill && rec.skill !== f.skill) return false;
  if (f.difficulty && rec.difficulty !== f.difficulty) return false;
  if (f.aiTool && rec.aiTool !== f.aiTool) return false;
  if (f.source && rec.source !== f.source) return false;
  if (f.hasVariables && !rec.isTemplate) return false;
  if (f.fwLevel && String(rec.frameworkLevel || "") !== String(f.fwLevel)) return false;
  if (f.favoritesOnly && !Store.isFavorite(rec.id)) return false;
  return true;
}
function computeResults(query, filters, sort, baseCorpus) {
  const corpus = baseCorpus || getSearchCorpus();
  let results;
  const q = (query || "").trim();
  if (q) results = searchPrompts(corpus, q, getUsageForSearch(), { literal: STATE.searchLiteral === q });
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
const FILTER_LABELS = { category: "Category", skill: "Skill", promptType: "Prompt Type", role: "Role", difficulty: "Difficulty", aiTool: "AI Tool", source: "Source", fwLevel: "Framework" };
function activeFilterEntries(f) {
  const out = [];
  for (const k of ["category", "skill", "promptType", "role", "difficulty", "aiTool", "source"]) if (f[k]) out.push([k, f[k]]);
  if (f.fwLevel) out.push(["fwLevel", "Level " + f.fwLevel]);
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
  const hasAdvanced = f.skill || f.role || f.promptType || f.hasVariables;
  return `
  <div class="filter-bar">
    <select data-filter="category" aria-label="Category"><option value="">All categories</option>${categories.map((c) => `<option value="${escapeHtml(c)}" ${f.category === c ? "selected" : ""}>${escapeHtml(c)}</option>`).join("")}</select>
    <select data-filter="difficulty" aria-label="Difficulty"><option value="">Any level</option>${["Beginner", "Intermediate", "Advanced"].map((c) => `<option value="${c}" ${f.difficulty === c ? "selected" : ""}>${c}</option>`).join("")}</select>
    <select data-filter="fwLevel" aria-label="Framework level"><option value="">Any framework</option>${(typeof FRAMEWORK !== "undefined" ? FRAMEWORK.levels : []).map((L) => `<option value="${L.level}" ${String(f.fwLevel) === String(L.level) ? "selected" : ""}>Level ${L.level} · ${escapeHtml(L.code)}</option>`).join("")}</select>
    <label class="chip" style="cursor:pointer;"><input type="checkbox" id="filter-favs" style="margin-right:5px" ${f.favoritesOnly ? "checked" : ""}/> Saved only</label>
    <div class="spacer"></div>
    <select data-sort aria-label="Sort by">
      <option value="relevance" ${state.sort === "relevance" ? "selected" : ""}>Sort: Best match</option>
      <option value="quality" ${state.sort === "quality" ? "selected" : ""}>Highest quality</option>
      <option value="used" ${state.sort === "used" ? "selected" : ""}>Most used</option>
      <option value="recent" ${state.sort === "recent" ? "selected" : ""}>Recently added</option>
      <option value="az" ${state.sort === "az" ? "selected" : ""}>A–Z</option>
    </select>
    <details class="filter-more" ${hasAdvanced ? "open" : ""} style="width:100%;order:9;">
      <summary style="cursor:pointer;font-size:12px;color:var(--accent-strong);font-weight:600;padding:2px 0;">More filters</summary>
      <div style="display:flex;flex-wrap:wrap;gap:8px;margin-top:8px;">
        <select data-filter="skill" aria-label="Skill"><option value="">All skills</option>${skills.map((c) => `<option value="${escapeHtml(c)}" ${f.skill === c ? "selected" : ""}>${escapeHtml(c)}</option>`).join("")}</select>
        <select data-filter="role" aria-label="Role"><option value="">All roles</option>${roles.map((c) => `<option value="${escapeHtml(c)}" ${f.role === c ? "selected" : ""}>${escapeHtml(c)}</option>`).join("")}</select>
        <select data-filter="promptType" aria-label="Prompt type"><option value="">All types</option>${promptTypes.map((c) => `<option value="${escapeHtml(c)}" ${f.promptType === c ? "selected" : ""}>${escapeHtml(c)}</option>`).join("")}</select>
        <label class="chip" style="cursor:pointer;"><input type="checkbox" id="filter-vars" style="margin-right:5px" ${f.hasVariables ? "checked" : ""}/> Templates only</label>
      </div>
    </details>
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
      if (typeof blockIfLocked === "function" && blockIfLocked("prompt.save")) return;
      const now = Store.toggleFavorite(btn.dataset.id);
      btn.classList.toggle("is-fav", now);
      btn.innerHTML = now ? icon("starFilled") : icon("star");
      showToast(now ? "Saved" : "Removed from Saved");
      renderSidebarFooter();
    });
  });
  el.querySelectorAll('[data-action="copy"]').forEach((btn) => {
    if (btn.__wired) return;
    btn.__wired = true;
    btn.addEventListener("click", async (e) => {
      e.stopPropagation();
      if (typeof blockIfLocked === "function" && blockIfLocked("prompt.copy")) return;
      const rec = findPromptById(btn.dataset.id);
      if (!rec) return;
      const ok = await copyText(rec.originalPrompt);
      Store.recordUsage(rec.id, "copied");
      showToast(ok ? "Copied prompt text" : "Couldn't copy — select and copy manually");
    });
  });
}
