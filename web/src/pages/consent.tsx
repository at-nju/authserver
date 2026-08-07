import { useEffect, useState } from "preact/hooks";
import { type Client, request, useSession } from "../api";
import { ErrorText, Layout } from "../components";

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
      <p><strong>{client.client_name ?? client.client_id}</strong> 请求访问：</p>
      <ul>{(params.get("scope") ?? "").split(" ").filter(Boolean)
        .map((scope) => <li key={scope}>{scope}</li>)}</ul>
      <div>
        <button onClick={() => decide(true)}>允许</button>
        <button onClick={() => decide(false)}>拒绝</button>
      </div>
    </> : !error && <p>加载中</p>}
    <ErrorText value={error} />
  </Layout>;
}
