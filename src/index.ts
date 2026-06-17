// OAuth 2.0 Authorization Server (Authorization Code + PKCE) on Cloudflare Workers.
//
// Endpoints:
//   GET  /authorize   -> login page (validates client + PKCE)
//   POST /authorize   -> verify token via SeaTable, issue auth code, redirect back
//   POST /token       -> exchange code (or refresh token) for opaque tokens
//   POST /introspect  -> resource servers validate an access token
//   POST /revoke      -> revoke an access or refresh token
import { Hono } from "hono";
import type { Env } from "./env";
import { verifyToken } from "./seatable";
import { loginPage, type AuthorizeParams } from "./views";
import {
  consumeAuthCode,
  createAuthCode,
  deleteAccessTokenByValue,
  getAccessToken,
  getAuthCode,
  getClient,
  getRefreshToken,
  issueTokens,
  redirectUriAllowed,
  revokeRefreshToken,
  type ClientRow,
} from "./db";
import { now, sha256Hex, timingSafeEqual, verifyPkceS256 } from "./oauth";

const app = new Hono<{ Bindings: Env }>();

app.get("/", (c) => c.text("authserver: OAuth 2.0 (authorization_code + PKCE)\n"));

// ---- helpers --------------------------------------------------------------

/** Append OAuth error params to a redirect URI and return a 302 response. */
function redirectError(
  redirectUri: string,
  error: string,
  state: string,
  description?: string,
): Response {
  const u = new URL(redirectUri);
  u.searchParams.set("error", error);
  if (description) u.searchParams.set("error_description", description);
  if (state) u.searchParams.set("state", state);
  return Response.redirect(u.toString(), 302);
}

function jsonError(status: number, error: string, description?: string): Response {
  return new Response(
    JSON.stringify({ error, ...(description ? { error_description: description } : {}) }),
    { status, headers: { "Content-Type": "application/json", "Cache-Control": "no-store" } },
  );
}

/**
 * Authenticate the client on the token endpoint.
 *  - confidential clients (client_secret_hash set) MUST present a matching secret
 *  - public clients (no secret) rely solely on PKCE
 * Returns true if the request is authorized to act as `client`.
 */
async function authenticateClient(
  client: ClientRow,
  presentedSecret: string | null,
): Promise<boolean> {
  if (!client.client_secret_hash) return true; // public client
  if (!presentedSecret) return false;
  const hash = await sha256Hex(presentedSecret);
  return timingSafeEqual(hash, client.client_secret_hash);
}

/** Read client_secret from form body or HTTP Basic auth header. */
function extractClientCredentials(
  req: Request,
  form: Record<string, string>,
): { clientId: string | null; clientSecret: string | null } {
  const auth = req.headers.get("Authorization");
  if (auth?.startsWith("Basic ")) {
    try {
      const decoded = atob(auth.slice(6));
      const idx = decoded.indexOf(":");
      if (idx >= 0) {
        return {
          clientId: decodeURIComponent(decoded.slice(0, idx)),
          clientSecret: decodeURIComponent(decoded.slice(idx + 1)),
        };
      }
    } catch {
      /* fall through to form-based credentials */
    }
  }
  return {
    clientId: form.client_id ?? null,
    clientSecret: form.client_secret ?? null,
  };
}

// ---- GET /authorize -------------------------------------------------------

app.get("/authorize", async (c) => {
  const q = c.req.query();
  const clientId = q.client_id ?? "";
  const redirectUri = q.redirect_uri ?? "";
  const responseType = q.response_type ?? "";
  const state = q.state ?? "";
  const scope = q.scope ?? "";
  const codeChallenge = q.code_challenge ?? "";
  const codeChallengeMethod = q.code_challenge_method ?? "";

  // Errors involving client_id / redirect_uri must NOT redirect (RFC 6749 §4.1.2.1).
  const client = clientId ? await getClient(c.env, clientId) : null;
  if (!client) {
    return c.html("<h1>Invalid client_id</h1>", 400);
  }
  if (!redirectUri || !redirectUriAllowed(client, redirectUri)) {
    return c.html("<h1>Invalid redirect_uri</h1>", 400);
  }

  // From here on, errors can be reported back to the client via redirect.
  if (responseType !== "code") {
    return redirectError(redirectUri, "unsupported_response_type", state);
  }
  if (!codeChallenge || codeChallengeMethod !== "S256") {
    return redirectError(
      redirectUri,
      "invalid_request",
      state,
      "PKCE with code_challenge_method=S256 is required",
    );
  }

  const params: AuthorizeParams = {
    client_id: clientId,
    redirect_uri: redirectUri,
    state,
    scope,
    code_challenge: codeChallenge,
    code_challenge_method: codeChallengeMethod,
  };
  return c.html(loginPage(params, client.name));
});

// ---- POST /authorize (login submit) --------------------------------------

app.post("/authorize", async (c) => {
  const form = Object.fromEntries(await c.req.formData()) as Record<string, string>;
  const clientId = form.client_id ?? "";
  const redirectUri = form.redirect_uri ?? "";
  const state = form.state ?? "";
  const scope = form.scope ?? "";
  const codeChallenge = form.code_challenge ?? "";
  const codeChallengeMethod = form.code_challenge_method ?? "";
  const token = form.token ?? "";

  const client = clientId ? await getClient(c.env, clientId) : null;
  if (!client || !redirectUri || !redirectUriAllowed(client, redirectUri)) {
    return c.html("<h1>Invalid client or redirect_uri</h1>", 400);
  }
  if (!codeChallenge || codeChallengeMethod !== "S256") {
    return redirectError(redirectUri, "invalid_request", state, "PKCE required");
  }

  const params: AuthorizeParams = {
    client_id: clientId,
    redirect_uri: redirectUri,
    state,
    scope,
    code_challenge: codeChallenge,
    code_challenge_method: codeChallengeMethod,
  };

  let userId: string | null;
  try {
    userId = await verifyToken(c.env, token);
  } catch {
    return c.html(loginPage(params, client.name, "Authorization service unavailable. Try again."), 502);
  }

  if (!userId) {
    return c.html(loginPage(params, client.name, "Invalid token. Please check and try again."), 401);
  }

  const code = await createAuthCode(c.env, {
    clientId,
    userId,
    redirectUri,
    scope: scope || null,
    codeChallenge,
    codeChallengeMethod,
  });

  const u = new URL(redirectUri);
  u.searchParams.set("code", code);
  if (state) u.searchParams.set("state", state);
  return Response.redirect(u.toString(), 302);
});

// ---- POST /token ----------------------------------------------------------

app.post("/token", async (c) => {
  const form = Object.fromEntries(await c.req.formData()) as Record<string, string>;
  const grantType = form.grant_type ?? "";

  const { clientId, clientSecret } = extractClientCredentials(c.req.raw, form);
  if (!clientId) return jsonError(400, "invalid_request", "client_id is required");

  const client = await getClient(c.env, clientId);
  if (!client) return jsonError(401, "invalid_client");
  if (!(await authenticateClient(client, clientSecret))) {
    return jsonError(401, "invalid_client");
  }

  if (grantType === "authorization_code") {
    const code = form.code ?? "";
    const redirectUri = form.redirect_uri ?? "";
    const codeVerifier = form.code_verifier ?? "";

    const row = await getAuthCode(c.env, code);
    if (!row || row.used === 1 || row.expires_at <= now()) {
      return jsonError(400, "invalid_grant", "Authorization code is invalid or expired");
    }
    if (row.client_id !== clientId || row.redirect_uri !== redirectUri) {
      return jsonError(400, "invalid_grant", "client_id / redirect_uri mismatch");
    }
    if (!(await verifyPkceS256(codeVerifier, row.code_challenge))) {
      return jsonError(400, "invalid_grant", "PKCE verification failed");
    }
    // Atomic single-use guard against replay.
    if (!(await consumeAuthCode(c.env, row.code_hash))) {
      return jsonError(400, "invalid_grant", "Authorization code already used");
    }

    const tokens = await issueTokens(c.env, {
      clientId,
      userId: row.user_id,
      scope: row.scope,
    });
    return tokenResponse(tokens, row.scope);
  }

  if (grantType === "refresh_token") {
    const refreshToken = form.refresh_token ?? "";
    const row = await getRefreshToken(c.env, refreshToken);
    if (!row || row.revoked === 1 || row.expires_at <= now() || row.client_id !== clientId) {
      return jsonError(400, "invalid_grant", "Refresh token is invalid or expired");
    }
    // Rotate: revoke the presented refresh token, issue a fresh pair.
    await revokeRefreshToken(c.env, row.token_hash);
    const tokens = await issueTokens(c.env, {
      clientId,
      userId: row.user_id,
      scope: row.scope,
    });
    return tokenResponse(tokens, row.scope);
  }

  return jsonError(400, "unsupported_grant_type");
});

function tokenResponse(
  tokens: { accessToken: string; refreshToken: string; accessExpiresIn: number },
  scope: string | null,
): Response {
  return new Response(
    JSON.stringify({
      access_token: tokens.accessToken,
      token_type: "Bearer",
      expires_in: tokens.accessExpiresIn,
      refresh_token: tokens.refreshToken,
      ...(scope ? { scope } : {}),
    }),
    { status: 200, headers: { "Content-Type": "application/json", "Cache-Control": "no-store" } },
  );
}

// ---- POST /introspect (RFC 7662, simplified) -----------------------------

app.post("/introspect", async (c) => {
  const form = Object.fromEntries(await c.req.formData()) as Record<string, string>;
  const token = form.token ?? "";
  const row = token ? await getAccessToken(c.env, token) : null;
  if (!row) {
    return c.json({ active: false });
  }
  return c.json({
    active: true,
    client_id: row.client_id,
    user_id: row.user_id,
    sub: row.user_id,
    scope: row.scope ?? undefined,
    exp: row.expires_at,
    token_type: "Bearer",
  });
});

// ---- POST /revoke (RFC 7009) ---------------------------------------------

app.post("/revoke", async (c) => {
  const form = Object.fromEntries(await c.req.formData()) as Record<string, string>;
  const token = form.token ?? "";
  if (token) {
    // Try as refresh token first, then as access token. Always return 200.
    const refresh = await getRefreshToken(c.env, token);
    if (refresh) {
      await revokeRefreshToken(c.env, refresh.token_hash);
    } else {
      await deleteAccessTokenByValue(c.env, token);
    }
  }
  return c.body(null, 200);
});

export default app;
