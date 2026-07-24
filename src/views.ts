export function escapeHtml(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

export interface LoginPageOptions {
  action: string;
  title: string;
  subtitle: string;
  hidden?: Record<string, string>;
  error?: string;
}

export function loginPage(options: LoginPageOptions): string {
  const hidden = Object.entries(options.hidden ?? {})
    .map(
      ([key, value]) =>
        `<input type="hidden" name="${escapeHtml(key)}" value="${escapeHtml(value)}">`,
    )
    .join("\n      ");
  const errorBox = options.error
    ? `<p class="error">${escapeHtml(options.error)}</p>`
    : "";

  return `<!doctype html>
<html lang="zh-CN">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>${escapeHtml(options.title)}</title>
  <style>
    body { font-family: system-ui, sans-serif; background: #f5f5f7; margin: 0;
           display: flex; min-height: 100vh; align-items: center; justify-content: center; }
    .card { background: #fff; padding: 2rem; border-radius: 12px; width: 340px;
            box-shadow: 0 4px 24px rgba(0,0,0,.08); }
    h1 { font-size: 1.25rem; margin: 0 0 .25rem; }
    p.sub { color: #666; margin: 0 0 1.5rem; font-size: .9rem; }
    label { display: block; font-size: .85rem; color: #333; margin-bottom: .4rem; }
    input[type=password] { width: 100%; box-sizing: border-box; padding: .6rem .7rem;
            border: 1px solid #ccc; border-radius: 8px; font-size: 1rem; }
    button { width: 100%; margin-top: 1.25rem; padding: .7rem; border: 0;
             border-radius: 8px; background: #2563eb; color: #fff; font-size: 1rem;
             cursor: pointer; }
    button:hover { background: #1d4ed8; }
    .error { color: #b91c1c; background: #fee2e2; padding: .5rem .7rem;
             border-radius: 8px; font-size: .85rem; margin: 0 0 1rem; }
    .hint { font-size: .85rem; color: #1e40af; margin: .75rem 0 0;
            background: #eff6ff; border: 1px solid #bfdbfe; border-radius: 8px;
            padding: .65rem .75rem; }
    .hint a { color: #2563eb; font-weight: 600; text-decoration: none; white-space: nowrap; }
    .hint a:hover { text-decoration: underline; }
  </style>
</head>
<body>
  <form class="card" method="post" action="${escapeHtml(options.action)}">
    <h1>${escapeHtml(options.title)}</h1>
    <p class="sub">${escapeHtml(options.subtitle)}</p>
    ${errorBox}
    <label for="token">Token</label>
    <input id="token" name="token" type="password" autocomplete="off" autofocus required>
    <p class="hint">还没有 Token？<a href="https://table.nju.edu.cn/apps/custom/authserver/" target="_blank" rel="noopener noreferrer">点击此处获取</a></p>
    ${hidden}
    <button type="submit">继续</button>
  </form>
</body>
</html>`;
}

export function consentPage(options: {
  appName: string;
  scopes: string[];
  oauthQuery: string;
}): string {
  const scopeItems = options.scopes
    .map((scope) => `<li><code>${escapeHtml(scope)}</code></li>`)
    .join("");
  return `<!doctype html>
<html lang="zh-CN">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>确认授权</title>
  <style>
    body { font-family: system-ui, sans-serif; background: #f5f5f7; margin: 0;
           display: flex; min-height: 100vh; align-items: center; justify-content: center; color: #1f2937; }
    .card { background: #fff; padding: 2rem; border-radius: 12px; width: 380px;
            box-shadow: 0 4px 24px rgba(0,0,0,.08); }
    h1 { font-size: 1.25rem; margin: 0 0 .5rem; }
    p { color: #4b5563; font-size: .9rem; line-height: 1.5; }
    ul { background: #f9fafb; border: 1px solid #e5e7eb; border-radius: 8px;
         padding: .75rem 1rem .75rem 2rem; }
    li { margin: .35rem 0; }
    .actions { display: flex; gap: .75rem; margin-top: 1.25rem; }
    button { flex: 1; padding: .7rem; border-radius: 8px; font-size: .95rem; cursor: pointer; }
    .allow { border: 0; background: #2563eb; color: #fff; }
    .deny { border: 1px solid #d1d5db; background: #fff; color: #374151; }
  </style>
</head>
<body>
  <div class="card">
    <h1>确认授权</h1>
    <p><strong>${escapeHtml(options.appName)}</strong> 请求以下权限：</p>
    <ul>${scopeItems}</ul>
    <form method="post" action="/consent">
      <input type="hidden" name="oauth_query" value="${escapeHtml(options.oauthQuery)}">
      <div class="actions">
        <button class="deny" type="submit" name="accept" value="false">拒绝</button>
        <button class="allow" type="submit" name="accept" value="true">允许</button>
      </div>
    </form>
  </div>
</body>
</html>`;
}
