import { describe, expect, it } from "vitest";
import { defaultUserEmail } from "../src/email_policy";
import { appsPage } from "../src/console_views";

describe("email support", () => {
  it("derives the default NJU mailbox from the SeaTable identity id", () => {
    expect(defaultUserEmail("251502027")).toBe("251502027@smail.nju.edu.cn");
  });

  it("shows the signed-in email on My Apps without an edit control", () => {
    const html = appsPage("Example User", "251502027@smail.nju.edu.cn", []);

    expect(html).toContain("251502027@smail.nju.edu.cn");
    expect(html).toContain("暂不支持修改");
    expect(html).not.toContain('name="email"');
  });

  it("escapes the displayed email", () => {
    const html = appsPage("Example User", '<script>@smail.nju.edu.cn', []);

    expect(html).toContain("&lt;script&gt;@smail.nju.edu.cn");
    expect(html).not.toContain("<script>@smail.nju.edu.cn");
  });
});
