// FNV-1a string hash — 1:1 port of src/part_app_1.js#hashStr. Used only for a
// small, stable pseudo-random jitter in the recommendation scorer; does not
// need to be cryptographically anything, just deterministic.
export function hashStr(str: string): number {
  let h = 2166136261;
  for (let i = 0; i < str.length; i++) {
    h ^= str.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return h >>> 0;
}
