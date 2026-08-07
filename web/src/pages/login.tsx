import { useState } from "preact/hooks";
import { config } from "../../../config";
import { oauthQuery, providerReturnTo, request } from "../api";
import { Button, ErrorText, Layout } from "../components";

export default function Login() {
  const [token, setToken] = useState("");
  const [email, setEmail] = useState("");
  const [otp, setOtp] = useState("");
  const [emailSent, setEmailSent] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

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

  return <Layout title="登录">
    {config.providers.email.enabled && <form class="mb-5" onSubmit={emailSent ? signInEmail : sendEmailOtp}>
      <label class="text-sm" htmlFor="email_login_field">南京大学邮箱</label>
      <div class="flex items-center justify-between gap-2">
        <input id="email_login_field" class="w-full" required type="email" autocomplete="email"
          value={email} disabled={emailSent}
          onInput={(event) => setEmail(event.currentTarget.value)} />
        {emailSent && <input class="w-28" required inputMode="numeric" autocomplete="one-time-code"
          maxLength={6} placeholder="验证码" value={otp}
          onInput={(event) => setOtp(event.currentTarget.value)} />}
        <Button variant="neutral" class="shrink-0" disabled={busy}>{emailSent ? "登录" : "发送验证码"}</Button>
      </div>
    </form>}
    {config.providers.seatable.enabled && <form onSubmit={submit}>
    <label class="text-sm" htmlFor="token_field">Token</label>
    <div class="flex items-center justify-between gap-2">
      <input id="token_field" class="w-full rounded-md border border-neutral-400 p-1"
        required type="password" autocomplete="off" autofocus value={token}
        onInput={(event) => setToken(event.currentTarget.value)} />
      <Button variant="neutral" class="shrink-0" disabled={busy}>登录</Button>
    </div>
    <p class="mt-2 text-neutral-500 text-sm">
      还没有 Token？
      <a href="https://table.nju.edu.cn/apps/custom/authserver/"
        target="_blank" rel="noopener noreferrer">点击此处获取</a>
    </p>
    </form>}
    {config.providers.discourse.enabled && <div class="mt-5 space-y-2">
      <a class="block w-full rounded-md border border-neutral-400 bg-neutral-100 px-3 py-2 text-center text-sm hover:bg-neutral-200"
        href={`/sign-in/discourse?return_to=${encodeURIComponent(providerReturnTo())}`}>
        使用 Discourse 登录
      </a>
    </div>}
    <ErrorText value={error} />
  </Layout>;
}
