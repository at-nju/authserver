# 本地开发与联调

## 启动

```bash
npm install
npm run db:migrate:local
npm run dev
```

默认地址为 `http://localhost:8787`。`.dev.vars`（已被 Git 忽略）需要：

```dotenv
SEATABLE_API_TOKEN=...
CONSOLE_SESSION_SECRET=至少 32 字节的随机值
SMTP_PASSWORD=noreply@nju.at 的飞书邮箱专用密码
```

也可以复制 `.dev.vars.example` 后填写。没有 `SMTP_PASSWORD` 时 Worker 仍可启动，邮箱修改页面会明确显示邮件服务未配置并禁用发送按钮。

## 常规验证

```bash
npm test
npm run typecheck

# 验证 schema 仍可由固定配置生成；正常情况下文件内容不变。
npm run schema:generate
```

可直接检查 Discovery：

```bash
curl -s http://localhost:8787/.well-known/openid-configuration
curl -s http://localhost:8787/jwks
```

## 手工 Authorization Code Flow

先打开 `/console`，用 SeaTable Token 登录并创建客户端。公开客户端不发放 secret；机密客户端的 secret 只显示一次。

生成 PKCE：

```bash
VERIFIER=$(openssl rand -base64 60 | tr -d '\n=+/' | cut -c1-64)
CHALLENGE=$(printf '%s' "$VERIFIER" | openssl dgst -binary -sha256 | openssl base64 | tr '+/' '-_' | tr -d '=')
```

浏览器打开：

```text
http://localhost:8787/oauth2/authorize?response_type=code&client_id=<client_id>&redirect_uri=<redirect_uri>&scope=openid%20profile%20email%20offline_access&state=<random>&nonce=<random>&code_challenge=<challenge>&code_challenge_method=S256
```

登录、同意后，从回调 URL 取得 `code`：

```bash
curl -s http://localhost:8787/oauth2/token \
  -H 'Content-Type: application/x-www-form-urlencoded' \
  -d grant_type=authorization_code \
  -d client_id=<client_id> \
  -d code=<code> \
  -d redirect_uri=<redirect_uri> \
  -d code_verifier="$VERIFIER"
```

机密客户端改用 `-u '<client_id>:<client_secret>'`。响应包含 `access_token`、`id_token` 与 `refresh_token`。

```bash
curl -s http://localhost:8787/oauth2/userinfo \
  -H 'Authorization: Bearer <access_token>'
```

不要在应用里手写 OIDC 验证；优先使用成熟 OIDC client library，并从 Discovery 加载 issuer、JWKS 和端点。
