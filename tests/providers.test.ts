import { describe, expect, it } from "vitest";
import { config } from "../config";
import { emailRegistrationAllowed, normalizeEmail } from "../src/providers";

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
      "upstreamOidc",
    ]);
  });
});
