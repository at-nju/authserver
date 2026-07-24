# 架构与端点

## 组件

- **Cloudflare Worker + Hono**：页面、兼容路由与请求边界。
- **Better Auth OAuth Provider**：OAuth 2.1 / OpenID Connect 协议实现。
- **Cloudflare D1**：用户、会话、客户端、授权、令牌、consent 与 JWKS。
- **SeaTable `Table1`**：外部身份源，只读查询 `ID`、`Name`、`Token`。

登录时，SeaTable `ID` 直接作为 Better Auth user id，因此也是稳定 OIDC `sub`。内部占位 email 不对外提供；本服务不声明 `email` scope。

## 标准端点

| 方法 | 路径 | 用途 |
|---|---|---|
| GET | `/.well-known/openid-configuration` | OIDC Discovery |
| GET | `/.well-known/oauth-authorization-server` | OAuth Authorization Server Metadata |
| GET | `/jwks` | ID token 公钥 |
| GET | `/oauth2/authorize` | Authorization Code + PKCE |
| POST | `/oauth2/token` | code / refresh token 换令牌 |
| GET/POST | `/oauth2/userinfo` | OIDC UserInfo |
| POST | `/oauth2/introspect` | Token Introspection |
| POST | `/oauth2/revoke` | Token Revocation |
| GET/POST | `/oauth2/end-session` | RP-Initiated Logout |

旧路径 `/authorize`、`/token`、`/userinfo` 分别转发到对应的新端点。新接入应始终从 Discovery 获取地址。

## 登录与授权

1. Provider 校验 `client_id`、精确匹配 `redirect_uri`、scope、PKCE 与签名后的授权请求。
2. `/login` 用 SeaTable Token 查找用户并建立 Better Auth 数据库会话。
3. `/consent` 展示客户端与 scopes；同意后签发一次性授权码。
4. `/oauth2/token` 返回 access token；包含 `openid` 时同时返回签名 `id_token`，包含 `offline_access` 时返回 refresh token。

仅接受 PKCE `S256`。动态客户端注册关闭，客户端只能由已登录用户通过 `/console` 创建。

## 客户端管理

Better Auth 在 `oauthClient.userId` 中保存 owner，所有读取、修改、轮换密钥和删除操作都由框架会话与 owner 校验保护。客户端密钥只在创建或轮换时返回一次，数据库仅保存 SHA-256 哈希。

公开客户端使用 `token_endpoint_auth_method=none` 且强制 PKCE；机密客户端使用 `client_secret_basic`。

## SeaTable Token 轮换

登录会话记录当时的 `sha256(Token)`。使用 refresh token 时：

1. 找到 refresh token 关联的 Better Auth session。
2. 回查相同 SeaTable `ID` 当前 Token 的哈希。
3. 不一致或 Token 已删除时返回 `invalid_grant`，要求重新登录。

SeaTable 暂时不可达时保持旧行为：刷新 fail-open，避免身份源故障同时中断所有会话。已签发 access token 仍可使用到最多 1 小时后过期。

## 安全边界

- 授权码与令牌只以哈希形式持久化。
- `id_token` 使用 D1 中的 Ed25519 JWKS 签名。
- 控制台回跳只允许 `/console` 下的本地路径。
- RFC 8707 `resource` 参数未启用，并在 Worker 入口直接返回 `invalid_request`。
- access token 默认 1 小时，refresh token 默认 30 天，会话默认 7 天。

## 目录

```text
src/auth.ts           Better Auth、OIDC 配置、SeaTable 登录与刷新校验
src/index.ts          页面、兼容路由、Provider 挂载
src/console.ts        客户端管理后台
src/security.ts       请求边界安全策略
src/seatable.ts       SeaTable 只读身份查询
src/views.ts          登录与 consent 页面
migrations/           D1 schema
```
