import type { BetterAuthPlugin } from "better-auth";
import { APIError, createAuthEndpoint, sessionMiddleware } from "better-auth/api";
import { setSessionCookie } from "better-auth/cookies";
import { z } from "zod";
import { config, type Env } from "../../config";
import { resolveIdentity } from "./identity";

const encoder = new TextEncoder();

async function hmac(secret: string, value: string) {
  const key = await crypto.subtle.importKey(
    "raw",
    encoder.encode(secret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"],
  );
  return [...new Uint8Array(await crypto.subtle.sign("HMAC", key, encoder.encode(value)))]
    .map((byte) => byte.toString(16).padStart(2, "0"))
    .join("");
}

function encode(value: string) {
  return btoa(value);
}

function decode(value: string) {
  return atob(value);
}

export function createDiscourseProvider(
  env: Pick<Env, "DISCOURSE_CONNECT_SECRET"> & { AUTH_DB: D1Database },
  baseURL: string,
) {
  const provider = config.providers.discourse;
  const secret = env.DISCOURSE_CONNECT_SECRET!;

  return {
    id: "discourse-connect",
    endpoints: {
      signInDiscourse: createAuthEndpoint(
        "/sign-in/discourse",
        { method: "GET", query: z.object({ return_to: z.string().optional() }) },
        async (ctx) => {
          const returnTo = new URL(ctx.query.return_to ?? "/console", baseURL);
          if (returnTo.origin !== baseURL) throw new APIError("BAD_REQUEST");
          const state = encode(JSON.stringify({
            returnTo: `${returnTo.pathname}${returnTo.search}`,
            expiresAt: Date.now() + 10 * 60 * 1000,
          }));
          const nonce = `${state}.${await hmac(secret, state)}`;
          const sso = encode(new URLSearchParams({
            nonce,
            return_sso_url: `${baseURL}/sign-in/discourse/callback`,
          }).toString());
          const target = new URL("/session/sso_provider", provider.origin);
          target.search = new URLSearchParams({ sso, sig: await hmac(secret, sso) }).toString();
          throw ctx.redirect(target.toString());
        },
      ),
      linkDiscourse: createAuthEndpoint(
        "/accounts/link/discourse",
        { method: "GET", query: z.object({ return_to: z.string().optional() }), use: [sessionMiddleware] },
        async (ctx) => {
          const returnTo = new URL(ctx.query.return_to ?? "/console", baseURL);
          if (returnTo.origin !== baseURL) throw new APIError("BAD_REQUEST");
          const userId = (ctx.context.session as { user: { id: string } }).user.id;
          const state = encode(JSON.stringify({
            returnTo: `${returnTo.pathname}${returnTo.search}`,
            expiresAt: Date.now() + 10 * 60 * 1000,
            linkUserId: userId,
          }));
          const nonce = `${state}.${await hmac(secret, state)}`;
          const sso = encode(new URLSearchParams({
            nonce,
            return_sso_url: `${baseURL}/sign-in/discourse/callback`,
          }).toString());
          const target = new URL("/session/sso_provider", provider.origin);
          target.search = new URLSearchParams({ sso, sig: await hmac(secret, sso) }).toString();
          throw ctx.redirect(target.toString());
        },
      ),
      discourseCallback: createAuthEndpoint(
        "/sign-in/discourse/callback",
        { method: "GET", query: z.object({ sso: z.string(), sig: z.string() }) },
        async (ctx) => {
          if (await hmac(secret, ctx.query.sso) !== ctx.query.sig) {
            throw new APIError("UNAUTHORIZED");
          }

          const values = new URLSearchParams(decode(ctx.query.sso));
          const [state, signature] = (values.get("nonce") ?? "").split(".");
          if (!state || await hmac(secret, state) !== signature) {
            throw new APIError("UNAUTHORIZED");
          }
          const attempt = JSON.parse(decode(state)) as {
            returnTo: string;
            expiresAt: number;
            linkUserId?: string;
          };
          if (attempt.expiresAt < Date.now()) throw new APIError("UNAUTHORIZED");

          const externalId = values.get(provider.fields.subject);
          const email = values.get(provider.fields.email);
          if (!externalId || !email) throw new APIError("BAD_REQUEST");
          const name = provider.fields.name.map((field) => values.get(field)).find(Boolean) ?? externalId;
          const user = await resolveIdentity(ctx, env.AUTH_DB, {
            providerId: "discourse",
            accountId: externalId,
            name,
            email: email.toLowerCase(),
            emailVerified: provider.fields.emailVerified,
          }, provider.registration, attempt.linkUserId);
          const session = await ctx.context.internalAdapter.createSession(user!.id, false);
          await setSessionCookie(ctx, { session: session!, user: user! });
          throw ctx.redirect(new URL(attempt.returnTo, baseURL).toString());
        },
      ),
    },
  } satisfies BetterAuthPlugin;
}
