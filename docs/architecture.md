# 接口与架构

底层由官方 [`@cloudflare/workers-oauth-provider`](https://github.com/cloudflare/workers-oauth-provider)
实现令牌签发、PKCE、客户端存储与元数据发现。本服务在其之上提供 SeaTable 登录页与管理后台。

## 接口

| 方法 | 路径 | 说明 |
|------|------|------|
| GET  | `/authorize` | 登录页（解析授权请求、校验 client） |
| POST | `/authorize` | 校验 Token → 由 provider 签发授权码 → 重定向回 client |
| POST | `/token` | `authorization_code` / `refresh_token` 换 token（由 provider 实现） |
| GET  | `/userinfo` | 携带 `Authorization: Bearer <access_token>`，返回 `{ sub, name }`，供资源服务器校验令牌 |
| GET  | `/.well-known/oauth-authorization-server` | RFC 8414 元数据（由 provider 实现） |

有效期：access token 1 小时，refresh token 30 天（均为 provider 默认，可在 `src/index.ts` 调整）。

## 资源服务器如何校验令牌

资源服务器带 `Authorization: Bearer <access_token>` 请求 `/userinfo`：
令牌有效则返回 `{ sub, name }`，无效则返回 401。

## 管理后台

后台地址 `/console`。任何能用 SeaTable Token 登录的人都可以自助注册 / 编辑 / 删除**自己名下的**客户端，数量不限。

- 会话用 HMAC 签名的 httpOnly cookie（不依赖 OAuth 令牌），客户端归属记录在 `CONSOLE_KV`。
- 新建应用时选**公开**（仅 PKCE）或**机密**（带密钥，密钥仅创建/轮换时展示一次）。
- `redirect_uris` 为换行分隔的白名单，由 provider **精确匹配**。
- 动态客户端注册（RFC 7591）已禁用，客户端只能经控制台创建。

## 身份源

SeaTable `Table1` 作为身份源：登录时用户粘贴自己的 **Token**，服务端去 `Table1` 校验，命中则取该行的
**`ID`**（身份 `sub`）与 **`Name`**（展示名）。不往 SeaTable 写任何东西。
[`generate_token.py`](../generate_token.py) 负责往 `Table1` 灌 / 轮换 Token，本服务只读校验。

## 轮换与令牌失效

OAuth 令牌与 SeaTable Token 无关，单纯轮换 Token 不会立刻使已签发的令牌失效。为此在**刷新**时做校验：

- 登录签发授权时，把当时 Token 的指纹 `sha256(token)` 记进 grant 的 `props`（`tokenHash`，不随 `/userinfo` 外泄）。
- 每次 `refresh_token` 兑换，经库的 `tokenExchangeCallback` 回查该用户在 `Table1` 的当前 Token 指纹，
  与 `tokenHash` 比对：不一致（含该用户已无 Token）→ 抛 `invalid_grant` 拒绝刷新。

效果：轮换后旧会话在 access token 过期（默认 ≤1 小时）后无法续期而终止。**轮换前已签发的 access token 在其
有效期内仍可用**，非即时；如需更快收敛可调小 `accessTokenTTL`。SeaTable 不可达时刷新放行（fail-open），
不把可用性耦合到 SeaTable。控制台自签名会话（7 天）与此机制无关，不受影响。

## 数据存储

- OAuth 状态（客户端、授权、access/refresh token）由 provider 存在 `OAUTH_KV`，密钥仅存哈希，`props` 经令牌加密。
- 客户端归属索引（owner ↔ client）存在 `CONSOLE_KV`。

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
