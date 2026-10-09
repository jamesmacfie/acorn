# Phase 07: explain the effective security controls

## Follow-up completion note: October 9, 2026

The follow-up adds a narrow, read-only core plugin-host projection to the compiled core service:
counts of active executable grants, development mode, enabled approved and unapproved skills, and
pending changed packages. The composition roots attach it after host assembly. Plugin names and
manifest text never enter the report. The agents runtime reads only its existing provider descriptor
cache. Loop coverage now follows reported `loop_before_tool`, `loop_after_tool`, and `permissions`
capabilities, so a familiar provider ID alone confers no coverage claim. Unsupported and absent
descriptors are distinct.

Pre-turn admission retains one latest passed, blocked, or incomplete outcome per task, capped at 100
tasks in memory. The diagnostic reads an existing admission instance without creating one or scanning;
project selection uses the most recent matching task. Disabled checks have no observation. The
previous approval lookup was removed because the store validates approvals by decrypting bodies;
approval status is therefore unknown in this passive report. The
selected project policy reader opens with `O_NONBLOCK`, rejects nonregular files before reading,
handles partial reads, and refuses growth beyond 32 KiB. The route golden now includes only the two
Phase 07 device routes; its unrelated GitHub pulls search mismatch remains open. Settings links were
checked against the registered tabs and the existing project settings target.

Focused evidence: collector 12 tests, admission 5, passive provider cache 12, core plugin-host state
23, UI 2, architecture 87, and TypeScript for agents, Node core, and Node app passed. Changed-code
oxlint found no new issue (one existing
`no-useless-spread` warning in the runtime engine). The route registry test passes 35 of 36 tests;
the remaining mismatch is the pre-existing GitHub pulls search route. The Node service build passes
at 3,188,702 B after confirming `pluginSecurity.ts` stays outside the static graph. Its ceiling rose
1 KB to 3,189,000 B for the boot-required cache readers and lazy projection wiring. The locked
offline pnpm reinstall reused all 546 packages after pnpm 11 invalidated stale links. No new live
harness or second-Node desktop fixture was run. Phase 08 still owns dependency parsing; Phase 09 still owns managed MCP
installation and review. Neither should trigger executable work from this report.

## Completion note: October 9, 2026

Status: implemented with explicit unknown and unsupported evidence. **Check this node** now lives in
the existing agents `core:security` section. Its two device-only routes provide scope choices and an
on-demand report. Findings carry stable IDs, owner and scope, time, separate evidence state and
severity, source, limit, and action. The page keeps one report only, expires it after five minutes,
aborts requests and rejects late replies on Node or scope change, and stops its freshness timer on
unmount. The terminal client uses its existing desktop fallback for this core page.

The collector reads stored instruction settings, managed MCP
definitions, core tool preferences, and a selected running session's recorded harness options and
tool ceiling. Core supplies a narrow registered tool-name and risk catalog so the report can show
effective per-tool grants after the selected ceiling. Follow-up evidence interprets only cached
provider capabilities, with no executable probe. Static project reads use the canonical project path, fixed
filenames, `O_NOFOLLOW`, `O_NONBLOCK`, and 32 KiB file caps. The report does not execute configured code or return
arguments, environment or header values, URL credentials or query strings, or provider output.
Current-session permission evidence is separate from the next-session default. A changed default
cannot overwrite live evidence.

Unknown remains explicit for unobserved harness executable versions and restrictions, global or
harness-owned MCP servers, absent admission observations, and detailed dependency policy. The
instruction admission contract now retains only the latest in-memory outcome per task, with no report
history. The plugin host supplies bounded counts through a narrow passive projection. Phase 08 should
replace the static project policy summary with its typed dependency result. Phase 09 should add its
managed MCP review result without exposing command arguments or credentials. Neither should call a
configured executable from this route. No disk-encryption wire change was made.

Evidence: focused agents collector (four tests), route (two tests), and UI cancellation (two tests)
pass. The fixtures include a malicious command name, synthetic argument, header, environment and URL
secrets, a symlink escape, conflicting session/default permissions, unknown metadata, and a 4-second
deadline. Agents and Node TypeScript checks pass; architecture tests pass (87 tests). The Node
service build passes at 3,187,622 B after tracing its boot route, with a documented 2 KB ceiling
increase. The isolated desktop fixture displayed configured and unknown results on its one paired
Node; a screenshot was saved under the task's ignored `.acorn/agent-dev` directory. The terminal
settings test passes (five tests). The installed desktop helper reported Node 24.21.0; the build
tooling used Node 26.9.0. No harness version probe was run, because its passive safety was not
established. Earlier phase evidence names Claude Code 2.1.292 and Codex 0.159.2, but those versions
were not independently checked in this fixture. Manual gaps: the fixture had no running session or
second Node, so live-session and Node-switch presentation were verified by focused tests, not by
desktop interaction. The desktop driver could not select the fixture project from its popover after
the option reference went stale; project read and scope clearing have focused tests.

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
