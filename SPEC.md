# ChatGPT Home Assistant MCP App

## Status

Discovery complete and approved. Version-one implementation is present in the beta add-on; deployment against a real Home Assistant Supervisor and ChatGPT account remains to be verified.

## Value Proposition

Provide one private ChatGPT connection to the user's Home Assistant installation so ordinary ChatGPT conversations can inspect, control, diagnose, and—with explicit confirmation—reconfigure the home without maintaining a per-entity allowlist.

**Initial user:** The owner of the Home Assistant instance. Multi-user sharing and public directory distribution are out of scope for version one.

**Current pain:** The existing Home Assistant MCP/Assist exposure model requires individually selecting what the assistant may access. That repeated curation undermines the purpose of a whole-home conversational assistant.

**Core actions:**

1. Discover and read all areas, devices, entities, current states, and relevant history.
2. Execute ordinary Home Assistant service actions and complete multi-step household requests in one conversation.
3. Diagnose problems and propose or apply configuration changes through validated, recoverable workflows.

## Why ChatGPT

**Conversational win:** Requests can describe outcomes across devices and areas—such as “turn everything downstairs off except the hall light”—without requiring the user to know entity IDs, service names, or dashboard locations.

**What the LLM contributes:** Intent interpretation, entity and service selection, planning across several tool calls, summarisation of state/history, troubleshooting, and generation or review of Home Assistant configuration.

**What the LLM lacks:** Live access to this installation, Home Assistant credentials, authoritative entity/device data, service execution, configuration validation, and a safe mechanism for consequential changes. The MCP server supplies those capabilities.

## Chat Experience

The first version is chat-first and has no custom dashboard or embedded widget.

1. The user connects the private app to ChatGPT once.
2. ChatGPT can discover the installation without a manually curated entity allowlist.
3. Read requests and routine controls run conversationally and may use multiple tool calls in one turn.
4. Results briefly identify what was read, changed, skipped, or failed.
5. Configuration changes are drafted and validated before application.
6. Major or security-sensitive actions require explicit user confirmation immediately before execution.

## Safety and Approval Model

The server exposes accurate MCP safety annotations, but server-side policy remains authoritative; client behaviour is not treated as the only safety boundary.

### No additional confirmation by default

- Read-only discovery, state, history, logs, diagnostics, and documentation.
- Routine reversible controls such as lights, ordinary switches, climate setpoints, media players, covers that are not designated entry/security barriers, and scene activation.
- Multi-step combinations of the above when they stay within the user's request.

### Explicit confirmation required

- Locks, alarm panels, garage doors, gates, and other entry/security controls.
- Deletion, destructive registry operations, or broad configuration replacement.
- Home Assistant, OS, Supervisor, add-on, integration, or firmware updates.
- Restarts, shutdowns, backup restoration, or actions with material availability impact.
- Applying generated configuration or file edits. Drafting, reading, and validation do not require confirmation.

The sensitive-action policy must be configurable and default to the conservative categories above. Secrets and internal Home Assistant storage remain inaccessible to model output.

## Product and Technical Context

- **Upstream:** `magnusoverli/opencode`, a Home Assistant add-on containing a broad MCP server and safety-oriented configuration workflows.
- **Fork:** `tim-tom-88/ChatGPT-HA`.
- **Local repository:** This checkout, with `origin` set to the fork and `upstream` set to the original project.
- **Existing public Home Assistant URL:** `https://ha.hodgsonhome.uk`.
- **Existing native endpoint:** `https://ha.hodgsonhome.uk/api/mcp`.
- **Current upstream MCP transport:** Local stdio, authenticated internally with the Home Assistant Supervisor token.
- **Target client:** A private ChatGPT app/custom connector available in ordinary ChatGPT conversations.

## Architecture Direction

The existing `/api/mcp` endpoint is Home Assistant's native MCP surface and may inherit Home Assistant's Assist entity-exposure rules. It therefore cannot be assumed to solve the all-entity requirement.

The fork should add a distinct remote MCP service around the add-on's existing broad tool implementation:

- Streamable HTTP transport over HTTPS.
- A stable endpoint distinct from Home Assistant's native `/api/mcp` route, provisionally `/chatgpt-ha/mcp`.
- Home Assistant OAuth authentication: advertise Home Assistant's authorization and token endpoints, then validate each short-lived user access token before MCP dispatch. Credentials must never be embedded in repository files or tool output.
- Requests run inside the add-on and continue using the Supervisor-backed Home Assistant APIs internally.
- No raw public exposure of the Supervisor token or the existing stdio process.
- Server-side policy enforcement for sensitive tools and targets.
- Health/readiness endpoint that reveals no private Home Assistant data.

The final external route may be provided by the existing reverse proxy or another HTTPS tunnel. Deployment instructions must document the required forwarding and streaming behaviour without assuming one vendor.

## UX Flows and MCP API

No custom UI is required for version one; ChatGPT is the complete interface.

**Inspect and diagnose:** ChatGPT discovers relevant areas/entities, obtains bounded live or historical data, and explains the result using the existing read-only MCP tools.

**Routine control:** ChatGPT resolves the user's intent and calls `call_service` one or more times. Ordinary reversible household controls execute directly and return affected entities or response data.

**Sensitive control:** A sensitive tool call returns `CONFIRMATION_REQUIRED` with an exact, short-lived, single-use challenge. ChatGPT asks the user to confirm, then retries the unchanged action with that challenge. Changed, expired, and replayed challenges fail closed.

**Configuration:** ChatGPT reads and validates configuration, presents the proposed change, obtains confirmation through the same sensitive-action flow, then applies it with `write_config_safe`.

The remote endpoint publishes standard MCP titles, schemas, and `readOnlyHint`, `destructiveHint`, `idempotentHint`, and `openWorldHint` annotations. The existing local OpenCode transport retains its conservative compatibility representation.

## Version-One Deliverables

1. Remote MCP transport and lifecycle integrated into the Home Assistant add-on.
2. Authentication and protected-resource metadata required by the ChatGPT connection flow.
3. Broad read/control tools derived from the existing server without per-entity curation.
4. Sensitive-action confirmation enforcement and correct MCP annotations.
5. Add-on configuration for enabling the remote endpoint, authentication, and policy options.
6. Focused tests for unauthenticated access, ordinary actions, sensitive actions, and credential leakage.
7. Setup documentation for the public HTTPS route and ChatGPT connection.

## Out of Scope for Version One

- Public marketplace publication or general multi-tenant hosting.
- A replacement Home Assistant dashboard.
- Voice hardware or wake-word handling outside ChatGPT.
- Removing all safeguards or giving the model unrestricted shell access.
- Direct access to `secrets.yaml`, `.storage`, `.cloud`, private keys, or Home Assistant databases.

## Open Implementation Checks

- Confirm whether ChatGPT accepts Home Assistant's IndieAuth-style public client directly or requires a non-empty client secret/dynamic registration; if required, add a small OAuth broker rather than weakening the endpoint.
- Confirm whether the existing reverse proxy can forward a second streaming MCP route to an add-on port.
- Verify whether any useful native Home Assistant MCP capabilities can be composed without inheriting its entity allowlist.
- Version-one changes are isolated to `ha_opencode_beta/`, consistent with upstream's channel policy.
