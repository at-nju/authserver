// Minimal server-rendered HTML for the login/consent step of /authorize.

/** Escape a string for safe interpolation into HTML attributes/text. */
export function escapeHtml(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

export interface AuthorizeParams {
  client_id: string;
  redirect_uri: string;
  state: string;
  scope: string;
  code_challenge: string;
  code_challenge_method: string;
}

/**
 * The login + consent page. The user pastes their SeaTable Token; all OAuth
 * parameters are carried forward as hidden fields and POSTed back to /authorize.
 */
export function loginPage(
  params: AuthorizeParams,
  clientName: string,
  error?: string,
): string {
  const hidden = (Object.keys(params) as Array<keyof AuthorizeParams>)
    .map(
      (k) =>
        `<input type="hidden" name="${k}" value="${escapeHtml(params[k] ?? "")}">`,
    )
    .join("\n      ");

  const errorBox = error
    ? `<p class="error">${escapeHtml(error)}</p>`
    : "";

  return `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>Sign in</title>
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
    .app { font-weight: 600; }
  </style>
</head>
<body>
  <form class="card" method="post" action="/authorize">
    <h1>Authorize access</h1>
    <p class="sub"><span class="app">${escapeHtml(clientName)}</span> is requesting access. Paste your access token to continue.</p>
    ${errorBox}
    <label for="token">Access token</label>
    <input id="token" name="token" type="password" autocomplete="off" autofocus required>
    ${hidden}
    <button type="submit">Sign in &amp; authorize</button>
  </form>
</body>
</html>`;
}
