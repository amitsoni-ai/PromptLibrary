/* ============================================================================
   Identity & access layer — learner accounts (signup / verify / login / reset)
   + the personalized-access model. Talks to /api/auth/* and /api/admin/session.
   Fails soft: when /api is absent this whole module no-ops and the classic
   access-code gate (part_app_3) is used unchanged.
   ========================================================================== */
const AuthAPI = (function () {
  const BASE = (typeof location !== "undefined" && /^https?:$/.test(location.protocol)) ? "/api" : null;
  let csrf = null;

  async function ensureCsrf() {
    if (csrf) return csrf;
    try {
      const r = await fetch(BASE + "/auth/csrf", { credentials: "same-origin" });
      const d = await r.json();
      csrf = d.csrfToken || null;
    } catch (e) { csrf = null; }
    return csrf;
  }

  async function call(path, { method = "GET", body, retried } = {}) {
    if (!BASE) { const e = new Error("no-backend"); e.soft = true; throw e; }
    const headers = { "content-type": "application/json" };
    if (method !== "GET") headers["x-csrf-token"] = await ensureCsrf();
    let res;
    try {
      res = await fetch(BASE + path, {
        method, headers, credentials: "same-origin",
        body: body ? JSON.stringify(body) : undefined,
      });
    } catch (netErr) { const e = new Error("network"); e.soft = true; throw e; }
    let data = null;
    try { data = await res.json(); } catch (e) {}
    if (!data) { const e = new Error("no-backend"); e.soft = true; throw e; }
    // Stale CSRF token (cookie expired or cleared in another tab): get a fresh
    // one and try once more, so the learner never has to press the button twice.
    if (res.status === 403 && data.error === "bad-csrf" && !retried) {
      csrf = null;
      return call(path, { method, body, retried: true });
    }
    if (!res.ok) { const e = new Error(data.error || "http-" + res.status); e.status = res.status; e.data = data; throw e; }
    return data;
  }

  return {
    isConfigured: () => !!BASE,
    ensureCsrf,
    me: () => call("/auth/me"),
    signup: (b) => call("/auth/signup", { method: "POST", body: b }),
    verifyEmail: (token) => call("/auth/verify-email", { method: "POST", body: { token } }),
    resendVerification: (email) => call("/auth/resend-verification", { method: "POST", body: { email } }),
    login: (b) => call("/auth/login", { method: "POST", body: b }),
    logout: () => call("/auth/logout", { method: "POST" }).catch(() => {}),
    forgotPassword: (email) => call("/auth/forgot-password", { method: "POST", body: { email } }),
    resetPassword: (b) => call("/auth/reset-password", { method: "POST", body: b }),
    redeemCode: (code) => call("/auth/redeem-code", { method: "POST", body: { code } }),
    myCodes: () => call("/auth/my-codes"),
    removeCode: (code) => call("/auth/remove-code", { method: "POST", body: { code } }),
    updateProfile: (b) => call("/auth/me", { method: "PATCH", body: b }),
    // Google / Microsoft sign-in: which providers this deployment has keys for
    providers: () => call("/auth/oauth-start").then((d) => d.providers || []).catch(() => []),
    adminLogin: (b) => call("/admin/session", { method: "POST", body: b }),
    adminLogout: () => call("/admin/session", { method: "DELETE" }).catch(() => {}),
    adminMe: () => call("/admin/session"),
    // dev only — returns null in production / when EMAIL_TRANSPORT != console
    devOutbox: (email) => call("/dev/outbox?to=" + encodeURIComponent(email || "")).catch(() => null),
  };
})();

/* Sign-up options. Function keys mirror api/_functions.js — this ONE field
   (replacing the old "role" + "job function") decides the learner's library. */
const SIGNUP_FUNCTIONS = [
  ["sales", "Sales"],
  ["marketing", "Marketing"],
  ["hr", "Human Resources (HR)"],
  ["learning_dev", "Learning & Development (L&D)"],
  ["finance", "Finance & Accounting"],
  ["legal", "Legal & Compliance"],
  ["it_engineering", "IT & Engineering"],
  ["product", "Product Management"],
  ["project_program", "Project & Program Management"],
  ["customer_service", "Customer Service"],
  ["data_analysis", "Data & Business Analysis"],
  ["operations", "Operations & Supply Chain"],
  ["procurement", "Procurement"],
  ["general", "General / Cross-functional"],
];
const SIGNUP_LEVELS = [["beginner", "Beginner"], ["foundational", "Foundational"],
  ["intermediate", "Intermediate"], ["advanced", "Advanced"], ["expert", "Expert"]];

/* ---- shared auth UI (split-screen brand panel + password field) ---- */
const EYE_SVG = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M2 12s3.5-7 10-7 10 7 10 7-3.5 7-10 7-10-7-10-7Z"/><circle cx="12" cy="12" r="3"/></svg>';
const EYE_OFF_SVG = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M9.9 4.24A9.1 9.1 0 0 1 12 4c6.5 0 10 8 10 8a17.6 17.6 0 0 1-2.16 3.19M6.6 6.6A17.8 17.8 0 0 0 2 12s3.5 8 10 8a9 9 0 0 0 5.4-1.6"/><path d="M3 3l18 18"/><path d="M9.9 9.9a3 3 0 0 0 4.2 4.2"/></svg>';

// Password input with a built-in show/hide toggle (accessible).
function pwField(id, autocomplete, placeholder, style) {
  return `<div class="pw-wrap">
    <input id="${id}" class="name-input" type="password" autocomplete="${autocomplete}"${style ? ` style="${style}"` : ""} placeholder="${placeholder || ""}" />
    <button type="button" class="pw-toggle" data-pw="${id}" aria-label="Show password" aria-pressed="false">${EYE_SVG}</button>
  </div>`;
}
function wirePwToggles(root) {
  root.querySelectorAll(".pw-toggle").forEach((b) => b.addEventListener("click", () => {
    const inp = root.querySelector("#" + b.dataset.pw);
    if (!inp) return;
    const reveal = inp.type === "password";
    inp.type = reveal ? "text" : "password";
    b.innerHTML = reveal ? EYE_OFF_SVG : EYE_SVG;
    b.classList.toggle("is-on", reveal);
    b.setAttribute("aria-pressed", reveal ? "true" : "false");
    b.setAttribute("aria-label", reveal ? "Hide password" : "Show password");
  }));
}

/* ---- "Continue with Google / Microsoft" ----
   Only providers the server has keys for are shown (GET /api/auth/oauth-start).
   Each button is a plain link: the server does the redirect dance and lands
   back on `/` signed in (or `/login?oauth_error=…`). */
const SOCIAL_ICONS = {
  google: '<svg viewBox="0 0 48 48" aria-hidden="true"><path fill="#FFC107" d="M43.6 20.5H42V20H24v8h11.3C33.7 32.7 29.2 36 24 36c-6.6 0-12-5.4-12-12s5.4-12 12-12c3.1 0 5.8 1.2 7.9 3.1l5.7-5.7C34 6.1 29.3 4 24 4 12.9 4 4 12.9 4 24s8.9 20 20 20 20-8.9 20-20c0-1.3-.1-2.4-.4-3.5z"/><path fill="#FF3D00" d="m6.3 14.7 6.6 4.8C14.7 15.1 19 12 24 12c3.1 0 5.8 1.2 7.9 3.1l5.7-5.7C34 6.1 29.3 4 24 4 16.3 4 9.7 8.3 6.3 14.7z"/><path fill="#4CAF50" d="M24 44c5.2 0 9.9-2 13.4-5.2l-6.2-5.2C29.2 35.1 26.7 36 24 36c-5.2 0-9.6-3.3-11.3-8l-6.5 5C9.5 39.6 16.2 44 24 44z"/><path fill="#1976D2" d="M43.6 20.5H42V20H24v8h11.3c-.8 2.2-2.2 4.2-4.1 5.6l6.2 5.2C37 39.2 44 34 44 24c0-1.3-.1-2.4-.4-3.5z"/></svg>',
  microsoft: '<svg viewBox="0 0 23 23" aria-hidden="true"><path fill="#F25022" d="M1 1h10v10H1z"/><path fill="#7FBA00" d="M12 1h10v10H12z"/><path fill="#00A4EF" d="M1 12h10v10H1z"/><path fill="#FFB900" d="M12 12h10v10H12z"/></svg>',
};
const SOCIAL_LABELS = { google: "Google", microsoft: "Microsoft" };
let SOCIAL_PROVIDERS = null;   // promise, fetched once per page load
function socialSlot() { return '<div class="auth-social" data-social hidden></div>'; }
function wireSocial(root) {
  const slot = root.querySelector("[data-social]");
  if (!slot || !AuthAPI.isConfigured()) return;
  if (!SOCIAL_PROVIDERS) SOCIAL_PROVIDERS = AuthAPI.providers();
  SOCIAL_PROVIDERS.then((list) => {
    list = (list || []).filter((k) => SOCIAL_ICONS[k]);
    if (!list.length || !slot.isConnected) return;
    slot.innerHTML = list.map((k) =>
      `<a class="btn auth-social-btn" href="/api/auth/oauth-start?provider=${k}" data-provider="${k}">${SOCIAL_ICONS[k]}<span>Continue with ${SOCIAL_LABELS[k]}</span></a>`).join("")
      + '<p class="auth-legal">By continuing with ' + list.map((k) => SOCIAL_LABELS[k]).join(" or ") + ', you agree to our <a href="/terms" target="_blank" rel="noopener">Terms of Service</a> and <a href="/privacy" target="_blank" rel="noopener">Privacy Policy</a>.</p>'
      + '<div class="auth-divider"><span>or use your email</span></div>';
    slot.hidden = false;
    slot.querySelectorAll(".auth-social-btn").forEach((a) => a.addEventListener("click", () => {
      a.classList.add("is-busy");
      a.querySelector("span").textContent = "Opening " + SOCIAL_LABELS[a.dataset.provider] + "…";
    }));
  });
}
const OAUTH_ERRORS = {
  cancelled: "Sign-in was cancelled. Try again, or use your email below.",
  expired: "That sign-in took too long or was opened in another tab. Please try again.",
  "email-in-use": "An account with this email already exists. Sign in with your email and password below.",
  "no-email": "We couldn't get an email address from that account. Please use your email below.",
  "account-disabled": "This account has been disabled. Contact your programme lead.",
  "rate-limited": "Too many attempts. Wait a few minutes and try again.",
  unavailable: "That sign-in option isn't set up yet. Please use your email below.",
  failed: "Something went wrong signing you in. Please try again.",
};

// Right-hand brand panel shown beside every auth screen. Desktop/tablet show
// the full-bleed Synottic artwork (which carries the message); on mobile the
// artwork is replaced by a compact text banner below the form. The text sits
// under the artwork on desktop too, so the panel is never an empty block while
// the image loads or if it fails.
function authBrandAside() {
  return `<aside class="auth-brand">
    <picture>
      <source srcset="/auth-art.webp" type="image/webp" />
      <img class="auth-brand-img" src="/auth-art.jpg" alt="Better prompts. Bigger impact. From ideas to real outcomes, with the power of AI." fetchpriority="high" decoding="async" />
    </picture>
    <div class="auth-brand-msg">
      <p class="auth-eyebrow">Synottic Prompt Intelligence</p>
      <h2 class="auth-brand-headline">Don&rsquo;t just use AI.<br>Think with it.</h2>
      <p class="auth-brand-sub">Find the right prompt, build better workflows, practice new AI skills, and apply them to real work.</p>
    </div>
  </aside>`;
}

/* ---- access helpers used across the app ---- */
let CURRENT_ACCESS = null;
function userAccess() { return CURRENT_ACCESS; }
function isUserSession() { const s = Store.getSession && Store.getSession(); return !!(s && s.user); }
function featureAllowed(key) {
  if (!isUserSession()) return true;                 // code-gated sessions keep legacy behaviour
  const a = CURRENT_ACCESS;
  if (!a || !a.features) return true;
  return a.features[key] !== false;
}
function featureReason(key) {
  const a = CURRENT_ACCESS;
  return (a && a.reasons && a.reasons[key]) || null;
}
function lockMessage(key) {
  const r = featureReason(key);
  if (r === "verify_email") return "Verify your email to unlock this feature.";
  if (r === "no_access") return "This is part of your program library — add your access code to unlock it.";
  if (r === "ai_level") return "This unlocks at the Intermediate AI level. Update your level in your profile.";
  if (r && r.indexOf("account_") === 0) return "Your account is on hold. Contact your programme lead.";
  return "This feature isn't available on your account yet.";
}
// Guarded gate for click handlers. Returns true if blocked (and shows a toast).
function blockIfLocked(key) {
  if (featureAllowed(key)) return false;
  if (typeof showToast === "function") showToast(lockMessage(key));
  return true;
}

/* ---- map /api/auth/me -> Store session, then boot ---- */
function applyUserSession(payload) {
  const u = payload.user || {};
  const a = payload.access || {};
  CURRENT_ACCESS = a;
  const full = a.access && (a.access.scopeType === "full");
  const session = {
    backend: true, user: true,
    subject: "user:" + u.id,
    userId: u.id, email: u.email,
    name: [u.firstName, u.lastName].filter(Boolean).join(" ") || "Learner",
    role: u.role, aiLevel: u.aiLevel, orgName: u.organization || a.org || "",
    kind: "user",
    fullLibrary: !!full,
    programIds: Array.isArray(a.programs) ? a.programs : [],
    emailVerified: !!u.emailVerified,
    accountStatus: u.accountStatus,
    access: a,
    startedAt: Date.now(),
  };
  Store.setSession(session);
  return session;
}

async function refreshAccess() {
  try {
    const d = await AuthAPI.me();
    if (d && d.authenticated) { CURRENT_ACCESS = d.access; return d; }
  } catch (e) {}
  return null;
}

/* ---- access-code redemption for a signed-in learner ---- */
function pendingAccessCode() {
  try { return sessionStorage.getItem("prompt-lib:pending-code") || null; } catch (e) { return null; }
}
function clearPendingAccessCode() {
  try { sessionStorage.removeItem("prompt-lib:pending-code"); } catch (e) {}
  try { sessionStorage.removeItem("prompt-lib:pending-code-org"); } catch (e) {}
}
// Apply an access code to the current signed-in learner. Returns { ok, access }
// or { ok:false, error }. Used by the in-app "Add an access code" banner form
// and by the auto-redeem of a code stashed on the classic gate.
async function applyAccessCode(code) {
  code = String(code || "").toUpperCase().trim().replace(/\s+/g, "");
  if (!code) return { ok: false, error: "missing-code" };
  try {
    const d = await AuthAPI.redeemCode(code);
    if (d && d.access) {
      CURRENT_ACCESS = d.access;
      const cur = Store.getSession && Store.getSession();
      if (cur && cur.user) {
        cur.access = d.access;
        cur.fullLibrary = !!(d.access.access && d.access.access.scopeType === "full");
        cur.programIds = Array.isArray(d.access.programs) ? d.access.programs : cur.programIds;
        Store.setSession(cur);
      }
    }
    return { ok: true, access: d && d.access };
  } catch (e) {
    return { ok: false, error: (e && e.data && e.data.error) || (e && e.message) || "error", status: e && e.status };
  }
}
function accessCodeErrorText(err) {
  return err === "unknown-code" ? "That access code isn't recognised."
    : err === "code-disabled" ? "That access code has been disabled."
    : err === "code-expired" ? "That access code has expired."
    : err === "code-exhausted" ? "That access code has reached its seat limit."
    : err === "collection-disabled" ? "That library has been deactivated by your organisation."
    : err === "verify-email-first" ? "Confirm your email first, then add the code."
    : err === "missing-code" ? "Enter an access code."
    : "Couldn't apply that access code — try again.";
}
// Auto-redeem a code the learner entered on the classic gate before signing up.
// Called from bootApp once a user session exists.
async function redeemPendingCode() {
  const code = pendingAccessCode();
  if (!code) return;
  const s = Store.getSession && Store.getSession();
  if (!s || !s.user) return;
  if (!s.emailVerified) return;          // keep stashed — the banner nudges + retries post-verify
  const r = await applyAccessCode(code);
  if (r.ok) {
    clearPendingAccessCode();
    if (typeof showToast === "function") showToast("Organisation library unlocked");
  } else if (r.error !== "verify-email-first") {
    clearPendingAccessCode();
    if (typeof showToast === "function") showToast(accessCodeErrorText(r.error));
  }
}

/* ============================ screens ============================ */
function authShell(inner) {
  const root = document.getElementById("gate-root");
  document.getElementById("app").hidden = true;
  const ar = document.getElementById("admin-root"); if (ar) ar.hidden = true;
  root.innerHTML = `<div class="gate auth-layout">
    <div class="auth-pane"><div class="gate-card auth-card">
      <button class="auth-back" type="button" aria-label="Back" data-auth-back>‹</button>
      <div class="auth-brandline">
        <div class="gate-mark" role="img" aria-label="Synottic"></div>
        <span class="auth-product">Synottic Prompt Intelligence</span>
      </div>
      ${inner}
    </div></div>
    ${authBrandAside()}
  </div>`;
  wirePwToggles(root);
  const art = root.querySelector(".auth-brand-img");
  if (art) art.addEventListener("error", () => art.remove());
  // phones: a back arrow to the landing page, like an app's sign-in screen
  const back = root.querySelector("[data-auth-back]");
  if (back) back.addEventListener("click", () => {
    if (typeof renderLanding !== "function") return;
    try { history.pushState(null, "", "/"); } catch (e) {}
    renderLanding();
  });
  return root;
}
function authTabs(activeKey) {
  const tabs = [["signin", "Sign in"], ["signup", "Create account"], ["code", "Access code"]];
  return `<div class="auth-tabs">${tabs.map(([k, l]) =>
    `<button class="auth-tab ${k === activeKey ? "active" : ""}" data-authtab="${k}">${l}</button>`).join("")}</div>`;
}
function fieldErr(el, msg) {
  const box = el.querySelector(".auth-error");
  if (box) box.textContent = msg || "";
}
function authNav(root) {
  root.querySelectorAll("[data-authtab]").forEach((b) => b.addEventListener("click", () => {
    const k = b.dataset.authtab;
    if (k === "signin") renderSignIn();
    else if (k === "signup") renderSignUp();
    else if (k === "code") renderGate(null, { classic: true });   // classic code gate (part_app_3)
  }));
}

function renderAuthGate(prefillMsg) {
  // entry point — default to Sign in
  renderSignIn(prefillMsg);
}

function renderSignIn(msg) {
  const root = authShell(`
    <h1>Welcome back</h1>
    <p class="sub">Continue your AI-powered work and learning.</p>
    ${authTabs("signin")}
    ${socialSlot()}
    <form id="si-form" novalidate>
      <label for="si-email">Email</label>
      <input id="si-email" class="name-input" type="email" autocomplete="username" inputmode="email" placeholder="you@company.com" />
      <label for="si-pass" style="margin-top:12px;">Password</label>
      ${pwField("si-pass", "current-password", "Your password")}
      <div class="auth-row">
        <label class="auth-check"><input type="checkbox" id="si-remember" /> Remember me</label>
        <button type="button" class="auth-link" id="si-forgot">Forgot password?</button>
      </div>
      <div class="auth-error" role="alert" aria-live="polite">${escapeHtml(msg || "")}</div>
      <button class="btn btn-primary" id="si-go" type="submit">Sign in</button>
    </form>
    <div class="gate-hint" style="text-align:center;">
      New to Synottic? <button class="auth-link" data-authtab="signup">Create an account</button>
    </div>`);
  authNav(root);
  wireSocial(root);
  const form = root.querySelector("#si-form");
  root.querySelector("#si-forgot").addEventListener("click", () => renderForgot());
  form.addEventListener("submit", async (e) => {
    e.preventDefault();
    const email = root.querySelector("#si-email").value.trim();
    const password = root.querySelector("#si-pass").value;
    const remember = root.querySelector("#si-remember").checked;
    if (!email || !password) return fieldErr(root, "Enter your email and password.");
    const btn = root.querySelector("#si-go"); btn.disabled = true; btn.textContent = "Signing in…";
    try {
      const d = await AuthAPI.login({ email, password, remember });
      if (d && d.isAdmin) {                       // same form — admin role goes to the console
        try { sessionStorage.setItem("prompt-lib:admin-ok", "1"); } catch (e) {}
        try { sessionStorage.setItem("prompt-lib:admin-role", (d.admin && d.admin.role) || "SUPER_ADMIN"); } catch (e) {}
        history.replaceState(null, "", "/");
        if (typeof AdminStore !== "undefined" && AdminStore.init) { try { await AdminStore.init(); } catch (e) {} }
        openAdmin();
        return;
      }
      const me = await AuthAPI.me();
      applyUserSession(me);
      bootApp();                                  // limited if unverified — the banner nudges
    } catch (err) {
      btn.disabled = false; btn.textContent = "Sign in";
      if (err.status === 429 || err.status === 423) fieldErr(root, (err.data && err.data.message) || "Too many attempts — wait a few minutes or reset your password.");
      else if (err.status === 403 && err.data && err.data.error === "account-disabled") fieldErr(root, "This account has been disabled. Contact your programme lead.");
      else if (err.soft) fieldErr(root, "Couldn't reach the server. Try again.");
      else fieldErr(root, "That email or password isn't right.");
    }
  });
  root.querySelector("#si-email").focus();
}

function renderSignUp() {
  const st = renderSignUp._state || (renderSignUp._state = { step: 1, data: {} });
  const d = st.data;

  // Collection access code entered on the "Access code" tab → short signup:
  // step 1 only. Organisation / function / AI level come from the collection,
  // server-side, and step 2 is skipped entirely.
  const pendCode = (typeof pendingAccessCode === "function") ? pendingAccessCode() : null;
  if (pendCode && !st.forceFull) return renderSignUpCollection(st, pendCode);

  if (st.step === 1) {
    const root = authShell(`
      <h1>Create your account</h1>
      <p class="sub">Step 1 of 2 — the basics. Takes about a minute.</p>
      ${authTabs("signup")}
      ${socialSlot()}
      <form id="su1" novalidate>
        <div class="auth-2col">
          <div><label for="su-first">First name</label><input id="su-first" class="name-input" autocomplete="given-name" value="${escapeHtml(d.firstName || "")}" /></div>
          <div><label for="su-last">Last name</label><input id="su-last" class="name-input" autocomplete="family-name" value="${escapeHtml(d.lastName || "")}" /></div>
        </div>
        <label for="su-email" style="margin-top:12px;">Work email</label>
        <input id="su-email" class="name-input" type="email" autocomplete="email" inputmode="email" value="${escapeHtml(d.email || "")}" placeholder="you@company.com" />
        <label for="su-pass" style="margin-top:12px;">Password</label>
        ${pwField("su-pass", "new-password", "At least 5 characters")}
        <label for="su-pass2" style="margin-top:12px;">Confirm password</label>
        ${pwField("su-pass2", "new-password", "Re-enter your password")}
        <div class="auth-error" role="alert" aria-live="polite"></div>
        <button class="btn btn-primary" id="su1-next" type="submit">Continue</button>
      </form>
      <div class="gate-hint" style="text-align:center;">Already have an account? <button class="auth-link" data-authtab="signin">Sign in</button></div>`);
    authNav(root);
    wireSocial(root);
    root.querySelector("#su1").addEventListener("submit", (e) => {
      e.preventDefault();
      d.firstName = root.querySelector("#su-first").value.trim();
      d.lastName = root.querySelector("#su-last").value.trim();
      d.email = root.querySelector("#su-email").value.trim();
      d.password = root.querySelector("#su-pass").value;
      const pass2 = root.querySelector("#su-pass2").value;
      if (!d.firstName || !d.lastName) return fieldErr(root, "Enter your first and last name.");
      if (!/^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(d.email)) return fieldErr(root, "Enter a valid work email.");
      if (d.password.length < 5) return fieldErr(root, "Password must be at least 5 characters.");
      if (d.password !== pass2) return fieldErr(root, "Passwords don't match.");
      st.step = 2; renderSignUp();
    });
    root.querySelector("#su-first").focus();
    return;
  }

  // step 2 — one mandatory "function" dropdown (drives library access) + AI level
  const root = authShell(`
    <h1>A little about you</h1>
    <p class="sub">Step 2 of 2 — this sets up the right library for you.</p>
    <form id="su2" novalidate>
      <label for="su-fn">Your function / department</label>
      <select id="su-fn" class="auth-select">
        <option value="" ${!d.fn ? "selected" : ""} disabled>Select your function…</option>
        ${SIGNUP_FUNCTIONS.map(([v, l]) => `<option value="${v}" ${d.fn === v ? "selected" : ""}>${l}</option>`).join("")}
      </select>
      <label for="su-level" style="margin-top:12px;">AI proficiency</label>
      <select id="su-level" class="auth-select">${SIGNUP_LEVELS.map(([v, l]) => `<option value="${v}" ${d.aiLevel === v ? "selected" : ""}>${l}</option>`).join("")}</select>
      <label for="su-org" style="margin-top:12px;">Organization / company</label>
      <input id="su-org" class="name-input" autocomplete="organization" value="${escapeHtml(d.organization || "")}" />
      <label class="auth-check" style="margin-top:14px;"><input type="checkbox" id="su-terms" ${d.agreeTerms ? "checked" : ""}/> I agree to the <a href="/terms" target="_blank" rel="noopener">Terms of Service</a> and <a href="/privacy" target="_blank" rel="noopener">Privacy Policy</a></label>
      <div class="auth-error" role="alert" aria-live="polite"></div>
      <div class="auth-2col" style="margin-top:6px;">
        <button class="btn" id="su2-back" type="button">Back</button>
        <button class="btn btn-primary" id="su2-go" type="submit">Create account</button>
      </div>
    </form>`);
  root.querySelector("#su2-back").addEventListener("click", () => { st.step = 1; renderSignUp(); });
  root.querySelector("#su2").addEventListener("submit", async (e) => {
    e.preventDefault();
    d.fn = root.querySelector("#su-fn").value;
    d.aiLevel = root.querySelector("#su-level").value;
    d.organization = root.querySelector("#su-org").value.trim();
    d.agreeTerms = root.querySelector("#su-terms").checked;
    if (!d.fn) return fieldErr(root, "Choose your function so we can open the right library.");
    if (!d.organization) return fieldErr(root, "Tell us your organization.");
    if (!d.agreeTerms) return fieldErr(root, "Please accept the Terms & Privacy Policy to continue.");
    const btn = root.querySelector("#su2-go"); btn.disabled = true; btn.textContent = "Creating…";
    try {
      const resp = await AuthAPI.signup({
        firstName: d.firstName, lastName: d.lastName, email: d.email,
        password: d.password, confirmPassword: d.password,
        function: d.fn, role: d.fn, aiLevel: d.aiLevel, organization: d.organization,
        agreeTerms: true,
      });
      const email = d.email;
      renderSignUp._state = null;
      if (resp && resp.signedIn) {
        // Signed in immediately with limited access; verifying email unlocks the rest.
        const me = await AuthAPI.me().catch(() => null);
        if (me && me.authenticated) { applyUserSession(me); bootApp(); return; }
      }
      renderVerifyPending(email, { afterSignup: true });
    } catch (err) {
      btn.disabled = false; btn.textContent = "Create account";
      if (err.status === 422 && err.data) fieldErr(root, humanizeValidation(err.data));
      else if (err.status === 429) fieldErr(root, "Too many sign-ups from here. Try again later.");
      else if (err.soft) fieldErr(root, "Couldn't reach the server. Check your connection and try again.");
      else fieldErr(root, "Something went wrong on our side creating your account. Please try again in a minute.");
    }
  });
}
// Short signup for a learner who entered a collection access code. One step:
// first/last name, email, password + terms. Organisation, function, role and AI
// level are set server-side from the collection — the learner never sees them.
function renderSignUpCollection(st, code) {
  const d = st.data;
  let org = "";
  try { org = sessionStorage.getItem("prompt-lib:pending-code-org") || ""; } catch (e) {}
  const orgLabel = org ? escapeHtml(org) + "’s" : "your organisation’s";
  const root = authShell(`
    <h1>Create your account</h1>
    <p class="sub">Enter your details and the code <b>${escapeHtml(code)}</b> opens ${orgLabel} library.</p>
    ${authTabs("signup")}
    <form id="suc" novalidate>
      <div class="auth-2col">
        <div><label for="suc-first">First name</label><input id="suc-first" class="name-input" autocomplete="given-name" value="${escapeHtml(d.firstName || "")}" /></div>
        <div><label for="suc-last">Last name</label><input id="suc-last" class="name-input" autocomplete="family-name" value="${escapeHtml(d.lastName || "")}" /></div>
      </div>
      <label for="suc-email" style="margin-top:12px;">Work email</label>
      <input id="suc-email" class="name-input" type="email" autocomplete="email" inputmode="email" value="${escapeHtml(d.email || "")}" placeholder="you@company.com" />
      <label for="suc-pass" style="margin-top:12px;">Password</label>
      ${pwField("suc-pass", "new-password", "At least 5 characters")}
      <label for="suc-pass2" style="margin-top:12px;">Confirm password</label>
      ${pwField("suc-pass2", "new-password", "Re-enter your password")}
      <label class="auth-check" style="margin-top:14px;"><input type="checkbox" id="suc-terms" ${d.agreeTerms ? "checked" : ""}/> I agree to the <a href="/terms" target="_blank" rel="noopener">Terms of Service</a> and <a href="/privacy" target="_blank" rel="noopener">Privacy Policy</a></label>
      <div class="auth-error" role="alert" aria-live="polite"></div>
      <button class="btn btn-primary" id="suc-go" type="submit">Create account</button>
    </form>
    <div class="gate-hint" style="text-align:center;">Already have an account? <button class="auth-link" data-authtab="signin">Sign in</button></div>`);
  authNav(root);
  root.querySelector("#suc").addEventListener("submit", async (e) => {
    e.preventDefault();
    d.firstName = root.querySelector("#suc-first").value.trim();
    d.lastName = root.querySelector("#suc-last").value.trim();
    d.email = root.querySelector("#suc-email").value.trim();
    d.password = root.querySelector("#suc-pass").value;
    const pass2 = root.querySelector("#suc-pass2").value;
    d.agreeTerms = root.querySelector("#suc-terms").checked;
    if (!d.firstName || !d.lastName) return fieldErr(root, "Enter your first and last name.");
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(d.email)) return fieldErr(root, "Enter a valid work email.");
    if (d.password.length < 5) return fieldErr(root, "Password must be at least 5 characters.");
    if (d.password !== pass2) return fieldErr(root, "Passwords don't match.");
    if (!d.agreeTerms) return fieldErr(root, "Please accept the Terms & Privacy Policy to continue.");
    const btn = root.querySelector("#suc-go"); btn.disabled = true; btn.textContent = "Creating…";
    try {
      const resp = await AuthAPI.signup({
        firstName: d.firstName, lastName: d.lastName, email: d.email,
        password: d.password, confirmPassword: d.password,
        code, agreeTerms: true,
      });
      const email = d.email;
      // The server now owns the code — clear the stash so the post-verify
      // "add access code" banner / auto-redeem don't double-handle it.
      clearPendingAccessCode();
      renderSignUp._state = null;
      if (resp && resp.signedIn) {
        const me = await AuthAPI.me().catch(() => null);
        if (me && me.authenticated) { applyUserSession(me); bootApp(); return; }
      }
      renderVerifyPending(email, { afterSignup: true });
    } catch (err) {
      btn.disabled = false; btn.textContent = "Create account";
      if (err.status === 422 && err.data && err.data.error === "invalid-collection-code") {
        // The code lapsed between the gate check and submit — drop it and fall
        // back to the normal two-step signup, keeping what they've typed.
        clearPendingAccessCode();
        st.forceFull = true; st.step = 2;
        renderSignUp();
        fieldErr(document.getElementById("gate-root"), "That access code is no longer valid — continue and tell us a little about you.");
        return;
      }
      if (err.status === 422 && err.data) fieldErr(root, humanizeValidation(err.data));
      else if (err.status === 429) fieldErr(root, "Too many sign-ups from here. Try again later.");
      else if (err.soft) fieldErr(root, "Couldn't reach the server. Check your connection and try again.");
      else fieldErr(root, "Something went wrong on our side creating your account. Please try again in a minute.");
    }
  });
  root.querySelector("#suc-first").focus();
}

// New Google / Microsoft account: one short step for what the password
// sign-up asks in step 2 (function drives the library). Skippable — the
// account already works with the general library.
function renderOAuthProfile(me) {
  const u = (me && me.user) || {};
  const root = authShell(`
    <h1>Welcome${u.firstName ? ", " + escapeHtml(u.firstName) : ""}!</h1>
    <p class="sub">Your account is ready. Tell us a little about you so we open the right library.</p>
    <form id="op" novalidate>
      <label for="op-fn">Your function / department</label>
      <select id="op-fn" class="auth-select">
        <option value="" selected disabled>Select your function…</option>
        ${SIGNUP_FUNCTIONS.map(([v, l]) => `<option value="${v}">${l}</option>`).join("")}
      </select>
      <label for="op-level" style="margin-top:12px;">AI proficiency</label>
      <select id="op-level" class="auth-select">${SIGNUP_LEVELS.map(([v, l]) => `<option value="${v}" ${u.aiLevel === v ? "selected" : ""}>${l}</option>`).join("")}</select>
      <label for="op-org" style="margin-top:12px;">Organization / company</label>
      <input id="op-org" class="name-input" autocomplete="organization" value="${escapeHtml(u.organization || "")}" />
      <p class="auth-note">By continuing you agree to the <a href="/terms" target="_blank" rel="noopener">Terms of Service</a> and <a href="/privacy" target="_blank" rel="noopener">Privacy Policy</a>.</p>
      <div class="auth-error" role="alert" aria-live="polite"></div>
      <button class="btn btn-primary" id="op-go" type="submit">Open my library</button>
    </form>
    <div class="gate-hint" style="text-align:center;"><button class="auth-link" id="op-skip" type="button">Skip for now</button></div>`);
  const back = root.querySelector("[data-auth-back]"); if (back) back.remove();
  root.querySelector("#op-skip").addEventListener("click", () => bootApp());
  root.querySelector("#op").addEventListener("submit", async (e) => {
    e.preventDefault();
    const fn = root.querySelector("#op-fn").value;
    const organization = root.querySelector("#op-org").value.trim();
    if (!fn) return fieldErr(root, "Choose your function so we can open the right library.");
    if (!organization) return fieldErr(root, "Tell us your organization.");
    const btn = root.querySelector("#op-go"); btn.disabled = true; btn.textContent = "Saving…";
    try {
      await AuthAPI.updateProfile({ function: fn, aiLevel: root.querySelector("#op-level").value, organization });
      const fresh = await AuthAPI.me().catch(() => null);
      if (fresh && fresh.authenticated) applyUserSession(fresh);
      bootApp();
    } catch (err) {
      btn.disabled = false; btn.textContent = "Open my library";
      fieldErr(root, err.soft ? "Couldn't reach the server. Try again." : "We couldn't save that. Please try again.");
    }
  });
}

function humanizeValidation(data) {
  const m = {
    "invalid-email": "Enter a valid work email.",
    "password-too-short": "Password must be at least 5 characters.",
    "password-too-long": "That password is too long.",
    "password-mismatch": "Passwords don't match.",
    "must-accept-terms": "Please accept the Terms & Privacy Policy.",
    "missing": "Please fill in every required field.",
    "invalid-function": "Choose your function from the list.",
  };
  if (data.field === "function" || data.field === "role") return "Choose your function from the list.";
  return m[data.error] || "Please check the form and try again.";
}

function renderVerifyPending(email, opts) {
  opts = opts || {};
  const root = authShell(`
    <h1>Confirm your email</h1>
    <p class="sub">We've sent a confirmation link to <b>${escapeHtml(email || "your email")}</b>. Confirm it to activate your account and open your library.</p>
    <div class="auth-note">Didn't receive it? Check your spam folder, or resend below. The link is valid for 24 hours.</div>
    <div class="auth-error"></div>
    <button class="btn btn-primary" id="vp-resend" type="button">Resend confirmation email</button>
    ${opts.afterLogin ? `<button class="btn" id="vp-continue" type="button" style="margin-top:8px;">Continue with limited access</button>` : ""}
    <div id="vp-dev"></div>
    <div class="gate-hint" style="text-align:center;"><button class="auth-link" id="vp-back">Back to sign in</button></div>`);
  root.querySelector("#vp-back").addEventListener("click", () => renderSignIn());
  const cont = root.querySelector("#vp-continue");
  if (cont) cont.addEventListener("click", () => bootApp());

  // Dev-only shortcut: the local /api/dev/outbox exposes the verification token
  // (it 404s in production), so offer a one-click confirm when testing locally
  // where there is no real inbox.
  (async () => {
    let box = null;
    try { box = await AuthAPI.devOutbox(email); } catch (e) { box = null; }
    const msg = box && (box.latest || (Array.isArray(box.messages) && box.messages[box.messages.length - 1]));
    const token = msg && (msg.token || (String(msg.link || msg.text || "").match(/[?&]token=([^&\s]+)/) || [])[1]);
    const slot = root.querySelector("#vp-dev");
    if (!token || !slot) return;
    slot.innerHTML = `<button class="btn" id="vp-devconfirm" type="button" style="margin-top:8px;">Confirm now (dev)</button>
      <div class="auth-note" style="margin-top:6px;">Local only — uses the verification link from <code>/api/dev/outbox</code>.</div>`;
    slot.querySelector("#vp-devconfirm").addEventListener("click", async (e) => {
      e.target.disabled = true; e.target.textContent = "Confirming…";
      try {
        const d = await AuthAPI.verifyEmail(token);
        const me = await AuthAPI.me().catch(() => null);
        if (me && me.authenticated) { applyUserSession(me); bootApp(); return; }
        if (d && d.access && d.access.authenticated) { applyUserSession({ user: { id: d.access.userId, email: d.access.email, firstName: d.access.firstName, role: d.access.role, aiLevel: d.access.aiLevel, organization: d.access.org, emailVerified: true, accountStatus: d.access.accountStatus }, access: d.access }); bootApp(); return; }
        renderSignIn("Email confirmed — sign in to continue.");
      } catch (err) {
        e.target.disabled = false; e.target.textContent = "Confirm now (dev)";
        fieldErr(root, "Couldn't confirm with the dev token.");
      }
    });
  })();
  root.querySelector("#vp-resend").addEventListener("click", async (e) => {
    e.target.disabled = true; e.target.textContent = "Sending…";
    try { await AuthAPI.resendVerification(email); fieldErr(root, ""); e.target.textContent = "Sent — check your inbox"; }
    catch (err) { e.target.disabled = false; e.target.textContent = "Resend confirmation email"; fieldErr(root, "Couldn't resend right now."); }
  });
}

function renderForgot() {
  const root = authShell(`
    <h1>Reset your password</h1>
    <p class="sub">Enter your email and we'll send a link to choose a new password.</p>
    <form id="fp" novalidate>
      <label for="fp-email">Work email</label>
      <input id="fp-email" class="name-input" type="email" autocomplete="email" placeholder="you@company.com" />
      <div class="auth-error" role="alert" aria-live="polite"></div>
      <button class="btn btn-primary" type="submit">Send reset link</button>
    </form>
    <div class="gate-hint" style="text-align:center;"><button class="auth-link" id="fp-back">Back to sign in</button></div>`);
  root.querySelector("#fp-back").addEventListener("click", () => renderSignIn());
  root.querySelector("#fp").addEventListener("submit", async (e) => {
    e.preventDefault();
    const email = root.querySelector("#fp-email").value.trim();
    try { await AuthAPI.forgotPassword(email); } catch (err) {}
    authShell(`<h1>Check your inbox</h1>
      <p class="sub">If an account exists for <b>${escapeHtml(email)}</b>, a reset link is on its way. It expires in 30 minutes.</p>
      <button class="btn btn-primary" id="fp-done" type="button">Back to sign in</button>`);
    document.getElementById("fp-done").addEventListener("click", () => renderSignIn());
  });
  root.querySelector("#fp-email").focus();
}

function renderReset(token) {
  const root = authShell(`
    <h1>Choose a new password</h1>
    <p class="sub">Enter a new password for your account.</p>
    <form id="rp" novalidate>
      <label for="rp-pass">New password</label>
      ${pwField("rp-pass", "new-password", "At least 5 characters")}
      <label for="rp-pass2" style="margin-top:12px;">Confirm new password</label>
      ${pwField("rp-pass2", "new-password", "Re-enter your password")}
      <div class="auth-error" role="alert" aria-live="polite"></div>
      <button class="btn btn-primary" type="submit">Update password</button>
    </form>`);
  root.querySelector("#rp").addEventListener("submit", async (e) => {
    e.preventDefault();
    const password = root.querySelector("#rp-pass").value;
    const confirmPassword = root.querySelector("#rp-pass2").value;
    if (password.length < 5) return fieldErr(root, "Password must be at least 5 characters.");
    if (password !== confirmPassword) return fieldErr(root, "Passwords don't match.");
    try {
      await AuthAPI.resetPassword({ token, password, confirmPassword });
      history.replaceState(null, "", "/");
      authShell(`<h1>Password updated</h1><p class="sub">You can now sign in with your new password.</p>
        <button class="btn btn-primary" id="rp-done" type="button">Go to sign in</button>`);
      document.getElementById("rp-done").addEventListener("click", () => renderSignIn());
    } catch (err) {
      if (err.status === 410) fieldErr(root, "This reset link has expired or was already used. Request a new one.");
      else if (err.status === 400) fieldErr(root, "This reset link isn't valid. Request a new one.");
      else fieldErr(root, "Couldn't update your password. Try again.");
    }
  });
}

function renderVerifyLanding(token) {
  authShell(`<h1>Confirming your email…</h1><p class="sub">One moment.</p>`);
  AuthAPI.verifyEmail(token).then(async (d) => {
    history.replaceState(null, "", "/");
    if (d.status === "already") {
      authShell(`<h1>Already confirmed</h1><p class="sub">Your email is verified. You can sign in.</p>
        <button class="btn btn-primary" id="ve-go" type="button">Go to sign in</button>`);
      document.getElementById("ve-go").addEventListener("click", () => renderSignIn());
      return;
    }
    // verified — a session cookie was set, and `d.access` already carries the
    // freshly auto-granted (function-scoped) access. Prefer a /me round-trip;
    // fall back to the verify payload so a slow cookie / cross-origin load still
    // boots straight into the scoped library instead of the sign-in screen.
    const me = await AuthAPI.me().catch(() => null);
    if (me && me.authenticated) { applyUserSession(me); bootApp(); return; }
    if (d.access && d.access.authenticated) {
      const a = d.access;
      const nameParts = String(a.name || "").trim().split(/\s+/);
      applyUserSession({
        user: {
          id: a.userId, email: a.email,
          firstName: a.firstName || nameParts[0] || "", lastName: nameParts.slice(1).join(" "),
          role: a.role, aiLevel: a.aiLevel, organization: a.org,
          emailVerified: a.emailVerified, accountStatus: a.accountStatus,
        },
        access: a,
      });
      bootApp();
      return;
    }
    authShell(`<h1>Email confirmed 🎉</h1><p class="sub">You're all set. Sign in to open your library.</p>
      <button class="btn btn-primary" id="ve-go" type="button">Go to sign in</button>`);
    document.getElementById("ve-go").addEventListener("click", () => renderSignIn());
  }).catch((err) => {
    history.replaceState(null, "", "/");
    const map = { expired: "This link has expired.", used: "This link was already used.", invalid: "This link isn't valid." };
    const reason = (err.data && map[err.data.error]) || "We couldn't confirm your email.";
    authShell(`<h1>Link problem</h1><p class="sub">${reason} Sign in and resend a fresh confirmation email.</p>
      <button class="btn btn-primary" id="ve-go" type="button">Go to sign in</button>`);
    document.getElementById("ve-go").addEventListener("click", () => renderSignIn());
  });
}

// There is no separate admin console sign-in any more. Admins sign in through
// the ONE form (renderSignIn) with their admin email + password; the backend
// (/api/auth/login) detects the system-admin role and routes them to the
// console. This alias keeps old /admin/login links working.
function renderAdminLogin(msg) {
  history.replaceState(null, "", "/");
  renderSignIn(msg || "Sign in with your admin email and password.");
}

/* ---- in-app status banner: verify email OR add access ---- */
function verificationBannerHtml() {
  const s = Store.getSession && Store.getSession();
  if (!s || !s.user) return "";
  const a = CURRENT_ACCESS || s.access || {};
  const tier = a.personalization && a.personalization.tier;
  if (tier === "blocked") {
    return `<div class="verify-banner" id="verify-banner" style="background:var(--danger-soft,#fef2f2);color:var(--danger);">
      <span>Your account is on hold. Contact your programme lead to restore access.</span>
      <span class="vb-actions"><button class="vb-btn" id="vb-signout">Sign out</button></span></div>`;
  }
  const pend = pendingAccessCode();
  if (!s.emailVerified) {
    try { if (sessionStorage.getItem("prompt-lib:vbanner-dismissed") === "1") return ""; } catch (e) {}
    return `<div class="verify-banner" id="verify-banner">
      <span>Please confirm your email address to activate your account and open the full library.${
        pend ? ` Your access code <b>${escapeHtml(pend)}</b> will apply automatically once confirmed.` : ""}</span>
      <span class="vb-actions">
        <button class="vb-btn" id="vb-devconfirm" hidden>Confirm now (dev)</button>
        <button class="vb-btn" id="vb-resend">Resend confirmation</button>
        <button class="vb-x" id="vb-x" aria-label="Dismiss">✕</button>
      </span></div>`;
  }
  const active = a.access && a.access.active;
  if (!active) {
    // Verified but access still settling (rare — auto-grant normally runs on
    // verification). No action for the learner; it resolves on the next load.
    return `<div class="verify-banner" id="verify-banner" style="background:var(--accent-soft);color:var(--accent-strong);">
      <span>Your library is being set up. If it doesn't appear shortly, contact your programme lead.</span>
      <span class="vb-actions"><button class="vb-btn" id="vb-refresh">Refresh</button></span></div>`;
  }
  // Verified + active. Offer an "add an access code" affordance. Every learner
  // can stack more codes now (managed on the "Access codes" page in the
  // sidebar), so the only reasons to hide the banner are a full-library scope
  // (nothing to widen) or a manual dismiss — unless a code is pending (e.g.
  // redeem failed pre-verify and needs a retry).
  const scopeType = a.access && a.access.scopeType;
  let dismissed = false;
  try { dismissed = sessionStorage.getItem("prompt-lib:addcode-dismissed") === "1"; } catch (e) {}
  if (!pend && (scopeType === "full" || dismissed)) return "";
  return `<div class="verify-banner" id="verify-banner" style="background:var(--accent-soft);color:var(--accent-strong);">
    <span>${pend
      ? `Apply your organisation access code <b>${escapeHtml(pend)}</b> to open its library.`
      : "Have an access code for another programme? Add it — codes stack."}</span>
    <span class="vb-actions" style="display:flex;gap:6px;align-items:center;flex-wrap:wrap;">
      <input id="vb-code" class="name-input" style="max-width:190px;padding:6px 8px;" placeholder="ACCESS-CODE" value="${escapeHtml(pend || "")}" />
      <button class="vb-btn" id="vb-addcode">Add code</button>
      <button class="vb-btn" id="vb-managecodes" style="background:transparent;">Manage codes</button>
      <button class="vb-x" id="vb-addcode-x" aria-label="Dismiss">✕</button>
    </span></div>`;
}
function wireVerificationBanner() {
  const el = document.getElementById("verify-banner");
  if (!el) return;
  const s = Store.getSession();
  const resend = el.querySelector("#vb-resend");
  if (resend) resend.addEventListener("click", async (e) => {
    e.target.disabled = true; e.target.textContent = "Sending…";
    try { await AuthAPI.resendVerification(s.email); e.target.textContent = "Sent ✓"; }
    catch (err) { e.target.textContent = "Try again"; e.target.disabled = false; }
  });
  // Dev-only: /api/dev/outbox exposes the verification token locally (404s in
  // production), so offer a one-click confirm from the banner too.
  const dev = el.querySelector("#vb-devconfirm");
  if (dev && s && s.email) {
    AuthAPI.devOutbox(s.email).then((box) => {
      const msg = box && (box.latest || (Array.isArray(box.messages) && box.messages[box.messages.length - 1]));
      const token = msg && (msg.token || (String(msg.link || msg.text || "").match(/[?&]token=([^&\s]+)/) || [])[1]);
      if (!token) return;
      dev.hidden = false;
      dev.addEventListener("click", async (e) => {
        e.target.disabled = true; e.target.textContent = "Confirming…";
        try {
          const d = await AuthAPI.verifyEmail(token);
          const me = await AuthAPI.me().catch(() => null);
          if (me && me.authenticated) applyUserSession(me);
          else if (d && d.access && d.access.authenticated) applyUserSession({ user: { id: d.access.userId, email: d.access.email, firstName: d.access.firstName, role: d.access.role, aiLevel: d.access.aiLevel, organization: d.access.org, emailVerified: true, accountStatus: d.access.accountStatus }, access: d.access });
          bootApp();
        } catch (err) { e.target.disabled = false; e.target.textContent = "Confirm now (dev)"; }
      });
    }).catch(() => {});
  }
  const x = el.querySelector("#vb-x");
  if (x) x.addEventListener("click", () => { try { sessionStorage.setItem("prompt-lib:vbanner-dismissed", "1"); } catch (e) {} el.remove(); });
  const so = el.querySelector("#vb-signout");
  if (so) so.addEventListener("click", () => signOut());
  const addBtn = el.querySelector("#vb-addcode");
  if (addBtn) addBtn.addEventListener("click", async () => {
    const inp = el.querySelector("#vb-code");
    const code = (inp && inp.value || "").trim();
    if (!code) { if (inp) inp.focus(); return; }
    addBtn.disabled = true; addBtn.textContent = "Adding…";
    const r = await applyAccessCode(code);
    if (r.ok) {
      clearPendingAccessCode();
      if (typeof showToast === "function") showToast("Organisation library unlocked");
      if (typeof renderApp === "function") renderApp();
    } else {
      addBtn.disabled = false; addBtn.textContent = "Add code";
      if (typeof showToast === "function") showToast(accessCodeErrorText(r.error));
    }
  });
  const manage = el.querySelector("#vb-managecodes");
  if (manage) manage.addEventListener("click", () => {
    if (typeof navigate === "function") navigate("accessCodes");
  });
  const addX = el.querySelector("#vb-addcode-x");
  if (addX) addX.addEventListener("click", () => {
    clearPendingAccessCode();
    try { sessionStorage.setItem("prompt-lib:addcode-dismissed", "1"); } catch (e) {}
    el.remove();
  });
  const inp = el.querySelector("#vb-code");
  if (inp) inp.addEventListener("keydown", (e) => { if (e.key === "Enter") { e.preventDefault(); addBtn && addBtn.click(); } });
  const refresh = el.querySelector("#vb-refresh");
  if (refresh) refresh.addEventListener("click", async () => {
    const me = await refreshAccess();
    if (me && me.authenticated) { applyUserSession(me); }
    if (typeof renderApp === "function") renderApp();
  });
}

/* ============================================================================
   Public marketing landing (logged-out `/`). The sign-in gate moved to `/login`.
   renderPublicEntry() picks between the two by path; initApp() calls it for a
   fresh visitor with no session. Data (counts, framework levels, sample prompts)
   is read from the already-loaded ALL_PROMPTS / FRAMEWORK globals — no network.
   ========================================================================== */
const LP_FREE_IDS = ["lib-1303", "lib-546", "lib-1232", "lib-2610", "lib-293", "lib-1148", "lib-3315", "lib-2715"];
const LP_PREMIUM_IDS = ["lib-2457", "lib-581", "lib-1261", "lib-2253", "lib-3047", "lib-2678", "lib-260", "lib-2809"];

function lpNum(n) { return (n || 0).toLocaleString("en-US"); }
function lpClip(s, n) {
  s = String(s || "").replace(/\s+/g, " ").trim();
  if (s.length <= n) return s;
  const c = s.slice(0, n), i = c.lastIndexOf(" ");
  return (i > n * 0.6 ? c.slice(0, i) : c).replace(/\s+$/, "") + "…";
}
function lpLevelOf(rec) {
  if (rec.frameworkLevel == null && typeof deriveFrameworkLevel === "function") deriveFrameworkLevel(rec);
  return rec.frameworkLevel || null;
}
function lpData() {
  const live = (typeof ALL_PROMPTS !== "undefined" ? ALL_PROMPTS : []).filter((p) => p && p.lifecycle !== "Archived");
  const cats = {}, lvl = { 1: 0, 2: 0, 3: 0 };
  live.forEach((p) => {
    if (p.category) cats[p.category] = (cats[p.category] || 0) + 1;
    const L = lpLevelOf(p);
    if (L >= 1 && L <= 3) lvl[L]++;
  });
  const catList = Object.keys(cats).map((k) => ({ name: k, count: cats[k] }))
    .sort((a, b) => b.count - a.count || a.name.localeCompare(b.name));
  return { total: live.length, cats: catList, levels: lvl };
}
function lpTagFor(rec) {
  const L = lpLevelOf(rec);
  if (L && typeof fwLevel === "function") return '<span class="lp-tag lp-tag-fw">L' + L + " · " + escapeHtml(fwLevel(L).code) + "</span>";
  if (rec.isTemplate) return '<span class="lp-tag">Template</span>';
  return "";
}
function lpSampleCard(rec, locked) {
  if (!rec) return "";
  const cat = '<span class="lp-tag">' + escapeHtml(rec.category || "") + "</span>";
  const desc = rec.description ? "<p>" + escapeHtml(lpClip(rec.description, 150)) + "</p>" : "";
  if (locked) {
    return '<div class="lp-card lp-lockcard" data-lp-signup>'
      + '<div class="lp-card-tags">' + cat + lpTagFor(rec) + "</div>"
      + "<h3>" + escapeHtml(rec.title || "") + "</h3>" + desc
      + '<div class="lp-locked"><pre>' + escapeHtml(lpClip(rec.originalPrompt, 200)) + "</pre>"
      + '<span class="lp-lock">🔒 Sign up to unlock</span></div></div>';
  }
  return '<div class="lp-card">'
    + '<div class="lp-card-tags"><span class="lp-tag lp-tag-free">Free</span>' + cat + lpTagFor(rec) + "</div>"
    + "<h3>" + escapeHtml(rec.title || "") + "</h3>" + desc
    + '<div class="lp-body">' + escapeHtml(lpClip(rec.originalPrompt, 900)) + "</div>"
    + '<button class="lp-copy" data-lp-copy="' + escapeHtml(rec.id) + '">Copy prompt</button></div>';
}

/* Landing (logged out). Built on a few ideas about how people decide:
   show the product working in the first screen (search is the hero), let
   people get real value before asking for anything (a live playground and
   3 free full previews), make the gap visible (a vague request next to a
   framework prompt), and ask for the sign-up exactly when they want more.
   Whatever they searched or opened is kept for after they sign up. */
const LPX_FREE_PREVIEWS = 3;
const LPX_PLAY_IDS = ["ev-email-3", "ev-meetings-1", "ev-life-7"];
const LPX_DEMO_ID = "ev-present-1";
function lpxUnlocked() {
  try { const v = JSON.parse(localStorage.getItem("prompt-lib:lpUnlocked") || "[]"); return Array.isArray(v) ? v : []; } catch (e) { return []; }
}
function lpxUnlock(id) {
  const u = lpxUnlocked();
  if (u.includes(id)) return true;
  if (u.length >= LPX_FREE_PREVIEWS) return false;
  u.push(id);
  try { localStorage.setItem("prompt-lib:lpUnlocked", JSON.stringify(u)); } catch (e) {}
  return true;
}
function lpxLeft() { return Math.max(0, LPX_FREE_PREVIEWS - lpxUnlocked().length); }
function lpxCorpus() {
  if (lpxCorpus._c) return lpxCorpus._c;
  const all = typeof ALL_PROMPTS !== "undefined" ? ALL_PROMPTS : [];
  return (lpxCorpus._c = all.filter((r) => r && !r.programId && r.lifecycle !== "Archived"));
}
// keep what they were doing so the app can pick it up after sign-up / log-in
function lpxRemember(state) { try { sessionStorage.setItem("prompt-lib:pending", JSON.stringify(state || {})); } catch (e) {} }
function lpxOpenIn(tool, text) {
  const q = encodeURIComponent(text);
  const url = tool === "claude" ? "https://claude.ai/new?q=" + q : "https://chatgpt.com/?q=" + q;
  window.open(url, "_blank", "noopener");
}
// the prompt with its framework labels picked out, and fill-ins highlighted
function lpxPromptHtml(text, max) {
  let t = String(text || "");
  if (max && t.length > max) { const c = t.slice(0, max), i = c.lastIndexOf(" "); t = (i > max * 0.6 ? c.slice(0, i) : c) + "…"; }
  return escapeHtml(t)
    .replace(/^(Role|Context|Goal|Task|Constraints|Example|Format|Verification|Validation):/gm, '<b class="lpx-lbl lpx-lbl-$1">$1</b>')
    .replace(/\[([A-Z][A-Z0-9_]*(?:[ ,:][^\]\n]*)?)\]/g, '<span class="lpx-var">[$1]</span>');
}
function lpxCardHtml(r) {
  const open = lpxUnlocked().includes(r.id);
  const lock = !open && !lpxLeft();
  return '<button class="lpx-card" data-lpx-open="' + escapeHtml(r.id) + '">'
    + '<span class="lpx-card-top"><span class="lpx-ico" aria-hidden="true">' + (typeof promptIcon === "function" ? promptIcon(r) : "📝") + "</span>"
    + '<span class="lpx-card-state">' + (open ? "Unlocked" : lock ? "🔒 Members" : "Preview free") + "</span></span>"
    + "<b>" + escapeHtml(r.title) + "</b>"
    + "<span>" + escapeHtml(lpClip(r.description || "", 110)) + "</span>"
    + '<em>' + escapeHtml(r.category || "") + "</em></button>";
}

function renderLanding() {
  document.getElementById("app").hidden = true;
  const ar = document.getElementById("admin-root"); if (ar) ar.hidden = true;
  const root = document.getElementById("gate-root");
  const byId = (typeof ALL_PROMPTS_BY_ID !== "undefined") ? ALL_PROMPTS_BY_ID : {};
  const d = lpData();
  const total = lpNum(d.total);
  const hubCount = typeof TASK_HUBS !== "undefined" ? TASK_HUBS.length : 18;
  const roles = typeof ROLES !== "undefined" ? ROLES.map((r) => {
    const cats = new Set(r.cats);
    return Object.assign({}, r, { count: lpxCorpus().filter((p) => cats.has(p.category)).length });
  }) : [];
  const demo = byId[LPX_DEMO_ID];
  const plays = LPX_PLAY_IDS.map((id) => byId[id]).filter(Boolean);
  const quick = [["📊", "Make a presentation"], ["✉️", "Reply to a difficult email"], ["🗓️", "Plan my week"], ["🎤", "Prepare for a job interview"]];

  root.innerHTML =
    '<div id="lp" class="lpx">'
    + '<header class="lp-bar"><div class="lp-wrap">'
      + '<img class="lp-logo" src="/prompt-intelligence.png" alt="Prompt Intelligence by Synottic">'
      + '<nav class="lp-bar-nav"><button class="lp-btn lp-btn-ghost" data-lp-login>Log in</button>'
      + '<button class="lp-btn lp-btn-primary" data-lp-signup>Sign up free</button></nav>'
    + "</div></header>"

    // 1 · hero: the product itself
    + '<section class="lpx-hero"><div class="lp-wrap">'
      + '<p class="lpx-pill"><span>New</span>' + total + " expert prompts · free to start</p>"
      + '<h1 class="lpx-h1">Get expert‑level answers from AI.<br><em>Every time.</em></h1>'
      + '<p class="lpx-lead">Most people get average results because they ask average questions. Tell us what you need, and we’ll hand you the prompt an expert would write.</p>'
      + '<div class="lpx-search" role="search"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" aria-hidden="true"><circle cx="11" cy="11" r="7"/><path d="M20 20l-3.5-3.5"/></svg>'
      + '<input id="lpx-q" type="text" autocomplete="off" aria-label="What do you need to get done?" placeholder="What do you need to get done? e.g. prepare for a salary talk">'
      + '<button class="lpx-go" id="lpx-go" aria-label="Search">Find prompts</button></div>'
      + '<div class="lpx-quick">' + quick.map((x) => '<button data-lpx-q="' + escapeHtml(x[1]) + '"><span aria-hidden="true">' + x[0] + "</span>" + escapeHtml(x[1]) + "</button>").join("") + "</div>"
      + '<p class="lpx-trust">Works with <b>ChatGPT</b> · <b>Claude</b> · <b>Gemini</b> · <b>Copilot</b><span>No credit card. No install.</span></p>'
      + '<div class="lpx-results" id="lpx-results" hidden></div>'
    + "</div></section>"

    // 2 · the gap, made visible
    + (demo ? '<section class="lp-wrap lpx-sec"><div class="lpx-head"><p class="lp-eyebrow">Why your AI answers feel generic</p>'
      + '<h2 class="lpx-h2">Same AI. Very different result.</h2>'
      + '<p class="lpx-sub">AI can only be as good as what you ask. Every prompt here tells it who to be, what you need and what good looks like.</p></div>'
      + '<div class="lpx-vs">'
        + '<div class="lpx-vs-a"><span class="lpx-vs-tag">What most people type</span><div class="lpx-bubble">make a presentation about our Q3 results</div>'
        + '<ul class="lpx-cons"><li>Generic slides you have to rewrite</li><li>No story, no clear ask</li><li>Guesses your audience</li></ul></div>'
        + '<div class="lpx-vs-b"><span class="lpx-vs-tag lpx-vs-tag-good">What Prompt Intelligence gives you</span>'
        + '<pre class="lpx-prompt">' + lpxPromptHtml(demo.originalPrompt, 620) + "</pre>"
        + '<ul class="lpx-pros"><li>A deck with a story and one clear message</li><li>Built for your audience and time slot</li><li>Speaker notes included</li></ul></div>'
      + "</div></section>" : "")

    // 3 · playground: value before any ask
    + (plays.length ? '<section class="lpx-band"><div class="lp-wrap lpx-sec"><div class="lpx-head"><p class="lp-eyebrow">Try it now · no account</p>'
      + '<h2 class="lpx-h2">Fill in two lines. Get a prompt that works.</h2>'
      + '<p class="lpx-sub">Pick one, type your details, then copy it or open it straight in your AI tool.</p></div>'
      + '<div class="lpx-play"><div class="lpx-tabs" role="tablist">' + plays.map((r, i) => '<button role="tab" data-lpx-play="' + i + '" aria-selected="' + (i === 0) + '">' + escapeHtml(r.title) + "</button>").join("") + "</div>"
      + '<div class="lpx-play-body"><div class="lpx-fields" id="lpx-fields"></div>'
      + '<div class="lpx-out"><pre class="lpx-prompt" id="lpx-out"></pre>'
      + '<div class="lpx-actions"><button class="lp-btn lp-btn-primary" id="lpx-copy">Copy prompt</button>'
      + '<button class="lp-btn lp-btn-outline" data-lpx-openin="chatgpt">Open in ChatGPT</button>'
      + '<button class="lp-btn lp-btn-outline" data-lpx-openin="claude">Open in Claude</button></div></div></div></div>'
      + '<p class="lpx-note">Liked that? There are <b>' + total + "</b> more, and a builder to make your own. <button class=\"lpx-link\" data-lp-signup>Get them free →</button></p>"
      + "</div></section>" : "")

    // 4 · browse by role
    + (roles.length ? '<section class="lp-wrap lpx-sec"><div class="lpx-head"><p class="lp-eyebrow">Built for the work you do</p>'
      + '<h2 class="lpx-h2">Find your shelf in one click</h2>'
      + '<p class="lpx-sub">' + hubCount + " everyday tasks and " + d.cats.length + " fields, grouped the way you work.</p></div>"
      + '<div class="lpx-roles">' + roles.map((r) => '<button class="lpx-role" data-lpx-role="' + r.id + '"><span class="lpx-ico" aria-hidden="true">' + r.icon + "</span>"
        + "<b>" + escapeHtml(r.label) + "</b><span>" + escapeHtml(r.sub) + "</span><em>" + lpNum(r.count) + " prompts</em></button>").join("") + "</div>"
      + "</section>" : "")

    // 5 · what the free account unlocks
    + '<section class="lpx-band"><div class="lp-wrap lpx-sec"><div class="lpx-head"><p class="lp-eyebrow">Your free account</p>'
      + '<h2 class="lpx-h2">Everything you need to work smarter with AI</h2></div>'
      + '<div class="lpx-gets">'
        + '<div><span class="lpx-ico">🔓</span><b>The full library</b><p>' + total + " prompts across " + d.cats.length + " fields and " + hubCount + " everyday tasks, all written in the framework.</p></div>"
        + '<div><span class="lpx-ico">🛠️</span><b>Build your own</b><p>A guided builder turns your idea into a strong prompt, step by step.</p></div>'
        + '<div><span class="lpx-ico">📁</span><b>Your prompt library</b><p>Save favourites, keep your own versions and find them instantly with search.</p></div>'
        + '<div><span class="lpx-ico">🎯</span><b>Learn and practise</b><p>Short lessons and practice with feedback, so you get better every week.</p></div>'
      + "</div>"
      + '<div class="lpx-cta"><button class="lp-btn lp-btn-primary lpx-big" data-lp-signup>Create my free account</button>'
      + '<p>Takes 20 seconds · no credit card · <a href="#" data-lp-code>have an access code?</a></p></div>'
    + "</div></section>"

    // 6 · close
    + '<section class="lp-wrap lpx-final"><p class="lp-eyebrow">Don’t just use AI. Think with it.</p><h2 class="lpx-h2">Stop rewriting AI answers.<br>Start with a better prompt.</h2>'
      + '<div class="lpx-cta"><button class="lp-btn lp-btn-primary lpx-big" data-lp-signup>Sign up free</button><button class="lp-btn lp-btn-outline lpx-big" data-lp-login>Log in</button></div></section>'
    + '<footer class="lp-foot"><div class="lp-wrap"><span>Synottic Prompt Intelligence · Human‑Centred AI</span><nav class="lp-foot-links"><a href="/terms">Terms</a><a href="/privacy">Privacy</a><a href="#" data-lp-login>Sign in</a></nav></div></footer>'
    + '<div class="lpx-sticky" id="lpx-sticky" hidden><span><b>' + total + " prompts</b> waiting for you</span><button class=\"lp-btn lp-btn-primary\" data-lp-signup>Sign up free</button></div>"
    + '<div class="lpx-modal" id="lpx-modal" hidden role="dialog" aria-modal="true" aria-labelledby="lpx-m-title"><div class="lpx-modal-card" id="lpx-modal-card"></div></div>'
    + "</div>";

  const go = (fn) => { try { history.pushState(null, "", "/login"); } catch (e) {} fn(); window.scrollTo(0, 0); };
  const toSignUp = () => go(renderSignUp);
  const wireAuth = (el) => {
    el.querySelectorAll("[data-lp-login]").forEach((b) => b.addEventListener("click", (e) => { e.preventDefault(); go(renderSignIn); }));
    el.querySelectorAll("[data-lp-signup]").forEach((b) => b.addEventListener("click", (e) => { e.preventDefault(); toSignUp(); }));
    el.querySelectorAll("[data-lp-code]").forEach((b) => b.addEventListener("click", (e) => { e.preventDefault(); go(() => renderGate(null, { classic: true })); }));
  };
  wireAuth(root);
  const copy = (text, btn) => {
    const done = () => { const t = btn.textContent; btn.textContent = "Copied ✓"; setTimeout(() => { btn.textContent = t; }, 1500); };
    if (navigator.clipboard) navigator.clipboard.writeText(text).then(done).catch(() => {}); else done();
  };

  // ---- search: real results from the real library ----
  const q = root.querySelector("#lpx-q");
  if (window.matchMedia && window.matchMedia("(max-width: 600px)").matches) q.placeholder = "What do you need to get done?";
  const out = root.querySelector("#lpx-results");
  let lastQ = "";
  function showResults(title, recs, query, totalN) {
    lastQ = query || "";
    const left = lpxLeft();
    out.innerHTML = '<div class="lpx-res-head"><b>' + escapeHtml(title) + "</b>"
      + '<span class="lpx-left">' + (left ? left + " free full preview" + (left === 1 ? "" : "s") + " left" : "Free previews used · sign up to open all") + "</span></div>"
      + '<div class="lpx-grid">' + recs.slice(0, 5).map(lpxCardHtml).join("")
      + '<button class="lpx-card lpx-more" data-lpx-all><span class="lpx-ico" aria-hidden="true">🔓</span><b>See all ' + lpNum(totalN) + " results</b>"
      + "<span>Open every prompt, save favourites and make your own. Free.</span><em>Sign up free →</em></button></div>";
    out.hidden = false;
    out.querySelectorAll("[data-lpx-open]").forEach((b) => b.addEventListener("click", () => openPrompt(b.getAttribute("data-lpx-open"))));
    out.querySelector("[data-lpx-all]").addEventListener("click", () => { lpxRemember({ q: lastQ }); toSignUp(); });
  }
  function runSearch(text) {
    text = String(text || "").trim();
    if (text.length < 2) { out.hidden = true; return; }
    const res = typeof searchPrompts === "function" ? searchPrompts(lpxCorpus(), text, null, { quiet: true }) : [];
    if (!res.length) {
      out.innerHTML = '<div class="lpx-empty"><b>No exact match for “' + escapeHtml(text) + '”</b><span>With a free account you can build this prompt yourself in under a minute.</span>'
        + '<button class="lp-btn lp-btn-primary" data-lpx-build>Build it free</button></div>';
      out.hidden = false;
      out.querySelector("[data-lpx-build]").addEventListener("click", () => { lpxRemember({ q: text, build: true }); toSignUp(); });
      return;
    }
    showResults(lpNum(res.length) + " prompts match “" + text + "”", res, text, res.length);
  }
  const deb = (fn, ms) => { let t; return (...a) => { clearTimeout(t); t = setTimeout(() => fn(...a), ms); }; };
  q.addEventListener("input", deb(() => runSearch(q.value), 160));
  q.addEventListener("keydown", (e) => { if (e.key === "Enter") runSearch(q.value); });
  root.querySelector("#lpx-go").addEventListener("click", () => { runSearch(q.value); q.focus(); });
  root.querySelectorAll("[data-lpx-q]").forEach((b) => b.addEventListener("click", () => { q.value = b.getAttribute("data-lpx-q"); runSearch(q.value); }));
  root.querySelectorAll("[data-lpx-role]").forEach((b) => b.addEventListener("click", () => {
    const r = ROLES_BY_ID[b.getAttribute("data-lpx-role")];
    const cats = new Set(r.cats);
    const recs = lpxCorpus().filter((p) => cats.has(p.category)).sort((a, c) => (c.source === "Everyday Essentials") - (a.source === "Everyday Essentials") || (c.qualityScore || 0) - (a.qualityScore || 0));
    q.value = "";
    showResults(r.icon + " " + r.label + ": our best prompts", recs, "", recs.length);
    lpxRemember({ role: r.id });
    root.querySelector(".lpx-hero").scrollIntoView({ behavior: "smooth", block: "start" });
  }));

  // ---- prompt preview: 3 full previews, then the ask ----
  const modal = root.querySelector("#lpx-modal");
  const card = root.querySelector("#lpx-modal-card");
  const closeModal = () => { modal.hidden = true; document.body.style.overflow = ""; };
  modal.addEventListener("click", (e) => { if (e.target === modal) closeModal(); });
  renderLanding._esc = () => { if (!modal.hidden) closeModal(); };
  if (!renderLanding._escWired) {
    renderLanding._escWired = true;
    document.addEventListener("keydown", (e) => { if (e.key === "Escape" && renderLanding._esc && document.getElementById("lpx-modal")) renderLanding._esc(); });
  }
  function openPrompt(id) {
    const r = byId[id];
    if (!r) return;
    const open = lpxUnlock(id);
    const left = lpxLeft();
    card.innerHTML = '<button class="lpx-x" aria-label="Close">×</button>'
      + '<div class="lpx-m-top"><span class="lpx-ico" aria-hidden="true">' + (typeof promptIcon === "function" ? promptIcon(r) : "📝") + '</span><div><h3 id="lpx-m-title">' + escapeHtml(r.title) + "</h3>"
      + "<span>" + escapeHtml(r.category || "") + (lpTagFor(r) ? " · " + lpTagFor(r).replace(/<[^>]+>/g, "") : "") + "</span></div></div>"
      + (r.description ? '<p class="lpx-m-desc">' + escapeHtml(r.description) + "</p>" : "")
      + (r.outcome ? '<p class="lpx-m-get"><b>What you’ll get:</b> ' + escapeHtml(r.outcome) + "</p>" : "")
      + (open
        ? '<pre class="lpx-prompt lpx-m-prompt">' + lpxPromptHtml(r.originalPrompt) + "</pre>"
          + '<div class="lpx-actions"><button class="lp-btn lp-btn-primary" data-lpx-copy>Copy prompt</button>'
          + '<button class="lp-btn lp-btn-outline" data-lpx-openin="chatgpt">Open in ChatGPT</button><button class="lp-btn lp-btn-outline" data-lpx-openin="claude">Open in Claude</button></div>'
          + '<div class="lpx-m-nudge"><span>' + (left ? "You have <b>" + left + "</b> free preview" + (left === 1 ? "" : "s") + " left." : "That was your last free preview.")
          + " A free account opens all " + total + ' prompts and lets you save this one.</span><button class="lp-btn lp-btn-primary" data-lpx-save>Save it free</button></div>'
        : '<div class="lpx-locked"><pre class="lpx-prompt lpx-m-prompt">' + lpxPromptHtml(r.originalPrompt, 260) + "</pre>"
          + '<div class="lpx-lockcard"><b>You’ve seen your 3 free previews</b><span>Create a free account to open this prompt and all ' + total + " others, save the ones you like and build your own.</span>"
          + '<button class="lp-btn lp-btn-primary lpx-big" data-lpx-save>Unlock free · 20 seconds</button><button class="lpx-link" data-lp-login>I already have an account</button></div></div>');
    modal.hidden = false;
    document.body.style.overflow = "hidden";
    card.querySelector(".lpx-x").addEventListener("click", closeModal);
    const cp = card.querySelector("[data-lpx-copy]");
    if (cp) cp.addEventListener("click", () => copy(r.originalPrompt, cp));
    card.querySelectorAll("[data-lpx-openin]").forEach((b) => b.addEventListener("click", () => lpxOpenIn(b.getAttribute("data-lpx-openin"), r.originalPrompt)));
    card.querySelectorAll("[data-lpx-save]").forEach((b) => b.addEventListener("click", () => { lpxRemember({ q: lastQ, id }); closeModal(); toSignUp(); }));
    wireAuth(card);
    card.querySelector(".lpx-x").focus();
    // cards reflect the new state (unlocked / previews left)
    out.querySelectorAll("[data-lpx-open]").forEach((b) => { const rec = byId[b.getAttribute("data-lpx-open")]; if (rec) b.outerHTML = lpxCardHtml(rec); });
    out.querySelectorAll("[data-lpx-open]").forEach((b) => b.addEventListener("click", () => openPrompt(b.getAttribute("data-lpx-open"))));
    const leftEl = out.querySelector(".lpx-left");
    if (leftEl) leftEl.textContent = left ? left + " free full preview" + (left === 1 ? "" : "s") + " left" : "Free previews used · sign up to open all";
  }

  // ---- playground: fill-ins update the prompt live ----
  const fields = root.querySelector("#lpx-fields");
  const outPre = root.querySelector("#lpx-out");
  if (fields && plays.length) {
    let cur = 0, vals = {};
    const varsOf = (text) => Array.from(new Set((text.match(/\[[A-Z][A-Z0-9_]*(?:[ ,:][^\]\n]*)?\]/g) || [])));
    const filled = () => {
      let t = plays[cur].originalPrompt;
      varsOf(t).forEach((v) => { if (vals[v]) t = t.split(v).join(vals[v]); });
      return t;
    };
    const paint = () => { outPre.innerHTML = lpxPromptHtml(filled()); };
    const load = (i) => {
      cur = i; vals = {};
      fields.innerHTML = varsOf(plays[i].originalPrompt).slice(0, 5).map((v) => {
        const lp = typeof varLabelParts === "function" ? varLabelParts(v) : { label: v, hint: "" };
        return '<label class="lpx-field"><span>' + escapeHtml(lp.label.replace(/\bi\b/g, "I")) + '</span><input type="text" data-v="' + escapeHtml(v) + '" placeholder="' + escapeHtml(lp.hint || "Type here…") + '"></label>';
      }).join("");
      fields.querySelectorAll("input").forEach((inp) => inp.addEventListener("input", () => { vals[inp.getAttribute("data-v")] = inp.value.trim(); paint(); }));
      paint();
    };
    root.querySelectorAll("[data-lpx-play]").forEach((b) => b.addEventListener("click", () => {
      root.querySelectorAll("[data-lpx-play]").forEach((x) => x.setAttribute("aria-selected", String(x === b)));
      load(+b.getAttribute("data-lpx-play"));
    }));
    load(0);
    const cpy = root.querySelector("#lpx-copy");
    cpy.addEventListener("click", () => copy(filled(), cpy));
    root.querySelectorAll(".lpx-play [data-lpx-openin]").forEach((b) => b.addEventListener("click", () => lpxOpenIn(b.getAttribute("data-lpx-openin"), filled())));
  }

  // ---- phones: a quiet sign-up bar once the hero is out of view ----
  const sticky = root.querySelector("#lpx-sticky");
  const hero = root.querySelector(".lpx-hero");
  if (window.IntersectionObserver && sticky && hero) {
    new IntersectionObserver((es) => { sticky.hidden = es[0].isIntersecting; }).observe(hero);
  }
  window.scrollTo(0, 0);
}

/** Fresh logged-out visitor: `/login` -> the sign-in gate; anything else -> the landing. */
function renderPublicEntry(msg) {
  if (/^\/login\/?$/.test(location.pathname || "")) { renderSignIn(msg); return; }
  renderLanding();
}

/* ---- route detection, called from initApp ---- */
function authRoute() {
  const path = location.pathname || "";
  const qs = new URLSearchParams(location.search || "");
  if (/\/verify-email\/?$/.test(path)) return { name: "verify", token: qs.get("token") };
  if (/\/reset-password\/?$/.test(path)) return { name: "reset", token: qs.get("token") };
  if (/\/forgot-password\/?$/.test(path)) return { name: "forgot" };
  if (/\/admin\/login\/?$/.test(path) || location.hash === "#/admin/login") return { name: "adminLogin" };
  if (qs.get("oauth_error")) return { name: "oauthError", code: qs.get("oauth_error") };
  if (qs.get("oauth") === "new") return { name: "oauthNew" };
  return null;
}
async function handleAuthRoute(r) {
  if (r.name === "verify") { r.token ? renderVerifyLanding(r.token) : renderSignIn("Missing confirmation token."); return true; }
  if (r.name === "reset") { r.token ? renderReset(r.token) : renderForgot(); return true; }
  if (r.name === "forgot") { renderForgot(); return true; }
  if (r.name === "oauthError") {
    try { history.replaceState(null, "", "/login"); } catch (e) {}
    renderSignIn(OAUTH_ERRORS[r.code] || OAUTH_ERRORS.failed);
    return true;
  }
  if (r.name === "oauthNew") {
    try { history.replaceState(null, "", "/"); } catch (e) {}
    const me = await AuthAPI.me().catch(() => null);
    if (!me || !me.authenticated) { renderSignIn(OAUTH_ERRORS.failed); return true; }
    applyUserSession(me);
    renderOAuthProfile(me);
    return true;
  }
  if (r.name === "adminLogin") {
    // legacy link — no separate console sign-in. If already an admin, open the
    // console; otherwise show the one unified sign-in form.
    let adminOk = false;
    try { adminOk = sessionStorage.getItem("prompt-lib:admin-ok") === "1"; } catch (e) {}
    history.replaceState(null, "", "/");
    if (adminOk && typeof openAdmin === "function") { openAdmin(); return true; }
    renderSignIn("Sign in with your admin email and password.");
    return true;
  }
  return false;
}
