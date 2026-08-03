import { getAuth, type Bindings } from "./auth";
import { attachPinnedUsers, authorizeWithPinnedUser, findSessionUser, sessionTokenFromCookie } from "./pinned";
import { ensureEmailAccount } from "./providers";

const pages = new Set(["/login", "/onboarding", "/consent", "/console"]);
const authPaths = new Set([
  "/.well-known/openid-configuration",
  "/.well-known/oauth-authorization-server",
  "/jwks",
  "/sign-in/seatable",
  "/email-otp/send-verification-otp",
  "/sign-in/email-otp",
  "/sign-in/discourse",
  "/sign-in/discourse/callback",
  "/sign-in/oauth2",
  "/oauth2/callback/upstream-oidc",
  "/oauth2/link",
  "/get-session",
  "/sign-out",
  "/update-user",
  "/email-otp/request-email-change",
  "/email-otp/change-email",
  "/oauth2/authorize",
  "/oauth2/token",
  "/oauth2/userinfo",
  "/oauth2/consent",
  "/oauth2/public-client-prelogin",
  "/oauth2/get-clients",
  "/oauth2/create-client",
  "/oauth2/update-client",
  "/oauth2/client/rotate-secret",
  "/oauth2/delete-client",
  "/oauth2/set-pinned-account",
  "/accounts",
  "/accounts/link/seatable",
  "/accounts/unlink",
]);

async function hasResource(request: Request): Promise<boolean> {
  const url = new URL(request.url);
  if (!url.pathname.startsWith("/oauth2/")) return false;
  if (url.searchParams.has("resource")) return true;
  if (request.method !== "POST") return false;

  const type = request.headers.get("content-type")?.toLowerCase() ?? "";
  try {
    if (type.includes("application/json")) {
      return Object.hasOwn(await request.clone().json<Record<string, unknown>>(), "resource");
    }
    if (type.includes("application/x-www-form-urlencoded") || type.includes("multipart/form-data")) {
      return (await request.clone().formData()).has("resource");
    }
  } catch {
    return false;
  }
  return false;
}

async function cleanMetadata(response: Response): Promise<Response> {
  if (!response.ok) return response;
  const body = await response.json<Record<string, unknown>>();
  for (const key of [
    "registration_endpoint",
    "introspection_endpoint",
    "introspection_endpoint_auth_methods_supported",
    "revocation_endpoint",
    "revocation_endpoint_auth_methods_supported",
    "end_session_endpoint",
  ]) delete body[key];
  body.grant_types_supported = ["authorization_code"];
  body.token_endpoint_auth_methods_supported = ["none", "client_secret_basic"];

  const headers = new Headers(response.headers);
  headers.delete("content-length");
  return new Response(JSON.stringify(body), { status: response.status, headers });
}

async function browserRedirect(response: Response): Promise<Response> {
  if (!response.headers.get("content-type")?.includes("application/json")) return response;
  try {
    const body = await response.clone().json<{ redirect?: boolean; url?: string }>();
    if (!body.redirect || !body.url) return response;
    const headers = new Headers(response.headers);
    headers.delete("content-length");
    headers.delete("content-type");
    headers.set("location", body.url);
    return new Response(null, { status: 302, headers });
  } catch {
    return response;
  }
}

async function appPage(request: Request, env: Bindings): Promise<Response> {
  const url = new URL(request.url);
  url.pathname = "/index.html";
  return env.ASSETS.fetch(new Request(url, request));
}

export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    const path = url.pathname;

    if (path === "/") return Response.redirect(new URL("/console", url), 302);
    if ((request.method === "GET" || request.method === "HEAD") && pages.has(path)) {
      return appPage(request, env);
    }
    if (!authPaths.has(path)) return env.ASSETS.fetch(request);
    if (await hasResource(request)) {
      return Response.json(
        { error: "invalid_request", error_description: "Resource indicators are not supported" },
        { status: 400 },
      );
    }

    const body = request.method === "POST" && (path === "/sign-in/email-otp" || path === "/email-otp/change-email")
      ? await request.clone().json<{ email?: string; newEmail?: string }>()
      : null;
    let response = path === "/oauth2/authorize"
      ? await authorizeWithPinnedUser(env.AUTH_DB, env.BETTER_AUTH_SECRET, request, (req) => getAuth(env, url.origin).handler(req))
      : await getAuth(env, url.origin).handler(request);
    if (response.ok && path === "/sign-in/email-otp") {
      const result = await response.clone().json<{ user: { id: string; email: string } }>();
      await ensureEmailAccount(env.AUTH_DB, result.user.id, result.user.email);
    }
    if (response.ok && path === "/email-otp/change-email" && body?.newEmail) {
      const token = sessionTokenFromCookie(request.headers.get("cookie"));
      const userId = token ? await findSessionUser(env.AUTH_DB, token) : null;
      if (userId) {
        await env.AUTH_DB.prepare("DELETE FROM account WHERE userId = ? AND providerId = 'email'").bind(userId).run();
        await ensureEmailAccount(env.AUTH_DB, userId, body.newEmail);
      }
    }
    if (path.startsWith("/.well-known/")) response = await cleanMetadata(response);
    if (path === "/oauth2/authorize") response = await browserRedirect(response);
    if (path === "/oauth2/get-clients") response = await attachPinnedUsers(env.AUTH_DB, response);
    return response;
  },
} satisfies ExportedHandler<Bindings>;
