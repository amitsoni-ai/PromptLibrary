// Transactional email: a pluggable sender + Synottic-branded templates.
//
//   EMAIL_TRANSPORT = console | resend        (default: console)
//   EMAIL_FROM      = "Synottic <noreply@synottic.com>"
//   RESEND_API_KEY  = re_...                   (when transport = resend)
//   APP_BASE_URL    = https://library.synottic.com   (for link building)
//
// `console` transport prints the message and pushes it to an in-memory outbox
// (`__outbox`) so local tests can assert on it. No dependency is required for
// any transport.

const BRAND = {
  name: "Synottic Prompt Library",
  org: "Synottic AI Institute",
  tagline: "Human-Centred AI Transformation",
  accent: "#4338CA",
  ink: "#0F172A",
  muted: "#64748B",
};

export const __outbox = [];

export function appBaseUrl(req) {
  if (process.env.APP_BASE_URL) return process.env.APP_BASE_URL.replace(/\/$/, "");
  const proto = (req && (req.headers["x-forwarded-proto"] || "")) || "https";
  const host = req && (req.headers["x-forwarded-host"] || req.headers.host);
  return host ? `${proto}://${host}` : "http://localhost:8790";
}

function shell(title, bodyHtml) {
  return `<!doctype html><html><body style="margin:0;background:#F1F5F9;padding:32px 0;font-family:-apple-system,Segoe UI,Roboto,Helvetica,Arial,sans-serif;">
  <table role="presentation" width="100%" cellpadding="0" cellspacing="0"><tr><td align="center">
    <table role="presentation" width="480" cellpadding="0" cellspacing="0" style="width:480px;max-width:92vw;background:#fff;border:1px solid #E2E8F0;border-radius:14px;overflow:hidden;">
      <tr><td style="padding:22px 28px;border-bottom:1px solid #EEF2F7;">
        <span style="font-size:15px;font-weight:700;color:${BRAND.ink};letter-spacing:-.01em;">Synottic</span>
        <span style="font-size:12px;color:${BRAND.muted};"> &nbsp;·&nbsp; ${BRAND.tagline}</span>
      </td></tr>
      <tr><td style="padding:28px;color:${BRAND.ink};font-size:15px;line-height:1.6;">
        <h1 style="margin:0 0 14px;font-size:19px;font-weight:700;">${title}</h1>
        ${bodyHtml}
      </td></tr>
      <tr><td style="padding:18px 28px;border-top:1px solid #EEF2F7;color:${BRAND.muted};font-size:12px;line-height:1.5;">
        ${BRAND.org} · ${BRAND.name}<br>
        You received this because an account action was requested for this address. If it wasn't you, you can ignore this email.
      </td></tr>
    </table>
  </td></tr></table></body></html>`;
}

function button(href, label) {
  return `<p style="margin:22px 0;"><a href="${href}" style="display:inline-block;background:${BRAND.accent};color:#fff;text-decoration:none;font-weight:600;font-size:14px;padding:11px 20px;border-radius:9px;">${label}</a></p>
  <p style="margin:0 0 4px;font-size:12px;color:${BRAND.muted};">If the button doesn't work, paste this link into your browser:</p>
  <p style="margin:0;font-size:12px;word-break:break-all;"><a href="${href}" style="color:${BRAND.accent};">${href}</a></p>`;
}

// name -> ({ ...vars }) -> { subject, html, text }
export const TEMPLATES = {
  welcome: (v) => ({
    subject: `Welcome to ${BRAND.name}`,
    html: shell(`Welcome, ${esc(v.firstName)}`,
      `<p>Your ${BRAND.name} account is created. One quick step is left — confirm your email so we can open your library.</p>
       ${button(v.verifyUrl, "Confirm my email")}`),
    text: `Welcome, ${v.firstName}. Confirm your email to open your library: ${v.verifyUrl}`,
  }),
  verify_email: (v) => ({
    subject: "Confirm your email",
    html: shell("Confirm your email",
      `<p>Use the link below to confirm <b>${esc(v.email)}</b>. It expires in ${v.expiresHours} hours and can be used once.</p>
       ${button(v.verifyUrl, "Confirm my email")}`),
    text: `Confirm your email (${v.email}). Link (expires in ${v.expiresHours}h, single use): ${v.verifyUrl}`,
  }),
  verification_reminder: (v) => ({
    subject: "Reminder: confirm your email to unlock your library",
    html: shell("Just one step left",
      `<p>Your account is ready, but a few features stay locked until your email is confirmed.</p>
       ${button(v.verifyUrl, "Confirm my email")}`),
    text: `Confirm your email to unlock your library: ${v.verifyUrl}`,
  }),
  access_granted: (v) => ({
    subject: "Your library access is ready",
    html: shell("You're all set",
      `<p>${esc(v.grantSummary || "Access has been added to your account")}. Sign in to open the full library, Learn and Practice.</p>
       ${button(v.loginUrl, "Open my library")}`),
    text: `Access added to your account. Sign in: ${v.loginUrl}`,
  }),
  password_reset: (v) => ({
    subject: "Reset your password",
    html: shell("Reset your password",
      `<p>We received a request to reset the password for <b>${esc(v.email)}</b>. This link expires in ${v.expiresMinutes} minutes and can be used once. If you didn't ask for this, ignore this email — your password won't change.</p>
       ${button(v.resetUrl, "Choose a new password")}`),
    text: `Reset your password (expires in ${v.expiresMinutes} min, single use): ${v.resetUrl}`,
  }),
  account_suspended: (v) => ({
    subject: "Your account access is on hold",
    html: shell("Account on hold",
      `<p>Access for <b>${esc(v.email)}</b> has been paused${v.reason ? `: ${esc(v.reason)}` : ""}. Reach your programme lead to restore it.</p>`),
    text: `Your account access is on hold${v.reason ? ": " + v.reason : ""}.`,
  }),
  access_expiring: (v) => ({
    subject: "Your library access is expiring soon",
    html: shell("Access expiring soon",
      `<p>Your access ends on <b>${esc(v.expiresOn)}</b> (${v.daysLeft} days left). Contact your programme lead to extend it.</p>
       ${button(v.loginUrl, "Open my library")}`),
    text: `Your access expires on ${v.expiresOn} (${v.daysLeft} days left).`,
  }),
};

function esc(s) {
  return String(s == null ? "" : s).replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]));
}

const isProdEnv = () => process.env.VERCEL_ENV === "production" || process.env.NODE_ENV === "production";

// Resend needs a verified sending domain. A brand-new key has none, so it will
// ONLY accept from `onboarding@resend.dev` and ONLY to the account owner's
// address. Default to that; override with EMAIL_FROM once your domain is
// verified in the Resend dashboard.
function fromAddress() {
  return process.env.EMAIL_FROM
    || (((process.env.EMAIL_TRANSPORT || "").toLowerCase() === "resend") ? "Synottic <onboarding@resend.dev>" : "Synottic <noreply@synottic.local>");
}

async function deliver(to, msg) {
  const transport = (process.env.EMAIL_TRANSPORT || "console").toLowerCase();
  const from = fromAddress();

  // Always keep a local copy (outside production) so the dev outbox / verify
  // banner shortcut still works even if the provider rejects the message.
  if (!isProdEnv()) __outbox.push({ to, ...msg, from, transport, ts: Date.now() });

  if (transport === "resend") {
    const key = process.env.RESEND_API_KEY;
    if (!key) throw new Error("RESEND_API_KEY missing");
    const r = await fetch("https://api.resend.com/emails", {
      method: "POST",
      headers: { authorization: `Bearer ${key}`, "content-type": "application/json" },
      body: JSON.stringify({ from, to: [to], subject: msg.subject, html: msg.html, text: msg.text }),
    });
    const bodyText = await r.text().catch(() => "");
    if (!r.ok) {
      console.error(`✉  resend ${r.status} from=${from} to=${to} :: ${bodyText}`);
      throw new Error(`resend-${r.status} ${bodyText}`);
    }
    let id = null; try { id = JSON.parse(bodyText).id || null; } catch {}
    if (process.env.EMAIL_SILENT !== "1") console.log(`✉  resend ok id=${id} from=${from} -> ${to} [${msg.subject}]`);
    return { transport, id, from };
  }

  // console (default)
  if (process.env.EMAIL_SILENT !== "1") {
    console.log(`\n✉  [${msg.subject}] -> ${to}\n   ${msg.text}\n`);
  }
  return { transport: "console", id: null, from };
}

// sendEmail("verify_email", "a@b.com", { verifyUrl, email, expiresHours })
export async function sendEmail(template, to, vars) {
  const build = TEMPLATES[template];
  if (!build) throw new Error("unknown-template:" + template);
  const msg = build(vars || {});
  try {
    const res = await deliver(to, msg);
    return { ok: true, ...res };
  } catch (e) {
    console.error("email send failed", template, String(e && e.message || e));
    return { ok: false, error: String(e && e.message || e) };
  }
}
