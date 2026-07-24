import { describe, expect, it } from "vitest";
import { defaultUserEmail } from "../src/email_policy";
import { appsPage, emailSettingsPage } from "../src/console_views";

describe("email support", () => {
  it("derives the default NJU mailbox from the SeaTable identity id", () => {
    expect(defaultUserEmail("251502027")).toBe("251502027@smail.nju.edu.cn");
  });

  it("shows the verified email and links to the change flow", () => {
    const html = appsPage("Example User", "251502027@smail.nju.edu.cn", []);

    expect(html).toContain("251502027@smail.nju.edu.cn");
    expect(html).toContain("已验证");
    expect(html).toContain('href="/console/account/email"');
  });

  it("escapes the displayed email", () => {
    const html = appsPage("Example User", '<script>@smail.nju.edu.cn', []);

    expect(html).toContain("&lt;script&gt;@smail.nju.edu.cn");
    expect(html).not.toContain("<script>@smail.nju.edu.cn");
  });

  it("renders send and one-time-code forms on one settings page", () => {
    const html = emailSettingsPage({
      userLabel: "Example User",
      currentEmail: "251502027@smail.nju.edu.cn",
      smtpConfigured: true,
      pendingEmail: "first.last@nju.edu.cn",
      notice: "验证码已经发送。",
    });

    expect(html).toContain('action="/console/account/email/send"');
    expect(html).toContain('action="/console/account/email/confirm"');
    expect(html).toContain('autocomplete="one-time-code"');
    expect(html).toContain('value="first.last@nju.edu.cn"');
  });

  it("disables sending when SMTP is not configured", () => {
    const html = emailSettingsPage({
      userLabel: "Example User",
      currentEmail: "251502027@smail.nju.edu.cn",
      smtpConfigured: false,
    });

    expect(html).toContain("邮件发送服务尚未配置");
    expect(html).toContain("disabled");
  });
});
