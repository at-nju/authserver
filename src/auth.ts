import { oauthProvider } from "@better-auth/oauth-provider";
import { betterAuth } from "better-auth";
import type { BetterAuthPlugin } from "better-auth";
import { APIError, createAuthEndpoint, formCsrfMiddleware, originCheck, sessionMiddleware } from "better-auth/api";
import { setSessionCookie } from "better-auth/cookies";
import { jwt } from "better-auth/plugins";
import { z } from "zod";
import { config, type Env } from "../config";
import { afterLogin } from "./navigation";
import { sharedEmail } from "./pinned";
import {
  authenticateSeaTableToken,
  createDiscourseProvider,
  createEmailProvider,
  createOidcProvider,
  resolveIdentity,
} from "./providers";

export type Bindings = Env & { AUTH_DB: D1Database; ASSETS: Fetcher };

function pinnedAccountPlugin(env: Bindings) {
  return {
    id: "pinned-account",
    endpoints: {
      setPinnedAccount: createAuthEndpoint(
        "/oauth2/set-pinned-account",
        {
          method: "POST",
          body: z.object({ client_id: z.string().min(1), pinned: z.boolean() }),
          use: [sessionMiddleware, formCsrfMiddleware, originCheck(() => "/")],
        },
        async (ctx) => {
          const owner = (ctx.context.session as { user: { id: string } } | null)?.user;
          if (!owner) throw new APIError("UNAUTHORIZED", { message: "Not signed in" });
          const client = await ctx.context.adapter.findOne({
            model: "oauthClient",
            where: [{ field: "clientId", value: ctx.body.client_id }],
          }) as { clientId: string; name: string | null; userId: string } | null;
          if (!client) throw new APIError("NOT_FOUND", { message: "Client not found" });
          if (client.userId !== owner.id) throw new APIError("UNAUTHORIZED", { message: "Not your client" });

          if (ctx.body.pinned) {
            const existing = await env.AUTH_DB.prepare(
              "SELECT pinnedUserId FROM oauthClient WHERE clientId = ?",
            ).bind(client.clientId).first<{ pinnedUserId: string | null }>();
            const userId = existing?.pinnedUserId ?? crypto.randomUUID();
            if (!await ctx.context.internalAdapter.findUserById(userId)) {
              await ctx.context.internalAdapter.createUser({
                id: userId,
                name: client.name ?? client.clientId,
                email: sharedEmail(client.clientId),
                emailVerified: true,
                onboardingCompleted: false,
              });
            }
            await env.AUTH_DB.prepare("UPDATE oauthClient SET pinnedUserId = ?, skipConsent = 1 WHERE clientId = ?")
              .bind(userId, client.clientId).run();
          } else {
            await env.AUTH_DB.prepare("UPDATE oauthClient SET pinnedUserId = NULL WHERE clientId = ?")
              .bind(client.clientId).run();
          }
          return ctx.json({ pinned: ctx.body.pinned });
        },
      ),
    },
  } satisfies BetterAuthPlugin;
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
          let identity: Awaited<ReturnType<typeof authenticateSeaTableToken>>;
          try {
            identity = await authenticateSeaTableToken(env, ctx.body.token);
          } catch {
            throw new APIError("BAD_GATEWAY", { message: "SeaTable unavailable" });
          }
          if (!identity) throw new APIError("UNAUTHORIZED", { message: "Invalid token" });

          const user = await resolveIdentity(ctx, env.AUTH_DB, {
            providerId: "seatable",
            accountId: identity.id,
            name: identity.name,
            email: identity.email,
            emailVerified: identity.emailVerified,
          }, config.providers.seatable.registration);
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


function accountPlugin(env: Bindings) {
  return {
    id: "accounts",
    endpoints: {
      getAccounts: createAuthEndpoint(
        "/accounts",
        { method: "GET", use: [sessionMiddleware] },
        async (ctx) => {
          const userId = (ctx.context.session as { user: { id: string } }).user.id;
          const result = await env.AUTH_DB.prepare(
            "SELECT providerId, accountId FROM account WHERE userId = ? ORDER BY providerId",
          ).bind(userId).all<{ providerId: string; accountId: string }>();
          return ctx.json(result.results);
        },
      ),
      linkSeaTable: createAuthEndpoint(
        "/accounts/link/seatable",
        {
          method: "POST",
          body: z.object({ token: z.string().min(1) }),
          use: [sessionMiddleware, formCsrfMiddleware, originCheck(() => "/console")],
        },
        async (ctx) => {
          const identity = await authenticateSeaTableToken(env, ctx.body.token);
          if (!identity) throw new APIError("UNAUTHORIZED", { message: "Invalid token" });
          const userId = (ctx.context.session as { user: { id: string } }).user.id;
          await resolveIdentity(ctx, env.AUTH_DB, {
            providerId: "seatable",
            accountId: identity.id,
            name: identity.name,
            email: identity.email,
            emailVerified: identity.emailVerified,
          }, config.providers.seatable.registration, userId);
          return ctx.json({ success: true });
        },
      ),
      deleteAccount: createAuthEndpoint(
        "/accounts/delete",
        {
          method: "POST",
          body: z.object({ confirmation: z.literal("DELETE") }),
          use: [sessionMiddleware, formCsrfMiddleware, originCheck(() => "/console")],
        },
        async (ctx) => {
          const userId = (ctx.context.session as { user: { id: string } }).user.id;
          await ctx.context.internalAdapter.deleteUser(userId);
          return ctx.json({ success: true });
        },
      ),
      unlinkAccount: createAuthEndpoint(
        "/accounts/unlink",
        {
          method: "POST",
          body: z.object({ providerId: z.string(), accountId: z.string() }),
          use: [sessionMiddleware, formCsrfMiddleware, originCheck(() => "/console")],
        },
        async (ctx) => {
          const userId = (ctx.context.session as { user: { id: string } }).user.id;
          if (ctx.body.providerId === "email") {
            throw new APIError("BAD_REQUEST", { message: "邮箱登录随账户邮箱管理" });
          }
          const count = await env.AUTH_DB.prepare(
            "SELECT count(*) AS count FROM account WHERE userId = ?",
          ).bind(userId).first<{ count: number }>();
          if ((count?.count ?? 0) <= 1) {
            throw new APIError("BAD_REQUEST", { message: "至少保留一种登录方式" });
          }
          await env.AUTH_DB.prepare(
            "DELETE FROM account WHERE userId = ? AND providerId = ? AND accountId = ?",
          ).bind(userId, ctx.body.providerId, ctx.body.accountId).run();
          return ctx.json({ success: true });
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
      createEmailProvider(env),
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
      pinnedAccountPlugin(env),
      accountPlugin(env),
      ...(config.providers.discourse.enabled ? [createDiscourseProvider(env, baseURL)] : []),
      ...(config.providers.upstreamOidc.enabled ? [createOidcProvider(env)] : []),
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
