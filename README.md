# SeaTable Authserver

跑在 **Cloudflare Workers + KV** 上的 OAuth 2.1 授权服务器（**Authorization Code + PKCE**），底层由官方
[`@cloudflare/workers-oauth-provider`](https://github.com/cloudflare/workers-oauth-provider) 实现令牌签发、
PKCE、客户端存储与元数据发现。

- OAuth 状态（客户端、授权、access/refresh token）全部由 provider 存在 **KV**（`OAUTH_KV`），密钥仅存哈希，`props` 经令牌加密。
- **SeaTable `Table1` 作为身份源**：登录时用户粘贴自己的 **Token**，服务端去 `Table1` 校验，命中则取该行的 **`ID`**（身份 `user_id`）与 **`Name`**（展示名）。不往 SeaTable 写任何东西。
- [`generate_token.py`](generate_token.py) 负责往 `Table1` 灌 Token，本服务只读校验。

## 接口

| 方法 | 路径 | 说明 |
|------|------|------|
| GET  | `/authorize` | 登录页（解析授权请求、校验 client） |
| POST | `/authorize` | 校验 Token → 由 provider 签发授权码 → 重定向回 client |
| POST | `/token` | `authorization_code` / `refresh_token` 换 token（由 provider 实现） |
| GET  | `/userinfo` | 携带 `Authorization: Bearer <access_token>`，返回 `{ sub, user_id, name }`，供资源服务器校验令牌 |
| GET  | `/.well-known/oauth-authorization-server` | RFC 8414 元数据（由 provider 实现） |

资源服务器**不再使用 `/introspect`**，改为带 Bearer 头请求 `/userinfo`：令牌有效则返回用户身份，无效返回 401。

有效期：access token 1 小时，refresh token 30 天（均为 provider 默认，可在 `src/index.ts` 调整）。

## 部署

```bash
npm install

# 1. 建两个 KV 命名空间，把输出的 id 填进 wrangler.toml
npx wrangler kv namespace create OAUTH_KV
npx wrangler kv namespace create CONSOLE_KV

# 2. 配密钥（勿写进 wrangler.toml）
npx wrangler secret put SEATABLE_API_TOKEN      # SeaTable base API token
npx wrangler secret put CONSOLE_SESSION_SECRET  # 控制台会话签名密钥，用随机长字符串
# SEATABLE_SERVER_URL 在 wrangler.toml 里配置

# 3. 上线
npx wrangler deploy
```

## 管理后台（自助注册客户端）

后台地址 `/console`。任何能用 SeaTable Token 登录的人都可以自助注册 / 编辑 / 删除**自己名下的**客户端，数量不限。
会话用 HMAC 签名的 httpOnly cookie（不依赖 OAuth 令牌），客户端归属记录在 `CONSOLE_KV`。

- 浏览器打开 `/console` → 跳登录 → 粘贴 Token → 进入「我的应用」。
- 新建应用时选**公开**（仅 PKCE）或**机密**（带密钥，密钥仅创建/轮换时展示一次）。
- `redirect_uris` 为换行分隔的白名单，由 provider **精确匹配**。

动态客户端注册（RFC 7591）已禁用，客户端只能经控制台创建。

## 本地联调

```bash
npx wrangler dev   # http://localhost:8787
```

`.dev.vars`（已被 git 忽略）提供本地用的 `SEATABLE_API_TOKEN` 与 `CONSOLE_SESSION_SECRET`。完整流程：

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

## 目录

```
src/
  index.ts          构造 OAuthProvider；Hono 处理 / 、/authorize、挂载 /console
  userinfo.ts       受 provider 保护的 /userinfo（返回令牌身份）
  console.ts        管理后台路由（登录 / 退出 + 应用增删改查）
  console_views.ts  后台页面 HTML
  ownership.ts      CONSOLE_KV 客户端归属索引
  crypto.ts         随机 token、HMAC 签名/校验
  seatable.ts       SeaTable Token 校验（取 ID / Name）
  views.ts          登录页 HTML
  env.ts            绑定类型
```
