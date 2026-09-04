import { describe, expect, it } from "vitest";
import {
  addConfirmationInput,
  createSensitiveActionPolicy,
  requiresSensitiveConfirmation,
} from "../lib/sensitive-action-policy.js";

describe("remote sensitive-action policy", () => {
  it("allows reads and routine household controls", () => {
    expect(requiresSensitiveConfirmation("get_states", {})).toBe(false);
    expect(requiresSensitiveConfirmation("call_service", {
      domain: "light",
      service: "turn_off",
      target: { entity_id: "light.kitchen" },
    })).toBe(false);
  });

  it("classifies security, availability, configuration, and broad CLI actions", () => {
    expect(requiresSensitiveConfirmation("call_service", { domain: "lock", service: "unlock" })).toBe(true);
    expect(requiresSensitiveConfirmation("call_service", {
      domain: "cover",
      service: "open_cover",
      target: { entity_id: "cover.garage_door" },
    })).toBe(true);
    expect(requiresSensitiveConfirmation("update_component", {})).toBe(true);
    expect(requiresSensitiveConfirmation("write_config_safe", { dry_run: false })).toBe(true);
    expect(requiresSensitiveConfirmation("write_config_safe", { dry_run: true })).toBe(false);
    expect(requiresSensitiveConfirmation("hab_run", { command: "dashboard list" })).toBe(true);
  });

  it("issues an exact, expiring, single-use confirmation token", () => {
    const policy = createSensitiveActionPolicy({ ttlMs: 1_000 });
    const action = { domain: "lock", service: "unlock", target: { entity_id: "lock.front_door" } };
    const challenge = policy.authorize("call_service", action, 100);

    expect(challenge.allowed).toBe(false);
    expect(policy.authorize("call_service", { ...action, confirmation_token: challenge.token }, 200)).toEqual({ allowed: true });
    expect(policy.authorize("call_service", { ...action, confirmation_token: challenge.token }, 300).allowed).toBe(false);
  });

  it("does not allow a confirmation token to authorize a changed action", () => {
    const policy = createSensitiveActionPolicy();
    const challenge = policy.authorize("call_service", { domain: "lock", service: "lock" });
    expect(policy.authorize("call_service", {
      domain: "lock",
      service: "unlock",
      confirmation_token: challenge.token,
    }).allowed).toBe(false);
  });

  it("advertises the confirmation token only on potentially sensitive tools", () => {
    const base = { inputSchema: { type: "object", properties: {}, additionalProperties: false } };
    expect(addConfirmationInput({ ...base, name: "call_service" }).inputSchema.properties.confirmation_token).toBeDefined();
    expect(addConfirmationInput({ ...base, name: "get_states" }).inputSchema.properties.confirmation_token).toBeUndefined();
  });
});
