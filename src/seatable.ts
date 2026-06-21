import type { Env } from "./env";

const TABLE_NAME = "Table1";
const ID_COL = "ID";
const NAME_COL = "Name";
const TOKEN_COL = "Token";

export interface SeatableUser {
  id: string;
  name: string;
}

interface BaseToken {
  accessToken: string;
  dtableUuid: string;
}

// Base token is valid ~3 days; cache per-isolate to skip a round-trip each login.
let cachedBaseToken: { value: BaseToken; expiresAt: number } | null = null;

async function getBaseToken(env: Env): Promise<BaseToken> {
  const nowSec = Math.floor(Date.now() / 1000);
  if (cachedBaseToken && cachedBaseToken.expiresAt > nowSec + 60) return cachedBaseToken.value;

  const url = `${env.SEATABLE_SERVER_URL.replace(/\/$/, "")}/api/v2.1/dtable/app-access-token/`;
  const res = await fetch(url, { headers: { Authorization: `Bearer ${env.SEATABLE_API_TOKEN}` } });
  if (!res.ok) throw new Error(`SeaTable app-access-token failed: ${res.status}`);

  const data = (await res.json()) as { access_token: string; dtable_uuid: string };
  const value: BaseToken = { accessToken: data.access_token, dtableUuid: data.dtable_uuid };
  cachedBaseToken = { value, expiresAt: nowSec + 60 * 60 * 24 * 2 };
  return value;
}

export async function verifyUser(env: Env, token: string): Promise<SeatableUser | null> {
  if (!token.trim()) return null;

  const base = await getBaseToken(env);
  const url = `${env.SEATABLE_SERVER_URL.replace(/\/$/, "")}/api-gateway/api/v2/dtables/${base.dtableUuid}/sql/`;
  const res = await fetch(url, {
    method: "POST",
    headers: { Authorization: `Bearer ${base.accessToken}`, "Content-Type": "application/json" },
    body: JSON.stringify({
      sql: `SELECT \`${ID_COL}\`, \`${NAME_COL}\` FROM \`${TABLE_NAME}\` WHERE \`${TOKEN_COL}\` = ? LIMIT 1`,
      parameters: [token],
      convert_keys: true,
    }),
  });
  if (!res.ok) throw new Error(`SeaTable SQL query failed: ${res.status}`);

  const data = (await res.json()) as { results?: Array<Record<string, unknown>> };
  const row = data.results?.[0];
  if (!row) return null;
  const id = row[ID_COL] == null ? "" : String(row[ID_COL]).trim();
  if (!id) return null;
  const name = row[NAME_COL] == null ? "" : String(row[NAME_COL]).trim();
  return { id, name };
}
