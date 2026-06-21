function bytesToBase64url(bytes: Uint8Array): string {
  let bin = "";
  for (const b of bytes) bin += String.fromCharCode(b);
  return btoa(bin).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

function base64urlToBytes(s: string): Uint8Array {
  const b64 = s.replace(/-/g, "+").replace(/_/g, "/");
  return Uint8Array.from(atob(b64), (c) => c.charCodeAt(0));
}

export function randomToken(): string {
  return bytesToBase64url(crypto.getRandomValues(new Uint8Array(32)));
}

export function timingSafeEqual(a: string, b: string): boolean {
  const enc = new TextEncoder();
  const ab = enc.encode(a);
  const bb = enc.encode(b);
  let diff = ab.length ^ bb.length;
  const len = Math.max(ab.length, bb.length);
  for (let i = 0; i < len; i++) diff |= (ab[i] ?? 0) ^ (bb[i] ?? 0);
  return diff === 0;
}

async function hmac(secret: string, message: string): Promise<string> {
  const key = await crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(secret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"],
  );
  const sig = await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(message));
  return bytesToBase64url(new Uint8Array(sig));
}

// HMAC-signed, base64url(JSON) payload — used for session cookies and the
// authorization request carried through the login form.
export async function signBlob(secret: string, data: unknown): Promise<string> {
  const payload = bytesToBase64url(new TextEncoder().encode(JSON.stringify(data)));
  return `${payload}.${await hmac(secret, payload)}`;
}

export async function verifyBlob<T>(secret: string, blob: string): Promise<T | null> {
  const dot = blob.lastIndexOf(".");
  if (dot < 0) return null;
  const payload = blob.slice(0, dot);
  const signature = blob.slice(dot + 1);
  if (!timingSafeEqual(await hmac(secret, payload), signature)) return null;
  try {
    return JSON.parse(new TextDecoder().decode(base64urlToBytes(payload))) as T;
  } catch {
    return null;
  }
}
