import { oauthProvider } from "@better-auth/oauth-provider";
import { betterAuth } from "better-auth";
import type { BetterAuthPlugin } from "better-auth";
import { APIError, createAuthEndpoint, formCsrfMiddleware, originCheck } from "better-auth/api";
import { setSessionCookie } from "better-auth/cookies";
import { emailOTP, jwt } from "better-auth/plugins";
import { z } from "zod";
import { config, type Env } from "../config";
import { afterLogin } from "./navigation";

export type Bindings = Env & { AUTH_DB: D1Database; ASSETS: Fetcher };
type HttpFetch = (input: RequestInfo | URL, init?: RequestInit) => Promise<Response>;

export async function authenticateSeaTableToken(
  env: Pick<Bindings, "SEATABLE_API_TOKEN">,
  rawToken: string,
  fetcher: HttpFetch = fetch,
): Promise<{ id: string } | null> {
  const token = rawToken.trim();
  if (!token) return null;

  const base = config.seatable.baseUrl.replace(/\/$/, "");
  const accessResponse = await fetcher(`${base}/api/v2.1/dtable/app-access-token/`, {
    headers: { Authorization: `Bearer ${env.SEATABLE_API_TOKEN}` },
  });
  if (!accessResponse.ok) throw new Error("SeaTable access failed");

  const access = await accessResponse.json<{ access_token: string; dtable_uuid: string }>();
  const { tableName, idColumn, tokenColumn } = config.seatable;
  const queryResponse = await fetcher(
    `${base}/api-gateway/api/v2/dtables/${access.dtable_uuid}/sql/`,
    {
      method: "POST",
      headers: {
        Authorization: `Bearer ${access.access_token}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        sql: `SELECT \`${idColumn}\` FROM \`${tableName}\` WHERE \`${tokenColumn}\` = ? LIMIT 1`,
        parameters: [token],
        convert_keys: true,
      }),
    },
  );
  if (!queryResponse.ok) throw new Error("SeaTable query failed");

  const result = await queryResponse.json<{ results?: Array<Record<string, unknown>> }>();
  const id = String(result.results?.[0]?.[idColumn] ?? "").trim();
  return id ? { id } : null;
}

async function sendOtp(env: Pick<Bindings, "SMTP_PASSWORD">, email: string, otp: string) {
  const { WorkerMailer } = await import("worker-mailer");
  await WorkerMailer.send(
    {
      host: config.smtp.host,
      port: config.smtp.port,
      secure: config.smtp.secure,
      startTls: !config.smtp.secure,
      authType: "login",
      credentials: { username: config.smtp.username, password: env.SMTP_PASSWORD },
    },
    {
      from: { name: config.appName, email: config.smtp.from },
      to: email,
      subject: config.email.subject,
      text: config.email.text(otp),
    },
  );
}

function seaTablePlugin(env: Bindings) {
  return {
    id: "seatable",
    endpoints: {
      signInSeaTable: createAuthEndpoint(
        "/sign-in/seatable",
        {
          method: "POST",
          body: z.object({
            token: z.string().min(1),
            oauth_query: z.string().optional(),
            return_to: z.string().optional(),
          }),
          use: [formCsrfMiddleware, originCheck((ctx) => ctx.body.return_to ?? "/")],
        },
        async (ctx) => {
          let identity: { id: string } | null;
          try {
            identity = await authenticateSeaTableToken(env, ctx.body.token);
          } catch {
            throw new APIError("BAD_GATEWAY", { message: "SeaTable unavailable" });
          }
          if (!identity) throw new APIError("UNAUTHORIZED", { message: "Invalid token" });

          let user = await ctx.context.internalAdapter.findUserById(identity.id);
          user ??= await ctx.context.internalAdapter.createUser({
            id: identity.id,
            name: identity.id,
            email: config.user.defaultEmail(identity.id),
            emailVerified: false,
            onboardingCompleted: false,
          });
          if (!user) throw new APIError("INTERNAL_SERVER_ERROR");

          const session = await ctx.context.internalAdapter.createSession(user.id, false);
          if (!session) throw new APIError("INTERNAL_SERVER_ERROR");
          await setSessionCookie(ctx, { session, user });

          return ctx.json({
            redirect: true,
            url: afterLogin(
              (user as typeof user & { onboardingCompleted?: boolean }).onboardingCompleted,
              ctx.body.oauth_query,
              ctx.body.return_to,
            ),
          });
        },
      ),
    },
  } satisfies BetterAuthPlugin;
}

export function createAuth(env: Bindings, baseURL: string) {
  return betterAuth({
    appName: config.appName,
    baseURL,
    basePath: config.auth.basePath,
    trustedOrigins: [baseURL],
    secret: env.BETTER_AUTH_SECRET,
    database: env.AUTH_DB,
    advanced: { disableOriginCheck: false, disableCSRFCheck: false },
    rateLimit: { enabled: false },
    session: { expiresIn: config.auth.sessionTtlSeconds },
    user: {
      additionalFields: {
        onboardingCompleted: {
          type: "boolean",
          required: false,
          defaultValue: false,
          input: true,
          returned: true,
        },
      },
    },
    plugins: [
      jwt({
        disableSettingJwtHeader: true,
        jwks: { keyPairConfig: { alg: "RS256", modulusLength: 2048 } },
      }),
      emailOTP({
        disableSignUp: true,
        otpLength: config.email.otpLength,
        expiresIn: config.email.otpTtlSeconds,
        storeOTP: "hashed",
        changeEmail: { enabled: true, verifyCurrentEmail: false },
        sendVerificationOTP: ({ email, otp }) => sendOtp(env, email, otp),
      }),
      oauthProvider({
        loginPage: "/login",
        consentPage: "/consent",
        scopes: [...config.oidc.scopes],
        advertisedMetadata: { scopes_supported: [...config.oidc.scopes] },
        grantTypes: ["authorization_code"],
        codeExpiresIn: config.oidc.authorizationCodeTtlSeconds,
        accessTokenExpiresIn: config.oidc.accessTokenTtlSeconds,
        allowPublicClientPrelogin: true,
        allowDynamicClientRegistration: false,
        allowUnauthenticatedClientRegistration: false,
        clientPrivileges: ({ user }) => Boolean(user),
        storeClientSecret: "hashed",
        storeTokens: "hashed",
      }),
      seaTablePlugin(env),
    ],
  });
}

const auth = new Map<string, ReturnType<typeof createAuth>>();
export function getAuth(env: Bindings, baseURL: string) {
  const cached = auth.get(baseURL);
  if (cached) return cached;
  const created = createAuth(env, baseURL);
  auth.set(baseURL, created);
  return created;
}
