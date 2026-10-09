# Phase 09: pin MCP packages and review tool changes

> Completion note — 2026-10-09. Optional managed installation accepts exact npm coordinates, resolves
> and installs with lifecycle scripts disabled, checks publication evidence for every locked version,
> and records npm's archive integrity plus lock, installed tree, executable, runtime, and policy identities.
> Staging, file reads, process output, deadlines, and cleanup are bounded. Device consent precedes the
> first Test or launch for each configuration and secret revision. Activation selects recorded local
> bytes atomically; a failed update leaves the previous selection. Active provider generations retain
> older installed roots until retirement. Command and HTTP modes remain supported. Review is off by
> default. When enabled, a session-owned proxy on the actual harness path withholds tools for separate
> device approval, binds the full canonical catalogue and configuration revision, and quarantines
> notifications, drift, interrupted listing, and stale approvals. Phase 07 reads passive management
> facts only. Personal harness configurations stay outside this proxy.
>
> Acceptance: On isolated desktop data, Settings planned, tested, and activated
> `@modelcontextprotocol/server-everything@2025.9.25` (127 locked packages; ten tools), then planned,
> tested, and activated `@modelcontextprotocol/server-everything@2025.11.25` (11 tools). The selected
> newer version and installation identity persisted across a stopped and restarted desktop. The
> previously observed Settings reset did not recur through these long flows; its transient node
> availability remount is covered by a client-core regression. Installed Claude Code and Codex each
> reached a reviewed HTTP fixture through Acorn's managed session driver. Both saw the initial refusal,
> produced a device review, called the approved echo tool, and refused a call after list change. Codex
> 0.159.2 kept its initial empty tool list within the already-running thread after approval; a new
> managed Codex session saw the stored approval and called the tool. Settings and the MCP guide disclose
> this refresh limit.
>
> Focused proof: SDK fixtures cover notification during a held list and approval, elicitation response,
> cancellation, request ceiling, aggregate catalogue deadline, disconnect/reconnect, and explicit event
> replay refusal. A/B/A silent drift remains quarantined, and a cancelled call waiting on catalogue
> admission never reaches the upstream tool. Installer fixtures cover transitive scripts and publication
> cutoff, cancellation, retained old bytes, selection conflicts, FIFO substitution, and pre-aborted reads.
> A local package canary confirmed real npm suppressed
> scripts during lock resolution and `npm ci`; a tampered integrity in its frozen lock made `npm ci`
> fail. npm is the archive integrity authority; Acorn does not independently re-verify tarballs.
> Scoped agents/client-core type checks and focused tests passed; the affected Node build and
> architecture/doc checks passed. The static service graph measured 3,209,061 B under a 3,210,000 B
> ceiling; installer, catalogue, and proxy remain lazy. No migration changed. Earlier broad-suite
> observations remain: host-access agents suite 180 files/1,315 tests, one skip; unrelated route golden
> missing GitHub `pulls/search` and sandbox socket/process cases are left untouched.
>
> Limits: Event replay is explicitly unavailable (HTTP 409), so a client reconnects to a fresh
> reviewed connection. A forwarded in-flight call cannot be undone after a later list change. Installed
> MCP code executes with the device user's authority; managed installation does not sandbox it. A host
> without no-follow file opens reports managed installation unavailable. Later
> phases must preserve the configuration-revision, consent, managed-root lease, and catalogue-approval
> contracts.

Date: October 8, 2026. Status: implemented October 9, 2026; historical plan follows.
Source baseline: `079f5c948161ea8213bcdb25fe2fbefccab7d6f1`.
Dependency: can start independently; phase 07 displays its management and coverage state.

This phase adds managed npm MCP installation and review of changed tool definitions. Give it to the
developer owning MCP configuration, provider startup, and the bounded MCP transport.

## Problem and outcome

An MCP configuration using an unpinned package runner can download different code at the next launch.
The Settings test also executes the configured command before listing tools. A successful connection
establishes availability, not safety. A server's description or schema can change what an agent reads.

The outcome is an optional managed package source with an exact recorded dependency graph, and an
optional tool-definition review on the actual connection exposed to a harness. Arbitrary commands and
HTTP servers retain support, with their authority and unverified behaviour disclosed.

## Starting points and owners

Read these owners and their tests:

- `plugins/agents/src/server/mcpServerStore.ts` stores configured servers and reveals secrets at startup.
- `plugins/agents/src/server/mcpProbe.ts` starts a stdio server or HTTP connection for Settings' test.
- `plugins/agents/src/server/routes/mcpServers.ts` gates configuration and test routes to devices.
- `plugins/agents/src/shared/mcpServers.ts` owns input, probe, and session wire contracts.
- `plugins/agents/src/server/sessions/providerSessionLifecycle.ts` resolves servers on start and resume.
- `plugins/agents/src/server/drivers/` translates configuration for each harness.
- `plugins/agents/src/client/settings/AgentMcpServersSettings.tsx` owns the Settings form.
- `packages/node-core/src/server/plugins/installer.ts` demonstrates archive integrity and confined extraction.
- `scripts/pack-node.mjs` demonstrates a resolved npm lockfile and release-age cutoff.

Read [MCP](../../mcp.md), [credential handling](../../security/credentials.md), and
[supply-chain limits](../../security/plugin-storage-and-supply-chain.md).

## Managed package installation

Add **Install an MCP package** for npm package coordinates and an exact version. Reject version ranges,
moving tags, Git URLs, and tarball URLs in this managed mode. Require the owner to choose the declared
binary when a package supplies multiple executables. Preserve command mode for other sources.

Resolve in a private staging directory through a trusted package-manager executable and explicit argv.
Disable lifecycle scripts, apply a seven-day publication cutoff to the resolved dependency graph,
and record an exact lockfile. A dependency without trustworthy publication evidence needs explicit
owner review; a cutoff exception binds package versions and is audited. Do not rely on Acorn's
workspace pnpm settings to govern an npm install in a different directory.

Install the frozen graph with scripts disabled, verify integrity, and validate the executable resolves
inside the installed package tree. Store package coordinates, registry origin, resolved graph and archive
digests, lockfile digest, binary choice, runtime identity, and policy version. Keep credentials separate.
Activation atomically selects the complete installed version. Failure or cancellation leaves the
previous version selected. Delete abandoned staging directories through a bounded cleanup path.

Updates are owner-requested and staged. Review the changed graph, source, scripts, and tool definitions
before activation. Do not auto-update. Packages requiring install scripts receive an actionable error;
this phase offers no unrestricted script escape. Launch installed bytes directly, without npx fetching
on each session start. A lockfile does not make package runtime execution safe.

Do not repurpose the Acorn plugin installer as an MCP loader. Extract a narrow shared integrity or
archive operation only if both consumers need it. Bound bytes, files, subprocess output, network time,
and installation concurrency; protect destination paths and Windows launch semantics.

## Tool-definition review

Add a per-server **Review tool definition changes** setting, off by default for migrated servers.
For enabled review, the first connection requires approval. Hash canonical full declarations, including
name, description, input/output schemas, annotations, and other fields forwarded to the model.
Bind the approval to the server configuration revision, managed package identity when present,
catalogue digest, and comparison version. Secret changes invalidate approval without disclosing values.

Show added, removed, and changed tools with escaped description and schema diffs. Invisible characters,
instruction-like prose, and sensitive paths are review findings, not an automatic proof of malware.
Do not reuse phase 06's instruction approval to approve an MCP catalogue.

Enforce review on the connection the harness actually uses. A separate Settings probe is insufficient:
the server can answer differently on another connection. Put a Node-owned session proxy in that path
when review is enabled. Keep the underlying server connection pinned to the admitted catalogue and
detect list changes. Quarantine changed definitions, invalidate pending decisions, and refuse calls to
tools whose declaration is no longer admitted. Recheck the actual catalogue before acknowledging.
An in-flight call cannot be undone; disclose and record that limit.

The proxy preserves supported initialize, tools, calls, notifications, elicitation, cancellation,
and other forwarded protocol features with deadlines and size bounds. Inventory SDK and harness
compatibility first. Unsupported features or unavailable enforcement produce a clear unavailable
review mode, not a label claiming protection. Preserve ordinary unreviewed server connections.

Review authority is device-only. Resolve server secrets in the Node and avoid broad inheritance into
the proxy or server. Preserve session task scope, token audience, and tool ceilings through the bridge.
Never widen a ceiling, proxy another task's Acorn server, or return stored secrets to the renderer.

## Test and connection consent

Before the first test or activation, show the command or endpoint, source, management state, and
declared credentials with values redacted. **Test** states that it executes local code or contacts the
server. Bind consent to that configuration revision. It is not approval of the resulting catalogue.

Global harness-configured servers remain outside this managed proxy unless the harness offers a
verified routing mechanism. Phase 07 reports that gap. Do not edit personal harness config or silently
trust its hooks to install a bridge. Command and HTTP modes retain their documented host authority.

## Acceptance and verification

Prove these behaviours:

- A managed install rejects ranges and recent versions, verifies the frozen graph, and runs no scripts.
- A canary lifecycle script remains unexecuted, including for transitive dependencies.
- Integrity mismatch, path escape, cancellation, or failed update leaves the previous selection intact.
- A session launch uses recorded bytes without package-runner downloads. Existing command and HTTP rows migrate intact.
- A server that returns different catalogues to probe and session is gated on the session's catalogue.
- Description-only, schema, annotation, and added/removed-tool changes invalidate approval.
- A list-change notification or catalogue drift refuses affected calls until the device reviews it.
- A configuration or secret change during approval returns a conflict and exposes no secret.
- Task, service, and plugin-frame callers cannot install, test, approve, or update servers.
- Elicitation, cancellation, resume, disconnect, and bounded failures work through the proxy on supported harnesses.

Use focused tests for `mcpProbe.test.ts` and `mcpServerStore.test.ts` in `@acorn/plugin-agents` while iterating.
Run `pnpm lint`, `pnpm test --filter=@acorn/plugin-agents --filter=@acorn/node-core --filter=@acorn/client-core`,
changed consumers' suites, and `pnpm --filter @acorn/arch-tests test`. Verify with both installed Claude
and Codex using a fixture MCP server. Exercise Settings, review, update, and restart in the real desktop
app, then stop the session. Update `docs/mcp.md` and `docs/security.md`.

## Research and limits

In the external checkout `references/chat-on-steroids/`, `installer.ts` uses exact npm versions and
disabled scripts. `plugin-refresh.ts` hashes tool declarations for refresh detection;
it does not itself prove a security approval boundary. Adapt the mechanisms, not the claimed purpose.
Unchanged metadata can conceal changed server behaviour, and a local MCP server still runs as the owner.
This phase pins and reviews inputs; it does not sandbox their execution.
