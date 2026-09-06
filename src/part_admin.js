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

/* function name -> { categories in the 28-category library, representative roles } */
const FUNCTIONS = {
  "Leadership & Strategy": { categories: ["Business Strategy", "Communication & Leadership"], roles: ["Founder / CEO", "COO", "Chief of Staff", "VP / Director", "Team Lead", "Board Member"] },
  "Sales": { categories: ["Sales & Lead Generation", "Communication & Leadership"], roles: ["SDR / BDR", "Account Executive", "Sales Manager", "Sales Enablement", "RevOps", "Customer Success Manager"] },
  "Marketing": { categories: ["Marketing & Branding", "Social Media", "Email Marketing", "SEO & Analytics"], roles: ["Content Marketer", "Brand Manager", "Growth Marketer", "SEO Specialist", "Social Media Manager", "Lifecycle / Email Marketer", "Marketing Ops", "PR / Comms"] },
  "Product": { categories: ["Product Management", "UX/UI Design", "Research & Data Analysis"], roles: ["Product Manager", "Product Owner", "UX Researcher", "Product Designer", "Product Marketing"] },
  "Engineering & Tech": { categories: ["Coding & Tech", "Productivity & Automation", "AI & Prompt Engineering"], roles: ["Software Engineer", "Engineering Manager", "DevOps / SRE", "QA Engineer", "Data Engineer", "Solutions Architect"] },
  "Customer Support": { categories: ["Customer Support"], roles: ["Support Agent", "Support Team Lead", "CX Manager", "Knowledge Base Manager"] },
  "People & HR": { categories: ["HR & Recruiting", "Career Growth", "Coaching & Self-Development"], roles: ["Recruiter", "HR Business Partner", "L&D Manager", "People Ops", "Hiring Manager", "Compensation & Benefits"] },
  "Finance": { categories: ["Finance & Accounting"], roles: ["Financial Analyst", "FP&A", "Controller", "Accountant", "Procurement"] },
  "Operations": { categories: ["Productivity & Automation", "Business Strategy"], roles: ["Operations Manager", "Program Manager", "BizOps", "Supply Chain"] },
  "Legal & Compliance": { categories: ["Legal & Compliance"], roles: ["Legal Counsel", "Compliance Officer", "Contracts Manager", "Privacy / DPO"] },
  "Data & Research": { categories: ["Research & Data Analysis", "SEO & Analytics"], roles: ["Data Analyst", "Data Scientist", "Market Researcher", "Insights Manager", "BI Analyst"] },
  "Content & Communications": { categories: ["Content Writing & Copywriting", "Book & Ebook Writing", "Presentation & Slides"], roles: ["Copywriter", "Content Strategist", "Technical Writer", "Editor", "Communications Manager"] },
  "E-Commerce": { categories: ["E-Commerce", "Marketing & Branding"], roles: ["Ecommerce Manager", "Merchandiser", "Catalogue Manager", "Marketplace Specialist"] },
  "Education & Training": { categories: ["Education & Learning", "Coaching & Self-Development"], roles: ["Instructional Designer", "Trainer / Facilitator", "Curriculum Developer", "Learning Experience Designer"] },
  "Health & Wellbeing": { categories: ["Health & Fitness", "Spirituality & Wellness"], roles: ["Wellness Coach", "Health Practitioner", "Fitness Professional"] },
  "General / Cross-functional": { categories: ["General", "AI & Prompt Engineering", "Productivity & Automation"], roles: ["Individual Contributor", "People Manager", "Executive Assistant", "Consultant"] },
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

/* ---------- Admin persistence (shared, not per-learner) ---------- */
const ADMIN_KEY_DEFAULT = "SYNOTTIC-ADMIN";
const AdminStore = (function () {
  let db = null;
  let cfg = { codes: [], adminKey: ADMIN_KEY_DEFAULT };
  async function init() {
    try { if (window.claude && typeof window.claude.use === "function") db = await window.claude.use("db"); }
    catch (e) { db = null; }
    if (db) {
      try { const d = await db.doc("admin/config").get(); if (d.exists) cfg = Object.assign(cfg, d.data()); }
      catch (e) { db = null; }
    }
    if (!db) { try { const v = localStorage.getItem("prompt-lib:admin"); if (v) cfg = Object.assign(cfg, JSON.parse(v)); } catch (e) {} }
    if (!Array.isArray(cfg.codes)) cfg.codes = [];
  }
  function persist() {
    if (db) db.doc("admin/config").set(cfg).catch(() => {});
    else { try { localStorage.setItem("prompt-lib:admin", JSON.stringify(cfg)); } catch (e) {} }
  }
  return {
    init,
    backend: () => (db ? "db" : "local"),
    key: () => cfg.adminKey || ADMIN_KEY_DEFAULT,
    getCodes: () => cfg.codes.slice(),
    getCode: (code) => cfg.codes.find((c) => c.code.toUpperCase() === String(code || "").toUpperCase().trim()),
    getById: (id) => cfg.codes.find((c) => c.id === id),
    upsert(rec) {
      const i = cfg.codes.findIndex((c) => c.id === rec.id);
      if (i >= 0) cfg.codes[i] = rec; else cfg.codes.unshift(rec);
      persist();
    },
    remove(id) { cfg.codes = cfg.codes.filter((c) => c.id !== id); persist(); },
    setEnabled(id, on) { const c = cfg.codes.find((x) => x.id === id); if (c) { c.enabled = on; persist(); } },
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
    ["Synottic Prompt Library — export"],
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
      <div class="gate-mark">${icon("slider")}</div>
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
  const go = () => {
    if (inp.value.trim() && inp.value.trim().toUpperCase() === AdminStore.key().toUpperCase()) {
      try { sessionStorage.setItem("prompt-lib:admin-ok", "1"); } catch (e) {}
      openAdmin();
    } else {
      root.querySelector("#admin-key-err").textContent = "Incorrect admin key.";
    }
  };
  root.querySelector("#admin-key-go").addEventListener("click", go);
  inp.addEventListener("keydown", (e) => { if (e.key === "Enter") go(); });
  root.querySelector("#admin-back").addEventListener("click", () => renderGate());
  inp.focus();
}
function exitAdmin() {
  try { sessionStorage.removeItem("prompt-lib:admin-ok"); } catch (e) {}
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
        <div class="brand-mark" style="width:34px;height:34px;">${icon("slider")}</div>
        <h1>Synottic — Admin Console</h1>
        <span class="chip">${AdminStore.backend() === "db" ? "Synced to account" : "Saved in this browser"}</span>
        <button class="btn btn-sm" id="admin-exit">${icon("logout")} Exit</button>
      </div>
      <div class="tabs">
        <button class="tab-btn ${ADMIN_STATE.tab === "codes" ? "active" : ""}" data-atab="codes">Access codes</button>
        <button class="tab-btn ${ADMIN_STATE.tab === "edit" ? "active" : ""}" data-atab="edit">${ADMIN_STATE.editing && ADMIN_STATE.editing.code ? "Edit code" : "New code"}</button>
        <button class="tab-btn ${ADMIN_STATE.tab === "download" ? "active" : ""}" data-atab="download">Download prompts</button>
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
  else renderAdminDownload(body);
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
  body.querySelectorAll("[data-toggle]").forEach((b) => b.addEventListener("click", () => {
    const c = AdminStore.getById(b.dataset.toggle);
    AdminStore.setEnabled(b.dataset.toggle, !(c && c.enabled !== false) ? true : false);
    renderAdminConsole();
  }));
  body.querySelectorAll("[data-copy]").forEach((b) => b.addEventListener("click", async () => {
    await copyText(b.dataset.copy); showToast("Code copied");
  }));
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
        ${checkGrid("functions", FUNCTION_NAMES, d.functions)}
      </div>
      <div class="form-field"><label>Relevant roles <span style="font-weight:400;color:var(--text-faint)">— optional refinement, grouped by function</span></label>
        ${checkGrid("roles", null, d.roles, rolesGroupedByFunction())}
      </div>

      <div class="form-field"><label>Relevant programs</label>
        <label style="display:flex;gap:7px;align-items:center;font-weight:400;margin-bottom:8px;"><input type="checkbox" id="f-full" ${d.fullLibrary ? "checked" : ""}/> Full library access (ignore function/program scoping)</label>
        <div class="checkgrid" id="f-programs" ${d.fullLibrary ? 'style="opacity:.45;pointer-events:none;"' : ""}>
          ${programs.map((p) => `<label><input type="checkbox" data-check="programIds" value="${p.id}" ${(d.programIds || []).includes(p.id) ? "checked" : ""}/> ${escapeHtml(p.name)} <span style="color:var(--text-faint)">· ${escapeHtml(p.org)}</span></label>`).join("")}
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
