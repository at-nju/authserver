import { describe, expect, it } from "vitest";
import { config } from "../config";
import { emailRegistrationAllowed, normalizeEmail, registrationAllowed } from "../src/providers";

describe("provider configuration", () => {
  it("allows only configured NJU email domains", () => {
    expect(normalizeEmail(" Student@SMAIL.NJU.EDU.CN ")).toBe("student@smail.nju.edu.cn");
    expect(emailRegistrationAllowed("student@smail.nju.edu.cn")).toBe(true);
    expect(emailRegistrationAllowed("teacher@nju.edu.cn")).toBe(true);
    expect(emailRegistrationAllowed("user@example.com")).toBe(false);
  });

  it("keeps every authentication method under config.providers", () => {
    expect(Object.keys(config.providers)).toEqual([
      "seatable",
      "email",
      "discourse",
    ]);
  });

  it("supports allow, deny, and email-domain registration policies", () => {
    expect(registrationAllowed("allow", "user@example.com")).toBe(true);
    expect(registrationAllowed("deny", "user@nju.edu.cn")).toBe(false);
    expect(registrationAllowed({ mode: "email-domain", domains: ["nju.edu.cn"] }, "user@nju.edu.cn")).toBe(true);
    expect(registrationAllowed({ mode: "email-domain", domains: ["nju.edu.cn"] }, "user@example.com")).toBe(false);
  });
});
