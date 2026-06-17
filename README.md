# SeaTable Authserver

An OAuth 2.0 **Authorization Code + PKCE** server running on **Cloudflare
Workers**, backed by **Cloudflare D1**.

- All OAuth state (clients, authorization codes, access/refresh tokens) lives in
  D1. Secrets/codes/tokens are stored only as SHA-256 hashes.
- **SeaTable `Table1` is the identity source.** At login the user pastes their
  **Token**; the Worker verifies it exists in `Table1` and uses the matching
  **`ID`** as the authenticated subject (`user_id`). Nothing is written back to
  SeaTable.
- [`generate_token.py`](generate_token.py) is unchanged — it's the admin tool
  that provisions Tokens into `Table1`. This server only *consumes* them.

## Endpoints

| Method | Path          | Purpose                                            |
|--------|---------------|----------------------------------------------------|
| GET    | `/authorize`  | Login page (validates `client_id`, `redirect_uri`, PKCE) |
| POST   | `/authorize`  | Verify Token via SeaTable → issue code → redirect  |
| POST   | `/token`      | `authorization_code` or `refresh_token` grant      |
| POST   | `/introspect` | Validate an access token (for resource servers)    |
| POST   | `/revoke`     | Revoke an access or refresh token                  |

Defaults: auth code TTL 60s (single-use), access token 1h, refresh token 30d.

## Setup

```bash
npm install

# 1. Create the D1 database, then paste the printed database_id into wrangler.toml
npx wrangler d1 create authserver-db

# 2. Apply the schema (local for `wrangler dev`, remote for production)
npx wrangler d1 migrations apply authserver-db --local
npx wrangler d1 migrations apply authserver-db --remote

# 3. Store the SeaTable base API token as a secret
npx wrangler secret put SEATABLE_API_TOKEN
# (SEATABLE_SERVER_URL is set in wrangler.toml; default https://cloud.seatable.io)
```

### Register a client

A **public client** (PKCE only, no secret — e.g. SPA / mobile / CLI):

```bash
npx wrangler d1 execute authserver-db --local --command \
  "INSERT INTO clients (client_id, client_secret_hash, name, redirect_uris, created_at)
   VALUES ('demo-client', NULL, 'Demo App', 'http://localhost:8788/callback', unixepoch());"
```

A **confidential client** needs the SHA-256 hex of its secret:

```bash
SECRET="super-secret-value"
HASH=$(printf '%s' "$SECRET" | shasum -a 256 | cut -d' ' -f1)
npx wrangler d1 execute authserver-db --local --command \
  "INSERT INTO clients (client_id, client_secret_hash, name, redirect_uris, created_at)
   VALUES ('web-app', '$HASH', 'Web App', 'http://localhost:8788/callback', unixepoch());"
```

`redirect_uris` is a newline-separated allow-list, matched **exactly**.

## Run & test the full flow

```bash
npx wrangler dev   # serves on http://localhost:8787
```

Make sure `Table1` has a row with a known `Token` / `ID` (run
`generate_token.py` if needed). Then:

**1. Generate a PKCE verifier + S256 challenge**

```bash
VERIFIER=$(openssl rand -base64 60 | tr -d '\n=+/' | cut -c1-64)
CHALLENGE=$(printf '%s' "$VERIFIER" | openssl dgst -binary -sha256 \
            | openssl base64 | tr '+/' '-_' | tr -d '=')
echo "verifier=$VERIFIER"; echo "challenge=$CHALLENGE"
```

**2. Open the authorize URL in a browser**, paste your SeaTable Token, submit:

```
http://localhost:8787/authorize?response_type=code&client_id=demo-client&redirect_uri=http://localhost:8788/callback&code_challenge=CHALLENGE&code_challenge_method=S256&state=xyz&scope=read
```

The browser redirects to `…/callback?code=AUTH_CODE&state=xyz`. Copy `AUTH_CODE`.

**3. Exchange the code for tokens** (public client → send `code_verifier`, no secret):

```bash
curl -s http://localhost:8787/token \
  -d grant_type=authorization_code \
  -d client_id=demo-client \
  -d code=AUTH_CODE \
  -d redirect_uri=http://localhost:8788/callback \
  -d code_verifier=$VERIFIER
# -> {"access_token":"...","token_type":"Bearer","expires_in":3600,"refresh_token":"..."}
```

For a confidential client add `-d client_secret=...` (or use `-u client_id:secret`).

**4. Introspect the access token**

```bash
curl -s http://localhost:8787/introspect -d token=ACCESS_TOKEN
# -> {"active":true,"client_id":"demo-client","user_id":"<your Table1 ID>",...}
```

**5. Refresh**

```bash
curl -s http://localhost:8787/token \
  -d grant_type=refresh_token \
  -d client_id=demo-client \
  -d refresh_token=REFRESH_TOKEN
```

### Negative checks

- Wrong Token at login → 401 "Invalid token".
- Reusing an auth code → `invalid_grant` (single-use).
- Wrong `code_verifier` → `invalid_grant` (PKCE failed).
- Code older than 60s → `invalid_grant` (expired).

## Deploy

```bash
npx wrangler deploy
```

## Project layout

```
src/
  index.ts     Hono routes (authorize / token / introspect / revoke)
  oauth.ts     crypto: hashing, opaque tokens, PKCE S256, lifetimes
  db.ts        D1 data access
  seatable.ts  Token verification via SeaTable REST API
  views.ts     login/consent HTML
  env.ts       binding types
migrations/
  0001_init.sql  D1 schema
```
