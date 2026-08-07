import { useEffect, useState } from "preact/hooks";
import { config } from "../../../../config";
import { type Account, type Session, request } from "../../api";
import { Button, EmailVerificationModal, ErrorText, Modal } from "../../components";

export function ProfileTab({ session, onChanged }: { session: Session; onChanged: () => void }) {
  const [accounts, setAccounts] = useState<Account[]>([]);
  const [linkToken, setLinkToken] = useState("");
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [otp, setOtp] = useState("");
  const [emailVerificationOpen, setEmailVerificationOpen] = useState(false);
  const [emailVerificationTarget, setEmailVerificationTarget] = useState("");
  const [emailBusy, setEmailBusy] = useState(false);
  const [emailVerificationError, setEmailVerificationError] = useState("");
  const [notice, setNotice] = useState("");
  const [error, setError] = useState("");
  const [deleteAccountOpen, setDeleteAccountOpen] = useState(false);
  const [deleteAccountConfirmation, setDeleteAccountConfirmation] = useState("");
  const [deleteAccountBusy, setDeleteAccountBusy] = useState(false);

  const reloadAccounts = async () => {
    try {
      setAccounts(await request<Account[]>("/accounts"));
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "请求失败");
    }
  };

  useEffect(() => {
    setName(session.user.name); setEmail(session.user.email); reloadAccounts();
  }, [session]);

  async function run(action: () => Promise<unknown>, success?: string) {
    setError(""); setNotice("");
    try {
      await action();
      if (success) setNotice(success);
      return true;
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "请求失败");
      return false;
    }
  }

  async function saveName() {
    if (await run(() => request("/update-user", { name }), "姓名已保存")) onChanged();
  }

  async function linkSeaTable(event: Event) {
    event.preventDefault();
    if (await run(() => request("/accounts/link/seatable", { token: linkToken }), "SeaTable 已绑定")) {
      setLinkToken("");
      await reloadAccounts();
    }
  }

  async function unlinkAccount(account: Account) {
    if (await run(() => request("/accounts/unlink", account), "登录方式已解绑")) await reloadAccounts();
  }

  async function requestEmailChange() {
    setError(""); setNotice(""); setEmailBusy(true);
    const targetEmail = email;
    try {
      await request("/email-otp/request-email-change", { newEmail: targetEmail });
      setOtp("");
      setEmailVerificationTarget(targetEmail);
      setEmailVerificationError("");
      setEmailVerificationOpen(true);
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "请求失败");
    } finally {
      setEmailBusy(false);
    }
  }

  async function verifyEmailChange(event: Event) {
    event.preventDefault();
    setEmailVerificationError(""); setEmailBusy(true);
    try {
      await request("/email-otp/change-email", { newEmail: emailVerificationTarget, otp });
      setEmailVerificationOpen(false);
      setEmailVerificationTarget("");
      setOtp("");
      setNotice("邮箱已更新");
      onChanged();
    } catch (reason) {
      setEmailVerificationError(reason instanceof Error ? reason.message : "验证失败");
    } finally {
      setEmailBusy(false);
    }
  }

  function closeEmailVerification() {
    setEmailVerificationOpen(false);
    setEmailVerificationTarget("");
    setOtp("");
    setEmailVerificationError("");
  }

  async function deleteAccount() {
    setDeleteAccountBusy(true); setError("");
    try {
      await request("/accounts/delete", { confirmation: deleteAccountConfirmation });
      location.replace("/login");
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "注销失败");
      setDeleteAccountBusy(false);
    }
  }

  return <>
    {notice && <p class="mb-4 w-full rounded-lg border border-emerald-200 bg-emerald-50 px-3 py-2 text-sm text-emerald-700">{notice}</p>}
    <ErrorText value={error} />
    <div class="space-y-5">
      <section class="rounded-xl border border-stone-200 bg-white p-6 shadow-card">
        <h2 class="text-base font-semibold tracking-tight text-stone-950">个人资料</h2>
        <div class="mt-4 grid grid-cols-1 gap-5 sm:grid-cols-2">
          <div>
            <label htmlFor="name_field" class="mb-1.5 block text-sm font-medium text-stone-700">昵称</label>
            <div class="flex items-center gap-2">
              <input id="name_field" class="min-w-0 flex-1" value={name}
                onInput={(event) => setName(event.currentTarget.value)} />
              <Button variant="neutral" class="shrink-0" onClick={saveName}>保存昵称</Button>
            </div>
          </div>
          <div>
            <label htmlFor="email_field" class="mb-1.5 block text-sm font-medium text-stone-700">邮箱</label>
            <div class="flex items-center gap-2">
              <input id="email_field" class="min-w-0 flex-1" type="email" value={email} disabled={emailBusy}
                onInput={(event) => setEmail(event.currentTarget.value)} />
              <Button variant="neutral" class="shrink-0" onClick={requestEmailChange} disabled={emailBusy}>修改邮箱</Button>
            </div>
            <p class={`mt-1.5 flex items-center gap-1.5 text-xs ${session.user.emailVerified ? "text-stone-500" : "text-amber-600"}`}>
              <span class={`inline-block h-1.5 w-1.5 rounded-full ${session.user.emailVerified ? "bg-emerald-500" : "bg-amber-500"}`} />
              {session.user.emailVerified ? "已验证" : "未验证"}
            </p>
          </div>
        </div>
      </section>
      <section class="rounded-xl border border-stone-200 bg-white p-6 shadow-card">
        <h2 class="text-base font-semibold tracking-tight text-stone-950">登录方式</h2>
        {accounts.length > 0 && <div class="mt-4 divide-y divide-stone-100 overflow-hidden rounded-lg border border-stone-200">
          {accounts.map((account) => <div key={`${account.providerId}:${account.accountId}`}
            class="flex items-center justify-between gap-3 px-4 py-3">
            <div class="min-w-0">
              <strong class="block text-sm text-stone-900">{account.providerId}</strong>
              <span class="block truncate font-mono text-xs text-stone-500">{account.accountId}</span>
            </div>
            {account.providerId !== "email" && <button type="button" class="shrink-0 text-sm text-red-600 hover:text-red-700"
              onClick={() => unlinkAccount(account)}>解绑</button>}
          </div>)}
        </div>}
        {config.providers.seatable.enabled && !accounts.some((account) => account.providerId === "seatable") &&
          <form class="mt-4 flex gap-2" onSubmit={linkSeaTable}>
            <input class="min-w-0 flex-1" type="password" required placeholder="SeaTable Token"
              value={linkToken} onInput={(event) => setLinkToken(event.currentTarget.value)} />
            <Button variant="neutral" class="shrink-0">绑定</Button>
          </form>}
        {config.providers.discourse.enabled && !accounts.some((account) => account.providerId === "discourse") &&
          <div class="mt-3">
            <a class="inline-flex items-center rounded-lg border border-stone-200 bg-stone-100 px-4 py-2 text-sm font-medium text-stone-700 transition-colors hover:bg-stone-200"
              href="/accounts/link/discourse?return_to=%2Fconsole">绑定 Discourse</a>
          </div>}
      </section>
      <section class="rounded-xl border border-red-200 bg-red-50/60 p-6">
        <h2 class="text-base font-semibold tracking-tight text-red-800">危险操作</h2>
        <div class="mt-4 flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
          <div>
            <strong class="text-sm text-red-900">注销账户</strong>
            <p class="mt-1 text-xs text-red-700">永久删除账户、登录方式、会话、OIDC 应用和授权记录</p>
          </div>
          <Button variant="danger" class="shrink-0"
            onClick={() => { setDeleteAccountConfirmation(""); setDeleteAccountOpen(true); }}>注销账户</Button>
        </div>
      </section>
    </div>

    {deleteAccountOpen && <Modal title="注销账户" compact dismissDisabled={deleteAccountBusy}
      onClose={() => setDeleteAccountOpen(false)}>
      <p class="text-sm text-neutral-900">此操作不可恢复</p>
      <label htmlFor="delete_account_confirmation" class="mb-1 mt-4 block text-sm">输入 DELETE 确认</label>
      <input id="delete_account_confirmation" autofocus class="w-full" value={deleteAccountConfirmation}
        disabled={deleteAccountBusy} onInput={(event) => setDeleteAccountConfirmation(event.currentTarget.value)} />
      <div class="mt-5 flex justify-end gap-2">
        <Button disabled={deleteAccountBusy} onClick={() => setDeleteAccountOpen(false)}>取消</Button>
        <Button variant="danger"
          disabled={deleteAccountBusy || deleteAccountConfirmation !== "DELETE"} onClick={deleteAccount}>永久删除</Button>
      </div>
    </Modal>}

    {emailVerificationOpen && <EmailVerificationModal email={emailVerificationTarget} otp={otp}
      busy={emailBusy} error={emailVerificationError} onOtpInput={setOtp}
      onClose={closeEmailVerification} onSubmit={verifyEmailChange} />}
  </>;
}
