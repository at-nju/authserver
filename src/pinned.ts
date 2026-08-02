import { config } from "../config";

export const SESSION_COOKIE = "better-auth.session_token";
export const SECURE_SESSION_COOKIE = "__Secure-better-auth.session_token";
const SESSION_TTL_MS = config.auth.sessionTtlSeconds * 1000;

export function sharedUserId(clientId: string): string {
  return `svc_${clientId}`;
}

export function sharedEmail(clientId: string): string {
  return `service.${clientId}@nju.at`;
}

function randomToken(): string {
  const alphabet = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789";
  const bytes = crypto.getRandomValues(new Uint8Array(32));
  let token = "";
  for (const byte of bytes) token += alphabet[byte % alphabet.length];
  return token;
}

async function signSessionToken(secret: string, token: string): Promise<string> {
  const key = await crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(secret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"],
  );
  const signature = new Uint8Array(await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(token)));
  let binary = "";
  for (const byte of signature) binary += String.fromCharCode(byte);
  return btoa(binary);
}

export async function sessionCookieValue(secret: string, token: string): Promise<string> {
  return encodeURIComponent(`${token}.${await signSessionToken(secret, token)}`);
}

export function sessionTokenFromCookie(cookieHeader: string | null): string | null {
  if (!cookieHeader) return null;
  for (const name of [SECURE_SESSION_COOKIE, SESSION_COOKIE]) {
    for (const part of cookieHeader.split(";")) {
      const eq = part.indexOf("=");
      if (eq === -1 || part.slice(0, eq).trim() !== name) continue;
      const value = part.slice(eq + 1).trim();
      if (!value) return null;
      try {
        return decodeURIComponent(value).split(".")[0] ?? null;
      } catch {
        return null;
      }
    }
  }
  return null;
}

export function replaceSessionCookie(cookieHeader: string | null, value: string): string {
  const parts = (cookieHeader ?? "").split(";").map((part) => part.trim()).filter(Boolean);
  let replaced = false;
  const next = parts.map((part) => {
    const eq = part.indexOf("=");
    const key = eq === -1 ? part : part.slice(0, eq).trim();
    if (key === SECURE_SESSION_COOKIE || key === SESSION_COOKIE) {
      replaced = true;
      return `${key}=${value}`;
    }
    return part;
  });
  if (!replaced) next.push(`${SESSION_COOKIE}=${value}`);
  return next.join("; ");
}

export async function findPinnedUser(db: D1Database, clientId: string): Promise<string | null> {
  const row = await db.prepare("SELECT pinnedUserId FROM oauthClient WHERE clientId = ?")
    .bind(clientId).first<{ pinnedUserId: string | null }>();
  return row?.pinnedUserId ?? null;
}

export async function findSessionUser(db: D1Database, token: string): Promise<string | null> {
  const row = await db.prepare("SELECT userId, expiresAt FROM session WHERE token = ?")
    .bind(token).first<{ userId: string; expiresAt: string }>();
  if (!row || new Date(row.expiresAt).getTime() <= Date.now()) return null;
  return row.userId;
}

async function findSharedSession(db: D1Database, userId: string): Promise<{ id: string; token: string } | null> {
  const row = await db.prepare(
    "SELECT id, token FROM session WHERE userId = ? AND expiresAt > ? ORDER BY createdAt DESC LIMIT 1",
  ).bind(userId, new Date().toISOString()).first<{ id: string; token: string }>();
  return row ?? null;
}

async function createSharedSession(db: D1Database, userId: string): Promise<{ id: string; token: string }> {
  const now = new Date();
  const session = { id: randomToken(), token: randomToken() };
  await db.prepare(
    "INSERT INTO session (id, expiresAt, token, createdAt, updatedAt, userId) VALUES (?, ?, ?, ?, ?, ?)",
  ).bind(
    session.id,
    new Date(now.getTime() + SESSION_TTL_MS).toISOString(),
    session.token,
    now.toISOString(),
    now.toISOString(),
    userId,
  ).run();
  return session;
}

export async function authorizeWithPinnedUser(
  db: D1Database,
  secret: string,
  request: Request,
  handler: (request: Request) => Promise<Response>,
): Promise<Response> {
  const clientId = new URL(request.url).searchParams.get("client_id");
  if (!clientId) return handler(request);
  const pinnedUserId = await findPinnedUser(db, clientId);
  if (!pinnedUserId) return handler(request);

  const token = sessionTokenFromCookie(request.headers.get("cookie"));
  if (!token) return handler(request);
  const realUserId = await findSessionUser(db, token);
  if (!realUserId || realUserId === pinnedUserId) return handler(request);

  const client = await db.prepare("SELECT name FROM oauthClient WHERE clientId = ?")
    .bind(clientId).first<{ name: string | null }>();
  if (!client?.name) return handler(request);
  await db.prepare("UPDATE user SET name = ?, updatedAt = ? WHERE id = ? AND name != ?")
    .bind(client.name, new Date().toISOString(), pinnedUserId, client.name).run();

  const shared = (await findSharedSession(db, pinnedUserId))
    ?? await createSharedSession(db, pinnedUserId);

  const cookie = replaceSessionCookie(
    request.headers.get("cookie"),
    await sessionCookieValue(secret, shared.token),
  );
  const swapped = new Request(request, { headers: new Headers(request.headers) });
  swapped.headers.set("cookie", cookie);

  const response = await handler(swapped);
  return withoutSetCookies(response, new Set([SECURE_SESSION_COOKIE, SESSION_COOKIE]));
}

function withoutSetCookies(response: Response, names: Set<string>): Response {
  const headers = new Headers(response.headers);
  const entries = typeof headers.getSetCookie === "function" ? headers.getSetCookie() : [];
  const survivors = entries.filter((entry) => {
    const eq = entry.indexOf("=");
    return eq === -1 || !names.has(entry.slice(0, eq));
  });
  headers.delete("set-cookie");
  for (const entry of survivors) headers.append("set-cookie", entry);
  return new Response(response.body, { status: response.status, statusText: response.statusText, headers });
}

export async function attachPinnedUsers(db: D1Database, response: Response): Promise<Response> {
  if (!response.ok) return response;
  const clients = await response.json<Array<Record<string, unknown>>>();
  const enriched = [];
  for (const client of clients) {
    const row = await db.prepare("SELECT pinnedUserId FROM oauthClient WHERE clientId = ?")
      .bind(String(client.client_id)).first<{ pinnedUserId: string | null }>();
    enriched.push({ ...client, pinned_user_id: row?.pinnedUserId ?? null });
  }
  const headers = new Headers(response.headers);
  headers.delete("content-length");
  return new Response(JSON.stringify(enriched), { status: response.status, headers });
}
