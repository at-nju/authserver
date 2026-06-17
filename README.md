# SeaTable Authserver

跑在 **Cloudflare Workers + D1** 上的 OAuth 2.0 授权服务器(**Authorization Code + PKCE**)。

- OAuth 状态(客户端、授权码、access/refresh token)全部存在 **D1**,且只存 SHA-256 哈希。
- **SeaTable `Table1` 作为身份源**:登录时用户粘贴自己的 **Token**,服务端去 `Table1` 校验,命中则取该行的 **`ID`** 作为身份(`user_id`)。不往 SeaTable 写任何东西。
- [`generate_token.py`](generate_token.py) 负责往 `Table1` 灌 Token,本服务只读校验。

## 接口

| 方法 | 路径 | 说明 |
|------|------|------|
| GET  | `/authorize`  | 登录页(校验 client、redirect_uri、PKCE) |
| POST | `/authorize`  | 校验 Token → 签发授权码 → 重定向回 client |
| POST | `/token`      | `authorization_code` / `refresh_token` 换 token |
| POST | `/introspect` | 校验 access token(给资源服务用) |
| POST | `/revoke`     | 吊销 access / refresh token |

有效期:授权码 60 秒(一次性),access token 1 小时,refresh token 30 天。

## 部署

```bash
npm install

# 1. 建 D1,把输出的 database_id 填进 wrangler.toml
npx wrangler d1 create authserver-db

# 2. 建表(本地用于 wrangler dev,远程用于线上)
npx wrangler d1 migrations apply authserver-db --local
npx wrangler d1 migrations apply authserver-db --remote

# 3. 配 SeaTable base API token(密钥,勿写进 wrangler.toml)
npx wrangler secret put SEATABLE_API_TOKEN
# SEATABLE_SERVER_URL 在 wrangler.toml 里配置

# 4. 上线
npx wrangler deploy
```

## 注册客户端

客户端需手动写入 D1。`redirect_uris` 为换行分隔的白名单,**精确匹配**。

公开客户端(仅 PKCE、无密钥,如 SPA / 移动端 / CLI):

```bash
npx wrangler d1 execute authserver-db --local --command \
  "INSERT INTO clients (client_id, client_secret_hash, name, redirect_uris, created_at)
   VALUES ('demo-client', NULL, 'Demo App', 'http://localhost:8788/callback', unixepoch());"
```

机密客户端需存密钥的 SHA-256 十六进制:

```bash
HASH=$(printf '%s' "你的密钥" | shasum -a 256 | cut -d' ' -f1)
npx wrangler d1 execute authserver-db --local --command \
  "INSERT INTO clients (client_id, client_secret_hash, name, redirect_uris, created_at)
   VALUES ('web-app', '$HASH', 'Web App', 'http://localhost:8788/callback', unixepoch());"
```

## 本地联调

```bash
npx wrangler dev   # http://localhost:8787
```

`.dev.vars` 提供本地用的 `SEATABLE_API_TOKEN`(已被 git 忽略)。完整流程:

```bash
# 1. 生成 PKCE
VERIFIER=$(openssl rand -base64 60 | tr -d '\n=+/' | cut -c1-64)
CHALLENGE=$(printf '%s' "$VERIFIER" | openssl dgst -binary -sha256 | openssl base64 | tr '+/' '-_' | tr -d '=')

# 2. 浏览器打开授权地址,粘贴 Token 登录,从跳转地址里拿到 code
echo "http://localhost:8787/authorize?response_type=code&client_id=demo-client&redirect_uri=http://localhost:8788/callback&code_challenge=$CHALLENGE&code_challenge_method=S256&state=xyz&scope=read"

# 3. 用 code 换 token(公开客户端带 code_verifier,不带 secret)
curl -s http://localhost:8787/token \
  -d grant_type=authorization_code -d client_id=demo-client \
  -d code=<拿到的code> -d redirect_uri=http://localhost:8788/callback \
  -d code_verifier=$VERIFIER

# 4. 校验 access token
curl -s http://localhost:8787/introspect -d token=<access_token>

# 5. 刷新
curl -s http://localhost:8787/token \
  -d grant_type=refresh_token -d client_id=demo-client -d refresh_token=<refresh_token>
```

机密客户端在第 3、5 步加 `-d client_secret=...`(或用 `-u client_id:secret`)。

## 目录

```
src/
  index.ts       路由(authorize / token / introspect / revoke)
  oauth.ts       哈希、随机 token、PKCE、有效期
  db.ts          D1 读写
  seatable.ts    SeaTable Token 校验
  views.ts       登录页 HTML
  env.ts         绑定类型
migrations/
  0001_init.sql  D1 建表
```
