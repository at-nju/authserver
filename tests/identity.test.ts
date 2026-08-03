import { readFileSync, readdirSync } from "node:fs";
import { DatabaseSync } from "node:sqlite";
import { describe, expect, it } from "vitest";
import { resolveIdentity } from "../src/providers/identity";

function database() {
  const sqlite = new DatabaseSync(":memory:");
  for (const file of readdirSync("migrations").filter((name) => name.endsWith(".sql")).sort()) {
    sqlite.exec(readFileSync(`migrations/${file}`, "utf8"));
  }
  const db = {
    prepare(sql: string) {
      const statement = sqlite.prepare(sql);
      let values: any[] = [];
      return {
        bind(...next: any[]) { values = next; return this; },
        async first<T>() { return statement.get(...values) as T | null; },
        async run() { return statement.run(...values); },
      };
    },
  } as unknown as D1Database;
  return { sqlite, db };
}

describe("identity resolution", () => {
  it("creates a random subject and reuses the provider binding", async () => {
    const { sqlite, db } = database();
    const users = new Map<string, any>();
    const ctx = { context: { internalAdapter: {
      findUserById: async (id: string) => users.get(id) ?? null,
      findUserByEmail: async () => null,
      createUser: async (user: any) => {
        users.set(user.id, user);
        const now = new Date().toISOString();
        sqlite.prepare(
          "insert into user (id, name, email, emailVerified, createdAt, updatedAt, onboardingCompleted) values (?, ?, ?, ?, ?, ?, ?)",
        ).run(user.id, user.name, user.email, Number(user.emailVerified), now, now, Number(user.onboardingCompleted));
        return user;
      },
    } } };
    const identity = {
      providerId: "seatable",
      accountId: "student",
      name: "Student",
      email: "student@smail.nju.edu.cn",
      emailVerified: false,
    };

    const first = await resolveIdentity(ctx, db, identity, "allow");
    const second = await resolveIdentity(ctx, db, identity, "allow");

    expect(first.id).toMatch(/^[0-9a-f-]{36}$/);
    expect(first.id).not.toBe("student");
    expect(second.id).toBe(first.id);
    expect(sqlite.prepare("select userId from account where providerId = 'seatable'").get()).toMatchObject({ userId: first.id });
    sqlite.close();
  });
});
