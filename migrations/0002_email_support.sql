UPDATE "user"
SET
  "email" = "id" || '@smail.nju.edu.cn',
  "emailVerified" = 0,
  "updatedAt" = CURRENT_TIMESTAMP;

UPDATE "oauthClient"
SET
  "scopes" = CASE
    WHEN "scopes" IS NULL OR json_valid("scopes") = 0
      THEN json_array('openid', 'profile', 'email', 'offline_access')
    WHEN EXISTS (
      SELECT 1
      FROM json_each("oauthClient"."scopes")
      WHERE json_each.value = 'email'
    )
      THEN "scopes"
    ELSE json_insert("scopes", '$[#]', 'email')
  END,
  "updatedAt" = CURRENT_TIMESTAMP;
