import { Hono, type Context, type Next } from "hono";
import { deleteCookie, getCookie, setCookie } from "hono/cookie";
import type { Env } from "./env";
import {
  createManagedClient,
  deleteAccessTokenByValue,
  deleteOwnedClient,
  getAccessToken,
  getOwnedClient,
  getRefreshToken,
  listClientsByOwner,
  revokeRefreshToken,
  rotateClientSecret,
  updateOwnedClient,
} from "./db";
import { redeemAuthCode, redeemRefreshToken } from "./grants";
import { randomToken, sha256Base64url } from "./oauth";
import {
  appsPage,
  editAppPage,
  newAppPage,
  secretRevealPage,
} from "./console_views";

const CONSOLE_CLIENT_ID = "__console__";
const SESSION_COOKIE = "session";
const TX_COOKIE = "oauth_tx";

type Vars = { userId: string };
type Ctx = Context<{ Bindings: Env; Variables: Vars }>;

const app = new Hono<{ Bindings: Env; Variables: Vars }>();

function cookieOpts(c: Ctx) {
  return {
    httpOnly: true,
    secure: new URL(c.req.url).protocol === "https:",
    sameSite: "Lax" as const,
    path: "/console",
  };
}

function setSession(c: Ctx, access: string, refresh: string) {
  setCookie(c, SESSION_COOKIE, `${access}|${refresh}`, {
    ...cookieOpts(c),
    maxAge: 60 * 60 * 24 * 30,
  });
}

function normalizeUris(raw: string): string | null {
  const lines = raw.split(/\r?\n/).map((s) => s.trim()).filter(Boolean);
  if (!lines.length) return null;
  for (const l of lines) {
    try {
      new URL(l);
    } catch {
      return null;
    }
  }
  return lines.join("\n");
}

// Resolve the logged-in user from the session cookie, refreshing if needed.
// Only tokens issued to the console client itself grant management access.
async function requireSession(c: Ctx, next: Next) {
  const sess = getCookie(c, SESSION_COOKIE);
  if (!sess) return c.redirect("/console/login");
  const [access, refresh] = sess.split("|");

  const row = access ? await getAccessToken(c.env, access) : null;
  if (row && row.client_id === CONSOLE_CLIENT_ID) {
    c.set("userId", row.user_id);
    return next();
  }

  if (refresh) {
    const r = await redeemRefreshToken(c.env, { clientId: CONSOLE_CLIENT_ID, refreshToken: refresh });
    if (r.ok) {
      setSession(c, r.tokens.accessToken, r.tokens.refreshToken);
      const fresh = await getAccessToken(c.env, r.tokens.accessToken);
      if (fresh) {
        c.set("userId", fresh.user_id);
        return next();
      }
    }
  }

  deleteCookie(c, SESSION_COOKIE, { path: "/console" });
  return c.redirect("/console/login");
}

app.get("/", (c) => c.redirect("/console/apps"));

app.get("/login", async (c) => {
  const verifier = randomToken();
  const challenge = await sha256Base64url(verifier);
  const state = randomToken();
  setCookie(c, TX_COOKIE, `${verifier}|${state}`, { ...cookieOpts(c), maxAge: 600 });

  const origin = new URL(c.req.url).origin;
  const u = new URL(`${origin}/authorize`);
  u.searchParams.set("response_type", "code");
  u.searchParams.set("client_id", CONSOLE_CLIENT_ID);
  u.searchParams.set("redirect_uri", `${origin}/console/callback`);
  u.searchParams.set("code_challenge", challenge);
  u.searchParams.set("code_challenge_method", "S256");
  u.searchParams.set("state", state);
  u.searchParams.set("scope", "manage");
  return c.redirect(u.toString());
});

app.get("/callback", async (c) => {
  const code = c.req.query("code") ?? "";
  const state = c.req.query("state") ?? "";
  const tx = getCookie(c, TX_COOKIE) ?? "";
  deleteCookie(c, TX_COOKIE, { path: "/console" });
  const [verifier, expectedState] = tx.split("|");
  if (!code || !verifier || !state || state !== expectedState) {
    return c.text("登录失败，请重试。", 400);
  }

  const origin = new URL(c.req.url).origin;
  const result = await redeemAuthCode(c.env, {
    clientId: CONSOLE_CLIENT_ID,
    code,
    redirectUri: `${origin}/console/callback`,
    codeVerifier: verifier,
  });
  if (!result.ok) return c.text(`登录失败：${result.error}`, 400);

  setSession(c, result.tokens.accessToken, result.tokens.refreshToken);
  return c.redirect("/console/apps");
});

app.post("/logout", async (c) => {
  const sess = getCookie(c, SESSION_COOKIE);
  if (sess) {
    const [access, refresh] = sess.split("|");
    if (refresh) {
      const r = await getRefreshToken(c.env, refresh);
      if (r) await revokeRefreshToken(c.env, r.token_hash);
    }
    if (access) await deleteAccessTokenByValue(c.env, access);
  }
  deleteCookie(c, SESSION_COOKIE, { path: "/console" });
  return c.redirect("/console/login");
});

app.get("/apps", requireSession, async (c) => {
  const userId = c.get("userId");
  const clients = await listClientsByOwner(c.env, userId);
  return c.html(appsPage(userId, clients));
});

app.get("/apps/new", requireSession, (c) => c.html(newAppPage(c.get("userId"))));

app.post("/apps", requireSession, async (c) => {
  const userId = c.get("userId");
  const form = Object.fromEntries(await c.req.formData()) as Record<string, string>;
  const name = (form.name ?? "").trim();
  const redirectUris = normalizeUris(form.redirect_uris ?? "");
  const confidential = form.type === "confidential";
  if (!name || !redirectUris) {
    return c.html(newAppPage(userId, "名称不能为空，回调地址需为合法 URL(每行一个)。"), 400);
  }
  const { clientId, clientSecret } = await createManagedClient(c.env, {
    ownerId: userId,
    name,
    redirectUris,
    confidential,
  });
  if (clientSecret) return c.html(secretRevealPage(userId, clientId, clientSecret, true));
  return c.redirect(`/console/apps/${encodeURIComponent(clientId)}`);
});

app.get("/apps/:id", requireSession, async (c) => {
  const userId = c.get("userId");
  const client = await getOwnedClient(c.env, c.req.param("id") ?? "", userId);
  if (!client) return c.text("应用不存在或无权访问。", 404);
  return c.html(editAppPage(userId, client));
});

app.post("/apps/:id", requireSession, async (c) => {
  const userId = c.get("userId");
  const id = c.req.param("id") ?? "";
  const form = Object.fromEntries(await c.req.formData()) as Record<string, string>;
  const name = (form.name ?? "").trim();
  const redirectUris = normalizeUris(form.redirect_uris ?? "");
  if (!name || !redirectUris) {
    const client = await getOwnedClient(c.env, id, userId);
    if (!client) return c.text("应用不存在或无权访问。", 404);
    return c.html(editAppPage(userId, client, "名称不能为空，回调地址需为合法 URL(每行一个)。"), 400);
  }
  const ok = await updateOwnedClient(c.env, id, userId, { name, redirectUris });
  if (!ok) return c.text("应用不存在或无权访问。", 404);
  return c.redirect(`/console/apps/${encodeURIComponent(id)}`);
});

app.post("/apps/:id/secret", requireSession, async (c) => {
  const userId = c.get("userId");
  const id = c.req.param("id") ?? "";
  const secret = await rotateClientSecret(c.env, id, userId);
  if (!secret) return c.text("应用不存在、无权访问，或不是机密客户端。", 404);
  return c.html(secretRevealPage(userId, id, secret, false));
});

app.post("/apps/:id/delete", requireSession, async (c) => {
  const ok = await deleteOwnedClient(c.env, c.req.param("id") ?? "", c.get("userId"));
  if (!ok) return c.text("应用不存在或无权访问。", 404);
  return c.redirect("/console/apps");
});

export default app;
