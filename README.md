# SeaTable OIDC Authserver

运行在 **Cloudflare Workers + D1** 上的 OpenID Connect Provider。协议实现采用
[`better-auth`](https://github.com/better-auth/better-auth) 与
[`@better-auth/oauth-provider`](https://www.npmjs.com/package/@better-auth/oauth-provider)，身份来自 SeaTable `Table1`。

- OIDC Authorization Code Flow + PKCE（仅 `S256`）
- `id_token`、JWKS、Discovery、UserInfo、Introspection、Revocation、RP-Initiated Logout
- 使用 2048-bit RSA / RS256 签名 OIDC Token，兼容 Cloudflare Access
- `openid profile email offline_access` scopes
- SeaTable Token 登录，`ID` 作为稳定 `sub`，`Name` 作为展示名
- `/console` 自助管理公开或机密客户端
- access token 1 小时，refresh token 30 天；SeaTable Token 轮换后拒绝继续刷新
- 旧 `/authorize`、`/token`、`/userinfo` 路径保留兼容

## 本地运行

```bash
npm install
npm run db:migrate:local
npm run dev
```

本地密钥放在已忽略的 `.dev.vars`：

```dotenv
SEATABLE_API_TOKEN=...
CONSOLE_SESSION_SECRET=至少 32 字节的随机值
```

## 验证

```bash
npm test
npm run typecheck
npm run schema:generate
```

## 文档

- [架构与端点](docs/architecture.md)
- [部署](docs/deployment.md)
- [本地联调](docs/development.md)
- [OIDC 接入说明](docs/integration.md)
