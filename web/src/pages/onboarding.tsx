import { useEffect, useState } from "preact/hooks";
import { afterOnboarding } from "../../../src/navigation";
import { request, useSession } from "../api";
import { Button, EmailVerificationModal, ErrorText, Layout } from "../components";

export default function Onboarding() {
  const params = new URLSearchParams(location.search);
  const signed = params.get("oauth_query");
  const login = signed ? `/login?${signed}` : "/login?return_to=/console";
  const session = useSession(login);
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [otp, setOtp] = useState("");
  const [verificationOpen, setVerificationOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [verificationError, setVerificationError] = useState("");

  useEffect(() => {
    if (!session) return;
    if (session.user.onboardingCompleted) location.replace(afterOnboarding(location.search));
    setName(session.user.name);
    setEmail(session.user.email);
  }, [session]);

  async function finish(skip = false) {
    if (!session) return;
    setBusy(true); setError("");
    try {
      if (!skip && email !== session.user.email) {
        await request("/email-otp/request-email-change", { newEmail: email });
        setOtp("");
        setVerificationError("");
        setVerificationOpen(true);
        return;
      }
      await request("/update-user", skip
        ? { onboardingCompleted: true }
        : { name, onboardingCompleted: true });
      location.assign(afterOnboarding(location.search));
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "保存失败");
    } finally {
      setBusy(false);
    }
  }

  async function verify(event: Event) {
    event.preventDefault();
    setBusy(true); setVerificationError("");
    try {
      await request("/email-otp/change-email", { newEmail: email, otp });
      await request("/update-user", { name, onboardingCompleted: true });
      location.assign(afterOnboarding(location.search));
    } catch (reason) {
      setVerificationError(reason instanceof Error ? reason.message : "验证失败");
    } finally {
      setBusy(false);
    }
  }

  function closeVerification() {
    setVerificationOpen(false);
    setOtp("");
    setVerificationError("");
  }

  if (!session) return <Layout title="首次设置"><p>加载中</p></Layout>;
  return <Layout title="首次设置">
    <p class="mb-5 text-sm text-neutral-700">可以使用默认资料，也可以现在修改</p>
    <form onSubmit={(event) => { event.preventDefault(); finish(); }}>
      <fieldset disabled={busy} class="space-y-4">
        <div>
          <label htmlFor="onboarding_name_field" class="mb-1 block text-sm">姓名</label>
          <input id="onboarding_name_field" autofocus class="w-full" value={name}
            onInput={(event) => setName(event.currentTarget.value)} />
        </div>
        <div>
          <label htmlFor="onboarding_email_field" class="mb-1 block text-sm">邮箱</label>
          <input id="onboarding_email_field" required class="w-full" type="email" value={email}
            onInput={(event) => setEmail(event.currentTarget.value)} />
          <p class="mt-1 text-xs text-neutral-500">修改邮箱后需要输入验证码</p>
        </div>
        <ErrorText value={error} />
        <div class="flex justify-end gap-2 pt-1">
          <Button onClick={() => finish(true)}>跳过</Button>
          <Button type="submit" variant="primary">完成</Button>
        </div>
      </fieldset>
    </form>

    {verificationOpen && <EmailVerificationModal email={email} otp={otp} busy={busy}
      error={verificationError} onOtpInput={setOtp} onClose={closeVerification} onSubmit={verify} />}
  </Layout>;
}
