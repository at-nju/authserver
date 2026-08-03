import { config, type Env } from "../../config";
import type { ProviderIdentity } from "./types";

type HttpFetch = (input: RequestInfo | URL, init?: RequestInit) => Promise<Response>;

export async function authenticateSeaTableToken(
  env: Pick<Env, "SEATABLE_API_TOKEN">,
  rawToken: string,
  fetcher: HttpFetch = fetch,
): Promise<ProviderIdentity | null> {
  const token = rawToken.trim();
  if (!token) return null;

  const provider = config.providers.seatable;
  const base = provider.baseUrl.replace(/\/$/, "");
  const accessResponse = await fetcher(`${base}/api/v2.1/dtable/app-access-token/`, {
    headers: { Authorization: `Bearer ${env.SEATABLE_API_TOKEN}` },
  });
  if (!accessResponse.ok) throw new Error("SeaTable access failed");

  const access = await accessResponse.json<{ access_token: string; dtable_uuid: string }>();
  const queryResponse = await fetcher(`${base}/api-gateway/api/v2/dtables/${access.dtable_uuid}/sql/`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${access.access_token}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      sql: `SELECT \`${provider.idColumn}\` FROM \`${provider.tableName}\` WHERE \`${provider.tokenColumn}\` = ? LIMIT 1`,
      parameters: [token],
      convert_keys: true,
    }),
  });
  if (!queryResponse.ok) throw new Error("SeaTable query failed");

  const result = await queryResponse.json<{ results?: Array<Record<string, unknown>> }>();
  const id = String(result.results?.[0]?.[provider.idColumn] ?? "").trim();
  if (!id) return null;
  return {
    id,
    name: id,
    email: provider.fields.email({ id }),
    emailVerified: provider.fields.emailVerified,
  };
}
