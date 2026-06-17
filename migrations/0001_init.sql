-- OAuth 2.0 Authorization Server schema (Cloudflare D1 / SQLite).
-- All secrets/codes/tokens are stored as SHA-256 hex digests, never plaintext.
-- Timestamps are stored as unix epoch seconds (integers).

-- Registered OAuth client applications (seeded manually).
CREATE TABLE IF NOT EXISTS clients (
  client_id          TEXT PRIMARY KEY,
  client_secret_hash TEXT,            -- NULL for public / PKCE-only clients
  name               TEXT NOT NULL,
  redirect_uris      TEXT NOT NULL,   -- newline-separated list, matched exactly
  created_at         INTEGER NOT NULL
);

-- Short-lived, single-use authorization codes issued by /authorize.
CREATE TABLE IF NOT EXISTS auth_codes (
  code_hash             TEXT PRIMARY KEY,
  client_id             TEXT NOT NULL,
  user_id               TEXT NOT NULL,   -- the SeaTable Table1.ID
  redirect_uri          TEXT NOT NULL,
  scope                 TEXT,
  code_challenge        TEXT NOT NULL,
  code_challenge_method TEXT NOT NULL,   -- always "S256"
  expires_at            INTEGER NOT NULL,
  used                  INTEGER NOT NULL DEFAULT 0,
  created_at            INTEGER NOT NULL
);

-- Opaque access tokens.
CREATE TABLE IF NOT EXISTS access_tokens (
  token_hash  TEXT PRIMARY KEY,
  client_id   TEXT NOT NULL,
  user_id     TEXT NOT NULL,
  scope       TEXT,
  expires_at  INTEGER NOT NULL,
  created_at  INTEGER NOT NULL
);

-- Opaque refresh tokens (rotated on use).
CREATE TABLE IF NOT EXISTS refresh_tokens (
  token_hash  TEXT PRIMARY KEY,
  client_id   TEXT NOT NULL,
  user_id     TEXT NOT NULL,
  scope       TEXT,
  expires_at  INTEGER NOT NULL,
  revoked     INTEGER NOT NULL DEFAULT 0,
  created_at  INTEGER NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_access_tokens_expires  ON access_tokens (expires_at);
CREATE INDEX IF NOT EXISTS idx_refresh_tokens_expires ON refresh_tokens (expires_at);
CREATE INDEX IF NOT EXISTS idx_auth_codes_expires     ON auth_codes (expires_at);
