# Remember Computer Use approval for Acorn test builds

Date: 2026-10-01

Status: Proposed product requirements. Not implemented.

Owners: Agents plugin for approval projection and provider responses; desktop development tooling
for test application identity and instance discovery; device custody only if the integration requires
Acorn to own saved grants.

## Problem and outcome

An agent launches a freshly built Acorn window to verify a change. Computer Use then asks:
**Allow Computer Use to use "Acorn Preview Acceptance"?** The Acorn transcript presents **Allow**
and **Decline**, with no way to remember the decision. Repeated approvals interrupt unattended
testing, even when the user intends to trust the test application across agent sessions and rebuilds.

A user must be able to approve the Acorn test application once and let future agents use matching
test builds without another app-access prompt, while the grant remains valid. The agent must operate
the particular instance it launched, including when the user's normal Acorn window and another test
window are open. The user must be able to revoke the saved grant.

This grant concerns Computer Use app access. It does not approve unrelated shell commands, file
access, sensitive actions, other applications, or changes to operating-system permissions.

## Existing workflow and evidence

The existing [agent-driven desktop workflow](../local-development.md#agent-driven-desktop-development)
builds the checkout, launches an automation binary with isolated data and ports, and records a
session manifest. Its UI driver targets that session through WebDriver and controls the main
renderer. This remains the default path for renderer acceptance testing. Native menus, dialogs,
and host-owned child webviews require native Computer Use or manual acceptance.

Findings below describe the inspected checkout and installed integration on the date above:

- `plugins/agents/src/server/drivers/codexNormalizer.ts` forwards the MCP elicitation message and
  form schema to the shared normalizer. It does not forward approval persistence metadata.
- `plugins/agents/src/server/drivers/formElicitation.ts` maps an empty schema to **Allow** and
  **Decline**. Acceptance returns `action: 'accept'` and empty content, with no selected persistence
  scope. Structured MCP questions use the same module and must retain their existing behaviour.
- The installed macOS Computer Use integration advertises eligible scopes in elicitation metadata
  as `persist: ['session', 'always']`, or `['session']` when persistent approval is unavailable.
  It identifies the application by bundle identifier and reads a response annotation named
  `_meta.persist`. These are investigation findings, not a version-independent protocol guarantee.
- `plugins/agents/src/client/sessions/AgentRequestCard.tsx` renders the options in the request
  payload and submits the selected option ID through the existing managed request API.
- `plugins/agents/src/node/schema.ts` stores request payloads and resolutions as JSON, including
  the durable `resolving` state and an idempotency key. The ledger records a decision; it does not
  establish that Computer Use saved a reusable grant.
- `apps/desktop/scripts/agent/session.mjs` launches a debug executable directly and records the
  application PID, data directory, and WebDriver endpoint. A separate, stable native identity for
  this launch path has not been established by this investigation. The screenshot's app name alone
  does not prove how that instance was built or identified.

The official [Computer Use documentation](https://learn.chatgpt.com/docs/computer-use) describes
**Always allow** and revocation through ChatGPT's Computer Use settings. The
[configuration reference](https://learn.chatgpt.com/docs/config-file/config-reference) distinguishes
app access policy from approval: an `allow` policy entry still requires normal approval checks.
Do not treat an app-policy configuration entry as proof that prompts have been disabled.

## Scope and users

The primary user develops Acorn on macOS and runs managed Codex agents from Acorn. The first release
must support the installed Codex app-server and Computer Use integration used in that workflow,
with supported versions recorded in the acceptance evidence.

The release includes the approval scope projection, response validation, working persistence and
revocation, stable test application identity, and reliable instance targeting. Generic MCP forms,
ACP sessions, and the shared desktop and terminal request cards must remain compatible. Other
providers receive persistence controls only when their verified protocol supports them.

An Acorn-wide switch that accepts every elicitation is outside scope. So are direct edits to a
third-party permission database, disabling provider policy, automatically approving macOS security
dialogs, and replacing the existing WebDriver driver.

## Product requirements

### Approval card

1. When a verified app-access request offers session and persistent scopes, show **Allow for this
   session**, **Always allow**, and **Decline**. Use provider-supported scope wording if its session
   lifetime differs from the managed Acorn session, and explain that lifetime.
2. Display the target application's readable name and verified identity. Explain that **Always
   allow** applies to future sessions and matching application identities, including matching
   rebuilds. Display provider warnings supplied for the request.
3. Offer **Always allow** only when the provider advertises it and effective policy permits it.
   A session-only request exposes no persistent choice. A generic consent form without recognised
   approval metadata keeps its existing **Allow** and **Decline** controls.
4. Selecting a scope sends the corresponding provider response. Acorn must not label a transient
   acceptance as persistent, silently widen a session grant, or infer approval from the agent's text.
5. While a response is being sent, disable all choices and retain the existing resolving state.
   Provider rejection or transport failure must leave a truthful state with an actionable error.
   A sent response is not evidence that a grant was durably saved.
6. Transcript history records the selected scope and target identity. Historical cards cannot grant
   access again, and reconnects cannot replay an approval as a new decision.
7. Both desktop and terminal projections support the same advertised choices and scope explanation
   through the shared kit. Keyboard focus and activation must work without a pointer.

### Persistence and revocation

1. An explicit human selection of **Always allow** must survive the current tool call, a new managed
   agent session, a restart of Acorn and the provider processes, and a rebuild with the same supported
   test identity. Verify every lifetime independently.
2. Establish the owner of saved grants before implementing persistence. Prefer the integration's
   supported grant mechanism and existing store. If the host client must persist approvals, document
   and implement one authoritative store scoped to the computer that Computer Use controls. An
   Acorn transcript row or a new option ID is insufficient.
3. Provide a verified revocation path. If the integration owns grants, point users to its existing
   controls and verify that those controls revoke grants created through Acorn. If Acorn must own
   grants, provide a device settings list showing target identity and scope, with an explicit revoke
   action through a typed host seam. Do not add a second settings list backed by a competing store.
4. Revocation applies to the next protected access check without requiring an Acorn reinstall.
   Document whether an already executing action can finish. The next access must prompt or be denied
   according to policy.
5. Managed restrictions and provider prohibitions take precedence over saved approval. Policy denial,
   unsupported persistence, missing identity, and ambiguous identity must never create a saved grant.
6. Existing session-only and generic MCP approvals stay transient. Existing ledger rows without new
   metadata remain readable and do not become persistent approvals through migration.

### Test application identity and instance targeting

1. Establish one stable identity for the automation test application, distinct from normal Acorn.
   Keep it stable across checkout rebuilds and session names. Keep isolated data roots, ephemeral
   ports, automation-only features, and the normal application's instance lock semantics intact.
2. On macOS, verify the identity Computer Use actually reports for the directly launched debug
   executable. If the integration needs a test app bundle or signing arrangement, implement that
   through development tooling and document its requirements. Do not assume the production Tauri
   identifier describes a raw debug process.
3. Session status or the existing manifest must expose enough authoritative information to select
   the launched process and its intended window. Reuse the application PID and lifecycle checks;
   include the native app identity or window identity where the integration supports them. Paths and
   display names alone cannot select an instance when multiple windows are open.
4. After launch or relaunch, resolve the current live process from that session. Refuse a stopped,
   stale, ambiguous, or mismatched target. PID reuse must not direct an agent to an unrelated process.
5. Prove that the supported Computer Use API can address the required instance and native surfaces.
   If it cannot distinguish concurrent processes with the same app identity, document the limitation
   and implement an explicit conflict response. Never silently select another window or stop another
   session to remove the conflict. Accurate concurrent targeting remains a release acceptance gate.
6. Keep the session WebDriver path for main-renderer checks. Document how agents obtain the native
   target for surfaces beyond that driver and how they stop the test session afterward.

Persistent app approval trusts an application identity, not only processes an agent launched. State
this scope in the approval UI and documentation. A guarantee that permission applies exclusively to
agent-created processes would require separate provider support and must not be implied by a stable
test identity. Rebuild reuse follows the verified identity and signing rules of the integration.

## Architecture and data flow

The provider receives a Computer Use app-access request and sends an MCP elicitation over its
app-server connection. The Agents plugin driver validates and normalizes that request into a typed
approval descriptor. The Node-owned request ledger stores its presentation payload. Managed-agent
routes and events carry it through the existing protocol, custody broker, and client snapshot cache
to the shared request card.

The user's selected option travels back through the existing device-authenticated resolution route,
runtime idempotency handling, provider driver, and app-server response. The integration or verified
host approval mechanism then applies and stores the selected grant. Test instance discovery begins
in the launcher manifest and remains separate from approval policy.

Provider-specific metadata interpretation belongs in the driver adapter. Shared form code and the
request card consume a small validated shape covering target identity, supported scopes, warnings,
and response option mapping. Keep provider response construction in the adapter. Do not pass raw
metadata dictionaries into the UI or use display-message matching to classify permissions.

Validation must occur against the original pending request on resolution, not only against the
client payload. Reject forged option IDs, unadvertised scopes, a changed target, duplicate decisions,
and expired requests. Preserve the existing device-only approval route: an agent or delegated child
cannot approve itself or save a grant on the user's behalf.

The Node remains authoritative for session history. Local app grants belong to the computer on which
the integration runs. A remote Node cannot grant access to an app on the client computer merely by
receiving a resolution. State the executing host and scope in the implementation decision. Saved
grants must not synchronize across Nodes or devices implicitly.

Prefer additive fields in the existing JSON payload where compatible. Assess schema versions,
runtime validation, and old-client fallback before changing any shared contract. Never clear
transcripts, saved settings, task data, or provider state to deploy this feature. The Node/shell and
plugin import boundaries in [Architecture overview](../architecture-overview.md) still apply.

## Delivery gates

### Gate 1 Verify the protocol and ownership

Capture a real request and response from the supported integration through Acorn, including the
metadata location, advertised scopes, target identity, policy restrictions, and response annotation.
Record app-server, integration, OS, and Acorn versions. Establish whether sending `_meta.persist`
alone saves a grant or whether the host must explicitly persist and subsequently consult it.

Prove persistence and revocation in a focused experiment before designing storage. Verify debug app
identity and concurrent instance selection. Deliver a short implementation decision naming state
owners, supported versions, capability detection, identity/signing rules, required host seams, and
fallbacks. Resolve any unsupported protocol requirement before promising an **Always allow** control.

### Gate 2 Implement approval scope support

Carry validated approval metadata through normalization, the ledger, API snapshots, and the shared
card. Implement scope-specific provider responses, original-request validation, truthful resolution
history, and the verified persistence/revocation mechanism. Keep generic forms and provider sessions
without persistence support compatible.

### Gate 3 Integrate the test launcher and accept the workflow

Establish the stable test identity and authoritative native target discovery. Exercise rebuilds,
fresh sessions, process restarts, revocation, policy denial, and concurrent windows. Document the
agent workflow and supported limits. Update [Managed agents](../managed-agents.md),
[Client surfaces](../managed-agents/client-surfaces.md),
[Local development](../local-development.md), and the relevant state, security, and testing owners
when behaviour ships. Retain this PRD only while acceptance remains open.

## Acceptance scenarios

| ID | Scenario | Pass condition |
| --- | --- | --- |
| A1 | An eligible app-access request arrives in Acorn. | Correct target and scope explanation appear with session, persistent, and decline choices. |
| A2 | User allows this session. | Access succeeds for the verified lifetime; a fresh session requests approval again. |
| A3 | User chooses Always allow, then creates a new agent session. | Matching test app access succeeds without another app-access prompt. |
| A4 | Acorn and provider processes restart after A3. | Matching access still succeeds without another app-access prompt. |
| A5 | Checkout is rebuilt and launched with a new test session name. | The stable test identity matches the saved grant and access succeeds. |
| A6 | User revokes the grant using the documented controls. | The next protected access prompts or is denied; history does not resurrect the grant. |
| A7 | Normal Acorn and two isolated test instances are open. | Agent operates its own live test instance and requested native surface; other instances receive no input. |
| A8 | Test instance stops, relaunches, or a recorded PID is reused. | Discovery resolves the current intended instance or refuses the target; no unrelated process receives input. |
| A9 | Provider offers only session approval, disables persistence, or blocks the app. | No persistent control or grant is created; denial is visible and policy remains authoritative. |
| A10 | Metadata is absent, malformed, oversized, or contains unknown scopes. | Existing consent/form behaviour remains safe; unsupported scopes cannot be submitted or saved. |
| A11 | Client submits a forged target/scope, a duplicate answer, or an expired response. | Server validates against the original request and refuses invalid decisions without widening access. |
| A12 | Generic MCP questions, ACP consent, and older transcript rows are displayed. | Existing typed answers, transient approval, and history remain compatible. |
| A13 | Desktop or terminal user selects the persistent choice by keyboard. | Target and scope are readable, focus works, and the correct response reaches the provider once. |
| A14 | Agent or delegated child attempts the resolution route. | Device-only authority blocks self-approval, including persistence. |
| A15 | Provider response fails or cannot save the grant. | UI reports a truthful failure or verified transient result; no claim of saved access appears. |
| A16 | Main renderer and a native menu or child webview are tested. | Session driver targets the renderer; native control targets that session's verified application instance. |

Success means A1-A16 pass on the declared macOS reference setup. A visible **Always allow** button
without demonstrated cross-session reuse and revocation does not satisfy acceptance. Record other
platforms and providers as verified, unsupported, or deferred rather than inferring support.

## Verification and handoff

Add deterministic coverage for metadata validation, scope mapping, response construction, generic
form compatibility, request lifecycle/idempotency, original-request validation, device authority,
old payloads, shared card interaction, and test target discovery. Use sanitized real protocol
captures for the integration-specific contract and label synthetic cases.

Run `pnpm lint`, relevant Agents plugin and launcher tests, and the architecture contract tests.
Run `pnpm --filter @acorn/desktop test` if launcher or shell behaviour changes. Use `pnpm test` for
the full suite so its concurrency limit remains effective.

Test the approval card in a real Tauri window with an isolated `pnpm dev:agent -- --session <name>`
launch. Use `pnpm dev:agent:ui -- --session <name> snapshot` after each renderer transition and
capture screenshots. Finish each session with `pnpm dev:agent:ui -- --session <name> stop`. Use
native Computer Use or manual inspection for native surfaces and the approval-store controls.
Verify terminal changes through the isolated PTY workflow in [Local development](../local-development.md).

Hand off the implementation decision, sanitized captures, completed acceptance matrix, real-window
evidence, persistence/revocation walkthrough, supported version matrix, and updated owning docs.
Exclude secrets, full tool parameters, and unrelated application contents from captures and logs.

## Verify before building

Paths identify investigation points rather than frozen APIs. Reread the code and its tests before
placing changes or selecting storage.

- `plugins/agents/src/server/drivers/codexNormalizer.ts`, `codexDriver.ts`, and their adjacent tests:
  request metadata, pending request ownership, protocol response, and capability discovery.
- `plugins/agents/src/server/drivers/formElicitation.ts` and `acpDriver.ts`: shared form semantics and
  ACP compatibility; do not apply Codex-specific response extensions indiscriminately.
- `plugins/agents/src/contract/wire.ts`, `plugins/agents/src/node/schema.ts`, and
  `plugins/agents/src/server/sessions/boundProviderEvent.ts`: serializable descriptors and JSON history.
- `plugins/agents/src/server/sessions/runtime.ts` and
  `plugins/agents/src/server/routes/managed.ts`: resolving claims, idempotency, expiry, and device guards.
- `plugins/agents/src/client/sessions/AgentRequestCard.tsx`, `managedClient.ts`, and `managedStore.ts`:
  shared rendering, resolution dispatch, snapshot updates, and reconnect behaviour.
- `apps/desktop/scripts/agent/session.mjs`, `state.mjs`, and `ui.mjs`: launcher lifecycle, manifest
  ownership, native target discovery, and isolated test sessions.
- `apps/desktop/src-tauri/tauri.conf.json` and `apps/desktop/src-tauri/Cargo.toml`: production identity,
  signing configuration, and the automation-only feature; verify raw debug identity separately.
- Confirm the installed integration's grant owner, revocation controls, native identity rules,
  exact-instance APIs, and effective managed policy before implementing persistent approvals.
