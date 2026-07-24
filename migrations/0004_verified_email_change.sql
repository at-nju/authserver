UPDATE "user"
SET
  "email" = lower("email"),
  "emailVerified" = 1,
  "updatedAt" = CURRENT_TIMESTAMP;

CREATE UNIQUE INDEX IF NOT EXISTS "user_email_lower_unique"
ON "user" (lower("email"));

CREATE TABLE "emailChangeRateLimit" (
  "userId" text NOT NULL PRIMARY KEY REFERENCES "user" ("id") ON DELETE CASCADE,
  "lastSentAt" integer NOT NULL,
  "hourBucket" integer NOT NULL,
  "hourCount" integer NOT NULL,
  "dayBucket" integer NOT NULL,
  "dayCount" integer NOT NULL,
  "updatedAt" date NOT NULL
);
