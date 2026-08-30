# docs/future: the design record for work not yet built

This folder holds designs, analyses, and sequenced plans for work that has not shipped, plus the
refusals that keep it from being re-argued. Behaviour that has shipped is never described here; it
moves to an owning doc under `docs/` and the future file either shrinks to a pointer or is deleted,
with `git log --follow` as the record. Where a file here disagrees with an owning doc, the owning doc
wins.

Every file states its date and status near the top, keeps its paths as hints rather than promises,
and ends with a verify-before-building list where it names code. Nothing here is scheduled.

## The programmes

Multi-file designs with an order of work.

| Folder | What it is | Status, 2026-08-28 |
| --- | --- | --- |
| [layout/](./layout/README.md) | Host-owned layouts, a closed component kit, remote component trees, five extension kinds, host-owned focus and keys. Ten phases, desktop only. | **Shipped 2026-08-30.** The folder sequences and links; the owning docs under `docs/` describe the behaviour. |
| [terminal/](./terminal/README.md) | `acorn` in a terminal: a second host for the same component tree and layouts, the process model, and the node + tui deployable beside the desktop. Nine phases. | Proposal, 2026-08-30. Not started; phase 0 blocks on nothing. Replaces the single file `terminal.md`. |
| [client-plugins/](./client-plugins/README.md) | Plugins a device holds with no node half, and core chrome (pane switcher, rail, topbar) as exclusive slots a plugin may offer to fill. Style packs as data. Five phases. | Proposal, 2026-08-29. Not started; layout phase 4 shipped, so nothing blocks it. |
| [events.md](./events.md) | Node-emitted core events, plugin events on `plugin:<id>:*`, and cross-plugin subscription. | Shipped 2026-08-28; three items open (preview URL, `emits` on the settings page, connection deletion). |
| [sandbox/](./sandbox/README.md) | Per-task OS isolation, the loopback-API gates, and the enterprise policy layer. | API gates and the project-row trust snapshot shipped; the sandbox and policy layer remain. |
| [ecosystem/](./ecosystem/README.md) | The umbrella over third-party plugins: containment, signing, discovery, the fat-core stance. | Front door shipped; rung-2 containment, signing, and discovery remain. |
| [dashboards/](./dashboards/README.md) | What is left of the dashboards redesign. | Redesign shipped; the taskless database connection, dynamic collections, and write-back remain. |
| [marketing/](./marketing/README.md) | The public site and the plugin docs on it. | Not started. |

## The single files

| File | What it is | Status, 2026-08-28 |
| --- | --- | --- |
| [bundle.md](./bundle.md) | Packaging a downloadable node: native deps, the CI matrix, the snags. | DX half shipped; distribution half remains. |
| [compiled-tier.md](./compiled-tier.md) | Which compiled plugin moves to the loaded tier next and what blocks it. | Standing map. Three of its four couplings now defer to the layout programme. |
| [findings.md](./findings.md) | One core entity, the finding, that gives agent, workflow, and scheduled claims a human disposition, exposed to every harness over MCP; joins notes, memory, gates, and schedules into the harness-engineering loop. | Proposal, 2026-08-29. Not started. |
| [integration-ideas.md](./integration-ideas.md) | The catalogue of integrations a workspace could hold, and the four shapes they collapse into. | Research notes. |
| [orchestration.md](./orchestration.md) | An agent spawning and waiting on acorn's agents. | Step-kind registry opened; the spawn tools and ledger remain. |
| [rail-tab.md](./rail-tab.md) | Rail controls and status markers. | Slices 1 and 2 shipped; slice 3 superseded by the layout programme's annotations. |
| [remote.md](./remote.md) | Web client, mobile PWA, and a relay service. | Preparation items shipped; the rest waits on a web client. |
| [split.md](./split.md) | Moving the loaded plugins and the authoring toolkit to their own repos. | Proposal, revised for the closed kit. |

## How these relate

The layout programme is the seam most of the others lean on, and it has shipped: the terminal client
([terminal/](./terminal/README.md)) is a second host for its tree and the first programme to build one, the PWA is its layouts' narrow projections, compiled-tier's component
couplings dissolved into its slots, rail-tab's slice 3 became one of its annotation points, and the
marketing plugin docs should be written against it. Client-plugins consumes its remote root and its
`replace` arbitration and adds device provenance beside them; nothing in it waits any more. Events and sandbox are independent of it and of each
other. Ecosystem's rung-2 containment is the one design restated in more than one place (its
`blockers.md`, sandbox's `phases.md`, `docs/security.md § The containment ladder`); the security
doc owns it and the others point.

## Retired folders

`phased-review-steps/`, `user-extensions/`, `node-first/`, `acp/`, `tauri/`, `events/` (replaced by
the single `events.md` above on 2026-08-28 when all but three items shipped), and the single files
`live-qa.md` and `dx.md` are in git history. Each ended by saying where its behaviour moved.
