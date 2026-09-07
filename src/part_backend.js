/* ---------- Backend bridge ----------
   Talks to the Vercel /api functions (Neon Postgres) when they're reachable.
   Everything is best-effort: if the API is missing (static-only host, file://,
   offline) every method fails soft and the app falls back to the local
   localStorage / claude-db paths exactly as before. */
const Backend = (function () {
  const BASE = (typeof location !== "undefined" && /^https?:$/.test(location.protocol)) ? "/api" : null;
  let available = null;          // null = unknown, true/false once probed
  let sessionToken = null;
  let adminToken = null;
  try { sessionToken = sessionStorage.getItem("prompt-lib:token") || null; } catch (e) {}
  try { adminToken = sessionStorage.getItem("prompt-lib:admin-token") || null; } catch (e) {}

  function csrfCookie() {
    try { return (document.cookie.match(/(?:^|;\s*)syn_csrf=([^;]+)/) || [])[1] || null; } catch (e) { return null; }
  }
  async function call(path, { method = "GET", body, token } = {}) {
    if (!BASE || available === false) { const e = new Error("no-backend"); e.soft = true; throw e; }
    let res;
    try {
      const headers = Object.assign({ "content-type": "application/json" }, token ? { authorization: "Bearer " + token } : {});
      if (method !== "GET") { const c = csrfCookie(); if (c) headers["x-csrf-token"] = decodeURIComponent(c); }
      res = await fetch(BASE + path, { method, headers, credentials: "same-origin",
        body: body ? JSON.stringify(body) : undefined });
    } catch (netErr) {
      available = false; const e = new Error("network"); e.soft = true; throw e;
    }
    const ct = res.headers.get("content-type") || "";
    let data = null;
    if (ct.includes("application/json")) { try { data = await res.json(); } catch (e) {} }
    // A real API response is JSON. Anything else (Vercel/static 404 HTML, a
    // 501 from a plain file server, a proxy error page) means "no backend".
    if (!data) {
      if (res.status === 202 || res.status === 204) { available = true; return {}; }
      available = false; const e = new Error("no-backend"); e.soft = true; throw e;
    }
    available = true;
    if (!res.ok) { const e = new Error(data.error || ("http-" + res.status)); e.status = res.status; e.data = data; throw e; }
    return data;
  }

  return {
    get available() { return available === true; },
    isConfigured: () => !!BASE,
    hasSession: () => !!sessionToken,
    hasAdmin: () => !!adminToken,

    async previewCode(code) {
      try {
        const d = await call("/session", { method: "POST", body: { code, preview: true } });
        return d && d.resolved ? d.resolved : null;
      } catch (e) { if (e.soft) return undefined; return null; }   // undefined => backend absent, null => unknown code
    },

    async redeem(code, name) {
      const d = await call("/session", { method: "POST", body: { code, name } });
      sessionToken = d.token;
      try { sessionStorage.setItem("prompt-lib:token", sessionToken); } catch (e) {}
      return d.session;
    },
    clearSession() {
      sessionToken = null;
      try { sessionStorage.removeItem("prompt-lib:token"); } catch (e) {}
    },

    async getState(keys) {
      if (!sessionToken) return null;
      try { return await call("/state?keys=" + encodeURIComponent((keys || []).join(",")), { token: sessionToken }); }
      catch (e) { if (e.status === 401) return { __revoked: true }; return null; }
    },
    async putState(states) {
      if (!sessionToken || !available) return false;
      try { await call("/state", { method: "PUT", body: { states }, token: sessionToken }); return true; }
      catch (e) { return false; }
    },
    logActivity(event, promptId, meta) {
      if (!sessionToken || available === false || !BASE) return;
      try {
        fetch(BASE + "/activity", {
          method: "POST", keepalive: true,
          headers: { "content-type": "application/json", authorization: "Bearer " + sessionToken },
          body: JSON.stringify({ event, promptId: promptId || null, meta: meta || {} }),
        }).catch(() => {});
      } catch (e) {}
    },

    async adminLogin(key) {
      const d = await call("/admin/login", { method: "POST", body: { key } });
      adminToken = d.token;
      try { sessionStorage.setItem("prompt-lib:admin-token", adminToken); } catch (e) {}
      return true;
    },
    // true for the legacy HMAC token OR the unified-login admin cookie
    // (marked in sessionStorage; the httpOnly cookie itself isn't readable).
    adminAuthed() {
      if (adminToken) return true;
      try { return sessionStorage.getItem("prompt-lib:admin-ok") === "1"; } catch (e) { return false; }
    },
    clearAdmin() {
      adminToken = null;
      try { sessionStorage.removeItem("prompt-lib:admin-token"); } catch (e) {}
      try { sessionStorage.removeItem("prompt-lib:admin-ok"); } catch (e) {}
      try { sessionStorage.removeItem("prompt-lib:admin-role"); } catch (e) {}
    },
    async adminCodes() {
      const d = await call("/admin/codes", { token: adminToken });
      return (d && d.codes) || [];
    },
    async adminSaveCode(rec, isNew) {
      const d = await call("/admin/codes", { method: isNew ? "POST" : "PATCH", body: rec, token: adminToken });
      return d && d.code;
    },
    async adminDeleteCode(id) {
      await call("/admin/codes?id=" + encodeURIComponent(id), { method: "DELETE", token: adminToken });
      return true;
    },
    async adminAnalytics(days) {
      return call("/admin/analytics?days=" + (days || 30), { token: adminToken });
    },
    // ---- per-function library scope (Function access tab) ----
    async adminFunctions() {
      const d = await call("/admin/functions", { token: adminToken });
      return (d && d.functions) || [];
    },
    async adminSaveFunction(rec) {
      const d = await call("/admin/functions", { method: "POST", body: Object.assign({ action: "save" }, rec), token: adminToken });
      return d && d.scope;
    },
    async adminResetFunction(functionKey) {
      await call("/admin/functions", { method: "POST", body: { action: "reset", functionKey }, token: adminToken });
      return true;
    },
    async adminReapplyFunction(functionKey) {
      const d = await call("/admin/functions", { method: "POST", body: { action: "reapply", functionKey }, token: adminToken });
      return (d && d.reapplied) || 0;
    },
    // ---- per-organization curated collections + their access codes ----
    async adminCollections() {
      const d = await call("/admin/collections", { token: adminToken });
      return (d && d.collections) || [];
    },
    async adminSaveCollection(rec) {
      const action = rec.id ? "update" : "create";
      const d = await call("/admin/collections", { method: "POST", body: Object.assign({ action }, rec), token: adminToken });
      return d && d.collection;
    },
    async adminDeleteCollection(id) {
      return call("/admin/collections", { method: "POST", body: { action: "delete", id }, token: adminToken });
    },
    async adminGenerateCollectionCode(id, opts) {
      const d = await call("/admin/collections", { method: "POST", body: Object.assign({ action: "generate_code", id }, opts || {}), token: adminToken });
      return d && d.code;
    },
    // access_codes lifecycle (rename / disable / seat limit / expiry / re-scope)
    async adminPatchAccessCode(codeId, fields) {
      const d = await call("/admin/entitlements", { method: "PATCH", body: Object.assign({ codeId }, fields), token: adminToken });
      return d && d.code;
    },
    async adminDeleteAccessCode(codeId) {
      return call("/admin/entitlements?codeId=" + encodeURIComponent(codeId), { method: "DELETE", token: adminToken });
    },
    // ---- User Management console ----
    async adminUsers(params) {
      const qs = new URLSearchParams();
      Object.entries(params || {}).forEach(([k, v]) => { if (v !== "" && v != null) qs.set(k, v); });
      return call("/admin/users?" + qs.toString(), { token: adminToken });
    },
    async adminUser(id) {
      return call("/admin/users?id=" + encodeURIComponent(id), { token: adminToken });
    },
    async adminUserAction(id, action, extra) {
      const d = await call("/admin/users", { method: "PATCH", body: Object.assign({ id, action }, extra || {}), token: adminToken });
      return d && d.user;
    },
    async adminUserCreate(body) {
      const d = await call("/admin/users", { method: "POST", body: Object.assign({ action: "create" }, body), token: adminToken });
      return d && d.user;
    },
    async adminUsersBulk(ids, subAction, extra) {
      const d = await call("/admin/users", { method: "POST", body: Object.assign({ action: "bulk", ids, subAction }, extra || {}), token: adminToken });
      return (d && d.results) || [];
    },
    async adminUserDelete(id, hard) {
      return call("/admin/users?id=" + encodeURIComponent(id) + (hard ? "&hard=1" : ""), { method: "DELETE", token: adminToken });
    },
    async adminEntitlement(userId) {
      return call("/admin/entitlements?userId=" + encodeURIComponent(userId), { token: adminToken });
    },
    async adminEntitlementAction(body) {
      return call("/admin/entitlements", { method: "POST", body, token: adminToken });
    },
    async adminAudit(params) {
      const qs = new URLSearchParams(params || {});
      return call("/admin/audit?" + qs.toString(), { token: adminToken });
    },
  };
})();
