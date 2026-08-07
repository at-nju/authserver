import type { ComponentChildren, JSX } from "preact";
import { useEffect } from "preact/hooks";

export type ButtonVariant = "primary" | "secondary" | "neutral" | "danger";
const buttonStyles: Record<ButtonVariant, string> = {
  primary: "rounded-md border border-neutral-900 bg-neutral-100 px-3 py-1.5 text-sm font-medium text-neutral-950 hover:bg-neutral-200",
  secondary: "rounded-md border border-neutral-400 bg-white px-3 py-1.5 text-sm hover:bg-neutral-100",
  neutral: "rounded-md border border-neutral-400 bg-neutral-100 px-3 py-1.5 text-sm hover:bg-neutral-200",
  danger: "rounded-md border border-red-800 bg-white px-3 py-1.5 text-sm font-medium text-red-800 hover:bg-red-50",
};

export function Button({ variant = "secondary", class: className, ...rest }:
  JSX.IntrinsicElements["button"] & { variant?: ButtonVariant }) {
  return <button class={`${buttonStyles[variant]}${className ? ` ${className}` : ""}`} {...rest} />;
}

export function tabButtonClass(active: boolean) {
  return `flex-1 rounded-md px-3 py-1.5 text-sm font-medium transition-colors ${
    active
      ? "border border-neutral-300 bg-white text-neutral-950 shadow-sm"
      : "border border-transparent text-neutral-600 hover:text-neutral-950"
  }`;
}

export function Layout({ title, children, wide = false }: {
  title: string;
  children: ComponentChildren;
  wide?: boolean;
}) {
  return <main class={`mx-auto px-4 ${wide ? "mt-[6vh] max-w-4xl" : "mt-[20vh] max-w-lg"}`}>
    <header class="ml-2 mb-1 font-semibold text-neutral-500">{__APP_NAME__}</header>
    <section class="rounded-xl border border-neutral-300 bg-white p-6 shadow">
      <h1 class="mb-4 text-xl font-bold">{title}</h1>
      {children}
    </section>
    <footer class="mr-2 mt-2 mb-6 text-right text-sm text-neutral-500">
      <a href="https://github.com/at-nju/authserver"
        target="_blank" rel="noopener noreferrer">本项目 </a>以
      <a href="https://github.com/at-nju/authserver/blob/main/LICENSE"
        target="_blank" rel="noopener noreferrer"> GPL-3.0 </a>许可证发布
    </footer>
  </main>;
}

export function ErrorText({ value }: { value: string }) {
  return value ? <p class="w-full rounded px-3 py-2 my-2 border border-red-300 bg-red-100 text-red-800">{value}</p> : null;
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

  return <div class="fixed inset-0 z-50 flex items-center justify-center bg-black/45 p-4"
    onMouseDown={(event) => {
      if (!locked && !dismissDisabled && event.target === event.currentTarget) onClose();
    }}>
    <section role="dialog" aria-modal="true" aria-label={title}
      class={`max-h-[90vh] w-full overflow-y-auto rounded-xl border border-neutral-400 bg-white p-5 shadow-xl ${compact ? "max-w-md" : "max-w-2xl"}`}>
      <header class="mb-5 flex items-start justify-between gap-4">
        <h3 class="text-xl font-semibold text-neutral-950">{title}</h3>
        {!locked && <button type="button" aria-label="关闭" title="关闭"
          class="p-2" disabled={dismissDisabled}
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
    <p class="text-sm text-neutral-700">验证码已发送至</p>
    <strong class="mt-1 block break-all text-neutral-950">{email}</strong>
    <form class="mt-5" onSubmit={onSubmit}>
      <fieldset disabled={busy}>
        <label htmlFor="email_otp_field" class="mb-1 block text-sm">验证码</label>
        <input id="email_otp_field" required autofocus class="w-full" inputMode="numeric"
          autocomplete="one-time-code" maxLength={6} value={otp}
          onInput={(event) => onOtpInput(event.currentTarget.value)} />
        <ErrorText value={error} />
        <div class="mt-5 flex justify-end gap-2">
          <Button onClick={onClose}>取消</Button>
          <Button type="submit" variant="primary">确认</Button>
        </div>
      </fieldset>
    </form>
  </Modal>;
}
