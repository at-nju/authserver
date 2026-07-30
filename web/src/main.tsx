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
  token_endpoint_auth_method?: "none" | "client_secret_basic";
};

type ClientKind = "public" | "confidential";
type ClientDialog = { mode: "create" } | { mode: "edit"; client: Client };
type ClientConfirmation = { action: "rotate" | "delete"; client: Client };
type ClientResult = { clientId: string; clientName: string; secret?: string };

function clientNameOrId(client: Client) {
  return client.client_name?.trim() || client.client_id;
}

function isConfidentialClient(client: Client) {
  return client.token_endpoint_auth_method === "client_secret_basic";
}

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
    <section class="rounded-xl border border-neutral-300 bg-white p-6 shadow">
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
  return value ? <p class="w-full rounded px-3 py-2 my-2 border border-red-300 bg-red-100 text-red-800">{value}</p> : null;
}

function CopyIcon({ copied = false }: { copied?: boolean }) {
  return copied
    ? <svg aria-hidden="true" viewBox="0 0 24 24" class="h-4 w-4" fill="none"
      stroke="currentColor" stroke-width="2"><path d="m5 12 4 4L19 6" /></svg>
    : <svg aria-hidden="true" viewBox="0 0 24 24" class="h-4 w-4" fill="none"
      stroke="currentColor" stroke-width="2"><rect x="9" y="9" width="11" height="11" rx="2" />
      <path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1" /></svg>;
}

function CloseIcon() {
  return <svg aria-hidden="true" viewBox="0 0 24 24" class="h-5 w-5" fill="none"
    stroke="currentColor" stroke-width="2"><path d="M18 6 6 18M6 6l12 12" /></svg>;
}

function Modal({ title, children, onClose, locked = false, dismissDisabled = false }: {
  title: string;
  children: ComponentChildren;
  onClose: () => void;
  locked?: boolean;
  dismissDisabled?: boolean;
}) {
  useEffect(() => {
    const closeOnEscape = (event: KeyboardEvent) => {
      if (event.key === "Escape" && !locked && !dismissDisabled) onClose();
    };
    document.addEventListener("keydown", closeOnEscape);
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      document.removeEventListener("keydown", closeOnEscape);
      document.body.style.overflow = previousOverflow;
    };
  }, [dismissDisabled, locked, onClose]);

  return <div class="fixed inset-0 z-50 flex items-center justify-center bg-black/45 p-4"
    onMouseDown={(event) => {
      if (!locked && !dismissDisabled && event.target === event.currentTarget) onClose();
    }}>
    <section role="dialog" aria-modal="true" aria-label={title}
      class="max-h-[90vh] w-full max-w-2xl overflow-y-auto rounded-xl border border-neutral-400 bg-white p-5 shadow-xl">
      <header class="mb-5 flex items-start justify-between gap-4">
        <h3 class="text-xl font-semibold text-neutral-950">{title}</h3>
        {!locked && <button type="button" aria-label="关闭" title="关闭"
          class="p-2" disabled={dismissDisabled}
          onClick={onClose}><CloseIcon /></button>}
      </header>
      {children}
    </section>
  </div>;
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
    <label class="text-sm" htmlFor="token_field">Token</label>
    <div class="flex items-center justify-between gap-2">
      <input id="token_field" class="w-full rounded-md border border-neutral-400 p-1"
        required type="password" autocomplete="off" autofocus value={token}
        onInput={(event) => setToken(event.currentTarget.value)} />
      <button class="shrink-0 px-3 py-1.5 rounded-md border border-neutral-400 bg-neutral-100 hover:bg-neutral-200 text-sm"
        disabled={busy}>登录</button>
    </div>
    <ErrorText value={error} />
    <p class="mt-2 text-neutral-500 text-sm">
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

  if (!session) return <Layout title="首次设置"><p>加载中</p></Layout>;
  return <Layout title="首次设置">
    <p>可以使用默认资料，也可以现在修改</p>
    <label>姓名<input value={name} onInput={(event) => setName(event.currentTarget.value)} /></label>
    <label>邮箱<input type="email" value={email}
      onInput={(event) => setEmail(event.currentTarget.value)} /></label>
    {sent && <label>验证码<input inputMode="numeric" value={otp}
      onInput={(event) => setOtp(event.currentTarget.value)} /></label>}
    <div>
      <button disabled={busy} onClick={() => sent ? verify() : finish()}>
        {sent ? "确认" : "完成"}
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
    </> : !error && <p>加载中</p>}
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
  const [redirectUris, setRedirectUris] = useState("");
  const [clientType, setClientType] = useState<ClientKind>("public");
  const [clientDialog, setClientDialog] = useState<ClientDialog | null>(null);
  const [clientConfirmation, setClientConfirmation] = useState<ClientConfirmation | null>(null);
  const [clientResult, setClientResult] = useState<ClientResult | null>(null);
  const [clientDialogError, setClientDialogError] = useState("");
  const [clientBusy, setClientBusy] = useState(false);
  const [deleteConfirmation, setDeleteConfirmation] = useState("");
  const [secretSaved, setSecretSaved] = useState(false);
  const [copiedField, setCopiedField] = useState<"client-id" | "secret" | "">("");
  const [notice, setNotice] = useState("");
  const [error, setError] = useState("");

  const reloadClients = async () => {
    try {
      setClients(await request<Client[]>("/oauth2/get-clients"));
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "请求失败");
    }
  };

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

  function openCreateClient() {
    setClientName("");
    setRedirectUris("");
    setClientType("public");
    setClientDialogError("");
    setClientDialog({ mode: "create" });
  }

  function openEditClient(client: Client) {
    setClientName(client.client_name?.trim() ?? "");
    setRedirectUris(client.redirect_uris?.join("\n") ?? "");
    setClientType(isConfidentialClient(client) ? "confidential" : "public");
    setClientDialogError("");
    setClientDialog({ mode: "edit", client });
  }

  function parsedRedirectUris() {
    const values = [...new Set(redirectUris.split("\n").map((value) => value.trim()).filter(Boolean))];
    if (!values.length) throw new Error("请至少填写一个回调地址");
    for (const value of values) {
      try {
        const url = new URL(value);
        if (url.protocol !== "http:" && url.protocol !== "https:") throw new Error();
      } catch {
        throw new Error(`回调地址格式不正确：${value}`);
      }
    }
    return values;
  }

  async function saveClient(event: Event) {
    event.preventDefault();
    if (!clientDialog) return;
    setClientDialogError("");
    if (!clientName.trim()) {
      setClientDialogError("请填写应用名称");
      return;
    }
    let uris: string[];
    try {
      uris = parsedRedirectUris();
    } catch (reason) {
      setClientDialogError(reason instanceof Error ? reason.message : "回调地址格式不正确");
      return;
    }
    setClientBusy(true);
    try {
      if (clientDialog.mode === "edit") {
        await request("/oauth2/update-client", {
          client_id: clientDialog.client.client_id,
          update: { client_name: clientName.trim(), redirect_uris: uris },
        });
        setClientDialog(null);
      } else {
        const client = await request<Client>("/oauth2/create-client", {
          client_name: clientName.trim(),
          redirect_uris: uris,
          token_endpoint_auth_method: clientType === "public" ? "none" : "client_secret_basic",
          grant_types: ["authorization_code"],
          response_types: ["code"],
          type: clientType === "public" ? "user-agent-based" : "web",
        });
        setClientDialog(null);
        setSecretSaved(false);
        setCopiedField("");
        setClientResult({
          clientId: client.client_id,
          clientName: client.client_name ?? clientName.trim(),
          ...(client.client_secret ? { secret: client.client_secret } : {}),
        });
      }
      await reloadClients();
    } catch (reason) {
      setClientDialogError(reason instanceof Error ? reason.message : "请求失败");
    } finally {
      setClientBusy(false);
    }
  }

  async function rotateClient() {
    if (!clientConfirmation || clientConfirmation.action !== "rotate") return;
    setClientBusy(true); setClientDialogError("");
    try {
      const source = clientConfirmation.client;
      const client = await request<Client>("/oauth2/client/rotate-secret", { client_id: source.client_id });
      setClientConfirmation(null);
      setSecretSaved(false);
      setCopiedField("");
      setClientResult({
        clientId: source.client_id,
        clientName: clientNameOrId(source),
        ...(client.client_secret ? { secret: client.client_secret } : {}),
      });
      await reloadClients();
    } catch (reason) {
      setClientDialogError(reason instanceof Error ? reason.message : "请求失败");
    } finally {
      setClientBusy(false);
    }
  }

  async function removeClient() {
    if (!clientConfirmation || clientConfirmation.action !== "delete") return;
    setClientBusy(true); setClientDialogError("");
    try {
      await request("/oauth2/delete-client", { client_id: clientConfirmation.client.client_id });
      setClientConfirmation(null);
      setDeleteConfirmation("");
      await reloadClients();
    } catch (reason) {
      setClientDialogError(reason instanceof Error ? reason.message : "请求失败");
    } finally {
      setClientBusy(false);
    }
  }

  async function copyResult(value: string, field: "client-id" | "secret") {
    try {
      setClientDialogError("");
      await navigator.clipboard.writeText(value);
      setCopiedField(field);
      window.setTimeout(() => setCopiedField((current) => current === field ? "" : current), 1600);
    } catch {
      setClientDialogError("复制失败，请手动选择并复制");
    }
  }

  async function logout() {
    await request("/sign-out", {});
    location.replace("/login");
  }

  if (!session) return <Layout title="控制台"><p>加载中</p></Layout>;
  return <Layout title="控制台" wide>
    <div class="text-sm mb-4 flex items-center justify-between">
      <span class="text-neutral-400">ID {session.user.id}</span>
      <button class="text-blue-500 hover:text-blue-700" onClick={logout}>退出</button>
    </div>
    {notice && <p class="w-full rounded px-3 py-2 my-2 border border-neutral-300 bg-neutral-100">{notice}</p>}
    <ErrorText value={error} />
    <div>
      <section><h2 class="mt-2 mb-4 font-semibold text-2xl">个人资料</h2>
        <div class="grid grid-cols-1 sm:grid-cols-2 gap-4">
          <div>
            <label htmlFor="name_field" class="text-sm">昵称</label>
            <div class="mt-1 flex items-center justify-between gap-2">
              <input id="name_field" class="w-full" value={name}
                onInput={(event) => setName(event.currentTarget.value)} />
              <button class="shrink-0 px-3 py-1.5 rounded-md border border-neutral-400 bg-neutral-100 hover:bg-neutral-200 text-sm"
                onClick={saveName}>保存昵称</button>
            </div>
          </div>
          <div>
            <label htmlFor="email_field" class="text-sm">邮箱</label>
            <div class="mt-1 flex items-center justify-between gap-2">
              <input id="email_field" class="w-full" type="email" value={email}
                onInput={(event) => setEmail(event.currentTarget.value)} />
              <button class="shrink-0 px-3 py-1.5 rounded-md border border-neutral-400 bg-neutral-100 hover:bg-neutral-200 text-sm"
                onClick={changeEmail} disabled={emailSent}>修改邮箱</button>
            </div>
            {!emailSent && <small class="text-sm text-neutral-400">
              {session.user.emailVerified ? "已验证" : "未验证"}</small>}
            {emailSent && <div>
              <label htmlFor="code_field" class="ml-1">验证码</label>
              <div class="mt-1 flex items-center justify-between gap-2">
                <input id="code_field" class="w-full" inputMode="numeric" value={otp}
                  onInput={(event) => setOtp(event.currentTarget.value)} />
                <button class="shrink-0 px-3 py-1.5 rounded-md border border-neutral-400 bg-neutral-100 hover:bg-neutral-200 text-sm"
                  onClick={changeEmail}>确认邮箱</button>
              </div>
            </div>}
          </div>
        </div>
      </section>
      <section class="mt-6">
        <header class="mb-5 flex items-center justify-between gap-4">
          <h2 class="font-semibold text-2xl text-neutral-950">OIDC 应用</h2>
          <button type="button"
            class="shrink-0 rounded-md border border-neutral-400 bg-neutral-100 px-3 py-1.5 text-sm hover:bg-neutral-200"
            onClick={openCreateClient}>创建应用</button>
        </header>

        {clients.length ? <div class="space-y-4">
          {clients.map((client) => {
            const confidential = isConfidentialClient(client);
            return <article key={client.client_id}
              class="rounded-xl border border-neutral-300 bg-white p-4 shadow-sm">
              <div class="flex flex-col gap-5 sm:flex-row sm:items-start sm:justify-between">
                <div class="min-w-0 flex-1">
                  <div class="flex flex-wrap items-center gap-2">
                    <h3 class="text-lg font-semibold text-neutral-950">
                      {clientNameOrId(client)}
                    </h3>
                    <span class="rounded-full border border-neutral-300 bg-neutral-100 px-2 py-0.5 text-xs font-medium text-neutral-800">
                      {confidential ? "机密客户端" : "公开客户端"}
                    </span>
                  </div>
                  <dl class="mt-4 space-y-4">
                    <div>
                      <dt class="text-xs font-medium text-neutral-600">客户端 ID</dt>
                      <dd class="mt-1 break-all font-mono text-sm text-neutral-950">{client.client_id}</dd>
                    </div>
                    <div>
                      <dt class="text-xs font-medium text-neutral-600">回调地址</dt>
                      <dd class="mt-1 space-y-1">
                        {client.redirect_uris?.map((uri) => <code key={uri}
                          class="block break-all whitespace-normal text-sm text-neutral-950">{uri}</code>)}
                      </dd>
                    </div>
                  </dl>
                </div>
                <div class="flex shrink-0 flex-wrap gap-2">
                  <button type="button" class="rounded-md border border-neutral-400 bg-white px-3 py-1.5 text-sm hover:bg-neutral-100"
                    onClick={() => openEditClient(client)}>编辑</button>
                  {confidential && <button type="button"
                    class="rounded-md border border-neutral-400 bg-white px-3 py-1.5 text-sm hover:bg-neutral-100"
                    onClick={() => {
                      setClientDialogError("");
                      setClientConfirmation({ action: "rotate", client });
                    }}>轮换密钥</button>}
                  <button type="button"
                    class="rounded-md border border-red-700 bg-white px-3 py-1.5 text-sm text-red-700 hover:bg-red-50"
                    onClick={() => {
                      setDeleteConfirmation("");
                      setClientDialogError("");
                      setClientConfirmation({ action: "delete", client });
                    }}>删除</button>
                </div>
              </div>
            </article>;
          })}
        </div> : <div class="rounded-xl border border-dashed border-neutral-400 px-5 py-10 text-center">
          <h3 class="font-semibold text-neutral-950">还没有 OIDC 应用</h3>
          <p class="mt-1 text-sm text-neutral-700">创建一个应用以接入 OIDC 登录</p>
          <button type="button"
            class="mt-4 rounded-md border border-neutral-900 bg-neutral-100 px-3 py-2 text-sm font-medium text-neutral-950 hover:bg-neutral-200"
            onClick={openCreateClient}>创建第一个应用</button>
        </div>}
      </section>
    </div>

    {clientDialog && <Modal title={clientDialog.mode === "create" ? "创建 OIDC 应用" : "编辑 OIDC 应用"}
      dismissDisabled={clientBusy} onClose={() => setClientDialog(null)}>
      <form onSubmit={saveClient}>
        <fieldset disabled={clientBusy} class="space-y-5">
          <div>
            <label htmlFor="client_name_field" class="mb-1.5 block text-sm">应用名称</label>
            <input id="client_name_field" required autofocus class="w-full" value={clientName}
              onInput={(event) => setClientName(event.currentTarget.value)} />
          </div>

          <div>
            <span class="mb-1.5 block text-sm">客户端类型</span>
            <div class="grid grid-cols-1 gap-3 sm:grid-cols-2">
              <button type="button" disabled={clientDialog.mode === "edit"}
                aria-pressed={clientType === "public"}
                class={`rounded-lg border p-3 text-left ${clientType === "public"
                  ? "border-neutral-950 bg-neutral-100" : "border-neutral-300 bg-white hover:bg-neutral-50"}`}
                onClick={() => setClientType("public")}>
                <strong class="block text-sm text-neutral-950">公开客户端</strong>
                <span class="mt-1 block text-xs leading-5 text-neutral-700">适用于浏览器和 App，无法保存密钥</span>
              </button>
              <button type="button" disabled={clientDialog.mode === "edit"}
                aria-pressed={clientType === "confidential"}
                class={`rounded-lg border p-3 text-left ${clientType === "confidential"
                  ? "border-neutral-950 bg-neutral-100" : "border-neutral-300 bg-white hover:bg-neutral-50"}`}
                onClick={() => setClientType("confidential")}>
                <strong class="block text-sm text-neutral-950">机密客户端</strong>
                <span class="mt-1 block text-xs leading-5 text-neutral-700">适用于有可信后端的服务，将生成客户端密钥</span>
              </button>
            </div>
            {clientDialog.mode === "edit" && <p class="mt-1.5 text-xs text-neutral-700">创建后不能修改客户端类型</p>}
          </div>

          <div>
            <label htmlFor="redirect_uris_field" class="mb-1.5 block text-sm">回调地址</label>
            <textarea id="redirect_uris_field" required rows={6}
              class="w-full resize-y rounded-md border border-neutral-400 px-2 py-1.5 font-mono text-sm text-neutral-950"
              placeholder={'https://example.com/callback\nhttp://localhost:3000/callback'} value={redirectUris}
              onInput={(event) => setRedirectUris(event.currentTarget.value)} />
            <p class="mt-1.5 text-xs text-neutral-700">每行填写一个完整的 HTTP 或 HTTPS 地址</p>
          </div>
          <ErrorText value={clientDialogError} />
          <div class="flex justify-end gap-2">
            <button type="button" class="rounded-md border border-neutral-400 bg-white px-3 py-1.5 text-sm hover:bg-neutral-100"
              onClick={() => setClientDialog(null)}>取消</button>
            <button type="submit"
              class="rounded-md border border-neutral-900 bg-neutral-100 px-3 py-1.5 text-sm font-medium text-neutral-950 hover:bg-neutral-200">
              {clientDialog.mode === "create" ? "创建" : "保存"}
            </button>
          </div>
        </fieldset>
      </form>
    </Modal>}

    {clientConfirmation?.action === "rotate" && <Modal title="轮换客户端密钥"
      dismissDisabled={clientBusy} onClose={() => setClientConfirmation(null)}>
      <p class="text-neutral-900">确定要为 <strong>{clientNameOrId(clientConfirmation.client)}</strong> 轮换密钥吗？</p>
      <p class="mt-3 rounded-md border border-neutral-300 bg-neutral-100 p-3 text-sm text-neutral-900">
        旧密钥将立即失效。仍在使用旧密钥的服务会中断，直到完成配置更新
      </p>
      <ErrorText value={clientDialogError} />
      <fieldset disabled={clientBusy} class="mt-5 flex justify-end gap-2">
        <button type="button" class="rounded-md border border-neutral-400 bg-white px-3 py-1.5 text-sm hover:bg-neutral-100"
          onClick={() => setClientConfirmation(null)}>取消</button>
        <button type="button" class="rounded-md border border-neutral-900 bg-neutral-100 px-3 py-1.5 text-sm font-medium text-neutral-950 hover:bg-neutral-200"
          onClick={rotateClient}>轮换密钥</button>
      </fieldset>
    </Modal>}

    {clientConfirmation?.action === "delete" && <Modal title="删除 OIDC 应用"
      dismissDisabled={clientBusy} onClose={() => setClientConfirmation(null)}>
      <p class="text-neutral-900">删除后，使用此客户端的登录流程将立即停止，且无法恢复</p>
      <div class="mt-4 rounded-md border border-red-300 bg-red-50 p-3 text-sm text-neutral-950">
        <strong class="block">{clientNameOrId(clientConfirmation.client)}</strong>
        <code class="mt-1 block break-all">{clientConfirmation.client.client_id}</code>
      </div>
      <label htmlFor="delete_confirmation_field" class="mb-1.5 mt-4 block text-sm font-medium text-neutral-950">
        输入“{clientNameOrId(clientConfirmation.client)}”以确认删除
      </label>
      <input id="delete_confirmation_field" autofocus class="w-full" value={deleteConfirmation}
        disabled={clientBusy} onInput={(event) => setDeleteConfirmation(event.currentTarget.value)} />
      <ErrorText value={clientDialogError} />
      <fieldset disabled={clientBusy} class="mt-5 flex justify-end gap-2 border-t border-neutral-200 pt-4">
        <button type="button" class="rounded-md border border-neutral-400 bg-white px-3 py-1.5 text-sm font-medium text-neutral-950 hover:bg-neutral-100"
          onClick={() => setClientConfirmation(null)}>取消</button>
        <button type="button" disabled={deleteConfirmation !== clientNameOrId(clientConfirmation.client)}
          class="rounded-md border border-red-800 bg-white px-3 py-1.5 text-sm font-medium text-red-800 hover:bg-red-50"
          onClick={removeClient}>删除应用</button>
      </fieldset>
    </Modal>}

    {clientResult && <Modal title={clientResult.secret ? "保存客户端凭据" : "应用创建成功"}
      locked={Boolean(clientResult.secret)} onClose={() => setClientResult(null)}>
      <p class="text-neutral-900"><strong>{clientResult.clientName}</strong> 的客户端凭据如下</p>
      {clientResult.secret && <p class="mt-3 rounded-md border border-neutral-300 bg-neutral-100 p-3 text-sm text-neutral-950">
        客户端密钥仅显示这一次，关闭前请将它保存到安全的位置
      </p>}
      <dl class="mt-5 space-y-4">
        <div>
          <dt class="mb-1 text-sm">客户端 ID</dt>
          <dd class="flex items-center gap-2 rounded-md border border-neutral-300 bg-neutral-100 p-3">
            <code class="min-w-0 flex-1 break-all text-sm text-neutral-950">{clientResult.clientId}</code>
            <button type="button" aria-label="复制客户端 ID" title="复制客户端 ID"
              class="shrink-0 rounded p-1.5 text-neutral-950 hover:bg-neutral-300"
              onClick={() => copyResult(clientResult.clientId, "client-id")}>
              <CopyIcon copied={copiedField === "client-id"} />
            </button>
          </dd>
        </div>
        {clientResult.secret && <div>
          <dt class="mb-1 text-sm">客户端密钥</dt>
          <dd class="flex items-center gap-2 rounded-md border border-neutral-300 bg-neutral-100 p-3">
            <code class="min-w-0 flex-1 break-all text-sm text-neutral-950">{clientResult.secret}</code>
            <button type="button" aria-label="复制客户端密钥" title="复制客户端密钥"
              class="shrink-0 rounded p-1.5 text-neutral-950 hover:bg-neutral-300"
              onClick={() => copyResult(clientResult.secret!, "secret")}>
              <CopyIcon copied={copiedField === "secret"} />
            </button>
          </dd>
        </div>}
      </dl>
      <ErrorText value={clientDialogError} />
      {clientResult.secret && <label class="mt-5 flex cursor-pointer items-center gap-2 text-sm text-neutral-950">
        <input type="checkbox" class="mt-0.5 h-4 w-4 p-0" checked={secretSaved}
          onChange={(event) => setSecretSaved(event.currentTarget.checked)} />
        <span>我已将客户端密钥保存到安全的位置</span>
      </label>}
      <div class="mt-5 flex justify-end pt-2">
        <button type="button" disabled={Boolean(clientResult.secret && !secretSaved)}
          class="rounded-md border border-neutral-900 bg-neutral-100 px-3 py-1.5 text-sm font-medium text-neutral-950 hover:bg-neutral-200"
          onClick={() => setClientResult(null)}>关闭</button>
      </div>
    </Modal>}
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
