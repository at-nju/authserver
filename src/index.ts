import { Hono } from "hono";
import { createAuth } from "./auth";
import consoleApp, { type AppVariables } from "./console";
import type { OAuthClientView } from "./console_views";
import type { Env } from "./env";
import {
  hasUnsupportedResourceIndicator,
  unsupportedResourceResponse,
} from "./security";
import { consentPage, loginPage } from "./views";

const app = new Hono<{ Bindings: Env; Variables: AppVariables }>();

app.use("*", async (c, next) => {
  if (await hasUnsupportedResourceIndicator(c.req.raw)) {
    return unsupportedResourceResponse();
  }
  c.set("auth", createAuth(c.env, new URL(c.req.url).origin));
  await next();
});

app.route("/console", consoleApp);
app.get("/", (c) => c.redirect("/console"));

function signedQuery(requestUrl: string): string {
  return new URL(requestUrl).searchParams.toString();
}

export function safeReturnTo(value: string | undefined): string | undefined {
  if (!value) return undefined;
  try {
    const url = new URL(value, "https://local.invalid");
    const isConsolePath = url.pathname === "/console" || url.pathname.startsWith("/console/");
    if (url.origin !== "https://local.invalid" || !isConsolePath) {
      return undefined;
    }
    return `${url.pathname}${url.search}${url.hash}`;
  } catch {
    return undefined;
  }
}

async function clientForSignedQuery(
  auth: ReturnType<typeof createAuth>,
  headers: Headers,
  oauthQuery: string,
): Promise<OAuthClientView | null> {
  const clientId = new URLSearchParams(oauthQuery).get("client_id");
  if (!clientId) return null;
  try {
    return (await auth.api.getOAuthClientPublicPrelogin({
      headers,
      body: { client_id: clientId, oauth_query: oauthQuery },
    })) as OAuthClientView;
  } catch {
    return null;
  }
}

function loginHtml(options: {
  oauthQuery?: string;
  returnTo?: string;
  appName?: string;
  error?: string;
}) {
  const isAuthorization = Boolean(options.oauthQuery);
  return loginPage({
    action: "/login",
    title: isAuthorization ? "授权登录" : "管理后台登录",
    subtitle: isAuthorization
      ? `${options.appName ?? "应用"} 请求访问你的账号，请粘贴你的 Token 以继续。`
      : "登录以管理你的 OIDC 应用，请粘贴你的 Token 以继续。",
    hidden: {
      ...(options.oauthQuery ? { oauth_query: options.oauthQuery } : {}),
      ...(options.returnTo ? { return_to: options.returnTo } : {}),
    },
    error: options.error,
  });
}

app.get("/login", async (c) => {
  const oauthQuery = signedQuery(c.req.url);
  if (!oauthQuery) return c.html(loginHtml({ returnTo: "/console/apps" }));
  const client = await clientForSignedQuery(c.get("auth"), c.req.raw.headers, oauthQuery);
  if (!client) return c.html("<h1>无效或已过期的授权请求</h1>", 400);
  return c.html(
    loginHtml({
      oauthQuery,
      appName: client.client_name ?? client.client_id,
    }),
  );
});

app.post("/login", async (c) => {
  const form = Object.fromEntries(await c.req.formData()) as Record<string, string>;
  const oauthQuery = form.oauth_query?.trim() || undefined;
  const returnTo = safeReturnTo(form.return_to) ?? (oauthQuery ? undefined : "/console/apps");
  const auth = c.get("auth");
  const client = oauthQuery
    ? await clientForSignedQuery(auth, c.req.raw.headers, oauthQuery)
    : null;
  if (oauthQuery && !client) return c.html("<h1>无效或已过期的授权请求</h1>", 400);

  const response = await handleAuthResponse(
    auth,
    jsonAuthRequest(c.req.raw, "/sign-in/seatable", {
      token: form.token ?? "",
      callbackURL: returnTo,
      oauth_query: oauthQuery,
    }),
  );

  if (response.status >= 300 && response.status < 400) return response;
  if (!response.ok) {
    let message = "登录失败，请重试。";
    try {
      const body = (await response.clone().json()) as { message?: string };
      if (body.message?.includes("Invalid SeaTable")) message = "Token 无效，请检查后重试。";
      if (body.message?.includes("temporarily unavailable")) {
        message = "授权服务暂时不可用，请稍后重试。";
      }
    } catch {
      // Keep the generic error message.
    }
    return c.html(
      loginHtml({
        oauthQuery,
        returnTo,
        appName: client?.client_name ?? client?.client_id,
        error: message,
      }),
      response.status === 401 ? 401 : 502,
    );
  }

  const headers = new Headers(response.headers);
  if (returnTo) {
    headers.set("Location", returnTo);
    return new Response(null, { status: 302, headers });
  }

  try {
    const body = (await response.clone().json()) as { url?: string };
    if (body.url) {
      headers.set("Location", body.url);
      return new Response(null, { status: 302, headers });
    }
  } catch {
    // The provider normally returns a redirect for browser authorization flows.
  }
  return response;
});

app.get("/consent", async (c) => {
  const oauthQuery = signedQuery(c.req.url);
  const client = await clientForSignedQuery(c.get("auth"), c.req.raw.headers, oauthQuery);
  if (!client) return c.html("<h1>无效或已过期的授权请求</h1>", 400);
  const scopes = new URLSearchParams(oauthQuery).get("scope")?.split(" ").filter(Boolean) ?? [];
  return c.html(
    consentPage({
      appName: client.client_name ?? client.client_id,
      scopes,
      oauthQuery,
    }),
  );
});

app.post("/consent", async (c) => {
  const form = Object.fromEntries(await c.req.formData()) as Record<string, string>;
  const response = await handleAuthResponse(
    c.get("auth"),
    jsonAuthRequest(c.req.raw, "/oauth2/consent", {
      accept: form.accept === "true",
      oauth_query: form.oauth_query,
    }),
  );
  if (response.status >= 300 && response.status < 400) return response;
  try {
    const body = (await response.clone().json()) as { url?: string; redirect?: boolean };
    if (body.redirect && body.url) {
      const headers = new Headers(response.headers);
      headers.set("Location", body.url);
      return new Response(null, { status: 302, headers });
    }
  } catch {
    // Return the provider response unchanged when it is not JSON.
  }
  return response;
});

function rewriteRequest(request: Request, pathname: string): Request {
  const url = new URL(request.url);
  url.pathname = pathname;
  return new Request(url, request);
}

function jsonAuthRequest(request: Request, pathname: string, body: unknown): Request {
  const url = new URL(request.url);
  url.pathname = pathname;
  const headers = new Headers(request.headers);
  headers.set("Content-Type", "application/json");
  headers.delete("Content-Length");
  return new Request(url, {
    method: "POST",
    headers,
    body: JSON.stringify(body),
  });
}

async function handleAuthResponse(
  auth: ReturnType<typeof createAuth>,
  request: Request,
): Promise<Response> {
  const response = await auth.handler(request);
  if (!response.ok || !response.headers.get("content-type")?.includes("application/json")) {
    return response;
  }
  try {
    const body = (await response.clone().json()) as {
      redirect?: boolean;
      url?: string;
      token_endpoint_auth_methods_supported?: string[];
    };
    const pathname = new URL(request.url).pathname;
    if (
      (pathname === "/.well-known/openid-configuration" ||
        pathname === "/.well-known/oauth-authorization-server") &&
      body.token_endpoint_auth_methods_supported &&
      !body.token_endpoint_auth_methods_supported.includes("none")
    ) {
      body.token_endpoint_auth_methods_supported.unshift("none");
      const headers = new Headers(response.headers);
      headers.delete("Content-Length");
      return new Response(JSON.stringify(body), {
        status: response.status,
        headers,
      });
    }
    if (body.redirect && body.url) {
      const headers = new Headers(response.headers);
      headers.delete("Content-Length");
      headers.delete("Content-Type");
      headers.set("Location", body.url);
      return new Response(null, { status: 302, headers });
    }
  } catch {
    // Leave ordinary JSON API responses untouched.
  }
  return response;
}

// Compatibility aliases for clients configured against the previous service.
app.get("/authorize", (c) => {
  const url = new URL(c.req.url);
  url.pathname = "/oauth2/authorize";
  return c.redirect(`${url.pathname}${url.search}`);
});
app.post("/token", (c) =>
  handleAuthResponse(c.get("auth"), rewriteRequest(c.req.raw, "/oauth2/token")),
);
app.on(["GET", "POST"], "/userinfo", (c) =>
  handleAuthResponse(c.get("auth"), rewriteRequest(c.req.raw, "/oauth2/userinfo")),
);

app.all("*", (c) => handleAuthResponse(c.get("auth"), c.req.raw));

export default app;
