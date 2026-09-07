// ─────────────────────────────────────────────────────────────────────────────
// getUserAccess(user)  —  the ONE place account_status, email_verified and the
// entitlement are combined into an effective decision (spec §16). Frontend and
// backend both consume this shape; nothing else re-derives access rules.
// ─────────────────────────────────────────────────────────────────────────────
import { AI_LEVELS } from "./_validate.js";
import { FUNCTION_TOPICS } from "./_functions.js";

// Fallback feature catalogue — used when the DB table is empty or unreachable
// so gating still degrades sensibly. run_v2.mjs seeds the same rows.
export const DEFAULT_FEATURES = [
  { feature_key: "library.preview",     label: "Browse sample prompts",        public_ok: true,  requires_verified: false, requires_entitlement: false, sort: 10 },
  { feature_key: "account.manage",      label: "Manage your account",          public_ok: false, requires_verified: false, requires_entitlement: false, sort: 20 },
  { feature_key: "library.full",        label: "Full prompt library",          public_ok: false, requires_verified: true,  requires_entitlement: true,  sort: 30 },
  { feature_key: "prompt.copy",         label: "Copy / use protected prompts", public_ok: false, requires_verified: true,  requires_entitlement: true,  sort: 40 },
  { feature_key: "prompt.save",         label: "Save prompts",                 public_ok: false, requires_verified: true,  requires_entitlement: false, sort: 50 },
  { feature_key: "practice",            label: "Practice",                     public_ok: false, requires_verified: true,  requires_entitlement: true,  sort: 60 },
  { feature_key: "learning",            label: "Learn modules",                public_ok: false, requires_verified: true,  requires_entitlement: true,  sort: 70 },
  { feature_key: "my_program",          label: "My Program",                   public_ok: false, requires_verified: true,  requires_entitlement: true,  sort: 80 },
  { feature_key: "recommendations",     label: "Personalized recommendations", public_ok: false, requires_verified: true,  requires_entitlement: false, sort: 90 },
  { feature_key: "progress_tracking",   label: "Progress tracking",            public_ok: false, requires_verified: true,  requires_entitlement: false, sort: 100 },
  { feature_key: "advanced_ai",         label: "Advanced AI features",         public_ok: false, requires_verified: true,  requires_entitlement: true,  min_ai_level: "intermediate", sort: 110 },
];

let _featCache = null;
let _featCacheAt = 0;
export async function loadFeatures(sql) {
  if (_featCache && Date.now() - _featCacheAt < 60_000) return _featCache;
  try {
    const rows = await sql`select * from feature_permissions order by sort asc`;
    _featCache = rows.length ? rows : DEFAULT_FEATURES;
  } catch {
    _featCache = DEFAULT_FEATURES;
  }
  _featCacheAt = Date.now();
  return _featCache;
}

function levelIndex(l) {
  const i = AI_LEVELS.indexOf(String(l || "").toLowerCase());
  return i < 0 ? 0 : i;
}

// Lazily mark an expired entitlement and return the effective status.
async function effectiveEntitlement(sql, ent) {
  if (!ent) return null;
  const expired = ent.expires_at && new Date(ent.expires_at) < new Date();
  if (expired && ent.status === "active") {
    ent = { ...ent, status: "expired" };
    sql`update entitlements set status = 'expired', updated_at = now() where id = ${ent.id}`.catch(() => {});
    sql`insert into entitlement_events (user_id, actor, action, detail)
        values (${ent.user_id}, 'system', 'expired', ${JSON.stringify({ at: new Date().toISOString() })})`.catch(() => {});
  }
  return ent;
}

export async function getUserAccess(sql, user) {
  const features = await loadFeatures(sql);

  // ---- anonymous ----
  if (!user) {
    const map = {}, reasons = {};
    for (const f of features) {
      map[f.feature_key] = !!f.public_ok;
      if (!f.public_ok) reasons[f.feature_key] = "sign_in";
    }
    return {
      authenticated: false,
      emailVerified: false,
      accountStatus: "anonymous",
      access: { status: "none", scopeType: "none", programIds: [], licenseType: null, expiresAt: null, active: false },
      programs: [],
      features: map,
      reasons,
      personalization: { tier: "guest", headline: "Sign in to open your library", cta: "Create your account" },
    };
  }

  let ent = null, enrollments = [];
  try {
    const [eRows, pRows] = await Promise.all([
      sql`select * from entitlements where user_id = ${user.id} limit 1`,
      sql`select program_id from program_enrollments where user_id = ${user.id} and status = 'active'`,
    ]);
    ent = eRows[0] || null;
    enrollments = pRows.map((r) => r.program_id);
  } catch { /* degrade to no-entitlement */ }
  ent = await effectiveEntitlement(sql, ent);

  const blocked = user.account_status === "suspended" || user.account_status === "disabled";
  const verified = !!user.email_verified && user.account_status === "active";
  const entActive = !!ent && ent.status === "active" && ent.scope_type !== "none";
  const flags = (ent && ent.feature_flags) || {};
  const userLevel = levelIndex(user.ai_level);

  const map = {}, reasons = {};
  for (const f of features) {
    let allow;
    if (blocked) {
      allow = f.feature_key === "account.manage";
      if (!allow) reasons[f.feature_key] = "account_" + user.account_status;
    } else if (Object.prototype.hasOwnProperty.call(flags, f.feature_key)) {
      allow = !!flags[f.feature_key];                 // explicit admin override wins
      if (!allow) reasons[f.feature_key] = "not_granted";
    } else if (f.public_ok) {
      allow = true;
    } else if (!verified) {
      allow = f.requires_verified === false;          // partial access for unverified (spec §4)
      if (!allow) reasons[f.feature_key] = "verify_email";
    } else if (f.requires_entitlement && !entActive) {
      allow = false;
      reasons[f.feature_key] = "no_access";
    } else if (f.min_ai_level && userLevel < levelIndex(f.min_ai_level)) {
      allow = false;
      reasons[f.feature_key] = "ai_level";
    } else {
      allow = true;
    }
    map[f.feature_key] = allow;
  }

  // For a curated scope (function / collection) the entitlement's own
  // program_ids are authoritative — stale program_enrollments from a previous
  // scope must not widen a curated library.
  // A curated scope (function / collection) carries its own program / category /
  // prompt lists on the entitlement; stale program_enrollments from a previous
  // scope must not widen it.
  const curated = ent && ["function", "collection"].includes(ent.scope_type);
  const programIds = ent && ent.scope_type === "full"
    ? "*"
    : curated
      ? Array.from(new Set(ent.program_ids || []))
      : Array.from(new Set([...(ent && ent.program_ids || []), ...enrollments]));

  const categoryIds = curated && Array.isArray(ent.category_ids) ? ent.category_ids : [];
  const promptIds = curated && Array.isArray(ent.prompt_ids) ? ent.prompt_ids : [];

  return {
    authenticated: true,
    userId: user.id,
    email: user.email,
    name: [user.first_name, user.last_name].filter(Boolean).join(" ") || "Learner",
    firstName: user.first_name || "there",
    role: user.role,
    aiLevel: user.ai_level,
    org: user.org_name || (ent && ent.org_name) || "",
    emailVerified: !!user.email_verified,
    accountStatus: user.account_status,
    access: {
      status: ent ? ent.status : "none",
      scopeType: ent ? ent.scope_type : "none",
      programIds,
      categoryIds,
      promptIds,
      licenseType: ent ? ent.license_type : null,
      expiresAt: ent ? ent.expires_at : null,
      source: ent ? ent.source : null,
      active: entActive && !blocked,
    },
    programs: programIds,
    features: map,
    reasons,
    personalization: personalize(user, { verified, entActive, blocked }),
  };
}

export function can(access, featureKey) {
  return !!(access && access.features && access.features[featureKey]);
}

// Learner-safe personalization payload (spec §7). No jargon.
function personalize(user, { verified, entActive, blocked }) {
  const level = String(user.ai_level || "beginner").toLowerCase();
  const beginner = level === "beginner" || level === "foundational";
  const tier = blocked ? "blocked" : !verified ? "unverified" : !entActive ? "basic" : "full";
  const headline = blocked
    ? "Your account is on hold"
    : !verified
      ? "Confirm your email to activate your library"
      : !entActive
        ? "Setting up your library…"
        : beginner
          ? "What do you want to learn?"
          : "What do you want to accomplish?";
  return {
    tier,
    level,
    headline,
    cta: !verified ? "Resend confirmation email" : null,
    suggestedTopics: FUNCTION_TOPICS[user.role] || FUNCTION_TOPICS.general,
    style: beginner ? "guided" : "outcome",
  };
}
