import { describe, expect, it } from "vitest";
import {
  calculateEmailRateLimitRetry,
  EMAIL_CHANGE_POLICY,
  generateEmailOtp,
  hashEmailOtp,
} from "../src/email_change";

describe("email change verification", () => {
  it("generates a six-digit code", () => {
    for (let index = 0; index < 20; index += 1) {
      expect(generateEmailOtp()).toMatch(/^\d{6}$/);
    }
  });

  it("binds the OTP hash to the account and target email", async () => {
    const base = await hashEmailOtp(
      "test-secret",
      "user-1",
      "251502027@smail.nju.edu.cn",
      "123456",
    );
    expect(base).toMatch(/^[a-f0-9]{64}$/);
    expect(
      await hashEmailOtp(
        "test-secret",
        "user-1",
        "251502027@smail.nju.edu.cn",
        "123456",
      ),
    ).toBe(base);
    expect(
      await hashEmailOtp(
        "test-secret",
        "user-2",
        "251502027@smail.nju.edu.cn",
        "123456",
      ),
    ).not.toBe(base);
    expect(
      await hashEmailOtp(
        "test-secret",
        "user-1",
        "other@nju.edu.cn",
        "123456",
      ),
    ).not.toBe(base);
  });

  it("uses the longest active account limit as retry time", () => {
    const now = Date.UTC(2026, 6, 24, 3, 30, 0);
    const hourBucket = Math.floor(now / (60 * 60 * 1000));
    const dayBucket = Math.floor(now / (24 * 60 * 60 * 1000));

    expect(
      calculateEmailRateLimitRetry(
        {
          lastSentAt: now - 30_000,
          hourBucket,
          hourCount: EMAIL_CHANGE_POLICY.hourlyLimit,
          dayBucket,
          dayCount: 1,
        },
        now,
      ),
    ).toBe(30 * 60);

    expect(
      calculateEmailRateLimitRetry(
        {
          lastSentAt: now - 30_000,
          hourBucket,
          hourCount: 1,
          dayBucket,
          dayCount: 1,
        },
        now,
      ),
    ).toBe(90);
  });

  it("documents the agreed limits", () => {
    expect(EMAIL_CHANGE_POLICY).toEqual({
      otpLength: 6,
      expiresSeconds: 600,
      maxAttempts: 5,
      cooldownSeconds: 120,
      hourlyLimit: 3,
      dailyLimit: 6,
    });
  });
});
