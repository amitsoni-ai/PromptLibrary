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

  async function call(path, { method = "GET", body } = {}) {
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
    updateProfile: (b) => call("/auth/me", { method: "PATCH", body: b }),
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

// Right-hand brand panel shown beside every auth screen. Desktop/tablet show
// the full-bleed Synottic artwork (which carries the message); on mobile the
// artwork is replaced by a compact text banner below the form.
function authBrandAside() {
  return `<aside class="auth-brand">
    <img class="auth-brand-img" src="/homepage.png" alt="Synottic Prompt Intelligence — don't just use AI, think with it." fetchpriority="high" decoding="async" />
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

/* ============================ screens ============================ */
function authShell(inner) {
  const root = document.getElementById("gate-root");
  document.getElementById("app").hidden = true;
  const ar = document.getElementById("admin-root"); if (ar) ar.hidden = true;
  root.innerHTML = `<div class="gate auth-layout">
    <div class="auth-pane"><div class="gate-card auth-card">
      <div class="auth-brandline">
        <div class="gate-mark" role="img" aria-label="Synottic"></div>
        <span class="auth-product">Synottic Prompt Intelligence</span>
      </div>
      ${inner}
    </div></div>
    ${authBrandAside()}
  </div>`;
  wirePwToggles(root);
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
  if (st.step === 1) {
    const root = authShell(`
      <h1>Create your account</h1>
      <p class="sub">Step 1 of 2 — the basics. Takes about a minute.</p>
      ${authTabs("signup")}
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
      <label class="auth-check" style="margin-top:14px;"><input type="checkbox" id="su-terms" ${d.agreeTerms ? "checked" : ""}/> I agree to the Terms &amp; Privacy Policy</label>
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
      else if (err.soft) fieldErr(root, "Couldn't reach the server. Try again.");
      else fieldErr(root, "Something went wrong creating your account.");
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
    <div class="gate-hint" style="text-align:center;"><button class="auth-link" id="vp-back">Back to sign in</button></div>`);
  root.querySelector("#vp-back").addEventListener("click", () => renderSignIn());
  const cont = root.querySelector("#vp-continue");
  if (cont) cont.addEventListener("click", () => bootApp());
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
    // verified — a session cookie was set. Load it and boot.
    const me = await AuthAPI.me().catch(() => null);
    if (me && me.authenticated) { applyUserSession(me); bootApp(); return; }
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
  if (!s.emailVerified) {
    try { if (sessionStorage.getItem("prompt-lib:vbanner-dismissed") === "1") return ""; } catch (e) {}
    return `<div class="verify-banner" id="verify-banner">
      <span>Please confirm your email address to activate your account and open the full library.</span>
      <span class="vb-actions">
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
  return "";
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
  const x = el.querySelector("#vb-x");
  if (x) x.addEventListener("click", () => { try { sessionStorage.setItem("prompt-lib:vbanner-dismissed", "1"); } catch (e) {} el.remove(); });
  const so = el.querySelector("#vb-signout");
  if (so) so.addEventListener("click", () => signOut());
  const refresh = el.querySelector("#vb-refresh");
  if (refresh) refresh.addEventListener("click", async () => {
    const me = await refreshAccess();
    if (me && me.authenticated) { applyUserSession(me); }
    if (typeof renderApp === "function") renderApp();
  });
}

/* ---- route detection, called from initApp ---- */
function authRoute() {
  const path = location.pathname || "";
  const qs = new URLSearchParams(location.search || "");
  if (/\/verify-email\/?$/.test(path)) return { name: "verify", token: qs.get("token") };
  if (/\/reset-password\/?$/.test(path)) return { name: "reset", token: qs.get("token") };
  if (/\/forgot-password\/?$/.test(path)) return { name: "forgot" };
  if (/\/admin\/login\/?$/.test(path) || location.hash === "#/admin/login") return { name: "adminLogin" };
  return null;
}
async function handleAuthRoute(r) {
  if (r.name === "verify") { r.token ? renderVerifyLanding(r.token) : renderSignIn("Missing confirmation token."); return true; }
  if (r.name === "reset") { r.token ? renderReset(r.token) : renderForgot(); return true; }
  if (r.name === "forgot") { renderForgot(); return true; }
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
