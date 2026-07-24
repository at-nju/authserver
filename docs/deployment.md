# 部署

## 首次初始化

```bash
npm install

# 新 Cloudflare 账号才需要创建；当前仓库已在 wrangler.toml 绑定 authserver D1。
npx wrangler d1 create authserver
# 将输出的 database_id 写入 wrangler.toml 的 AUTH_DB。

npm run db:migrate:remote
```

配置 Worker secrets：

```bash
npx wrangler secret put SEATABLE_API_TOKEN
npx wrangler secret put CONSOLE_SESSION_SECRET
npx wrangler secret put SMTP_PASSWORD
```

`CONSOLE_SESSION_SECRET` 是沿用旧名称的 Better Auth 主密钥，至少使用 32 字节随机值；不要写进仓库。`SMTP_PASSWORD` 是飞书为 `noreply@nju.at` 生成的第三方客户端专用密码。SMTP 固定连接 `smtp.feishu.cn:465` 并使用 implicit TLS。`SEATABLE_SERVER_URL` 在 `wrangler.toml` 中配置。

完成验证后部署：

```bash
npm test
npm run typecheck
npx wrangler deploy
```

## 数据迁移说明

2026-07-23 的 KV → D1 重构已执行：

- 远端 D1 已应用 `0001_oidc.sql`。
- 原 KV 中唯一的 `Cloudflare` 客户端已迁移，保留原 `client_id`、owner、回调地址和客户端密钥哈希。
- 旧 `OAUTH_KV` / `CONSOLE_KV` 未删除，可作为切换后的短期回滚备份；新 Worker 不再绑定它们。

不要把一次性的旧客户端迁移 SQL提交进仓库，其中包含不可逆但仍应保护的客户端密钥哈希。

邮箱功能使用 `0004_verified_email_change.sql`：将已有邮箱规范化为小写并标记为已验证，增加大小写不敏感唯一索引和按账号计数的发送限流表。迁移不会创建待验证邮箱字段，也不会保存邮箱修改历史。

## 回滚

代码回滚到旧提交时，需要同时恢复旧 `wrangler.toml` 的两个 KV binding；D1 与旧 KV 互不覆盖。确认新版本稳定后再手动删除旧 KV。
