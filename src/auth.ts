import { oauthProvider } from "@better-auth/oauth-provider";
import { betterAuth, type BetterAuthPlugin } from "better-auth";
import {
  APIError,
  createAuthEndpoint,
  createAuthMiddleware,
  originCheck,
} from "better-auth/api";
import { setSessionCookie } from "better-auth/cookies";
import { jwt } from "better-auth/plugins";
import { z } from "zod";
import type { Env } from "./env";
import { sha256Hex } from "./crypto";
import { defaultUserEmail } from "./email_policy";
import { JWT_KEY_PAIR_CONFIG } from "./jwt";
import { currentTokenHash, verifyUser } from "./seatable";

const SESSION_TTL_SECONDS = 60 * 60 * 24 * 7;
const ACCESS_TOKEN_TTL_SECONDS = 60 * 60;
const REFRESH_TOKEN_TTL_SECONDS = 60 * 60 * 24 * 30;

function invalidGrant(description: string): APIError {
  return new APIError("BAD_REQUEST", {
    error: "invalid_grant",
    error_description: description,
  });
}

function seatableAuth(env: Env) {
  return {
    id: "seatable-auth",
    endpoints: {
      signInSeatable: createAuthEndpoint(
        "/sign-in/seatable",
        {
          method: "POST",
          body: z.object({
            token: z.string().min(1),
            callbackURL: z.string().optional(),
            oauth_query: z.string().optional(),
          }),
          use: [originCheck((ctx) => ctx.body.callbackURL)],
        },
        async (ctx) => {
          let identity;
          try {
            identity = await verifyUser(env, ctx.body.token);
          } catch {
            throw new APIError("BAD_GATEWAY", {
              message: "SeaTable identity service is temporarily unavailable.",
            });
          }
          if (!identity) {
            throw new APIError("UNAUTHORIZED", {
              message: "Invalid SeaTable token.",
            });
          }

          const email = defaultUserEmail(identity.id);
          const name = identity.name || identity.id;
          let user = await ctx.context.internalAdapter.findUserById(identity.id);
          if (!user) {
            user = await ctx.context.internalAdapter.createUser({
              id: identity.id,
              name,
              email,
              emailVerified: true,
            });
          } else if (user.name !== name || !user.emailVerified) {
            user = await ctx.context.internalAdapter.updateUser(identity.id, {
              name,
              emailVerified: true,
            });
          }
          if (!user) {
            throw new APIError("INTERNAL_SERVER_ERROR", {
              message: "Unable to create the local identity.",
            });
          }

          const session = await ctx.context.internalAdapter.createSession(
            user.id,
            false,
            { seatableTokenHash: await sha256Hex(ctx.body.token) },
            true,
          );
          if (!session) {
            throw new APIError("INTERNAL_SERVER_ERROR", {
              message: "Unable to create the login session.",
            });
          }
          await setSessionCookie(ctx, { session, user });

          if (ctx.body.callbackURL && !ctx.body.oauth_query) {
            ctx.setHeader("Location", ctx.body.callbackURL);
          }
          return ctx.json({
            redirect: Boolean(ctx.body.callbackURL),
            url: ctx.body.callbackURL,
            user,
          });
        },
      ),
    },
    hooks: {
      before: [
        {
          matcher: (ctx) =>
            ctx.path === "/oauth2/token" && ctx.body?.grant_type === "refresh_token",
          handler: createAuthMiddleware(async (ctx) => {
            const refreshToken = ctx.body?.refresh_token;
            if (typeof refreshToken !== "string" || !refreshToken) return;

            const storedToken = await sha256Hex(refreshToken.replace(/^sat_rt_/, ""));
            const refresh = await ctx.context.adapter.findOne<{
              sessionId?: string | null;
              userId: string;
            }>({
              model: "oauthRefreshToken",
              where: [{ field: "token", value: storedToken }],
            });
            if (!refresh) return;
            if (!refresh.sessionId) {
              throw invalidGrant("The login session is no longer available.");
            }

            const session = await ctx.context.adapter.findOne<{
              seatableTokenHash?: string | null;
            }>({
              model: "session",
              where: [{ field: "id", value: refresh.sessionId }],
            });
            if (!session?.seatableTokenHash) {
              throw invalidGrant("The login session is no longer available.");
            }

            let currentHash: string | null;
            try {
              currentHash = await currentTokenHash(env, refresh.userId);
            } catch {
              // Preserve the previous fail-open behavior during SeaTable outages.
              return;
            }
            if (currentHash !== session.seatableTokenHash) {
              throw invalidGrant("The SeaTable token has changed; sign in again.");
            }
          }),
        },
      ],
    },
  } satisfies BetterAuthPlugin;
}

export function createAuth(env: Env, origin: string) {
  return betterAuth({
    appName: "SeaTable Authserver",
    baseURL: origin,
    basePath: "/",
    secret: env.CONSOLE_SESSION_SECRET,
    trustedOrigins: [origin],
    database: env.AUTH_DB,
    session: {
      expiresIn: SESSION_TTL_SECONDS,
      updateAge: 60 * 60 * 24,
      additionalFields: {
        seatableTokenHash: {
          type: "string",
          required: false,
          input: false,
          returned: false,
        },
      },
    },
    plugins: [
      jwt({
        disableSettingJwtHeader: true,
        jwks: { keyPairConfig: JWT_KEY_PAIR_CONFIG },
      }),
      oauthProvider({
        loginPage: "/login",
        consentPage: "/consent",
        scopes: ["openid", "profile", "email", "offline_access"],
        advertisedMetadata: {
          scopes_supported: ["openid", "profile", "email", "offline_access"],
        },
        grantTypes: ["authorization_code", "refresh_token"],
        accessTokenExpiresIn: ACCESS_TOKEN_TTL_SECONDS,
        refreshTokenExpiresIn: REFRESH_TOKEN_TTL_SECONDS,
        allowDynamicClientRegistration: false,
        allowUnauthenticatedClientRegistration: false,
        allowPublicClientPrelogin: true,
        storeClientSecret: {
          hash: (clientSecret) => sha256Hex(clientSecret),
        },
        storeTokens: {
          hash: (token) => sha256Hex(token),
        },
        clientPrivileges: ({ user }) => Boolean(user),
        prefix: {
          opaqueAccessToken: "sat_at_",
          refreshToken: "sat_rt_",
        },
      }),
      seatableAuth(env),
    ],
  });
}

export type Auth = ReturnType<typeof createAuth>;
export type AuthSession = Awaited<ReturnType<Auth["api"]["getSession"]>>;
