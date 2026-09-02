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
| [client-plugins/](./client-plugins/README.md) | Plugins a device holds with no node half, and core chrome (pane switcher, rail, topbar) as exclusive slots a plugin may offer to fill. Style packs as data. Five phases. | Proposal, 2026-08-29. Not started; nothing blocks it. |
| [events.md](./events.md) | Node-emitted core events, plugin events on `plugin:<id>:*`, and cross-plugin subscription. | Shipped 2026-08-28; three items open (preview URL, `emits` on the settings page, connection deletion). |
| [sandbox/](./sandbox/README.md) | Per-task OS isolation, the loopback-API gates, and the enterprise policy layer. | API gates and the project-row trust snapshot shipped; the sandbox and policy layer remain. |
| [ecosystem/](./ecosystem/README.md) | The umbrella over third-party plugins: containment, signing, discovery, the fat-core stance. | Front door shipped; rung-2 containment, signing, and discovery remain. |
| [dashboards/](./dashboards/README.md) | What is left of the dashboards redesign. | Redesign shipped; the taskless database connection, dynamic collections, and write-back remain. |
| [marketing/](./marketing/README.md) | The public site and the plugin docs on it. | Not started. |
| [performance/](./performance/README.md) | Two performance reads, surfaces and shapes, merged into six phases: unblock the red renderer budget and instrument, paint before the node boots, stop the event amplifiers, terminals work only when watched, the live surfaces, then re-measure. | Plan, 2026-08-31. Not started. The renderer build is over budget. |

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

Host-owned plugin UI is the seam most of the others lean on, and it shipped in 2026-08. The terminal
client ([tui.md](../tui.md)) was the second host built on it, which is why the kit's `tui` column is
read rather than asserted, and what is left of shipping it is step 7 of [bundle.md](./bundle.md).
The PWA is the layouts' narrow projections,
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
`structure-followup/`, `before-terminal-ui/`, `terminal/`, `terminal-updates/`, `notifications/`, and
the single files `live-qa.md` and `dx.md` are in git history. Each ended by saying where its behaviour moved.

`notifications/` was six phases that stopped acorn notifying on every agent step. Shipped and deleted
2026-09-02. [notifications.md](../notifications.md) owns all of it: the five states and the two
adapters, the three edges, the one-second hold and the seen rule, acknowledge on view, the four
channels and the `notify` seam group, the settings schema, the two chimes, and the terminal's OSC
recipe. Its eight invariants are properties in
`packages/client-core/src/features/notifications/invariants.test.ts`. Where a phase's behaviour
belongs to somebody else's contract, that owner took it: [shell.md](../shell.md) § The renderer
bridge has the desktop's two Tauri commands and the focus approximation that stands in for a click
callback, [tui.md](../tui.md) § What is drawn bespoke has the topbar count, the inbox overlay and the
DEC 1004 focus rule, [plugin-map.md](../plugin-map.md) § Notifications still answers which call a
plugin makes, and [contribution-kinds.md](../contribution-kinds.md) has `attentionReason` on the
attention row.
`terminal-updates/` was seven phases that finished the terminal's keyboard, shipped and deleted
2026-09-02. [tui.md](../tui.md) § Keys and focus owns all of it. Phase 0 wired every asking node so it
focuses, shows focus and acts, which is § The adapter and the pressable contract under it. Phase 1
rewrote the region store into five levels with one settle pass and a shell-installed topology, and
phase 4 moved the shell's own arrangement into `chrome/topology.ts`; both are § Focus regions and
§ Navigation. Phase 2 gave the arrows the stops of a panel and Escape the climb to its parent, and
phase 3 made a `Tabs` strip with `TabPanel`s a parent stop without a prop, paired by `idPrefix`; both
are § Focus regions. Phase 5 took the `ExtendedPane` seam, `rows` as a collection and the diff
annotation marks into cells, and § What a plugin loses here is the table it produced. Phase 6 turned
the eight invariants into properties over the pane roster and gave the footer a word per kind of
focused thing: § The invariants and § The footer, with the suites in
[testing.md](../testing.md) § Test layers. The focus model that every phase pointed at is § The five
key groups and § The invariants; the two invariants that changed on contact with the build say so
there.

`structure/` was eight phases that made the folder names say what the architecture doc says: `main/`
retired everywhere, client-core regrouped into `kit/`, `host/`, `infra/`, and `features/`, one shape
for every plugin, and a front door for the docs. Shipped and deleted 2026-08-30. Its rules live in
[conventions.md](../conventions.md), the plugin shape in [plugins.md](../plugins.md) § Package shape,
the package boundaries in [architecture-overview.md](../architecture-overview.md) § Package
boundaries, the index in [README.md](../README.md), and the CI that runs the arch suite in
[testing.md](../testing.md).

`terminal/` was nine phases that built a second host for the whole workspace: `acorn`, client-core
booted under Node, drawing the same panes in cells. Phases 0 to 6 shipped on 2026-08-31 and the folder
was deleted the same day. [tui.md](../tui.md) owns the client — the process model, the config
directory, the host switch, the chrome, the keys, the sandbox and the doors it left open — and the
behaviour that belongs to a shared contract went to that contract's owner instead:
[ui-design.md](../ui-design.md) §§ The closed kit, What a terminal renderer needs from this and Every
node at 80 by 24 for the kit and the role tokens, [panes.md](../panes.md) § Layout model for the
projections, [command-palette-and-shortcuts.md](../command-palette-and-shortcuts.md) § Focus and
typing for the intents and the layers, [security.md](../security.md) §§ Trust boundaries, Transport
and auth, Third-party plugin bundles and The containment ladder for the worker-thread sandbox,
[plugins.md](../plugins.md) § The tree contract for the shared batch rules,
[first-party-plugins.md](../first-party-plugins.md) § What each of these loses in a terminal for the
plugin-by-plugin table, [terminal.md](../terminal.md) § Client and [editor.md](../editor.md) for
`attachPty` and the `$EDITOR` handoff, [node-distribution.md](../node-distribution.md) § Reaching a
node with `acorn`, and [testing.md](../testing.md) § Test layers for the six suites. Phase 7, putting
`acorn` in the two artifacts, is the one phase that never ran; its design is
[bundle.md](./bundle.md) § Shipping `acorn`, which is where it belonged all along, because the tarball
is that file's pipeline and not this programme's.

`before-terminal-ui/` was eight phases that emptied the plugin client tier of the raw DOM a second
host cannot draw, shipped and deleted 2026-08-31. The kit grew four nodes and
[ui-design.md](../ui-design.md) §§ The closed kit and Every node at 80 by 24 owns them; the file
dialogs are two verbs on the platform seam in [frontend.md](../frontend.md), which also owns the
`{ seam: … }` host requirement that replaced the preview pane's desktop gate; the editor is
CodeMirror with an `$EDITOR`-in-a-PTY mode and [editor.md](../editor.md) owns both, with
[first-party-plugins.md](../first-party-plugins.md) carrying the row. The survey that started it
lives on in the corrected plugin table in [first-party-plugins.md](../first-party-plugins.md) § What
each of these loses in a terminal and in the baseline comment on the client-tier purity rule in
`tools/arch/boundaries.test.ts`, which is the programme's last deliverable and the reason none of it
can leak back.

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
