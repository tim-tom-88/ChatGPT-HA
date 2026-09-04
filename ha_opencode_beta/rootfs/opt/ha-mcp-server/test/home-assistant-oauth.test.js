import { describe, expect, it, vi } from "vitest";
import {
  createHomeAssistantOAuthMetadata,
  createHomeAssistantTokenVerifier,
} from "../lib/home-assistant-oauth.js";

describe("Home Assistant OAuth", () => {
  it("publishes the exact MCP resource and Home Assistant auth endpoints", () => {
    const metadata = createHomeAssistantOAuthMetadata("https://ha.example.test/chatgpt-ha/mcp");
    expect(metadata.protectedResource.resource).toBe("https://ha.example.test/chatgpt-ha/mcp");
    expect(metadata.protectedResource.authorization_servers).toEqual(["https://ha.example.test"]);
    expect(metadata.authorizationServer.authorization_endpoint).toBe("https://ha.example.test/auth/authorize");
    expect(metadata.authorizationServer.token_endpoint).toBe("https://ha.example.test/auth/token");
  });

  it("rejects non-HTTPS, credential-bearing, and query-bearing public URLs", () => {
    for (const url of [
      "http://ha.example.test/mcp",
      "https://user:secret@ha.example.test/mcp",
      "https://ha.example.test/mcp?token=secret",
    ]) {
      expect(() => createHomeAssistantOAuthMetadata(url)).toThrow(/public HTTPS MCP URL/);
    }
  });

  it("validates access tokens against Home Assistant and caches only their digest", async () => {
    const fetchImpl = vi.fn(async (_url, options) => ({ ok: options.headers.authorization === "Bearer valid-home-assistant-token" }));
    const verify = createHomeAssistantTokenVerifier({
      baseUrl: "http://supervisor/core",
      fetchImpl,
      cacheTtlMs: 60_000,
    });

    await expect(verify("short")).resolves.toBe(false);
    await expect(verify("invalid-home-assistant-token")).resolves.toBe(false);
    await expect(verify("valid-home-assistant-token")).resolves.toBe(true);
    await expect(verify("valid-home-assistant-token")).resolves.toBe(true);
    expect(fetchImpl).toHaveBeenCalledTimes(2);
    expect(fetchImpl.mock.calls[1][0]).toBe("http://supervisor/core/api/");
  });
});
