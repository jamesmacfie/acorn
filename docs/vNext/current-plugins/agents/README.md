# Agents system plugin

**Status:** Normative current-plugin migration<br>
**Coordinate:** `acorn/agents`<br>
**Distribution:** System; release-signed, version-locked, installed by the default profile<br>
**Runtime:** In-process system service on the Node plus bundled semantic Electron contributions<br>
**Requirement prefix:** `CUR-AGENT`

Agents is Acorn's task-scoped conversational execution domain. It owns provider adapters, managed
sessions, the normalized transcript, durable turn scheduling, provider requests, attachments,
artifacts, Agent Center, and the task Agent pane. It does not own generic process, PTY, file, Git,
secret, workspace, task, workflow, notification, or navigation primitives.

This specification is divided into:

- [Node and data](./node-and-data.md)
- [Client and UI](./client-and-ui.md)
- [Contracts, events, and security](./contracts-events-and-security.md)
- [Migration and parity](./migration-and-parity.md)

The mandatory twelve-section template is distributed without omission: sections 1–3 and 9 are in
this overview; sections 4 and 8 are in Node/data plus Client/UI; sections 5–6 and 10 are in
Contracts/events/security; section 7 is in Client/UI; and sections 11–12 are in Migration/parity.

## Current behavior and authority

V1 supports structured Claude Code sessions through ACP and Codex sessions through app-server v2.
Other profiles remain raw Terminal sessions. Every managed session belongs to one task and its
worktree. Provider protocol events are normalized into an append-only session event ledger with
session, turn, and request projections. The runtime supports a durable turn queue, capability-based
provider configuration, permission/question resolution, cancellation, resume, fork, compact,
archive, deletion, export, transcript import, controller handoff, attachments, large artifacts,
search, usage, pricing, waits, and signed completion/attention webhooks.

The V1 product surfaces are Agent Center, a task Agent pane, the same-task Agent sidebar, usage and
pricing settings, attention/notification integration, context selection, queued-turn controls,
request cards, tool cards, and typed deep links to specialist panes. The utility service is already
the runtime owner, but persistence is in core SQLite and the plugin directly depends on Terminal and
Workflow implementations in several composition paths.

`CUR-AGENT-001` The V2 resource hierarchy MUST be
`workspace → task → agent-session → agent-turn/event/request/artifact`, with every resource carrying
the owning Node URI. A session MUST NOT exist outside a task or execute from a repository root that
is not the task worktree.

`CUR-AGENT-002` The normalized Acorn event ledger is the local presentation and replay authority.
Provider wire messages and raw provider responses MUST NOT cross the driver boundary or become
durable domain objects.

`CUR-AGENT-003` Provider resumability remains provider-owned. A stored provider reference is opaque
and MUST be verified through the driver before Acorn treats it as resumable.

`CUR-AGENT-004` The plugin MUST preserve an explicit raw-terminal escape hatch. A terminal heuristic
MUST NOT be promoted to protocol authority, a permission card, or a managed-session event.

## Target ownership

| Concern | V2 owner |
| --- | --- |
| Session, turn, request, transcript, artifact domain | Agents Node service |
| Provider discovery, normalization, scheduling, recovery | Agents Node service |
| Task/workspace identity and worktree | Node core |
| Executable resolution, process and PTY primitives | Node core |
| Credential storage and provider credential use | Node secret/provider broker |
| Files, Git, terminal and specialist tools | Owning core/plugin capabilities |
| Workflow orchestration and budgets | Workflows plugin; Agents executes a declared agent step |
| Product-event retention and delivery | Core outbox/event broker |
| Agent Center, Agent pane, transcript and composer | Bundled Electron contribution |
| Approval chrome and high-risk confirmations | Electron host |
| Notifications and fleet aggregation | Electron shell over Node attention/events |

`CUR-AGENT-005` Agents MUST consume task-scoped core handles rather than filesystem paths or process
objects. The Node derives workspace, repository, worktree, and provider-account scope from the
target session.

`CUR-AGENT-006` Every tool operation MUST execute with the intersection of owner delegation, agent
session policy, plugin grant, task/repository policy, provider-request scope, and the called
capability's policy. System trust MUST NOT create an authority fast path.

`CUR-AGENT-007` Agents MUST be available on bundled and remote Nodes. Electron connects to the
owning Node for domain state and streams; it does not run the provider process or require the
provider executable locally.

## System manifest

The release manifest declares:

- a Node `system` runtime artifact;
- declarative UI documents and the bundled `acorn.agent-timeline/2` Client renderer integration;
- Agent Center `fleet-source`, task `task-pane`, settings pages, commands, keybindings,
  `attention-item`, `notification`, `context-section`, `agent-tool-renderer`, and navigation
  contributions;
- exported agent execution and context capabilities;
- subscribed core task, workspace, permission, and grant-revocation events;
- optional dependencies on Terminal and Workflows public contracts; and
- isolated database, attachment/artifact stores, health checks, and release-coupled migrations.

`CUR-AGENT-008` Required capabilities are `core.workspace:read`, `core.task:read`,
task-rooted `core.file:read`, fixed provider `core.process` operations, brokered provider
`core.secret:use`, `core.events:publish|subscribe`, own `core.storage`, and declared `core.ui`
contributions. `core.file:write`, `core.git`, `core.terminal`, `core.agent:approve`,
`core.network`, and external-send capabilities MUST be optional, operation-scoped grants.

`CUR-AGENT-009` The Agents package is not independently installable, removable, downgradable, or
replaceable. Provider profile/driver packages MAY be independently updated only when their
negotiated public driver contract remains compatible with the release-locked Agents host.

## Lifecycle and service levels

`CUR-AGENT-010` Node startup MUST open and migrate the isolated Agents database, reconcile
unfinished operations and object references, discover drivers, expire unsafe request claims, resume
eligible sessions, and only then report `ready`.

`CUR-AGENT-011` Failure to start Agents MUST leave the Fleet shell, workspaces, tasks, Terminal, and
other plugins usable. Its contributions remain visible as unavailable with diagnostics and recovery
actions.

`CUR-AGENT-012` Graceful shutdown MUST stop accepting turns, persist queue state, cancel or
checkpoint provider work according to driver semantics, expire unresolved approvals without
granting them, stop child processes, flush outboxes, and close object/database handles.

`CUR-AGENT-013` Health is `ready`, `degraded`, `blocked-setup`, `failed`, or `quarantined`.
Provider-local failure degrades only that provider; database corruption, event-commit failure, or
authority-broker failure fails the plugin.

## Compatibility invariants

`CUR-AGENT-014` Provider capabilities and configuration options MUST be descriptor-driven. The
Client MUST NOT infer support from provider, profile, executable, or model names.

`CUR-AGENT-015` Runtime state, attention reason, and status authority remain separate vocabularies.
The exact V2 values and transitions are fixed in [Node and data](./node-and-data.md).

`CUR-AGENT-016` One session has exactly one input controller: `acorn`, `terminal`, or `external`.
Managed and raw terminal clients MUST NOT concurrently send to the same provider session.

`CUR-AGENT-017` One turn may execute at a time per session. Default scheduling limits remain three
active turns per workspace and two per provider account, with durable queueing and bounded aging.
Node policy may lower these values but MUST surface the effective limits.

`CUR-AGENT-018` Imported transcripts are read-only history unless an opaque provider reference
passes live verification. Import MUST NOT fabricate a provider session or send imported content
back to a provider.

`CUR-AGENT-019` The fresh-install experience and acceptance cases in
[Migration and parity](./migration-and-parity.md) are release gates, not examples.
