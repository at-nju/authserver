import { describe, expect, it } from "vitest";
import { defaultUserEmail, normalizeNjuEmail } from "../src/email_policy";

describe("NJU email policy", () => {
  it("derives and normalizes the trusted default mailbox", () => {
    expect(defaultUserEmail("251502027")).toBe("251502027@smail.nju.edu.cn");
    expect(defaultUserEmail("ABC123")).toBe("abc123@smail.nju.edu.cn");
  });

  it.each([
    ["001234@smail.nju.edu.cn", "001234@smail.nju.edu.cn"],
    [" 251502027@SMAIL.NJU.EDU.CN ", "251502027@smail.nju.edu.cn"],
    ["first.last@nju.edu.cn", "first.last@nju.edu.cn"],
    ["TEAM+Auth@NJU.EDU.CN", "team+auth@nju.edu.cn"],
  ])("accepts %s", (input, expected) => {
    expect(normalizeNjuEmail(input)).toEqual({ ok: true, email: expected });
  });

  it.each([
    ["student@smail.nju.edu.cn", "smail.nju.edu.cn 邮箱的 @ 前只能包含数字。"],
    ["a..b@nju.edu.cn", "nju.edu.cn 邮箱的 @ 前包含不支持的字符或格式。"],
    ["name@dept.nju.edu.cn", "只支持 @smail.nju.edu.cn 或 @nju.edu.cn 邮箱。"],
    ["name@example.com", "只支持 @smail.nju.edu.cn 或 @nju.edu.cn 邮箱。"],
    ["not-an-email", "请输入合法的南京大学邮箱地址。"],
  ])("rejects %s", (input, message) => {
    expect(normalizeNjuEmail(input)).toEqual({ ok: false, message });
  });
});
