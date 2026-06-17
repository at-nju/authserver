// Crypto + OAuth primitives built on the Web Crypto API (available on Workers).
// Opaque tokens/codes are random base64url strings; only their SHA-256 hex
// digests are ever persisted, so a D1 dump never leaks usable credentials.

/** Token / code / auth-code lifetimes, in seconds. */
export const AUTH_CODE_TTL = 60;            // single-use, short-lived
export const ACCESS_TOKEN_TTL = 60 * 60;    // 1 hour
export const REFRESH_TOKEN_TTL = 60 * 60 * 24 * 30; // 30 days

/** Current unix time in seconds. */
export function now(): number {
  return Math.floor(Date.now() / 1000);
}

/** Encode raw bytes as URL-safe base64 without padding. */
function base64url(bytes: Uint8Array): string {
  let bin = "";
  for (const b of bytes) bin += String.fromCharCode(b);
  return btoa(bin).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

/** Generate a cryptographically random opaque token (~256 bits). */
export function randomToken(): string {
  return base64url(crypto.getRandomValues(new Uint8Array(32)));
}

/** SHA-256 of a UTF-8 string, returned as lowercase hex. */
export async function sha256Hex(input: string): Promise<string> {
  const data = new TextEncoder().encode(input);
  const digest = await crypto.subtle.digest("SHA-256", data);
  return [...new Uint8Array(digest)]
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
}

/** SHA-256 of a UTF-8 string, returned as base64url (used for PKCE S256). */
export async function sha256Base64url(input: string): Promise<string> {
  const data = new TextEncoder().encode(input);
  const digest = await crypto.subtle.digest("SHA-256", data);
  return base64url(new Uint8Array(digest));
}

/** Constant-time comparison of two equal-length-ish strings. */
export function timingSafeEqual(a: string, b: string): boolean {
  const enc = new TextEncoder();
  const ab = enc.encode(a);
  const bb = enc.encode(b);
  // Always compare a fixed amount of work; differing lengths => not equal.
  let diff = ab.length ^ bb.length;
  const len = Math.max(ab.length, bb.length);
  for (let i = 0; i < len; i++) {
    diff |= (ab[i] ?? 0) ^ (bb[i] ?? 0);
  }
  return diff === 0;
}

/**
 * Verify a PKCE code_verifier against a stored S256 challenge.
 * challenge === base64url(SHA256(verifier)).
 */
export async function verifyPkceS256(
  verifier: string,
  challenge: string,
): Promise<boolean> {
  if (!verifier) return false;
  const computed = await sha256Base64url(verifier);
  return timingSafeEqual(computed, challenge);
}
