import { useEffect, useState } from "preact/hooks";
import { type Client, request, useSession } from "../api";
import { Button, ErrorText, Layout } from "../components";

export default function Consent() {
  const query = location.search.slice(1);
  const params = new URLSearchParams(location.search);
  const session = useSession(`/login?${query}`);
  const [client, setClient] = useState<Client>();
  const [error, setError] = useState("");

  useEffect(() => {
    if (!session) return;
    const clientId = params.get("client_id");
    if (!clientId || !params.has("sig")) { setError("无效的授权请求"); return; }
    request<Client>("/oauth2/public-client-prelogin", {
      client_id: clientId,
      oauth_query: query,
    }).then(setClient).catch((reason) => setError(reason instanceof Error ? reason.message : "请求失败"));
  }, [session, query]);

  async function decide(accept: boolean) {
    try {
      const result = await request<{ url?: string; redirect_uri?: string }>("/oauth2/consent", {
        accept,
        oauth_query: query,
      });
      const target = result.url ?? result.redirect_uri;
      if (!target) throw new Error("授权响应无效");
      location.assign(target);
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "授权失败");
    }
  }

  return <Layout title="授权确认">
    {client ? <>
      <div class="flex items-start gap-3">
        <span class="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-stone-100 font-mono text-base font-bold text-stone-700">
          {(client.client_name?.trim() || client.client_id).charAt(0)}
        </span>
        <div class="min-w-0">
          <p class="text-xs font-medium uppercase tracking-wide text-stone-400">应用请求访问以下权限</p>
          <strong class="mt-0.5 block text-lg font-semibold tracking-tight text-stone-950">
            {client.client_name ?? client.client_id}
          </strong>
        </div>
      </div>
      <ul class="mt-5 divide-y divide-stone-100 overflow-hidden rounded-xl border border-stone-200">
        {(params.get("scope") ?? "").split(" ").filter(Boolean)
          .map((scope) => <li key={scope} class="px-4 py-3 font-mono text-sm text-stone-900">{scope}</li>)}
      </ul>
      <div class="mt-6 flex justify-end gap-2">
        <Button onClick={() => decide(false)}>拒绝</Button>
        <Button variant="primary" onClick={() => decide(true)}>允许</Button>
      </div>
    </> : !error && <p class="py-10 text-center text-sm text-stone-400">加载中</p>}
    <ErrorText value={error} />
  </Layout>;
}
