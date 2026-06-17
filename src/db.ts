import type { Env } from "./env";
import {
  ACCESS_TOKEN_TTL,
  AUTH_CODE_TTL,
  REFRESH_TOKEN_TTL,
  now,
  randomToken,
  sha256Hex,
} from "./oauth";

export interface ClientRow {
  client_id: string;
  client_secret_hash: string | null;
  name: string;
  redirect_uris: string;
  owner_id: string | null;
}

export interface AuthCodeRow {
  code_hash: string;
  client_id: string;
  user_id: string;
  redirect_uri: string;
  scope: string | null;
  code_challenge: string;
  code_challenge_method: string;
  expires_at: number;
  used: number;
}

export interface TokenRow {
  token_hash: string;
  client_id: string;
  user_id: string;
  scope: string | null;
  expires_at: number;
  revoked?: number;
}

export async function getClient(env: Env, clientId: string): Promise<ClientRow | null> {
  return env.DB.prepare(
    "SELECT client_id, client_secret_hash, name, redirect_uris, owner_id FROM clients WHERE client_id = ?",
  )
    .bind(clientId)
    .first<ClientRow>();
}

// redirect_uris is a newline-separated allow-list, matched exactly.
export function redirectUriAllowed(client: ClientRow, redirectUri: string): boolean {
  return client.redirect_uris
    .split("\n")
    .map((u) => u.trim())
    .filter(Boolean)
    .includes(redirectUri);
}

export async function createAuthCode(
  env: Env,
  params: {
    clientId: string;
    userId: string;
    redirectUri: string;
    scope: string | null;
    codeChallenge: string;
    codeChallengeMethod: string;
  },
): Promise<string> {
  const code = randomToken();
  const ts = now();
  await env.DB.prepare(
    `INSERT INTO auth_codes
       (code_hash, client_id, user_id, redirect_uri, scope,
        code_challenge, code_challenge_method, expires_at, used, created_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, 0, ?)`,
  )
    .bind(
      await sha256Hex(code),
      params.clientId,
      params.userId,
      params.redirectUri,
      params.scope,
      params.codeChallenge,
      params.codeChallengeMethod,
      ts + AUTH_CODE_TTL,
      ts,
    )
    .run();
  return code;
}

export async function getAuthCode(env: Env, code: string): Promise<AuthCodeRow | null> {
  return env.DB.prepare(
    `SELECT code_hash, client_id, user_id, redirect_uri, scope,
            code_challenge, code_challenge_method, expires_at, used
       FROM auth_codes WHERE code_hash = ?`,
  )
    .bind(await sha256Hex(code))
    .first<AuthCodeRow>();
}

// Atomic single-use guard: returns true only if THIS call flipped used 0 -> 1.
export async function consumeAuthCode(env: Env, codeHash: string): Promise<boolean> {
  const res = await env.DB.prepare(
    "UPDATE auth_codes SET used = 1 WHERE code_hash = ? AND used = 0",
  )
    .bind(codeHash)
    .run();
  return (res.meta.changes ?? 0) === 1;
}

export interface IssuedTokens {
  accessToken: string;
  refreshToken: string;
  accessExpiresIn: number;
}

export async function issueTokens(
  env: Env,
  params: { clientId: string; userId: string; scope: string | null },
): Promise<IssuedTokens> {
  const accessToken = randomToken();
  const refreshToken = randomToken();
  const ts = now();

  await env.DB.batch([
    env.DB.prepare(
      `INSERT INTO access_tokens (token_hash, client_id, user_id, scope, expires_at, created_at)
       VALUES (?, ?, ?, ?, ?, ?)`,
    ).bind(await sha256Hex(accessToken), params.clientId, params.userId, params.scope, ts + ACCESS_TOKEN_TTL, ts),
    env.DB.prepare(
      `INSERT INTO refresh_tokens (token_hash, client_id, user_id, scope, expires_at, revoked, created_at)
       VALUES (?, ?, ?, ?, ?, 0, ?)`,
    ).bind(await sha256Hex(refreshToken), params.clientId, params.userId, params.scope, ts + REFRESH_TOKEN_TTL, ts),
  ]);

  return { accessToken, refreshToken, accessExpiresIn: ACCESS_TOKEN_TTL };
}

export async function getAccessToken(env: Env, token: string): Promise<TokenRow | null> {
  const row = await env.DB.prepare(
    "SELECT token_hash, client_id, user_id, scope, expires_at FROM access_tokens WHERE token_hash = ?",
  )
    .bind(await sha256Hex(token))
    .first<TokenRow>();
  if (!row || row.expires_at <= now()) return null;
  return row;
}

export async function getRefreshToken(env: Env, token: string): Promise<TokenRow | null> {
  return env.DB.prepare(
    "SELECT token_hash, client_id, user_id, scope, expires_at, revoked FROM refresh_tokens WHERE token_hash = ?",
  )
    .bind(await sha256Hex(token))
    .first<TokenRow>();
}

export async function revokeRefreshToken(env: Env, tokenHash: string): Promise<void> {
  await env.DB.prepare("UPDATE refresh_tokens SET revoked = 1 WHERE token_hash = ?")
    .bind(tokenHash)
    .run();
}

export async function deleteAccessTokenByValue(env: Env, token: string): Promise<void> {
  await env.DB.prepare("DELETE FROM access_tokens WHERE token_hash = ?")
    .bind(await sha256Hex(token))
    .run();
}

function genClientId(): string {
  const bytes = crypto.getRandomValues(new Uint8Array(8));
  return "cli_" + [...bytes].map((b) => b.toString(16).padStart(2, "0")).join("");
}

export async function createManagedClient(
  env: Env,
  params: { ownerId: string; name: string; redirectUris: string; confidential: boolean },
): Promise<{ clientId: string; clientSecret?: string }> {
  const clientId = genClientId();
  let clientSecret: string | undefined;
  let secretHash: string | null = null;
  if (params.confidential) {
    clientSecret = randomToken();
    secretHash = await sha256Hex(clientSecret);
  }
  await env.DB.prepare(
    `INSERT INTO clients (client_id, client_secret_hash, name, redirect_uris, owner_id, created_at)
     VALUES (?, ?, ?, ?, ?, ?)`,
  )
    .bind(clientId, secretHash, params.name, params.redirectUris, params.ownerId, now())
    .run();
  return { clientId, clientSecret };
}

export async function listClientsByOwner(env: Env, ownerId: string): Promise<ClientRow[]> {
  const res = await env.DB.prepare(
    "SELECT client_id, client_secret_hash, name, redirect_uris, owner_id FROM clients WHERE owner_id = ? ORDER BY rowid DESC",
  )
    .bind(ownerId)
    .all<ClientRow>();
  return res.results ?? [];
}

export async function getOwnedClient(
  env: Env,
  clientId: string,
  ownerId: string,
): Promise<ClientRow | null> {
  return env.DB.prepare(
    "SELECT client_id, client_secret_hash, name, redirect_uris, owner_id FROM clients WHERE client_id = ? AND owner_id = ?",
  )
    .bind(clientId, ownerId)
    .first<ClientRow>();
}

export async function updateOwnedClient(
  env: Env,
  clientId: string,
  ownerId: string,
  params: { name: string; redirectUris: string },
): Promise<boolean> {
  const res = await env.DB.prepare(
    "UPDATE clients SET name = ?, redirect_uris = ? WHERE client_id = ? AND owner_id = ?",
  )
    .bind(params.name, params.redirectUris, clientId, ownerId)
    .run();
  return (res.meta.changes ?? 0) === 1;
}

export async function deleteOwnedClient(env: Env, clientId: string, ownerId: string): Promise<boolean> {
  const res = await env.DB.prepare("DELETE FROM clients WHERE client_id = ? AND owner_id = ?")
    .bind(clientId, ownerId)
    .run();
  return (res.meta.changes ?? 0) === 1;
}

// Returns the new plaintext secret, or null if the client isn't owned/confidential.
export async function rotateClientSecret(
  env: Env,
  clientId: string,
  ownerId: string,
): Promise<string | null> {
  const client = await getOwnedClient(env, clientId, ownerId);
  if (!client || !client.client_secret_hash) return null;
  const secret = randomToken();
  await env.DB.prepare("UPDATE clients SET client_secret_hash = ? WHERE client_id = ? AND owner_id = ?")
    .bind(await sha256Hex(secret), clientId, ownerId)
    .run();
  return secret;
}
