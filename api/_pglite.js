// DEV / TEST ONLY. An in-process Postgres (WASM) that presents the same
// call surface as `neon()` from @neondatabase/serverless:
//   sql`select ... ${a} ...`            -> Promise<rows[]>
//   sql('select ... $1', [a])           -> Promise<rows[]>
//
// Activated by `_db.js` when DATABASE_URL starts with `pglite:` (e.g.
// `pglite://memory` or `pglite:///abs/path/to/dir`). @electric-sql/pglite is a
// devDependency and is imported lazily, so production bundles never touch it.
let _pgPromise = null;

async function getPg() {
  if (!_pgPromise) {
    _pgPromise = (async () => {
      const { PGlite } = await import("@electric-sql/pglite");
      const url = process.env.DATABASE_URL || "pglite://memory";
      const rest = url.replace(/^pglite:\/\//, "");              // "memory" | "/abs/path"
      const dir = !rest || rest === "memory" ? undefined : rest; // undefined = in-memory
      return PGlite.create(dir);
    })();
  }
  return _pgPromise;
}

export function neon() {
  return async function sql(strings, ...values) {
    const pg = await getPg();
    let text, params;
    if (typeof strings === "string") {
      text = strings;
      params = Array.isArray(values[0]) ? values[0] : [];
    } else {
      text = strings[0];
      for (let i = 0; i < values.length; i++) text += "$" + (i + 1) + strings[i + 1];
      params = values;
    }
    const res = await pg.query(text, params);
    return res.rows;
  };
}
