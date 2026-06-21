# SeaTable Authserver

跑在 **Cloudflare Workers + KV** 上的 OAuth 2.1 授权服务器（**Authorization Code + PKCE**），底层由官方
[`@cloudflare/workers-oauth-provider`](https://github.com/cloudflare/workers-oauth-provider) 实现。

- OAuth 状态全部存在 **KV**（`OAUTH_KV`），密钥仅存哈希，`props` 经令牌加密。
- **SeaTable `Table1` 作为身份源**：用户粘贴自己的 **Token**，命中则取该行的 **`ID`** / **`Name`** 作为身份。
- 自带管理后台 `/console`，用 SeaTable Token 登录即可自助注册客户端。

## 快速开始

```bash
npm install
npx wrangler kv namespace create OAUTH_KV       # 把 id 填进 wrangler.toml
npx wrangler kv namespace create CONSOLE_KV
npx wrangler secret put SEATABLE_API_TOKEN
npx wrangler secret put CONSOLE_SESSION_SECRET
npx wrangler deploy
```

## 文档

- [部署](docs/deployment.md)
- [本地联调](docs/development.md)
- [接口与架构](docs/architecture.md)
