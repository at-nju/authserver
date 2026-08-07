import { useEffect, useState } from "preact/hooks";

export type User = {
  id: string;
  name: string;
  email: string;
  emailVerified: boolean;
  onboardingCompleted?: boolean;
};
export type Session = { session: { id: string }; user: User };
export type Account = { providerId: string; accountId: string };
export type Client = {
  client_id: string;
  client_secret?: string;
  client_name?: string;
  redirect_uris?: string[];
  token_endpoint_auth_method?: "none" | "client_secret_basic";
  pinned_user_id?: string | null;
};

export type ClientKind = "public" | "confidential";
export type ClientDialog = { mode: "create" } | { mode: "edit"; client: Client };
export type ClientConfirmation = { action: "rotate" | "delete"; client: Client };
export type ClientResult = { clientId: string; clientName: string; secret?: string };

export function clientNameOrId(client: Client) {
  return client.client_name?.trim() || client.client_id;
}

export function isConfidentialClient(client: Client) {
  return client.token_endpoint_auth_method === "client_secret_basic";
}

export async function request<T>(path: string, body?: unknown): Promise<T> {
  const response = await fetch(path, {
    credentials: "include",
    ...(body === undefined ? {} : {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    }),
  });
  const text = await response.text();
  const data = text ? JSON.parse(text) as Record<string, unknown> : null;
  if (!response.ok) {
    throw new Error(String(data?.message ?? data?.error_description ?? data?.error ?? "请求失败"));
  }
  return data as T;
}

export function useSession(login: string, revision = 0) {
  const [session, setSession] = useState<Session>();
  useEffect(() => {
    request<Session | null>("/get-session")
      .then((value) => value ? setSession(value) : location.replace(login))
      .catch(() => location.replace(login));
  }, [login, revision]);
  return session;
}

export function oauthQuery() {
  const query = new URLSearchParams(location.search);
  return query.has("client_id") && query.has("sig") ? location.search.slice(1) : undefined;
}

export function providerReturnTo() {
  const signed = oauthQuery();
  if (signed) return `/onboarding?oauth_query=${encodeURIComponent(signed)}`;
  return new URLSearchParams(location.search).get("return_to") ?? "/console";
}
