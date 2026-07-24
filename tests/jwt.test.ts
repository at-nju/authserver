import { describe, expect, it } from "vitest";
import { JWT_KEY_PAIR_CONFIG } from "../src/jwt";

describe("OIDC signing keys", () => {
  it("uses an RSA algorithm supported by Cloudflare Access", () => {
    expect(JWT_KEY_PAIR_CONFIG).toEqual({
      alg: "RS256",
      modulusLength: 2048,
    });
  });
});
