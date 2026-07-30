# Workflows verified plugin

**Status:** Normative current-plugin migration<br>
**Coordinate:** `acorn/workflows`<br>
**Distribution:** Acorn Verified; independently versioned and installed by the default profile<br>
**Runtime:** Supervised WASI Node runner plus independently verified semantic Electron contributions<br>
**Requirement prefix:** `CUR-WF`

Workflows is Acorn's durable orchestration plugin. It validates declarative workflow definitions,
checkpoints runs and steps, enforces gates/policies/tool ceilings/budgets, coordinates typed
capabilities across plugins, and projects run activity into Electron. It does not own tasks,
worktrees, agents, terminals, GitHub checks, notes, memory, processes, credentials or the scheduler.

This specification is divided into:

- [Node and data](./node-and-data.md)
- [Client and UI](./client-and-ui.md)
- [Contracts, events, and security](./contracts-events-and-security.md)
- [Migration and parity](./migration-and-parity.md)

The mandatory twelve-section template is distributed without omission: sections 1–3 and 9 are in
this overview; sections 4 and 8 are in Node/data plus Client/UI; sections 5–6 and 10 are in
Contracts/events/security; section 7 is in Client/UI; and sections 11–12 are in Migration/parity.

## Current behavior and authority

V1 loads `.acorn/workflows/*.toml` from a task checkout and `~/.acorn/workflows`, with repository
definitions winning by ID. It validates/expands sub-workflows, freezes a definition at start and
checkpoints `workflow_runs` and `workflow_steps` in core SQLite. Built-in kinds are `agent`,
`gate-human`, `gate-policy`, `ci-loop`, `fan-out`, `join` and `decide`; the built-in policy is
`checks-green`. Tool ceilings and budgets only narrow, structured output is edge currency,
`${steps.<name>.output}` references earlier successful steps, and `decide` performs forward
branching. A four-slot runner bounds Agent work, CI loops cap at eight turns and fan-out caps at
twelve child tasks.

V1 exposes a read-only settings inspector, `Workflow:` command-palette rows, workflow activity and
gate buttons inside the Agents task sidebar, HTTP controls, WebSocket notices/status/step events and
an app-visible 30-second trigger poller. The service owns the runner, but composition directly
imports Agents, Terminal, GitHub/checks, Notes, Memory, profile and task implementations.

`CUR-WF-001` Workflows MUST be an independently installable Acorn Verified plugin included in the
default profile. Its Node runner remains active when Electron is closed.

`CUR-WF-002` The Node core scheduler, not a browser timer, invokes workflow triggers. Human gates
may wait indefinitely according to retention policy; absence of a Client is not runner failure.

`CUR-WF-003` Workflows MUST own its Client queries, actions, view model, settings contribution,
activity contribution, notifications and navigation. Agents and core MUST NOT contain a Workflow
client or import Workflow implementation types.

`CUR-WF-004` The runner invokes tasks, Agents, Terminal, provider policies, context and memory only
through declared broker capabilities while preserving the original run/actor authority.

`CUR-WF-005` No workflow definition may submit executable JavaScript, an arbitrary graph over the
wire, raw SQL, a shell command, credentials or an implementation callback. Starts name one
validated, revisioned definition installed on the Node.

## Target ownership

| Concern | V2 owner |
| --- | --- |
| Task/repository/worktree and child-task lifecycle | Node core |
| Scheduler, capability broker, grants and audit | Node core |
| Definitions, validation, run/step checkpoint and handoffs | Workflows |
| Structured managed Agent execution | optional `acorn/agents` capability |
| Run target start/status/URL | optional `acorn/terminal` capability |
| Checks/policy verdicts | optional GitHub/other policy provider |
| Human notes/memory review | optional Notes/Memory capabilities |
| Renderer, palette, settings, activity and gate UX | Workflows declarative Client artifact plus host |
| Process/CLI/profile execution and resume | Agents/Terminal/profile plugins |

`CUR-WF-006` Workflows owns run-scoped handoff records and exports them as context snapshots.
Notes may render/link them and Memory may review terminal summaries, but neither owns runner
checkpoint correctness.

`CUR-WF-007` Structured output is the only automatic edge currency. Free text, terminal scrollback,
provider transcripts, notifications and events MUST NOT be parsed as control flow.

## Manifest and permissions

The manifest declares:

- a WASI Node runner, isolated database, migrations and definition schemas;
- settings, palette command, task activity slot, attention, notification, query/action,
  context-section, scheduler worker and subscription contributions;
- built-in step-kind/policy descriptors and exported extension contracts;
- required core task/storage/scheduler/event/UI contracts;
- optional dependencies on Agents, Terminal, GitHub policy, Notes, Memory and profile packages; and
- no native process, bespoke UI, raw filesystem, raw secret or ambient network artifact.

`CUR-WF-008` Baseline grants are own storage, task/repository reads, definition/config snapshots,
core scheduler registration, declared event publish/subscribe and UI contributions. Task create,
Agent execution, Terminal start, provider policy, file/code write, Git, network, secret and
notification operations are separate grants.

`CUR-WF-009` Effective authority for a step is the intersection of owner/Node policy, installation
grant, original start actor or trigger grant, workflow ceiling, step ceiling, child ceiling and
callee policy. Workflows cannot substitute its installation-wide authority.

`CUR-WF-010` An autonomous workflow MUST declare a non-empty tool allowlist or maximum risk, finite
budgets, trigger scope and background-execution grant. Otherwise validation fails.

## Lifecycle and health

`CUR-WF-011` Activation migrates isolated storage, validates every dependency/schema/step provider,
loads definitions, registers the Node scheduler and reconciles unfinished runs before accepting
new starts.

`CUR-WF-012` Health distinguishes runtime/database, definition parse/validation, scheduler,
dependency providers and individual runs. One invalid definition or failed run does not make the
plugin unhealthy.

`CUR-WF-013` Workflows has no mandatory setup wizard. Background/autonomous triggers have an
owner-hosted enablement wizard that reviews schedule, resources, capabilities, budgets,
notifications and no-Client execution.

`CUR-WF-014` Disablement stops new starts/triggers immediately and moves running operations through
durable cancellation. Gated and completed history remains readable under retain policy.

`CUR-WF-015` Update stages a database backup, validates definitions against the new catalog,
drains at safe checkpoints, migrates, health-checks and atomically switches. Active non-compatible
runs block update or are cancelled only with owner confirmation.

`CUR-WF-016` Uninstall requires cancel/drain choice for active runs and retain/purge choice for
history. It does not delete child tasks, Agent sessions, Terminal targets, notes or repository
workflow files; relations remain labeled orphaned history.

`CUR-WF-017` Dependency loss blocks only affected definitions/steps. Definition discovery, past
history, human-gate rejection and cancellation remain available.

## Compatibility invariants

`CUR-WF-018` Run and step state is Node authoritative, revisioned and durable. Client caches,
WebSocket delivery and process liveness are projections and cannot advance a checkpoint.

`CUR-WF-019` Exact behavior, clean-start constraints and parity cases in
[Migration and parity](./migration-and-parity.md) are release requirements.
