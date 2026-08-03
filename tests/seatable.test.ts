import { describe, expect, it, vi } from "vitest";
import { authenticateSeaTableToken } from "../src/auth";

describe("SeaTable login", () => {
  it("uses a parameterized token lookup", async () => {
    const fetcher = vi.fn()
      .mockResolvedValueOnce(Response.json({ access_token: "access", dtable_uuid: "base" }))
      .mockResolvedValueOnce(Response.json({ results: [{ ID: "  user  " }] }));

    await expect(authenticateSeaTableToken({ SEATABLE_API_TOKEN: "app" }, "token", fetcher))
      .resolves.toEqual({
        id: "user",
        name: "user",
        email: "user@smail.nju.edu.cn",
        emailVerified: false,
      });

    expect(JSON.parse(String(fetcher.mock.calls[1]?.[1]?.body))).toMatchObject({
      parameters: ["token"],
      convert_keys: true,
    });
  });
});
