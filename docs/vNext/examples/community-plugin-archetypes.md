# Community plugin archetypes

**Status:** Normative coverage catalog; individual product names are informative<br>
**Requirement prefix:** `EX`

This catalog turns the Herdr ecosystem’s recurring behaviors into Acorn platform requirements. A
plugin may combine archetypes, but it does not receive authority merely because an archetype usually
needs it.

## Coverage table

| Archetype | Contributions | Node/runtime needs | Typical permissions | Required fallback |
| --- | --- | --- | --- | --- |
| Read-only file explorer | Task pane, file tree, code/Markdown/diff renderers, navigation intents | Declarative or WASI indexing | Task-scoped file read, Git read | Bounded tree/list and plain-text viewer |
| Code review companion | Diff/review pane, comments, attention, agent handoff | WASI or provider connector | Git diff, provider network, comment mutation, agent prompt | Diff summary and external link |
| Workspace/layout bootstrapper | Command, wizard, layout recipe, lifecycle hook | Declarative plus brokered actions | Workspace/task create, process spawn where declared | Preview plan without execution |
| Worktree manager | Command, source, wizard, progress events | WASI calling Git/worktree capabilities | Repository read/write, worktree create/remove | Read-only worktree inventory |
| Terminal tool pane | Task pane or popup, command, keybinding | Supervised process/PTY stream | Process spawn, PTY, task files, optional network | Command result/log renderer |
| Agent monitor/triage | Fleet source, attention items, notifications, badges, timeline | Event subscriber, optional worker | Agent read/events, notification | Table sorted by attention |
| Agent orchestrator | Command, workflow contribution, approvals | WASI worker and capability calls | Agent create/prompt/approve, task/worktree, process | Dry-run execution graph |
| Notifications bridge | Settings, secret wizard, event subscription | WASI event worker | Selected events, destination-bound network, secret use | In-app notifications |
| External issue/PR provider | Fleet/workspace source, task pane, external links, settings | WASI/provider adapter | Brokered network and credential, task links | List/detail forms using built-ins |
| Browser/preview tool | Task pane, browser renderer, progress/errors | Node companion and capable Client | URL resolve, optional browser automation | External URL plus diagnostic state |
| Telemetry/dashboard | Fleet source, metric cards/table/chart, settings | Event subscriber and local aggregates | Selected redacted events; optional egress | Local-only aggregate table |
| Background supervisor | Health, status, notifications, task slot | Long-running WASI/native worker | Explicit process/network/files, budgets | Start/stop/status action surface |
| Editor integration | Navigation intent, command, content staging | Declarative/WASI or external editor adapter | Selection/read, agent draft insertion | Copy structured context |
| Plugin manager/distribution | Settings/source, install commands | Core marketplace only | Artifact metadata; owner confirmation | Marketplace link and installed list |
| Scheduled routine | Settings/wizard, command, run history | Node scheduler and worker | Specific commands/capabilities delegated per routine | Disabled schedule with manual run |
| Session backup/restore | Settings, command, progress | WASI using export/import contracts | Selected plugin export, encrypted backup storage | Export metadata and manual restore |

`EX-001` Every archetype MUST be implementable without importing another plugin or accessing its
database. When collaboration is required, the manifest declares a capability dependency or event
subscription.

`EX-002` A command, worker, or UI contribution MUST NOT receive the union of its plugin’s possible
permissions automatically. The host derives the minimum grant for the active operation.

## Archetype rules

### File, review, and editor companions

These plugins consume `acorn.file-tree`, `acorn.code-editor`, `acorn.diff-review`,
`acorn.markdown`, and navigation-intent contracts. File content remains Node-owned.

`EX-010` A Client renderer MUST receive bounded content through a declared query or stream. It MUST
NOT receive a filesystem path and open it locally.

`EX-011` A review mutation MUST carry an expected resource version and emit a committed provider or
plugin event only after the upstream result and local projection commit.

### Workspace, worktree, and layout automation

These plugins compose core workspace/task/worktree commands. Layout changes are Client presentation
commands, while worktree creation is a Node mutation.

`EX-020` An automation MUST present a dry-run containing repositories, paths, processes, tasks,
panes, and permissions before its first execution or after a material definition change.

`EX-021` Repository-authored layouts or setup commands inherit executable-config trust. Installing
the plugin does not trust repository content.

### Terminal and process tools

A terminal tool uses the brokered process and PTY contracts. A Community plugin uses WASI and may
ask the host to spawn a constrained process; it does not become a native plugin merely because its
product is terminal-based.

`EX-030` Terminal streams MUST deliver a canonical snapshot before live output, enforce one input
owner, apply flow control, and detach without killing a persistent session unless requested.

`EX-031` Process environment is an allowlist built for the operation. Node/service environment,
credentials, internal tokens, and unrelated plugin configuration MUST be absent.

### Agent monitors and orchestrators

Monitors subscribe to versioned Agents events and read bounded projections. Orchestrators call
declared Agent, Task, Workflow, and Terminal capabilities.

`EX-040` An agent event can trigger evaluation but cannot authorize the resulting operation.
Authority is rechecked against the current grant at command execution.

`EX-041` Automatic approvals, input injection, or self-prompting require distinct high-risk
permissions, visible stop controls, ceilings, and audit events.

### Notification and telemetry bridges

Bridges receive redacted event projections and use a destination-bound network/credential broker.

`EX-050` Notification templates MUST use allowlisted fields. Prompt text, terminal output, source
content, provider bodies, paths, and credentials are excluded unless the owner performs a separate
explicit data-sharing setup step.

`EX-051` A telemetry plugin defaults to local aggregation. Enabling egress shows destination,
fields, retention, frequency, and an example payload before granting network authority.

### External providers

Provider plugins define connection descriptors, validation, credential purpose, account identity,
resource schemas, and mutations. The Node stores credentials; Electron renders standard forms and
resources.

`EX-060` Provider credentials MUST be opaque `secretRef` values. The plugin receives a
destination- and purpose-bound broker operation, never the raw secret. A provider that cannot use
the general broker requires an Acorn release-owned fixed-purpose core helper; no plugin trust or
runtime tier creates an exception.

`EX-061` Multi-account resources MUST carry connection identity so a Client or collaborating plugin
never relies on “first account” ambiguity.

### Background workers and schedules

Workers are supervised lifecycle units with health, budgets, backoff, stop, quarantine, and update
drain semantics. Schedules are Node-owned durable definitions.

`EX-070` A worker MUST declare whether overlapping invocations are skipped, queued, or coalesced.
Unbounded overlap is invalid.

`EX-071` Catch-up after downtime is disabled by default. A schedule that enables it declares a
maximum number of missed executions and idempotency strategy.

### Backup and restore

Backup plugins orchestrate core/plugin export contracts and never read another database directly.

`EX-080` Export packages MUST be encrypted and authenticated before leaving the Node data root and
must record Node identity handling, plugin versions, schema versions, and restore prerequisites.

## Composite examples

- A PR-to-agent router combines external provider, worktree manager, agent orchestrator, and review
  companion contracts.
- A mobile-notification precursor combines agent monitor and notification bridge contracts, but is
  still consumed from Electron in V2 because mobile is not shipped.
- A “mission control” pane combines agent monitor, workflow orchestration, attention, and timeline
  renderers without gaining agent approval authority by default.
- A development-stack supervisor combines scheduled/background workers, terminal streams, health,
  and notifications; it does not receive generic process or network access.

`EX-090` The Herdr compatibility review MUST demonstrate at least one top-100 plugin for every
archetype above or explain why the marketplace snapshot contains none.
