-- 管理后台:客户端归属 + 后台自身的第一方 OAuth 客户端。

ALTER TABLE clients ADD COLUMN owner_id TEXT;

CREATE INDEX IF NOT EXISTS idx_clients_owner ON clients (owner_id);

-- 后台自身客户端(公开 / 仅 PKCE,无 owner)。
-- 上线后请把 redirect_uris 改成线上域名的 /console/callback。
INSERT OR IGNORE INTO clients (client_id, client_secret_hash, name, redirect_uris, owner_id, created_at)
VALUES ('__console__', NULL, '管理后台', 'http://localhost:8787/console/callback', NULL, unixepoch());
