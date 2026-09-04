import { describe, expect, it } from "vitest";
import { createOAuthBroker } from "../lib/oauth-broker.js";

describe("ChatGPT OAuth broker", () => {
  it("publishes a complete PKCE authorization server on the MCP origin", () => {
    const broker = createOAuthBroker({
      publicUrl: "https://mcp.example.test/mcp",
      homeAssistantUrl: "https://ha.example.test",
    });

    expect(broker.metadata.protectedResource.authorization_servers).toEqual(["https://mcp.example.test"]);
    expect(broker.metadata.authorizationServer).toMatchObject({
      issuer: "https://mcp.example.test",
      authorization_endpoint: "https://mcp.example.test/authorize",
      token_endpoint: "https://mcp.example.test/token",
      revocation_endpoint: "https://mcp.example.test/revoke",
      code_challenge_methods_supported: ["S256"],
      token_endpoint_auth_methods_supported: ["none"],
    });
  });
});
