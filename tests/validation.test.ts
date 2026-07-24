import { describe, expect, it } from "vitest";
import { normalizeUris } from "../src/console";
import { sha256Hex } from "../src/crypto";
import { safeReturnTo } from "../src/index";
import { hasUnsupportedResourceIndicator } from "../src/security";

describe("legacy client compatibility", () => {
  it("uses the previous provider's SHA-256 hex format", async () => {
    await expect(sha256Hex("client-secret")).resolves.toBe(
      "fdce8e4a65b70d186bd77cba2e0c580dcf1c6497da9f1b70eed849497e1f8ba2",
    );
  });
});

describe("client redirect URI validation", () => {
  it("accepts and deduplicates HTTP(S) redirect URIs", () => {
    expect(
      normalizeUris(
        "https://app.example/callback\nhttp://127.0.0.1:3000/callback\nhttps://app.example/callback",
      ),
    ).toEqual([
      "https://app.example/callback",
      "http://127.0.0.1:3000/callback",
    ]);
  });

  it.each(["", "not-a-url", "ftp://app.example/callback"])(
    "rejects %s",
    (value) => {
      expect(normalizeUris(value)).toBeNull();
    },
  );
});

describe("console return paths", () => {
  it("accepts local console routes", () => {
    expect(safeReturnTo("/console/apps?tab=all")).toBe("/console/apps?tab=all");
  });

  it.each([
    "https://evil.example/console/apps",
    "//evil.example/console/apps",
    "/console-evil",
    "/not-console",
  ])("rejects unsafe return path %s", (value) => {
    expect(safeReturnTo(value)).toBeUndefined();
  });
});

describe("OAuth resource indicators", () => {
  it.each([
    new Request("https://issuer.example/oauth2/authorize?resource=https://api.example"),
    new Request("https://issuer.example/oauth2/token", {
      method: "POST",
      headers: { "content-type": "application/x-www-form-urlencoded" },
      body: "grant_type=authorization_code&resource=https%3A%2F%2Fapi.example",
    }),
    new Request("https://issuer.example/token", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ grant_type: "refresh_token", resource: "https://api.example" }),
    }),
  ])("rejects resource on OAuth endpoints", async (request) => {
    await expect(hasUnsupportedResourceIndicator(request)).resolves.toBe(true);
  });

  it("does not reject ordinary token requests", async () => {
    const request = new Request("https://issuer.example/oauth2/token", {
      method: "POST",
      headers: { "content-type": "application/x-www-form-urlencoded" },
      body: "grant_type=authorization_code&code=abc",
    });
    await expect(hasUnsupportedResourceIndicator(request)).resolves.toBe(false);
  });
});
