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
      if (db) db.collection(nsKey("myPrompts")).doc(o.id).set(o).catch(() => {});
      pMy();
      if (typeof Backend !== "undefined") Backend.logActivity("created", o.id, { title: o.title });
      return o.id;
    },
    updateMyPrompt(id, patch) {
      const i = myPrompts.findIndex((p) => p.id === id);
      if (i === -1) return;
      myPrompts[i] = Object.assign({}, myPrompts[i], patch);
      if (db) db.collection(nsKey("myPrompts")).doc(id).set(myPrompts[i]).catch(() => {});
      pMy();
    },
    deleteMyPrompt(id) { myPrompts = myPrompts.filter((p) => p.id !== id); if (db) db.collection(nsKey("myPrompts")).doc(id).delete().catch(() => {}); pMy(); },

    getImprovement: (id) => improvements[id],
    saveImprovement(id, data) {
      improvements[id] = data;
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
};
const FIELD_WEIGHTS = { title: 10, originalTitle: 6, useCase: 6, outcome: 4, description: 4, category: 5, role: 4, skill: 5, tags: 6, promptType: 2, aiTool: 1, originalPrompt: 2 };
const QUERY_STOPWORDS = new Set(["a", "an", "the", "for", "to", "of", "in", "on", "with", "my", "me", "and", "or", "i", "need", "want", "how", "do", "some", "please", "am", "is", "are"]);

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
};
function routedCategories(normQuery) {
  const set = new Set();
  for (const key in INTENT_CATEGORY) {
    if (normQuery.indexOf(key.trim()) !== -1) INTENT_CATEGORY[key].forEach((c) => set.add(c));
  }
  return set;
}

function normalizeQuery(q) { return (q || "").toLowerCase().trim().replace(/\s+/g, " "); }
function tokenize(q) { return q.split(" ").filter((w) => w.length >= 2 && !QUERY_STOPWORDS.has(w)); }
function expandQueryTerms(q) {
  const norm = normalizeQuery(q);
  const words = tokenize(norm);
  const synonymTerms = new Set();
  for (const key in INTENT_SYNONYMS) {
    if (norm === key || norm.includes(key)) INTENT_SYNONYMS[key].forEach((s) => synonymTerms.add(s));
  }
  words.forEach((w) => { if (INTENT_SYNONYMS[w]) INTENT_SYNONYMS[w].forEach((s) => synonymTerms.add(s)); });
  return { phrase: norm, words, synonymTerms: Array.from(synonymTerms) };
}
const __dfCacheMap = (typeof WeakMap !== "undefined") ? new WeakMap() : null;
function buildDfIndex(all) {
  const df = Object.create(null);
  for (const rec of all) {
    const seen = new Set();
    for (const field in FIELD_WEIGHTS) {
      const raw = fieldText(rec, field).toLowerCase();
      if (!raw) continue;
      for (const w of raw.split(/[^a-z0-9]+/)) {
        if (w.length >= 2 && !seen.has(w)) { seen.add(w); df[w] = (df[w] || 0) + 1; }
      }
    }
  }
  return df;
}
function idfWeight(word, all) {
  let df;
  if (__dfCacheMap) { df = __dfCacheMap.get(all); if (!df) { df = buildDfIndex(all); __dfCacheMap.set(all, df); } }
  else df = buildDfIndex(all);
  const n = all.length, dfw = df[word] || 1;
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
function scoreRecord(rec, expanded, all) {
  const { phrase, words, synonymTerms } = expanded;
  if (!phrase) return { score: 0, tier: 0 };
  let wordBest = {}, bestPhraseWeight = 0, synonymScore = 0, bigramScore = 0, clusterScore = 0;
  for (const field in FIELD_WEIGHTS) {
    const raw = fieldText(rec, field);
    if (!raw) continue;
    const text = raw.toLowerCase();
    const weight = FIELD_WEIGHTS[field];
    if (words.length > 1 && text.includes(phrase)) bestPhraseWeight = Math.max(bestPhraseWeight, weight);
    let hitsThisField = 0;
    for (const w of words) {
      if (wordHit(text, w)) {
        hitsThisField++;
        const contribution = weight * idfWeight(w, all);
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
  return b;
}
function searchPrompts(all, query, usage, opts) {
  opts = opts || {};
  const expanded = expandQueryTerms(query);
  if (!expanded.phrase) return [];
  const routed = routedCategories(expanded.phrase);
  const results = [];
  for (let i = 0; i < all.length; i++) {
    const rec = all[i];
    if (opts.category && rec.category !== opts.category) continue;
    let { score, tier } = scoreRecord(rec, expanded, all);
    // semantic routing: on-topic shelf gets a lift; a record that only
    // matches one common word but IS on the routed shelf still surfaces.
    if (routed.size && routed.has(rec.category)) {
      if (tier === 0 && expanded.words.some((w) => wordHit((rec.title + " " + rec.description).toLowerCase(), w))) tier = 1;
      if (tier > 0) score += 14 + (tier === 2 ? 8 : 0);
    }
    if (tier === 0) continue;
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
  rec.title = cleanTitle(rec.title);
  rec.skill = rec.skill || CATEGORY_SKILL[rec.category] || "General";
  rec.difficulty = rec.difficulty || deriveDifficulty(rec);
  rec.lifecycle = rec.lifecycle || deriveLifecycle(rec);
  rec.whenToUse = rec.whenToUse || deriveWhenToUse(rec);
  rec.whyItWorks = rec.whyItWorks || deriveWhyItWorks(rec);
  // Prompt-framework fit — derived, never persisted (see part_framework.js).
  if (typeof deriveFrameworkLevel === "function" && rec.frameworkLevel === undefined) deriveFrameworkLevel(rec);
  return rec;
}
