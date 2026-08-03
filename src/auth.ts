import { oauthProvider } from "@better-auth/oauth-provider";
import { betterAuth } from "better-auth";
import type { BetterAuthPlugin } from "better-auth";
import { APIError, createAuthEndpoint, formCsrfMiddleware, originCheck, sessionMiddleware } from "better-auth/api";
import { setSessionCookie } from "better-auth/cookies";
import { jwt } from "better-auth/plugins";
import { z } from "zod";
import { config, type Env } from "../config";
import { afterLogin } from "./navigation";
import { sharedEmail, sharedUserId } from "./pinned";
import {
  authenticateSeaTableToken,
  createDiscourseProvider,
  createEmailProvider,
  createOidcProvider,
} from "./providers";

export type Bindings = Env & { AUTH_DB: D1Database; ASSETS: Fetcher };
export { authenticateSeaTableToken } from "./providers";

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
            const userId = sharedUserId(client.clientId);
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

          let user = await ctx.context.internalAdapter.findUserById(identity.id);
          user ??= await ctx.context.internalAdapter.createUser({
            id: identity.id,
            name: identity.id,
            email: identity.email,
            emailVerified: identity.emailVerified,
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
