export interface VerificationEmailOptions {
  to: string;
  otp: string;
  date?: Date;
  messageId?: string;
}

export interface SmtpReplyStart {
  code: number;
  continued: boolean;
}

function bytesToBase64(bytes: Uint8Array): string {
  let binary = "";
  for (let offset = 0; offset < bytes.length; offset += 0x8000) {
    binary += String.fromCharCode(...bytes.subarray(offset, offset + 0x8000));
  }
  return btoa(binary);
}

function base64Utf8(value: string): string {
  return bytesToBase64(new TextEncoder().encode(value));
}

function wrapBase64(value: string): string {
  return value.match(/.{1,76}/g)?.join("\r\n") ?? "";
}

export function encodeSmtpAuth(value: string): string {
  return base64Utf8(value);
}

export function encodeMimeHeader(value: string): string {
  return `=?UTF-8?B?${base64Utf8(value)}?=`;
}

export function parseSmtpReplyStart(line: string): SmtpReplyStart | null {
  const match = /^(\d{3})([ -])/.exec(line);
  if (!match) return null;
  return {
    code: Number.parseInt(match[1] ?? "0", 10),
    continued: match[2] === "-",
  };
}

export function dotStuffSmtpData(message: string): string {
  return message
    .replace(/\r?\n/g, "\r\n")
    .split("\r\n")
    .map((line) => (line.startsWith(".") ? `.${line}` : line))
    .join("\r\n");
}

export function buildVerificationEmail(
  options: VerificationEmailOptions,
): string {
  const date = options.date ?? new Date();
  const messageId = options.messageId ?? crypto.randomUUID();
  const body = [
    "你的南京大学统一身份认证邮箱验证码是：",
    "",
    options.otp,
    "",
    "验证码在 10 分钟内有效。",
    "如果这不是你的操作，可以忽略这封邮件。",
  ].join("\r\n");

  return [
    "From: NJU Auth <noreply@nju.at>",
    `To: <${options.to}>`,
    `Subject: ${encodeMimeHeader("南京大学身份认证邮箱验证码")}`,
    `Date: ${date.toUTCString()}`,
    `Message-ID: <${messageId}@auth.nju.at>`,
    "MIME-Version: 1.0",
    "Content-Type: text/plain; charset=UTF-8",
    "Content-Transfer-Encoding: base64",
    "Auto-Submitted: auto-generated",
    "X-Auto-Response-Suppress: All",
    "",
    wrapBase64(base64Utf8(body)),
    "",
  ].join("\r\n");
}
