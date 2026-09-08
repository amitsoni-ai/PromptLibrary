/* =========================================================================
   ADMIN CONSOLE
   Create/manage organisation access codes, map them to domain / industry /
   functions / roles / programs, control program access, enable/disable,
   and export the matching prompts as a real .xlsx (dependency-free writer).
   Admin-created codes live in AdminStore (db capability if present, else
   localStorage — shared, NOT learner-namespaced) and are merged into
   resolveAccessCode so learners can sign in with them.
   ========================================================================= */

/* ---------- Taxonomy (seed; the SharePoint functions/roles catalogue can be
   pasted in here — see FUNCTIONS below). Everything an admin picks from. */
const INDUSTRIES = [
  "Technology & SaaS", "Financial Services", "Healthcare & Life Sciences",
  "Manufacturing & Industrial", "Retail & E-commerce", "Professional Services & Consulting",
  "Education", "Media & Entertainment", "Energy & Utilities", "Public Sector & Nonprofit",
  "Real Estate & Construction", "Transportation & Logistics", "Telecommunications",
  "Hospitality & Travel", "Agriculture", "Other",
];

/* The Synottic "AI for Functions" catalogue. Each function ->
   { library categories it draws prompts from, target roles (from the
   course outlines), and the matching Synottic program id }. */
const FUNCTIONS = {
  "Sales": { program: "prog-syn-sales", categories: ["Sales & Lead Generation", "Communication & Leadership", "Email Marketing"], roles: ["Chief Sales Officer", "Sales Director", "Sales Manager", "Business Development Manager", "Account Manager", "Key Account Manager", "Sales Executive", "Inside Sales", "Enterprise Sales", "Customer Success Manager", "Pre-Sales Consultant", "Sales Operations", "Revenue Operations (RevOps)"] },
  "Marketing": { program: "prog-syn-marketing", categories: ["Marketing & Branding", "Social Media", "Email Marketing", "SEO & Analytics", "Content Writing & Copywriting"], roles: ["CMO", "Marketing Director", "Brand Manager", "Content Marketer", "Growth Marketer", "SEO Specialist", "Social Media Manager", "Lifecycle / Email Marketer", "Marketing Operations", "Product Marketer", "PR & Communications"] },
  "HR": { program: "prog-syn-hr", categories: ["HR & Recruiting", "Career Growth", "Coaching & Self-Development", "Communication & Leadership"], roles: ["HR Director", "HR Manager", "Talent Acquisition Specialist", "Recruiter", "HR Business Partner", "Talent Management", "Employee Experience Team", "Organisational Development", "People Analytics Specialist", "HR Operations"] },
  "L&D": { program: "prog-syn-ld", categories: ["Education & Learning", "Coaching & Self-Development", "HR & Recruiting"], roles: ["L&D Director", "L&D Manager", "Instructional Designer", "Learning Experience Designer", "Corporate Trainer", "Facilitator", "Capability Building Lead", "Talent Development Partner"] },
  "Finance & Accounting": { program: "prog-syn-finance", categories: ["Finance & Accounting", "Research & Data Analysis"], roles: ["CFO", "Finance Director", "Financial Controller", "FP&A Analyst", "Accountant", "Management Accountant", "Treasury", "Finance Business Partner", "Audit & Assurance"] },
  "Legal & Compliance": { program: "prog-syn-legal", categories: ["Legal & Compliance"], roles: ["General Counsel", "Legal Counsel", "Contracts Manager", "Compliance Officer", "Privacy / DPO", "Company Secretary", "Paralegal", "Regulatory Affairs"] },
  "IT & Engineering": { program: "prog-syn-it-eng", categories: ["Coding & Tech", "Productivity & Automation", "AI & Prompt Engineering"], roles: ["CTO", "Engineering Manager", "Software Engineer", "DevOps / SRE", "QA Engineer", "Solutions Architect", "IT Support Lead", "Platform Engineer", "Security Engineer"] },
  "Product Management": { program: "prog-syn-product", categories: ["Product Management", "UX/UI Design", "Research & Data Analysis"], roles: ["Head of Product", "Product Manager", "Product Owner", "Technical Product Manager", "Product Marketing Manager", "UX Researcher", "Product Designer", "Product Operations"] },
  "Project & Program Management": { program: "prog-syn-ppm", categories: ["Business Strategy", "Productivity & Automation", "Communication & Leadership"], roles: ["Programme Director", "Project Manager", "Programme Manager", "Scrum Master", "Delivery Lead", "PMO Analyst", "Portfolio Manager", "Agile Coach"] },
  "Customer Service": { program: "prog-syn-customer-service", categories: ["Customer Support"], roles: ["Head of Customer Support", "Support Team Lead", "Support Agent", "CX Manager", "Knowledge Base Manager", "Quality Analyst", "Community Manager"] },
  "Data & Business Analysis": { program: "prog-syn-data-analyst", categories: ["Research & Data Analysis", "SEO & Analytics"], roles: ["Head of Analytics", "Data Analyst", "Business Analyst", "BI Analyst", "Data Scientist", "Insights Manager", "Reporting Analyst"] },
  "Operations & Supply Chain": { program: "prog-syn-operations", categories: ["Productivity & Automation", "Business Strategy"], roles: ["COO", "Operations Director", "Operations Manager", "Supply Chain Manager", "Logistics Manager", "Process Improvement Lead", "S&OP Planner", "Warehouse Manager"] },
  "Procurement": { program: "prog-syn-procurement", categories: ["Finance & Accounting", "Legal & Compliance", "Business Strategy"], roles: ["CPO", "Procurement Director", "Procurement Manager", "Category Manager", "Buyer", "Sourcing Specialist", "Vendor Manager", "Contracts & Compliance Analyst"] },
};
const FUNCTION_NAMES = Object.keys(FUNCTIONS);
const CATEGORY_TO_FUNCTIONS = (function () {
  const m = {};
  for (const fn of FUNCTION_NAMES) for (const c of FUNCTIONS[fn].categories) (m[c] = m[c] || []).push(fn);
  return m;
})();
function functionsForCategory(cat) { return (CATEGORY_TO_FUNCTIONS[cat] || []).join("; "); }
function categoriesForFunctions(fns) {
  const s = new Set();
  (fns || []).forEach((f) => (FUNCTIONS[f] ? FUNCTIONS[f].categories : []).forEach((c) => s.add(c)));
  return s;
}
function rolesGroupedByFunction() { return FUNCTION_NAMES.map((f) => ({ fn: f, roles: FUNCTIONS[f].roles })); }
const ALL_ROLES = Array.from(new Set(FUNCTION_NAMES.flatMap((f) => FUNCTIONS[f].roles)));

/* Bridge: signup / users.role use snake keys (api/_functions.js); this maps them
   to the display keys of the FUNCTIONS catalogue above. Used by the learner
   scoping path (part_app_2 scopedLibrary) as a no-DB / pre-v3 fallback for a
   function learner's browsable categories. */
const FUNCTION_SNAKE_TO_NAME = {
  sales: "Sales", marketing: "Marketing", hr: "HR", learning_dev: "L&D",
  finance: "Finance & Accounting", legal: "Legal & Compliance", it_engineering: "IT & Engineering",
  product: "Product Management", project_program: "Project & Program Management",
  customer_service: "Customer Service", data_analysis: "Data & Business Analysis",
  operations: "Operations & Supply Chain", procurement: "Procurement",
};
function functionScopeCategories(snakeKey) {
  const name = FUNCTION_SNAKE_TO_NAME[String(snakeKey || "").toLowerCase()];
  return name && FUNCTIONS[name] ? FUNCTIONS[name].categories.slice() : [];
}

/* ---------- Admin persistence (shared, not per-learner) ---------- */
const ADMIN_KEY_DEFAULT = "SYNOTTIC-ADMIN";
const AdminStore = (function () {
  let db = null;
  let mode = "local";            // 'neon' | 'db' | 'local'
  let cfg = { codes: [], adminKey: ADMIN_KEY_DEFAULT };

  async function init() {
    // 1) Neon /api — the deployed source of truth for admin codes.
    if (typeof Backend !== "undefined" && Backend.isConfigured() && Backend.adminAuthed()) {
      try {
        cfg.codes = await Backend.adminCodes();
        mode = "neon";
        return;
      } catch (e) { /* fall through to local */ }
    }
    // 2) claude db capability
    try { if (window.claude && typeof window.claude.use === "function") db = await window.claude.use("db"); }
    catch (e) { db = null; }
    if (db) {
      try { const d = await db.doc("admin/config").get(); if (d.exists) cfg = Object.assign(cfg, d.data()); mode = "db"; }
      catch (e) { db = null; }
    }
    if (mode === "local") {
      try { const v = localStorage.getItem("prompt-lib:admin"); if (v) cfg = Object.assign(cfg, JSON.parse(v)); } catch (e) {}
    }
    if (!Array.isArray(cfg.codes)) cfg.codes = [];
    // Merge the built-in seed codes not already present (local/db only — the
    // migration seeds them into Neon).
    try {
      const el = document.getElementById("data-admin-seed");
      if (el) {
        const seed = JSON.parse(el.textContent);
        const have = new Set(cfg.codes.map((c) => c.code.toUpperCase()));
        let added = false;
        seed.forEach((s) => { if (!have.has(s.code.toUpperCase())) { cfg.codes.push(s); added = true; } });
        if (added) persistLocal();
      }
    } catch (e) {}
  }
  async function reload() {
    if (mode === "neon") { try { cfg.codes = await Backend.adminCodes(); } catch (e) {} }
  }
  function persistLocal() {
    if (db) db.doc("admin/config").set(cfg).catch(() => {});
    else { try { localStorage.setItem("prompt-lib:admin", JSON.stringify(cfg)); } catch (e) {} }
  }

  return {
    init, reload,
    backend: () => mode,
    key: () => cfg.adminKey || ADMIN_KEY_DEFAULT,
    getCodes: () => cfg.codes.slice(),
    getCode: (code) => cfg.codes.find((c) => c.code.toUpperCase() === String(code || "").toUpperCase().trim()),
    getById: (id) => cfg.codes.find((c) => c.id === id),
    upsert(rec) {
      const i = cfg.codes.findIndex((c) => c.id === rec.id);
      const isNew = i < 0;
      if (isNew) cfg.codes.unshift(rec); else cfg.codes[i] = rec;
      if (mode === "neon") Backend.adminSaveCode(rec, isNew).then((saved) => {
        if (saved) { const j = cfg.codes.findIndex((c) => c.id === saved.id || c.id === rec.id); if (j >= 0) cfg.codes[j] = saved; }
      }).catch(() => showToast("Couldn't save to the server"));
      else persistLocal();
    },
    remove(id) {
      cfg.codes = cfg.codes.filter((c) => c.id !== id);
      if (mode === "neon") Backend.adminDeleteCode(id).catch(() => showToast("Couldn't delete on the server"));
      else persistLocal();
    },
    setEnabled(id, on) {
      const c = cfg.codes.find((x) => x.id === id);
      if (!c) return;
      c.enabled = on;
      if (mode === "neon") Backend.adminSaveCode({ id, enabled: on }, false).catch(() => showToast("Couldn't update on the server"));
      else persistLocal();
    },
  };
})();

/* ---------- Prompt selection for an admin code / a manual filter set ---------- */
function promptsForSelection(sel) {
  sel = sel || {};
  let fns = (sel.functions || []).slice();
  let roles = (sel.roles || []).slice();
  let programIds = (sel.programIds || []).slice();
  if (sel.programId) programIds = [sel.programId];

  let list = ALL_PROMPTS.slice();
  const cats = categoriesForFunctions(fns);
  const linked = new Set();
  programIds.forEach((pid) => programPromptIds(pid).forEach((id) => linked.add(id)));
  // each selected function also carries its Synottic course program
  fns.forEach((f) => { const p = FUNCTIONS[f] && FUNCTIONS[f].program; if (p) programPromptIds(p).forEach((id) => linked.add(id)); });

  if (programIds.length && cats.size) {
    list = list.filter((r) => linked.has(r.id) || cats.has(r.category));
  } else if (programIds.length) {
    list = list.filter((r) => linked.has(r.id));
  } else if (cats.size) {
    list = list.filter((r) => cats.has(r.category));
  }

  // Role refinement is applied only if it leaves a usable set — the library's
  // role metadata is coarse, so a hard role filter would often zero out.
  if (roles.length) {
    const keys = roles.map((x) => x.toLowerCase().split(/[\/,]/)[0].trim()).filter((x) => x.length > 2);
    const refined = list.filter((r) => {
      const hay = ((r.role || "") + " " + (r.skill || "") + " " + (r.tags || []).join(" ")).toLowerCase();
      return keys.some((k) => hay.includes(k));
    });
    if (refined.length >= 5) list = refined;
  }
  list = list.filter((r) => r.lifecycle !== "Archived");
  list.sort((a, b) => b.qualityScore - a.qualityScore);
  return list;
}
function selectionSummary(sel) {
  const bits = [];
  if (sel.orgName) bits.push(sel.orgName);
  if (sel.industry) bits.push(sel.industry);
  if (sel.domain) bits.push(sel.domain);
  if ((sel.functions || []).length) bits.push((sel.functions).join(", "));
  if ((sel.roles || []).length) bits.push("roles: " + sel.roles.join(", "));
  if (sel.programId) bits.push("program: " + ((ORG_INDEX.programs[sel.programId] || {}).name || sel.programId));
  else if ((sel.programIds || []).length) bits.push((sel.programIds).map((p) => (ORG_INDEX.programs[p] || {}).name || p).join(", "));
  return bits.join(" · ") || "Whole library";
}

/* ---------- Dependency-free .xlsx writer (ZIP "store" + minimal SpreadsheetML) ---------- */
const _CRC_TABLE = (function () {
  const t = new Uint32Array(256);
  for (let n = 0; n < 256; n++) { let c = n; for (let k = 0; k < 8; k++) c = c & 1 ? (0xEDB88320 ^ (c >>> 1)) : (c >>> 1); t[n] = c >>> 0; }
  return t;
})();
function _crc32(bytes) {
  let c = 0xFFFFFFFF;
  for (let i = 0; i < bytes.length; i++) c = _CRC_TABLE[(c ^ bytes[i]) & 0xFF] ^ (c >>> 8);
  return (c ^ 0xFFFFFFFF) >>> 0;
}
function _u16(n) { return [n & 0xFF, (n >>> 8) & 0xFF]; }
function _u32(n) { return [n & 0xFF, (n >>> 8) & 0xFF, (n >>> 16) & 0xFF, (n >>> 24) & 0xFF]; }
function _zipStore(files) {
  const DOS_TIME = 0, DOS_DATE = (1 << 5) | 1; // 1980-01-01
  const local = [], central = [];
  let offset = 0;
  const enc = new TextEncoder();
  for (const f of files) {
    const nameBytes = enc.encode(f.name);
    const data = f.data;
    const crc = _crc32(data);
    const lfh = [].concat([0x50, 0x4b, 0x03, 0x04], _u16(20), _u16(0), _u16(0),
      _u16(DOS_TIME), _u16(DOS_DATE), _u32(crc), _u32(data.length), _u32(data.length),
      _u16(nameBytes.length), _u16(0));
    local.push(new Uint8Array(lfh), nameBytes, data);
    const cdh = [].concat([0x50, 0x4b, 0x01, 0x02], _u16(20), _u16(20), _u16(0), _u16(0),
      _u16(DOS_TIME), _u16(DOS_DATE), _u32(crc), _u32(data.length), _u32(data.length),
      _u16(nameBytes.length), _u16(0), _u16(0), _u16(0), _u16(0), _u32(0), _u32(offset));
    central.push(new Uint8Array(cdh), nameBytes);
    offset += lfh.length + nameBytes.length + data.length;
  }
  let cdSize = 0; central.forEach((c) => (cdSize += c.length));
  const eocd = [].concat([0x50, 0x4b, 0x05, 0x06], _u16(0), _u16(0),
    _u16(files.length), _u16(files.length), _u32(cdSize), _u32(offset), _u16(0));
  const parts = local.concat(central, [new Uint8Array(eocd)]);
  let total = 0; parts.forEach((p) => (total += p.length));
  const out = new Uint8Array(total);
  let p = 0; parts.forEach((x) => { out.set(x, p); p += x.length; });
  return out;
}
function _colLetter(n) { let s = ""; n++; while (n > 0) { const m = (n - 1) % 26; s = String.fromCharCode(65 + m) + s; n = Math.floor((n - 1) / 26); } return s; }
function _xmlEsc(s) { return String(s == null ? "" : s).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/\r/g, ""); }
function buildXlsx(headers, rows, sheetName) {
  sheetName = (sheetName || "Sheet1").replace(/[\[\]:*?/\\]/g, " ").slice(0, 31);
  const rowsXml = [];
  const headerCells = headers.map((h, ci) => `<c r="${_colLetter(ci)}1" t="inlineStr"><is><t xml:space="preserve">${_xmlEsc(h)}</t></is></c>`).join("");
  rowsXml.push(`<row r="1">${headerCells}</row>`);
  rows.forEach((row, ri) => {
    const r = ri + 2;
    const cells = row.map((v, ci) => {
      const ref = _colLetter(ci) + r;
      if (typeof v === "number" && isFinite(v)) return `<c r="${ref}"><v>${v}</v></c>`;
      return `<c r="${ref}" t="inlineStr"><is><t xml:space="preserve">${_xmlEsc(v)}</t></is></c>`;
    }).join("");
    rowsXml.push(`<row r="${r}">${cells}</row>`);
  });
  const enc = new TextEncoder();
  const sheetXml = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n<worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"><sheetData>${rowsXml.join("")}</sheetData></worksheet>`;
  const files = [
    { name: "[Content_Types].xml", data: enc.encode(`<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/><Override PartName="/xl/worksheets/sheet1.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/></Types>`) },
    { name: "_rels/.rels", data: enc.encode(`<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="xl/workbook.xml"/></Relationships>`) },
    { name: "xl/workbook.xml", data: enc.encode(`<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n<workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"><sheets><sheet name="${_xmlEsc(sheetName)}" sheetId="1" r:id="rId1"/></sheets></workbook>`) },
    { name: "xl/_rels/workbook.xml.rels", data: enc.encode(`<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet1.xml"/></Relationships>`) },
    { name: "xl/worksheets/sheet1.xml", data: enc.encode(sheetXml) },
  ];
  return new Blob([_zipStore(files)], { type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" });
}
function promptsToRows(list) {
  const headers = ["Source #", "Title", "Category", "Function(s)", "Skill", "Role", "Difficulty", "Prompt Type", "AI Tool", "Quality", "Lifecycle", "Tags", "Variables", "Prompt"];
  const rows = list.map((r) => [
    r.sourceNumber || "", r.title, r.category, functionsForCategory(r.category), r.skill || "",
    r.role || "", r.difficulty || "", r.promptType || "", r.aiTool || "",
    typeof r.qualityScore === "number" ? r.qualityScore : "", r.lifecycle || "",
    (r.tags || []).join(", "), (r.variables || []).join(", "), r.originalPrompt || "",
  ]);
  return { headers, rows };
}
async function downloadBlob(blob, filename) {
  try {
    if (Store.hasDownloads && Store.hasDownloads()) {
      const buf = new Uint8Array(await blob.arrayBuffer());
      await Store.downloadsSave({ filename, data: buf });
      showToast("Saved " + filename);
      return;
    }
  } catch (e) { /* fall through to anchor download */ }
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url; a.download = filename;
  document.body.appendChild(a); a.click(); a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 5000);
  showToast("Downloading " + filename);
}
function exportPromptsXlsx(list, baseName, summary) {
  const { headers, rows } = promptsToRows(list);
  const meta = [
    ["Synottic Prompt Intelligence — export"],
    ["Selection", summary || ""],
    ["Prompts", list.length],
    ["Generated", new Date().toISOString()],
    [],
  ];
  // Prepend a small meta block above the table by shifting rows into one sheet.
  const allHeaders = headers;
  const allRows = meta.map((m) => { const row = new Array(headers.length).fill(""); m.forEach((v, i) => (row[i] = v)); return row; })
    .concat([headers]).concat(rows);
  // sheet: row1 = first meta line; simplest is to just build with headers=allRows[0]
  const blob = buildXlsx(allRows[0], allRows.slice(1), "Prompts");
  const fn = (baseName || "synottic-prompts").replace(/[^\w.-]+/g, "-").toLowerCase() + ".xlsx";
  downloadBlob(blob, fn);
}
function exportPromptsCsv(list, baseName) {
  const { headers, rows } = promptsToRows(list);
  const esc = (v) => `"${String(v == null ? "" : v).replace(/"/g, '""')}"`;
  const csv = [headers.map(esc).join(",")].concat(rows.map((r) => r.map(esc).join(","))).join("\r\n");
  const blob = new Blob(["﻿" + csv], { type: "text/csv;charset=utf-8" });
  downloadBlob(blob, (baseName || "synottic-prompts").replace(/[^\w.-]+/g, "-").toLowerCase() + ".csv");
}

/* ---------- Admin gate + shell ---------- */
let ADMIN_STATE = { tab: "codes", editing: null, dl: { industry: "", functions: [], roles: [], programId: "", domain: "", codeId: "" } };

function renderAdminGate() {
  const root = document.getElementById("gate-root");
  root.innerHTML = `
  <div class="gate">
    <div class="gate-card">
      <div class="gate-mark" role="img" aria-label="Synottic"></div>
      <h1>Admin console</h1>
      <p class="sub">Enter the admin key to manage organisation access codes.</p>
      <label for="admin-key">Admin key</label>
      <input id="admin-key" type="password" autocomplete="off" placeholder="Admin key" />
      <div class="gate-error" id="admin-key-err"></div>
      <button class="btn btn-primary" id="admin-key-go">Open console</button>
      <div class="gate-hint"><button class="gate-admin-link" id="admin-back">← Back to sign in</button></div>
    </div>
  </div>`;
  const inp = root.querySelector("#admin-key");
  const errEl = root.querySelector("#admin-key-err");
  const btn = root.querySelector("#admin-key-go");
  const go = async () => {
    const key = inp.value.trim();
    if (!key) return;
    errEl.textContent = "";
    // Backend: verify server-side (the real ADMIN_SECRET never ships in the page).
    if (typeof Backend !== "undefined" && Backend.isConfigured()) {
      btn.disabled = true;
      try {
        await Backend.adminLogin(key);
        try { sessionStorage.setItem("prompt-lib:admin-ok", "1"); } catch (e) {}
        // The legacy ADMIN_SECRET key resolves to a full SUPER_ADMIN server-side
        // (api/_session.js#requireAdmin) — mirror that for the UI role gate.
        try { sessionStorage.setItem("prompt-lib:admin-role", "SUPER_ADMIN"); } catch (e) {}
        await AdminStore.init();
        openAdmin();
        return;
      } catch (e) {
        btn.disabled = false;
        if (e.status === 401) { errEl.textContent = "Incorrect admin key."; return; }
        if (!e.soft) { errEl.textContent = "Couldn't reach the server — try again."; return; }
        // e.soft -> backend absent, fall through to local check
      }
    }
    if (key.toUpperCase() === AdminStore.key().toUpperCase()) {
      try { sessionStorage.setItem("prompt-lib:admin-ok", "1"); } catch (e) {}
      openAdmin();
    } else {
      errEl.textContent = "Incorrect admin key.";
    }
  };
  btn.addEventListener("click", go);
  inp.addEventListener("keydown", (e) => { if (e.key === "Enter") go(); });
  root.querySelector("#admin-back").addEventListener("click", () => renderGate());
  inp.focus();
}
function exitAdmin() {
  // Super-admin (has a learner session): drop back into the library, keep the
  // "Admin console" nav link. Pure admin: clear the unlock and return to the gate.
  const s = (typeof Store !== "undefined") && Store.getSession && Store.getSession();
  if (s && s.superAdmin) {
    const root = document.getElementById("admin-root");
    if (root) root.hidden = true;
    bootApp();
    return;
  }
  try { sessionStorage.removeItem("prompt-lib:admin-ok"); } catch (e) {}
  if (typeof Backend !== "undefined") Backend.clearAdmin();
  location.reload();
}
function openAdmin() {
  document.getElementById("gate-root").innerHTML = "";
  const app = document.getElementById("app");
  if (app) app.hidden = true;
  let root = document.getElementById("admin-root");
  if (!root) { root = document.createElement("div"); root.id = "admin-root"; document.body.appendChild(root); }
  root.hidden = false;
  renderAdminConsole();
}

/* ---------- "View as" — preview the library exactly as a learner on a
   given code sees it, then jump back to the console. --------------------- */
function previewAs(code) {
  const norm = String(code || "").toUpperCase().trim();
  const adm = AdminStore.getCode(norm);
  const stat = adm ? null : resolveStaticAccessCode(norm);
  if (!adm && !stat) { showToast("Couldn't resolve " + code); return; }

  // stash the current (real) session once — switching preview→preview keeps
  // the original stashed.
  const cur = Store.getSession();
  if (!(cur && cur.preview)) {
    try { sessionStorage.setItem("prompt-lib:realsession", JSON.stringify(cur || null)); } catch (e) {}
  }

  let s;
  if (adm) {
    s = {
      code: adm.code, kind: "admin", preview: true, superAdmin: true,
      orgId: "adm-" + adm.id, orgName: adm.orgName, domain: adm.domain || "", industry: adm.industry || "",
      functions: adm.functions || [], roles: adm.roles || [],
      programIds: adm.programIds || [], fullLibrary: !!adm.fullLibrary,
      subject: "preview:" + adm.code, name: "Preview", startedAt: Date.now(),
    };
  } else {
    s = {
      code: stat.code, preview: true, superAdmin: true,
      orgId: stat.org ? stat.org.id : null,
      programId: stat.program ? stat.program.id : null,
      cohortId: stat.cohort ? stat.cohort.id : null,
      learnerId: stat.learner ? stat.learner.id : null,
      subject: "preview:" + stat.code, name: "Preview", startedAt: Date.now(),
    };
  }
  Store.setSession(s);
  const ar = document.getElementById("admin-root");
  if (ar) ar.hidden = true;
  bootApp();
}
function exitPreview() {
  let real = null;
  try { real = JSON.parse(sessionStorage.getItem("prompt-lib:realsession") || "null"); } catch (e) {}
  try { sessionStorage.removeItem("prompt-lib:realsession"); } catch (e) {}
  if (real) Store.setSession(real); else Store.clearSession();
  document.body.classList.remove("previewing");
  const b = document.getElementById("preview-banner");
  if (b) b.remove();
  openAdmin();
}
function previewCodeList() {
  const admin = AdminStore.getCodes().map((c) => ({
    code: c.code, label: c.code + " · " + (c.orgName || "") + (c.fullLibrary ? " · full" : (c.functions || []).length ? " · " + c.functions.join("/") : ""),
  }));
  const stat = (ORG_MODEL.accessCodes || []).map((a) => {
    const r = resolveStaticAccessCode(a.code);
    return { code: a.code, label: a.code + " · " + (r && r.org ? r.org.name : "") + (r && r.program ? " · " + r.program.name : "") };
  });
  return { admin, stat };
}
function renderPreviewBanner() {
  const s = Store.getSession();
  const on = !!(s && s.preview);
  document.body.classList.toggle("previewing", on);
  let b = document.getElementById("preview-banner");
  if (!on) { if (b) b.remove(); return; }
  if (!b) { b = document.createElement("div"); b.id = "preview-banner"; document.body.appendChild(b); }
  const scope = s.kind === "admin"
    ? (s.fullLibrary ? "full library" : ((s.functions || []).join(", ") || (s.programIds || []).length + " program(s)"))
    : "programme code";
  const { admin, stat } = previewCodeList();
  b.innerHTML = `
    ${icon("eye")}
    <span>Previewing as <b>${escapeHtml(s.code)}</b><span class="pb-scope"> — ${escapeHtml(scope)}</span></span>
    <select id="pb-switch" title="Switch preview">
      <option value="">Switch to…</option>
      <optgroup label="Organisation codes">${admin.map((c) => `<option value="${escapeHtml(c.code)}" ${c.code === s.code ? "selected" : ""}>${escapeHtml(c.label)}</option>`).join("")}</optgroup>
      <optgroup label="Built-in">${stat.map((c) => `<option value="${escapeHtml(c.code)}" ${c.code === s.code ? "selected" : ""}>${escapeHtml(c.label)}</option>`).join("")}</optgroup>
    </select>
    <button class="pb-x" id="pb-exit">Exit preview →</button>`;
  b.querySelector("#pb-exit").addEventListener("click", exitPreview);
  b.querySelector("#pb-switch").addEventListener("change", (e) => { if (e.target.value) previewAs(e.target.value); });
}
function newCodeDraft() {
  return { id: uid("adm"), code: "", orgName: "", domain: "", industry: "", functions: [], roles: [], programIds: [], fullLibrary: false, enabled: true, note: "", createdAt: new Date().toISOString() };
}
function suggestCode(orgName) {
  const slug = (orgName || "ORG").toUpperCase().replace(/[^A-Z0-9]+/g, "").slice(0, 8) || "ORG";
  const rand = Math.random().toString(36).slice(2, 6).toUpperCase();
  return slug + "-" + rand;
}
function renderAdminConsole() {
  const root = document.getElementById("admin-root");
  root.innerHTML = `
    <div class="admin-shell">
      <div class="admin-top">
        <div class="brand-mark" style="width:36px;height:31px;" role="img" aria-label="Synottic"></div>
        <h1>Synottic — Admin Console</h1>
        <span class="chip">${AdminStore.backend() === "neon" ? "Synced to Neon" : AdminStore.backend() === "db" ? "Synced to account" : "Saved in this browser"}</span>
        <button class="btn btn-sm" id="admin-exit">${icon("logout")} ${(Store.getSession && Store.getSession() && Store.getSession().superAdmin) ? "Back to library" : "Exit"}</button>
      </div>
      <div class="tabs">
        <button class="tab-btn ${ADMIN_STATE.tab === "codes" ? "active" : ""}" data-atab="codes">Access codes</button>
        <button class="tab-btn ${ADMIN_STATE.tab === "edit" ? "active" : ""}" data-atab="edit">${ADMIN_STATE.editing && ADMIN_STATE.editing.code ? "Edit code" : "New code"}</button>
        <button class="tab-btn ${ADMIN_STATE.tab === "download" ? "active" : ""}" data-atab="download">Download prompts</button>
        ${(typeof Backend !== "undefined" && Backend.isConfigured() && Backend.adminAuthed()) ? `<button class="tab-btn ${ADMIN_STATE.tab === "functions" ? "active" : ""}" data-atab="functions">Function access</button>` : ""}
        ${(typeof Backend !== "undefined" && Backend.isConfigured() && Backend.adminAuthed()) ? `<button class="tab-btn ${ADMIN_STATE.tab === "collections" ? "active" : ""}" data-atab="collections">Collections</button>` : ""}
        ${(typeof Backend !== "undefined" && Backend.isConfigured() && Backend.adminAuthed() && isSuperAdmin()) ? `<button class="tab-btn ${ADMIN_STATE.tab === "prompts" ? "active" : ""}" data-atab="prompts">Prompts</button>` : ""}
        ${(typeof Backend !== "undefined" && Backend.isConfigured() && Backend.adminAuthed()) ? `<button class="tab-btn ${ADMIN_STATE.tab === "users" ? "active" : ""}" data-atab="users">Users</button>` : ""}
        ${AdminStore.backend() === "neon" ? `<button class="tab-btn ${ADMIN_STATE.tab === "analytics" ? "active" : ""}" data-atab="analytics">Analytics</button>` : ""}
      </div>
      <div id="admin-body"></div>
    </div>`;
  root.querySelector("#admin-exit").addEventListener("click", exitAdmin);
  root.querySelectorAll("[data-atab]").forEach((b) => b.addEventListener("click", () => {
    ADMIN_STATE.tab = b.dataset.atab;
    if (b.dataset.atab === "edit" && !ADMIN_STATE.editing) ADMIN_STATE.editing = newCodeDraft();
    renderAdminConsole();
  }));
  const body = root.querySelector("#admin-body");
  if (ADMIN_STATE.tab === "codes") renderAdminCodes(body);
  else if (ADMIN_STATE.tab === "edit") renderAdminEdit(body);
  else if (ADMIN_STATE.tab === "functions") renderAdminFunctions(body);
  else if (ADMIN_STATE.tab === "collections") renderAdminCollections(body);
  else if (ADMIN_STATE.tab === "prompts") renderAdminPrompts(body);
  else if (ADMIN_STATE.tab === "users") renderAdminUsers(body);
  else if (ADMIN_STATE.tab === "analytics") renderAdminAnalytics(body);
  else renderAdminDownload(body);
}

/* Shared: how many central prompts a {categories, programIds, promptIds}
   selection resolves to (categories OR program-linked OR pinned). */
function scopeResolveCount(cats, programIds, promptIds) {
  const c = new Set(cats || []);
  const linked = new Set(promptIds || []);
  (programIds || []).forEach((pid) => (typeof programPromptIds === "function" ? programPromptIds(pid) : []).forEach((id) => linked.add(id)));
  return ALL_PROMPTS.filter((r) => c.has(r.category) || linked.has(r.id)).length;
}

/* ---------- Reusable multi-select checkbox group with Select all / Clear +
   filter. `attr` is the per-checkbox data attribute the caller's read() already
   greps for (e.g. "data-colcat"), so wiring is drop-in. ------------------------ */
function checkGroupHtml(attr, options, checkedList, opts) {
  opts = opts || {};
  const checked = new Set(checkedList || []);
  const filterable = options.length > 8 && opts.filterable !== false;
  const optHtml = options.map((o) => {
    const val = o.value != null ? o.value : o;
    const label = o.label != null ? o.label : o;
    const extra = o.extra ? ` <span style="color:var(--text-faint)">${escapeHtml(o.extra)}</span>` : "";
    return `<label class="cg-opt"><input type="checkbox" ${attr} value="${escapeHtml(String(val))}" ${checked.has(val) ? "checked" : ""}/> ${escapeHtml(String(label))}${extra}</label>`;
  }).join("");
  return `<div class="cg-wrap" data-cg-for="${attr}">
    <div class="cg-bar">
      <button type="button" class="cg-selall" data-cg-selall aria-pressed="false" title="Select all / Clear">
        <span class="cg-ind" aria-hidden="true"></span><span data-cg-label>Select all</span><span class="cg-count" data-cg-count></span>
      </button>
      ${filterable ? `<input type="search" class="cg-filter" data-cg-filter placeholder="Filter…" aria-label="Filter options"/>` : ""}
    </div>
    <div class="checkgrid" data-cg-grid>${optHtml}</div>
  </div>`;
}
// Wire every checkGroupHtml block inside `scope`. `onChange` fires after a
// bulk toggle so the caller can refresh its scope preview.
function wireCheckGroups(scope, onChange) {
  scope.querySelectorAll(".cg-wrap").forEach((wrap) => {
    const btn = wrap.querySelector("[data-cg-selall]");
    const grid = wrap.querySelector("[data-cg-grid]");
    const filter = wrap.querySelector("[data-cg-filter]");
    const opts = () => [...grid.querySelectorAll("label.cg-opt")];
    const boxOf = (l) => l.querySelector('input[type="checkbox"]');
    const visibleBoxes = () => opts().filter((l) => !l.classList.contains("cg-hidden")).map(boxOf);
    function sync() {
      const v = visibleBoxes();
      const on = v.filter((b) => b.checked).length;
      const state = v.length && on === v.length ? "all" : on > 0 ? "some" : "none";
      btn.dataset.state = state;
      btn.setAttribute("aria-pressed", state === "all" ? "true" : "false");
      wrap.querySelector("[data-cg-label]").textContent = state === "all" ? "Clear all" : "Select all";
      wrap.querySelector("[data-cg-count]").textContent = v.length ? `${on}/${v.length}` : "";
    }
    btn.addEventListener("click", () => {
      const v = visibleBoxes();
      const target = !(v.length && v.every((b) => b.checked));   // all visible checked -> clear; else select
      v.forEach((b) => { if (b.checked !== target) { b.checked = target; b.dispatchEvent(new Event("input", { bubbles: true })); } });
      sync();
      if (onChange) onChange();
    });
    if (filter) filter.addEventListener("input", () => {
      const q = filter.value.trim().toLowerCase();
      opts().forEach((l) => l.classList.toggle("cg-hidden", !!q && !l.textContent.toLowerCase().includes(q)));
      sync();
    });
    grid.addEventListener("input", (e) => { if (e.target.matches('input[type="checkbox"]')) sync(); });
    sync();
  });
}

/* ---------- Collections: per-org curated library + its access codes.
   Codes here are the v2 `access_codes` (redeemed via /api/auth/redeem-code) —
   separate from the legacy `admin_codes` on the "Access codes" tab. */
function renderAdminCollections(body) {
  const st = ADMIN_STATE.col || (ADMIN_STATE.col = { list: null, editing: null, codesFor: null });
  body.innerHTML = `<div class="skel" style="height:120px;"></div>`;
  const load = () => Backend.adminCollections().then((list) => { st.list = list; paint(); })
    .catch(() => { body.innerHTML = emptyStateHtml("layers", "Couldn't load collections", "Try again in a moment."); });

  function paint() {
    if (st.editing) return paintEditor();
    if (st.codesFor) return paintCodes();
    const rows = st.list || [];
    body.innerHTML = `
      <p class="prose" style="color:var(--text-muted);max-width:680px;margin:6px 0 14px;">
        Build a named library for an organisation — pick any mix of programs, categories and individual
        prompts — then generate a short access code. A learner who enters that code on the sign-in
        “Access code” tab gets a filtered category browse of exactly that set.
      </p>
      <div style="display:flex;gap:10px;margin:0 0 12px;">
        <div style="flex:1;"></div>
        <button class="btn btn-primary btn-sm" id="col-new">${icon("plus")} New collection</button>
      </div>
      <div style="overflow-x:auto;">
      <table class="admin-table">
        <thead><tr><th>Collection</th><th>Organisation</th><th>Scope</th><th>Codes</th><th>Redemptions</th><th>Enabled</th><th></th></tr></thead>
        <tbody>
          ${rows.length ? rows.map((c) => {
            const red = (c.codes || []).reduce((n, k) => n + (k.redemptions || 0), 0);
            return `<tr>
              <td><b>${escapeHtml(c.name)}</b></td>
              <td>${escapeHtml(c.orgName || "—")}</td>
              <td>${c.categoryIds.length} cat · ${c.programIds.length} prog · ${c.promptIds.length} pinned<div style="color:var(--text-faint);font-size:11px;">≈ ${scopeResolveCount(c.categoryIds, c.programIds, c.promptIds).toLocaleString()} prompts</div></td>
              <td>${(c.codes || []).length}</td>
              <td>${red}</td>
              <td>${c.enabled ? `<span class="chip chip-accent">On</span>` : `<span class="chip">Off</span>`}</td>
              <td style="white-space:nowrap;">
                <button class="btn btn-sm btn-ghost" data-coledit="${escapeHtml(c.id)}" title="Edit">${icon("slider")}</button>
                <button class="btn btn-sm btn-ghost" data-colcodes="${escapeHtml(c.id)}" title="Access codes">${icon("link2")} Codes</button>
              </td>
            </tr>`;
          }).join("") : `<tr><td colspan="7" style="color:var(--text-faint);padding:18px;">No collections yet.</td></tr>`}
        </tbody>
      </table></div>`;
    body.querySelector("#col-new").addEventListener("click", () => {
      st.editing = { id: null, name: "", orgName: "", categoryIds: [], programIds: [], promptIds: [], defaultFunction: "", defaultAiLevel: "", enabled: true };
      paint();
    });
    body.querySelectorAll("[data-coledit]").forEach((b) => b.addEventListener("click", () => {
      const c = st.list.find((x) => x.id === b.dataset.coledit);
      st.editing = { id: c.id, name: c.name, orgName: c.orgName || "", categoryIds: c.categoryIds.slice(), programIds: c.programIds.slice(), promptIds: c.promptIds.slice(), defaultFunction: c.defaultFunction || "", defaultAiLevel: c.defaultAiLevel || "", enabled: c.enabled };
      paint();
    }));
    body.querySelectorAll("[data-colcodes]").forEach((b) => b.addEventListener("click", () => {
      st.codesFor = st.list.find((x) => x.id === b.dataset.colcodes); paint();
    }));
  }

  function paintEditor() {
    const d = st.editing;
    const allCats = (typeof CATEGORIES !== "undefined" ? CATEGORIES : []).map((c) => c.name).sort();
    const programs = allProgramsList();
    body.innerHTML = `
      <div style="max-width:860px;">
        <button class="btn btn-ghost btn-sm" id="col-back" style="margin-bottom:10px;">← All collections</button>
        <div style="display:grid;grid-template-columns:1fr 1fr;gap:14px;">
          <div class="form-field"><label>Collection name *</label><input type="text" id="col-name" value="${escapeHtml(d.name)}" placeholder="ABC onboarding library"/></div>
          <div class="form-field"><label>Organisation</label><input type="text" id="col-org" value="${escapeHtml(d.orgName)}" placeholder="ABC Corporation"/></div>
        </div>
        <div style="display:grid;grid-template-columns:1fr 1fr;gap:14px;">
          <div class="form-field"><label>Default function / department <span style="font-weight:400;color:var(--text-faint)">— joiners skip step 2; this becomes their function &amp; role</span></label>
            <select id="col-fn"><option value="">— none (learner is asked at step 2) —</option>${(typeof SIGNUP_FUNCTIONS !== "undefined" ? SIGNUP_FUNCTIONS : []).map(([v, l]) => `<option value="${v}" ${d.defaultFunction === v ? "selected" : ""}>${escapeHtml(l)}</option>`).join("")}</select>
          </div>
          <div class="form-field"><label>Default AI level</label>
            <select id="col-lvl"><option value="">— default (Beginner) —</option>${(typeof SIGNUP_LEVELS !== "undefined" ? SIGNUP_LEVELS : []).map(([v, l]) => `<option value="${v}" ${d.defaultAiLevel === v ? "selected" : ""}>${escapeHtml(l)}</option>`).join("")}</select>
          </div>
        </div>
        <label class="auth-check" style="margin:2px 0 12px;"><input type="checkbox" id="col-enabled" ${d.enabled ? "checked" : ""}/> Active</label>
        <div class="form-field"><label>Categories</label>
          ${checkGroupHtml("data-colcat", allCats, d.categoryIds)}
        </div>
        <div class="form-field"><label>Programs <span style="font-weight:400;color:var(--text-faint)">— their module-linked prompts are included</span></label>
          ${checkGroupHtml("data-colprog", programs.map((p) => ({ value: p.id, label: p.name, extra: "· " + p.org })), d.programIds)}
        </div>
        <div class="form-field"><label for="col-pins">Pinned prompt IDs <span style="font-weight:400;color:var(--text-faint)">— one per line or comma-separated</span></label>
          <textarea id="col-pins" rows="4" style="font-family:var(--font-mono);font-size:12px;">${escapeHtml(d.promptIds.join("\n"))}</textarea>
        </div>
        <div style="background:var(--surface-2);border:1px solid var(--border);border-radius:var(--radius);padding:12px 14px;font-size:12.5px;color:var(--text-muted);margin:6px 0 16px;">
          <b>Scope preview:</b> <span id="col-preview"></span>
        </div>
        <div style="display:flex;gap:8px;">
          <button class="btn btn-primary" id="col-save">${d.id ? "Save changes" : "Create collection"}</button>
          <button class="btn" id="col-cancel">Cancel</button>
          ${d.id ? `<div style="flex:1;"></div><button class="btn btn-ghost" id="col-del">Delete</button>` : ""}
        </div>
      </div>`;
    const read = () => {
      d.name = body.querySelector("#col-name").value.trim();
      d.orgName = body.querySelector("#col-org").value.trim();
      d.defaultFunction = body.querySelector("#col-fn").value;
      d.defaultAiLevel = body.querySelector("#col-lvl").value;
      d.enabled = body.querySelector("#col-enabled").checked;
      d.categoryIds = [...body.querySelectorAll("[data-colcat]:checked")].map((x) => x.value);
      d.programIds = [...body.querySelectorAll("[data-colprog]:checked")].map((x) => x.value);
      d.promptIds = body.querySelector("#col-pins").value.split(/[\s,]+/).map((s) => s.trim()).filter(Boolean);
    };
    const refresh = () => {
      read();
      const known = d.promptIds.filter((id) => ALL_PROMPTS_BY_ID[id]).length;
      body.querySelector("#col-preview").textContent =
        `${scopeResolveCount(d.categoryIds, d.programIds, d.promptIds).toLocaleString()} prompts across ${d.categoryIds.length} categor${d.categoryIds.length === 1 ? "y" : "ies"}` +
        (d.promptIds.length ? ` · ${known}/${d.promptIds.length} pinned IDs match` : "");
    };
    body.querySelectorAll("input,textarea").forEach((el) => el.addEventListener("input", refresh));
    wireCheckGroups(body, refresh);
    body.querySelector("#col-back").addEventListener("click", () => { st.editing = null; paint(); });
    body.querySelector("#col-cancel").addEventListener("click", () => { st.editing = null; paint(); });
    body.querySelector("#col-save").addEventListener("click", () => {
      read();
      if (!d.name) { showToast("Give the collection a name"); return; }
      if (!d.categoryIds.length && !d.programIds.length && !d.promptIds.length) { showToast("Pick at least one category, program or prompt"); return; }
      const btn = body.querySelector("#col-save"); btn.disabled = true; btn.textContent = "Saving…";
      Backend.adminSaveCollection(d).then(() => { showToast("Collection saved"); st.editing = null; load(); })
        .catch((e) => {
          btn.disabled = false; btn.textContent = d.id ? "Save changes" : "Create collection";
          const err = e && (e.message || (e.data && e.data.error));
          showToast(err === "schema-out-of-date"
            ? "Server database is behind — run: npm run migrate:v3"
            : "Couldn't save: " + (err || "server error"));
        });
    });
    const del = body.querySelector("#col-del");
    if (del) del.addEventListener("click", () => {
      if (!confirm("Delete “" + d.name + "”? This also removes its unused access codes.")) return;
      Backend.adminDeleteCollection(d.id).then(() => { showToast("Collection deleted"); st.editing = null; load(); })
        .catch((e) => showToast(e && e.status === 422 ? "Can't delete — a code has been redeemed. Disable it instead." : "Couldn't delete on the server"));
    });
    refresh();
  }

  function paintCodes() {
    const c = st.codesFor;
    const fresh = (st.list || []).find((x) => x.id === c.id) || c;
    const codes = fresh.codes || [];
    body.innerHTML = `
      <button class="btn btn-ghost btn-sm" id="cc-back" style="margin-bottom:10px;">← All collections</button>
      <div class="section-title" style="margin-bottom:4px;"><h2 style="font-size:18px;">${escapeHtml(fresh.name)} — access codes</h2></div>
      <div style="color:var(--text-muted);font-size:12.5px;margin-bottom:14px;">${escapeHtml(fresh.orgName || "No organisation")} · ${scopeResolveCount(fresh.categoryIds, fresh.programIds, fresh.promptIds).toLocaleString()} prompts in scope${fresh.defaultFunction ? " · joiners: " + escapeHtml((AU_FUNCTIONS.find((f) => f[0] === fresh.defaultFunction) || [null, fresh.defaultFunction])[1]) + (fresh.defaultAiLevel ? " / " + escapeHtml(fresh.defaultAiLevel) : "") : ""}</div>
      <div style="overflow-x:auto;">
      <table class="admin-table">
        <thead><tr><th>Code</th><th>Label</th><th>Redemptions</th><th>Seat limit</th><th>Expires</th><th>Enabled</th><th></th></tr></thead>
        <tbody>
          ${codes.length ? codes.map((k) => `<tr>
            <td><span class="admin-code">${escapeHtml(k.code)}</span></td>
            <td>${escapeHtml(k.label || "—")}</td>
            <td>${k.redemptions}${k.maxRedemptions != null ? " / " + k.maxRedemptions : ""}</td>
            <td><input type="number" min="0" data-ccmax="${k.id}" value="${k.maxRedemptions ?? ""}" placeholder="∞" style="width:70px;"/></td>
            <td><input type="date" data-ccexp="${k.id}" value="${k.expiresAt ? String(k.expiresAt).slice(0, 10) : ""}"/></td>
            <td><button class="switch ${k.enabled ? "on" : ""}" data-cctoggle="${k.id}" aria-label="Toggle"><i></i></button></td>
            <td style="white-space:nowrap;">
              <button class="btn btn-sm btn-ghost" data-cccopy="${escapeHtml(k.code)}" title="Copy">${icon("copy")}</button>
              <button class="btn btn-sm btn-ghost" data-ccsave="${k.id}" title="Save seat limit / expiry">${icon("check")}</button>
            </td></tr>`).join("") : `<tr><td colspan="7" style="color:var(--text-faint);padding:16px;">No codes yet.</td></tr>`}
        </tbody>
      </table></div>
      <div style="display:flex;gap:8px;align-items:flex-end;flex-wrap:wrap;margin-top:14px;background:var(--surface-2);border:1px solid var(--border);border-radius:var(--radius);padding:12px 14px;">
        <div class="form-field" style="margin:0;"><label>Label</label><input type="text" id="cc-label" placeholder="${escapeHtml(fresh.name)}"/></div>
        <div class="form-field" style="margin:0;"><label>Seat limit</label><input type="number" id="cc-max" min="1" placeholder="∞" style="width:90px;"/></div>
        <div class="form-field" style="margin:0;"><label>Expiry</label><input type="date" id="cc-exp"/></div>
        <button class="btn btn-primary" id="cc-gen">${icon("plus")} Generate code</button>
      </div>`;
    body.querySelector("#cc-back").addEventListener("click", () => { st.codesFor = null; paint(); });
    body.querySelectorAll("[data-cccopy]").forEach((b) => b.addEventListener("click", async () => { await copyText(b.dataset.cccopy); showToast("Code copied"); }));
    body.querySelectorAll("[data-cctoggle]").forEach((b) => b.addEventListener("click", () => {
      const k = codes.find((x) => x.id === b.dataset.cctoggle);
      Backend.adminPatchAccessCode(k.id, { enabled: !k.enabled }).then(() => load()).catch(() => showToast("Couldn't update"));
    }));
    body.querySelectorAll("[data-ccsave]").forEach((b) => b.addEventListener("click", () => {
      const id = b.dataset.ccsave;
      const maxEl = body.querySelector(`[data-ccmax="${id}"]`);
      const expEl = body.querySelector(`[data-ccexp="${id}"]`);
      const max = maxEl.value === "" ? null : Math.max(0, parseInt(maxEl.value, 10) || 0);
      Backend.adminPatchAccessCode(id, { maxRedemptions: max, expiresAt: expEl.value || null })
        .then(() => { showToast("Code updated"); load(); }).catch(() => showToast("Couldn't update"));
    }));
    body.querySelector("#cc-gen").addEventListener("click", () => {
      const btn = body.querySelector("#cc-gen"); btn.disabled = true; btn.textContent = "Generating…";
      const max = body.querySelector("#cc-max").value;
      Backend.adminGenerateCollectionCode(fresh.id, {
        label: body.querySelector("#cc-label").value.trim() || undefined,
        maxRedemptions: max ? parseInt(max, 10) : undefined,
        expiresAt: body.querySelector("#cc-exp").value || undefined,
      }).then((code) => { showToast("Generated " + (code && code.code)); load(); })
        .catch(() => { btn.disabled = false; btn.textContent = "Generate code"; showToast("Couldn't generate on the server"); });
    });
  }

  load();
}

/* ---------- Prompts: SUPER_ADMIN library curation (add / edit / archive /
   hard-delete + bulk CSV/JSON import & export). Writes hit /api/admin/prompts;
   the running app merges the delta via /api/prompts at boot. ---------------- */
const PROMPT_IMPORT_COLS = ["id", "title", "category", "role", "useCase", "description",
  "originalPrompt", "promptType", "difficulty", "variables", "tags", "lifecycle"];
const PROMPT_LIFECYCLES_UI = ["Draft", "Curated", "Recommended", "Review", "Archived"];
const PROMPT_DIFFICULTIES_UI = ["Beginner", "Intermediate", "Advanced"];

function promptCategoryNames() {
  const c = (typeof CATEGORIES !== "undefined" && CATEGORIES.length)
    ? CATEGORIES.map((x) => x.name || x) : [];
  return c.slice().sort();
}
function splitList(s) {
  return String(s || "").split(/[|,\n]/).map((x) => x.trim()).filter(Boolean);
}
// Minimal RFC-4180-ish CSV parser (quoted fields, embedded commas/newlines).
function parseCsv(text) {
  const rows = []; let row = []; let val = ""; let q = false;
  text = String(text || "").replace(/^﻿/, "");
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (q) {
      if (c === '"' && text[i + 1] === '"') { val += '"'; i++; }
      else if (c === '"') q = false;
      else val += c;
    } else if (c === '"') q = true;
    else if (c === ",") { row.push(val); val = ""; }
    else if (c === "\n" || c === "\r") {
      if (c === "\r" && text[i + 1] === "\n") i++;
      row.push(val); val = ""; rows.push(row); row = [];
    } else val += c;
  }
  if (val !== "" || row.length) { row.push(val); rows.push(row); }
  const nonEmpty = rows.filter((r) => r.some((x) => String(x).trim() !== ""));
  if (!nonEmpty.length) return [];
  const head = nonEmpty[0].map((h) => h.trim());
  return nonEmpty.slice(1).map((r) => {
    const o = {};
    head.forEach((h, i) => { o[h] = r[i] != null ? r[i] : ""; });
    if (o.variables !== undefined) o.variables = splitList(o.variables);
    if (o.tags !== undefined) o.tags = splitList(o.tags);
    return o;
  });
}
function readPromptFile(file) {
  return new Promise((resolve, reject) => {
    const fr = new FileReader();
    fr.onerror = () => reject(new Error("read-failed"));
    fr.onload = () => {
      const txt = String(fr.result || "");
      try {
        if (/\.json$/i.test(file.name) || txt.trim().startsWith("[") || txt.trim().startsWith("{")) {
          const j = JSON.parse(txt);
          resolve(Array.isArray(j) ? j : (j.prompts || [j]));
        } else {
          resolve(parseCsv(txt));
        }
      } catch (e) { reject(new Error("parse-failed")); }
    };
    fr.readAsText(file);
  });
}

function renderAdminPrompts(body) {
  if (typeof isSuperAdmin === "function" && !isSuperAdmin()) {
    body.innerHTML = emptyStateHtml("lock", "SUPER_ADMIN only", "Prompt library curation is restricted to super administrators.");
    return;
  }
  const st = ADMIN_STATE.prompts || (ADMIN_STATE.prompts = {
    list: null, total: 0, page: 0, pageSize: 50,
    f: { q: "", category: "", role: "", source: "", lifecycle: "", origin: "" },
    editing: null, imp: null,
  });

  const query = () => Object.assign({ page: st.page, pageSize: st.pageSize }, st.f);
  const load = () => {
    const tb = body.querySelector("#pr-tbody");
    if (tb) tb.innerHTML = `<tr><td colspan="8"><div class="skel" style="height:80px;"></div></td></tr>`;
    return Backend.adminPrompts(query()).then((d) => {
      st.list = (d && d.prompts) || []; st.total = (d && d.total) || 0; paint();
    }).catch((e) => {
      const err = e && (e.message || (e.data && e.data.error));
      body.innerHTML = emptyStateHtml("alert",
        err === "schema-out-of-date" ? "Server database is behind" : "Couldn't load prompts",
        err === "schema-out-of-date" ? "Run: npm run migrate:v3" : "Try again in a moment.");
    });
  };

  function paint() {
    if (st.editing) return paintEditor();
    if (st.imp) return paintImport();
    const rows = st.list || [];
    const cats = promptCategoryNames();
    const pages = Math.max(1, Math.ceil(st.total / st.pageSize));
    body.innerHTML = `
      <p class="prose" style="color:var(--text-muted);max-width:720px;margin:6px 0 14px;">
        Add, edit and retire prompts in the shared library. Changes are saved to the database and
        the learner app picks them up on next load — run <code>python3 src/build.py</code> to bake
        them into <code>index.html</code> permanently.
      </p>
      <div style="display:flex;gap:8px;flex-wrap:wrap;align-items:center;margin:0 0 12px;">
        <input type="search" id="pr-q" placeholder="Search title / prompt text…" value="${escapeHtml(st.f.q)}" style="min-width:220px;flex:1;"/>
        <select id="pr-cat"><option value="">All categories</option>${cats.map((c) => `<option ${st.f.category === c ? "selected" : ""}>${escapeHtml(c)}</option>`).join("")}</select>
        <select id="pr-origin"><option value="">Any origin</option>${["authored", "excel", "curriculum"].map((o) => `<option ${st.f.origin === o ? "selected" : ""}>${o}</option>`).join("")}</select>
        <select id="pr-lc"><option value="">Any lifecycle</option>${PROMPT_LIFECYCLES_UI.map((o) => `<option ${st.f.lifecycle === o ? "selected" : ""}>${o}</option>`).join("")}</select>
        <input type="text" id="pr-role" placeholder="Role contains…" value="${escapeHtml(st.f.role)}" style="width:150px;"/>
      </div>
      <div style="display:flex;gap:8px;flex-wrap:wrap;margin:0 0 12px;">
        <button class="btn btn-primary btn-sm" id="pr-new">${icon("plus")} Add prompt</button>
        <button class="btn btn-sm" id="pr-import">Import CSV / JSON</button>
        <button class="btn btn-sm" id="pr-exp-csv">${icon("download")} CSV</button>
        <button class="btn btn-sm" id="pr-exp-json">${icon("download")} JSON</button>
        <button class="btn btn-sm" id="pr-exp-xlsx">${icon("download")} XLSX</button>
        <div style="flex:1;"></div>
        <button class="btn btn-ghost btn-sm" id="pr-tmpl-csv">Template .csv</button>
        <button class="btn btn-ghost btn-sm" id="pr-tmpl-json">Template .json</button>
      </div>
      <div style="overflow-x:auto;">
      <table class="admin-table">
        <thead><tr><th>Title</th><th>Category</th><th>Role</th><th>Origin</th><th>Lifecycle</th><th>Updated</th><th></th></tr></thead>
        <tbody id="pr-tbody">
          ${rows.length ? rows.map((p) => `<tr>
            <td style="max-width:340px;"><b>${escapeHtml(p.title || "—")}</b><div style="color:var(--text-faint);font-size:11px;">${escapeHtml(p.id)}</div></td>
            <td>${escapeHtml(p.category || "—")}</td>
            <td>${escapeHtml(p.role || "—")}</td>
            <td><span class="chip">${escapeHtml(p.origin || "excel")}</span></td>
            <td>${escapeHtml(p.lifecycle || "—")}</td>
            <td style="white-space:nowrap;color:var(--text-faint);font-size:12px;">${p.updatedAt ? auTimeAgo(p.updatedAt) : "—"}</td>
            <td style="white-space:nowrap;">
              <button class="btn btn-sm btn-ghost" data-pedit="${escapeHtml(p.id)}" title="Edit">${icon("slider")} Edit</button>
              ${p.lifecycle === "Archived"
                ? `<button class="btn btn-sm btn-ghost" data-prestore="${escapeHtml(p.id)}" title="Restore">Restore</button>`
                : `<button class="btn btn-sm btn-ghost" data-parch="${escapeHtml(p.id)}" title="Archive">Archive</button>`}
              <button class="btn btn-sm btn-ghost" data-pdel="${escapeHtml(p.id)}" title="Delete permanently">Delete</button>
            </td></tr>`).join("") : `<tr><td colspan="7" style="color:var(--text-faint);padding:18px;">No prompts match.</td></tr>`}
        </tbody>
      </table></div>
      <div style="display:flex;gap:8px;align-items:center;margin-top:12px;color:var(--text-muted);font-size:12.5px;">
        <button class="btn btn-sm" id="pr-prev" ${st.page <= 0 ? "disabled" : ""}>← Prev</button>
        <span>Page ${st.page + 1} / ${pages} · ${st.total.toLocaleString()} prompts</span>
        <button class="btn btn-sm" id="pr-next" ${st.page + 1 >= pages ? "disabled" : ""}>Next →</button>
      </div>`;

    const deb = (fn) => { let t; return () => { clearTimeout(t); t = setTimeout(fn, 350); }; };
    const applyFilters = () => {
      st.f.q = body.querySelector("#pr-q").value.trim();
      st.f.category = body.querySelector("#pr-cat").value;
      st.f.origin = body.querySelector("#pr-origin").value;
      st.f.lifecycle = body.querySelector("#pr-lc").value;
      st.f.role = body.querySelector("#pr-role").value.trim();
      st.page = 0; load();
    };
    body.querySelector("#pr-q").addEventListener("input", deb(applyFilters));
    body.querySelector("#pr-role").addEventListener("input", deb(applyFilters));
    ["#pr-cat", "#pr-origin", "#pr-lc"].forEach((s) => body.querySelector(s).addEventListener("change", applyFilters));
    body.querySelector("#pr-prev").addEventListener("click", () => { if (st.page > 0) { st.page--; load(); } });
    body.querySelector("#pr-next").addEventListener("click", () => { st.page++; load(); });
    body.querySelector("#pr-new").addEventListener("click", () => {
      st.editing = { id: null, title: "", category: cats[0] || "General", role: "", useCase: "",
        description: "", originalPrompt: "", promptType: "Reusable Prompt", difficulty: "",
        lifecycle: "Curated", variables: "", tags: "" };
      paint();
    });
    body.querySelectorAll("[data-pedit]").forEach((b) => b.addEventListener("click", () => {
      const p = st.list.find((x) => x.id === b.dataset.pedit); if (!p) return;
      st.editing = {
        id: p.id, title: p.title || "", category: p.category || cats[0], role: p.role || "",
        useCase: p.useCase || "", description: p.description || "", originalPrompt: p.originalPrompt || "",
        promptType: p.promptType || "Reusable Prompt", difficulty: p.difficulty || "",
        lifecycle: p.lifecycle || "Curated", origin: p.origin,
        variables: (p.variables || []).join(", "), tags: (p.tags || []).join(", "),
      };
      paint();
    }));
    body.querySelectorAll("[data-parch]").forEach((b) => b.addEventListener("click", () => {
      Backend.adminDeletePrompt(b.dataset.parch, {}).then(() => { showToast("Archived"); load(); })
        .catch((e) => showToast("Couldn't archive: " + (e && e.message || "error")));
    }));
    body.querySelectorAll("[data-prestore]").forEach((b) => b.addEventListener("click", () => {
      Backend.adminSavePrompt({ action: "update", id: b.dataset.prestore, patch: { lifecycle: "Curated" } })
        .then(() => { showToast("Restored"); load(); }).catch((e) => showToast("Couldn't restore"));
    }));
    body.querySelectorAll("[data-pdel]").forEach((b) => b.addEventListener("click", () => {
      if (!confirm("Permanently delete this prompt? This cannot be undone. (Only author-managed prompts can be hard-deleted.)")) return;
      Backend.adminDeletePrompt(b.dataset.pdel, { hard: true, confirm: true }).then(() => { showToast("Deleted"); load(); })
        .catch((e) => showToast(e && e.data && e.data.error === "hard-delete-authored-only"
          ? "Only 'authored' prompts can be hard-deleted — archive this one instead." : "Couldn't delete"));
    }));
    body.querySelector("#pr-import").addEventListener("click", () => { st.imp = { stage: "pick" }; paint(); });
    const dl = (text, name, type) => {
      const blob = new Blob([text], { type });
      const u = URL.createObjectURL(blob); const a = document.createElement("a");
      a.href = u; a.download = name; document.body.appendChild(a); a.click(); a.remove();
      setTimeout(() => URL.revokeObjectURL(u), 1000);
    };
    const expName = (ext) => `prompts-export-${new Date().toISOString().slice(0, 10)}.${ext}`;
    body.querySelector("#pr-exp-csv").addEventListener("click", () => {
      Backend.adminPromptsExport(Object.assign({ format: "csv" }, st.f))
        .then((t) => dl(t, expName("csv"), "text/csv")).catch(() => showToast("Export failed"));
    });
    body.querySelector("#pr-exp-json").addEventListener("click", () => {
      Backend.adminPromptsExport(Object.assign({ format: "json" }, st.f))
        .then((t) => dl(t, expName("json"), "application/json")).catch(() => showToast("Export failed"));
    });
    body.querySelector("#pr-exp-xlsx").addEventListener("click", () => {
      Backend.adminPromptsExport(Object.assign({ format: "json" }, st.f)).then((t) => {
        const recs = JSON.parse(t);
        const headers = PROMPT_IMPORT_COLS.concat(["source", "origin"]);
        const rows = recs.map((r) => headers.map((h) => {
          const v = h === "variables" ? (r.variables || []).join(" | ") : h === "tags" ? (r.tags || []).join(" | ") : r[h];
          return v == null ? "" : String(v);
        }));
        const blob = buildXlsx(headers, rows, "Prompts");
        const u = URL.createObjectURL(blob); const a = document.createElement("a");
        a.href = u; a.download = expName("xlsx"); document.body.appendChild(a); a.click(); a.remove();
        setTimeout(() => URL.revokeObjectURL(u), 1000);
      }).catch(() => showToast("Export failed"));
    });
    body.querySelector("#pr-tmpl-csv").addEventListener("click", () => {
      Backend.adminPromptsExport({ template: "csv" }).then((t) => dl(t, "prompts-template.csv", "text/csv")).catch(() => showToast("Failed"));
    });
    body.querySelector("#pr-tmpl-json").addEventListener("click", () => {
      Backend.adminPromptsExport({ template: "json" }).then((t) => dl(t, "prompts-template.json", "application/json")).catch(() => showToast("Failed"));
    });
  }

  function paintEditor() {
    const d = st.editing;
    const cats = promptCategoryNames();
    const fw = (typeof deriveFrameworkLevel === "function")
      ? (deriveFrameworkLevel({ originalPrompt: d.originalPrompt || "" }).frameworkLevel) : null;
    body.innerHTML = `
      <div style="max-width:820px;">
        <button class="btn btn-ghost btn-sm" id="pr-back" style="margin-bottom:10px;">← All prompts</button>
        <h2 style="font-size:18px;margin:0 0 12px;">${d.id ? "Edit prompt" : "Add prompt"}${d.id ? ` <span style="color:var(--text-faint);font-size:12px;font-weight:400;">${escapeHtml(d.id)} · ${escapeHtml(d.origin || "authored")}</span>` : ""}</h2>
        <div style="display:grid;grid-template-columns:1fr 1fr;gap:14px;">
          <div class="form-field"><label>Title *</label><input type="text" id="pf-title" value="${escapeHtml(d.title)}" maxlength="300"/></div>
          <div class="form-field"><label>Category *</label><select id="pf-cat">${cats.map((c) => `<option ${d.category === c ? "selected" : ""}>${escapeHtml(c)}</option>`).join("")}</select></div>
          <div class="form-field"><label>Role</label><input type="text" id="pf-role" value="${escapeHtml(d.role)}"/></div>
          <div class="form-field"><label>Use case</label><input type="text" id="pf-uc" value="${escapeHtml(d.useCase)}"/></div>
          <div class="form-field"><label>Prompt type</label><input type="text" id="pf-type" value="${escapeHtml(d.promptType)}"/></div>
          <div class="form-field"><label>Difficulty <span style="color:var(--text-faint);font-weight:400;">— blank = auto</span></label>
            <select id="pf-diff"><option value="">— auto —</option>${PROMPT_DIFFICULTIES_UI.map((x) => `<option ${d.difficulty === x ? "selected" : ""}>${x}</option>`).join("")}</select></div>
          <div class="form-field"><label>Lifecycle</label>
            <select id="pf-lc">${PROMPT_LIFECYCLES_UI.map((x) => `<option ${d.lifecycle === x ? "selected" : ""}>${x}</option>`).join("")}</select></div>
          <div class="form-field"><label>Framework level <span style="color:var(--text-faint);font-weight:400;">— auto-detected</span></label>
            <input type="text" id="pf-fw" value="${fw ? "Level " + fw : "—"}" readonly style="background:var(--surface-2);"/></div>
        </div>
        <div class="form-field"><label>Description</label><textarea id="pf-desc" rows="2">${escapeHtml(d.description)}</textarea></div>
        <div class="form-field"><label>Original prompt *</label><textarea id="pf-prompt" rows="10" style="font-family:var(--font-mono);font-size:12.5px;">${escapeHtml(d.originalPrompt)}</textarea></div>
        <div style="display:grid;grid-template-columns:1fr 1fr;gap:14px;">
          <div class="form-field"><label>Variables <span style="color:var(--text-faint);font-weight:400;">— comma / newline</span></label><textarea id="pf-vars" rows="2">${escapeHtml(d.variables)}</textarea></div>
          <div class="form-field"><label>Tags <span style="color:var(--text-faint);font-weight:400;">— comma / newline</span></label><textarea id="pf-tags" rows="2">${escapeHtml(d.tags)}</textarea></div>
        </div>
        <div style="display:flex;gap:8px;margin-top:8px;">
          <button class="btn btn-primary" id="pf-save">${d.id ? "Save changes" : "Create prompt"}</button>
          <button class="btn" id="pf-cancel">Cancel</button>
        </div>
      </div>`;
    const readForm = () => ({
      title: body.querySelector("#pf-title").value.trim(),
      category: body.querySelector("#pf-cat").value,
      role: body.querySelector("#pf-role").value.trim(),
      useCase: body.querySelector("#pf-uc").value.trim(),
      description: body.querySelector("#pf-desc").value.trim(),
      originalPrompt: body.querySelector("#pf-prompt").value.trim(),
      promptType: body.querySelector("#pf-type").value.trim(),
      difficulty: body.querySelector("#pf-diff").value,
      lifecycle: body.querySelector("#pf-lc").value,
      variables: splitList(body.querySelector("#pf-vars").value),
      tags: splitList(body.querySelector("#pf-tags").value),
    });
    body.querySelector("#pf-prompt").addEventListener("input", () => {
      const lvl = (typeof deriveFrameworkLevel === "function")
        ? deriveFrameworkLevel({ originalPrompt: body.querySelector("#pf-prompt").value }).frameworkLevel : null;
      body.querySelector("#pf-fw").value = lvl ? "Level " + lvl : "—";
    });
    body.querySelector("#pr-back").addEventListener("click", () => { st.editing = null; paint(); });
    body.querySelector("#pf-cancel").addEventListener("click", () => { st.editing = null; paint(); });
    body.querySelector("#pf-save").addEventListener("click", () => {
      const f = readForm();
      if (f.title.length < 3) return showToast("Give the prompt a title");
      if (f.originalPrompt.length < 10) return showToast("Add the prompt text");
      const btn = body.querySelector("#pf-save"); btn.disabled = true; btn.textContent = "Saving…";
      const payload = d.id
        ? { action: "update", id: d.id, patch: f, allowExcel: true }
        : { action: "create", prompt: f };
      Backend.adminSavePrompt(payload).then(() => { showToast("Prompt saved"); st.editing = null; load(); })
        .catch((e) => {
          btn.disabled = false; btn.textContent = d.id ? "Save changes" : "Create prompt";
          const err = e && (e.message || (e.data && e.data.error));
          showToast(err === "duplicate" ? "A prompt with this title + category already exists"
            : err === "schema-out-of-date" ? "Server database is behind — run npm run migrate:v3"
            : "Couldn't save: " + (err || "error"));
        });
    });
  }

  function paintImport() {
    const imp = st.imp;
    if (imp.stage === "pick") {
      body.innerHTML = `
        <button class="btn btn-ghost btn-sm" id="pi-back" style="margin-bottom:10px;">← All prompts</button>
        <h2 style="font-size:18px;margin:0 0 8px;">Bulk import</h2>
        <p class="prose" style="color:var(--text-muted);max-width:640px;">
          Upload a <b>.csv</b> or <b>.json</b> file. Columns: <code>${PROMPT_IMPORT_COLS.join(", ")}</code>.
          Rows are matched by <code>id</code>, else by normalised <code>title</code> + <code>category</code>
          (idempotent — re-importing the same file makes no duplicates). You'll see a preview before anything is written.
        </p>
        <input type="file" id="pi-file" accept=".csv,.json,text/csv,application/json" style="margin:12px 0;"/>
        <div id="pi-err" style="color:var(--danger);font-size:13px;"></div>`;
      body.querySelector("#pi-back").addEventListener("click", () => { st.imp = null; paint(); });
      body.querySelector("#pi-file").addEventListener("change", async (e) => {
        const file = e.target.files[0]; if (!file) return;
        body.querySelector("#pi-err").textContent = "";
        let rows;
        try { rows = await readPromptFile(file); }
        catch (err) { body.querySelector("#pi-err").textContent = "Couldn't parse that file."; return; }
        if (!rows.length) { body.querySelector("#pi-err").textContent = "No rows found in that file."; return; }
        imp.rows = rows; imp.stage = "loading"; paint();
        Backend.adminImportPrompts(rows, false).then((d) => { imp.result = d; imp.stage = "preview"; paint(); })
          .catch((err) => { imp.stage = "pick"; paint();
            showToast("Preview failed: " + (err && err.message || "error")); });
      });
      return;
    }
    if (imp.stage === "loading") {
      body.innerHTML = `<div class="skel" style="height:120px;"></div>`;
      return;
    }
    // preview
    const r = imp.result || { counts: {}, preview: [] };
    const c = r.counts || {};
    body.innerHTML = `
      <button class="btn btn-ghost btn-sm" id="pi-back" style="margin-bottom:10px;">← Cancel import</button>
      <h2 style="font-size:18px;margin:0 0 8px;">Import preview — ${(imp.rows || []).length} rows</h2>
      <div style="display:flex;gap:10px;flex-wrap:wrap;margin-bottom:12px;">
        <span class="chip chip-accent">${c.new || 0} new</span>
        <span class="chip">${c.update || 0} update</span>
        <span class="chip">${(c["duplicate-in-file"] || 0)} dupe in file</span>
        <span class="chip" style="color:var(--danger);">${c.invalid || 0} invalid</span>
      </div>
      <div style="overflow-x:auto;max-height:420px;overflow-y:auto;">
      <table class="admin-table">
        <thead><tr><th>#</th><th>Status</th><th>Title</th><th>Category</th><th>Reason</th></tr></thead>
        <tbody>${(r.preview || []).map((p) => `<tr>
          <td>${p.index + 1}</td>
          <td><span class="chip ${p.status === "invalid" ? "" : "chip-accent"}">${escapeHtml(p.status)}</span></td>
          <td style="max-width:340px;">${escapeHtml(p.title || "—")}</td>
          <td>${escapeHtml(p.category || "—")}</td>
          <td style="color:var(--text-faint);">${escapeHtml(p.reason || "")}</td>
        </tr>`).join("")}</tbody>
      </table></div>
      <div style="display:flex;gap:8px;margin-top:12px;">
        <button class="btn btn-primary" id="pi-commit" ${(c.new || 0) + (c.update || 0) === 0 ? "disabled" : ""}>Commit ${(c.new || 0) + (c.update || 0)} change(s)</button>
        <button class="btn" id="pi-cancel">Cancel</button>
      </div>`;
    const back = () => { st.imp = null; paint(); };
    body.querySelector("#pi-back").addEventListener("click", back);
    body.querySelector("#pi-cancel").addEventListener("click", back);
    body.querySelector("#pi-commit").addEventListener("click", () => {
      const btn = body.querySelector("#pi-commit"); btn.disabled = true; btn.textContent = "Importing…";
      Backend.adminImportPrompts(imp.rows, true).then((d) => {
        const cc = d.counts || {};
        showToast(`Imported: ${cc.new || 0} new, ${cc.update || 0} updated`);
        st.imp = null; st.page = 0; load();
      }).catch((e) => { btn.disabled = false; btn.textContent = "Commit"; showToast("Import failed: " + (e && e.message || "error")); });
    });
  }

  load();
}

/* ---------- Function access: per-function library scope (schema_v3
   function_scopes). Drives what a function/signup learner sees — no code. */
function renderAdminFunctions(body) {
  const st = ADMIN_STATE.fn || (ADMIN_STATE.fn = { list: null, editing: null });
  body.innerHTML = `<div class="skel" style="height:120px;"></div>`;

  const load = () => Backend.adminFunctions().then((list) => { st.list = list; paint(); })
    .catch(() => { body.innerHTML = emptyStateHtml("slider", "Couldn't load function access", "Try again in a moment."); });

  function paint() {
    if (st.editing) return paintEditor();
    const rows = st.list || [];
    body.innerHTML = `
      <p class="prose" style="color:var(--text-muted);max-width:680px;margin:6px 0 14px;">
        Set the categories, programs and individual prompts each function/department can browse.
        A learner who signs up and picks that function gets this scope automatically — no access code.
        Leave a function untouched to use its built-in default.
      </p>
      <div style="overflow-x:auto;">
      <table class="admin-table">
        <thead><tr><th>Function</th><th>Categories</th><th>Programs</th><th>Pinned prompts</th><th>Learners</th><th>Status</th><th></th></tr></thead>
        <tbody>
          ${rows.map((r) => {
            const s = r.scope;
            const cats = s ? s.categories.length : r.default.categories.length;
            const progs = s ? s.programIds.length : r.default.programIds.length;
            const pinned = s ? s.promptIds.length : 0;
            return `<tr>
              <td><b>${escapeHtml(r.label)}</b><div style="color:var(--text-faint);font-size:11px;">${escapeHtml(r.key)}</div></td>
              <td>${cats}</td><td>${progs}</td><td>${pinned}</td>
              <td>${r.learners}</td>
              <td>${s ? (s.enabled ? `<span class="chip chip-accent">Custom</span>` : `<span class="chip">Disabled</span>`) : `<span class="chip">Default</span>`}</td>
              <td><button class="btn btn-sm btn-ghost" data-fnedit="${escapeHtml(r.key)}">${icon("slider")} Edit</button></td>
            </tr>`;
          }).join("")}
        </tbody>
      </table></div>`;
    body.querySelectorAll("[data-fnedit]").forEach((b) => b.addEventListener("click", () => {
      const r = st.list.find((x) => x.key === b.dataset.fnedit);
      const s = r.scope;
      st.editing = {
        key: r.key, label: r.label, learners: r.learners,
        def: r.default,
        categories: s ? s.categories.slice() : r.default.categories.slice(),
        programIds: s ? s.programIds.slice() : r.default.programIds.slice(),
        promptIds: s ? s.promptIds.slice() : [],
        enabled: s ? s.enabled : true,
        isCustom: !!s,
      };
      paint();
    }));
  }

  function paintEditor() {
    const d = st.editing;
    const allCats = (typeof CATEGORIES !== "undefined" ? CATEGORIES : []).map((c) => c.name).sort();
    const programs = allProgramsList();
    body.innerHTML = `
      <div style="max-width:860px;">
        <button class="btn btn-ghost btn-sm" id="fn-back" style="margin-bottom:10px;">← All functions</button>
        <div class="section-title" style="margin-bottom:4px;"><h2 style="font-size:18px;">${escapeHtml(d.label)} <span style="color:var(--text-faint);font-weight:400;font-size:13px;">${escapeHtml(d.key)}</span></h2></div>
        <div style="color:var(--text-muted);font-size:12.5px;margin-bottom:14px;">${d.learners} current learner${d.learners === 1 ? "" : "s"} on this function. Saving changes what NEW signups see; use “Re-apply” to also re-scope current learners.</div>

        <label class="auth-check" style="margin-bottom:12px;"><input type="checkbox" id="fn-enabled" ${d.enabled ? "checked" : ""}/> Active (uncheck to fall back to the built-in default without deleting this scope)</label>

        <div class="form-field"><label>Categories <span style="font-weight:400;color:var(--text-faint)">— the browsable Categories for this function</span></label>
          <div style="margin:-2px 0 8px;"><button class="btn btn-sm" id="fn-cat-default" type="button">Use default (${d.def.categories.length})</button></div>
          ${checkGroupHtml("data-fncat", allCats, d.categories)}
        </div>

        <div class="form-field"><label>Programs <span style="font-weight:400;color:var(--text-faint)">— their module-linked prompts are always included</span></label>
          ${checkGroupHtml("data-fnprog", programs.map((p) => ({ value: p.id, label: p.name, extra: "· " + p.org })), d.programIds)}
        </div>

        <div class="form-field"><label for="fn-pins">Pinned prompt IDs <span style="font-weight:400;color:var(--text-faint)">— extra individual prompts, one per line or comma-separated</span></label>
          <textarea id="fn-pins" rows="4" style="font-family:var(--font-mono);font-size:12px;">${escapeHtml(d.promptIds.join("\n"))}</textarea>
        </div>

        <div style="background:var(--surface-2);border:1px solid var(--border);border-radius:var(--radius);padding:12px 14px;font-size:12.5px;color:var(--text-muted);margin:6px 0 16px;">
          <b>Scope preview:</b> <span id="fn-preview"></span>
        </div>

        <div style="display:flex;gap:8px;flex-wrap:wrap;">
          <button class="btn btn-primary" id="fn-save">Save</button>
          <button class="btn" id="fn-reapply" ${d.learners ? "" : "disabled"}>Save &amp; re-apply to ${d.learners} learner${d.learners === 1 ? "" : "s"}</button>
          <div style="flex:1;"></div>
          <button class="btn" id="fn-reset" ${d.isCustom ? "" : "disabled"}>Reset to default</button>
        </div>
      </div>`;

    const read = () => {
      d.enabled = body.querySelector("#fn-enabled").checked;
      d.categories = [...body.querySelectorAll("[data-fncat]:checked")].map((x) => x.value);
      d.programIds = [...body.querySelectorAll("[data-fnprog]:checked")].map((x) => x.value);
      d.promptIds = body.querySelector("#fn-pins").value.split(/[\s,]+/).map((s) => s.trim()).filter(Boolean);
    };
    const refreshPreview = () => {
      read();
      const cats = new Set(d.categories);
      const linked = new Set(d.promptIds);
      d.programIds.forEach((pid) => (typeof programPromptIds === "function" ? programPromptIds(pid) : []).forEach((id) => linked.add(id)));
      const n = ALL_PROMPTS.filter((r) => cats.has(r.category) || linked.has(r.id)).length;
      const known = d.promptIds.filter((id) => ALL_PROMPTS_BY_ID[id]).length;
      body.querySelector("#fn-preview").textContent =
        `${n.toLocaleString()} prompts across ${cats.size} categor${cats.size === 1 ? "y" : "ies"}` +
        (d.promptIds.length ? ` · ${known}/${d.promptIds.length} pinned IDs match a prompt` : "") +
        (d.enabled ? "" : " · (inactive — learners get the default)");
    };
    body.querySelectorAll("input,textarea").forEach((el) => el.addEventListener("input", refreshPreview));
    wireCheckGroups(body, refreshPreview);
    body.querySelector("#fn-back").addEventListener("click", () => { st.editing = null; paint(); });
    body.querySelector("#fn-cat-default").addEventListener("click", () => { read(); d.categories = d.def.categories.slice(); st.editing = d; paintEditor(); });

    const save = (reapply) => {
      read();
      const btn = body.querySelector(reapply ? "#fn-reapply" : "#fn-save");
      btn.disabled = true; btn.textContent = reapply ? "Saving…" : "Saving…";
      Backend.adminSaveFunction({ functionKey: d.key, categories: d.categories, programIds: d.programIds, promptIds: d.promptIds, enabled: d.enabled })
        .then(() => reapply ? Backend.adminReapplyFunction(d.key) : 0)
        .then((n) => {
          showToast(reapply ? `Saved · re-applied to ${n} learner${n === 1 ? "" : "s"}` : "Function scope saved");
          st.editing = null; load();
        })
        .catch(() => { btn.disabled = false; btn.textContent = reapply ? `Save & re-apply to ${d.learners} learners` : "Save"; showToast("Couldn't save to the server"); });
    };
    body.querySelector("#fn-save").addEventListener("click", () => save(false));
    body.querySelector("#fn-reapply").addEventListener("click", () => save(true));
    body.querySelector("#fn-reset").addEventListener("click", () => {
      if (!confirm("Reset " + d.label + " to the built-in default? Current learners keep their scope until they change function or you re-assign.")) return;
      Backend.adminResetFunction(d.key).then(() => { showToast("Reset to default"); st.editing = null; load(); })
        .catch(() => showToast("Couldn't reset on the server"));
    });
    refreshPreview();
  }

  load();
}

function renderAdminAnalytics(body) {
  body.innerHTML = `
    <div style="display:flex;align-items:center;gap:10px;margin:6px 0 14px;">
      <div class="result-count" style="padding:0;">Learner activity, all organisations</div>
      <div style="flex:1;"></div>
      <select id="an-days">${[7, 30, 90, 365].map((d) => `<option value="${d}" ${d === (ADMIN_STATE.anDays || 30) ? "selected" : ""}>Last ${d} days</option>`).join("")}</select>
    </div>
    <div id="an-body"><div class="skel" style="height:120px;"></div></div>`;
  body.querySelector("#an-days").addEventListener("change", (e) => { ADMIN_STATE.anDays = +e.target.value; renderAdminAnalytics(body); });
  const target = body.querySelector("#an-body");
  Backend.adminAnalytics(ADMIN_STATE.anDays || 30).then((d) => {
    if (!d) { target.innerHTML = emptyStateHtml("chart", "No analytics yet", "Activity shows up here once learners start using their codes."); return; }
    const t = d.totals || {};
    const bar = (rows, labelKey, valKey, extra) => {
      const max = Math.max(1, ...rows.map((r) => r[valKey]));
      return rows.map((r) => `<div class="bar-row"><span class="bar-label">${escapeHtml(String(r[labelKey] ?? "—"))}</span><span class="bar-track"><i style="width:${(r[valKey] / max) * 100}%"></i></span><span class="bar-val tabular">${r[valKey]}${extra ? extra(r) : ""}</span></div>`).join("");
    };
    target.innerHTML = `
      <div class="stat-grid">
        <div class="stat-tile"><div class="num tabular">${(t.events || 0).toLocaleString()}</div><div class="label">Events</div></div>
        <div class="stat-tile"><div class="num tabular">${(t.learners || 0).toLocaleString()}</div><div class="label">Active learners</div></div>
        <div class="stat-tile"><div class="num tabular">${(t.codes || 0).toLocaleString()}</div><div class="label">Codes in use</div></div>
        <div class="stat-tile"><div class="num tabular">${(d.signins || 0).toLocaleString()}</div><div class="label">Sign-ins</div></div>
      </div>
      <div class="section-title"><h2>By event</h2></div>
      <div style="margin-bottom:24px;">${bar(d.byEvent || [], "event", "n")}</div>
      <div class="section-title"><h2>By access code</h2></div>
      <div style="margin-bottom:24px;">${bar((d.byCode || []).slice(0, 15), "code", "n", (r) => ` · ${r.learners} learner${r.learners === 1 ? "" : "s"}`)}</div>
      <div class="section-title"><h2>Most-used prompts</h2></div>
      <div>${bar((d.topPrompts || []).slice(0, 15), "title", "n")}</div>`;
  }).catch(() => { target.innerHTML = emptyStateHtml("chart", "Couldn't load analytics", "Try again in a moment."); });
}

function allProgramsList() {
  return (ORG_MODEL.programs || []).map((p) => ({ id: p.id, name: p.name, org: (ORG_INDEX.orgs[p.orgId] || {}).name || "", scope: p.scope }));
}
function renderAdminCodes(body) {
  const admin = AdminStore.getCodes();
  const staticCodes = (ORG_MODEL.accessCodes || []).map((a) => {
    const r = resolveStaticAccessCode(a.code);
    return { code: a.code, orgName: r && r.org ? r.org.name : "", industry: "—", domain: "—",
      programs: r && r.program ? [r.program.name] : [], builtIn: true, enabled: true };
  });
  const rows = admin.map((c) => ({
    id: c.id, code: c.code, orgName: c.orgName, industry: c.industry || "—", domain: c.domain || "—",
    programs: c.fullLibrary ? ["Full library"] : (c.programIds || []).map((p) => (ORG_INDEX.programs[p] || {}).name || p),
    functions: c.functions || [], enabled: c.enabled !== false, builtIn: false,
  })).concat(staticCodes);

  body.innerHTML = `
    <div style="display:flex;align-items:center;gap:10px;margin:6px 0 14px;">
      <div class="result-count" style="padding:0;">${admin.length} organisation code${admin.length === 1 ? "" : "s"} · ${staticCodes.length} built-in</div>
      <div style="flex:1;"></div>
      <button class="btn btn-sm" id="admin-copyall">${icon("copy")} Copy all codes</button>
      <button class="btn btn-primary btn-sm" id="admin-new">${icon("plus")} New access code</button>
    </div>
    <div style="overflow-x:auto;">
    <table class="admin-table">
      <thead><tr><th>Code</th><th>Organisation</th><th>Industry</th><th>Domain</th><th>Programs</th><th>Enabled</th><th></th></tr></thead>
      <tbody>
        ${rows.map((r) => `
          <tr data-id="${r.id || ""}">
            <td><span class="admin-code">${escapeHtml(r.code)}</span>${r.builtIn ? ` <span class="chip" style="font-size:10px;">built-in</span>` : ""}</td>
            <td>${escapeHtml(r.orgName || "—")}${(r.functions && r.functions.length) ? `<div style="color:var(--text-faint);font-size:11px;margin-top:2px;">${escapeHtml(r.functions.join(", "))}</div>` : ""}</td>
            <td>${escapeHtml(r.industry)}</td>
            <td>${escapeHtml(r.domain)}</td>
            <td>${escapeHtml((r.programs || []).join(", ") || "—")}</td>
            <td>${r.builtIn ? `<span class="chip" style="font-size:10px;">always</span>` : `<button class="switch ${r.enabled ? "on" : ""}" data-toggle="${r.id}" aria-label="Toggle"><i></i></button>`}</td>
            <td style="white-space:nowrap;">
              <button class="btn btn-sm btn-ghost" data-viewas="${escapeHtml(r.code)}" title="Open the library as a learner on this code">${icon("eye")}</button>
              <button class="btn btn-sm btn-ghost" data-copy="${escapeHtml(r.code)}" title="Copy code">${icon("copy")}</button>
              ${r.builtIn ? "" : `<button class="btn btn-sm btn-ghost" data-edit="${r.id}" title="Edit">${icon("slider")}</button>`}
              <button class="btn btn-sm btn-ghost" data-dl="${r.id || ""}" data-dlcode="${escapeHtml(r.code)}" title="Download prompts">${icon("download")}</button>
              ${r.builtIn ? "" : `<button class="btn btn-sm btn-ghost" data-del="${r.id}" title="Delete">${icon("x")}</button>`}
            </td>
          </tr>`).join("")}
      </tbody>
    </table>
    </div>`;

  body.querySelector("#admin-new").addEventListener("click", () => { ADMIN_STATE.editing = newCodeDraft(); ADMIN_STATE.tab = "edit"; renderAdminConsole(); });
  body.querySelector("#admin-copyall").addEventListener("click", async () => {
    const lines = ["Synottic Prompt Intelligence — access codes", "", "Admin console: " + AdminStore.key(), ""];
    rows.forEach((r) => {
      lines.push(r.code + "  —  " + (r.orgName || "") +
        (r.programs && r.programs.length ? "  (" + r.programs.slice(0, 3).join(", ") + (r.programs.length > 3 ? ", +" + (r.programs.length - 3) : "") + ")" : "") +
        (r.builtIn ? "  [built-in]" : r.enabled ? "" : "  [disabled]"));
    });
    const ok = await copyText(lines.join("\n"));
    showToast(ok ? rows.length + " codes copied" : "Couldn't copy");
  });
  body.querySelectorAll("[data-toggle]").forEach((b) => b.addEventListener("click", () => {
    const c = AdminStore.getById(b.dataset.toggle);
    AdminStore.setEnabled(b.dataset.toggle, !(c && c.enabled !== false) ? true : false);
    renderAdminConsole();
  }));
  body.querySelectorAll("[data-copy]").forEach((b) => b.addEventListener("click", async () => {
    await copyText(b.dataset.copy); showToast("Code copied");
  }));
  body.querySelectorAll("[data-viewas]").forEach((b) => b.addEventListener("click", () => previewAs(b.dataset.viewas)));
  body.querySelectorAll("[data-edit]").forEach((b) => b.addEventListener("click", () => {
    ADMIN_STATE.editing = Object.assign(newCodeDraft(), JSON.parse(JSON.stringify(AdminStore.getById(b.dataset.edit))));
    ADMIN_STATE.tab = "edit"; renderAdminConsole();
  }));
  body.querySelectorAll("[data-del]").forEach((b) => b.addEventListener("click", () => {
    if (confirm("Delete this access code? Learners using it will lose access.")) { AdminStore.remove(b.dataset.del); renderAdminConsole(); }
  }));
  body.querySelectorAll("[data-dl]").forEach((b) => b.addEventListener("click", () => {
    const c = b.dataset.dl && AdminStore.getById(b.dataset.dl);
    let sel;
    if (c) sel = { orgName: c.orgName, industry: c.industry, domain: c.domain, functions: c.functions, roles: c.roles, programIds: c.programIds };
    else {
      const st = resolveStaticAccessCode(b.dataset.dlcode);
      sel = { orgName: st && st.org ? st.org.name : "", programIds: st && st.program ? [st.program.id] : [] };
    }
    const list = promptsForSelection(sel);
    exportPromptsXlsx(list, (sel.orgName || b.dataset.dlcode) + "-prompts", selectionSummary(sel));
  }));
}

function checkGrid(name, options, selected, groups) {
  const sel = new Set(selected || []);
  if (groups) {
    return `<div class="checkgrid">${groups.map((g) => `
      <div class="role-fn-group">${escapeHtml(g.fn)}</div>
      ${g.roles.map((r) => `<label><input type="checkbox" data-check="${name}" value="${escapeHtml(r)}" ${sel.has(r) ? "checked" : ""}/> ${escapeHtml(r)}</label>`).join("")}
    `).join("")}</div>`;
  }
  return `<div class="checkgrid">${options.map((o) => `<label><input type="checkbox" data-check="${name}" value="${escapeHtml(o.value || o)}" ${sel.has(o.value || o) ? "checked" : ""}/> ${escapeHtml(o.label || o)}</label>`).join("")}</div>`;
}
function renderAdminEdit(body) {
  const d = ADMIN_STATE.editing || (ADMIN_STATE.editing = newCodeDraft());
  const programs = allProgramsList();
  body.innerHTML = `
    <div style="max-width:820px;">
      <div style="display:grid;grid-template-columns:1fr 1fr;gap:14px;">
        <div class="form-field"><label>Organisation name *</label><input type="text" id="f-org" value="${escapeHtml(d.orgName)}" placeholder="Acme Corporation"/></div>
        <div class="form-field"><label>Domain</label><input type="text" id="f-domain" value="${escapeHtml(d.domain)}" placeholder="acme.com"/></div>
        <div class="form-field"><label>Industry</label>
          <select id="f-industry"><option value="">—</option>${INDUSTRIES.map((i) => `<option ${d.industry === i ? "selected" : ""}>${escapeHtml(i)}</option>`).join("")}</select></div>
        <div class="form-field"><label>Access code *</label>
          <div style="display:flex;gap:6px;"><input type="text" id="f-code" value="${escapeHtml(d.code)}" placeholder="ACME-7X2Q" style="font-family:var(--font-mono);"/>
          <button class="btn btn-sm" id="f-gen" type="button">Generate</button></div></div>
      </div>

      <div class="form-field"><label>Relevant functions <span style="font-weight:400;color:var(--text-faint)">— set which prompt areas this organisation gets</span></label>
        ${checkGroupHtml('data-check="functions"', FUNCTION_NAMES, d.functions)}
      </div>
      <div class="form-field"><label>Relevant roles <span style="font-weight:400;color:var(--text-faint)">— optional refinement, grouped by function</span></label>
        ${checkGrid("roles", null, d.roles, rolesGroupedByFunction())}
      </div>

      <div class="form-field"><label>Relevant programs</label>
        <label style="display:flex;gap:7px;align-items:center;font-weight:400;margin-bottom:8px;"><input type="checkbox" id="f-full" ${d.fullLibrary ? "checked" : ""}/> Full library access (ignore function/program scoping)</label>
        <div id="f-programs" ${d.fullLibrary ? 'style="opacity:.45;pointer-events:none;"' : ""}>
          ${checkGroupHtml('data-check="programIds"', programs.map((p) => ({ value: p.id, label: p.name, extra: "· " + p.org })), d.programIds || [])}
        </div>
      </div>
      <div class="form-field"><label>Internal note</label><input type="text" id="f-note" value="${escapeHtml(d.note || "")}" placeholder="e.g. Pilot cohort, renews Q2"/></div>

      <div style="background:var(--surface-2);border:1px solid var(--border);border-radius:var(--radius);padding:12px 14px;font-size:12.5px;color:var(--text-muted);margin:6px 0 16px;">
        <b>Scope preview:</b> <span id="f-preview"></span>
      </div>

      <div style="display:flex;gap:8px;">
        <button class="btn btn-primary" id="f-save">${d.code && AdminStore.getById(d.id) ? "Save changes" : "Create access code"}</button>
        <button class="btn" id="f-cancel">Cancel</button>
        <div style="flex:1;"></div>
        <button class="btn" id="f-dl">${icon("download")} Download these prompts (.xlsx)</button>
      </div>
    </div>`;

  const read = () => {
    d.orgName = body.querySelector("#f-org").value.trim();
    d.domain = body.querySelector("#f-domain").value.trim();
    d.industry = body.querySelector("#f-industry").value;
    d.code = body.querySelector("#f-code").value.trim().toUpperCase();
    d.note = body.querySelector("#f-note").value.trim();
    d.fullLibrary = body.querySelector("#f-full").checked;
    d.functions = [...body.querySelectorAll('[data-check="functions"]:checked')].map((x) => x.value);
    d.roles = [...body.querySelectorAll('[data-check="roles"]:checked')].map((x) => x.value);
    d.programIds = [...body.querySelectorAll('[data-check="programIds"]:checked')].map((x) => x.value);
  };
  const refreshPreview = () => {
    read();
    const list = promptsForSelection({ functions: d.functions, roles: d.roles, programIds: d.programIds });
    body.querySelector("#f-preview").textContent = d.fullLibrary
      ? `Full library — ${ALL_PROMPTS.length.toLocaleString()} prompts.`
      : `${list.length.toLocaleString()} prompts across ${new Set(list.map((r) => r.category)).size} categories.`;
  };
  body.querySelectorAll("input,select").forEach((el) => el.addEventListener("input", refreshPreview));
  wireCheckGroups(body, refreshPreview);
  body.querySelector("#f-full").addEventListener("change", () => renderAdminEdit(body));
  body.querySelector("#f-gen").addEventListener("click", () => { read(); body.querySelector("#f-code").value = suggestCode(d.orgName); refreshPreview(); });
  body.querySelector("#f-cancel").addEventListener("click", () => { ADMIN_STATE.editing = null; ADMIN_STATE.tab = "codes"; renderAdminConsole(); });
  body.querySelector("#f-dl").addEventListener("click", () => {
    read();
    const list = d.fullLibrary ? ALL_PROMPTS.slice().sort((a, b) => b.qualityScore - a.qualityScore) : promptsForSelection({ functions: d.functions, roles: d.roles, programIds: d.programIds });
    exportPromptsXlsx(list, (d.orgName || d.code || "synottic") + "-prompts", selectionSummary({ orgName: d.orgName, industry: d.industry, domain: d.domain, functions: d.functions, roles: d.roles, programIds: d.programIds }));
  });
  body.querySelector("#f-save").addEventListener("click", () => {
    read();
    if (!d.orgName || !d.code) { showToast("Organisation name and code are required"); return; }
    const clash = AdminStore.getCode(d.code);
    if (clash && clash.id !== d.id) { showToast("That code is already in use"); return; }
    if (resolveStaticAccessCode(d.code)) { showToast("That code collides with a built-in code"); return; }
    if (!d.fullLibrary && !d.functions.length && !d.programIds.length) { showToast("Pick at least one function or program, or tick Full library"); return; }
    AdminStore.upsert(d);
    ADMIN_STATE.editing = null; ADMIN_STATE.tab = "codes";
    showToast("Access code saved");
    renderAdminConsole();
  });
  refreshPreview();
}

function renderAdminDownload(body) {
  const dl = ADMIN_STATE.dl;
  const codes = AdminStore.getCodes();
  const programs = allProgramsList();
  body.innerHTML = `
    <p class="prose" style="color:var(--text-muted);max-width:640px;margin:6px 0 16px;">
      Export the prompts that match a domain / industry / function / role / program as an Excel file.
      Pick an existing access code to prefill, or set filters manually.
    </p>
    <div style="display:grid;grid-template-columns:1fr 1fr 1fr;gap:14px;max-width:820px;">
      <div class="form-field"><label>From access code</label>
        <select id="d-code"><option value="">— none —</option>${codes.map((c) => `<option value="${c.id}" ${dl.codeId === c.id ? "selected" : ""}>${escapeHtml(c.code)} · ${escapeHtml(c.orgName)}</option>`).join("")}</select></div>
      <div class="form-field"><label>Industry</label>
        <select id="d-industry"><option value="">Any</option>${INDUSTRIES.map((i) => `<option ${dl.industry === i ? "selected" : ""}>${escapeHtml(i)}</option>`).join("")}</select></div>
      <div class="form-field"><label>Domain</label><input type="text" id="d-domain" value="${escapeHtml(dl.domain || "")}" placeholder="acme.com"/></div>
      <div class="form-field"><label>Function</label>
        <select id="d-function"><option value="">Any</option>${FUNCTION_NAMES.map((f) => `<option ${(dl.functions || [])[0] === f ? "selected" : ""}>${escapeHtml(f)}</option>`).join("")}</select></div>
      <div class="form-field"><label>Role</label>
        <select id="d-role"><option value="">Any</option>${ALL_ROLES.map((r) => `<option ${(dl.roles || [])[0] === r ? "selected" : ""}>${escapeHtml(r)}</option>`).join("")}</select></div>
      <div class="form-field"><label>Program</label>
        <select id="d-program"><option value="">Any</option>${programs.map((p) => `<option value="${p.id}" ${dl.programId === p.id ? "selected" : ""}>${escapeHtml(p.name)}</option>`).join("")}</select></div>
    </div>
    <div style="background:var(--surface-2);border:1px solid var(--border);border-radius:var(--radius);padding:14px 16px;max-width:820px;margin:6px 0 14px;">
      <div style="font-weight:600;margin-bottom:4px;" id="d-count">—</div>
      <div style="font-size:12px;color:var(--text-faint);" id="d-summary"></div>
    </div>
    <div style="display:flex;gap:8px;">
      <button class="btn btn-primary" id="d-xlsx">${icon("download")} Download .xlsx</button>
      <button class="btn" id="d-csv">Download .csv</button>
      <button class="btn btn-ghost" id="d-preview">Preview first 20</button>
    </div>
    <div id="d-list" style="margin-top:16px;"></div>`;

  function currentSel() {
    const codeId = body.querySelector("#d-code").value;
    if (codeId) {
      const c = AdminStore.getById(codeId);
      return { codeId, orgName: c.orgName, industry: c.industry, domain: c.domain, functions: c.functions || [], roles: c.roles || [], programIds: c.programIds || [] };
    }
    const fn = body.querySelector("#d-function").value;
    const role = body.querySelector("#d-role").value;
    return {
      industry: body.querySelector("#d-industry").value,
      domain: body.querySelector("#d-domain").value.trim(),
      functions: fn ? [fn] : [],
      roles: role ? [role] : [],
      programId: body.querySelector("#d-program").value,
    };
  }
  function refresh() {
    const sel = currentSel();
    const list = promptsForSelection(sel);
    ADMIN_STATE.dl = { industry: body.querySelector("#d-industry").value, domain: body.querySelector("#d-domain").value, functions: sel.functions, roles: sel.roles, programId: body.querySelector("#d-program").value, codeId: body.querySelector("#d-code").value };
    body.querySelector("#d-count").textContent = `${list.length.toLocaleString()} prompt${list.length === 1 ? "" : "s"} match`;
    body.querySelector("#d-summary").textContent = selectionSummary(sel);
    return list;
  }
  body.querySelectorAll("select,input").forEach((el) => el.addEventListener("input", () => { refresh(); body.querySelector("#d-list").innerHTML = ""; }));
  body.querySelector("#d-xlsx").addEventListener("click", () => {
    const sel = currentSel(); const list = refresh();
    exportPromptsXlsx(list, (sel.orgName || sel.functions[0] || sel.industry || "synottic") + "-prompts", selectionSummary(sel));
  });
  body.querySelector("#d-csv").addEventListener("click", () => {
    const sel = currentSel(); const list = refresh();
    exportPromptsCsv(list, (sel.orgName || sel.functions[0] || sel.industry || "synottic") + "-prompts");
  });
  body.querySelector("#d-preview").addEventListener("click", () => {
    const list = refresh().slice(0, 20);
    body.querySelector("#d-list").innerHTML = `<div class="results-list">${list.map((r) => promptCardHtml(r)).join("")}</div>`;
  });
  refresh();
}

/* ==========================================================================
   USER MANAGEMENT CONSOLE  — paginated/searchable/filterable table on
   /api/admin/users + a detail drawer aggregating /api/admin/{users,entitlements,
   audit}. Row + bulk lifecycle actions; add-user (invite); entitlement controls.
   ========================================================================== */
const AU_FUNCTIONS = (typeof SIGNUP_FUNCTIONS !== "undefined" ? SIGNUP_FUNCTIONS : []);
const AU_LEVELS = ["beginner", "foundational", "intermediate", "advanced", "expert"];
const AU_ACCOUNT_STATUSES = ["pending_verification", "active", "suspended", "disabled"];
const AU_ENT_SOURCES = ["self_signup", "auto_function", "access_code", "admin"];
const AU_ENT_STATUSES = ["active", "suspended", "expired", "revoked", "none"];
function auFnLabel(key) {
  const f = AU_FUNCTIONS.find((x) => x[0] === key);
  return f ? f[1] : (key || "—");
}
function auTimeAgo(ts) {
  if (!ts) return "—";
  const s = Math.floor((Date.now() - new Date(ts).getTime()) / 1000);
  if (s < 60) return "just now";
  if (s < 3600) return Math.floor(s / 60) + "m ago";
  if (s < 86400) return Math.floor(s / 3600) + "h ago";
  return Math.floor(s / 86400) + "d ago";
}
function isSuperAdmin() {
  try { return (sessionStorage.getItem("prompt-lib:admin-role") || "") === "SUPER_ADMIN"; } catch (e) { return false; }
}

function renderAdminUsers(body) {
  const st = ADMIN_STATE.users || (ADMIN_STATE.users = {
    f: { q: "", org: "", role: "", status: "", verified: "", entSource: "", entStatus: "" },
    page: 0, limit: 25, data: null, sel: {}, drawer: null, adding: false,
  });

  const query = () => Object.assign({ limit: st.limit, offset: st.page * st.limit }, st.f);
  const load = () => {
    body.querySelector("#au-tbody") && (body.querySelector("#au-tbody").innerHTML = `<tr><td colspan="10"><div class="skel" style="height:80px;"></div></td></tr>`);
    return Backend.adminUsers(query()).then((d) => { st.data = d; paint(); })
      .catch(() => { body.innerHTML = emptyStateHtml("slider", "Couldn't load users", "Check the admin session and try again."); });
  };

  function paint() {
    if (st.drawer) return paintDrawer();
    const d = st.data || { users: [], total: 0 };
    const selIds = Object.keys(st.sel).filter((k) => st.sel[k]);
    const f = st.f;
    const opt = (arr, cur, labelFn) => arr.map((v) => `<option value="${escapeHtml(Array.isArray(v) ? v[0] : v)}" ${cur === (Array.isArray(v) ? v[0] : v) ? "selected" : ""}>${escapeHtml(labelFn ? labelFn(v) : (Array.isArray(v) ? v[1] : v))}</option>`).join("");
    body.innerHTML = `
      <div style="display:flex;gap:8px;flex-wrap:wrap;align-items:center;margin:6px 0 12px;">
        <input type="text" id="au-q" value="${escapeHtml(f.q)}" placeholder="Search name or email…" style="width:200px;"/>
        <input type="text" id="au-org" value="${escapeHtml(f.org)}" placeholder="Organisation…" style="width:150px;"/>
        <select id="au-role" style="width:auto;"><option value="">Any function</option>${opt(AU_FUNCTIONS, f.role)}</select>
        <select id="au-status" style="width:auto;"><option value="">Any status</option>${opt(AU_ACCOUNT_STATUSES, f.status, (v) => v.replace("_", " "))}</select>
        <select id="au-verified" style="width:auto;"><option value="">Any verification</option><option value="true" ${f.verified === "true" ? "selected" : ""}>Verified</option><option value="false" ${f.verified === "false" ? "selected" : ""}>Unverified</option></select>
        <select id="au-entsource" style="width:auto;"><option value="">Any ent. source</option>${opt(AU_ENT_SOURCES, f.entSource, (v) => v.replace("_", " "))}</select>
        <select id="au-entstatus" style="width:auto;"><option value="">Any ent. status</option>${opt(AU_ENT_STATUSES, f.entStatus)}</select>
        <button class="btn btn-sm" id="au-clear">Clear</button>
        <div style="flex:1;"></div>
        <button class="btn btn-primary btn-sm" id="au-add">${icon("plus")} Add user</button>
      </div>
      ${selIds.length ? `<div style="display:flex;gap:6px;flex-wrap:wrap;align-items:center;background:var(--surface-2);border:1px solid var(--border);border-radius:var(--radius);padding:8px 12px;margin-bottom:10px;">
        <b>${selIds.length} selected</b>
        ${["suspend", "reactivate", "disable", "force_verify", "resend_verification", "send_reset", "revoke_sessions", "align_function"].map((a) => `<button class="btn btn-sm btn-ghost" data-bulk="${a}">${a.replace(/_/g, " ")}</button>`).join("")}
        <button class="btn btn-sm" data-bulk="__clear">Clear selection</button>
      </div>` : ""}
      <div style="overflow-x:auto;">
      <table class="admin-table">
        <thead><tr>
          <th style="width:24px;"><input type="checkbox" id="au-all"/></th>
          <th>Name</th><th>Email</th><th>Org</th><th>Function</th><th>AI</th>
          <th>Account</th><th>Verified</th><th>Entitlement</th><th>Last activity</th>
        </tr></thead>
        <tbody id="au-tbody">
          ${d.users.map((u) => `
            <tr data-uid="${escapeHtml(u.id)}" style="cursor:pointer;">
              <td><input type="checkbox" data-selu="${escapeHtml(u.id)}" ${st.sel[u.id] ? "checked" : ""}/></td>
              <td>${escapeHtml(([u.firstName, u.lastName].filter(Boolean).join(" ")) || "—")}</td>
              <td>${escapeHtml(u.email)}</td>
              <td>${escapeHtml(u.organization || "—")}</td>
              <td>${escapeHtml(auFnLabel(u.role))}</td>
              <td>${escapeHtml(u.aiLevel || "—")}</td>
              <td><span class="chip ${u.accountStatus === "active" ? "chip-accent" : ""}">${escapeHtml((u.accountStatus || "").replace("_", " "))}</span></td>
              <td>${u.emailVerified ? "✓" : "—"}</td>
              <td>${u.entStatus === "none" ? `<span class="chip">none</span>` : `<span class="chip">${escapeHtml(u.entStatus)}</span> <span style="color:var(--text-faint);font-size:11px;">${escapeHtml((u.entSource || "").replace("_", " "))}</span>`}</td>
              <td style="color:var(--text-faint);font-size:11px;white-space:nowrap;">${auTimeAgo(u.lastActivityAt)}</td>
            </tr>`).join("") || `<tr><td colspan="10" style="color:var(--text-faint);padding:18px;">No users match.</td></tr>`}
        </tbody>
      </table></div>
      <div style="display:flex;gap:10px;align-items:center;justify-content:flex-end;margin-top:10px;font-size:12.5px;color:var(--text-muted);">
        <button class="btn btn-sm" id="au-prev" ${st.page === 0 ? "disabled" : ""}>← Prev</button>
        <span>${d.total === 0 ? "0" : (st.page * st.limit + 1) + "–" + Math.min(d.total, (st.page + 1) * st.limit)} of ${d.total}</span>
        <button class="btn btn-sm" id="au-next" ${(st.page + 1) * st.limit >= d.total ? "disabled" : ""}>Next →</button>
      </div>`;

    const setF = (k, v) => { st.f[k] = v; st.page = 0; load(); };
    const deb = (fn) => { let t; return (...a) => { clearTimeout(t); t = setTimeout(() => fn(...a), 300); }; };
    body.querySelector("#au-q").addEventListener("input", deb((e) => setF("q", e.target.value.trim())));
    body.querySelector("#au-org").addEventListener("input", deb((e) => setF("org", e.target.value.trim())));
    ["role", "status", "verified", "entsource", "entstatus"].forEach((id) => {
      const key = id === "entsource" ? "entSource" : id === "entstatus" ? "entStatus" : id;
      body.querySelector("#au-" + id).addEventListener("change", (e) => setF(key, e.target.value));
    });
    body.querySelector("#au-clear").addEventListener("click", () => { st.f = { q: "", org: "", role: "", status: "", verified: "", entSource: "", entStatus: "" }; st.page = 0; load(); });
    body.querySelector("#au-add").addEventListener("click", () => { st.adding = true; paintAdd(); });
    body.querySelector("#au-prev").addEventListener("click", () => { if (st.page > 0) { st.page--; load(); } });
    body.querySelector("#au-next").addEventListener("click", () => { st.page++; load(); });
    const allBox = body.querySelector("#au-all");
    if (allBox) allBox.addEventListener("change", (e) => { d.users.forEach((u) => { st.sel[u.id] = e.target.checked; }); paint(); });
    body.querySelectorAll("[data-selu]").forEach((cb) => cb.addEventListener("click", (e) => {
      e.stopPropagation(); st.sel[cb.dataset.selu] = cb.checked; paint();
    }));
    body.querySelectorAll("tr[data-uid]").forEach((tr) => tr.addEventListener("click", () => { st.drawer = tr.dataset.uid; paint(); }));
    body.querySelectorAll("[data-bulk]").forEach((b) => b.addEventListener("click", () => {
      const a = b.dataset.bulk;
      if (a === "__clear") { st.sel = {}; return paint(); }
      if (!confirm(`Apply “${a.replace(/_/g, " ")}” to ${selIds.length} user(s)?`)) return;
      Backend.adminUsersBulk(selIds, a).then((res) => {
        showToast(`${res.filter((r) => r.ok).length}/${res.length} updated`);
        st.sel = {}; load();
      }).catch(() => showToast("Bulk action failed"));
    }));
  }

  function paintAdd() {
    body.innerHTML = `
      <div style="max-width:560px;">
        <button class="btn btn-ghost btn-sm" id="ad-back" style="margin-bottom:10px;">← All users</button>
        <div class="section-title" style="margin-bottom:8px;"><h2 style="font-size:18px;">Add a user</h2></div>
        <div class="auth-2col"><div class="form-field"><label>First name</label><input id="ad-first"/></div><div class="form-field"><label>Last name</label><input id="ad-last"/></div></div>
        <div class="form-field"><label>Email *</label><input id="ad-email" type="email" placeholder="person@org.com"/></div>
        <div class="auth-2col">
          <div class="form-field"><label>Function</label><select id="ad-role">${AU_FUNCTIONS.map((f) => `<option value="${f[0]}">${escapeHtml(f[1])}</option>`).join("")}</select></div>
          <div class="form-field"><label>AI level</label><select id="ad-level">${AU_LEVELS.map((l) => `<option value="${l}">${l}</option>`).join("")}</select></div>
        </div>
        <div class="form-field"><label>Organisation</label><input id="ad-org"/></div>
        <div class="form-field"><label>Starting access</label>
          <select id="ad-start">
            <option value="none">None (verify → auto function scope on their own)</option>
            <option value="function" selected>Grant the function scope now</option>
            <option value="full">Grant full library now</option>
          </select>
        </div>
        <label class="auth-check" style="margin:4px 0 14px;"><input type="checkbox" id="ad-invite" checked/> Send the invite / verification email now</label>
        <div class="auth-error" id="ad-err" style="color:var(--danger);font-size:12.5px;min-height:16px;"></div>
        <div style="display:flex;gap:8px;">
          <button class="btn btn-primary" id="ad-save">Create user</button>
          <button class="btn" id="ad-cancel">Cancel</button>
        </div>
      </div>`;
    const back = () => { st.adding = false; load(); };
    body.querySelector("#ad-back").addEventListener("click", back);
    body.querySelector("#ad-cancel").addEventListener("click", back);
    body.querySelector("#ad-save").addEventListener("click", () => {
      const start = body.querySelector("#ad-start").value;
      const payload = {
        email: body.querySelector("#ad-email").value.trim(),
        firstName: body.querySelector("#ad-first").value.trim(),
        lastName: body.querySelector("#ad-last").value.trim(),
        function: body.querySelector("#ad-role").value,
        aiLevel: body.querySelector("#ad-level").value,
        organization: body.querySelector("#ad-org").value.trim(),
        sendInvite: body.querySelector("#ad-invite").checked,
      };
      if (start === "function") payload.functionScope = true;
      else if (start === "full") payload.entitlement = { scopeType: "full" };
      if (!/^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(payload.email)) { body.querySelector("#ad-err").textContent = "Enter a valid email."; return; }
      const btn = body.querySelector("#ad-save"); btn.disabled = true; btn.textContent = "Creating…";
      Backend.adminUserCreate(payload).then((u) => { showToast("User created" + (payload.sendInvite ? " · invite sent" : "")); st.adding = false; st.drawer = u.id; load().then(paint); })
        .catch((e) => { btn.disabled = false; btn.textContent = "Create user"; body.querySelector("#ad-err").textContent = e && e.status === 409 ? "That email already has an account." : "Couldn't create the user."; });
    });
  }

  function paintDrawer() {
    const uid = st.drawer;
    body.innerHTML = `<button class="btn btn-ghost btn-sm" id="dr-back" style="margin-bottom:10px;">← All users</button><div id="dr-body"><div class="skel" style="height:200px;"></div></div>`;
    body.querySelector("#dr-back").addEventListener("click", () => { st.drawer = null; load(); });
    const target = body.querySelector("#dr-body");
    // Per-action button labels: [in-flight label, confirm prompt|null, success toast, style class].
    // Centralising this makes every action consistent — clicking anything gives
    // immediate feedback (disabled + busy label), a specific success message
    // instead of a generic "Done", and a confirmation only where the action
    // actually reduces access or removes data.
    const UA_META = {
      suspend: { busy: "Suspending…", confirm: "Suspend this account? They'll lose access until reactivated.", done: "Account suspended" },
      reactivate: { busy: "Reactivating…", confirm: null, done: "Account reactivated" },
      disable: { busy: "Disabling…", confirm: "Disable this account? They will not be able to sign in.", done: "Account disabled" },
      resend_verification: { busy: "Sending…", confirm: null, done: "Verification email sent" },
      force_verify: { busy: "Verifying…", confirm: "Mark this email verified without them clicking the link?", done: "Email marked verified" },
      send_reset: { busy: "Sending…", confirm: null, done: "Password reset email sent" },
      revoke_sessions: { busy: "Revoking…", confirm: "Sign this user out of every device? They'll need to sign in again.", done: "Sessions revoked" },
    };
    const ENT_META = {
      suspend: { busy: "Suspending…", confirm: "Suspend this entitlement? Their library access pauses immediately.", done: "Entitlement suspended" },
      expire: { busy: "Expiring…", confirm: "Expire this entitlement now?", done: "Entitlement expired" },
      revoke: { busy: "Revoking…", confirm: "Revoke this entitlement? This removes their library access.", done: "Entitlement revoked" },
      reactivate: { busy: "Reactivating…", confirm: null, done: "Entitlement reactivated" },
    };
    // Runs an async action through one button: confirms if needed, disables +
    // relabels the button while in flight (so a second click can't double-fire
    // and the click always has a visible, immediate effect), shows a toast that
    // names what happened, then re-renders. Restores the button on failure —
    // success re-renders the whole drawer anyway, so nothing is left stuck.
    function runAction(btn, meta, run) {
      if (meta.confirm && !confirm(meta.confirm)) return;
      const orig = btn.textContent;
      btn.disabled = true;
      btn.textContent = meta.busy;
      run()
        .then(() => { showToast(meta.done); paintDrawer(); })
        .catch(() => { showToast("Couldn't complete that — try again."); btn.disabled = false; btn.textContent = orig; });
    }

    Promise.all([
      Backend.adminUser(uid),
      Backend.adminEntitlement(uid).catch(() => ({ history: [], enrollments: [] })),
      Backend.adminAudit({ type: "admin", target: uid, limit: "20" }).catch(() => ({ rows: [] })),
    ]).then(([d, ent, audit]) => {
      const u = d.user, a = d.access || {}, acc = a.access || {};
      const feats = a.features || {};
      const grantedN = Object.values(feats).filter(Boolean).length;
      const scopeExplain = {
        full: "sees the whole library", function: "sees only their function's categories",
        program: "sees only their program's categories", collection: "sees only a curated collection",
        none: "has no library access yet",
      }[acc.scopeType] || "no scope set";
      target.innerHTML = `
        <div class="section-title" style="margin-bottom:4px;"><h2 style="font-size:18px;">${escapeHtml(([u.firstName, u.lastName].filter(Boolean).join(" ")) || u.email)}</h2>
          <span class="chip ${u.accountStatus === "active" ? "chip-accent" : u.accountStatus === "suspended" || u.accountStatus === "disabled" ? "chip-warn" : ""}">${escapeHtml((u.accountStatus || "").replace("_", " "))}</span></div>
        <div style="color:var(--text-muted);font-size:12.5px;margin-bottom:14px;">${escapeHtml(u.email)} ${u.emailVerified ? "· verified" : "· <b>unverified</b>"} · ${escapeHtml(u.organization || "no org")} · joined ${u.createdAt ? new Date(u.createdAt).toLocaleDateString() : "—"}</div>

        <div class="admin-section">
          <h3>Profile</h3>
          <div class="auth-2col"><div class="form-field"><label>First</label><input id="dr-first" value="${escapeHtml(u.firstName || "")}"/></div><div class="form-field"><label>Last</label><input id="dr-last" value="${escapeHtml(u.lastName || "")}"/></div></div>
          <div class="auth-2col">
            <div class="form-field"><label>Function</label><select id="dr-role">${AU_FUNCTIONS.map((f) => `<option value="${f[0]}" ${u.role === f[0] ? "selected" : ""}>${escapeHtml(f[1])}</option>`).join("")}</select></div>
            <div class="form-field"><label>AI level</label><select id="dr-level">${AU_LEVELS.map((l) => `<option ${u.aiLevel === l ? "selected" : ""}>${l}</option>`).join("")}</select></div>
          </div>
          <div class="form-field"><label>Organisation</label><input id="dr-org" value="${escapeHtml(u.organization || "")}"/></div>
          <button class="btn btn-sm btn-primary" id="dr-save-profile">Save profile</button>
        </div>

        <div class="admin-section" style="margin-top:14px;">
          <h3>Access — site-level entitlement</h3>
          <div style="font-size:12.5px;color:var(--text-muted);margin-bottom:2px;">
            <span class="chip ${acc.active ? "chip-accent" : "chip-warn"}">${escapeHtml(acc.scopeType || "none")}</span> ${acc.active ? "active" : "inactive"} · granted via ${escapeHtml((acc.source || "—").replace("_", " "))}${acc.licenseType ? ` · ${escapeHtml(acc.licenseType)} licence` : ""}${acc.expiresAt ? ` · expires ${new Date(acc.expiresAt).toLocaleDateString()}` : ""}
          </div>
          <div class="admin-help">${escapeHtml(scopeExplain)} · ${grantedN} feature${grantedN === 1 ? "" : "s"} enabled</div>
          <div style="display:flex;gap:6px;flex-wrap:wrap;margin-top:10px;">
            <button class="btn btn-sm" id="dr-align">Align to function</button>
            <button class="btn btn-sm btn-warn" data-ent="suspend">Suspend ent.</button>
            <button class="btn btn-sm btn-warn" data-ent="expire">Expire</button>
            <button class="btn btn-sm btn-danger" data-ent="revoke">Revoke</button>
            <button class="btn btn-sm" data-ent="reactivate">Reactivate</button>
          </div>

          <div class="admin-help" style="margin:14px 0 4px;">Replace their entire access grant — pick exactly which categories and programs this user can browse:</div>
          <div class="auth-2col">
            <div class="form-field"><label>Scope type</label>
              <select id="dr-assign-scope" aria-label="New scope">
                ${[["full", "full — whole library"], ["function", "function — categories below"],
                   ["collection", "collection — categories below"], ["program", "program — programs below"],
                   ["none", "none — no access"]].map(([v, label]) =>
                  `<option value="${v}" ${(acc.scopeType || "none") === v ? "selected" : ""}>${label}</option>`).join("")}
              </select>
            </div>
            <div class="form-field"><label>Licence</label>
              <select id="dr-assign-license" aria-label="Licence type">
                ${["standard", "premium", "trial", "enterprise"].map((l) => `<option value="${l}" ${(acc.licenseType || "standard") === l ? "selected" : ""}>${l}</option>`).join("")}
              </select>
            </div>
          </div>
          <div class="form-field"><label>Expires <span style="font-weight:400;color:var(--text-faint)">— blank = never</span></label>
            <input type="date" id="dr-assign-expires" value="${acc.expiresAt ? new Date(acc.expiresAt).toISOString().slice(0, 10) : ""}"/>
          </div>
          <div class="form-field"><label>Categories <span style="font-weight:400;color:var(--text-faint)">— used when scope is function or collection</span></label>
            ${checkGroupHtml("data-dr-cat", (typeof CATEGORIES !== "undefined" ? CATEGORIES : []).map((c) => c.name).sort(), acc.categoryIds || [])}
          </div>
          <div class="form-field"><label>Programs <span style="font-weight:400;color:var(--text-faint)">— used when scope is program</span></label>
            ${checkGroupHtml("data-dr-prog", allProgramsList().map((p) => ({ value: p.id, label: p.name, extra: "· " + p.org })), acc.programIds === "*" ? [] : (acc.programIds || []))}
          </div>
          <button class="btn btn-sm btn-primary" id="dr-assign" style="margin-top:10px;">Save access</button>
        </div>

        <div class="admin-section" style="margin-top:14px;">
          <h3>Account controls</h3>
          <div style="display:flex;gap:6px;flex-wrap:wrap;">
            <button class="btn btn-sm" data-ua="reactivate">Reactivate</button>
            <button class="btn btn-sm" data-ua="resend_verification">Resend verify</button>
            <button class="btn btn-sm" data-ua="force_verify">Force verify</button>
            <button class="btn btn-sm" data-ua="send_reset">Send reset email</button>
            <button class="btn btn-sm btn-warn" data-ua="suspend">Suspend account</button>
            <button class="btn btn-sm btn-warn" data-ua="revoke_sessions">Revoke sessions</button>
            <button class="btn btn-sm btn-danger" data-ua="disable">Disable account</button>
          </div>
        </div>

        <div class="admin-danger-zone" style="margin-top:14px;">
          <h3>${icon("alert")} Danger zone</h3>
          <p>These actions are hard to undo. Soft delete disables the account and clears sessions but keeps records; hard delete permanently erases the user and all their data.</p>
          <div style="display:flex;gap:8px;flex-wrap:wrap;">
            <button class="btn btn-sm btn-danger" id="dr-softdel">Soft delete</button>
            ${isSuperAdmin() ? `<button class="btn btn-sm btn-danger" id="dr-harddel">Hard delete permanently</button>` : ""}
          </div>
        </div>

        <div style="display:grid;grid-template-columns:1fr 1fr;gap:18px;margin-top:14px;">
          <div>
            <h3 style="font-size:13px;margin:0 0 6px;">Enrollments</h3>
            <div style="font-size:12px;">${(ent.enrollments || []).filter((e) => e.status === "active").map((e) => `<div>${escapeHtml(e.program_id)} <button class="linklike" data-unenroll="${escapeHtml(e.program_id)}" style="color:var(--danger);">remove</button></div>`).join("") || "<span style='color:var(--text-faint)'>none</span>"}</div>
            <h3 style="font-size:13px;margin:14px 0 6px;">Entitlement history</h3>
            <div style="font-size:11.5px;color:var(--text-muted);max-height:160px;overflow:auto;">${(ent.history || []).map((h) => `<div>${new Date(h.ts).toLocaleString()} · <b>${escapeHtml(h.action)}</b> · ${escapeHtml(h.actor || "")}</div>`).join("") || "—"}</div>
          </div>
          <div>
            <h3 style="font-size:13px;margin:0 0 6px;">Recent activity</h3>
            <div style="font-size:11.5px;color:var(--text-muted);max-height:160px;overflow:auto;">${(d.recentEvents || []).map((e) => `<div>${new Date(e.ts).toLocaleString()} · ${escapeHtml(e.event)}</div>`).join("") || "—"}</div>
            <h3 style="font-size:13px;margin:14px 0 6px;">Admin audit</h3>
            <div style="font-size:11.5px;color:var(--text-muted);max-height:160px;overflow:auto;">${(audit.rows || []).map((r) => `<div>${new Date(r.ts).toLocaleString()} · ${escapeHtml(r.action)} · ${escapeHtml(r.actor_label || "")}</div>`).join("") || "—"}</div>
          </div>
        </div>`;

      const saveBtn = target.querySelector("#dr-save-profile");
      saveBtn.addEventListener("click", () => {
        const orig = saveBtn.textContent;
        saveBtn.disabled = true; saveBtn.textContent = "Saving…";
        Backend.adminUserAction(uid, "update_profile", {
          firstName: target.querySelector("#dr-first").value.trim(), lastName: target.querySelector("#dr-last").value.trim(),
          role: target.querySelector("#dr-role").value, aiLevel: target.querySelector("#dr-level").value,
          organization: target.querySelector("#dr-org").value.trim(),
        }).then(() => { showToast("Profile saved"); paintDrawer(); })
          .catch(() => { showToast("Couldn't save — try again."); saveBtn.disabled = false; saveBtn.textContent = orig; });
      });
      target.querySelector("#dr-align").addEventListener("click", (e) => runAction(e.currentTarget, { busy: "Aligning…", confirm: "Re-scope this user's auto entitlement to their current function?", done: "Re-aligned to function" }, () => Backend.adminUserAction(uid, "align_function", {})));
      target.querySelectorAll("[data-ent]").forEach((b) => b.addEventListener("click", (e) => {
        const meta = ENT_META[b.dataset.ent];
        runAction(e.currentTarget, meta, () => Backend.adminEntitlementAction({ action: b.dataset.ent, userId: uid }));
      }));
      wireCheckGroups(target);
      target.querySelector("#dr-assign").addEventListener("click", (e) => {
        const scopeType = target.querySelector("#dr-assign-scope").value;
        const licenseType = target.querySelector("#dr-assign-license").value;
        const expiresRaw = target.querySelector("#dr-assign-expires").value;
        const expiresAt = expiresRaw ? new Date(expiresRaw + "T00:00:00Z").toISOString() : null;
        const categoryIds = [...target.querySelectorAll("[data-dr-cat]:checked")].map((x) => x.value);
        const programIds = [...target.querySelectorAll("[data-dr-prog]:checked")].map((x) => x.value);
        runAction(e.currentTarget, { busy: "Saving…", confirm: `Replace this user's access with scope “${scopeType}”?`, done: "Access updated" },
          () => Backend.adminEntitlementAction({ action: "assign", userId: uid, scopeType, categoryIds, programIds, licenseType, expiresAt }));
      });
      target.querySelectorAll("[data-ua]").forEach((b) => b.addEventListener("click", (e) => {
        const meta = UA_META[b.dataset.ua];
        runAction(e.currentTarget, meta, () => Backend.adminUserAction(uid, b.dataset.ua, { reason: "admin console" }));
      }));
      target.querySelectorAll("[data-unenroll]").forEach((b) => b.addEventListener("click", (e) => {
        runAction(e.currentTarget, { busy: "Removing…", confirm: null, done: "Unenrolled" },
          () => Backend.adminEntitlementAction({ action: "unenroll", userId: uid, programId: b.dataset.unenroll }));
      }));
      target.querySelector("#dr-softdel").addEventListener("click", (e) => {
        const btn = e.currentTarget;
        if (!confirm("Soft-delete (disable + revoke sessions) this account? Records are kept.")) return;
        const orig = btn.textContent; btn.disabled = true; btn.textContent = "Deleting…";
        Backend.adminUserDelete(uid, false).then(() => { showToast("Account disabled"); st.drawer = null; load(); })
          .catch(() => { showToast("Couldn't complete that — try again."); btn.disabled = false; btn.textContent = orig; });
      });
      const hd = target.querySelector("#dr-harddel");
      if (hd) hd.addEventListener("click", (e) => {
        const btn = e.currentTarget;
        if (!confirm("HARD DELETE — permanently removes " + u.email + " and all their data. This cannot be undone.")) return;
        const orig = btn.textContent; btn.disabled = true; btn.textContent = "Deleting…";
        Backend.adminUserDelete(uid, true).then(() => { showToast("User hard-deleted"); st.drawer = null; load(); })
          .catch(() => { showToast("Couldn't complete that — try again."); btn.disabled = false; btn.textContent = orig; });
      });
    }).catch(() => { target.innerHTML = emptyStateHtml("slider", "Couldn't load this user", "Try again."); });
  }

  load();
}
