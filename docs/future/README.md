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
| [workflow_tasks/](./workflow_tasks/README.md) | The shipped child-task workflow programme and links to its owning documentation. | Shipped, 2026-09-13. |
| [workflow_v2/](./workflow_v2/README.md) | Shared plugin data, typed workflows, simple authoring, dashboards, AI discovery, and scheduling. Twenty implementation slices with contracts and UX flows. | Accepted design, 2026-09-13. Implementation not started. |
| [scheduled_workflows/](./scheduled_workflows/README.md) | Historical scheduling proposal retained for background. Follow workflow v2 instead. | Superseded, 2026-09-13. |
| [client-plugins/](./client-plugins/README.md) | Plugins a device holds with no node half, and core chrome (pane switcher, rail, topbar) as exclusive slots a plugin may offer to fill. Style packs as data. Five phases. | Proposal, 2026-08-29. Not started; nothing blocks it. |
| [sandbox/](./sandbox/README.md) | Per-task OS isolation, the loopback-API gates, and the enterprise policy layer. | API gates and the project-row trust snapshot shipped; the sandbox and policy layer remain. |
| [ecosystem/](./ecosystem/README.md) | The umbrella over third-party plugins: containment, signing, discovery, the fat-core stance. | Front door and rung-2 containment shipped; signing and discovery remain. |
| [dashboards/](./dashboards/README.md) | Remaining taskless database and write-back proposals. Shared data discovery and authoring now belong to workflow v2. | Redesign shipped; overlapping proposals superseded, 2026-09-13. |
| [marketing/](./marketing/README.md) | The public site and the plugin docs on it. | Not started. |

## The single files

| File | What it is | Status, 2026-08-30 |
| --- | --- | --- |
| [bundle.md](./bundle.md) | Packaging a downloadable node: native deps, the CI matrix, the snags. | DX half shipped; distribution half remains. |
| [compiled-tier.md](./compiled-tier.md) | Which compiled plugin moves to the loaded tier next and what blocks it. | Standing map. Three of its four couplings dissolved when the remote component tree shipped. |
| [integration-ideas.md](./integration-ideas.md) | The catalogue of integrations a workspace could hold, and the four shapes they collapse into. | Research notes. |
| [rail-tab.md](./rail-tab.md) | Rail controls and status markers. | Slices 1 and 2 shipped; slice 3 superseded by the `core:task` annotation point. |
| [remote.md](./remote.md) | Web client, mobile PWA, and a relay service. | Preparation items shipped; the rest waits on a web client. |
| [session_name.md](./session_name.md) | Generated managed-session titles after the first accepted prompt, with user rename precedence and semantic lifecycle events. | Proposal, 2026-09-12. Not started. |
| [split.md](./split.md) | Moving the loaded plugins and the authoring toolkit to their own repos. | Proposal, revised for the closed kit. |
| [web_search_run.md](./web_search_run.md) | Provider-neutral web searches, page actions, and result details in managed-run transcripts, verified against Codex and Claude Code. | Proposal, 2026-09-12. Not started. |
| [data-capability.md](./data-capability.md) | A host-owned `ctx.core.data` facet so a sandboxed plugin can query a database the host connects to, with the database plugin as first consumer. | Proposal, 2026-09-14. Not started. |

## How these relate

Host-owned plugin UI is the seam most of the others lean on, and it shipped in 2026-08. The terminal
client ([tui.md](../tui.md)) was the second host built on it, which is why the kit's `tui` column is
read rather than asserted, and what is left of shipping it is step 7 of [bundle.md](./bundle.md).
The PWA is the layouts' narrow projections,
compiled-tier's component couplings dissolved into slots, rail-tab's slice 3 became the `core:task`
annotation point, and the marketing plugin docs should be written against the tree rather than the
frame. Client-plugins consumes the remote root and `replace` arbitration and adds device provenance
beside them; nothing in it waits any more. Sandbox is independent of all of that. Ecosystem's shipped
rung-2 containment is recorded in `blockers.md` and sandbox's
`phases.md`; `docs/security.md § The containment ladder` owns the behavior and the others point.

## Retired folders

`phased-review-steps/`, `user-extensions/`, `node-first/`, `acp/`, `tauri/`, `events/` and the later
`events.md` follow-up (shipped on 2026-09-11), `layout/`, `structure/`,
`structure-followup/`, `before-terminal-ui/`, `terminal/`, `terminal-updates/`, `terminal-rewrite/`,
`notifications/`, and
the single files `live-qa.md` and `dx.md` are in git history. Each ended by saying where its behaviour moved.

`ai-harness/` was six phases that gave acorn one "generate with" list over stored API keys and the
agent CLIs already on the machine, so someone holding `claude` or `codex` and no key stops seeing a
Generate control that is not there. Shipped and deleted 2026-09-09.
[integrations.md](../integrations.md) § Model providers owns the seam: what a backend is and why a CLI
is not a synthesized connection, the two id prefixes with the bare uuid that has to keep resolving,
the connections-first ordering the palette fast path and the silent fallback depend on, the probe on
every read with no cache, the dispatch on the prefix, the containment of a CLI generate, and the one
core read route beside the generate endpoint that is still refused.
[managed-agents.md](../managed-agents.md) § Harnesses has `aiArgv` as the whole code-tier opt-in,
`HeadlessOpts.system` and who joins it to the prompt, the catalog each profile declares or refuses,
and the two stream shapes, including the standing bug the programme found: Codex's stream was being
read with Claude's parser, so no Codex headless or `decide` turn had ever succeeded.
[plugin-authoring.md](../plugin-authoring.md) § Harnesses has the manifest `oneShot` block, the
OpenCode example and the two things to check before choosing `output`; § Permissions has what the one
`models` token does and does not decide; and [plugins.md](../plugins.md) § Harnesses has the second
trust line. [security.md](../security.md) § Credential handling has the rule that a harness spends the
CLI's own login and never a key acorn holds. [state-ownership.md](../state-ownership.md) § Scope rules
has the one `models.generatePick` default and the SQL dialog's known limit, which is the programme's
one unclosed deviation: that dialog is a remote tree in a worker and cannot read a device preference,
so it opens on the first backend and remembers nothing. [ui-design.md](../ui-design.md) § The closed
kit has the renamed picker, [features.md](../features.md) and
[first-party-plugins.md](../first-party-plugins.md) have the Settings section and the wizard step,
[api-reference.md](../api-reference.md) has the route, and
[workflows.md](../workflows.md) § What an agent step sees has `decide` on Codex and why a manifest
harness passes that check and then fails at run time. [testing.md](../testing.md) holds everything the
programme owes: five manual checks, items 58 to 62, including the acceptance test that someone writes
the OpenCode plugin from the authoring doc alone. Its refusals are in git history, and the two worth
not re-arguing are a CLI as a synthesized connection row and a second `models:harness` permission
token.

`workflows/` was seven phases that turned a workflow engine nobody could see into one a person
authors and watches: steps that wait on named steps and run in parallel, declared inputs, step kinds
that describe their own form, definitions typed in the app, an editor, a run pane, and a start from a
tracker row. Shipped and deleted 2026-09-08.
[workflows.md](../workflows.md) owns most of it. § Execution model has the graph and its one
readiness rule, `decide` in a graph, inputs, isolation, what an agent step sees, and retry;
§ Database definitions has the two stores read as one list, the two trust stories, save to repo and
what a row may name; § Authoring has the rail source, the editor's three kinds of row, the draft
rules, the graph view, the JSON tab and where positions live; § Contributed step kinds has `describe`,
the closed field vocabulary and the catalog route; § Routes and UI has the pane, the per-kind detail
and the three frames it listens to; § Starting a run from an item has the flow and the prefill rule;
and § What workflows refuses has the twenty-two decisions, from a separate `edges` list to a second
run list.

The rest went to the contract's owner. [plugins.md](../plugins.md) § Node-side extension points has a
point's value carrying a description the host draws, and § Context menus has `item.row` beside
`task.row`, with [contribution-kinds.md](../contribution-kinds.md) naming both locations on one row.
[panes.md](../panes.md) has the `workflows` pane, `list-detail` and gated by `when`;
[notifications.md](../notifications.md) has the `workflow-run` target, the gate as an attention row
and the `run-failed` notice; [managed-agents.md](../managed-agents.md) § Sessions has the config
options a workflow turn carries and the chip a workflow session draws.
[terminal.md](../terminal.md) and [database.md](../database.md) each have their two step kinds and
[http-client.md](../http-client.md) has its one, each beside the safety check that admitted it.
[api-reference.md](../api-reference.md) has the routes, [data-layer.md](../data-layer.md) has
`workflow_defs`, [security.md](../security.md) § Process, path, and configuration controls has the
owner-typed row and the save that re-enters the snapshot, and
[state-ownership.md](../state-ownership.md) § Device has `plugin:workflows:layout:<defId>`.
[command-palette-and-shortcuts.md](../command-palette-and-shortcuts.md) and
[first-party-plugins.md](../first-party-plugins.md) have the three palette rows and the plugin's
grown row, [integrations.md](../integrations.md) has **Start workflow…** as a registry contribution
rather than three menus, and [ui-design.md](../ui-design.md) § The closed kit and
[tui.md](../tui.md) § What a plugin loses here have the kit's `Graph` node and its two projections.
[testing.md](../testing.md) holds what the programme owes: nine manual checks, items 48 to 56, six
for the editor and the run pane, two for the start-from-an-item flow and one for the graph view. None
of them has been run.

`changes/` was six phases that turned the Changes pane's list column into a working git panel: checkbox
staging over three groups, a list-or-tree view, a multi-line commit editor with amend and sign-off, a
branch bar with fetch, pull and push, a model-written commit message, and a point another plugin fills
once a branch is pushed. Shipped and deleted 2026-09-08.
[diff-rendering.md](../diff-rendering.md) owns the panel: § The source port has the one `LocalStatus`
read behind every region and why the two signatures are separate, § Data flow has the navigator, the
checkbox, the three groups, the footer's order, the primary button's verb and the three refresh signals,
and § What the Changes panel refuses has the ten decisions — a branch picker, hunk staging, other
remotes, chords on the remote verbs, a split button, a separate pane, a rail surface, git write tools
for agents, a commit history, and a warning on archive about unpushed commits.
[panes.md](../panes.md) § Layout model has the commit draft outliving its region, and
[state-ownership.md](../state-ownership.md) § Scope rules has where the draft, the view preference and
the model pick live. [plugins.md](../plugins.md) § Hooks has `amend` and `force` on the two payloads,
and § Cooperative extension points has `changes:push-actions` with its props beside the other
first-party remote points. [security.md](../security.md) § Process, path, and configuration controls has
the lease and the abort verb; [integrations.md](../integrations.md) § Model providers has the commit
message beside the database plugin's SQL as the two `generateText` consumers;
[command-palette-and-shortcuts.md](../command-palette-and-shortcuts.md) § Plugin shortcuts has the two
commit chords and the palette rows; [first-party-plugins.md](../first-party-plugins.md) and
[api-reference.md](../api-reference.md) have the plugin's row and its route surface; and
[testing.md](../testing.md) has smoke items 43 to 47.

`command-palette/` was seven phases that gave acorn one command graph and one host-neutral palette
session. Shipped and deleted 2026-09-03.
[command-palette-and-shortcuts.md](../command-palette-and-shortcuts.md) owns the whole of it: the
five command kinds and the graph's validation rules, the frame stack and what Enter and Escape do,
the search and input and setting semantics with their generation check, scope and the one opt-in
fan-out, the outcome contract, the shared setting accessor, core's own catalogue, and the nine
refusals — a plugin-rendered frame, a second registry, an executable search response, result action
panels, fleet by default, a model called as you type, reflected Settings pages, free-form secrets,
and cross-owner parenting. [plugins.md](../plugins.md) § Command kinds is the manifest half, with the
bounds the host enforces on a loaded search, input and setting;
[plugin-authoring.md](../plugin-authoring.md) and `packages/plugin-types/README.md` are the
third-party halves of the same. Each plugin's own document has its share under "From the command
palette": [database.md](../database.md), [http-client.md](../http-client.md),
[integrations.md](../integrations.md) for Linear and Rollbar, [terminal.md](../terminal.md),
[workflows.md](../workflows.md), [editor.md](../editor.md),
[github-integration.md](../github-integration.md), [managed-agents.md](../managed-agents.md),
[docker.md](../docker.md) and [notes-and-memory.md](../notes-and-memory.md).
[api-reference.md](../api-reference.md) § Command palette routes has the six plugin routes, and
[testing.md](../testing.md) has the fixture suites and the twelve manual checks the programme owes.

Five invariants outlived the folder, and each is a test rather than a paragraph. There is one
`createCommandSession`, and both hosts build theirs from it. Neither host's palette files compose,
fetch, rank or invoke. No manifest frame target and no slot id is the palette. No search response
carries a field that could name an action, a route, a URL or a verb. And there is no palette-row
registry beside the command one — `ctx.paletteRows` and its two published types came off the plugin
API on the same day, which is what moved `PLUGIN_API_MAJOR` to `10`. All five are in
`tools/arch/boundaries.test.ts`.

`performance/` was deleted on 2026-09-03 when its eleventh phase closed it, and it ended differently
from the rest. Its behaviour moved into the owning docs as usual, but three of its files were records
rather than plans — the decisions about the system's shape, the refusals with their exit conditions, and
every number the programme took — and those had no owner to move to. They are
[docs/performance.md](../performance.md) now. The reads and the phase files are in git history.

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
plugin makes, and [contribution-kinds.md](../contribution-kinds.md) has what an attention
row's severity decides.

`terminal-rewrite/` took the terminal client off OpenTUI and gave it a painter of its own, in five
phases on 2026-09-03 and 2026-09-04. Shipped and deleted 2026-09-04. It had a sixth, a list of
conventions the reference terminal apps have and we lack; it was independent of the rest, it was
never started, and it is in git with the others. [tui.md](../tui.md) owns all of it. § How a frame is
drawn is a new section and the architecture file's four layers landed in it: the plain node tree
Solid mutates, the Yoga pass through the WebAssembly build, the cell buffer with its diff and its
synchronized flush, the byte parser, and the invariant that holds at each boundary. § The runtime
floor is two sentences, because the floor is the repo's — the phases took out the Node 26.4
requirement and the `--experimental-ffi` flag and gave `apps/tui` the `engines` every other package
here has. § The host switch lost the `@opentui/solid` alias and gained the three throwing stubs that
now stand in front of the packages the last phase dropped. § Rendering carries the layout read-back's
clamp where the render guard's paragraph was, plus one sentence each for the two crashes the rewrite
ended, so a reviewer meeting `<Stack>{count()}</Stack>` knows it used to be one. § Rectangles and
§ The Rectangle contract name `@xterm/headless` and the key encoder in front of it. § The adapter
says the `KeymapHost` is ours, all thirteen members of it, and § Focus regions says the store owns
focus with nothing left to disagree with — which is what took the second reveal out of § Scrolling
viewports. § Tests has the harness, which is the real renderer with stdout as a buffer.

Three other docs took a share. [testing.md](../testing.md) § Test layers lost the FFI skip, because
nothing in that suite skips any more. [bundle.md](./bundle.md) § Shipping `acorn` lost the second
native module and the flag in `bin/acorn`, and its open question about which packages the tarball has
to carry is answered. And [performance.md](../performance.md) holds the eager closure's honest number
— the painter is about 98 KB inside the bundle where a 6 MB library sat outside it, so the ceiling
went up rather than down — and re-reads its own phase 9 against the store the rewrite left behind.
Two refusals are worth not re-arguing: a Rust or Go painter behind a wire, rejected because
client-core is TypeScript whatever paints the cells, and a constraint layout instead of flex, parked
rather than rejected. Both are in the folder's `refused.md`.

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

`terminal-keyboard/` was seven phases that re-founded the terminal client's focus and keys after the
model under them had been rewritten ten times in three days, each time correctly, for a bug somebody
saw. Shipped 2026-09-02. [tui.md](../tui.md) § Keys and focus owns all of
it, and the review's finding was that five reports came from four structural faults and one scrolling
fault, so
each of its five rules went to the subsection that owns the mechanism. Rule 1, the renderer is the
only truth about focus, is § Focus regions: one listener on the renderer's focus event writes the
store, one function moves focus and reports what the renderer did, and the mouse arrives through the
same door as a key. Rule 2, a trap is a scope rather than a swallow, is § Traps, with the leak it
removed named there: a swallow has to list the keys it eats, and the list it read was not the list
`install.ts` binds, so Tab walked out of every dialog. Rule 3, one landing rule in place of a
seven-step pass over four global flags, is § Focus regions again: one question about the renderable
that has the keys, then four steps, and the one deferred decision the invariants hold the folder to.
Rule 4, named tiers and honest claims, is § The five key groups and the tier table in
`apps/tui/src/keys/tiers.ts`, which is the only file under `apps/tui/src` that spells a priority; it
is also where the reversal lives that made a tab-strip edge bubble instead of walling, so Left means
one thing everywhere. Rule 5, anything that can exceed its box is a viewport, is § Scrolling
viewports, with the page-key clamp in the shared
`packages/client-core/src/kit/keys/collectionIntents.ts` so the desktop keeps the same rule. The
rectangle that closed the programme is § The Rectangle contract: being entered is derived from the
box rather than remembered in a flag. The three invariants the programme added are rows 9 to 11 of
§ The invariants, and the trace flag a developer turns on first is § Seeing what the keys did. What
it refused is recorded where the refusal binds: no column wrap and an arrow edge as a wall in
§ Focus regions, no second keymap in § What must never happen, and the four manual checks it still
owed are items 27 to 30 of [testing.md](../testing.md) § The smoke checklist.

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


`telemetry/` shipped all six phases and was reviewed and deleted on 2026-09-11.
[telemetry.md](../telemetry.md) owns the collector, runtime seams, consent, exporter, deliberate
limits and verification gap for a live Sentry project. [plugin-authoring.md](../plugin-authoring.md)
owns the author API, [integrations.md](../integrations.md) the DSN connection, and
[performance.md](../performance.md) the measured async-context cost. Runtime-specific details live
in [frontend.md](../frontend.md), [tui.md](../tui.md) and [shell.md](../shell.md).
