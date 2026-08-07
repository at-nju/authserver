import { useEffect, useState } from "preact/hooks";
import {
  type Client, type ClientConfirmation, type ClientDialog, type ClientKind, type ClientResult,
  clientNameOrId, isConfidentialClient, request,
} from "../../api";
import { Button, CopyIcon, ErrorText, Modal } from "../../components";

export function OidcTab() {
  const [clients, setClients] = useState<Client[]>([]);
  const [clientName, setClientName] = useState("");
  const [redirectUris, setRedirectUris] = useState("");
  const [clientType, setClientType] = useState<ClientKind>("public");
  const [clientPinned, setClientPinned] = useState(false);
  const [clientDialog, setClientDialog] = useState<ClientDialog | null>(null);
  const [clientConfirmation, setClientConfirmation] = useState<ClientConfirmation | null>(null);
  const [clientResult, setClientResult] = useState<ClientResult | null>(null);
  const [clientDialogError, setClientDialogError] = useState("");
  const [clientBusy, setClientBusy] = useState(false);
  const [deleteConfirmation, setDeleteConfirmation] = useState("");
  const [secretSaved, setSecretSaved] = useState(false);
  const [copiedField, setCopiedField] = useState<"client-id" | "secret" | "">("");
  const [error, setError] = useState("");

  const reloadClients = async () => {
    try {
      setClients(await request<Client[]>("/oauth2/get-clients"));
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "请求失败");
    }
  };

  useEffect(() => { reloadClients(); }, []);

  function openCreateClient() {
    setClientName("");
    setRedirectUris("");
    setClientType("public");
    setClientPinned(false);
    setClientDialogError("");
    setClientDialog({ mode: "create" });
  }

  function openEditClient(client: Client) {
    setClientName(client.client_name?.trim() ?? "");
    setRedirectUris(client.redirect_uris?.join("\n") ?? "");
    setClientType(isConfidentialClient(client) ? "confidential" : "public");
    setClientPinned(Boolean(client.pinned_user_id));
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
        if (clientPinned !== Boolean(clientDialog.client.pinned_user_id)) {
          await request("/oauth2/set-pinned-account", {
            client_id: clientDialog.client.client_id,
            pinned: clientPinned,
          });
        }
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
        if (clientPinned) {
          await request("/oauth2/set-pinned-account", { client_id: client.client_id, pinned: true });
        }
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

  return <>
    <ErrorText value={error} />
    <div class="flex items-center justify-between gap-4">
      <div>
        <h2 class="text-lg font-semibold tracking-tight text-stone-950">OIDC 应用</h2>
        <p class="mt-0.5 text-sm text-stone-500">管理接入 OIDC 登录的客户端</p>
      </div>
      <Button variant="primary" class="shrink-0" onClick={openCreateClient}>创建应用</Button>
    </div>

    {clients.length ? <div class="mt-5 space-y-4">
        {clients.map((client) => {
          const confidential = isConfidentialClient(client);
          return <article key={client.client_id}
            class="rounded-xl border border-stone-200 bg-white p-5 shadow-card">
            <div class="flex flex-col gap-5 sm:flex-row sm:items-start sm:justify-between">
              <div class="min-w-0 flex-1">
                <div class="flex flex-wrap items-center gap-2">
                  <h3 class="text-base font-semibold text-stone-950">
                    {clientNameOrId(client)}
                  </h3>
                  <span class="rounded-full border border-stone-200 bg-stone-100 px-2 py-0.5 text-xs font-medium text-stone-700">
                    {confidential ? "机密客户端" : "公开客户端"}
                  </span>
                  {client.pinned_user_id && <span class="rounded-full border border-stone-200 bg-stone-100 px-2 py-0.5 text-xs font-medium text-stone-700">
                    固定账户
                  </span>}
                </div>
                <dl class="mt-4 space-y-4">
                  <div>
                    <dt class="text-xs font-medium text-stone-500">客户端 ID</dt>
                    <dd class="mt-1 break-all font-mono text-sm text-stone-900">{client.client_id}</dd>
                  </div>
                  <div>
                    <dt class="text-xs font-medium text-stone-500">回调地址</dt>
                    <dd class="mt-1 space-y-1">
                      {client.redirect_uris?.map((uri) => <code key={uri}
                        class="block break-all whitespace-normal text-sm text-stone-900">{uri}</code>)}
                    </dd>
                  </div>
                </dl>
              </div>
              <div class="flex shrink-0 flex-wrap gap-2">
                <Button onClick={() => openEditClient(client)}>编辑</Button>
                {confidential && <Button
                  onClick={() => {
                    setClientDialogError("");
                    setClientConfirmation({ action: "rotate", client });
                  }}>轮换密钥</Button>}
                <Button variant="danger"
                  onClick={() => {
                    setDeleteConfirmation("");
                    setClientDialogError("");
                    setClientConfirmation({ action: "delete", client });
                  }}>删除</Button>
              </div>
            </div>
          </article>;
        })}
      </div> : <div class="mt-5 rounded-xl border border-dashed border-stone-300 bg-white/60 px-6 py-12 text-center">
        <h3 class="text-sm font-semibold text-stone-900">还没有 OIDC 应用</h3>
        <p class="mt-1 text-sm text-stone-500">创建一个应用以接入 OIDC 登录</p>
      </div>}

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
              class="w-full resize-y border-stone-300 px-2 py-1.5 font-mono text-sm text-neutral-950"
              placeholder={'https://example.com/callback\nhttp://localhost:3000/callback'} value={redirectUris}
              onInput={(event) => setRedirectUris(event.currentTarget.value)} />
            <p class="mt-1.5 text-xs text-neutral-700">每行填写一个完整的 HTTP 或 HTTPS 地址</p>
          </div>

          <div class="rounded-lg border border-stone-300 bg-stone-50 p-3">
            <label class="flex cursor-pointer items-center gap-2 text-sm text-neutral-950">
              <input type="checkbox" class="mt-0.5 h-4 w-4 p-0" checked={clientPinned}
                onChange={(event) => setClientPinned(event.currentTarget.checked)} />
              <span>固定账户</span>
            </label>
            <p class="mt-1.5 text-xs text-neutral-700">
              开启后，任何人登录该应用都会返回同一个共享账户身份，且不再显示授权确认页
              {clientDialog.mode === "edit" && clientPinned && <code class="mt-1 block break-all text-neutral-500">
                {`service.${clientDialog.client.client_id}@nju.at`}
              </code>}
            </p>
          </div>
          <ErrorText value={clientDialogError} />
          <div class="flex justify-end gap-2">
            <Button onClick={() => setClientDialog(null)}>取消</Button>
            <Button type="submit" variant="primary">{clientDialog.mode === "create" ? "创建" : "保存"}</Button>
          </div>
        </fieldset>
      </form>
    </Modal>}

    {clientConfirmation?.action === "rotate" && <Modal title="轮换客户端密钥"
      dismissDisabled={clientBusy} onClose={() => setClientConfirmation(null)}>
      <p class="text-neutral-900">确定要为 <strong>{clientNameOrId(clientConfirmation.client)}</strong> 轮换密钥吗？</p>
      <p class="mt-3 rounded-lg border border-stone-200 bg-stone-100 p-3 text-sm text-neutral-900">
        旧密钥将立即失效。仍在使用旧密钥的服务会中断，直到完成配置更新
      </p>
      <ErrorText value={clientDialogError} />
      <fieldset disabled={clientBusy} class="mt-5 flex justify-end gap-2">
        <Button onClick={() => setClientConfirmation(null)}>取消</Button>
        <Button variant="primary" onClick={rotateClient}>轮换密钥</Button>
      </fieldset>
    </Modal>}

    {clientConfirmation?.action === "delete" && <Modal title="删除 OIDC 应用"
      dismissDisabled={clientBusy} onClose={() => setClientConfirmation(null)}>
      <p class="text-neutral-900">删除后，使用此客户端的登录流程将立即停止，且无法恢复</p>
      <div class="mt-4 rounded-lg border border-red-300 bg-red-50 p-3 text-sm text-neutral-950">
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
        <Button class="font-medium text-neutral-950" onClick={() => setClientConfirmation(null)}>取消</Button>
        <Button variant="danger" disabled={deleteConfirmation !== clientNameOrId(clientConfirmation.client)}
          onClick={removeClient}>删除应用</Button>
      </fieldset>
    </Modal>}

    {clientResult && <Modal title={clientResult.secret ? "保存客户端凭据" : "应用创建成功"}
      locked={Boolean(clientResult.secret)} onClose={() => setClientResult(null)}>
      <p class="text-neutral-900"><strong>{clientResult.clientName}</strong> 的客户端凭据如下</p>
      {clientResult.secret && <p class="mt-3 rounded-lg border border-stone-200 bg-stone-100 p-3 text-sm text-neutral-950">
        客户端密钥仅显示这一次，关闭前请将它保存到安全的位置
      </p>}
      <dl class="mt-5 space-y-4">
        <div>
          <dt class="mb-1 text-sm">客户端 ID</dt>
          <dd class="flex items-center gap-2 rounded-lg border border-stone-200 bg-stone-100 p-3">
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
          <dd class="flex items-center gap-2 rounded-lg border border-stone-200 bg-stone-100 p-3">
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
        <Button variant="primary" disabled={Boolean(clientResult.secret && !secretSaved)}
          onClick={() => setClientResult(null)}>关闭</Button>
      </div>
    </Modal>}
  </>;
}
