# docs/future: the design record for work not yet built

This folder holds designs, analyses, and sequenced plans for work that has not shipped, plus the
refusals that keep it from being re-argued. Behaviour that has shipped is never described here; it
moves to an owning doc under `docs/` and the future file either shrinks to a pointer or is deleted,
with `git log --follow` as the record. Where a file here disagrees with an owning doc, the owning doc
wins.

Every file states its date and status near the top, keeps its paths as hints rather than promises,
and ends with a verify-before-building list where it names code. Nothing here is scheduled.

## The programmes

Multi-file designs with an order of work. Every one of them carries a `refused.md` holding what it
decided not to do and why, so a later session argues with the reasoning rather than with silence.

| Folder | What it is | Status, 2026-08-30 |
| --- | --- | --- |
| [terminal/](./terminal/README.md) | `acorn` in a terminal: a second host for the same component tree and layouts, the process model, and the node + tui deployable beside the desktop. Nine phases. | Proposal, 2026-08-30. Not started; phase 0 blocks on nothing. Replaces the single file `terminal.md`. |
| [before-terminal-ui/](./before-terminal-ui/README.md) | The prep the terminal's pane sweep assumes: the last raw DOM out of the plugin client tier (agents, github, editor, preview), table rows and a `Link` node into the kit, file dialogs behind the platform seam, Monaco replaced by CodeMirror with a `$EDITOR`-in-a-PTY mode, preview gated on the seam that backs it, and the purity rule as an arch test. Eight phases. | In progress, 2026-08-31. Phases 0 to 5 shipped; 6 and 7 remain. Terminal phase 0 does not wait on it, terminal phase 6 does. |
| [client-plugins/](./client-plugins/README.md) | Plugins a device holds with no node half, and core chrome (pane switcher, rail, topbar) as exclusive slots a plugin may offer to fill. Style packs as data. Five phases. | Proposal, 2026-08-29. Not started; nothing blocks it. |
| [events.md](./events.md) | Node-emitted core events, plugin events on `plugin:<id>:*`, and cross-plugin subscription. | Shipped 2026-08-28; three items open (preview URL, `emits` on the settings page, connection deletion). |
| [sandbox/](./sandbox/README.md) | Per-task OS isolation, the loopback-API gates, and the enterprise policy layer. | API gates and the project-row trust snapshot shipped; the sandbox and policy layer remain. |
| [ecosystem/](./ecosystem/README.md) | The umbrella over third-party plugins: containment, signing, discovery, the fat-core stance. | Front door shipped; rung-2 containment, signing, and discovery remain. |
| [dashboards/](./dashboards/README.md) | What is left of the dashboards redesign. | Redesign shipped; the taskless database connection, dynamic collections, and write-back remain. |
| [marketing/](./marketing/README.md) | The public site and the plugin docs on it. | Not started. |

## The single files

| File | What it is | Status, 2026-08-30 |
| --- | --- | --- |
| [bundle.md](./bundle.md) | Packaging a downloadable node: native deps, the CI matrix, the snags. | DX half shipped; distribution half remains. |
| [compiled-tier.md](./compiled-tier.md) | Which compiled plugin moves to the loaded tier next and what blocks it. | Standing map. Three of its four couplings dissolved when the remote component tree shipped. |
| [findings.md](./findings.md) | One core entity, the finding, that gives agent, workflow, and scheduled claims a human disposition, exposed to every harness over MCP; joins notes, memory, gates, and schedules into the harness-engineering loop. | Proposal, 2026-08-29. Not started. |
| [integration-ideas.md](./integration-ideas.md) | The catalogue of integrations a workspace could hold, and the four shapes they collapse into. | Research notes. |
| [orchestration.md](./orchestration.md) | An agent spawning and waiting on acorn's agents. | Step-kind registry opened; the spawn tools and ledger remain. |
| [rail-tab.md](./rail-tab.md) | Rail controls and status markers. | Slices 1 and 2 shipped; slice 3 superseded by the `core:task` annotation point. |
| [remote.md](./remote.md) | Web client, mobile PWA, and a relay service. | Preparation items shipped; the rest waits on a web client. |
| [split.md](./split.md) | Moving the loaded plugins and the authoring toolkit to their own repos. | Proposal, revised for the closed kit. |

## How these relate

Host-owned plugin UI is the seam most of the others lean on, and it shipped in 2026-08: the terminal
client ([terminal/](./terminal/README.md)) is a second host for the same component tree and is the
first programme to build one — with [before-terminal-ui/](./before-terminal-ui/README.md) as its
prerequisite sweep, emptying the client tier of the raw DOM a second host cannot draw before the
terminal's own pane sweep starts — the PWA is the layouts' narrow projections,
compiled-tier's component couplings dissolved into slots, rail-tab's slice 3 became the `core:task`
annotation point, and the marketing plugin docs should be written against the tree rather than the
frame. Client-plugins consumes the remote root and `replace` arbitration and adds device provenance
beside them; nothing in it waits any more. Events and sandbox are independent of all of that and of
each other. Ecosystem's rung-2 containment is the one design restated in more than one place (its
`blockers.md`, sandbox's `phases.md`, `docs/security.md § The containment ladder`); the security
doc owns it and the others point.

## Retired folders

`phased-review-steps/`, `user-extensions/`, `node-first/`, `acp/`, `tauri/`, `events/` (replaced by
the single `events.md` above on 2026-08-28 when all but three items shipped), `layout/`, `structure/`,
`structure-followup/`, and the single files `live-qa.md` and `dx.md` are in git history. Each ended by
saying where its behaviour moved.

`structure/` was eight phases that made the folder names say what the architecture doc says: `main/`
retired everywhere, client-core regrouped into `kit/`, `host/`, `infra/`, and `features/`, one shape
for every plugin, and a front door for the docs. Shipped and deleted 2026-08-30. Its rules live in
[conventions.md](../conventions.md), the plugin shape in [plugins.md](../plugins.md) § Package shape,
the package boundaries in [architecture-overview.md](../architecture-overview.md) § Package
boundaries, the index in [README.md](../README.md), and the CI that runs the arch suite in
[testing.md](../testing.md).

`structure-followup/` was the three places the whiteboard drawing still lied once `structure/` had
moved the folders, in three phases and a sweep, shipped and deleted 2026-08-31. The custody package is
named for what it holds rather than for the desktop that spawns it, and
[architecture-overview.md](../architecture-overview.md) § Package boundaries owns the paragraph, with
[shell.md](../shell.md) owning the desktop process that kept the word "helper". Core no longer names a
plugin: a task's origin is a source id its plugin declared
([architecture-overview.md](../architecture-overview.md) § Product model,
[workspaces-and-tasks.md](../workspaces-and-tasks.md)), a section is shaped by the package that owns
its rows ([agent-tools.md](../agent-tools.md) § Context sections), a harness declares the MCP command
lines its CLI wants ([mcp.md](../mcp.md) § Configuration), and `core never names a plugin` in
`tools/arch/boundaries.test.ts` holds the rest as an allowlist with a reason per file. And the plugin
context type says which tier each member belongs to, so reaching across the line is a `tsc` error
instead of a runtime "not a function" ([plugins.md](../plugins.md) §§ The two contexts, one per tier
and One vocabulary across the registries). The four facts it named to keep a cloud control plane
possible sit with their owners: the dial in [plugins.md](../plugins.md) § Node providers, the two node
ids in `packages/protocol/src/nodeProviders.ts`, `ACORN_BUNDLED_PLUGINS_DIR` as a developer path in
[node-distribution.md](../node-distribution.md) § Plugins, and the opaque `options` bag beside its
schema.

`layout/` was the largest of them: eleven phases that made every pane a host-owned layout filled with
a tree of closed-kit components, shipped and deleted 2026-08-30. Its behaviour lives in
[ui-design.md](../ui-design.md) § The closed kit and § Every node at 80 by 24,
[panes.md](../panes.md) § Layout model, [plugins.md](../plugins.md) §§ The tree contract and
Cooperative extension points and Hooks,
[command-palette-and-shortcuts.md](../command-palette-and-shortcuts.md) § Focus and typing,
[shell.md](../shell.md) § The plugin worker, and [security.md](../security.md) § Rung 0.
