# 架构与端点

## 组件

- **Cloudflare Worker + Hono**：页面、兼容路由与请求边界。
- **Better Auth OAuth Provider**：OAuth 2.1 / OpenID Connect 协议实现。
- **Cloudflare D1**：用户、会话、客户端、授权、令牌、consent 与 JWKS。
- **SeaTable `Table1`**：外部身份源，只读查询 `ID`、`Name`、`Token`。

登录时，SeaTable `ID` 直接作为 Better Auth user id，因此也是稳定 OIDC `sub`。首次创建账号时默认邮箱为 `<ID>@smail.nju.edu.cn`，直接视为可信；后续登录只同步展示名，不覆盖用户已经修改的邮箱。所有保存在用户表中的邮箱都已验证，因此 OIDC `email_verified` 为 `true`。

OIDC ID Token 使用 2048-bit RSA 密钥和 `RS256` 签名。公钥通过 `/jwks` 发布；私钥由 Better Auth 加密后保存在 D1。

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

## 邮箱修改

管理后台允许把当前邮箱切换为以下两类地址：

- `@smail.nju.edu.cn`：本地部分必须为 1–64 位数字。
- `@nju.edu.cn`：本地部分采用常见 ASCII dot-atom 邮箱格式。

地址统一转为小写，并通过 `lower(email)` 唯一索引保证大小写不敏感的全局唯一性。修改流程只在浏览器当前页面中存在：服务端在 Better Auth 的 `verification` 表保存一条最多 10 分钟的 OTP 哈希记录，不在用户表保存 `pendingEmail`，验证成功后立即消费记录并替换当前邮箱。

验证码为 6 位数字，最多输错 5 次。发送限制只按登录账号计算：2 分钟最多 1 封、每小时最多 3 封、每天最多 6 封。计数保存在 `emailChangeRateLimit`，不记录 IP、目标邮箱或邮箱修改历史。邮件由 `noreply@nju.at` 通过飞书 SMTP (`smtp.feishu.cn:465`, implicit TLS) 发送。

## SeaTable Token 轮换

登录会话记录当时的 `sha256(Token)`。使用 refresh token 时：

1. 找到 refresh token 关联的 Better Auth session。
2. 回查相同 SeaTable `ID` 当前 Token 的哈希。
3. 不一致或 Token 已删除时返回 `invalid_grant`，要求重新登录。

SeaTable 暂时不可达时保持旧行为：刷新 fail-open，避免身份源故障同时中断所有会话。已签发 access token 仍可使用到最多 1 小时后过期。

## 安全边界

- 授权码与令牌只以哈希形式持久化。
- 邮箱验证码使用绑定 user id、目标邮箱和主密钥的 HMAC-SHA-256 哈希保存。
- `id_token` 使用 D1 中的 2048-bit RSA JWKS，以 `RS256` 签名。
- 控制台回跳只允许 `/console` 下的本地路径。
- RFC 8707 `resource` 参数未启用，并在 Worker 入口直接返回 `invalid_request`。
- access token 默认 1 小时，refresh token 默认 30 天，会话默认 7 天。

## 目录

```text
src/auth.ts           Better Auth、OIDC 配置、SeaTable 登录与刷新校验
src/index.ts          页面、兼容路由、Provider 挂载
src/console.ts        客户端管理后台
src/email_change.ts   邮箱 OTP、账号限流与原子替换
src/email_policy.ts   南大邮箱格式与规范化规则
src/smtp.ts           飞书 SMTP 投递
src/security.ts       请求边界安全策略
src/seatable.ts       SeaTable 只读身份查询
src/views.ts          登录与 consent 页面
migrations/           D1 schema
```
