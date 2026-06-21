import type { ClientInfo } from "@cloudflare/workers-oauth-provider";
import { escapeHtml } from "./views";

const STYLE = `
  body { font-family: system-ui, sans-serif; background: #f5f5f7; margin: 0; color: #1f2937; }
  header { background: #fff; border-bottom: 1px solid #e5e7eb; padding: .9rem 1.5rem;
           display: flex; align-items: center; justify-content: space-between; }
  header .brand { font-weight: 600; }
  header .user { color: #6b7280; font-size: .85rem; }
  .logout { background: none; border: 0; color: #2563eb; cursor: pointer; font-size: .85rem; }
  main { max-width: 760px; margin: 2rem auto; padding: 0 1rem; }
  .row { display: flex; align-items: center; justify-content: space-between; margin-bottom: 1rem; }
  h1 { font-size: 1.3rem; margin: 0; }
  h2 { font-size: 1.1rem; }
  .card { background: #fff; border: 1px solid #e5e7eb; border-radius: 12px; padding: 1.25rem;
          margin-bottom: 1rem; }
  .card .cid { font-family: ui-monospace, monospace; color: #6b7280; font-size: .85rem; }
  .badge { font-size: .72rem; padding: .15rem .5rem; border-radius: 999px; margin-left: .5rem; }
  .badge.pub { background: #ecfdf5; color: #047857; }
  .badge.conf { background: #eff6ff; color: #1d4ed8; }
  a.btn, button.btn { display: inline-block; padding: .55rem .9rem; border-radius: 8px; border: 0;
          font-size: .9rem; cursor: pointer; text-decoration: none; }
  .btn.primary { background: #2563eb; color: #fff; }
  .btn.primary:hover { background: #1d4ed8; }
  .btn.ghost { background: #f3f4f6; color: #374151; }
  .btn.danger { background: #fef2f2; color: #b91c1c; }
  label { display: block; font-size: .85rem; margin: 1rem 0 .35rem; }
  input[type=text], textarea { width: 100%; box-sizing: border-box; padding: .55rem .65rem;
          border: 1px solid #ccc; border-radius: 8px; font-size: .95rem; font-family: inherit; }
  textarea { min-height: 90px; }
  .hint { color: #6b7280; font-size: .8rem; margin-top: .3rem; }
  .radio { display: flex; gap: 1rem; margin-top: .35rem; }
  .radio label { display: flex; align-items: center; gap: .4rem; margin: 0; font-size: .95rem; }
  .secret { font-family: ui-monospace, monospace; background: #f9fafb; border: 1px solid #e5e7eb;
            border-radius: 8px; padding: .7rem; word-break: break-all; }
  .warn { background: #fffbeb; border: 1px solid #fde68a; color: #92400e; padding: .7rem .85rem;
          border-radius: 8px; font-size: .85rem; }
  .empty { color: #6b7280; text-align: center; padding: 2rem; }
  .actions { margin-top: 1.25rem; display: flex; gap: .6rem; align-items: center; }
`;

function shell(title: string, userLabel: string, body: string): string {
  return `<!doctype html>
<html lang="zh-CN">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>${escapeHtml(title)}</title>
  <style>${STYLE}</style>
</head>
<body>
  <header>
    <span class="brand">OAuth 管理后台</span>
    <span>
      <span class="user">${escapeHtml(userLabel)}</span>
      <form method="post" action="/console/logout" style="display:inline">
        <button class="logout" type="submit">退出</button>
      </form>
    </span>
  </header>
  <main>${body}</main>
</body>
</html>`;
}

function isConfidential(c: ClientInfo): boolean {
  return c.tokenEndpointAuthMethod !== "none";
}

function badgeHtml(c: ClientInfo): string {
  return isConfidential(c)
    ? `<span class="badge conf">机密</span>`
    : `<span class="badge pub">公开</span>`;
}

export function appsPage(userLabel: string, clients: ClientInfo[]): string {
  const list = clients.length
    ? clients
        .map((c) => {
          const name = c.clientName ?? c.clientId;
          return `<div class="card">
      <div class="row" style="margin:0">
        <div>
          <strong>${escapeHtml(name)}</strong>${badgeHtml(c)}
          <div class="cid">${escapeHtml(c.clientId)} · ${c.redirectUris.length} 个回调地址</div>
        </div>
        <a class="btn ghost" href="/console/apps/${encodeURIComponent(c.clientId)}">管理</a>
      </div>
    </div>`;
        })
        .join("\n")
    : `<div class="card empty">还没有应用，点右上角「新建应用」开始接入。</div>`;

  const body = `
    <div class="row">
      <h1>我的应用</h1>
      <a class="btn primary" href="/console/apps/new">新建应用</a>
    </div>
    ${list}`;
  return shell("我的应用", userLabel, body);
}

export function newAppPage(userLabel: string, error?: string): string {
  const err = error ? `<div class="warn">${escapeHtml(error)}</div>` : "";
  const body = `
    <div class="row"><h1>新建应用</h1><a class="btn ghost" href="/console/apps">返回</a></div>
    ${err}
    <div class="card">
      <form method="post" action="/console/apps">
        <label>应用名称</label>
        <input type="text" name="name" required autofocus>
        <label>客户端类型</label>
        <div class="radio">
          <label><input type="radio" name="type" value="public" checked> 公开（仅 PKCE，无密钥）</label>
          <label><input type="radio" name="type" value="confidential"> 机密（带密钥）</label>
        </div>
        <p class="hint">SPA / 移动端 / CLI 选公开；有后端、能保密的服务选机密。</p>
        <label>回调地址（redirect_uri，每行一个）</label>
        <textarea name="redirect_uris" placeholder="https://app.example.com/callback" required></textarea>
        <p class="hint">授权后只会跳转到这里列出的地址，需完全一致。</p>
        <div class="actions"><button class="btn primary" type="submit">创建</button></div>
      </form>
    </div>`;
  return shell("新建应用", userLabel, body);
}

export function editAppPage(userLabel: string, client: ClientInfo, error?: string): string {
  const conf = isConfidential(client);
  const err = error ? `<div class="warn">${escapeHtml(error)}</div>` : "";
  const name = client.clientName ?? client.clientId;
  const secretBlock = conf
    ? `<div class="card">
        <h2>客户端密钥</h2>
        <p class="hint">密钥只在创建/轮换时展示一次。忘记了就轮换一个新的（旧的立即失效）。</p>
        <form method="post" action="/console/apps/${encodeURIComponent(client.clientId)}/secret">
          <button class="btn ghost" type="submit">轮换密钥</button>
        </form>
      </div>`
    : "";
  const body = `
    <div class="row">
      <h1>${escapeHtml(name)} ${badgeHtml(client)}</h1>
      <a class="btn ghost" href="/console/apps">返回</a>
    </div>
    ${err}
    <div class="card">
      <label>Client ID</label>
      <div class="secret">${escapeHtml(client.clientId)}</div>
      <form method="post" action="/console/apps/${encodeURIComponent(client.clientId)}">
        <label>应用名称</label>
        <input type="text" name="name" value="${escapeHtml(name)}" required>
        <label>回调地址（每行一个）</label>
        <textarea name="redirect_uris" required>${escapeHtml(client.redirectUris.join("\n"))}</textarea>
        <div class="actions"><button class="btn primary" type="submit">保存</button></div>
      </form>
    </div>
    ${secretBlock}
    <div class="card">
      <h2>删除应用</h2>
      <p class="hint">删除后该 client_id 立即失效，无法恢复。</p>
      <form method="post" action="/console/apps/${encodeURIComponent(client.clientId)}/delete"
            onsubmit="return confirm('确定删除该应用？此操作不可恢复。')">
        <button class="btn danger" type="submit">删除应用</button>
      </form>
    </div>`;
  return shell("管理应用", userLabel, body);
}

export function secretRevealPage(
  userLabel: string,
  clientId: string,
  secret: string,
  isNew: boolean,
): string {
  const body = `
    <div class="row"><h1>${isNew ? "应用已创建" : "密钥已轮换"}</h1></div>
    <div class="card">
      <div class="warn">请立即复制并妥善保存密钥，它只展示这一次，关闭后无法再查看。</div>
      <label>Client ID</label>
      <div class="secret">${escapeHtml(clientId)}</div>
      <label>Client Secret</label>
      <div class="secret">${escapeHtml(secret)}</div>
      <div class="actions">
        <a class="btn primary" href="/console/apps/${encodeURIComponent(clientId)}">我已保存，继续</a>
      </div>
    </div>`;
  return shell("客户端密钥", userLabel, body);
}
