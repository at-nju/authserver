# OAuth 接入说明（供 AI 阅读）

本服务是 OAuth 2.1 授权服务器（Authorization Code + PKCE）。本文档让 AI 助手据此为某个应用接入登录。
把 `BASE` 替换为部署域名，即 `https://auth.nju.at`。

## 接入前提：需人工在网页注册客户端（AI 无法代办）

`client_id` / `client_secret` 只能由人在网页后台创建。AI 应把下面这段操作步骤转告用户：

1. 浏览器打开 `BASE/console`，用 SeaTable Token 登录。
2. 点「新建应用」，填写：
   - 应用名称：应用名（显示在用户授权页）。
   - 客户端类型：**公开**（SPA/移动端/CLI，无密钥）或 **机密**（有后端、能保管密钥）。
   - 回调地址 redirect_uri：每行一个，必须与代码里用的地址**完全一致**。
3. 创建后把 `client_id`（机密客户端还有只显示一次的 `client_secret`）回填给 AI。

最终登录的用户必须在 SeaTable `Table1` 里有记录（持有自己的 Token），否则无法登录。

## 端点

- 元数据（可选自动发现）：`GET BASE/.well-known/oauth-authorization-server`
- 授权：`GET BASE/authorize`
- 令牌：`POST BASE/token`（`application/x-www-form-urlencoded`）
- 用户信息：`GET BASE/userinfo`

## 流程

### 1. 生成 PKCE（必须 S256）
- `code_verifier`：43–128 字符随机串。
- `code_challenge` = BASE64URL(SHA256(code_verifier))，无 padding。

### 2. 重定向用户到授权页
```
GET BASE/authorize
  ?response_type=code
  &client_id=<client_id>
  &redirect_uri=<已注册的回调地址>
  &code_challenge=<code_challenge>
  &code_challenge_method=S256
  &state=<随机串>
  &scope=openid
```
用户登录授权后跳回 `redirect_uri?code=<code>&state=<state>`。必须校验返回的 `state` 与发出的一致。

### 3. 用 code 换令牌
```
POST BASE/token
Content-Type: application/x-www-form-urlencoded

grant_type=authorization_code
&client_id=<client_id>
&code=<code>
&redirect_uri=<同上，须一致>
&code_verifier=<code_verifier>
```
机密客户端额外带 `client_secret`（表单字段，或用 HTTP Basic：`Authorization: Basic base64(client_id:client_secret)`）。

响应：
```json
{
  "access_token": "...",
  "token_type": "Bearer",
  "expires_in": 3600,
  "refresh_token": "...",
  "scope": "openid"
}
```

### 4. 取用户身份
```
GET BASE/userinfo
Authorization: Bearer <access_token>
```
响应：`{ "sub": "<用户唯一ID>", "name": "<用户名>" }`。用 `sub` 作为用户的稳定唯一标识。令牌无效返回 401。

### 5. 刷新令牌（access_token 过期后）
```
POST BASE/token
grant_type=refresh_token
&client_id=<client_id>
&refresh_token=<refresh_token>
```
机密客户端同样需带 `client_secret`。

## 约束

- `code_challenge_method` 必须为 `S256`，不接受 `plain`。
- `redirect_uri` 在授权和换令牌两步必须完全一致，且与注册值精确匹配（无通配）。
- 授权码一次性、短时有效。
- 校验令牌只用 `GET BASE/userinfo`（Bearer），不提供 introspection 端点。
