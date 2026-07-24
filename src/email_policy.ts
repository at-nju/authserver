const SMAIL_DOMAIN = "smail.nju.edu.cn";
const NJU_DOMAIN = "nju.edu.cn";
const DOT_ATOM_PART = /^[a-z0-9!#$%&'*+/=?^_`{|}~-]+(?:\.[a-z0-9!#$%&'*+/=?^_`{|}~-]+)*$/;

export type EmailValidationResult =
  | { ok: true; email: string }
  | { ok: false; message: string };

export function defaultUserEmail(userId: string): string {
  return `${userId.toLowerCase()}@${SMAIL_DOMAIN}`;
}

export function normalizeNjuEmail(input: string): EmailValidationResult {
  const email = input.trim().toLowerCase();
  const separator = email.lastIndexOf("@");
  if (separator <= 0 || separator !== email.indexOf("@")) {
    return { ok: false, message: "请输入合法的南京大学邮箱地址。" };
  }

  const localPart = email.slice(0, separator);
  const domain = email.slice(separator + 1);
  if (localPart.length > 64) {
    return { ok: false, message: "邮箱 @ 前的部分不能超过 64 个字符。" };
  }

  if (domain === SMAIL_DOMAIN) {
    if (!/^\d{1,64}$/.test(localPart)) {
      return { ok: false, message: "smail.nju.edu.cn 邮箱的 @ 前只能包含数字。" };
    }
    return { ok: true, email };
  }

  if (domain === NJU_DOMAIN) {
    if (!DOT_ATOM_PART.test(localPart)) {
      return { ok: false, message: "nju.edu.cn 邮箱的 @ 前包含不支持的字符或格式。" };
    }
    return { ok: true, email };
  }

  return {
    ok: false,
    message: "只支持 @smail.nju.edu.cn 或 @nju.edu.cn 邮箱。",
  };
}
