import { useState } from "preact/hooks";
import { config } from "../../../config";
import { oauthQuery, providerReturnTo, request } from "../api";
import { Button, ErrorText, Layout, tabButtonClass } from "../components";

type LoginMethod = "token" | "email";

export default function Login() {
  const [method, setMethod] = useState<LoginMethod>("token");
  const [token, setToken] = useState("");
  const [email, setEmail] = useState("");
  const [otp, setOtp] = useState("");
  const [emailSent, setEmailSent] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  const emailEnabled = config.providers.email.enabled;
  const tokenEnabled = config.providers.seatable.enabled;
  const showTabs = emailEnabled && tokenEnabled;
  const active = showTabs ? method : emailEnabled ? "email" : "token";

  async function submit(event: Event) {
    event.preventDefault();
    setBusy(true); setError("");
    try {
      const query = new URLSearchParams(location.search);
      const result = await request<{ url: string }>("/sign-in/seatable", {
        token,
        ...(oauthQuery() ? { oauth_query: oauthQuery() } : {}),
        ...(query.get("return_to") ? { return_to: query.get("return_to") } : {}),
      });
      location.assign(result.url);
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "登录失败");
      setBusy(false);
    }
  }

  async function sendEmailOtp(event: Event) {
    event.preventDefault();
    setBusy(true); setError("");
    try {
      await request("/email-otp/send-verification-otp", { email, type: "sign-in" });
      setEmailSent(true);
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "发送失败");
    } finally {
      setBusy(false);
    }
  }

  async function signInEmail(event: Event) {
    event.preventDefault();
    setBusy(true); setError("");
    try {
      await request("/sign-in/email-otp", { email, otp, name: email });
      location.assign(providerReturnTo());
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "登录失败");
      setBusy(false);
    }
  }

  function switchMethod(next: LoginMethod) {
    setMethod(next);
    setError("");
  }

  return <Layout title="登录">
    {showTabs && <div class="mb-6 flex gap-1 rounded-lg border border-stone-200 bg-stone-100 p-1"
      role="tablist" aria-label="登录方式">
      <button type="button" role="tab" aria-selected={active === "token"} class={tabButtonClass(active === "token")}
        onClick={() => switchMethod("token")}>Token 登录</button>
      <button type="button" role="tab" aria-selected={active === "email"} class={tabButtonClass(active === "email")}
        onClick={() => switchMethod("email")}>邮箱登录</button>
    </div>}
    {active === "email" && emailEnabled && <form class="space-y-4" onSubmit={emailSent ? signInEmail : sendEmailOtp}>
      <div>
        <label class="mb-1.5 block text-sm font-medium text-stone-700" htmlFor="email_login_field">南京大学邮箱</label>
        <div class="flex items-center gap-2">
          <input id="email_login_field" class="min-w-0 flex-1" required type="email" autocomplete="email"
            value={email} disabled={emailSent} autofocus
            onInput={(event) => setEmail(event.currentTarget.value)} />
          {emailSent && <input class="w-28 shrink-0" required inputMode="numeric" autocomplete="one-time-code"
            maxLength={6} placeholder="验证码" value={otp}
            onInput={(event) => setOtp(event.currentTarget.value)} />}
        </div>
      </div>
      <Button type="submit" variant="primary" class="w-full" disabled={busy}>{emailSent ? "登录" : "发送验证码"}</Button>
    </form>}
    {active === "token" && tokenEnabled && <form class="space-y-4" onSubmit={submit}>
      <div>
        <label class="mb-1.5 block text-sm font-medium text-stone-700" htmlFor="token_field">Token</label>
        <input id="token_field" class="w-full" required type="password" autocomplete="off" autofocus value={token}
          onInput={(event) => setToken(event.currentTarget.value)} />
      </div>
      <Button type="submit" variant="primary" class="w-full" disabled={busy}>登录</Button>
      <p class="text-sm text-stone-500">
        还没有 Token？
        <a href="https://table.nju.edu.cn/apps/custom/authserver/"
          target="_blank" rel="noopener noreferrer">点击此处获取</a>
      </p>
    </form>}
    <ErrorText value={error} />
    {config.providers.discourse.enabled && <div class="mt-6">
      <div class="mb-3 flex items-center gap-3 text-xs text-stone-400">
        <span>其他认证方式</span>
        <span class="h-px flex-1 bg-stone-200"></span>
      </div>
      <a class="block w-full rounded-lg border border-stone-300 bg-white px-4 py-2.5 text-center text-sm font-medium text-stone-800 shadow-sm transition-colors hover:bg-stone-50"
        href={`/sign-in/discourse?return_to=${encodeURIComponent(providerReturnTo())}`}>
        使用 Discourse 登录
      </a>
    </div>}
  </Layout>;
}
