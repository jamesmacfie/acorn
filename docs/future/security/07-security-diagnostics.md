# Phase 07: explain the effective security controls

Date: October 8, 2026. Status: proposed product requirements; implementation not started.
Source baseline: `079f5c948161ea8213bcdb25fe2fbefccab7d6f1`.
Dependency: can start independently; integrate phase 06 when its admission contract exists.

This phase adds **Check this node** under Settings > Security and backup. Give it to the developer
owning agent settings and the diagnostic contracts. It reports evidence without changing configuration.

## Problem and outcome

Acorn exposes disk encryption, agent defaults, tool permissions, plugin grants, skills, and harness
loop coverage in different places. A setting saying auto or sandboxed does not establish which files,
processes, or tools are restricted. Owners need to know what a running session actually receives.

The outcome is a bounded, on-demand report for the selected Node, with optional project and session
scope. Each finding names the evidence, its limits, and the settings page or document that resolves it.
There is no overall security score or green statement that the machine is safe.

## Starting points and owners

Read these owners and their tests:

- `packages/client-core/src/features/settings/SecuritySettings.tsx` owns the page and `core:security` slot.
- `packages/node-core/src/server/routes/security/security.ts` owns core's disk-encryption response.
- `plugins/agents/src/client/settings/AgentSecuritySection.tsx` contributes the agents section.
- `plugins/agents/src/server/sessions/loopHooks.ts` owns harness loop coverage.
- `plugins/agents/src/server/harnessRegistry.ts` and `plugins/agents/src/server/drivers/` own reported capabilities.
- `plugins/agents/src/server/mcpServerStore.ts` owns Acorn-configured servers and secret references.
- `plugins/agents/src/shared/mcpServers.ts` owns configured versus harness-reported MCP state.
- `packages/protocol/src/agents/toolPermissions.ts` owns the agent-tool tier defaults.
- `packages/node-core/src/server/agentTools/` and `packages/node-core/src/server/plugins/` own tool and plugin grants.

Read [loop coverage](../../managed-agents/loop-hooks.md#coverage), [defaults](../../managed-agents/defaults.md),
[MCP](../../mcp.md), and [audit privacy](../../security/audit.md).

## Required behaviour

Report these facts when their owner can supply them:

- Harness identity and version, reported permission profile, and filesystem and network restrictions.
- Whether tool policies reach every call, permission requests only, or no calls, separately by harness.
- Enabled instruction checks, their scope, last checked time, and incomplete or blocked outcomes.
- Acorn-managed MCP commands and endpoints, with unpinned package runners and shell-download patterns flagged.
- Harness-reported servers that Acorn does not manage, and any gap in visibility into global config or hooks.
- Plugin executable grants, development mode, skill approval state, and pending changed packages.
- Effective agent-tool tier and per-tool permissions, including any narrower session ceiling.
- A selected project's package manager, detected release-age and lifecycle-script policies, exceptions,
  alternate registry or Git sources, and unsupported configuration forms.

Package-manager inspection is static. A pnpm policy does not apply to npm, npx, Python package runners,
or arbitrary scripts. Presence of a file is evidence of configured intent, not proof that every
install respects it. Phase 08 owns detailed dependency parsing once it ships.

Use result states such as observed, configured only, unknown, unsupported, and failed. Keep severity
separate from evidence strength. A failed read is not evidence that a protection is off. Read live
session settings when available; distinguish them from defaults for the next session.

For each result include a stable check ID, owner, Node ID, scope IDs, checked time, evidence source,
bounded explanation, and repair action. Escape paths and external text. Show configuration filenames
and setting names rather than secret values or raw command output. Redact command arguments and URL
userinfo or query strings that can contain credentials. Do not export raw environment variables.

## Architecture and authority

Keep harness, instruction, and MCP diagnostics in agents. Draw them through `core:security`, respecting
the existing contributor limit. Extend the agents section rather than consuming a slot per check.
Core and other plugins retain ownership of their facts. Obtain them through existing public contracts
or a narrow capability; do not query peer plugin databases or import peer implementation files.

Use typed wire results and pure presentation logic. Share only contracts needed by multiple consumers;
do not introduce a general scanner framework or an unrestricted plugin inspection API. A project
diagnostic must resolve the selected project's canonical root on the Node before reading files.

Reports and inspection routes are device-only, including reads. They reveal configuration paths and
authority. A plugin frame or task agent cannot invoke **Check this node** or read another project's
diagnostics. Keep core's disk-encryption wire contract compatible.

The report performs no install, MCP launch, model call, shell startup, login, or network token
validation. It may use bounded trusted harness metadata commands only after verifying that they
cannot load user hooks or servers. Otherwise report unknown and provide a manual verification action.
Cancel work on Node switch, refuse late results from the previous Node, and expire displayed evidence.
Store no report history by default. Reports identify owner-level host access as a residual limit.

## Implementation sequence

1. Inventory the facts owners can report without launching configured executable code.
2. Define bounded result contracts and implement independent collectors with cancellation and deadlines.
3. Add device-only report routes and the agents section's **Check this node** action.
4. Add project and running-session selection, freshness labels, and links to owning settings.
5. Integrate phase 06, phase 08, and phase 09 results when their typed contracts exist.

Unsupported harnesses remain useful in Acorn and receive unknown coverage. Do not change agent modes,
defaults, personal configuration files, or project install policy as a side effect of a report.

## Acceptance and verification

Prove these behaviours:

- Reported session settings override a conflicting next-session default in the displayed evidence.
- A harness without metadata produces unknown, and a timed-out collector produces failed.
- Claude loop coverage and Codex permission-only coverage agree with the runtime's own descriptors.
- A managed server using an unpinned runner is flagged without starting or installing it.
- Reading config that names a malicious executable does not run that executable or a user hook.
- A secret in an argument, header, environment entry, or URL is absent from API output and telemetry.
- Task and service principals cannot read reports; the selected device can inspect its paired Node.
- Node and project switching cancels work, and a late response cannot overwrite the selected report.
- No background timer scans projects while the page is closed.

Run `pnpm lint`, `pnpm test --filter=@acorn/plugin-agents --filter=@acorn/node-core --filter=@acorn/client-core`,
changed consumers' suites, and `pnpm --filter @acorn/arch-tests test`. Use the real desktop driver to
inspect configured, unknown, and failed results and switch between Nodes. Stop the session afterward.
Provide a terminal-compatible presentation or the established desktop-only fallback, with no dead action.
Update `docs/security.md`, `docs/managed-agents/loop-hooks.md`, and `docs/mcp.md` for shipped behaviour.

## Trade-offs and completion

This phase provides visibility, not enforcement. It deliberately avoids executing suspect tools to
find out whether they are safe. Completion requires accurate evidence and actionable unknown states,
not a count of scanners. Verify behaviour on the installed harness versions and record unsupported ones.
