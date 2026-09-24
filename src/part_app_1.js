<script>
/* =========================================================================
   Synottic Prompt Intelligence — learner platform
   Single-file app. Central prompt data lives in the #data-* script tags and
   is never mutated. Learner-owned content (favorites, saved prompts,
   improvements, practice, progress) lives in the Store layer.
   ========================================================================= */

/* ---------- Small utilities ---------- */
function escapeHtml(s) {
  if (s == null) return "";
  return String(s).replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
}
function debounce(fn, ms) {
  let t;
  return function (...args) { clearTimeout(t); t = setTimeout(() => fn.apply(this, args), ms); };
}
function uid(prefix) {
  return (prefix || "id") + "-" + Math.random().toString(36).slice(2, 10) + Date.now().toString(36);
}
function truncate(s, n) {
  if (!s) return "";
  if (s.length <= n) return s;
  const cut = s.slice(0, n);
  const lastSpace = cut.lastIndexOf(" ");
  return (lastSpace > n * 0.6 ? cut.slice(0, lastSpace) : cut) + "…";
}
function timeAgo(ts) {
  if (!ts) return "";
  const s = Math.floor((Date.now() - ts) / 1000);
  if (s < 60) return "just now";
  const m = Math.floor(s / 60); if (m < 60) return m + "m ago";
  const h = Math.floor(m / 60); if (h < 24) return h + "h ago";
  const d = Math.floor(h / 24); if (d < 30) return d + "d ago";
  const mo = Math.floor(d / 30); if (mo < 12) return mo + "mo ago";
  return Math.floor(mo / 12) + "y ago";
}
function hashStr(str) {
  let h = 2166136261;
  for (let i = 0; i < str.length; i++) { h ^= str.charCodeAt(i); h = Math.imul(h, 16777619); }
  return (h >>> 0);
}
async function copyText(text) {
  try { await navigator.clipboard.writeText(text); return true; }
  catch (e) {
    try {
      const ta = document.createElement("textarea");
      ta.value = text; ta.style.position = "fixed"; ta.style.opacity = "0";
      document.body.appendChild(ta); ta.select(); document.execCommand("copy");
      document.body.removeChild(ta); return true;
    } catch (e2) { return false; }
  }
}
let __toastTimer = null;
function showToast(msg) {
  let el = document.getElementById("toast");
  if (!el) { el = document.createElement("div"); el.id = "toast"; el.className = "toast"; document.body.appendChild(el); }
  el.textContent = msg;
  el.classList.add("toast-show");
  clearTimeout(__toastTimer);
  __toastTimer = setTimeout(() => el.classList.remove("toast-show"), 1800);
}
function healthClass(status) {
  return { "Excellent": "health-excellent", "Good": "health-good", "Needs Improvement": "health-needs", "Review": "health-review" }[status] || "health-good";
}
function qualityClass(score) { if (score >= 80) return "q-high"; if (score >= 55) return "q-mid"; return "q-low"; }

/* ---------- Persistence layer ----------
   `db` runtime capability when available (survives reloads + devices);
   localStorage otherwise (per-browser only — the UI says which). Same API. */
const Store = (function () {
  let db = null, downloads = null, sampleFn = null, backend = "local";
  let neon = false;                  // true once a server backend is hydrating this session
  let userBacked = false;            // true when that server backend is the cookie-session
                                      // account-user route (/api/user-state) rather than the
                                      // classic access-code Bearer route (/api/state)
  const _pending = {};               // key -> value awaiting a debounced push to the backend
  let _pushTimer = null;
  function pushState(key, value) {
    if (!neon) return;
    _pending[key] = value;
    clearTimeout(_pushTimer);
    _pushTimer = setTimeout(() => {
      const batch = Object.assign({}, _pending);
      for (const k in _pending) delete _pending[k];
      (userBacked ? Backend.putUserState(batch) : Backend.putState(batch));
    }, 450);
  }
  let favorites = new Set();
  let usage = { counts: {}, recent: [], lastUsedTs: {} };
  let myPrompts = [];
  let improvements = {};
  let feedback = {};
  let session = null;               // { code, orgId, programId, cohortId, learnerId, name, startedAt }
  let progress = { modulesTouched: {}, practice: [], learnedLessons: {} };

  function lsGet(key, fallback) {
    try { const v = localStorage.getItem("prompt-lib:" + key); return v ? JSON.parse(v) : fallback; }
    catch (e) { return fallback; }
  }
  function lsSet(key, val) { try { localStorage.setItem("prompt-lib:" + key, JSON.stringify(val)); } catch (e) {} }
  function nsKey(key) {
    // learner-owned collections are namespaced so one browser shared by
    // several test codes doesn't cross-contaminate. Neon sessions carry a
    // server-issued `subject`; local sessions fall back to learner/cohort/code.
    const s = session ? (session.subject || session.learnerId || session.cohortId || session.code) : "anon";
    return s + ":" + key;
  }

  async function init() {
    try {
      if (window.claude && typeof window.claude.use === "function") {
        db = await window.claude.use("db");
        downloads = await window.claude.use("downloads");
        sampleFn = await window.claude.use("sample");
      }
    } catch (e) { db = null; }
    session = lsGet("session", null);

    // Shared by both server-backed paths below: apply a fetched state blob to
    // the in-memory store and mirror it to localStorage so an offline reload
    // still has data.
    function hydrateFromState(st) {
      favorites = new Set(Array.isArray(st.favorites) ? st.favorites : []);
      const u = st.usage;
      usage = u ? { counts: u.counts || {}, recent: u.recent || [], lastUsedTs: u.lastUsedTs || {} } : usage;
      myPrompts = Array.isArray(st.myPrompts) ? st.myPrompts : [];
      improvements = st.improvements && typeof st.improvements === "object" ? st.improvements : {};
      feedback = st.feedback && typeof st.feedback === "object" ? st.feedback : {};
      progress = st.progress ? Object.assign({ modulesTouched: {}, practice: [], learnedLessons: {} }, st.progress) : progress;
      lsSet(nsKey("favorites"), Array.from(favorites));
      lsSet(nsKey("usage"), usage); lsSet(nsKey("myPrompts"), myPrompts);
      lsSet(nsKey("improvements"), improvements); lsSet(nsKey("feedback"), feedback);
      lsSet(nsKey("progress"), progress);
    }
    const STATE_KEYS_ALL = ["favorites", "usage", "myPrompts", "improvements", "feedback", "progress"];

    // 1) Classic access-code session (Bearer token from /api/session) — the
    //    deployed source of truth for code-redeemed learners.
    if (typeof Backend !== "undefined" && Backend.isConfigured() && session && session.backend && Backend.hasSession()) {
      const st = await Backend.getState(STATE_KEYS_ALL);
      if (st && st.__revoked) { return { backend: "revoked" }; }
      if (st) {
        neon = true; userBacked = false;
        backend = "neon";
        db = null;   // Neon wins; don't also write to the claude-db capability
        hydrateFromState(st);
        return { backend, hasSample: false, hasDownloads: false };
      }
      // backend configured but unreachable -> fall through to local cache below
    }

    // 1b) Account (email+password) session — cookie-authenticated, no Bearer
    //    token. Was localStorage-only before /api/user-state existed (AUTH.md's
    //    documented gap): a saved prompt / favorite didn't survive a new device
    //    or cleared browser data. `session.user` + `session.subject` are set by
    //    part_auth.js#applyUserSession on every successful sign-in.
    if (typeof Backend !== "undefined" && Backend.isConfigured() && session && session.user && session.subject) {
      const st = await Backend.getUserState(STATE_KEYS_ALL);
      if (st && st.__revoked) { return { backend: "revoked" }; }
      if (st) {
        neon = true; userBacked = true;
        backend = "neon";
        db = null;
        hydrateFromState(st);
        return { backend, hasSample: false, hasDownloads: false };
      }
      // backend configured but unreachable -> fall through to local cache below
    }

    if (db) {
      backend = "db";
      try {
        const [favDoc, usageDoc, fbDoc, mySnap, impSnap, progDoc] = await Promise.all([
          db.doc("state/" + nsKey("favorites")).get(),
          db.doc("state/" + nsKey("usage")).get(),
          db.doc("state/" + nsKey("feedback")).get(),
          db.collection(nsKey("myPrompts")).limit(1000).get(),
          db.collection(nsKey("improvements")).limit(1000).get(),
          db.doc("state/" + nsKey("progress")).get(),
        ]);
        favorites = new Set((favDoc.exists && favDoc.data().ids) || []);
        const u = usageDoc.exists ? usageDoc.data() : null;
        usage = u ? { counts: u.counts || {}, recent: u.recent || [], lastUsedTs: u.lastUsedTs || {} } : usage;
        feedback = (fbDoc.exists && fbDoc.data().ratings) || {};
        myPrompts = mySnap.docs.map((d) => d.data());
        impSnap.docs.forEach((d) => { improvements[d.id] = d.data(); });
        if (progDoc.exists) progress = Object.assign(progress, progDoc.data());
      } catch (e) { db = null; backend = "local"; }
    }
    if (backend === "local") {
      favorites = new Set(lsGet(nsKey("favorites"), []));
      usage = lsGet(nsKey("usage"), usage);
      myPrompts = lsGet(nsKey("myPrompts"), []);
      improvements = lsGet(nsKey("improvements"), {});
      feedback = lsGet(nsKey("feedback"), {});
      progress = lsGet(nsKey("progress"), progress);
    }
    return { backend, hasSample: !!sampleFn, hasDownloads: !!downloads };
  }

  function pFav() {
    lsSet(nsKey("favorites"), Array.from(favorites));
    if (neon) pushState("favorites", Array.from(favorites));
    else if (db) db.doc("state/" + nsKey("favorites")).set({ ids: Array.from(favorites) }).catch(() => {});
  }
  function pUsage() {
    lsSet(nsKey("usage"), usage);
    if (neon) pushState("usage", usage);
    else if (db) db.doc("state/" + nsKey("usage")).set(usage).catch(() => {});
  }
  function pFb() {
    lsSet(nsKey("feedback"), feedback);
    if (neon) pushState("feedback", feedback);
    else if (db) db.doc("state/" + nsKey("feedback")).set({ ratings: feedback }).catch(() => {});
  }
  function pMy() { lsSet(nsKey("myPrompts"), myPrompts); if (neon) pushState("myPrompts", myPrompts); }
  function pImp() { lsSet(nsKey("improvements"), improvements); if (neon) pushState("improvements", improvements); }
  function pProg() {
    lsSet(nsKey("progress"), progress);
    if (neon) pushState("progress", progress);
    else if (db) db.doc("state/" + nsKey("progress")).set(progress).catch(() => {});
  }
  function ensureFw() {
    let f = progress.framework;
    if (!f || typeof f !== "object") f = progress.framework = {};
    f.comps = f.comps || {};
    f.levels = f.levels || {};
    f.attempts = Array.isArray(f.attempts) ? f.attempts : [];
    f.best = f.best || {};
    return f;
  }

  return {
    init,
    getBackend: () => backend,
    hasSample: () => !!sampleFn,
    hasDownloads: () => !!downloads,
    sample: (...args) => sampleFn && sampleFn(...args),
    downloadsSave: (...args) => downloads && downloads.save(...args),

    getSession: () => session,
    setSession(s) { session = s; lsSet("session", s); },
    clearSession() {
      session = null; neon = false;
      try { localStorage.removeItem("prompt-lib:session"); } catch (e) {}
      if (typeof Backend !== "undefined") Backend.clearSession();
    },
    getBackendLabel() { return neon ? "Synced to Neon" : backend === "db" ? "Synced to your account" : "Saved in this browser"; },

    // Saved ids that point at a merged duplicate move to the prompt it merged into.
    remapFavorites(aliases) {
      let changed = false;
      favorites = new Set(Array.from(favorites, (id) => {
        if (aliases[id]) { changed = true; return aliases[id]; }
        return id;
      }));
      if (changed) pFav();
    },
    isFavorite: (id) => favorites.has(id),
    getFavorites: () => favorites,
    toggleFavorite(id) {
      const now = favorites.has(id) ? (favorites.delete(id), false) : (favorites.add(id), true);
      pFav();
      if (typeof Backend !== "undefined") Backend.logActivity(now ? "favorited" : "unfavorited", id);
      return now;
    },

    getUsage: () => usage,
    recordUsage(id, action) {
      usage.counts[id] = (usage.counts[id] || 0) + 1;
      usage.lastUsedTs[id] = Date.now();
      usage.recent = usage.recent.filter((r) => r.id !== id);
      usage.recent.unshift({ id, ts: Date.now(), action });
      usage.recent = usage.recent.slice(0, 60);
      pUsage();
      if (typeof Backend !== "undefined" && ["opened", "copied", "tested"].includes(action)) Backend.logActivity(action, id);
    },

    getMyPrompts: () => myPrompts,
    getMyPrompt(id) { return myPrompts.find((p) => p.id === id); },
    saveMyPrompt(o) {
      myPrompts.unshift(o);
      if (typeof SearchIndex !== "undefined") SearchIndex.add(o); // findable right away
      if (db) db.collection(nsKey("myPrompts")).doc(o.id).set(o).catch(() => {});
      pMy();
      if (typeof Backend !== "undefined") Backend.logActivity("created", o.id, { title: o.title });
      return o.id;
    },
    updateMyPrompt(id, patch) {
      const i = myPrompts.findIndex((p) => p.id === id);
      if (i === -1) return;
      myPrompts[i] = Object.assign({}, myPrompts[i], patch);
      if (typeof SearchIndex !== "undefined") SearchIndex.add(myPrompts[i]);
      if (db) db.collection(nsKey("myPrompts")).doc(id).set(myPrompts[i]).catch(() => {});
      pMy();
    },
    deleteMyPrompt(id) {
      myPrompts = myPrompts.filter((p) => p.id !== id);
      if (typeof SearchIndex !== "undefined") SearchIndex.remove(id);
      if (db) db.collection(nsKey("myPrompts")).doc(id).delete().catch(() => {});
      pMy();
    },

    getImprovement: (id) => improvements[id],
    saveImprovement(id, data) {
      improvements[id] = data;
      // the viewer's improved wording becomes searchable for them
      if (typeof SearchIndex !== "undefined") SearchIndex.refresh(id);
      if (db) db.collection(nsKey("improvements")).doc(id).set(data).catch(() => {});
      pImp();
      if (typeof Backend !== "undefined") Backend.logActivity("improved", id, { method: data && data.method });
    },

    getFeedback: (id) => feedback[id],
    saveFeedback(id, rating) { feedback[id] = rating; pFb(); },

    getProgress: () => progress,
    markModuleViewed(moduleId) { progress.modulesTouched[moduleId] = Date.now(); pProg(); },
    markLessonLearned(lessonKey) { progress.learnedLessons[lessonKey] = Date.now(); pProg(); },
    addPracticeAttempt(rec) {
      progress.practice.unshift(rec);
      progress.practice = progress.practice.slice(0, 100);
      pProg();
      if (typeof Backend !== "undefined") Backend.logActivity("practice", rec.scenarioId || null, { overall: rec.overall });
    },

    /* ---- Prompt Framework progress (kept inside `progress` so it rides the
       same localStorage / Neon / db sync path) ---- */
    getFrameworkProgress: () => ensureFw(),
    markFrameworkComponent(key) { const f = ensureFw(); if (!f.comps[key]) { f.comps[key] = Date.now(); pProg(); } },
    markFrameworkLevelViewed(lv) { const f = ensureFw(); if (!f.levels[lv]) { f.levels[lv] = Date.now(); pProg(); } },
    addFrameworkAttempt(rec) {
      const f = ensureFw();
      f.attempts.unshift(rec);
      f.attempts = f.attempts.slice(0, 100);
      if (rec.level != null && (!(rec.level in f.best) || rec.score > f.best[rec.level])) f.best[rec.level] = rec.score;
      pProg();
      if (typeof Backend !== "undefined") Backend.logActivity("practice", rec.scenarioId || null, { framework: rec.level, score: rec.score });
    },
    flush() { if (neon && _pushTimer) { clearTimeout(_pushTimer); const b = Object.assign({}, _pending); for (const k in _pending) delete _pending[k]; return (userBacked ? Backend.putUserState(b) : Backend.putState(b)); } },
  };
})();

/* ---------- Search: intent expansion + weighted relevance ---------- */
const INTENT_SYNONYMS = {
  "market research": ["industry research", "market analysis", "competitor research", "customer research", "market intelligence"],
  "email": ["business email", "executive communication", "customer email", "professional email"],
  "leadership": ["leading a team", "executive presence", "team lead"],
  "leadership strategy": ["management strategy", "team strategy", "executive strategy"],
  "linkedin post": ["social media post", "linkedin content", "professional post"],
  "linkedin": ["social media post", "professional network"],
  "presentation": ["slide deck", "pitch deck"],
  "proposal": ["sales pitch", "business proposal"],
  "training program": ["learning program", "training plan", "onboarding program"],
  "training": ["learning program", "onboarding program"],
  "competitor analysis": ["competitive analysis", "competitor research", "market research"],
  "competitor": ["competitive analysis", "market research"],
  "customer complaint": ["customer support", "complaint response", "service recovery", "unhappy customer"],
  "complaint": ["customer issue", "service recovery"],
  "ai transformation": ["ai adoption", "ai strategy", "digital transformation", "ai roadmap", "artificial intelligence"],
  "ai adoption": ["ai transformation", "ai strategy", "ai rollout"],
  "ai strategy": ["ai transformation", "ai adoption", "ai roadmap"],
  "executive email": ["business email", "leadership communication", "professional email"],
  "sales proposal": ["sales pitch", "business proposal"],
  "difficult conversation": ["performance conversation", "employee conversation", "feedback conversation"],
  "employee conversation": ["performance review", "difficult conversation", "hr conversation"],
  "customer feedback": ["customer research", "feedback analysis", "survey analysis", "voice of customer"],
  "job search": ["career growth", "job application"],
  "resume": ["job search", "career growth"],
  "brand": ["brand identity", "brand strategy"],
  "roadmap": ["strategic plan", "long-term plan"],
  "onboarding": ["training program", "new hire"],
  "swot": ["competitive analysis", "strengths and weaknesses"],
  "seo": ["search engine optimization", "keyword research"],
  "content calendar": ["editorial calendar", "content plan"],
  "budget": ["financial plan", "forecast"],
  "negotiation": ["deal terms", "contract negotiation"],
  "interview": ["interview questions", "candidate screening"],
  "performance review": ["performance evaluation", "employee review"],
  "customer research": ["market research", "voice of customer"],
  "pitch deck": ["slide deck", "investor deck"],
  "ecommerce": ["online store", "product listing"],
  "coaching": ["development plan", "mentoring session"],
  // everyday words people actually type
  "powerpoint": ["presentation", "slide deck"],
  "ppt": ["presentation", "slide deck"],
  "slides": ["presentation", "slide deck"],
  "deck": ["presentation", "slide deck"],
  "cv": ["resume"],
  "spreadsheet": ["excel", "formula", "google sheets"],
  "excel": ["spreadsheet", "formula", "pivot table"],
  "sheets": ["spreadsheet", "formula"],
  "minutes": ["meeting notes", "action items"],
  "meeting": ["agenda", "meeting notes", "action items"],
  "summarize": ["summary", "key points"],
  "summarise": ["summary", "key points"],
  "tldr": ["summary", "key points"],
  "todo": ["to do list", "prioritize tasks"],
  "prioritize": ["to do list", "plan my week"],
  "prioritise": ["to do list", "plan my week"],
  "okr": ["goals", "key results"],
  "goals": ["okr", "objectives"],
  "feedback": ["constructive feedback", "sbi"],
  "raise": ["salary negotiation", "pay rise"],
  "salary": ["salary negotiation", "compensation"],
  "trip": ["travel plan", "itinerary"],
  "vacation": ["travel plan", "itinerary"],
  "holiday": ["travel plan", "itinerary"],
  "diet": ["meal plan", "healthy eating"],
  "gym": ["workout plan", "fitness"],
  "procrastinating": ["procrastination", "focus"],
  "stressed": ["stress", "burnout"],
  "grammar": ["proofread", "spelling"],
  "proofread": ["grammar check", "spelling"],
  "rephrase": ["rewrite", "change tone"],
  "paraphrase": ["rewrite", "rephrase"],
  "bug": ["debug", "error"],
  "error": ["debug", "fix my code"],
  "script": ["automate", "automation"],
  "sop": ["standard operating procedure", "process document"],
  "decision": ["decision matrix", "pros and cons"],
  "decide": ["decision matrix", "pros and cons"],
  "angry": ["unhappy customer", "complaint response"],
  "quit": ["resignation letter"],
  "resign": ["resignation letter"],
};
const FIELD_WEIGHTS = { title: 10, originalTitle: 6, useCase: 6, outcome: 4, description: 4, category: 5, role: 4, skill: 5, tags: 6, promptType: 2, aiTool: 1, originalPrompt: 2 };
const QUERY_STOPWORDS = new Set(["a", "an", "the", "for", "to", "of", "in", "on", "with", "my", "me", "and", "or", "i", "need", "want", "how", "do", "some", "please", "am", "is", "are",
  "can", "you", "your", "what", "whats", "which", "should", "could", "would", "will", "best", "way", "ways", "good", "great", "get", "give", "about", "it", "its", "this", "that", "be", "at", "from", "by", "we", "our", "us", "im", "ive", "help", "tips", "idea", "someone", "something", "really", "just", "quick", "quickly", "new", "using", "any", "better"]);
/* Generic action verbs ("make a presentation", "write an email") carry almost
   no signal on their own, so they are dropped from a query when there is a
   more specific word left to rank on. */
const GENERIC_VERBS = new Set(["make", "making", "create", "creating", "write", "writing", "build", "prepare", "draft", "do", "doing", "put", "together", "plan", "come", "up", "generate", "produce"]);

/* Intent -> category routing. Lets a query land on the right shelf of the
   library even when its words are too common to rank on their own
   ("AI strategy" -> AI & Business Strategy shelves). Matched loosely: the
   key is tested as a substring of the normalized query. */
const INTENT_CATEGORY = {
  "ai ": ["AI & Prompt Engineering", "Business Strategy"],
  "artificial intelligence": ["AI & Prompt Engineering"],
  "prompt": ["AI & Prompt Engineering"],
  "automation": ["Productivity & Automation", "AI & Prompt Engineering"],
  "strategy": ["Business Strategy"],
  "roadmap": ["Business Strategy", "Product Management"],
  "competitor": ["Business Strategy", "Research & Data Analysis"],
  "leadership": ["Communication & Leadership"],
  "manager": ["Communication & Leadership", "HR & Recruiting"],
  "team": ["Communication & Leadership"],
  "difficult conversation": ["Communication & Leadership", "HR & Recruiting"],
  "email": ["Email Marketing", "Communication & Leadership"],
  "newsletter": ["Email Marketing"],
  "customer": ["Customer Support"],
  "complaint": ["Customer Support"],
  "support ticket": ["Customer Support"],
  "sales": ["Sales & Lead Generation"],
  "prospect": ["Sales & Lead Generation"],
  "lead": ["Sales & Lead Generation"],
  "cold outreach": ["Sales & Lead Generation"],
  "hiring": ["HR & Recruiting"],
  "recruit": ["HR & Recruiting"],
  "interview": ["HR & Recruiting"],
  "onboard": ["HR & Recruiting", "Education & Learning"],
  "performance review": ["HR & Recruiting"],
  "training": ["Education & Learning", "HR & Recruiting"],
  "course": ["Education & Learning"],
  "curriculum": ["Education & Learning"],
  "content": ["Content Writing & Copywriting"],
  "copywriting": ["Content Writing & Copywriting"],
  "blog": ["Content Writing & Copywriting", "SEO & Analytics"],
  "headline": ["Content Writing & Copywriting"],
  "social media": ["Social Media"],
  "linkedin": ["Social Media"],
  "instagram": ["Social Media"],
  "seo": ["SEO & Analytics"],
  "keyword": ["SEO & Analytics"],
  "analytics": ["SEO & Analytics", "Research & Data Analysis"],
  "product": ["Product Management"],
  "feature": ["Product Management"],
  "user story": ["Product Management"],
  "roadmap prioritization": ["Product Management"],
  "ux": ["UX/UI Design"],
  "wireframe": ["UX/UI Design"],
  "usability": ["UX/UI Design"],
  "finance": ["Finance & Accounting"],
  "budget": ["Finance & Accounting"],
  "invoice": ["Finance & Accounting"],
  "forecast": ["Finance & Accounting"],
  "legal": ["Legal & Compliance"],
  "contract": ["Legal & Compliance"],
  "compliance": ["Legal & Compliance"],
  "policy": ["Legal & Compliance", "HR & Recruiting"],
  "research": ["Research & Data Analysis"],
  "data analysis": ["Research & Data Analysis"],
  "survey": ["Research & Data Analysis"],
  "presentation": ["Presentation & Slides"],
  "slide": ["Presentation & Slides"],
  "pitch deck": ["Presentation & Slides", "Sales & Lead Generation"],
  "ecommerce": ["E-Commerce"],
  "product description": ["E-Commerce", "Content Writing & Copywriting"],
  "marketing": ["Marketing & Branding"],
  "brand": ["Marketing & Branding"],
  "campaign": ["Marketing & Branding"],
  "book": ["Book & Ebook Writing"],
  "ebook": ["Book & Ebook Writing"],
  "chapter": ["Book & Ebook Writing"],
  "career": ["Career Growth"],
  "resume": ["Career Growth"],
  "coaching": ["Coaching & Self-Development"],
  "productivity": ["Productivity & Automation"],
  "workflow": ["Productivity & Automation"],
  "powerpoint": ["Presentation & Slides"],
  "ppt": ["Presentation & Slides"],
  "deck": ["Presentation & Slides"],
  "meeting": ["Productivity & Automation", "Communication & Leadership"],
  "agenda": ["Productivity & Automation"],
  "excel": ["Research & Data Analysis"],
  "spreadsheet": ["Research & Data Analysis"],
  "formula": ["Research & Data Analysis"],
  "cv": ["Career Growth"],
  "cover letter": ["Career Growth"],
  "salary": ["Career Growth"],
  "feedback": ["Communication & Leadership"],
  "habit": ["Coaching & Self-Development"],
  "stress": ["Coaching & Self-Development"],
  "workout": ["Health & Fitness"],
  "meal": ["Health & Fitness"],
  "code": ["Coding & Tech"],
  "sql": ["Coding & Tech", "Research & Data Analysis"],
};

/* Task hubs — the everyday jobs people come to the library with. Each hub is
   a front door: a tile on Home / Library, its own toolkit page (curated
   "Everyday Essentials" prompts first, then the best of the wider library),
   and an intent the search engine recognises in plain-language queries
   ("how do I make a presentation" -> present). `match` phrases are tested
   against the normalised query; the longest matching phrase wins so
   "cold email" routes to customers, not email. */
const TASK_HUBS = [
  { id: "present", label: "Make a presentation", icon: "🎤", blurb: "Build a deck, turn notes into slides, write speaker notes and prep for Q&A.", query: "presentation slides deck",
    match: ["presentation", "present", "slides", "slide", "deck", "powerpoint", "ppt", "keynote", "google slides", "speaker notes", "pitch deck", "talk track"] },
  { id: "email", label: "Write an email or message", icon: "✉️", blurb: "Draft, reply, follow up, say no or apologise, in the right tone.", query: "email message reply",
    match: ["email", "e-mail", "mail", "reply", "respond", "message", "follow up", "follow-up", "apology", "apologize", "apologise", "decline", "say no", "announcement", "out of office", "thank you note"] },
  { id: "meetings", label: "Run better meetings", icon: "🗓️", blurb: "Agendas, minutes, action items, follow-ups and retros.", query: "meeting agenda minutes",
    match: ["meeting", "meetings", "agenda", "minutes", "action items", "retrospective", "retro", "transcript", "workshop", "one on one", "1:1"] },
  { id: "docs", label: "Summarize & write reports", icon: "📄", blurb: "Summaries, status updates, reports, SOPs, FAQs and policies.", query: "summary report document",
    match: ["summarize", "summarise", "summary", "tldr", "report", "status update", "weekly update", "sop", "procedure", "faq", "document", "policy", "explain this", "contract", "project update"] },
  { id: "plan", label: "Plan a project or your week", icon: "🧭", blurb: "Project plans, priorities, goals, OKRs, launches and 90-day plans.", query: "plan project priorities goals",
    match: ["project plan", "plan", "planning", "timeline", "milestone", "prioritize", "prioritise", "priorities", "to do", "to-do", "todo", "okr", "goals", "launch", "checklist", "business case", "strategy on a page", "user stories", "90 day", "30 60 90"],
    hint: ["week", "strategy", "roadmap", "project"] },
  { id: "data", label: "Excel, data & charts", icon: "📊", blurb: "Formulas, pivot tables, dashboards, SQL and finding insights.", query: "excel data analysis formula",
    match: ["excel", "spreadsheet", "google sheets", "sheets", "formula", "vlookup", "xlookup", "pivot", "data", "chart", "graph", "dashboard", "kpi", "sql", "survey", "statistics", "numbers", "csv"] },
  { id: "decide", label: "Solve a problem or decide", icon: "⚖️", blurb: "Decision matrices, root cause, SWOT, risks and competitor analysis.", query: "decision problem solving",
    match: ["decide", "decision", "choose", "should i", "dilemma", "pros and cons", "root cause", "swot", "risk", "competitor", "stuck", "5 whys"],
    hint: ["problem"] },
  { id: "ideas", label: "Brainstorm ideas", icon: "💡", blurb: "Fresh ideas, names, campaigns, marketing plans and events.", query: "brainstorm ideas",
    match: ["brainstorm", "ideas", "idea", "creative", "name", "naming", "marketing plan", "ad copy", "tagline", "slogan", "event", "party", "team building", "product description"] },
  { id: "career", label: "Job search & career", icon: "🚀", blurb: "Resume, cover letter, interviews, salary talks and career plans.", query: "resume interview career",
    match: ["resume", "cv", "cover letter", "interview", "job", "career", "salary", "raise", "promotion", "resign", "resignation", "networking", "self review", "appraisal", "job search"] },
  { id: "lead", label: "Manage people & teams", icon: "👥", blurb: "Feedback, reviews, 1:1s, delegation, conflict and hiring.", query: "feedback team manager",
    match: ["feedback", "performance review", "delegate", "delegation", "conflict", "hire", "hiring", "job description", "onboarding", "one on one", "1:1", "motivate", "morale", "recognition", "direct report", "team member", "new hire"],
    hint: ["team", "employee", "manager", "manage", "staff", "colleague"] },
  { id: "learn", label: "Learn anything faster", icon: "🎓", blurb: "Simple explanations, study plans, quizzes and training design.", query: "learn explain study",
    match: ["learn", "learning", "explain", "understand", "study", "quiz", "exam", "flashcard", "flashcards", "teach", "training", "course", "homework", "book summary", "eli5"] },
  { id: "write", label: "Edit, rewrite & proofread", icon: "✍️", blurb: "Fix grammar, change tone, simplify, write articles, bios and speeches.", query: "rewrite proofread writing",
    match: ["proofread", "grammar", "spelling", "rewrite", "rephrase", "paraphrase", "tone", "simplify", "edit", "blog", "article", "bio", "speech", "toast", "translate", "writing"] },
  { id: "life", label: "Personal life & money", icon: "🏠", blurb: "Budgets, trips, meal plans, workouts, gifts and life admin.", query: "budget travel meal plan",
    match: ["budget", "money", "save money", "saving", "trip", "travel", "itinerary", "vacation", "holiday", "meal", "recipe", "grocery", "workout", "fitness", "gift", "doctor", "landlord", "complaint letter", "invest", "organize", "declutter"] },
  { id: "brand", label: "LinkedIn & personal brand", icon: "🌐", blurb: "LinkedIn posts and profile, content calendars and press releases.", query: "linkedin post personal brand",
    match: ["linkedin", "personal brand", "social media", "post", "content calendar", "press release", "instagram"] },
  { id: "customers", label: "Customers & sales", icon: "🤝", blurb: "Unhappy customers, cold emails, proposals and objections.", query: "customer sales proposal",
    match: ["customer", "client", "complaint", "cold email", "sales", "prospect", "proposal", "objection", "reviews", "support reply"] },
  { id: "ai", label: "Get more from AI", icon: "🤖", blurb: "Improve your prompts, find AI time-savers and check AI answers.", query: "improve prompt ai",
    match: ["prompt", "chatgpt", "claude", "gemini", "copilot", "fact check", "hallucination", "use ai", "ai tool"],
    hint: ["ai"] },
  { id: "wellbeing", label: "Focus, stress & habits", icon: "🌿", blurb: "Beat procrastination, manage stress, build habits, hard talks.", query: "focus habit stress",
    match: ["focus", "procrastinate", "procrastination", "stress", "burnout", "burnt out", "burned out", "overwhelmed", "habit", "routine", "motivation", "difficult conversation", "reflect", "journal", "anxiety"] },
  { id: "tech", label: "Code & tech help", icon: "💻", blurb: "Debug code, understand code, automate tasks, fix tech issues.", query: "code debug automate",
    match: ["code", "coding", "debug", "bug", "error", "python", "javascript", "script", "automate", "automation", "macro", "laptop", "wifi", "tech support", "software"] },
];
const TASK_HUBS_BY_ID = {};
TASK_HUBS.forEach((h) => { TASK_HUBS_BY_ID[h.id] = h; });
/* Best matching hub for a free-text query, or null. A `match` phrase names
   the job itself ("email", "presentation") and scores its length x 2; a
   `hint` only says who or what it's about ("manager", "team") and scores 2,
   so "email to my manager" is an email, while "my manager" alone still
   leans towards managing people. Longest / strongest phrase wins. */
function hubPhraseHit(q, m) {
  let i = q.indexOf(" " + m);
  while (i !== -1) {
    // allow a plural / verb ending ("slides", "emailing") but not a longer word
    const tail = q.slice(i + 1 + m.length).match(/^[a-z]*/)[0];
    if (!tail || /^(s|es|ed|ing|er|ers)$/.test(tail)) return true;
    i = q.indexOf(" " + m, i + 1);
  }
  return false;
}
function detectTaskHub(query) {
  const q = " " + normalizeQuery(query).replace(/[^a-z0-9: -]+/g, " ") + " ";
  if (q.trim().length < 2) return null;
  let best = null, bestScore = 0;
  for (const h of TASK_HUBS) {
    let score = 0;
    for (const m of h.match) if (hubPhraseHit(q, m)) score = Math.max(score, m.length * 2);
    for (const m of (h.hint || [])) if (hubPhraseHit(q, m)) score = Math.max(score, 2);
    if (score > bestScore) { best = h; bestScore = score; }
  }
  return best;
}
function routedCategories(normQuery) {
  const set = new Set();
  for (const key in INTENT_CATEGORY) {
    if (normQuery.indexOf(key.trim()) !== -1) INTENT_CATEGORY[key].forEach((c) => set.add(c));
  }
  return set;
}

function normalizeQuery(q) { return (q || "").toLowerCase().trim().replace(/[’']/g, "").replace(/[?!.,;"()]+/g, " ").replace(/\s+/g, " ").trim(); }
/* Light stemmer: fold plurals and -ing/-ed so "presentations", "meetings",
   "summarizing" meet the library's wording. Matching is prefix-based
   (wordHit), so a shorter stem still hits the longer forms. */
function stemWord(w) {
  if (w.length <= 4) return w;
  if (/ies$/.test(w)) return w.slice(0, -3) + "y";
  if (/(ss|us|is)$/.test(w)) return w;
  if (/(xes|ches|shes|sses)$/.test(w)) return w.slice(0, -2);
  if (/s$/.test(w)) return w.slice(0, -1);
  if (w.length > 6 && /ing$/.test(w)) return w.slice(0, -3);
  if (w.length > 5 && /ed$/.test(w)) return w.slice(0, -2);
  return w;
}
function tokenize(q) {
  const all = q.split(" ").filter((w) => w.length >= 2 && !QUERY_STOPWORDS.has(w));
  const specific = all.filter((w) => !GENERIC_VERBS.has(w));
  return (specific.length ? specific : all).map(stemWord);
}
/* Typo tolerance: an unknown query word is swapped for the closest word the
   library actually uses (edit distance 1, or 2 for long words), preferring
   common words. Words that are a prefix of a real word (still typing) are
   left alone. */
function editDistance(a, b, max) {
  if (Math.abs(a.length - b.length) > max) return max + 1;
  let prev = new Array(b.length + 1);
  for (let j = 0; j <= b.length; j++) prev[j] = j;
  for (let i = 1; i <= a.length; i++) {
    const cur = [i];
    let rowMin = i;
    for (let j = 1; j <= b.length; j++) {
      cur[j] = Math.min(prev[j] + 1, cur[j - 1] + 1, prev[j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1));
      if (cur[j] < rowMin) rowMin = cur[j];
    }
    if (rowMin > max) return max + 1;
    prev = cur;
  }
  return prev[b.length];
}
function correctWord(word, df) {
  // short words ("vows") are too easy to "fix" into a different real word
  if (!df || word.length < 5 || df[word] || /\d/.test(word)) return word;
  const max = word.length >= 9 ? 2 : 1;
  let best = null, bestD = max + 1, bestDf = 0;
  for (const v in df) {
    const n = df[v];
    if (n < 3) continue;
    if (v.length > word.length && v.startsWith(word)) return word; // still typing
    if (Math.abs(v.length - word.length) > max) continue;
    const d = editDistance(word, v, max);
    if (d < bestD || (d === bestD && n > bestDf)) { best = v; bestD = d; bestDf = n; }
  }
  return best && bestD <= max ? best : word;
}
function dfIndexFor(all) {
  if (!all || !all.length) return null;
  SearchIndex.sync(all);
  return SearchIndex.df();
}
function expandQueryTerms(q, all, literal) {
  let norm = normalizeQuery(q);
  const df = all && !literal ? dfIndexFor(all) : null;
  let corrected = null;
  if (df) {
    const fixed = norm.split(" ").map((w) => (QUERY_STOPWORDS.has(w) || GENERIC_VERBS.has(w)) ? w : correctWord(w, df));
    const fixedNorm = fixed.join(" ");
    if (fixedNorm !== norm) { corrected = fixedNorm; norm = fixedNorm; }
  }
  const words = tokenize(norm);
  const synonymTerms = new Set();
  for (const key in INTENT_SYNONYMS) {
    if (norm === key || norm.includes(key)) INTENT_SYNONYMS[key].forEach((s) => synonymTerms.add(s));
  }
  norm.split(" ").forEach((w) => { if (INTENT_SYNONYMS[w]) INTENT_SYNONYMS[w].forEach((s) => synonymTerms.add(s)); });
  words.forEach((w) => { if (INTENT_SYNONYMS[w]) INTENT_SYNONYMS[w].forEach((s) => synonymTerms.add(s)); });
  // The phrase used for exact-phrase bonuses drops filler ("how do i make a
  // presentation" -> "presentation") so it can actually appear in a title.
  const phrase = words.length ? words.join(" ") : norm;
  return { phrase, words, synonymTerms: Array.from(synonymTerms), corrected, full: norm };
}
function idfWeight(word) {
  const n = Math.max(2, SearchIndex.size()), dfw = SearchIndex.docFreq(word) || 1;
  const idf = Math.log((n + 1) / dfw);
  return Math.max(0.25, Math.min(1.6, idf / Math.log(n)));
}
function fieldText(rec, field) {
  const v = rec[field];
  if (v == null) return "";
  if (Array.isArray(v)) return v.join(" ");
  return String(v);
}
function wordHit(text, word) {
  if (!word) return false;
  let idx = text.indexOf(word);
  while (idx !== -1) {
    const before = idx === 0 ? " " : text[idx - 1];
    if (!/[a-z0-9]/.test(before)) return true;
    idx = text.indexOf(word, idx + 1);
  }
  return false;
}
/* ---------- Search index ----------
   One inverted index over every prompt the viewer can reach: the library,
   authored prompts, and the viewer's own prompts and improved versions.
   It is built on the first search. After that, a record a search meets that
   isn't indexed yet (or was replaced) is indexed on the spot, and Store
   writes (save / edit / delete / improve) re-index just that prompt, so a
   new prompt is findable the moment it exists. Each viewer's own prompts
   and improvements live in their own Store, so the index is per viewer. */
const SEARCH_EXTRA_WEIGHTS = { yourVersion: 3 };
const SearchIndex = (function () {
  const docs = new Map();      // id -> { rec, lc: {field: lowercased text}, words: Set }
  const postings = new Map();  // word -> Set of ids
  let terms = null;            // sorted words, for prefix lookups
  let dfCache = null;          // word -> number of prompts using it
  function fieldsOf(rec) {
    const lc = {};
    for (const f in FIELD_WEIGHTS) { const t = fieldText(rec, f); if (t) lc[f] = t.toLowerCase(); }
    const imp = typeof Store !== "undefined" && Store.getImprovement ? Store.getImprovement(rec.id) : null;
    if (imp && imp.improvedPrompt) lc.yourVersion = String(imp.improvedPrompt).toLowerCase();
    return lc;
  }
  function remove(id) {
    const d = docs.get(id);
    if (!d) return;
    d.words.forEach((w) => { const p = postings.get(w); if (p) { p.delete(id); if (!p.size) postings.delete(w); } });
    docs.delete(id);
    terms = null; dfCache = null;
  }
  function add(rec) {
    if (!rec || !rec.id) return null;
    remove(rec.id);
    const lc = fieldsOf(rec), words = new Set();
    for (const f in lc) for (const w of lc[f].split(/[^a-z0-9]+/)) if (w.length >= 2) words.add(w);
    const d = { rec, lc, words };
    docs.set(rec.id, d);
    words.forEach((w) => { let p = postings.get(w); if (!p) postings.set(w, (p = new Set())); p.add(rec.id); });
    terms = null; dfCache = null;
    return d;
  }
  function doc(rec) { const d = docs.get(rec.id); return d && d.rec === rec ? d : add(rec); }
  // index anything in this corpus that is new or was replaced
  function sync(all) { for (let i = 0; i < all.length; i++) doc(all[i]); }
  function sortedTerms() { if (!terms) terms = Array.from(postings.keys()).sort(); return terms; }
  // ids of prompts with a word starting with `prefix` (matches wordHit)
  function idsWithPrefix(prefix, into) {
    const t = sortedTerms();
    let lo = 0, hi = t.length;
    while (lo < hi) { const m = (lo + hi) >> 1; if (t[m] < prefix) lo = m + 1; else hi = m; }
    for (let i = lo; i < t.length && t[i].startsWith(prefix); i++) postings.get(t[i]).forEach((id) => into.add(id));
    return into;
  }
  function df() {
    if (!dfCache) { dfCache = Object.create(null); postings.forEach((p, w) => { dfCache[w] = p.size; }); }
    return dfCache;
  }
  return {
    add, remove, doc, sync, idsWithPrefix, df,
    size: () => docs.size,
    docFreq: (w) => { const p = postings.get(w); return p ? p.size : 0; },
    // re-index one prompt after the viewer changes it (e.g. saves an improvement)
    refresh(id) { const d = docs.get(id); if (d) add(d.rec); },
    // a different viewer signed in: their prompts and improvements differ
    reset() { docs.clear(); postings.clear(); terms = null; dfCache = null; },
  };
})();
function scoreRecord(rec, expanded) {
  const { phrase, words, synonymTerms } = expanded;
  if (!phrase) return { score: 0, tier: 0 };
  const lc = SearchIndex.doc(rec).lc;
  let wordBest = {}, bestPhraseWeight = 0, synonymScore = 0, bigramScore = 0, clusterScore = 0;
  for (const field in lc) {
    const text = lc[field];
    const weight = FIELD_WEIGHTS[field] || SEARCH_EXTRA_WEIGHTS[field] || 2;
    if (words.length > 1 && text.includes(phrase)) bestPhraseWeight = Math.max(bestPhraseWeight, weight);
    let hitsThisField = 0;
    for (const w of words) {
      if (wordHit(text, w)) {
        hitsThisField++;
        const contribution = weight * idfWeight(w);
        if (!wordBest[w] || contribution > wordBest[w]) wordBest[w] = contribution;
      }
    }
    // adjacent query words that also sit next to each other in this field —
    // the strongest signal that the record is about the query, not just
    // sharing common words with it.
    for (let k = 0; k < words.length - 1; k++) {
      if (text.indexOf(words[k] + " " + words[k + 1]) !== -1) bigramScore = Math.max(bigramScore, weight * 6);
    }
    // several distinct query words landing in the SAME field
    if (hitsThisField >= 2) clusterScore = Math.max(clusterScore, weight * (hitsThisField - 1) * 2.4);
    for (const s of synonymTerms) { if (text.includes(s)) synonymScore = Math.max(synonymScore, weight * 1.4); }
  }
  const wordsMatched = Object.keys(wordBest);
  let directScore = wordsMatched.reduce((sum, w) => sum + wordBest[w], 0) * 4;
  directScore += bestPhraseWeight * 16 + bigramScore * 4 + clusterScore * 3;
  if (directScore === 0 && synonymScore === 0) return { score: 0, tier: 0 };
  const coverage = words.length ? wordsMatched.length / words.length : 1;
  directScore *= 0.35 + 0.65 * coverage;
  const total = directScore + synonymScore * 0.5 + (rec.qualityScore || 0) * 0.05;
  return { score: total, tier: directScore > 0 ? 2 : 1 };
}
function usageBoost(rec, usage) {
  if (!usage) return 0;
  let b = 0;
  const uc = usage.counts && usage.counts[rec.id];
  if (uc) b += Math.min(uc, 10) * 0.6;
  if (usage.favorites && usage.favorites.has(rec.id)) b += 2;
  // what this viewer used lately ranks a little higher, fading over ~2 weeks
  const ts = usage.lastUsedTs && usage.lastUsedTs[rec.id];
  if (ts) b += 3 * Math.max(0, 1 - (Date.now() - ts) / (14 * 864e5));
  if (rec.source === "User Created" || rec.source === "Modified") b += 1.5;
  return b;
}
/* Search operators, Google style. Anything else is plain words.
     "exact phrase"   must contain the phrase
     -word            leave out prompts with this word
     cat:hr  category:"hr & recruiting"   only these categories
     level:2  (or L2)  framework level
     is:saved  is:mine  is:template  is:essential */
const SEARCH_IS = {
  saved: (r) => typeof Store !== "undefined" && Store.isFavorite(r.id),
  mine: (r) => r.source === "User Created" || r.source === "Modified",
  template: (r) => !!r.isTemplate,
  essential: (r) => r.source === "Everyday Essentials",
};
function parseSearchQuery(q) {
  const ops = { exact: [], exclude: [], cats: [], level: null, is: [] };
  let text = " " + String(q || "") + " ";
  text = text.replace(/(^|\s)(?:cat|category):(?:"([^"]+)"|(\S+))/gi, (m, sp, a, b) => { ops.cats.push((a || b).toLowerCase().replace(/[-_]+/g, " ")); return " "; });
  text = text.replace(/(^|\s)(?:level:|l)([1-3])(?=\s)/gi, (m, sp, n) => { ops.level = n; return " "; });
  text = text.replace(/(^|\s)is:(\w+)/gi, (m, sp, k) => { if (SEARCH_IS[k.toLowerCase()]) ops.is.push(k.toLowerCase()); return " "; });
  text = text.replace(/"([^"]+)"/g, (m, ph) => { const t = normalizeQuery(ph); if (t) ops.exact.push(t); return " " + ph + " "; });
  text = text.replace(/(^|\s)-([a-z0-9][\w-]*)/gi, (m, sp, w) => { ops.exclude.push(w.toLowerCase()); return " "; });
  const any = ops.exact.length || ops.exclude.length || ops.cats.length || ops.level || ops.is.length;
  return { text: text.replace(/\s+/g, " ").trim(), ops, any: !!any };
}
function passesSearchOps(rec, ops) {
  if (ops.cats.length && !ops.cats.some((c) => (rec.category || "").toLowerCase().includes(c))) return false;
  if (ops.level && String(rec.frameworkLevel || rec.rewrittenLevel || "") !== ops.level) return false;
  if (ops.is.length && !ops.is.every((k) => SEARCH_IS[k](rec))) return false;
  if (ops.exact.length || ops.exclude.length) {
    const lc = SearchIndex.doc(rec).lc;
    const all = Object.keys(lc).map((k) => lc[k]).join(" \n ");
    if (!ops.exact.every((ph) => all.includes(ph))) return false;
    const head = [lc.title, lc.description, lc.tags, lc.category].join(" ");
    if (ops.exclude.some((w) => wordHit(head, w))) return false;
  }
  return true;
}
/* What the last search understood — read by the results UI for the
   "Showing results for…" correction line, the task-hub shortcut, term
   highlighting and the result stats line. */
let SEARCH_META = { query: "", corrected: null, hub: null, words: [], ops: null, ms: 0 };
function searchPrompts(all, query, usage, opts) {
  opts = opts || {};
  const t0 = (typeof performance !== "undefined" ? performance : Date).now();
  const parsed = parseSearchQuery(query);
  SearchIndex.sync(all);
  // operators only ("is:saved", "cat:hr"): the matching prompts, best first
  if (!parsed.text) {
    if (!parsed.any) return [];
    const out = all.filter((r) => passesSearchOps(r, parsed.ops))
      .sort((a, b) => (b.qualityScore || 0) + usageBoost(b, usage) - (a.qualityScore || 0) - usageBoost(a, usage));
    if (!opts.quiet) SEARCH_META = { query, corrected: null, hub: null, words: [], ops: parsed.ops, ms: (typeof performance !== "undefined" ? performance : Date).now() - t0 };
    return out;
  }
  const expanded = expandQueryTerms(parsed.text, all, opts.literal);
  if (!expanded.phrase) return [];
  const hub = detectTaskHub(expanded.full);
  const routed = routedCategories(expanded.full);
  // Candidates come from the index: only prompts that share a word (by
  // prefix, like wordHit) or a synonym with the query, plus the task hub's
  // curated prompts. Everything else can't score, so it is never visited.
  const cand = new Set();
  expanded.words.forEach((w) => SearchIndex.idsWithPrefix(w, cand));
  expanded.synonymTerms.forEach((syn) => syn.split(" ").forEach((w) => { if (w.length >= 3) SearchIndex.idsWithPrefix(w, cand); }));
  const results = [];
  for (let i = 0; i < all.length; i++) {
    const rec = all[i];
    const isHub = hub && rec.hub === hub.id;
    if (!cand.has(rec.id) && !isHub) continue;
    if (opts.category && rec.category !== opts.category) continue;
    if (parsed.any && !passesSearchOps(rec, parsed.ops)) continue;
    let { score, tier } = scoreRecord(rec, expanded);
    // semantic routing: on-topic shelf gets a lift; a record that only
    // matches one common word but IS on the routed shelf still surfaces.
    if (routed.size && routed.has(rec.category)) {
      if (tier === 0 && expanded.words.some((w) => wordHit((rec.title + " " + rec.description).toLowerCase(), w))) tier = 1;
      if (tier > 0) score += 14 + (tier === 2 ? 8 : 0);
    }
    // Task-hub intent: the curated everyday prompt for this job leads. A
    // hub prompt that shares no word with the query still surfaces (the
    // query "how do I prepare slides" should reach "Build a complete
    // presentation"), just lower than one that also matches directly.
    if (isHub) { score += tier === 2 ? 25 : 4; if (tier === 0) tier = 1; }
    if (tier === 0) continue;
    if (rec.source === "Everyday Essentials" && tier === 2) score += 6;
    results.push([score + usageBoost(rec, usage), rec]);
  }
  results.sort((a, b) => b[0] - a[0]);
  // Relevance cutoff: drop the long tail of records that only brush the
  // query through one common word, so the result count means something.
  if (results.length > 40) {
    const topScore = results[0][0];
    const floor = Math.max(topScore * 0.13, 6);
    let cut = results.length;
    for (let i = 40; i < results.length; i++) { if (results[i][0] < floor) { cut = i; break; } }
    results.length = cut;
  }
  if (!opts.quiet) {
    SEARCH_META = { query, corrected: expanded.corrected, hub, words: expanded.words.concat(parsed.ops.exact),
      ops: parsed.any ? parsed.ops : null, ms: (typeof performance !== "undefined" ? performance : Date).now() - t0 };
  }
  return results.map((x) => x[1]);
}

/* ---------- Client-side quality scoring + rule-based improvement ---------- */
const PLACEHOLDER_PATTERNS = [
  /\[[A-Za-z][A-Za-z0-9 _/'\-]{1,40}\]/g,
  /\{\{[A-Za-z][A-Za-z0-9 _\-]{1,40}\}\}/g,
  /<[A-Z][A-Z0-9 _\-]{1,30}>/g,
];
const OUTPUT_CUES = /\b(list|bullet points?|table|format|template|structure|steps?|headings?|sections?|outline|word count|words?|paragraphs?|numbered|checklist|framework|report)\b/i;
const CONTEXT_CUES = /\b(context|given that|for my|for our|based on|considering|background|situation|scenario|currently|target audience|our company|my company)\b/i;

function extractPlaceholders(text) {
  const found = [], seen = new Set();
  for (const pat of PLACEHOLDER_PATTERNS) {
    for (const m of (text.match(pat) || [])) {
      const key = m.replace(/[\[\]{}<>]/g, "").trim().toLowerCase();
      if (!seen.has(key)) { seen.add(key); found.push(m); }
    }
  }
  return found;
}
function normalizeVarName(raw) { return raw.replace(/[\[\]{}<>]/g, "").trim().replace(/\s+/g, "_").toUpperCase(); }

function scorePromptText(title, prompt) {
  const variables = extractPlaceholders(prompt);
  const nVars = variables.length;
  const length = prompt.length;
  const wordCount = prompt.split(/\s+/).filter(Boolean).length;
  const hasOutput = OUTPUT_CUES.test(prompt);
  const hasContext = CONTEXT_CUES.test(prompt) || nVars >= 2;

  let clarity = length < 40 ? 45 : length > 900 ? 55 : 78;
  if (/[.?!]\s*$/.test(prompt.trim())) clarity += 6;
  if ((prompt.match(/\?/g) || []).length > 3) clarity -= 8;
  clarity = Math.max(10, Math.min(100, clarity));

  let context = 40;
  if (hasContext) context += 30;
  if (nVars >= 1) context += 15;
  if (/\bfor (my|our)\b/i.test(prompt)) context += 10;
  context = Math.max(10, Math.min(100, context));

  let specificity = 35 + Math.min(nVars, 5) * 9;
  if (/\d/.test(prompt)) specificity += 8;
  if (wordCount > 25) specificity += 10;
  specificity = Math.max(10, Math.min(100, specificity));

  let outputDefinition = 35;
  if (hasOutput) outputDefinition += 40;
  if (/\bformat\b/i.test(prompt)) outputDefinition += 10;
  outputDefinition = Math.max(10, Math.min(100, outputDefinition));

  let reusability = 30 + Math.min(nVars, 5) * 11;
  if (nVars === 0 && length < 120) reusability -= 10;
  reusability = Math.max(10, Math.min(100, reusability));

  const total = Math.round(clarity * 0.2 + context * 0.2 + specificity * 0.25 + outputDefinition * 0.2 + reusability * 0.15);
  return { score: Math.max(5, Math.min(100, total)), breakdown: { clarity, context, specificity, outputDefinition, reusability }, variables, hasOutput, hasContext };
}
function healthFromScore(score, flagged) {
  if (score >= 85 && !flagged) return "Excellent";
  if (score >= 65) return "Good";
  if (score >= 45) return "Needs Improvement";
  return "Review";
}
function quickImprove(rec) {
  const prompt = rec.originalPrompt;
  const problems = [];
  const { breakdown, hasOutput, hasContext } = scorePromptText(rec.title, prompt);
  if (breakdown.context < 55) problems.push("Doesn't spell out the context the AI needs (audience, situation, goal).");
  if (breakdown.outputDefinition < 55) problems.push("Doesn't say what the output should look like (format, length, structure).");
  if (breakdown.specificity < 55) problems.push("Reads as fairly generic — light on concrete specifics.");
  if (rec.flags && rec.flags.modelSpecific) problems.push("Names a specific AI tool by brand, so it reads oddly in any other tool.");
  if (rec.flags && rec.flags.incompleteTitle) problems.push("Source title looks like a cut-off fragment.");
  if (!problems.length) problems.push("Already fairly clear — the rewrite below just tightens structure.");

  const role = rec.role || "professional";
  const objective = rec.title.replace(/^[A-Z]/, (c) => c.toLowerCase());
  const vars = (rec.variables || []).length ? rec.variables : (rec.variablesRaw || []).map(normalizeVarName);

  const lines = [];
  lines.push(`Role: Act as an experienced ${role.split(" / ")[0]}.`);
  lines.push(`Objective: ${objective.charAt(0).toUpperCase()}${objective.slice(1)}.`);
  if (hasContext) lines.push(`Context: ${prompt.replace(/\s+/g, " ").slice(0, 220)}${prompt.length > 220 ? "…" : ""}`);
  else lines.push(`Context: [Add 1-2 sentences here about your specific situation, audience, and goal.]`);
  if (vars.length) lines.push(`Inputs: ${vars.map((v) => `[${v}]`).join(", ")}`);
  lines.push(`Constraints: Keep it practical and directly usable — no filler, no generic advice.`);
  if (!hasOutput) lines.push(`Output format: Respond in a clear, well-structured format (headings or short sections, not one dense paragraph).`);
  lines.push(`Quality bar: The result should be something a ${role.split(" / ")[0].toLowerCase()} could use with little to no editing.`);

  const improved = lines.join("\n");
  const why = [];
  why.push("Adds an explicit role so the AI answers from the right point of view.");
  if (!hasContext) why.push("Prompts you to fill in real context instead of leaving it implicit.");
  if (!hasOutput) why.push("Specifies an output shape, which the original left open.");
  why.push("Keeps your original intent — nothing about what you're asking for has changed, just how clearly it's asked.");
  return { problems, improvedPrompt: improved, whyBetter: why, method: "auto-structured" };
}

/* ---------- Derived metadata (computed once at load, never persisted) ----------
   The Excel gives us #, Title, Category, Prompt. The imported JSON already
   derived description/useCase/role/outcome/type/tags/quality. Here we add
   the last few fields the product needs — difficulty, skill, lifecycle —
   plus the "when to use" / "why it works" explanations, all deterministic. */
const CATEGORY_SKILL = {
  "AI & Prompt Engineering": "Prompt Engineering",
  "Marketing & Branding": "Marketing Strategy",
  "HR & Recruiting": "People & Hiring",
  "Social Media": "Social Media",
  "Customer Support": "Customer Communication",
  "Sales & Lead Generation": "Sales",
  "Content Writing & Copywriting": "Copywriting",
  "Business Strategy": "Strategic Thinking",
  "Coding & Tech": "Technical",
  "Education & Learning": "Instructional Design",
  "Finance & Accounting": "Financial Analysis",
  "Product Management": "Product Management",
  "Research & Data Analysis": "Research & Analysis",
  "Email Marketing": "Lifecycle Marketing",
  "SEO & Analytics": "SEO & Analytics",
  "Career Growth": "Career Development",
  "Coaching & Self-Development": "Coaching",
  "Communication & Leadership": "Leadership Communication",
  "Legal & Compliance": "Legal & Compliance",
  "Health & Fitness": "Health & Wellbeing",
  "E-Commerce": "E-Commerce",
  "Presentation & Slides": "Presentation Design",
  "Book & Ebook Writing": "Long-form Writing",
  "Productivity & Automation": "Productivity",
  "UX/UI Design": "UX/UI Design",
  "Image & Design": "Visual Design",
  "Spirituality & Wellness": "Wellbeing",
  "General": "General",
};
function deriveDifficulty(rec) {
  const nVars = (rec.variables || []).length;
  const adv = ["Strategy", "Analysis", "Decision"];
  if (nVars >= 3) return "Advanced";
  if (rec.qualityScore >= 78 && nVars >= 1) return "Advanced";
  if (adv.includes(rec.promptType) && nVars >= 2) return "Advanced";
  if (rec.promptType === "Quick Prompt") return "Beginner";
  if (rec.qualityScore < 58 && nVars <= 1) return "Beginner";
  if ((rec.originalPrompt || "").length < 140 && nVars === 0) return "Beginner";
  return "Intermediate";
}
function deriveLifecycle(rec) {
  if (rec.source && rec.source !== "Original Library") {
    return rec.source === "User Created" ? "Draft" : "Curated";
  }
  const outdated = rec.flags && (rec.flags.modelSpecific || (rec.healthReasons || []).some((r) => /outdated/i.test(r)));
  if (outdated && rec.qualityScore < 50) return "Archived";
  if (rec.qualityScore < 52 || rec.healthStatus === "Review") return "Review";
  if (rec.qualityScore >= 74) return "Recommended";
  return "Curated";
}
function deriveWhenToUse(rec) {
  const bits = [];
  const goal = rec.title.replace(/\.$/, "").toLowerCase();
  bits.push(`Reach for this when your task is “${goal}”`);
  if (rec.outcome && rec.outcome !== "Not specified") bits.push(`and you want ${rec.outcome[0].toLowerCase() + rec.outcome.slice(1)}`);
  let s = bits.join(" ") + ".";
  if (rec.isTemplate) s += ` It has ${rec.variables.length} variable${rec.variables.length === 1 ? "" : "s"} to fill in, so it's built to be reused across situations.`;
  else s += ` It's a one-off prompt — copy it, then add your own specifics.`;
  if (rec.sensitiveCategory) s += ` Because this is a ${rec.category} topic, treat the output as a draft for a qualified person to check.`;
  return s;
}
function deriveWhyItWorks(rec) {
  const b = rec.qualityBreakdown || {};
  const pts = [];
  if (b.clarity >= 70) pts.push("It states the task in plain, direct language, so the model isn't guessing what you want.");
  if (b.outputDefinition >= 70) pts.push("It tells the model what shape the answer should take (format, structure, length) instead of leaving that open.");
  else pts.push("It leaves the output format open — adding one line about the format you want is the fastest way to improve it.");
  if (rec.isTemplate) pts.push(`It uses ${rec.variables.length} placeholder${rec.variables.length === 1 ? "" : "s"} (${rec.variables.slice(0, 3).map((v) => "[" + v + "]").join(", ")}${rec.variables.length > 3 ? "…" : ""}), which turn a single answer into a repeatable pattern.`);
  if (b.context >= 65) pts.push("It gives the model enough situational context to tailor the answer rather than producing something generic.");
  else pts.push("It's light on context — the model will fill gaps with assumptions unless you add a sentence about your audience and situation.");
  if (b.specificity >= 70) pts.push("It's concrete about what's being asked, which keeps the response focused.");
  if (rec.role && rec.role !== "Not specified") pts.push(`It's written for a ${rec.role.split(" / ")[0]}, so the framing already matches how that role thinks about the problem.`);
  return pts.slice(0, 5);
}
/* The imported library's generated titles sometimes stack two verbs
   ("Create developing Onboarding Training", "Write writing Email
   Newsletters"). Tidy the display title only — `originalTitle` and
   `originalPrompt` are never touched. */
// Only the specific "verb + gerund-of-a-verb" stack from the import is
// stripped (e.g. "Create developing X"); a gerund that's really an
// adjective or noun ("Create Engaging Content", "Create Marketing Ebook")
// is left alone because its second word isn't in this verb list.
const _DBL_VERB = /^(Create|Write|Provide|Generate|Design|Build|Plan|Develop|Craft|Draft|Make|Prepare|Assist|Help|Offer|Give|Produce)\s+(creating|writing|providing|generating|designing|building|planning|developing|crafting|drafting|making|preparing|assisting|helping|offering|giving|producing)\s+/i;
function cleanTitle(t) {
  if (!t) return t;
  let s = t.replace(_DBL_VERB, (m, v1) => v1 + " ");
  s = s.replace(/\s{2,}/g, " ").trim();
  // import left a lowercased word right after the leading verb ("Write email
  // Newsletter") — recapitalize just that one.
  s = s.replace(/^([A-Za-z]+)\s+([a-z])/, (m, a, b) => a + " " + b.toUpperCase());
  return s.charAt(0).toUpperCase() + s.slice(1);
}
function enrichRecord(rec) {
  if (!rec.originalTitle) rec.originalTitle = rec.title;
  // Only the imported library needs its generated titles tidied; authored
  // collections (Synottic Programs, Everyday Essentials) and user prompts
  // are already written in sentence case and must be shown as written.
  // Library prompts rewritten into the framework (rewrittenLevel) have
  // hand-written titles too.
  if ((!rec.source || rec.source === "Original Library") && !rec.rewrittenLevel) rec.title = cleanTitle(rec.title);
  rec.skill = rec.skill || CATEGORY_SKILL[rec.category] || "General";
  rec.difficulty = rec.difficulty || deriveDifficulty(rec);
  rec.lifecycle = rec.lifecycle || deriveLifecycle(rec);
  rec.whenToUse = rec.whenToUse || deriveWhenToUse(rec);
  rec.whyItWorks = rec.whyItWorks || deriveWhyItWorks(rec);
  // Prompt-framework fit — derived, never persisted (see part_framework.js).
  if (typeof deriveFrameworkLevel === "function" && rec.frameworkLevel === undefined) deriveFrameworkLevel(rec);
  return rec;
}
