import { createHash, randomBytes, timingSafeEqual } from "node:crypto";
import WebSocket from "ws";

const FLOW_TTL_MS = 5 * 60_000;
const CODE_TTL_MS = 60_000;

function opaque(bytes = 32) {
  return randomBytes(bytes).toString("base64url");
}

function redirect(response, location) {
  response.writeHead(302, { location, "cache-control": "no-store" });
  response.end();
}

function json(response, status, body) {
  response.writeHead(status, { "content-type": "application/json", "cache-control": "no-store" });
  response.end(JSON.stringify(body));
}

async function formBody(request) {
  let body = "";
  for await (const chunk of request) {
    body += chunk;
    if (body.length > 32_768) throw new Error("request_too_large");
  }
  return new URLSearchParams(body);
}

function sameClientOrigin(clientId, redirectUri) {
  try {
    return new URL(clientId).origin === new URL(redirectUri).origin
      && new URL(redirectUri).protocol === "https:";
  } catch {
    return false;
  }
}

async function isAdminUser(homeAssistantOrigin, accessToken) {
  const websocketUrl = new URL("/api/websocket", homeAssistantOrigin);
  websocketUrl.protocol = "wss:";
  return new Promise((resolve) => {
    const socket = new WebSocket(websocketUrl, { handshakeTimeout: 8_000 });
    const finish = (result) => { try { socket.close(); } catch {} resolve(result); };
    const timeout = setTimeout(() => finish(false), 10_000);
    socket.on("message", (raw) => {
      let message;
      try { message = JSON.parse(raw.toString()); } catch { return; }
      if (message.type === "auth_required") socket.send(JSON.stringify({ type: "auth", access_token: accessToken }));
      else if (message.type === "auth_ok") socket.send(JSON.stringify({ id: 1, type: "auth/current_user" }));
      else if (message.type === "auth_invalid") { clearTimeout(timeout); finish(false); }
      else if (message.id === 1) {
        clearTimeout(timeout);
        finish(Boolean(message.success && (message.result?.is_owner || message.result?.is_admin)));
      }
    });
    socket.on("error", () => { clearTimeout(timeout); finish(false); });
  });
}

export function createOAuthBroker({ publicUrl, homeAssistantUrl, fetchImpl = fetch }) {
  const resource = new URL(publicUrl);
  const issuer = resource.origin;
  const upstream = new URL(homeAssistantUrl).origin;
  const flows = new Map();
  const codes = new Map();

  const metadata = {
    protectedResource: {
      resource: resource.href,
      authorization_servers: [issuer],
      bearer_methods_supported: ["header"],
    },
    authorizationServer: {
      issuer,
      authorization_endpoint: `${issuer}/authorize`,
      token_endpoint: `${issuer}/token`,
      revocation_endpoint: `${issuer}/revoke`,
      response_types_supported: ["code"],
      grant_types_supported: ["authorization_code", "refresh_token"],
      code_challenge_methods_supported: ["S256"],
      token_endpoint_auth_methods_supported: ["none"],
    },
  };

  async function handle(request, response) {
    const url = new URL(request.url, issuer);
    if (request.method === "GET" && url.pathname === "/authorize") {
      const clientId = url.searchParams.get("client_id");
      const redirectUri = url.searchParams.get("redirect_uri");
      const challenge = url.searchParams.get("code_challenge");
      const state = url.searchParams.get("state") || "";
      if (url.searchParams.get("response_type") !== "code" || !sameClientOrigin(clientId, redirectUri)
        || url.searchParams.get("code_challenge_method") !== "S256" || !/^[A-Za-z0-9_-]{43,128}$/.test(challenge || "")) {
        json(response, 400, { error: "invalid_request" });
        return true;
      }
      const internalState = opaque();
      flows.set(internalState, { clientId, redirectUri, challenge, state, expires: Date.now() + FLOW_TTL_MS });
      const authorize = new URL("/auth/authorize", upstream);
      authorize.search = new URLSearchParams({
        response_type: "code", client_id: issuer, redirect_uri: `${issuer}/oauth/callback`, state: internalState,
      }).toString();
      redirect(response, authorize.href);
      return true;
    }
    if (request.method === "GET" && url.pathname === "/oauth/callback") {
      const state = url.searchParams.get("state");
      const flow = flows.get(state);
      flows.delete(state);
      if (!flow || flow.expires < Date.now() || !url.searchParams.get("code")) {
        json(response, 400, { error: "invalid_request" });
        return true;
      }
      const upstreamResponse = await fetchImpl(`${upstream}/auth/token`, {
        method: "POST", headers: { "content-type": "application/x-www-form-urlencoded" },
        body: new URLSearchParams({ grant_type: "authorization_code", code: url.searchParams.get("code"), client_id: issuer }),
      });
      const tokens = await upstreamResponse.json();
      if (!upstreamResponse.ok || !tokens.access_token || !await isAdminUser(upstream, tokens.access_token)) {
        json(response, 403, { error: "access_denied", error_description: "Home Assistant owner or admin access is required" });
        return true;
      }
      const code = opaque();
      codes.set(code, { ...flow, tokens, expires: Date.now() + CODE_TTL_MS });
      const callback = new URL(flow.redirectUri);
      callback.searchParams.set("code", code);
      callback.searchParams.set("state", flow.state);
      redirect(response, callback.href);
      return true;
    }
    if (request.method === "POST" && url.pathname === "/token") {
      const form = await formBody(request);
      if (form.get("grant_type") === "authorization_code") {
        const authorization = codes.get(form.get("code"));
        codes.delete(form.get("code"));
        const verifier = form.get("code_verifier") || "";
        const calculated = createHash("sha256").update(verifier).digest("base64url");
        const validPkce = calculated.length === authorization?.challenge.length
          && timingSafeEqual(Buffer.from(calculated), Buffer.from(authorization.challenge));
        if (!authorization || authorization.expires < Date.now() || form.get("client_id") !== authorization.clientId || !validPkce) {
          json(response, 400, { error: "invalid_grant" }); return true;
        }
        json(response, 200, authorization.tokens); return true;
      }
      if (form.get("grant_type") === "refresh_token") {
        const upstreamResponse = await fetchImpl(`${upstream}/auth/token`, {
          method: "POST", headers: { "content-type": "application/x-www-form-urlencoded" },
          body: new URLSearchParams({ grant_type: "refresh_token", refresh_token: form.get("refresh_token") || "", client_id: issuer }),
        });
        json(response, upstreamResponse.status, await upstreamResponse.json()); return true;
      }
      json(response, 400, { error: "unsupported_grant_type" }); return true;
    }
    if (request.method === "POST" && url.pathname === "/revoke") {
      const form = await formBody(request);
      await fetchImpl(`${upstream}/auth/revoke`, { method: "POST", headers: { "content-type": "application/x-www-form-urlencoded" }, body: new URLSearchParams({ token: form.get("token") || "" }) });
      response.writeHead(200, { "cache-control": "no-store" }); response.end(); return true;
    }
    return false;
  }

  return { metadata, handle };
}
