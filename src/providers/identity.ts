import { APIError } from "better-auth/api";
import type { RegistrationPolicy } from "./types";
import { registrationAllowed } from "./types";

export type ExternalIdentity = {
  providerId: string;
  accountId: string;
  name: string;
  email: string;
  emailVerified: boolean;
};

type AuthContext = {
  context: {
    internalAdapter: {
      findUserById(id: string): Promise<any>;
      findUserByEmail(email: string): Promise<any>;
      createUser(user: Record<string, unknown>): Promise<any>;
    };
  };
};

async function first<T>(db: D1Database, sql: string, values: unknown[]) {
  const statement = db.prepare(sql) as any;
  return statement.bind
    ? await statement.bind(...values).first() as T | null
    : statement.get(...values) as T | null;
}

async function run(db: D1Database, sql: string, values: unknown[]) {
  const statement = db.prepare(sql) as any;
  return statement.bind ? statement.bind(...values).run() : statement.run(...values);
}

export async function resolveIdentity(
  ctx: AuthContext,
  db: D1Database,
  identity: ExternalIdentity,
  registration: RegistrationPolicy,
  linkUserId?: string,
) {
  const account = await first<{ userId: string }>(
    db,
    "SELECT userId FROM account WHERE providerId = ? AND accountId = ?",
    [identity.providerId, identity.accountId],
  );

  if (account) {
    if (linkUserId && account.userId !== linkUserId) {
      throw new APIError("CONFLICT", { message: "此登录方式已绑定其他账户" });
    }
    return ctx.context.internalAdapter.findUserById(account.userId);
  }

  let user = linkUserId
    ? await ctx.context.internalAdapter.findUserById(linkUserId)
    : identity.emailVerified
      ? (await ctx.context.internalAdapter.findUserByEmail(identity.email))?.user
      : null;

  if (!user && !registrationAllowed(registration, identity.email)) {
    throw new APIError("FORBIDDEN", { message: "不允许使用此身份注册" });
  }

  user ??= await ctx.context.internalAdapter.createUser({
    id: crypto.randomUUID(),
    name: identity.name,
    email: identity.email,
    emailVerified: identity.emailVerified,
    onboardingCompleted: false,
  });

  const now = new Date().toISOString();
  await run(
    db,
    "INSERT INTO account (id, accountId, providerId, userId, createdAt, updatedAt) VALUES (?, ?, ?, ?, ?, ?)",
    [crypto.randomUUID(), identity.accountId, identity.providerId, user.id, now, now],
  );
  return user;
}

export async function ensureEmailAccount(db: D1Database, userId: string, email: string) {
  const normalized = email.trim().toLowerCase();
  const now = new Date().toISOString();
  await run(
    db,
    "INSERT OR IGNORE INTO account (id, accountId, providerId, userId, createdAt, updatedAt) VALUES (?, ?, 'email', ?, ?, ?)",
    [crypto.randomUUID(), normalized, userId, now, now],
  );
}
