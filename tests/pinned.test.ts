import { createHash } from "node:crypto";
import { readFileSync, readdirSync } from "node:fs";
import { DatabaseSync } from "node:sqlite";
import { afterEach, describe, expect, it, vi } from "vitest";
import worker from "../src/worker";
import { sharedEmail } from "../src/pinned";

const { mailSend } = vi.hoisted(() => ({ mailSend: vi.fn() }));
vi.mock("worker-mailer", () => ({ WorkerMailer: { send: mailSend } }));
afterEach(() => {
  vi.unstubAllGlobals();
  mailSend.mockReset();
});

type D1Like = {
  AUTH_DB: D1Database;
  ASSETS: Fetcher;
  BETTER_AUTH_SECRET: string;
  SEATABLE_API_TOKEN: string;
  SMTP_PASSWORD: string;
};

function d1(db: DatabaseSync): D1Database {
  const prepare = (sql: string) => {
    const bind = (...args: unknown[]) => {
      const params = args as never[];
      const execute = () => {
        const stmt = db.prepare(sql);
        if (stmt.columns().length > 0) {
          return { success: true, meta: {}, results: stmt.all(...params) as unknown[] };
        }
        const { changes, lastInsertRowid } = stmt.run(...params);
        return {
          success: true,
          meta: { changes: Number(changes), last_row_id: Number(lastInsertRowid) },
          results: [],
        };
      };
      return {
        async first<T>(): Promise<T | null> {
          const row = db.prepare(sql).get(...params);
          return (row ?? null) as T | null;
        },
        async run() {
          return execute();
        },
        async all<T>(): Promise<{ success: boolean; meta: Record<string, unknown>; results: T[] }> {
          return execute() as { success: boolean; meta: Record<string, unknown>; results: T[] };
        },
      };
    };
    return { bind };
  };
  return {
    prepare,
    exec: (sql: string) => db.exec(sql),
    batch: (statements: Array<{ execute: () => Promise<unknown> }>) =>
      Promise.all(statements.map((statement) => statement.execute())),
  } as unknown as D1Database;
}

function envFor(db: DatabaseSync): D1Like {
  return {
    AUTH_DB: d1(db),
    ASSETS: {} as Fetcher,
    BETTER_AUTH_SECRET: "test-secret-test-secret-test-secret",
    SEATABLE_API_TOKEN: "app-token",
    SMTP_PASSWORD: "unused",
  };
}

function loadMigrations(db: DatabaseSync) {
  for (const file of readdirSync("migrations").filter((name) => name.endsWith(".sql")).sort()) {
    db.exec(readFileSync(`migrations/${file}`, "utf8"));
  }
}

async function run(env: D1Like, request: Request): Promise<Response> {
  return (worker as { fetch: (request: Request, env: D1Like) => Promise<Response> }).fetch(request, env);
}

async function login(env: D1Like, origin: string): Promise<string> {
  const response = await run(env, new Request(`${origin}/sign-in/seatable`, {
    method: "POST",
    headers: { Origin: origin, "Content-Type": "application/json" },
    body: JSON.stringify({ token: "user-token", return_to: "/console" }),
  }));
  expect(response.status).toBe(200);
  const cookie = response.headers.get("set-cookie")?.split(";", 1)[0];
  expect(cookie).toBeTruthy();
  return cookie!;
}

describe("pinned account", () => {
  it("returns the same shared account for every authentication while the client is pinned", async () => {
    const db = new DatabaseSync(":memory:");
    loadMigrations(db);
    const env = envFor(db);
    const origin = "http://local.test";
    vi.stubGlobal("fetch", vi.fn((input: RequestInfo | URL) => {
      const url = String(input);
      if (url.includes("app-access-token")) {
        return Promise.resolve(Response.json({ access_token: "base-token", dtable_uuid: "base-id" }));
      }
      return Promise.resolve(Response.json({ results: [{ ID: "student" }] }));
    }));

    const cookie = await login(env, origin);
    const headers = { Cookie: cookie, Origin: origin, "Content-Type": "application/json" };
    const signedIn = await run(env, new Request(`${origin}/get-session`, { headers }));
    const signedInUserId = (await signedIn.json() as { user: { id: string } }).user.id;

    const created = await run(env, new Request(`${origin}/oauth2/create-client`, {
      method: "POST",
      headers,
      body: JSON.stringify({
        client_name: "Pinned App",
        redirect_uris: ["http://127.0.0.1/callback"],
        token_endpoint_auth_method: "none",
        grant_types: ["authorization_code"],
        response_types: ["code"],
        type: "user-agent-based",
      }),
    }));
    const client = await created.json() as { client_id: string };
    expect(client.client_id).toBeTruthy();

    const pinned = await run(env, new Request(`${origin}/oauth2/set-pinned-account`, {
      method: "POST",
      headers,
      body: JSON.stringify({ client_id: client.client_id, pinned: true }),
    }));
    expect(pinned.status).toBe(200);

    const pinnedRow = db.prepare("SELECT pinnedUserId FROM oauthClient WHERE clientId = ?").get(client.client_id) as { pinnedUserId: string };
    const svcId = pinnedRow.pinnedUserId;
    expect(svcId).toMatch(/^[0-9a-f-]{36}$/);
    const userRow = db.prepare("SELECT id, name, email, emailVerified FROM user WHERE id = ?").get(svcId) as Record<string, unknown>;
    expect(userRow).toMatchObject({
      id: svcId,
      name: "Pinned App",
      email: sharedEmail(client.client_id),
      emailVerified: 1,
    });
    const clientRow = db.prepare("SELECT pinnedUserId, skipConsent FROM oauthClient WHERE clientId = ?")
      .get(client.client_id) as Record<string, unknown>;
    expect(clientRow.pinnedUserId).toBe(svcId);
    expect(clientRow.skipConsent).toBe(1);

    const verifier = "abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789-._~";
    const challenge = createHash("sha256").update(verifier).digest("base64url");
    const authorizeUrl = new URL(`${origin}/oauth2/authorize`);
    authorizeUrl.search = new URLSearchParams({
      client_id: client.client_id,
      redirect_uri: "http://127.0.0.1/callback",
      response_type: "code",
      scope: "openid profile email",
      state: "state",
      code_challenge: challenge,
      code_challenge_method: "S256",
    }).toString();
    const authorize = await run(env, new Request(authorizeUrl, { headers }));
    const callback = new URL(authorize.headers.get("location")!);
    expect(callback.searchParams.get("state")).toBe("state");
    expect(callback.searchParams.get("code")).toBeTruthy();

    const session = await run(env, new Request(`${origin}/get-session`, { headers }));
    expect(await session.json()).toMatchObject({ user: { id: signedInUserId } });

    const exchange = async (code: string) => {
      const token = await run(env, new Request(`${origin}/oauth2/token`, {
        method: "POST",
        headers: { "Content-Type": "application/x-www-form-urlencoded" },
        body: new URLSearchParams({
          grant_type: "authorization_code",
          code,
          redirect_uri: "http://127.0.0.1/callback",
          client_id: client.client_id,
          code_verifier: verifier,
        }),
      }));
      expect(token.status).toBe(200);
      const { access_token } = await token.json() as { access_token: string };
      const userinfo = await run(env, new Request(`${origin}/oauth2/userinfo`, {
        headers: { Authorization: `Bearer ${access_token}` },
      }));
      return userinfo.json() as Promise<Record<string, unknown>>;
    };

    expect(await exchange(callback.searchParams.get("code")!)).toMatchObject({
      sub: svcId,
      name: "Pinned App",
      email: sharedEmail(client.client_id),
      email_verified: true,
    });

    const renamed = await run(env, new Request(`${origin}/oauth2/update-client`, {
      method: "POST",
      headers,
      body: JSON.stringify({ client_id: client.client_id, update: { client_name: "Renamed App" } }),
    }));
    expect(renamed.status).toBe(200);
    const code2 = new URL((await run(env, new Request(authorizeUrl, { headers }))).headers.get("location")!)
      .searchParams.get("code")!;
    expect(await exchange(code2)).toMatchObject({ sub: svcId, name: "Renamed App" });

    const unpinned = await run(env, new Request(`${origin}/oauth2/set-pinned-account`, {
      method: "POST",
      headers,
      body: JSON.stringify({ client_id: client.client_id, pinned: false }),
    }));
    expect(unpinned.status).toBe(200);
    const code3 = new URL((await run(env, new Request(authorizeUrl, { headers }))).headers.get("location")!)
      .searchParams.get("code")!;
    expect(await exchange(code3)).toMatchObject({ sub: signedInUserId });

    db.close();
  });

  it("requires a login and ownership before pinning", async () => {
    const db = new DatabaseSync(":memory:");
    loadMigrations(db);
    const env = envFor(db);
    const origin = "http://local2.test";
    let userId = "student";
    vi.stubGlobal("fetch", vi.fn((input: RequestInfo | URL) => {
      const url = String(input);
      if (url.includes("app-access-token")) {
        return Promise.resolve(Response.json({ access_token: "base-token", dtable_uuid: "base-id" }));
      }
      return Promise.resolve(Response.json({ results: [{ ID: userId }] }));
    }));

    const studentCookie = await login(env, origin);
    const studentHeaders = { Cookie: studentCookie, Origin: origin, "Content-Type": "application/json" };
    const created = await run(env, new Request(`${origin}/oauth2/create-client`, {
      method: "POST",
      headers: studentHeaders,
      body: JSON.stringify({
        client_name: "Owner App",
        redirect_uris: ["http://127.0.0.1/callback"],
        token_endpoint_auth_method: "none",
        grant_types: ["authorization_code"],
        response_types: ["code"],
        type: "user-agent-based",
      }),
    }));
    const client = await created.json() as { client_id: string };

    userId = "other";
    const otherCookie = await login(env, origin);
    const otherHeaders = { Cookie: otherCookie, Origin: origin, "Content-Type": "application/json" };
    const forbidden = await run(env, new Request(`${origin}/oauth2/set-pinned-account`, {
      method: "POST",
      headers: otherHeaders,
      body: JSON.stringify({ client_id: client.client_id, pinned: true }),
    }));
    expect(forbidden.status).toBe(401);

    const anonymous = await run(env, new Request(`${origin}/oauth2/set-pinned-account`, {
      method: "POST",
      headers: { Origin: "http://local.test", "Content-Type": "application/json" },
      body: JSON.stringify({ client_id: client.client_id, pinned: true }),
    }));
    expect(anonymous.status).toBe(401);

    const row = db.prepare("SELECT pinnedUserId FROM oauthClient WHERE clientId = ?")
      .get(client.client_id) as Record<string, unknown> | undefined;
    expect(row?.pinnedUserId ?? null).toBeNull();

    db.close();
  });
});
