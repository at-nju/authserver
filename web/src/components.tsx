import type { ComponentChildren, JSX } from "preact";
import { useEffect } from "preact/hooks";

export type ButtonVariant = "primary" | "secondary" | "neutral" | "danger";
const buttonStyles: Record<ButtonVariant, string> = {
  primary: "rounded-lg bg-accent px-4 py-2 text-sm font-medium text-white shadow-sm transition-colors hover:bg-accent-strong active:scale-[0.98]",
  secondary: "rounded-lg border border-stone-300 bg-white px-4 py-2 text-sm font-medium text-stone-800 shadow-sm transition-colors hover:bg-stone-50 active:scale-[0.98]",
  neutral: "rounded-lg border border-stone-200 bg-stone-100 px-4 py-2 text-sm font-medium text-stone-700 transition-colors hover:bg-stone-200 active:scale-[0.98]",
  danger: "rounded-lg border border-red-300 bg-white px-4 py-2 text-sm font-medium text-red-700 shadow-sm transition-colors hover:bg-red-50 active:scale-[0.98]",
};

export function Button({ variant = "secondary", class: className, ...rest }:
  JSX.IntrinsicElements["button"] & { variant?: ButtonVariant }) {
  return <button class={`${buttonStyles[variant]}${className ? ` ${className}` : ""}`} {...rest} />;
}

export function tabButtonClass(active: boolean) {
  return `-mb-px whitespace-nowrap border-b-2 px-1 pb-2 pt-1 text-sm font-medium transition-colors ${
    active
      ? "border-accent text-stone-950"
      : "border-transparent text-stone-500 hover:border-stone-300 hover:text-stone-800"
  }`;
}

export function Layout({ title, children }: {
  title: string;
  children: ComponentChildren;
}) {
  return <main class="flex min-h-[100dvh] flex-col items-center justify-center px-4 py-12">
    <header class="mb-6 flex flex-col items-center gap-2.5">
      <span class="flex h-10 w-10 items-center justify-center rounded-xl bg-accent text-base font-bold text-white">N</span>
      <span class="text-sm font-semibold tracking-tight text-stone-900">{__APP_NAME__}</span>
    </header>
    <section class="w-full max-w-md rounded-2xl border border-stone-200 bg-white p-6 shadow-card sm:p-8">
      <h1 class="mb-6 text-xl font-semibold tracking-tight text-stone-950">{title}</h1>
      {children}
    </section>
    <footer class="mt-6 text-center text-xs text-stone-400">
      <a href="https://github.com/at-nju/authserver" target="_blank" rel="noopener noreferrer">本项目</a> 以
      <a href="https://github.com/at-nju/authserver/blob/main/LICENSE" target="_blank" rel="noopener noreferrer"> GPL-3.0 </a>许可证发布
    </footer>
  </main>;
}

export function ErrorText({ value }: { value: string }) {
  return value ? <p class="my-2 w-full rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700">{value}</p> : null;
}

export function CopyIcon({ copied = false }: { copied?: boolean }) {
  return copied
    ? <svg aria-hidden="true" viewBox="0 0 24 24" class="h-4 w-4" fill="none"
      stroke="currentColor" stroke-width="2"><path d="m5 12 4 4L19 6" /></svg>
    : <svg aria-hidden="true" viewBox="0 0 24 24" class="h-4 w-4" fill="none"
      stroke="currentColor" stroke-width="2"><rect x="9" y="9" width="11" height="11" rx="2" />
      <path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1" /></svg>;
}

export function CloseIcon() {
  return <svg aria-hidden="true" viewBox="0 0 24 24" class="h-5 w-5" fill="none"
    stroke="currentColor" stroke-width="2"><path d="M18 6 6 18M6 6l12 12" /></svg>;
}

export function Modal({ title, children, onClose, locked = false, dismissDisabled = false, compact = false }: {
  title: string;
  children: ComponentChildren;
  onClose: () => void;
  locked?: boolean;
  dismissDisabled?: boolean;
  compact?: boolean;
}) {
  useEffect(() => {
    const closeOnEscape = (event: KeyboardEvent) => {
      if (event.key === "Escape" && !locked && !dismissDisabled) onClose();
    };
    document.addEventListener("keydown", closeOnEscape);
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      document.removeEventListener("keydown", closeOnEscape);
      document.body.style.overflow = previousOverflow;
    };
  }, [dismissDisabled, locked, onClose]);

  return <div class="fixed inset-0 z-50 flex items-center justify-center bg-stone-950/40 p-4 backdrop-blur-[2px]"
    onMouseDown={(event) => {
      if (!locked && !dismissDisabled && event.target === event.currentTarget) onClose();
    }}>
    <section role="dialog" aria-modal="true" aria-label={title}
      class={`max-h-[90vh] w-full overflow-y-auto rounded-2xl border border-stone-200 bg-white p-6 shadow-modal ${compact ? "max-w-md" : "max-w-2xl"}`}>
      <header class="mb-5 flex items-start justify-between gap-4">
        <h3 class="text-lg font-semibold tracking-tight text-stone-950">{title}</h3>
        {!locked && <button type="button" aria-label="关闭" title="关闭"
          class="-mr-1 rounded-lg p-2 text-stone-400 hover:bg-stone-100 hover:text-stone-700"
          disabled={dismissDisabled}
          onClick={onClose}><CloseIcon /></button>}
      </header>
      {children}
    </section>
  </div>;
}

export function EmailVerificationModal({ email, otp, busy, error, onOtpInput, onClose, onSubmit }: {
  email: string;
  otp: string;
  busy: boolean;
  error: string;
  onOtpInput: (value: string) => void;
  onClose: () => void;
  onSubmit: (event: Event) => void;
}) {
  return <Modal title="验证邮箱" compact dismissDisabled={busy} onClose={onClose}>
    <p class="text-sm text-stone-600">验证码已发送至</p>
    <strong class="mt-1 block break-all text-stone-950">{email}</strong>
    <form class="mt-5" onSubmit={onSubmit}>
      <fieldset disabled={busy} class="space-y-4">
        <div>
          <label htmlFor="email_otp_field" class="mb-1.5 block text-sm font-medium text-stone-700">验证码</label>
          <input id="email_otp_field" required autofocus class="w-full" inputMode="numeric"
            autocomplete="one-time-code" maxLength={6} value={otp}
            onInput={(event) => onOtpInput(event.currentTarget.value)} />
        </div>
        <ErrorText value={error} />
        <div class="mt-5 flex justify-end gap-2">
          <Button onClick={onClose}>取消</Button>
          <Button type="submit" variant="primary">确认</Button>
        </div>
      </fieldset>
    </form>
  </Modal>;
}
