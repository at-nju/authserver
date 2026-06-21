export function escapeHtml(s: string): string {
  return s
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

export function loginPage(opts: LoginPageOptions): string {
  const hidden = Object.entries(opts.hidden ?? {})
    .map(([k, v]) => `<input type="hidden" name="${escapeHtml(k)}" value="${escapeHtml(v)}">`)
    .join("\n      ");
  const errorBox = opts.error ? `<p class="error">${escapeHtml(opts.error)}</p>` : "";

  return `<!doctype html>
<html lang="zh-CN">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>${escapeHtml(opts.title)}</title>
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
  <form class="card" method="post" action="${escapeHtml(opts.action)}">
    <h1>${escapeHtml(opts.title)}</h1>
    <p class="sub">${escapeHtml(opts.subtitle)}</p>
    ${errorBox}
    <label for="token">Token</label>
    <input id="token" name="token" type="password" autocomplete="off" autofocus required>
    <p class="hint">还没有 Token？<a href="https://table.nju.edu.cn/apps/custom/authserver/" target="_blank" rel="noopener noreferrer">点击此处获取</a></p>
    ${hidden}
    <button type="submit">登录并授权</button>
  </form>
</body>
</html>`;
}
