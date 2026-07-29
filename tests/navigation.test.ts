import { describe, expect, it } from "vitest";
import { afterLogin, afterOnboarding } from "../src/navigation";

describe("login continuation", () => {
  it("resumes a signed OIDC request after onboarding", () => {
    const oauth = "client_id=x&sig=y";
    const destination = afterLogin(false, oauth);
    expect(destination).toBe(`/onboarding?oauth_query=${encodeURIComponent(oauth)}`);
    expect(afterOnboarding(new URL(destination, "https://local").search)).toBe(`/oauth2/authorize?${oauth}`);
  });

  it("only accepts the console as a direct return", () => {
    expect(afterLogin(true, undefined, "/console")).toBe("/console");
    expect(afterLogin(true, undefined, "https://evil.example")).toBe("/console");
  });
});
