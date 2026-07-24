# OIDC 接入说明

把 `ISSUER` 替换为部署域名，例如 `https://auth.nju.at`。本服务是标准 OpenID Connect Provider；接入方应优先使用成熟 OIDC client library，并把 issuer 配置为 `ISSUER`。

## 自动发现

```text
GET ISSUER/.well-known/openid-configuration
```

Discovery 会给出 authorization、token、JWKS、UserInfo、introspection、revocation 与 end-session 端点。不要在新代码里写死旧路径。

ID Token 使用 `RS256` 签名，JWKS 中对应密钥的 `kty` 为 `RSA`。

## 注册客户端

1. 打开 `ISSUER/console`，用 SeaTable Token 登录。
2. 新建应用并填写精确的回调地址。
3. SPA、移动端、CLI 选**公开客户端**；有可信后端并能保管 secret 时选**机密客户端**。
4. 保存 `client_id`。机密客户端还需立即保存只展示一次的 `client_secret`。

动态客户端注册关闭。每个用户只能管理自己创建的客户端。

## 推荐参数

- Flow：Authorization Code
- PKCE：必须 `S256`
- response type：`code`
- scopes：`openid profile email offline_access`
- `state`：每次请求生成并严格校验
- `nonce`：每次请求生成，并在验证 `id_token` 时校验
- redirect URI：必须与注册值完全一致

授权请求示例：

```text
GET ISSUER/oauth2/authorize
  ?response_type=code
  &client_id=<client_id>
  &redirect_uri=<registered_redirect_uri>
  &scope=openid%20profile%20email%20offline_access
  &state=<random>
  &nonce=<random>
  &code_challenge=<base64url_sha256_verifier>
  &code_challenge_method=S256
```

用户完成 SeaTable 登录与 consent 后，会跳回：

```text
<registered_redirect_uri>?code=<authorization_code>&state=<state>
```

## 换取令牌

```text
POST ISSUER/oauth2/token
Content-Type: application/x-www-form-urlencoded

grant_type=authorization_code
&client_id=<client_id>
&code=<authorization_code>
&redirect_uri=<registered_redirect_uri>
&code_verifier=<verifier>
```

机密客户端使用 HTTP Basic：

```text
Authorization: Basic base64(client_id:client_secret)
```

成功响应包含：

- `access_token`：默认 3600 秒
- `id_token`：包含稳定 `sub`，使用 Discovery 的 `jwks_uri` 验签
- `refresh_token`：请求 `offline_access` 时返回，默认 30 天
- `token_type=Bearer`

验证 `id_token` 时至少校验签名、`iss`、`aud`、`exp` 与 `nonce`。不要只 decode JWT。

## 用户身份

```text
GET ISSUER/oauth2/userinfo
Authorization: Bearer <access_token>
```

`sub` 是 SeaTable `ID`，稳定且唯一；`name` 来自 SeaTable `Name`。首次创建账号时邮箱默认为 `<sub>@smail.nju.edu.cn`，用户可在管理后台验证并切换为允许的 `@smail.nju.edu.cn` 或 `@nju.edu.cn` 地址。请求 `email` scope 后，ID Token 与 UserInfo 会包含：

- `email`：签发时账号当前保存的邮箱
- `email_verified`：固定为 `true`；默认邮箱受身份规则信任，修改后的邮箱在写入前完成 OTP 验证

邮箱修改不会撤销已有会话、access token、refresh token 或 consent。已经签发的 ID Token 内容不会变化；后续签发的 Token 使用新邮箱。UserInfo 会读取账号当前邮箱，因此同一有效 access token 后续查询时可能看到更新后的值。

## 刷新、撤销与退出

刷新：

```text
POST ISSUER/oauth2/token
grant_type=refresh_token
&refresh_token=<refresh_token>
```

机密客户端仍需认证。refresh token 会轮换；客户端必须保存响应中的新 refresh token。SeaTable Token 已轮换或删除时，刷新返回 `invalid_grant`，需要重新登录。

撤销与退出地址从 Discovery 获取：

- `/oauth2/revoke`
- `/oauth2/end-session`

## 兼容与限制

- 旧 `/authorize`、`/token`、`/userinfo` 仍可用，但只用于已有集成迁移。
- 不支持 implicit flow、password grant、plain PKCE、通配 redirect URI。
- 不支持 RFC 8707 `resource` 参数；携带时返回 `invalid_request`。
- 资源服务器可调用 UserInfo 或 introspection；验证 `id_token` 应使用 JWKS 本地验签。
