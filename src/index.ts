import { Hono } from "hono";
import type { Env } from "./env";
import { verifyToken } from "./seatable";
import { loginPage, type AuthorizeParams } from "./views";
import {
  createAuthCode,
  deleteAccessTokenByValue,
  getAccessToken,
  getClient,
  getRefreshToken,
  redirectUriAllowed,
  revokeRefreshToken,
  type ClientRow,
} from "./db";
import { redeemAuthCode, redeemRefreshToken, type GrantResult } from "./grants";
import { sha256Hex, timingSafeEqual } from "./oauth";
import consoleApp from "./console";

const app = new Hono<{ Bindings: Env }>();

app.route("/console", consoleApp);

app.get("/", (c) => c.redirect("/console"));

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

// Public clients (no secret) rely on PKCE; confidential clients must match their secret.
async function authenticateClient(
  client: ClientRow,
  presentedSecret: string | null,
): Promise<boolean> {
  if (!client.client_secret_hash) return true;
  if (!presentedSecret) return false;
  return timingSafeEqual(await sha256Hex(presentedSecret), client.client_secret_hash);
}

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
      /* fall through to form credentials */
    }
  }
  return { clientId: form.client_id ?? null, clientSecret: form.client_secret ?? null };
}

app.get("/authorize", async (c) => {
  const q = c.req.query();
  const clientId = q.client_id ?? "";
  const redirectUri = q.redirect_uri ?? "";
  const state = q.state ?? "";
  const scope = q.scope ?? "";
  const codeChallenge = q.code_challenge ?? "";
  const codeChallengeMethod = q.code_challenge_method ?? "";

  // Errors involving client_id / redirect_uri must NOT redirect (RFC 6749 §4.1.2.1).
  const client = clientId ? await getClient(c.env, clientId) : null;
  if (!client) return c.html("<h1>无效的 client_id</h1>", 400);
  if (!redirectUri || !redirectUriAllowed(client, redirectUri)) {
    return c.html("<h1>无效的 redirect_uri</h1>", 400);
  }

  if ((q.response_type ?? "") !== "code") {
    return redirectError(redirectUri, "unsupported_response_type", state);
  }
  if (!codeChallenge || codeChallengeMethod !== "S256") {
    return redirectError(redirectUri, "invalid_request", state, "PKCE (S256) is required");
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

app.post("/authorize", async (c) => {
  const form = Object.fromEntries(await c.req.formData()) as Record<string, string>;
  const clientId = form.client_id ?? "";
  const redirectUri = form.redirect_uri ?? "";
  const state = form.state ?? "";
  const scope = form.scope ?? "";
  const codeChallenge = form.code_challenge ?? "";
  const codeChallengeMethod = form.code_challenge_method ?? "";

  const client = clientId ? await getClient(c.env, clientId) : null;
  if (!client || !redirectUri || !redirectUriAllowed(client, redirectUri)) {
    return c.html("<h1>无效的 client 或 redirect_uri</h1>", 400);
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
    userId = await verifyToken(c.env, form.token ?? "");
  } catch {
    return c.html(loginPage(params, client.name, "授权服务暂时不可用，请稍后重试。"), 502);
  }
  if (!userId) {
    return c.html(loginPage(params, client.name, "Token 无效，请检查后重试。"), 401);
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

app.post("/token", async (c) => {
  const form = Object.fromEntries(await c.req.formData()) as Record<string, string>;
  const grantType = form.grant_type ?? "";

  const { clientId, clientSecret } = extractClientCredentials(c.req.raw, form);
  if (!clientId) return jsonError(400, "invalid_request", "client_id is required");

  const client = await getClient(c.env, clientId);
  if (!client) return jsonError(401, "invalid_client");
  if (!(await authenticateClient(client, clientSecret))) return jsonError(401, "invalid_client");

  if (grantType === "authorization_code") {
    const result = await redeemAuthCode(c.env, {
      clientId,
      code: form.code ?? "",
      redirectUri: form.redirect_uri ?? "",
      codeVerifier: form.code_verifier ?? "",
    });
    return grantResponse(result);
  }

  if (grantType === "refresh_token") {
    const result = await redeemRefreshToken(c.env, {
      clientId,
      refreshToken: form.refresh_token ?? "",
    });
    return grantResponse(result);
  }

  return jsonError(400, "unsupported_grant_type");
});

function grantResponse(result: GrantResult): Response {
  if (!result.ok) return jsonError(400, result.error, result.description);
  return tokenResponse(result.tokens, result.scope);
}

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

app.post("/introspect", async (c) => {
  const form = Object.fromEntries(await c.req.formData()) as Record<string, string>;
  const token = form.token ?? "";
  const row = token ? await getAccessToken(c.env, token) : null;
  if (!row) return c.json({ active: false });
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

app.post("/revoke", async (c) => {
  const form = Object.fromEntries(await c.req.formData()) as Record<string, string>;
  const token = form.token ?? "";
  if (token) {
    const refresh = await getRefreshToken(c.env, token);
    if (refresh) await revokeRefreshToken(c.env, refresh.token_hash);
    else await deleteAccessTokenByValue(c.env, token);
  }
  return c.body(null, 200);
});

export default app;
