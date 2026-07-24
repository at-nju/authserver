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

`sub` 是 SeaTable `ID`，稳定且唯一；`name` 来自 SeaTable `Name`。请求 `email` scope 后，ID Token 与 UserInfo 会包含：

- `email`：默认值为 `<sub>@smail.nju.edu.cn`
- `email_verified`：当前固定为 `false`，尚未接入邮箱验证

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
