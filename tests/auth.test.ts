import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { DatabaseSync } from "node:sqlite";
import { afterEach, describe, expect, it, vi } from "vitest";
import { createAuth, type Bindings } from "../src/auth";

const { mailSend } = vi.hoisted(() => ({ mailSend: vi.fn() }));
vi.mock("worker-mailer", () => ({ WorkerMailer: { send: mailSend } }));

afterEach(() => {
  vi.unstubAllGlobals();
  mailSend.mockReset();
});

describe("authentication flow", () => {
  it("creates the default profile, session, and an OIDC client", async () => {
    const db = new DatabaseSync(":memory:");
    db.exec(readFileSync("migrations/0001_auth.sql", "utf8"));
    const env = {
      AUTH_DB: db as unknown as D1Database,
      ASSETS: {} as Fetcher,
      BETTER_AUTH_SECRET: "test-secret-test-secret-test-secret",
      SEATABLE_API_TOKEN: "app-token",
      SMTP_PASSWORD: "unused",
    } satisfies Bindings;
    const auth = createAuth(env, "http://local.test");

    vi.stubGlobal("fetch", vi.fn()
      .mockResolvedValueOnce(Response.json({ access_token: "base-token", dtable_uuid: "base-id" }))
      .mockResolvedValueOnce(Response.json({ results: [{ ID: "student" }] })));

    const blocked = await auth.handler(new Request("http://local.test/sign-in/seatable", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "Sec-Fetch-Site": "cross-site",
        "Sec-Fetch-Mode": "navigate",
        "Sec-Fetch-Dest": "document",
      },
      body: JSON.stringify({ token: "user-token" }),
    }));
    expect(blocked.status).toBe(403);

    const login = await auth.handler(new Request("http://local.test/sign-in/seatable", {
      method: "POST",
      headers: { Origin: "http://local.test", "Content-Type": "application/json" },
      body: JSON.stringify({ token: "user-token", return_to: "/console" }),
    }));
    expect(login.status).toBe(200);
    expect(await login.clone().json()).toMatchObject({
      url: "/onboarding?return_to=%2Fconsole",
    });

    const cookie = login.headers.get("set-cookie")?.split(";", 1)[0];
    expect(cookie).toBeTruthy();
    const headers = { Cookie: cookie!, Origin: "http://local.test", "Content-Type": "application/json" };

    const session = await auth.handler(new Request("http://local.test/get-session", { headers }));
    expect(await session.json()).toMatchObject({
      user: {
        id: "student",
        name: "student",
        email: "student@smail.nju.edu.cn",
        emailVerified: false,
        onboardingCompleted: false,
      },
    });

    const requestEmail = await auth.handler(new Request("http://local.test/email-otp/request-email-change", {
      method: "POST",
      headers,
      body: JSON.stringify({ newEmail: "verified@example.com" }),
    }));
    expect(requestEmail.status).toBe(200);
    const message = mailSend.mock.calls[0]?.[1] as { text: string };
    const otp = message.text.match(/\d{6}/)?.[0];
    expect(otp).toBeTruthy();

    const changeEmail = await auth.handler(new Request("http://local.test/email-otp/change-email", {
      method: "POST",
      headers,
      body: JSON.stringify({ newEmail: "verified@example.com", otp }),
    }));
    expect(changeEmail.status).toBe(200);

    const update = await auth.handler(new Request("http://local.test/update-user", {
      method: "POST",
      headers,
      body: JSON.stringify({ name: "Student Name", onboardingCompleted: true }),
    }));
    expect(update.status).toBe(200);

    const client = await auth.handler(new Request("http://local.test/oauth2/create-client", {
      method: "POST",
      headers,
      body: JSON.stringify({
        client_name: "Test Client",
        redirect_uris: ["http://127.0.0.1/callback"],
        token_endpoint_auth_method: "none",
        grant_types: ["authorization_code"],
        response_types: ["code"],
        type: "user-agent-based",
      }),
    }));
    expect(client.status).toBe(200);
    const clientBody = await client.json() as {
      client_id: string;
      client_name: string;
      token_endpoint_auth_method: string;
    };
    expect(clientBody).toMatchObject({
      client_name: "Test Client",
      token_endpoint_auth_method: "none",
    });

    const verifier = "abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789-._~";
    const challenge = createHash("sha256").update(verifier).digest("base64url");
    const authorizeUrl = new URL("http://local.test/oauth2/authorize");
    authorizeUrl.search = new URLSearchParams({
      client_id: clientBody.client_id,
      redirect_uri: "http://127.0.0.1/callback",
      response_type: "code",
      scope: "openid profile email",
      state: "state",
      code_challenge: challenge,
      code_challenge_method: "S256",
    }).toString();
    const authorize = await auth.handler(new Request(authorizeUrl, { headers }));
    const authorizeLocation = authorize.headers.get("location")
      ?? (await authorize.json() as { url: string }).url;
    expect(authorizeLocation).toContain("/consent?");

    const consentQuery = new URL(authorizeLocation, "http://local.test").search.slice(1);
    const consent = await auth.handler(new Request("http://local.test/oauth2/consent", {
      method: "POST",
      headers,
      body: JSON.stringify({ accept: true, oauth_query: consentQuery }),
    }));
    const consentLocation = consent.headers.get("location")
      ?? (await consent.json() as { url: string }).url;
    const callback = new URL(consentLocation);
    expect(callback.searchParams.get("state")).toBe("state");

    const token = await auth.handler(new Request("http://local.test/oauth2/token", {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({
        grant_type: "authorization_code",
        code: callback.searchParams.get("code")!,
        redirect_uri: "http://127.0.0.1/callback",
        client_id: clientBody.client_id,
        code_verifier: verifier,
      }),
    }));
    expect(token.status).toBe(200);
    const tokenBody = await token.json() as { access_token: string; id_token: string };
    expect(tokenBody.id_token).toBeTruthy();

    const userinfo = await auth.handler(new Request("http://local.test/oauth2/userinfo", {
      headers: { Authorization: `Bearer ${tokenBody.access_token}` },
    }));
    expect(await userinfo.json()).toMatchObject({
      sub: "student",
      name: "Student Name",
      email: "verified@example.com",
      email_verified: true,
    });

    const updateClient = await auth.handler(new Request("http://local.test/oauth2/update-client", {
      method: "POST",
      headers,
      body: JSON.stringify({
        client_id: clientBody.client_id,
        update: {
          client_name: "Updated Client",
          redirect_uris: ["http://127.0.0.1/updated"],
        },
      }),
    }));
    expect(updateClient.status).toBe(200);

    const confidential = await auth.handler(new Request("http://local.test/oauth2/create-client", {
      method: "POST",
      headers,
      body: JSON.stringify({
        client_name: "Confidential Client",
        redirect_uris: ["https://client.example/callback"],
        token_endpoint_auth_method: "client_secret_basic",
        grant_types: ["authorization_code"],
        response_types: ["code"],
        type: "web",
      }),
    }));
    const confidentialBody = await confidential.json() as { client_id: string; client_secret: string };
    expect(confidentialBody.client_secret).toBeTruthy();

    const rotated = await auth.handler(new Request("http://local.test/oauth2/client/rotate-secret", {
      method: "POST",
      headers,
      body: JSON.stringify({ client_id: confidentialBody.client_id }),
    }));
    const rotatedBody = await rotated.json() as { client_secret: string };
    expect(rotatedBody.client_secret).not.toBe(confidentialBody.client_secret);

    const removed = await auth.handler(new Request("http://local.test/oauth2/delete-client", {
      method: "POST",
      headers,
      body: JSON.stringify({ client_id: confidentialBody.client_id }),
    }));
    expect(removed.status).toBe(200);

    const clients = await auth.handler(new Request("http://local.test/oauth2/get-clients", { headers }));
    expect(await clients.json()).toEqual([
      expect.objectContaining({
        client_id: clientBody.client_id,
        client_name: "Updated Client",
        redirect_uris: ["http://127.0.0.1/updated"],
      }),
    ]);

    db.close();
  });
});
