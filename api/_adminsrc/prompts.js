// /api/admin/prompts — SUPER_ADMIN-only curation of the prompt library.
// Backs the "Prompts" console tab. Author-managed rows live in the `prompts`
// table (schema_v3 columns: origin / updated_by / updated_at / archived_at /
// title_norm). api/prompts.js serves the delta so the running app reflects
// changes with no rebuild; a bulk export regenerates src/prompts_authored.json
// for permanent inclusion via `python3 src/build.py`.
//
//   GET                                  -> { prompts:[…], total, page, pageSize, categories:[…] }
//     ?q= &category= &role= &source= &lifecycle= &origin= &page= &pageSize=
//   GET ?format=csv|json                 -> download of the filtered set
//   GET ?template=csv|json               -> empty import template
//   POST { action:"create", prompt }     -> { prompt }            (409 on duplicate)
//   POST { action:"update", id, patch, allowExcel? } -> { prompt }
//   POST { action:"delete", id, hard?, confirm? }    -> { ok, mode }
//   POST { action:"import", rows[], commit? }        -> { counts, preview[], committed }
//
// Every write is audited (prompt.create | prompt.update | prompt.delete |
// prompt.import). Writes need CSRF (skipped for a Bearer legacy-console token,
// matching the other admin handlers).
import { db, json, readBody, safeRows, isSchemaBehind } from "../_db.js";
import { checkCsrf } from "../_http.js";
import { requireAdmin } from "../_session.js";
import { newId } from "../_crypto.js";
import { auditLog } from "../_audit.js";
import {
  PROMPT_CATEGORIES, PROMPT_LIFECYCLES, validatePromptRow, normTitle,
} from "../_validate.js";

const MAX_IMPORT_ROWS = 5000;
const EXPORT_COLS = [
  "id", "title", "category", "role", "useCase", "description", "originalPrompt",
  "promptType", "difficulty", "variables", "tags", "lifecycle", "source", "origin",
];

const slug = (s) => String(s || "").toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/(^-|-$)/g, "").slice(0, 16) || "x";
async function freshPromptId(sql, category) {
  const base = "syn-" + slug(category);
  for (let i = 0; i < 6; i++) {
    const id = `${base}-${Math.random().toString(36).slice(2, 8)}`;
    const dup = await safeRows(sql`select 1 from prompts where id = ${id} limit 1`);
    if (!dup.length) return id;
  }
  return `${base}-${newId("p").split("_")[1]}`;
}

// The full app-facing record stored in prompts.data (client enrichRecord() fills
// the derived fields — description/whenToUse/frameworkLevel — at load).
function buildRecord(clean, { base = {}, adminLabel } = {}) {
  const variables = clean.variables ?? base.variables ?? [];
  const rec = {
    ...base,
    id: clean.id || base.id,
    title: clean.title ?? base.title,
    originalTitle: base.originalTitle || clean.title || base.title,
    category: clean.category ?? base.category,
    description: clean.description ?? base.description ?? "",
    useCase: clean.useCase ?? base.useCase ?? clean.title ?? base.title,
    originalPrompt: clean.originalPrompt ?? base.originalPrompt,
    promptType: clean.promptType ?? base.promptType ?? "Reusable Prompt",
    role: clean.role ?? base.role ?? "Not specified",
    outcome: clean.outcome ?? base.outcome ?? "A reusable AI workflow",
    difficulty: clean.difficulty ?? base.difficulty,
    variables,
    variablesRaw: (variables || []).map((v) => (/^\[.*\]$/.test(v) ? v : `[${v}]`)),
    isTemplate: (variables || []).length > 0,
    tags: clean.tags ?? base.tags ?? [],
    qualityScore: typeof base.qualityScore === "number" ? base.qualityScore : null,
    lifecycle: clean.lifecycle ?? base.lifecycle ?? "Curated",
    source: base.source || "Synottic Programs",
    origin: base.origin || "authored",
    version: base.version || "1.0",
    sensitiveCategory: base.sensitiveCategory ?? false,
    updatedBy: adminLabel || base.updatedBy || null,
  };
  return rec;
}

function promptOut(row) {
  const d = row.data || {};
  return {
    id: row.id,
    title: row.title || d.title,
    category: row.category || d.category,
    role: d.role || null,
    useCase: d.useCase || null,
    description: d.description || null,
    originalPrompt: d.originalPrompt || null,
    promptType: d.promptType || null,
    difficulty: d.difficulty || null,
    variables: d.variables || [],
    tags: d.tags || [],
    source: row.source || d.source || null,
    origin: row.origin || d.origin || "excel",
    lifecycle: row.lifecycle || d.lifecycle || null,
    qualityScore: typeof row.quality_score === "number" ? row.quality_score : (d.qualityScore ?? null),
    updatedAt: row.updated_at || null,
    updatedBy: row.updated_by || null,
    archivedAt: row.archived_at || null,
  };
}

// ---- flat CSV/JSON row <-> record ----
function flatRow(rec) {
  const r = {};
  for (const k of EXPORT_COLS) {
    const v = k === "variables" ? (rec.variables || []) : k === "tags" ? (rec.tags || []) : rec[k];
    r[k] = Array.isArray(v) ? v.join(" | ") : (v == null ? "" : v);
  }
  return r;
}
function toCsv(cols, rows) {
  const esc = (v) => {
    const s = v == null ? "" : String(v);
    return /[",\n\r]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s;
  };
  return [cols.join(","), ...rows.map((r) => cols.map((c) => esc(r[c])).join(","))].join("\r\n");
}
function sendText(res, status, contentType, body, filename) {
  res.setHeader("content-type", contentType);
  res.setHeader("cache-control", "no-store");
  if (filename) res.setHeader("content-disposition", `attachment; filename="${filename}"`);
  res.status(status).send(body);
  return res;
}

export default async function handler(req, res) {
  let sql;
  try { sql = db(); } catch { return json(res, 503, { error: "no-backend" }); }

  const write = req.method !== "GET";
  const gate = await requireAdmin(sql, req, write ? "prompts.write" : "prompts.read");
  if (gate.error) return json(res, gate.error, { error: gate.code });
  const admin = gate.admin;
  // Task: the Prompts tab is SUPER_ADMIN-only, server-enforced (RBAC alone
  // would also let CONTENT_MANAGER write).
  if (admin.admin_role !== "SUPER_ADMIN") return json(res, 403, { error: "forbidden" });
  if (write && !req.headers.authorization && !checkCsrf(req)) return json(res, 403, { error: "bad-csrf" });
  const actor = { actorType: "admin", actorId: admin.id, actorLabel: admin.email, req };
  const adminLabel = admin.email || admin.id;

  try {
    if (req.method === "GET") return await handleGet(sql, req, res);
    if (req.method === "POST") {
      const b = await readBody(req);
      return await handlePost(sql, res, b, b.action, actor, adminLabel);
    }
    return json(res, 405, { error: "method-not-allowed" });
  } catch (e) {
    if (isSchemaBehind(e)) return json(res, 503, { error: "schema-out-of-date", detail: "run: npm run migrate:v3" });
    throw e;
  }
}

async function handleGet(sql, req, res) {
  const q = req.query || {};

  if (q.template) {
    if (q.template === "json") {
      const sample = [{
        id: "", title: "", category: PROMPT_CATEGORIES[0], role: "", useCase: "",
        description: "", originalPrompt: "", promptType: "Reusable Prompt",
        difficulty: "Intermediate", variables: [], tags: [], lifecycle: "Curated",
      }];
      return sendText(res, 200, "application/json; charset=utf-8", JSON.stringify(sample, null, 2), "prompts-template.json");
    }
    const cols = EXPORT_COLS.filter((c) => c !== "source" && c !== "origin");
    const example = { id: "", title: "Example: draft a launch email", category: PROMPT_CATEGORIES[0],
      role: "Marketing Manager", useCase: "Product launch comms", description: "One-line summary",
      originalPrompt: "Act as … Context … Task … Format … Verification …", promptType: "Reusable Prompt",
      difficulty: "Intermediate", variables: "PRODUCT | AUDIENCE", tags: "email | launch", lifecycle: "Curated" };
    return sendText(res, 200, "text/csv; charset=utf-8", toCsv(cols, [example]), "prompts-template.csv");
  }

  // filtered fetch — `add` fills each "?" in order with the next $N bind.
  const where = [];
  const params = [];
  const add = (frag, ...vals) => {
    let i = 0;
    where.push(frag.replace(/\?/g, () => { params.push(vals[i++]); return "$" + params.length; }));
  };
  if (q.category) add("category = ?", q.category);
  if (q.source) add("source = ?", q.source);
  if (q.origin) add("origin = ?", q.origin);
  if (q.lifecycle) add("coalesce(lifecycle, data->>'lifecycle') = ?", q.lifecycle);
  if (q.role) add("lower(coalesce(data->>'role','')) like ?", "%" + String(q.role).toLowerCase() + "%");
  if (q.q) {
    const like = "%" + String(q.q).toLowerCase() + "%";
    add("(lower(title) like ? or lower(coalesce(data->>'originalPrompt','')) like ?)", like, like);
  }
  const includeArchived = q.includeArchived === "1" || q.lifecycle === "Archived";
  if (!includeArchived) where.push("coalesce(lifecycle, data->>'lifecycle','') <> 'Archived'");
  const whereSql = where.length ? "where " + where.join(" and ") : "";

  const format = q.format;
  if (format === "csv" || format === "json") {
    const rows = await safeRows(sql(`select data from prompts ${whereSql} order by updated_at desc nulls last, title asc limit 20000`, params));
    const recs = rows.map((r) => r.data || {});
    if (format === "json") {
      return sendText(res, 200, "application/json; charset=utf-8",
        JSON.stringify(recs, null, 2), `prompts-export-${new Date().toISOString().slice(0, 10)}.json`);
    }
    return sendText(res, 200, "text/csv; charset=utf-8",
      toCsv(EXPORT_COLS, recs.map(flatRow)), `prompts-export-${new Date().toISOString().slice(0, 10)}.csv`);
  }

  const page = Math.max(0, parseInt(q.page, 10) || 0);
  const pageSize = Math.min(200, Math.max(1, parseInt(q.pageSize, 10) || 50));
  const [rows, countRows] = await Promise.all([
    safeRows(sql(`select id, title, category, source, program_id, lifecycle, quality_score, origin,
                    updated_by, updated_at, archived_at, data
                  from prompts ${whereSql}
                  order by updated_at desc nulls last, title asc
                  limit ${pageSize} offset ${page * pageSize}`, params)),
    safeRows(sql(`select count(*)::int as n from prompts ${whereSql}`, params)),
  ]);
  return json(res, 200, {
    prompts: rows.map(promptOut),
    total: countRows[0] ? countRows[0].n : rows.length,
    page, pageSize,
    categories: PROMPT_CATEGORIES,
    lifecycles: PROMPT_LIFECYCLES,
  });
}

async function loadRow(sql, id) {
  const r = await safeRows(sql`select * from prompts where id = ${id} limit 1`);
  return r[0] || null;
}
async function findByTitle(sql, title, category) {
  const r = await safeRows(sql`select * from prompts
    where title_norm = ${normTitle(title)} and category = ${category}
      and coalesce(lifecycle, data->>'lifecycle','') <> 'Archived' limit 1`);
  return r[0] || null;
}

async function upsertRecord(sql, rec, adminLabel) {
  const qs = typeof rec.qualityScore === "number" ? rec.qualityScore : null;
  await sql`
    insert into prompts (id, source_number, title, category, source, program_id, lifecycle,
      quality_score, data, origin, updated_by, updated_at, title_norm, archived_at)
    values (${rec.id}, ${rec.sourceNumber ?? null}, ${rec.title}, ${rec.category},
      ${rec.source || "Synottic Programs"}, ${rec.programId ?? null}, ${rec.lifecycle || "Curated"},
      ${qs}, ${JSON.stringify(rec)}, ${rec.origin || "authored"}, ${adminLabel}, now(),
      ${normTitle(rec.title)}, ${rec.lifecycle === "Archived" ? new Date().toISOString() : null})
    on conflict (id) do update set
      title = excluded.title, category = excluded.category, source = excluded.source,
      program_id = excluded.program_id, lifecycle = excluded.lifecycle,
      quality_score = excluded.quality_score, data = excluded.data,
      origin = coalesce(prompts.origin, excluded.origin),
      updated_by = excluded.updated_by, updated_at = now(), title_norm = excluded.title_norm,
      archived_at = case when excluded.lifecycle = 'Archived' then now() else null end`;
}

async function handlePost(sql, res, b, action, actor, adminLabel) {
  if (action === "create") {
    const v = validatePromptRow(b.prompt || {});
    if (v.error) return json(res, 422, { error: v.error, field: v.field });
    const p = v.value;
    if (p.id && await loadRow(sql, p.id)) return json(res, 409, { error: "id-exists", id: p.id });
    const clash = await findByTitle(sql, p.title, p.category);
    if (clash) return json(res, 409, { error: "duplicate", id: clash.id });
    p.id = p.id || await freshPromptId(sql, p.category);
    const rec = buildRecord(p, { adminLabel });
    await upsertRecord(sql, rec, adminLabel);
    auditLog(sql, { ...actor, action: "prompt.create", targetType: "prompt", targetId: rec.id,
      detail: { title: rec.title, category: rec.category } });
    return json(res, 200, { prompt: promptOut(await loadRow(sql, rec.id)) });
  }

  if (action === "update") {
    if (!b.id) return json(res, 400, { error: "id-required" });
    const row = await loadRow(sql, b.id);
    if (!row) return json(res, 404, { error: "not-found" });
    const patch = b.patch || {};
    const touchesOriginal = patch.title !== undefined || patch.originalPrompt !== undefined;
    if ((row.origin === "excel" || (row.data && row.data.source === "Original Library")) && touchesOriginal && b.allowExcel !== true) {
      return json(res, 403, { error: "excel-immutable", detail: "pass allowExcel:true to edit an Excel-origin title/prompt" });
    }
    const v = validatePromptRow(patch, { partial: true });
    if (v.error) return json(res, 422, { error: v.error, field: v.field });
    const rec = buildRecord({ ...v.value, id: row.id }, { base: row.data || {}, adminLabel });
    await upsertRecord(sql, rec, adminLabel);
    auditLog(sql, { ...actor, action: "prompt.update", targetType: "prompt", targetId: row.id,
      detail: { fields: Object.keys(v.value) } });
    return json(res, 200, { prompt: promptOut(await loadRow(sql, row.id)) });
  }

  if (action === "delete") {
    if (!b.id) return json(res, 400, { error: "id-required" });
    const row = await loadRow(sql, b.id);
    if (!row) return json(res, 404, { error: "not-found" });
    if (b.hard) {
      if (b.confirm !== true) return json(res, 400, { error: "confirm-required" });
      if ((row.origin || "excel") !== "authored") return json(res, 403, { error: "hard-delete-authored-only" });
      await sql`delete from prompts where id = ${b.id}`;
      auditLog(sql, { ...actor, action: "prompt.delete", targetType: "prompt", targetId: b.id, detail: { mode: "hard", title: row.title } });
      return json(res, 200, { ok: true, mode: "hard" });
    }
    const rec = buildRecord({ id: row.id, lifecycle: "Archived" }, { base: row.data || {}, adminLabel });
    await upsertRecord(sql, rec, adminLabel);
    auditLog(sql, { ...actor, action: "prompt.delete", targetType: "prompt", targetId: b.id, detail: { mode: "soft", title: row.title } });
    return json(res, 200, { ok: true, mode: "soft", prompt: promptOut(await loadRow(sql, b.id)) });
  }

  if (action === "import") {
    const rows = Array.isArray(b.rows) ? b.rows : [];
    if (!rows.length) return json(res, 422, { error: "no-rows" });
    if (rows.length > MAX_IMPORT_ROWS) return json(res, 422, { error: "too-many-rows", max: MAX_IMPORT_ROWS });
    const commit = b.commit === true;
    const seen = new Set();
    const preview = [];
    for (let i = 0; i < rows.length; i++) {
      const raw = rows[i] || {};
      const v = validatePromptRow(raw);
      if (v.error) { preview.push({ index: i, status: "invalid", reason: v.error, field: v.field, title: raw.title || "" }); continue; }
      const p = v.value;
      const key = (p.id && p.id.trim()) ? "id:" + p.id : "t:" + normTitle(p.title) + "|" + p.category;
      if (seen.has(key)) { preview.push({ index: i, status: "duplicate-in-file", title: p.title }); continue; }
      seen.add(key);
      let existing = p.id ? await loadRow(sql, p.id) : null;
      if (!existing) existing = await findByTitle(sql, p.title, p.category);
      const status = existing ? "update" : "new";
      const id = existing ? existing.id : (p.id || null);
      preview.push({ index: i, status, id, title: p.title, category: p.category });
      if (commit) {
        const rec = buildRecord({ ...p, id: id || await freshPromptId(sql, p.category) },
          { base: existing ? (existing.data || {}) : {}, adminLabel });
        await upsertRecord(sql, rec, adminLabel);
        preview[preview.length - 1].id = rec.id;
      }
    }
    const counts = preview.reduce((a, r) => { a[r.status] = (a[r.status] || 0) + 1; return a; }, {});
    if (commit) {
      auditLog(sql, { ...actor, action: "prompt.import", targetType: "prompt", targetId: "bulk",
        detail: { total: rows.length, ...counts } });
    }
    return json(res, 200, { committed: commit, counts, preview });
  }

  return json(res, 400, { error: "unknown-action" });
}
