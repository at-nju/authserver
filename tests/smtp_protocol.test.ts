import { describe, expect, it } from "vitest";
import {
  buildVerificationEmail,
  dotStuffSmtpData,
  encodeMimeHeader,
  encodeSmtpAuth,
  parseSmtpReplyStart,
} from "../src/smtp_protocol";

describe("SMTP protocol helpers", () => {
  it("parses single-line and continued replies", () => {
    expect(parseSmtpReplyStart("220 smtp ready")).toEqual({
      code: 220,
      continued: false,
    });
    expect(parseSmtpReplyStart("250-AUTH LOGIN PLAIN")).toEqual({
      code: 250,
      continued: true,
    });
    expect(parseSmtpReplyStart("invalid")).toBeNull();
  });

  it("encodes SMTP auth and UTF-8 headers", () => {
    expect(encodeSmtpAuth("noreply@nju.at")).toBe("bm9yZXBseUBuanUuYXQ=");
    expect(encodeMimeHeader("验证码")).toMatch(/^=\?UTF-8\?B\?.+\?=$/);
  });

  it("dot-stuffs message lines", () => {
    expect(dotStuffSmtpData("first\n.second\r\n..third")).toBe(
      "first\r\n..second\r\n...third",
    );
  });

  it("builds a complete verification email without exposing account metadata", () => {
    const message = buildVerificationEmail({
      to: "251502027@smail.nju.edu.cn",
      otp: "123456",
      date: new Date("2026-07-24T08:00:00.000Z"),
      messageId: "test-message",
    });

    expect(message).toContain("From: NJU Auth <noreply@nju.at>");
    expect(message).toContain("To: <251502027@smail.nju.edu.cn>");
    expect(message).toContain("Subject: =?UTF-8?B?");
    expect(message).toContain("Message-ID: <test-message@auth.nju.at>");
    expect(message).toContain("Content-Transfer-Encoding: base64");
    expect(message).not.toContain("SeaTable");
    expect(message).not.toContain("123456\r\n");
  });
});
