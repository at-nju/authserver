import { genericOAuth } from "better-auth/plugins";
import { config, type Env } from "../../config";

export function createOidcProvider(
  env: Pick<Env, "UPSTREAM_OIDC_CLIENT_ID" | "UPSTREAM_OIDC_CLIENT_SECRET">,
) {
  const provider = config.providers.upstreamOidc;
  return genericOAuth({
    config: [{
      providerId: "upstream-oidc",
      discoveryUrl: `${provider.issuer.replace(/\/$/, "")}/.well-known/openid-configuration`,
      issuer: provider.issuer,
      clientId: env.UPSTREAM_OIDC_CLIENT_ID!,
      clientSecret: env.UPSTREAM_OIDC_CLIENT_SECRET!,
      scopes: [...provider.scopes],
      disableSignUp: String(provider.registration) === "deny",
      mapProfileToUser: (profile) => ({
        name: provider.fields.name.map((field) => profile[field]).find(Boolean),
        email: profile[provider.fields.email],
        emailVerified: Boolean(profile[provider.fields.emailVerified]),
      }),
    }],
  });
}
