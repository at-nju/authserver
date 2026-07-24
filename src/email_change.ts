const OTP_LENGTH = 6;
const OTP_EXPIRES_MS = 10 * 60 * 1000;
const OTP_MAX_ATTEMPTS = 5;
const SEND_COOLDOWN_MS = 2 * 60 * 1000;
const SEND_HOURLY_LIMIT = 3;
const SEND_DAILY_LIMIT = 6;
const HOUR_MS = 60 * 60 * 1000;
const DAY_MS = 24 * HOUR_MS;

const encoder = new TextEncoder();

interface RateLimitRow {
  lastSentAt: number;
  hourBucket: number;
  hourCount: number;
  dayBucket: number;
  dayCount: number;
}

interface VerificationRow {
  id: string;
  value: string;
  expiresAt: string | number;
}

interface EmailChangeVerification {
  email: string;
  otpHash: string;
  attempts: number;
}

export interface StartEmailChangeOptions {
  db: D1Database;
  userId: string;
  currentEmail: string;
  newEmail: string;
  secret: string;
  send: (email: string, otp: string) => Promise<void>;
  now?: number;
}

export type StartEmailChangeResult =
  | { sent: true; expiresAt: number }
  | { sent: false; expiresAt: number };

export interface ConfirmEmailChangeOptions {
  db: D1Database;
  userId: string;
  newEmail: string;
  otp: string;
  secret: string;
  now?: number;
}

export type ConfirmEmailChangeResult =
  | { ok: true }
  | { ok: false; reason: "invalid"; attemptsRemaining: number }
  | { ok: false; reason: "expired" | "in-use" };

export class EmailSendRateLimitError extends Error {
  constructor(public readonly retryAfterSeconds: number) {
    super("Email verification send limit exceeded");
    this.name = "EmailSendRateLimitError";
  }
}

export class EmailChangeRequestError extends Error {
  constructor(public readonly code: "same-email" | "send-failed") {
    super(code);
    this.name = "EmailChangeRequestError";
  }
}

function verificationIdentifier(userId: string): string {
  return `email-change:${userId}`;
}

function fixedBucket(now: number, duration: number): number {
  return Math.floor(now / duration);
}

export function calculateEmailRateLimitRetry(
  row: RateLimitRow,
  now: number,
): number {
  const blockers: number[] = [];
  const cooldownEnds = row.lastSentAt + SEND_COOLDOWN_MS;
  if (cooldownEnds > now) blockers.push(cooldownEnds - now);

  const hourBucket = fixedBucket(now, HOUR_MS);
  if (row.hourBucket === hourBucket && row.hourCount >= SEND_HOURLY_LIMIT) {
    blockers.push((hourBucket + 1) * HOUR_MS - now);
  }

  const dayBucket = fixedBucket(now, DAY_MS);
  if (row.dayBucket === dayBucket && row.dayCount >= SEND_DAILY_LIMIT) {
    blockers.push((dayBucket + 1) * DAY_MS - now);
  }

  return Math.max(1, Math.ceil(Math.max(...blockers, 1000) / 1000));
}

async function consumeEmailSendAllowance(
  db: D1Database,
  userId: string,
  now: number,
): Promise<void> {
  const hourBucket = fixedBucket(now, HOUR_MS);
  const dayBucket = fixedBucket(now, DAY_MS);
  const timestamp = new Date(now).toISOString();
  const result = await db
    .prepare(
      `INSERT INTO "emailChangeRateLimit"
        ("userId", "lastSentAt", "hourBucket", "hourCount", "dayBucket", "dayCount", "updatedAt")
       VALUES (?, ?, ?, 1, ?, 1, ?)
       ON CONFLICT("userId") DO UPDATE SET
         "lastSentAt" = excluded."lastSentAt",
         "hourCount" = CASE
           WHEN "emailChangeRateLimit"."hourBucket" = excluded."hourBucket"
             THEN "emailChangeRateLimit"."hourCount" + 1
           ELSE 1
         END,
         "hourBucket" = excluded."hourBucket",
         "dayCount" = CASE
           WHEN "emailChangeRateLimit"."dayBucket" = excluded."dayBucket"
             THEN "emailChangeRateLimit"."dayCount" + 1
           ELSE 1
         END,
         "dayBucket" = excluded."dayBucket",
         "updatedAt" = excluded."updatedAt"
       WHERE "emailChangeRateLimit"."lastSentAt" <= excluded."lastSentAt" - ?
         AND (
           "emailChangeRateLimit"."hourBucket" <> excluded."hourBucket"
           OR "emailChangeRateLimit"."hourCount" < ?
         )
         AND (
           "emailChangeRateLimit"."dayBucket" <> excluded."dayBucket"
           OR "emailChangeRateLimit"."dayCount" < ?
         )`,
    )
    .bind(
      userId,
      now,
      hourBucket,
      dayBucket,
      timestamp,
      SEND_COOLDOWN_MS,
      SEND_HOURLY_LIMIT,
      SEND_DAILY_LIMIT,
    )
    .run();

  if ((result.meta.changes ?? 0) > 0) return;

  const row = await db
    .prepare(
      `SELECT "lastSentAt", "hourBucket", "hourCount", "dayBucket", "dayCount"
       FROM "emailChangeRateLimit" WHERE "userId" = ?`,
    )
    .bind(userId)
    .first<RateLimitRow>();
  throw new EmailSendRateLimitError(
    row ? calculateEmailRateLimitRetry(row, now) : Math.ceil(SEND_COOLDOWN_MS / 1000),
  );
}

async function releaseEmailSendAllowance(
  db: D1Database,
  userId: string,
  now: number,
): Promise<void> {
  const hourBucket = fixedBucket(now, HOUR_MS);
  const dayBucket = fixedBucket(now, DAY_MS);
  await db
    .prepare(
      `UPDATE "emailChangeRateLimit" SET
         "lastSentAt" = 0,
         "hourCount" = CASE
           WHEN "hourBucket" = ? THEN MAX("hourCount" - 1, 0)
           ELSE "hourCount"
         END,
         "dayCount" = CASE
           WHEN "dayBucket" = ? THEN MAX("dayCount" - 1, 0)
           ELSE "dayCount"
         END,
         "updatedAt" = ?
       WHERE "userId" = ? AND "lastSentAt" = ?`,
    )
    .bind(hourBucket, dayBucket, new Date(now).toISOString(), userId, now)
    .run();
}

function randomUint32(): number {
  return crypto.getRandomValues(new Uint32Array(1))[0] ?? 0;
}

export function generateEmailOtp(): string {
  const range = 10 ** OTP_LENGTH;
  const maximum = 2 ** 32 - ((2 ** 32) % range);
  let value = randomUint32();
  while (value >= maximum) value = randomUint32();
  return String(value % range).padStart(OTP_LENGTH, "0");
}

export async function hashEmailOtp(
  secret: string,
  userId: string,
  email: string,
  otp: string,
): Promise<string> {
  const key = await crypto.subtle.importKey(
    "raw",
    encoder.encode(secret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"],
  );
  const signature = await crypto.subtle.sign(
    "HMAC",
    key,
    encoder.encode(`${userId}\n${email}\n${otp}`),
  );
  return [...new Uint8Array(signature)]
    .map((byte) => byte.toString(16).padStart(2, "0"))
    .join("");
}

function equalHex(left: string, right: string): boolean {
  if (left.length !== right.length || left.length % 2 !== 0) return false;
  let difference = 0;
  for (let index = 0; index < left.length; index += 2) {
    difference |= Number.parseInt(left.slice(index, index + 2), 16) ^
      Number.parseInt(right.slice(index, index + 2), 16);
  }
  return difference === 0;
}

async function emailBelongsToAnotherUser(
  db: D1Database,
  userId: string,
  email: string,
): Promise<boolean> {
  const existing = await db
    .prepare(`SELECT "id" FROM "user" WHERE lower("email") = ? AND "id" <> ? LIMIT 1`)
    .bind(email, userId)
    .first<{ id: string }>();
  return Boolean(existing);
}

export async function startEmailChange(
  options: StartEmailChangeOptions,
): Promise<StartEmailChangeResult> {
  const now = options.now ?? Date.now();
  if (options.newEmail === options.currentEmail.toLowerCase()) {
    throw new EmailChangeRequestError("same-email");
  }

  await consumeEmailSendAllowance(options.db, options.userId, now);
  const expiresAt = now + OTP_EXPIRES_MS;
  const identifier = verificationIdentifier(options.userId);
  await options.db
    .prepare(`DELETE FROM "verification" WHERE "identifier" = ?`)
    .bind(identifier)
    .run();
  if (await emailBelongsToAnotherUser(options.db, options.userId, options.newEmail)) {
    return { sent: false, expiresAt };
  }

  const otp = generateEmailOtp();
  const verification: EmailChangeVerification = {
    email: options.newEmail,
    otpHash: await hashEmailOtp(
      options.secret,
      options.userId,
      options.newEmail,
      otp,
    ),
    attempts: 0,
  };
  const id = crypto.randomUUID();
  const createdAt = new Date(now).toISOString();
  await options.db
    .prepare(
      `INSERT INTO "verification"
        ("id", "identifier", "value", "expiresAt", "createdAt", "updatedAt")
       VALUES (?, ?, ?, ?, ?, ?)`,
    )
    .bind(
      id,
      identifier,
      JSON.stringify(verification),
      new Date(expiresAt).toISOString(),
      createdAt,
      createdAt,
    )
    .run();

  try {
    await options.send(options.newEmail, otp);
  } catch {
    await options.db
      .prepare(`DELETE FROM "verification" WHERE "id" = ?`)
      .bind(id)
      .run();
    await releaseEmailSendAllowance(options.db, options.userId, now);
    throw new EmailChangeRequestError("send-failed");
  }

  return { sent: true, expiresAt };
}

function parseVerification(value: string): EmailChangeVerification | null {
  try {
    const parsed = JSON.parse(value) as Partial<EmailChangeVerification>;
    if (
      typeof parsed.email !== "string" ||
      typeof parsed.otpHash !== "string" ||
      typeof parsed.attempts !== "number"
    ) {
      return null;
    }
    return {
      email: parsed.email,
      otpHash: parsed.otpHash,
      attempts: parsed.attempts,
    };
  } catch {
    return null;
  }
}

export async function confirmEmailChange(
  options: ConfirmEmailChangeOptions,
): Promise<ConfirmEmailChangeResult> {
  const now = options.now ?? Date.now();
  const identifier = verificationIdentifier(options.userId);
  const submittedHash = await hashEmailOtp(
    options.secret,
    options.userId,
    options.newEmail,
    options.otp,
  );

  for (let contentionRetry = 0; contentionRetry <= OTP_MAX_ATTEMPTS; contentionRetry += 1) {
    const row = await options.db
      .prepare(
        `SELECT "id", "value", "expiresAt" FROM "verification"
         WHERE "identifier" = ? ORDER BY "createdAt" DESC LIMIT 1`,
      )
      .bind(identifier)
      .first<VerificationRow>();

    if (!row || new Date(row.expiresAt).getTime() <= now) {
      if (row) {
        await options.db
          .prepare(`DELETE FROM "verification" WHERE "id" = ?`)
          .bind(row.id)
          .run();
      }
      return { ok: false, reason: "expired" };
    }

    const verification = parseVerification(row.value);
    if (!verification) {
      await options.db
        .prepare(`DELETE FROM "verification" WHERE "id" = ? AND "value" = ?`)
        .bind(row.id, row.value)
        .run();
      return { ok: false, reason: "expired" };
    }

    if (
      verification.email !== options.newEmail ||
      !equalHex(verification.otpHash, submittedHash)
    ) {
      const nextAttempts = verification.attempts + 1;
      const result = nextAttempts >= OTP_MAX_ATTEMPTS
        ? await options.db
            .prepare(`DELETE FROM "verification" WHERE "id" = ? AND "value" = ?`)
            .bind(row.id, row.value)
            .run()
        : await options.db
            .prepare(
              `UPDATE "verification" SET "value" = ?, "updatedAt" = ?
               WHERE "id" = ? AND "value" = ?`,
            )
            .bind(
              JSON.stringify({ ...verification, attempts: nextAttempts }),
              new Date(now).toISOString(),
              row.id,
              row.value,
            )
            .run();
      if ((result.meta.changes ?? 0) === 0) continue;
      return {
        ok: false,
        reason: "invalid",
        attemptsRemaining: Math.max(0, OTP_MAX_ATTEMPTS - nextAttempts),
      };
    }

    if (await emailBelongsToAnotherUser(options.db, options.userId, options.newEmail)) {
      await options.db
        .prepare(`DELETE FROM "verification" WHERE "id" = ? AND "value" = ?`)
        .bind(row.id, row.value)
        .run();
      return { ok: false, reason: "in-use" };
    }

    try {
      const [updated, consumed] = await options.db.batch([
        options.db
          .prepare(
            `UPDATE "user" SET "email" = ?, "emailVerified" = 1, "updatedAt" = ?
             WHERE "id" = ? AND EXISTS (
               SELECT 1 FROM "verification" WHERE "id" = ? AND "value" = ?
             )`,
          )
          .bind(
            options.newEmail,
            new Date(now).toISOString(),
            options.userId,
            row.id,
            row.value,
          ),
        options.db
          .prepare(`DELETE FROM "verification" WHERE "id" = ? AND "value" = ?`)
          .bind(row.id, row.value),
      ]);
      const updatedCount = updated?.meta.changes ?? 0;
      const consumedCount = consumed?.meta.changes ?? 0;
      if (updatedCount === 1 && consumedCount === 1) return { ok: true };
      if (updatedCount === 0 && consumedCount === 0) continue;
      throw new Error("Email verification transaction produced an inconsistent result");
    } catch (error) {
      if (error instanceof Error && /unique|constraint/i.test(error.message)) {
        await options.db
          .prepare(`DELETE FROM "verification" WHERE "id" = ? AND "value" = ?`)
          .bind(row.id, row.value)
          .run();
        return { ok: false, reason: "in-use" };
      }
      throw error;
    }
  }

  return { ok: false, reason: "expired" };
}

export const EMAIL_CHANGE_POLICY = {
  otpLength: OTP_LENGTH,
  expiresSeconds: OTP_EXPIRES_MS / 1000,
  maxAttempts: OTP_MAX_ATTEMPTS,
  cooldownSeconds: SEND_COOLDOWN_MS / 1000,
  hourlyLimit: SEND_HOURLY_LIMIT,
  dailyLimit: SEND_DAILY_LIMIT,
} as const;
