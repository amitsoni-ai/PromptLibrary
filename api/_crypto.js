// Password hashing + token generation. No external deps — node:crypto only.
import { scrypt, randomBytes, timingSafeEqual, createHash } from "node:crypto";
import { promisify } from "node:util";

const scryptAsync = promisify(scrypt);

// scrypt params. N=2^15 keeps a hash well under Vercel's function budget while
// staying expensive enough for an interactive login.
const N = 32768, R = 8, P = 1, KEYLEN = 32;
const b64 = (b) => Buffer.from(b).toString("base64");
const fromb64 = (s) => Buffer.from(s, "base64");

export async function hashPassword(plain) {
  if (typeof plain !== "string" || plain.length < 5) throw new Error("weak-password");
  const salt = randomBytes(16);
  const dk = await scryptAsync(plain, salt, KEYLEN, { N, r: R, p: P, maxmem: 64 * 1024 * 1024 });
  return `scrypt$${N}$${R}$${P}$${b64(salt)}$${b64(dk)}`;
}

export async function verifyPassword(plain, stored) {
  try {
    const [scheme, n, r, p, saltB64, hashB64] = String(stored).split("$");
    if (scheme !== "scrypt") return false;
    const salt = fromb64(saltB64);
    const expected = fromb64(hashB64);
    const dk = await scryptAsync(plain, salt, expected.length, {
      N: +n, r: +r, p: +p, maxmem: 64 * 1024 * 1024,
    });
    return dk.length === expected.length && timingSafeEqual(dk, expected);
  } catch { return false; }
}

// Optional constant-time-ish dummy work so "email not found" and "wrong
// password" take a similar time (mitigates user enumeration by timing).
const DUMMY_HASH = "scrypt$32768$8$1$AAAAAAAAAAAAAAAAAAAAAA==$" +
  "Y2FudmVyaWZ5dGhpc2R1bW15aGFzaHZhbHVlMDAwMDAwMD0=";
export async function burnTime(plain = "x") { await verifyPassword(plain, DUMMY_HASH); }

// URL-safe random token for email verification / password reset links.
export function randomToken(bytes = 32) {
  return randomBytes(bytes).toString("base64url");
}

// Tokens are stored HASHED so a DB read can't be replayed as a live link.
export function sha256(s) {
  return createHash("sha256").update(String(s)).digest("hex");
}

// id helpers
export function newId(prefix) {
  return `${prefix}_${randomBytes(9).toString("base64url")}`;
}

// Split-secret session id: public half is the row PK, secret half is sent to
// the client and stored only as a hash. Cookie value = "<id>.<secret>".
export function newSessionParts(prefix) {
  const id = newId(prefix);
  const secret = randomBytes(24).toString("base64url");
  return { id, secret, secretHash: sha256(secret), value: `${id}.${secret}` };
}
export function splitSessionValue(v) {
  const s = String(v || "");
  const dot = s.indexOf(".");
  if (dot < 1) return null;
  return { id: s.slice(0, dot), secret: s.slice(dot + 1) };
}
