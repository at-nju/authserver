// Bindings/vars available to the Worker. Mirrors wrangler.toml.
export interface Env {
  DB: D1Database;
  SEATABLE_SERVER_URL: string; // e.g. https://cloud.seatable.io
  SEATABLE_API_TOKEN: string;  // base API token (set via `wrangler secret put`)
}
