# 本地联调

```bash
npx wrangler dev   # http://localhost:8787
```

`.dev.vars`（已被 git 忽略）提供本地用的 `SEATABLE_API_TOKEN` 与 `CONSOLE_SESSION_SECRET`。

## 完整授权流程

```bash
# 0. 先在 /console 用 SeaTable Token 登录并新建一个客户端，拿到 client_id（机密客户端还有 secret）

# 1. 生成 PKCE
VERIFIER=$(openssl rand -base64 60 | tr -d '\n=+/' | cut -c1-64)
CHALLENGE=$(printf '%s' "$VERIFIER" | openssl dgst -binary -sha256 | openssl base64 | tr '+/' '-_' | tr -d '=')

# 2. 浏览器打开授权地址，粘贴 Token 登录，从跳转地址里拿到 code
echo "http://localhost:8787/authorize?response_type=code&client_id=<client_id>&redirect_uri=<redirect_uri>&code_challenge=$CHALLENGE&code_challenge_method=S256&state=xyz&scope=openid"

# 3. 用 code 换 token（公开客户端带 code_verifier，不带 secret）
curl -s http://localhost:8787/token \
  -d grant_type=authorization_code -d client_id=<client_id> \
  -d code=<拿到的code> -d redirect_uri=<redirect_uri> \
  -d code_verifier=$VERIFIER

# 4. 校验 access token
curl -s http://localhost:8787/userinfo -H "Authorization: Bearer <access_token>"

# 5. 刷新
curl -s http://localhost:8787/token \
  -d grant_type=refresh_token -d client_id=<client_id> -d refresh_token=<refresh_token>
```

机密客户端在第 3、5 步加 `-d client_secret=...`（或用 `-u client_id:secret`）。
