import { Hono } from "hono";
import { OAuthProvider, OAuthError, GrantType, type AuthRequest } from "@cloudflare/workers-oauth-provider";
import type { Env } from "./env";
import { verifyUser, currentTokenHash } from "./seatable";
import { signBlob, verifyBlob, sha256Hex } from "./crypto";
import { loginPage } from "./views";
import { userInfoHandler } from "./userinfo";
import consoleApp from "./console";

const AUTHORIZE_TITLE = "授权登录";
const AUTH_REQ_FIELD = "auth_req";

const app = new Hono<{ Bindings: Env }>();

app.route("/console", consoleApp);
app.get("/", (c) => c.redirect("/console"));

function authorizeSubtitle(appName: string): string {
  return `${appName} 请求访问你的账号，请粘贴你的 Token 以继续。`;
}

function authorizePage(action: string, appName: string, authReqBlob: string, error?: string): string {
  return loginPage({
    action,
    title: AUTHORIZE_TITLE,
    subtitle: authorizeSubtitle(appName),
    hidden: { [AUTH_REQ_FIELD]: authReqBlob },
    error,
  });
}

// parseAuthRequest validates client_id, redirect_uri and PKCE, throwing on
// failure. Per RFC 6749 §4.1.2.1 these errors must not redirect back.
app.get("/authorize", async (c) => {
  let authReq: AuthRequest;
  try {
    authReq = await c.env.OAUTH_PROVIDER.parseAuthRequest(c.req.raw);
  } catch {
    return c.html("<h1>无效的授权请求</h1><p>client_id、redirect_uri 或 PKCE 参数不正确。</p>", 400);
  }
  const client = await c.env.OAUTH_PROVIDER.lookupClient(authReq.clientId);
  if (!client) return c.html("<h1>无效的 client_id</h1>", 400);

  const blob = await signBlob(c.env.CONSOLE_SESSION_SECRET, authReq);
  return c.html(authorizePage("/authorize", client.clientName ?? client.clientId, blob));
});

app.post("/authorize", async (c) => {
  const form = Object.fromEntries(await c.req.formData()) as Record<string, string>;
  const blob = form[AUTH_REQ_FIELD] ?? "";
  const authReq = await verifyBlob<AuthRequest>(c.env.CONSOLE_SESSION_SECRET, blob);
  if (!authReq) return c.html("<h1>授权请求已失效，请重新发起。</h1>", 400);

  const client = await c.env.OAUTH_PROVIDER.lookupClient(authReq.clientId);
  const appName = client?.clientName ?? authReq.clientId;

  let user;
  try {
    user = await verifyUser(c.env, form.token ?? "");
  } catch {
    return c.html(authorizePage("/authorize", appName, blob, "授权服务暂时不可用，请稍后重试。"), 502);
  }
  if (!user) {
    return c.html(authorizePage("/authorize", appName, blob, "Token 无效，请检查后重试。"), 401);
  }

  const tokenHash = await sha256Hex(form.token ?? "");
  const { redirectTo } = await c.env.OAUTH_PROVIDER.completeAuthorization({
    request: authReq,
    userId: user.id,
    metadata: {},
    scope: authReq.scope,
    props: { userId: user.id, name: user.name, tokenHash },
  });
  return c.redirect(redirectTo);
});

// tokenExchangeCallback gets no env, so capture it here. env is stable across
// requests, making this module-level reference safe.
let envRef: Env | undefined;

// On refresh, reject if the user's SeaTable token no longer matches the one
// present at login — i.e. it was rotated. Fail open if SeaTable is unreachable.
async function rejectIfTokenRotated(options: {
  grantType: GrantType;
  userId: string;
  props: { tokenHash?: string };
}) {
  if (options.grantType !== GrantType.REFRESH_TOKEN || !envRef) return;
  let current: string | null;
  try {
    current = await currentTokenHash(envRef, options.userId);
  } catch {
    return;
  }
  if (current !== options.props?.tokenHash) {
    throw new OAuthError("invalid_grant", { description: "SeaTable token 已轮换，请重新登录。" });
  }
}

const provider = new OAuthProvider({
  apiRoute: "/userinfo",
  apiHandler: userInfoHandler,
  defaultHandler: app,
  authorizeEndpoint: "/authorize",
  tokenEndpoint: "/token",
  scopesSupported: ["openid", "profile"],
  clientRegistrationTTL: undefined,
  allowImplicitFlow: false,
  allowPlainPKCE: false,
  tokenExchangeCallback: rejectIfTokenRotated,
});

export default {
  fetch(request: Request, env: Env, ctx: ExecutionContext): Response | Promise<Response> {
    envRef = env;
    return provider.fetch(request, env, ctx);
  },
};
