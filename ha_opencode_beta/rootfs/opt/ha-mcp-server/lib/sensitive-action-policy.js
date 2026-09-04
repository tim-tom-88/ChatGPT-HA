import { createHash, randomBytes, timingSafeEqual } from "node:crypto";

const CONFIRMATION_TTL_MS = 5 * 60 * 1000;

export const ALWAYS_SENSITIVE_TOOLS = new Set([
  "update_component",
  "esphome_config_update",
  "esphome_config_create",
  "esphome_device_install",
  "esphome_serial",
  "hab_run",
  "zigporter_run",
  "supersede_decision",
]);

const SENSITIVE_SERVICE_DOMAINS = new Set(["alarm_control_panel", "lock", "update"]);
const SENSITIVE_SERVICE_WORDS = /(?:^|_)(?:delete|disarm|remove|restart|restore|shutdown|stop|unlock|update)(?:_|$)/i;
const SENSITIVE_COVER_WORDS = /(?:door|garage|gate)/i;
const SENSITIVE_TARGET_WORDS = /(?:alarm|door|firmware|garage|gate|restart|shutdown|update)/i;

function stableActionDigest(name, args) {
  const safeArgs = { ...(args || {}) };
  delete safeArgs.confirmation_token;
  return createHash("sha256").update(JSON.stringify([name, safeArgs])).digest();
}

export function requiresSensitiveConfirmation(name, args = {}) {
  if (name === "write_config_safe") return args.dry_run !== true;
  if (ALWAYS_SENSITIVE_TOOLS.has(name)) return true;
  if (name === "fire_event") return true;
  if (name !== "call_service") return false;

  const domain = String(args.domain || "").toLowerCase();
  const service = String(args.service || "").toLowerCase();
  if (SENSITIVE_SERVICE_DOMAINS.has(domain) || SENSITIVE_SERVICE_WORDS.test(service)) return true;
  const entityIds = args.target?.entity_id;
  const joined = Array.isArray(entityIds) ? entityIds.join(" ") : String(entityIds || "");
  if (SENSITIVE_TARGET_WORDS.test(joined)) return true;
  return domain === "cover" && service.includes("open") && SENSITIVE_COVER_WORDS.test(joined);
}

export function addConfirmationInput(tool) {
  if (!ALWAYS_SENSITIVE_TOOLS.has(tool.name) && !["call_service", "fire_event", "write_config_safe"].includes(tool.name)) {
    return tool;
  }
  return {
    ...tool,
    inputSchema: {
      ...tool.inputSchema,
      properties: {
        ...(tool.inputSchema?.properties || {}),
        confirmation_token: {
          type: "string",
          description: "One-time token returned by a prior CONFIRMATION_REQUIRED response after the user explicitly confirms the exact action.",
        },
      },
    },
  };
}

export function createSensitiveActionPolicy({ ttlMs = CONFIRMATION_TTL_MS } = {}) {
  const challenges = new Map();

  function prune(now) {
    for (const [token, challenge] of challenges) {
      if (challenge.expiresAt <= now) challenges.delete(token);
    }
  }

  return {
    authorize(name, args = {}, now = Date.now()) {
      if (!requiresSensitiveConfirmation(name, args)) return { allowed: true };
      prune(now);

      const supplied = typeof args.confirmation_token === "string" ? args.confirmation_token : "";
      const challenge = supplied ? challenges.get(supplied) : undefined;
      if (challenge) {
        const actual = stableActionDigest(name, args);
        const matches = timingSafeEqual(actual, challenge.digest) && challenge.expiresAt > now;
        challenges.delete(supplied);
        if (matches) return { allowed: true };
      }

      const token = randomBytes(24).toString("base64url");
      challenges.set(token, {
        digest: stableActionDigest(name, args),
        expiresAt: now + ttlMs,
      });
      return {
        allowed: false,
        token,
        expiresInSeconds: Math.floor(ttlMs / 1000),
      };
    },
  };
}
