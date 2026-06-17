// SeaTable is the identity source. At login we verify the pasted Token exists in
// Table1 and return the matching ID as the authenticated subject (user_id).
// Nothing OAuth-related is ever written back to SeaTable.
import type { Env } from "./env";

const TABLE_NAME = "Table1";
const ID_COL = "ID";
const TOKEN_COL = "Token";

interface BaseToken {
  accessToken: string;
  dtableUuid: string;
}

// Base access token is valid for ~3 days; cache it in module scope to avoid a
// round-trip on every login. (Module scope is per-isolate, best-effort.)
let cachedBaseToken: { value: BaseToken; expiresAt: number } | null = null;

async function getBaseToken(env: Env): Promise<BaseToken> {
  const nowSec = Math.floor(Date.now() / 1000);
  if (cachedBaseToken && cachedBaseToken.expiresAt > nowSec + 60) {
    return cachedBaseToken.value;
  }

  const url = `${env.SEATABLE_SERVER_URL.replace(/\/$/, "")}/api/v2.1/dtable/app-access-token/`;
  const res = await fetch(url, {
    headers: { Authorization: `Bearer ${env.SEATABLE_API_TOKEN}` },
  });
  if (!res.ok) {
    throw new Error(`SeaTable app-access-token failed: ${res.status}`);
  }
  const data = (await res.json()) as { access_token: string; dtable_uuid: string };
  const value: BaseToken = { accessToken: data.access_token, dtableUuid: data.dtable_uuid };
  // Cache conservatively for ~2 days regardless of the actual 3-day validity.
  cachedBaseToken = { value, expiresAt: nowSec + 60 * 60 * 24 * 2 };
  return value;
}

/**
 * Verify a user-supplied Token against Table1.
 * Returns the matching ID (subject) if the Token exists, otherwise null.
 */
export async function verifyToken(env: Env, token: string): Promise<string | null> {
  if (!token || !token.trim()) return null;

  const base = await getBaseToken(env);
  const url = `${env.SEATABLE_SERVER_URL.replace(/\/$/, "")}/api-gateway/api/v2/dtables/${base.dtableUuid}/sql/`;
  const res = await fetch(url, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${base.accessToken}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      sql: `SELECT \`${ID_COL}\` FROM \`${TABLE_NAME}\` WHERE \`${TOKEN_COL}\` = ? LIMIT 1`,
      parameters: [token],
      convert_keys: true,
    }),
  });
  if (!res.ok) {
    throw new Error(`SeaTable SQL query failed: ${res.status}`);
  }

  const data = (await res.json()) as { results?: Array<Record<string, unknown>> };
  const row = data.results?.[0];
  if (!row) return null;

  const id = row[ID_COL];
  const idStr = id == null ? "" : String(id).trim();
  return idStr ? idStr : null;
}
