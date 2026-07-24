import { Hono, type Context, type Next } from "hono";
import type { Auth, AuthSession } from "./auth";
import {
  confirmEmailChange,
  EmailChangeRequestError,
  EmailSendRateLimitError,
  startEmailChange,
} from "./email_change";
import { normalizeNjuEmail } from "./email_policy";
import type { Env } from "./env";
import {
  appsPage,
  emailSettingsPage,
  editAppPage,
  newAppPage,
  secretRevealPage,
  type OAuthClientView,
} from "./console_views";
import { isEmailDeliveryConfigured, sendVerificationEmail } from "./smtp";
import { loginPage } from "./views";

const LOGIN_TITLE = "管理后台登录";
const LOGIN_SUBTITLE = "登录以管理你的 OIDC 应用，请粘贴你的 Token 以继续。";

type Session = NonNullable<AuthSession>;
export type AppVariables = { auth: Auth; session: Session };
type AppContext = Context<{ Bindings: Env; Variables: AppVariables }>;

const app = new Hono<{ Bindings: Env; Variables: AppVariables }>();

function userLabel(session: Session): string {
  return session.user.name || session.user.id;
}

function consoleLoginPage(error?: string): string {
  return loginPage({
    action: "/login",
    title: LOGIN_TITLE,
    subtitle: LOGIN_SUBTITLE,
    hidden: { return_to: "/console/apps" },
    error,
  });
}

export function normalizeUris(raw: string): string[] | null {
  const lines = raw
    .split(/\r?\n/)
    .map((value) => value.trim())
    .filter(Boolean);
  if (!lines.length) return null;
  for (const value of lines) {
    try {
      const url = new URL(value);
      if (url.protocol !== "https:" && url.protocol !== "http:") return null;
    } catch {
      return null;
    }
  }
  return [...new Set(lines)];
}

async function requireSession(c: AppContext, next: Next) {
  const session = await c.get("auth").api.getSession({ headers: c.req.raw.headers });
  if (!session) return c.redirect("/console/login");
  c.set("session", session);
  return next();
}

async function getOwnedClient(c: AppContext, clientId: string): Promise<OAuthClientView | null> {
  try {
    return (await c.get("auth").api.getOAuthClient({
      headers: c.req.raw.headers,
      query: { client_id: clientId },
    })) as OAuthClientView;
  } catch {
    return null;
  }
}

function emailPage(
  c: AppContext,
  options: {
    pendingEmail?: string;
    error?: string;
    notice?: string;
    success?: string;
  } = {},
  status: 200 | 400 | 429 | 503 = 200,
) {
  const session = c.get("session");
  return c.html(
    emailSettingsPage({
      userLabel: userLabel(session),
      currentEmail: session.user.email,
      smtpConfigured: isEmailDeliveryConfigured(c.env),
      ...options,
    }),
    status,
  );
}

app.get("/", (c) => c.redirect("/console/apps"));
app.get("/login", (c) => c.html(consoleLoginPage()));

app.post("/logout", async (c) => {
  const response = await c.get("auth").api.signOut({
    headers: c.req.raw.headers,
    asResponse: true,
  });
  const headers = new Headers(response.headers);
  headers.set("Location", "/console/login");
  return new Response(null, { status: 302, headers });
});

app.get("/apps", requireSession, async (c) => {
  const session = c.get("session");
  const clients =
    ((await c.get("auth").api.getOAuthClients({ headers: c.req.raw.headers })) as
      | OAuthClientView[]
      | null) ?? [];
  return c.html(appsPage(userLabel(session), session.user.email, clients));
});

app.get("/account/email", requireSession, (c) =>
  emailPage(
    c,
    c.req.query("updated") === "1"
      ? { success: "邮箱已更新，后续签发的 OIDC Token 将使用新邮箱。" }
      : {},
  ),
);

app.post("/account/email/send", requireSession, async (c) => {
  const session = c.get("session");
  if (!isEmailDeliveryConfigured(c.env)) {
    return emailPage(c, { error: "邮件发送服务尚未配置。" }, 503);
  }

  const form = Object.fromEntries(await c.req.formData()) as Record<string, string>;
  const normalized = normalizeNjuEmail(form.new_email ?? "");
  if (!normalized.ok) return emailPage(c, { error: normalized.message }, 400);

  try {
    await startEmailChange({
      db: c.env.AUTH_DB,
      userId: session.user.id,
      currentEmail: session.user.email,
      newEmail: normalized.email,
      secret: c.env.CONSOLE_SESSION_SECRET,
      send: (email, otp) => sendVerificationEmail(c.env, email, otp),
    });
  } catch (error) {
    if (error instanceof EmailSendRateLimitError) {
      const minutes = Math.ceil(error.retryAfterSeconds / 60);
      return emailPage(
        c,
        { error: `发送过于频繁，请约 ${minutes} 分钟后再试。` },
        429,
      );
    }
    if (error instanceof EmailChangeRequestError) {
      return emailPage(
        c,
        {
          error:
            error.code === "same-email"
              ? "新邮箱与当前邮箱相同。"
              : "验证码邮件发送失败，请稍后重试。",
        },
        error.code === "same-email" ? 400 : 503,
      );
    }
    throw error;
  }

  return emailPage(c, {
    pendingEmail: normalized.email,
    notice: "如果该邮箱可用，验证码已经发送。请在 10 分钟内完成验证。",
  });
});

app.post("/account/email/confirm", requireSession, async (c) => {
  const session = c.get("session");
  const form = Object.fromEntries(await c.req.formData()) as Record<string, string>;
  const normalized = normalizeNjuEmail(form.new_email ?? "");
  if (!normalized.ok) return emailPage(c, { error: normalized.message }, 400);
  const otp = (form.otp ?? "").trim();
  if (!/^\d{6}$/.test(otp)) {
    return emailPage(
      c,
      { pendingEmail: normalized.email, error: "请输入 6 位数字验证码。" },
      400,
    );
  }

  const result = await confirmEmailChange({
    db: c.env.AUTH_DB,
    userId: session.user.id,
    newEmail: normalized.email,
    otp,
    secret: c.env.CONSOLE_SESSION_SECRET,
  });
  if (result.ok) return c.redirect("/console/account/email?updated=1");

  if (result.reason === "invalid") {
    const suffix = result.attemptsRemaining
      ? `，还可尝试 ${result.attemptsRemaining} 次`
      : "，该验证码已失效";
    return emailPage(
      c,
      {
        pendingEmail: normalized.email,
        error: `验证码不正确${suffix}。`,
      },
      400,
    );
  }
  return emailPage(
    c,
    {
      pendingEmail: normalized.email,
      error:
        result.reason === "in-use"
          ? "该邮箱已被其他账号使用。"
          : "验证码已过期或已使用，请重新发送。",
    },
    400,
  );
});

app.get("/apps/new", requireSession, (c) =>
  c.html(newAppPage(userLabel(c.get("session")))),
);

app.post("/apps", requireSession, async (c) => {
  const session = c.get("session");
  const form = Object.fromEntries(await c.req.formData()) as Record<string, string>;
  const name = (form.name ?? "").trim();
  const redirectUris = normalizeUris(form.redirect_uris ?? "");
  if (!name || !redirectUris) {
    return c.html(
      newAppPage(userLabel(session), "名称不能为空，回调地址需为合法的 HTTP(S) URL（每行一个）。"),
      400,
    );
  }

  const isConfidential = form.type === "confidential";
  const client = await c.get("auth").api.createOAuthClient({
    headers: c.req.raw.headers,
    body: {
      client_name: name,
      redirect_uris: redirectUris,
      scope: "openid profile email offline_access",
      token_endpoint_auth_method: isConfidential ? "client_secret_basic" : "none",
      grant_types: ["authorization_code", "refresh_token"],
      response_types: ["code"],
      type: isConfidential ? "web" : "native",
    },
  });

  if (client.client_secret) {
    return c.html(
      secretRevealPage(userLabel(session), client.client_id, client.client_secret, true),
    );
  }
  return c.redirect(`/console/apps/${encodeURIComponent(client.client_id)}`);
});

app.get("/apps/:id", requireSession, async (c) => {
  const client = await getOwnedClient(c, c.req.param("id") ?? "");
  if (!client) return c.text("应用不存在或无权访问。", 404);
  return c.html(editAppPage(userLabel(c.get("session")), client));
});

app.post("/apps/:id", requireSession, async (c) => {
  const clientId = c.req.param("id") ?? "";
  const client = await getOwnedClient(c, clientId);
  if (!client) return c.text("应用不存在或无权访问。", 404);

  const form = Object.fromEntries(await c.req.formData()) as Record<string, string>;
  const name = (form.name ?? "").trim();
  const redirectUris = normalizeUris(form.redirect_uris ?? "");
  if (!name || !redirectUris) {
    return c.html(
      editAppPage(
        userLabel(c.get("session")),
        client,
        "名称不能为空，回调地址需为合法的 HTTP(S) URL（每行一个）。",
      ),
      400,
    );
  }

  await c.get("auth").api.updateOAuthClient({
    headers: c.req.raw.headers,
    body: {
      client_id: clientId,
      update: { client_name: name, redirect_uris: redirectUris },
    },
  });
  return c.redirect(`/console/apps/${encodeURIComponent(clientId)}`);
});

app.post("/apps/:id/secret", requireSession, async (c) => {
  const clientId = c.req.param("id") ?? "";
  const client = await getOwnedClient(c, clientId);
  if (!client || client.token_endpoint_auth_method === "none") {
    return c.text("应用不存在、无权访问，或不是机密客户端。", 404);
  }
  const updated = (await c.get("auth").api.rotateClientSecret({
    headers: c.req.raw.headers,
    body: { client_id: clientId },
  })) as unknown as OAuthClientView & { client_secret?: string };
  if (!updated.client_secret) return c.text("密钥轮换失败。", 500);
  return c.html(
    secretRevealPage(userLabel(c.get("session")), clientId, updated.client_secret, false),
  );
});

app.post("/apps/:id/delete", requireSession, async (c) => {
  const clientId = c.req.param("id") ?? "";
  if (!(await getOwnedClient(c, clientId))) return c.text("应用不存在或无权访问。", 404);
  await c.get("auth").api.deleteOAuthClient({
    headers: c.req.raw.headers,
    body: { client_id: clientId },
  });
  return c.redirect("/console/apps");
});

export default app;
