import { DatabaseSync } from "node:sqlite";
import { oauthProvider } from "@better-auth/oauth-provider";
import { betterAuth } from "better-auth";
import { jwt } from "better-auth/plugins";

export const auth = betterAuth({
  baseURL: "http://localhost",
  basePath: "/",
  secret: "schema-generation-only-secret-000000000000",
  database: new DatabaseSync(":memory:"),
  session: {
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
    jwt(),
    oauthProvider({
      loginPage: "/login",
      consentPage: "/consent",
      scopes: ["openid", "profile", "offline_access"],
      grantTypes: ["authorization_code", "refresh_token"],
      allowDynamicClientRegistration: false,
      allowUnauthenticatedClientRegistration: false,
      storeClientSecret: {
        hash: async (clientSecret) => {
          const digest = await crypto.subtle.digest(
            "SHA-256",
            new TextEncoder().encode(clientSecret),
          );
          return [...new Uint8Array(digest)]
            .map((byte) => byte.toString(16).padStart(2, "0"))
            .join("");
        },
      },
    }),
  ],
});
