# 部署

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

上线后浏览器打开 `/console`，用 SeaTable Token 登录即可自助注册客户端，无需额外初始化。
