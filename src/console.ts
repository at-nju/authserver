import { Hono, type Context, type Next } from "hono";
import { deleteCookie, getCookie, setCookie } from "hono/cookie";
import type { ClientInfo } from "@cloudflare/workers-oauth-provider";
import type { Env } from "./env";
import { randomToken, signBlob, verifyBlob } from "./crypto";
import { verifyUser } from "./seatable";
import { addOwnership, listClientIds, ownerOf, removeOwnership } from "./ownership";
import { loginPage } from "./views";
import { appsPage, editAppPage, newAppPage, secretRevealPage } from "./console_views";

const SESSION_COOKIE = "session";
const SESSION_TTL = 60 * 60 * 24 * 7;
const LOGIN_TITLE = "管理后台登录";
const LOGIN_SUBTITLE = "登录以管理你的 OAuth 应用，请粘贴你的 Token 以继续。";

interface Session {
  userId: string;
  name: string;
  exp: number;
}

type Vars = { session: Session };
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

function nowSec(): number {
  return Math.floor(Date.now() / 1000);
}

function userLabel(s: Session): string {
  return s.name || s.userId;
}

function consoleLoginPage(error?: string) {
  return loginPage({ action: "/console/login", title: LOGIN_TITLE, subtitle: LOGIN_SUBTITLE, error });
}

function normalizeUris(raw: string): string[] | null {
  const lines = raw.split(/\r?\n/).map((s) => s.trim()).filter(Boolean);
  if (!lines.length) return null;
  for (const l of lines) {
    try {
      new URL(l);
    } catch {
      return null;
    }
  }
  return lines;
}

async function requireSession(c: Ctx, next: Next) {
  const raw = getCookie(c, SESSION_COOKIE);
  const session = raw ? await verifyBlob<Session>(c.env.CONSOLE_SESSION_SECRET, raw) : null;
  if (!session || session.exp < nowSec()) {
    deleteCookie(c, SESSION_COOKIE, { path: "/console" });
    return c.redirect("/console/login");
  }
  c.set("session", session);
  return next();
}

async function getOwnedClient(c: Ctx, clientId: string): Promise<ClientInfo | null> {
  if ((await ownerOf(c.env, clientId)) !== c.get("session").userId) return null;
  return c.env.OAUTH_PROVIDER.lookupClient(clientId);
}

app.get("/", (c) => c.redirect("/console/apps"));

app.get("/login", (c) => c.html(consoleLoginPage()));

app.post("/login", async (c) => {
  const form = Object.fromEntries(await c.req.formData()) as Record<string, string>;
  let user;
  try {
    user = await verifyUser(c.env, form.token ?? "");
  } catch {
    return c.html(consoleLoginPage("授权服务暂时不可用，请稍后重试。"), 502);
  }
  if (!user) return c.html(consoleLoginPage("Token 无效，请检查后重试。"), 401);

  const session: Session = { userId: user.id, name: user.name, exp: nowSec() + SESSION_TTL };
  const cookie = await signBlob(c.env.CONSOLE_SESSION_SECRET, session);
  setCookie(c, SESSION_COOKIE, cookie, { ...cookieOpts(c), maxAge: SESSION_TTL });
  return c.redirect("/console/apps");
});

app.post("/logout", (c) => {
  deleteCookie(c, SESSION_COOKIE, { path: "/console" });
  return c.redirect("/console/login");
});

app.get("/apps", requireSession, async (c) => {
  const session = c.get("session");
  const ids = await listClientIds(c.env, session.userId);
  const clients = (await Promise.all(ids.map((id) => c.env.OAUTH_PROVIDER.lookupClient(id)))).filter(
    (client): client is ClientInfo => client != null,
  );
  return c.html(appsPage(userLabel(session), clients));
});

app.get("/apps/new", requireSession, (c) => c.html(newAppPage(userLabel(c.get("session")))));

app.post("/apps", requireSession, async (c) => {
  const session = c.get("session");
  const form = Object.fromEntries(await c.req.formData()) as Record<string, string>;
  const name = (form.name ?? "").trim();
  const redirectUris = normalizeUris(form.redirect_uris ?? "");
  if (!name || !redirectUris) {
    return c.html(newAppPage(userLabel(session), "名称不能为空，回调地址需为合法 URL（每行一个）。"), 400);
  }
  const client = await c.env.OAUTH_PROVIDER.createClient({
    clientName: name,
    redirectUris,
    tokenEndpointAuthMethod: form.type === "confidential" ? "client_secret_basic" : "none",
  });
  await addOwnership(c.env, session.userId, client.clientId);
  if (client.clientSecret) {
    return c.html(secretRevealPage(userLabel(session), client.clientId, client.clientSecret, true));
  }
  return c.redirect(`/console/apps/${encodeURIComponent(client.clientId)}`);
});

app.get("/apps/:id", requireSession, async (c) => {
  const client = await getOwnedClient(c, c.req.param("id") ?? "");
  if (!client) return c.text("应用不存在或无权访问。", 404);
  return c.html(editAppPage(userLabel(c.get("session")), client));
});

app.post("/apps/:id", requireSession, async (c) => {
  const id = c.req.param("id") ?? "";
  const client = await getOwnedClient(c, id);
  if (!client) return c.text("应用不存在或无权访问。", 404);
  const form = Object.fromEntries(await c.req.formData()) as Record<string, string>;
  const name = (form.name ?? "").trim();
  const redirectUris = normalizeUris(form.redirect_uris ?? "");
  if (!name || !redirectUris) {
    return c.html(
      editAppPage(userLabel(c.get("session")), client, "名称不能为空，回调地址需为合法 URL（每行一个）。"),
      400,
    );
  }
  await c.env.OAUTH_PROVIDER.updateClient(id, { clientName: name, redirectUris });
  return c.redirect(`/console/apps/${encodeURIComponent(id)}`);
});

app.post("/apps/:id/secret", requireSession, async (c) => {
  const id = c.req.param("id") ?? "";
  const client = await getOwnedClient(c, id);
  if (!client || client.tokenEndpointAuthMethod === "none") {
    return c.text("应用不存在、无权访问，或不是机密客户端。", 404);
  }
  const secret = randomToken();
  await c.env.OAUTH_PROVIDER.updateClient(id, { clientSecret: secret });
  return c.html(secretRevealPage(userLabel(c.get("session")), id, secret, false));
});

app.post("/apps/:id/delete", requireSession, async (c) => {
  const id = c.req.param("id") ?? "";
  const session = c.get("session");
  if ((await ownerOf(c.env, id)) !== session.userId) return c.text("应用不存在或无权访问。", 404);
  await c.env.OAUTH_PROVIDER.deleteClient(id);
  await removeOwnership(c.env, session.userId, id);
  return c.redirect("/console/apps");
});

export default app;
