import type { Env } from "./env";
import {
  consumeAuthCode,
  getAuthCode,
  getRefreshToken,
  issueTokens,
  revokeRefreshToken,
  type IssuedTokens,
} from "./db";
import { now, verifyPkceS256 } from "./oauth";

export type GrantResult =
  | { ok: true; tokens: IssuedTokens; scope: string | null }
  | { ok: false; error: string; description?: string };

export async function redeemAuthCode(
  env: Env,
  p: { clientId: string; code: string; redirectUri: string; codeVerifier: string },
): Promise<GrantResult> {
  const row = await getAuthCode(env, p.code);
  if (!row || row.used === 1 || row.expires_at <= now()) {
    return { ok: false, error: "invalid_grant", description: "Authorization code is invalid or expired" };
  }
  if (row.client_id !== p.clientId || row.redirect_uri !== p.redirectUri) {
    return { ok: false, error: "invalid_grant", description: "client_id / redirect_uri mismatch" };
  }
  if (!(await verifyPkceS256(p.codeVerifier, row.code_challenge))) {
    return { ok: false, error: "invalid_grant", description: "PKCE verification failed" };
  }
  if (!(await consumeAuthCode(env, row.code_hash))) {
    return { ok: false, error: "invalid_grant", description: "Authorization code already used" };
  }
  const tokens = await issueTokens(env, { clientId: p.clientId, userId: row.user_id, scope: row.scope });
  return { ok: true, tokens, scope: row.scope };
}

export async function redeemRefreshToken(
  env: Env,
  p: { clientId: string; refreshToken: string },
): Promise<GrantResult> {
  const row = await getRefreshToken(env, p.refreshToken);
  if (!row || row.revoked === 1 || row.expires_at <= now() || row.client_id !== p.clientId) {
    return { ok: false, error: "invalid_grant", description: "Refresh token is invalid or expired" };
  }
  await revokeRefreshToken(env, row.token_hash);
  const tokens = await issueTokens(env, { clientId: p.clientId, userId: row.user_id, scope: row.scope });
  return { ok: true, tokens, scope: row.scope };
}
