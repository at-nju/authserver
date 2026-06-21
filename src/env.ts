import type { OAuthHelpers } from "@cloudflare/workers-oauth-provider";

export interface Env {
  OAUTH_KV: KVNamespace;
  CONSOLE_KV: KVNamespace;
  OAUTH_PROVIDER: OAuthHelpers;
  CONSOLE_SESSION_SECRET: string;
  SEATABLE_SERVER_URL: string;
  SEATABLE_API_TOKEN: string;
}
