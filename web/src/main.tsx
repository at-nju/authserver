import type { ComponentChildren } from "preact";
import { render } from "preact";
import { useEffect, useState } from "preact/hooks";
import { afterOnboarding } from "../../src/navigation";
import "./style.css";

type User = {
  id: string;
  name: string;
  email: string;
  emailVerified: boolean;
  onboardingCompleted?: boolean;
};
type Session = { session: { id: string }; user: User };
type Client = {
  client_id: string;
  client_secret?: string;
  client_name?: string;
  redirect_uris?: string[];
  token_endpoint_auth_method?: string;
};

async function request<T>(path: string, body?: unknown): Promise<T> {
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

function Layout({ title, children, wide = false }: {
  title: string;
  children: ComponentChildren;
  wide?: boolean;
}) {
  return <main class={`mx-auto px-4 ${wide ? "mt-[6vh] max-w-4xl" : "mt-[20vh] max-w-lg"}`}>
    <header class="ml-2 mb-1 font-semibold text-neutral-500">{__APP_NAME__}</header>
    <section class="rounded-xl border border-neutral-300 bg-white p-6">
      <h1 class="mb-4 text-xl font-bold">{title}</h1>
      {children}
    </section>
    <footer class="mr-2 mt-2 text-right text-sm text-neutral-500">
      <a href="https://github.com/at-nju/authserver"
        target="_blank" rel="noopener noreferrer">本项目 </a>以
      <a href="https://github.com/at-nju/authserver/blob/main/LICENSE"
        target="_blank" rel="noopener noreferrer"> GPL-3.0 </a>许可证发布
    </footer>
  </main>;
}

function ErrorText({ value }: { value: string }) {
  return value ? <p class="mt-2 text-red-700">{value}</p> : null;
}

function useSession(login: string, revision = 0) {
  const [session, setSession] = useState<Session>();
  useEffect(() => {
    request<Session | null>("/get-session")
      .then((value) => value ? setSession(value) : location.replace(login))
      .catch(() => location.replace(login));
  }, [login, revision]);
  return session;
}

function oauthQuery() {
  const query = new URLSearchParams(location.search);
  return query.has("client_id") && query.has("sig") ? location.search.slice(1) : undefined;
}

function Login() {
  const [token, setToken] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  async function submit(event: Event) {
    event.preventDefault();
    setBusy(true); setError("");
    try {
      const query = new URLSearchParams(location.search);
      const result = await request<{ url: string }>("/sign-in/seatable", {
        token,
        ...(oauthQuery() ? { oauth_query: oauthQuery() } : {}),
        ...(query.get("return_to") ? { return_to: query.get("return_to") } : {}),
      });
      location.assign(result.url);
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "登录失败");
      setBusy(false);
    }
  }

  return <Layout title="登录"><form onSubmit={submit}>
    <label>
      Token
      <div class="flex items-center justify-between gap-2">
        <input class="w-full rounded-md border border-neutral-400 p-1"
          required type="password" autocomplete="off" autofocus value={token}
          onInput={(event) => setToken(event.currentTarget.value)} />
        <button class="shrink-0 px-2 py-1 cursor-pointer rounded-md border border-neutral-400 disabled:cursor-default disabled:opacity-50 bg-neutral-100 hover:bg-neutral-200"
          disabled={busy}>登录</button>
      </div>
    </label>
    <ErrorText value={error} />
    <p class="mt-4 text-neutral-500">
      还没有 Token？
      <a href="https://table.nju.edu.cn/apps/custom/authserver/"
        target="_blank" rel="noopener noreferrer">点击此处获取</a>
    </p>
  </form></Layout>;
}

function Onboarding() {
  const params = new URLSearchParams(location.search);
  const signed = params.get("oauth_query");
  const login = signed ? `/login?${signed}` : "/login?return_to=/console";
  const session = useSession(login);
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [otp, setOtp] = useState("");
  const [sent, setSent] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  useEffect(() => {
    if (!session) return;
    if (session.user.onboardingCompleted) location.replace(afterOnboarding(location.search));
    setName(session.user.name);
    setEmail(session.user.email);
  }, [session]);

  async function finish(skip = false) {
    if (!session) return;
    setBusy(true); setError("");
    try {
      if (!skip && email !== session.user.email) {
        await request("/email-otp/request-email-change", { newEmail: email });
        setSent(true); setBusy(false); return;
      }
      await request("/update-user", skip
        ? { onboardingCompleted: true }
        : { name, onboardingCompleted: true });
      location.assign(afterOnboarding(location.search));
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "保存失败");
      setBusy(false);
    }
  }

  async function verify() {
    setBusy(true); setError("");
    try {
      await request("/email-otp/change-email", { newEmail: email, otp });
      await request("/update-user", { name, onboardingCompleted: true });
      location.assign(afterOnboarding(location.search));
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "验证失败");
      setBusy(false);
    }
  }

  if (!session) return <Layout title="首次设置"><p>加载中…</p></Layout>;
  return <Layout title="首次设置">
    <p>可以使用默认资料，也可以现在修改。</p>
    <label>姓名<input value={name} onInput={(event) => setName(event.currentTarget.value)} /></label>
    <label>邮箱<input type="email" value={email}
      onInput={(event) => setEmail(event.currentTarget.value)} /></label>
    {sent && <label>验证码<input inputMode="numeric" value={otp}
      onInput={(event) => setOtp(event.currentTarget.value)} /></label>}
    <div>
      <button disabled={busy} onClick={() => sent ? verify() : finish()}>
        {sent ? (busy ? "验证中…" : "确认") : "完成"}
      </button>
      {!sent && <button disabled={busy} onClick={() => finish(true)}>跳过</button>}
    </div>
    <ErrorText value={error} />
  </Layout>;
}

function Consent() {
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
    </> : !error && <p>加载中…</p>}
    <ErrorText value={error} />
  </Layout>;
}

function Console() {
  const [revision, setRevision] = useState(0);
  const session = useSession("/login?return_to=/console", revision);
  const [clients, setClients] = useState<Client[]>([]);
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [otp, setOtp] = useState("");
  const [emailSent, setEmailSent] = useState(false);
  const [clientName, setClientName] = useState("");
  const [redirectUri, setRedirectUri] = useState("");
  const [clientType, setClientType] = useState("public");
  const [secret, setSecret] = useState("");
  const [notice, setNotice] = useState("");
  const [error, setError] = useState("");

  const reloadClients = () => request<Client[]>("/oauth2/get-clients")
    .then(setClients).catch((reason) => setError(reason instanceof Error ? reason.message : "请求失败"));

  useEffect(() => {
    if (!session) return;
    setName(session.user.name); setEmail(session.user.email); reloadClients();
  }, [session]);

  async function run(action: () => Promise<unknown>, success?: string) {
    setError(""); setNotice("");
    try {
      await action();
      if (success) setNotice(success);
      return true;
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "请求失败");
      return false;
    }
  }

  function refresh() { setRevision((value) => value + 1); }

  async function saveName() {
    if (await run(() => request("/update-user", { name }), "姓名已保存")) refresh();
  }

  async function changeEmail() {
    if (!emailSent) {
      if (await run(() => request("/email-otp/request-email-change", { newEmail: email }), "验证码已发送")) {
        setEmailSent(true);
      }
      return;
    }
    if (await run(() => request("/email-otp/change-email", { newEmail: email, otp }), "邮箱已更新")) {
      setEmailSent(false); setOtp(""); refresh();
    }
  }

  async function createClient(event: Event) {
    event.preventDefault();
    await run(async () => {
      const client = await request<Client>("/oauth2/create-client", {
        client_name: clientName,
        redirect_uris: [redirectUri],
        token_endpoint_auth_method: clientType === "public" ? "none" : "client_secret_basic",
        grant_types: ["authorization_code"],
        response_types: ["code"],
        type: clientType === "public" ? "user-agent-based" : "web",
      });
      setSecret(client.client_secret ?? ""); setClientName(""); setRedirectUri("");
      await reloadClients();
    }, "应用已创建");
  }

  async function editClient(client: Client) {
    const nextName = prompt("名称", client.client_name ?? "");
    if (nextName === null) return;
    const nextUri = prompt("Redirect URI", client.redirect_uris?.[0] ?? "");
    if (!nextUri) return;
    await run(async () => {
      await request("/oauth2/update-client", {
        client_id: client.client_id,
        update: { client_name: nextName, redirect_uris: [nextUri] },
      });
      await reloadClients();
    }, "应用已保存");
  }

  async function rotate(clientId: string) {
    await run(async () => {
      const client = await request<Client>("/oauth2/client/rotate-secret", { client_id: clientId });
      setSecret(client.client_secret ?? ""); await reloadClients();
    });
  }

  async function remove(clientId: string) {
    if (!confirm("删除这个应用？")) return;
    await run(async () => {
      await request("/oauth2/delete-client", { client_id: clientId });
      await reloadClients();
    }, "应用已删除");
  }

  async function logout() {
    await request("/sign-out", {});
    location.replace("/login");
  }

  if (!session) return <Layout title="控制台"><p>加载中…</p></Layout>;
  return <Layout title="控制台" wide>
    <div><span>{session.user.id}</span><button onClick={logout}>退出</button></div>
    <div>
      <section><h2>个人资料</h2>
        <label>姓名<input value={name} onInput={(event) => setName(event.currentTarget.value)} /></label>
        <button onClick={saveName}>保存姓名</button>
        <label>邮箱<input type="email" value={email}
          onInput={(event) => setEmail(event.currentTarget.value)} /></label>
        <small>{session.user.emailVerified ? "已验证" : "未验证"}</small>
        {emailSent && <label>验证码<input inputMode="numeric" value={otp}
          onInput={(event) => setOtp(event.currentTarget.value)} /></label>}
        <button onClick={changeEmail}>{emailSent ? "确认邮箱" : "发送验证码"}</button>
      </section>
      <section><h2>OIDC 应用</h2>
        <form onSubmit={createClient}>
          <label>名称<input required value={clientName}
            onInput={(event) => setClientName(event.currentTarget.value)} /></label>
          <label>Redirect URI<input required type="url" value={redirectUri}
            onInput={(event) => setRedirectUri(event.currentTarget.value)} /></label>
          <label>类型<select value={clientType}
            onChange={(event) => setClientType(event.currentTarget.value)}>
            <option value="public">Public</option><option value="confidential">Confidential</option>
          </select></label>
          <button>创建</button>
        </form>
        {secret && <div><strong>Client Secret（仅显示一次）</strong>
          <code>{secret}</code><button onClick={() => setSecret("")}>关闭</button></div>}
        {clients.length ? clients.map((client) => <article key={client.client_id}>
          <div><strong>{client.client_name ?? client.client_id}</strong><code>{client.client_id}</code>
            <small>{client.redirect_uris?.join(", ")}</small></div>
          <div><button onClick={() => editClient(client)}>编辑</button>
            {client.token_endpoint_auth_method !== "none" &&
              <button onClick={() => rotate(client.client_id)}>轮换密钥</button>}
            <button onClick={() => remove(client.client_id)}>删除</button></div>
        </article>) : <p>暂无应用。</p>}
      </section>
    </div>
    {notice && <p>{notice}</p>}<ErrorText value={error} />
  </Layout>;
}

function App() {
  document.title = __APP_NAME__;
  switch (location.pathname) {
    case "/login": return <Login />;
    case "/onboarding": return <Onboarding />;
    case "/consent": return <Consent />;
    case "/console": return <Console />;
    default: return null;
  }
}

render(<App />, document.getElementById("app")!);
