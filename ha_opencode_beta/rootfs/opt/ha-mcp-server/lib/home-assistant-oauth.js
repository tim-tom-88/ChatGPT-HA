import { createHash } from "node:crypto";

const CACHE_TTL_MS = 30_000;
const VERIFY_TIMEOUT_MS = 5_000;

export function createHomeAssistantTokenVerifier({
  baseUrl = "http://supervisor/core",
  fetchImpl = fetch,
  cacheTtlMs = CACHE_TTL_MS,
} = {}) {
  const cache = new Map();

  return async function verifyHomeAssistantToken(token) {
    if (typeof token !== "string" || token.length < 20 || token.length > 4096) return false;
    const digest = createHash("sha256").update(token).digest("hex");
    const now = Date.now();
    if ((cache.get(digest) || 0) > now) return true;

    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), VERIFY_TIMEOUT_MS);
    timeout.unref?.();
    try {
      const response = await fetchImpl(`${baseUrl.replace(/\/$/, "")}/api/`, {
        headers: { authorization: `Bearer ${token}` },
        redirect: "error",
        signal: controller.signal,
      });
      if (!response.ok) return false;
      cache.set(digest, now + cacheTtlMs);
      if (cache.size > 32) {
        for (const [key, expiry] of cache) {
          if (expiry <= now) cache.delete(key);
        }
      }
      return true;
    } catch {
      return false;
    } finally {
      clearTimeout(timeout);
    }
  };
}

export function createHomeAssistantOAuthMetadata(publicUrl, homeAssistantUrl) {
  let resource;
  try {
    resource = new URL(publicUrl);
  } catch {
    throw new Error("A valid public HTTPS MCP URL is required for Home Assistant OAuth metadata");
  }
  if (resource.protocol !== "https:" || resource.username || resource.password || resource.search || resource.hash) {
    throw new Error("A valid public HTTPS MCP URL is required for Home Assistant OAuth metadata");
  }
  let issuer;
  try {
    const homeAssistant = new URL(homeAssistantUrl);
    if (homeAssistant.protocol !== "https:" || homeAssistant.username || homeAssistant.password
      || homeAssistant.pathname !== "/" || homeAssistant.search || homeAssistant.hash) {
      throw new Error();
    }
    issuer = homeAssistant.origin;
  } catch {
    throw new Error("A valid public HTTPS Home Assistant OAuth origin is required");
  }
  return {
    protectedResource: {
      resource: resource.href,
      authorization_servers: [issuer],
      bearer_methods_supported: ["header"],
    },
    authorizationServer: {
      issuer,
      authorization_endpoint: `${issuer}/auth/authorize`,
      token_endpoint: `${issuer}/auth/token`,
      response_types_supported: ["code"],
      grant_types_supported: ["authorization_code", "refresh_token"],
    },
  };
}
