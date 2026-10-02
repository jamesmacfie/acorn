# Frontend

The renderer is a SolidJS application bundled into the desktop app. It loads from
`app://acorn`; it does not run from a Node origin and cannot make direct network requests.

Third-party UI can emit a tree of shared components or run in a sandboxed frame. Trees support the
desktop and terminal hosts. Frames own their DOM and run only on the desktop. Use a frame for UI that
needs browser APIs, and declare the host requirement. For more information, see
[Plugin UI choices](./plugin-map.md#the-four-shapes-a-plugin-can-take).

## Composition

`apps/desktop/src/client/index.tsx` creates the renderer runtime and mounts `App.tsx`. The
runtime installs the client plugin host, scoped persistence, query clients, broker event handling,
notification sources, and the shell registries before rendering.

`index.html` loads it directly as the module entry, so the page preloads every startup chunk and
links the stylesheet from the head. Before the entry runs, the page runs
`apps/desktop/public/startup-guard.js`, a deferred classic script. Deferred scripts and module
scripts run in document order, so the guard's listener is in place first. When a startup module
throws, fails to parse, or cannot be fetched, the guard draws an **Acorn could not start** screen
with the error and a **Reload** button, where the window would otherwise stay blank. The guard is a
file rather than inline markup because the renderer policy is `script-src 'self'`. It is not a
module because an entry that imports the app dynamically puts a serial fetch in front of the whole
graph and loses its preloads.

`App.tsx` composes the top bar, TabRail, main view, task view, notices, overlays, Node gate, and
appearance. It selects a Node-aware cache scope and keys task content by Node/task identity so a
switch disposes the previous task scope.

The top bar, left rail, pane switcher, and task list are exclusive slots. Each has a registered core
provider and may have plugin offers; the device preference selects one. `App.tsx` builds the topbar's
serializable workspace, project, breadcrumb, and fleet data, while `TabRail.tsx` builds the rail's
available source list and markers. Host verbs keep navigation, source ordering, rail collapse, and
preference writes outside plugin code. The rail and topbar each lend one opaque nested slot reference:
`rail.taskList` and `topbar.right`. A remote tree can place only the reference it was given; the child
surface cannot open another nested slot.

**Four folders under `packages/client-core/src`, and the order is the dependency order.** `kit/` is
the design system: components, role tokens, the diff toolkit, the key primitives. Props in, DOM out,
and an arch test holds it there, because `kit/` is what `@acorn/plugin-api/ui` re-exports. `infra/`
is the machinery a browser needs and a product does not care about: the platform seam, persistence,
stylesheets, the highlighter, the Node client. `host/` is the plugin host itself: the registries, the
layouts, frames, trees, trust, the palette. `features/` is the product, one folder per surface —
tasks, workspaces, projects, diff, editor, settings, fleet, dashboards, integrations, notifications,
tabs, agent. A file whose folder you cannot guess belongs in `features/`.

## Registries and plugins

The client plugin host activates `apps/desktop/src/client/plugins.ts`. Plugins register panes,
rail sources, commands and keybindings, settings pages, slots, rail markers, ref panels,
agent contexts, extension points and their own contributions to somebody else's, schedules,
persisted-state slices, Node stats, attention sources, session sources, brand marks, and content links. The host owns
the returned disposables so a plugin can be disabled and reactivated without duplicate entries. An
`activate` that starts something no registry holds, such as a listener or a reactive root, returns a
function that undoes it, and the host runs that function with the plugin's other disposables.

A compiled session source registers node-scoped summaries and optional refresh, send, and focus
actions through `ctx.sessionSources`. The source retains its full rows and fetch logic. Core reads the
summaries for task navigation, send pickers, setup markers, and quit concerns. A selected summary
carries its source registration version, so a send or focus chosen before plugin reload cannot call
the replacement source. Terminal owns its active tab and PTY session roster; the host never stores
PTY rows or handles.

There are two render paths and one component API. A compiled plugin's tree runs in this process and
the host mounts its components directly. A loaded plugin's runs in a Web Worker with no DOM, emitting
a stream of node names the host draws with the same components. Both produce the same tree, which is
what lets one plugin fill another's slot whichever tier it ships in
(`docs/plugins.md` § The client half of a loaded plugin).

A pane registers either a `component` or a `layout` plus a `regions` record. The layouts are the
host's, one per name in `client-core/src/host/layouts`, and the registry turns a declared one into the
component every consumer already expects, throwing at registration if the regions do not match the
layout (`docs/panes.md` § Layout model).

Rail sources declare their `order` and may declare `isDefault`. `defaultSourceId()` resolves the
explicit default lazily after plugin registration, with declared rail order as a bare-host fallback.
The shell consumes that accessor for initial selection, persistence, workspace restoration, and task
fallbacks; provider-specific navigation commands belong to the owning plugin.

**One slot registry, two component shapes.** `UiSlotId` names five shell slots plus `task.footer`, and
the id picks what the component is handed: a shell slot gets the whole `UiSlotContext` (the active
task, the terminal drawer's toggle and close, `openSettings`, `selectTask`), a task slot gets only a
`taskId`, so a footer badge does not have to thread shell callbacks it does not own. `SlotHost` draws
the first, `TaskSlotHost` the second, both over `uiSlotRegistry`. They were two registries with two id
types until 2026-08-27, which cost a `ctx` member and a line in every contribution-kind list to express
one difference.

**Three gates, three names, three answers.** `requires` on a contribution is the host question, and it
has three forms: `'desktop'` asks whether a desktop shell is hosting this renderer, `{ plugin: id }`
asks whether the node runs that plugin, and `{ seam: group }` asks whether this host installed that
group of the platform seam (`infra/platform/contract.ts`). An array means all of them. All three are
answered by `hasHostCapability()` in `client-core/src/infra/node/hostCapabilities.ts`. `when` is a free predicate the
contribution supplies. A rail source's `requiresProvider` is a third question: given the integration
behind `providerId` is connected, does it grant this capability. None of those is `ctx.capabilities`,
which is a plugin publishing a typed function for another plugin to call. Two of the four were spelled
with the word "capability" until 2026-08-27 and the fourth still is; the rename split them.

The plugin half carried one hardcoded name, `terminal`, until 2026-08-28. A contribution could not say
"needs docker" or "needs workflows" and could not require two things, so core named one plugin in a
closed union and every other surface had to reach for `'desktop'` instead — which is why the audit
below found fifteen gates asking the wrong question. `disabledNodePlugins()` already answered it for
any id; the requirement now carries the id and core names no plugin.

### The desktop gate audit

`requires: 'desktop'` means "a cloud or web client will not have this surface at all", so each one is
a hole in the headless story (the 2026-08-27 review programme's follow-up item 8; the programme's
files are retired to git history, `git log --follow -- docs/future/phased-review-steps`). Every site
was reviewed on 2026-08-28. **None survives outside a test.**

| Site | Decision |
| --- | --- |
| `plugins/preview` task pane | → `{ seam: 'preview' }` on 2026-08-31. Kept as `'desktop'` until then, and that was the wrong question: a desktop shell may ship without preview views, and on one that does the rail listed the pane and the pane said "needs the desktop app". A seam gate cannot disagree with the surface behind it, because the same probe answers both. |
| `plugins/agents` pane and three settings pages | → `{ plugin: 'agents' }`. Managed sessions are `/v1` plus the shared WebSocket. |
| `plugins/editor` pane, quick-open and find-in-files commands | → `{ plugin: 'editor' }`. File reads and ripgrep are routes. |
| `plugins/terminal` settings page, and the four terminal commands in `TaskView` | → `{ plugin: 'terminal' }`. The drawer is a WebSocket stream, not a shell feature. |
| `plugins/changes` pane | → `{ plugin: 'changes' }`. |
| `plugins/notes` task pane | → `{ plugin: 'notes' }`. |
| `plugins/workflows` settings page | → `{ plugin: 'workflows' }`. |
| `tasks/taskStatus.ts` schedule | **Gate dropped.** `/v1/core/task-statuses` is a core route. It stays a *client* clock deliberately: it refreshes what a window is drawing, and nothing needs it when no window is open. |

Adding a new `'desktop'` gate means writing a row here saying what only a shell can do. Before writing
one, check whether the honest question is `{ seam: group }` instead: `'desktop'` is right for a
surface that is about the shell itself, and wrong for one that needs a *capability* a shell may or may
not have installed. Migrating the remaining shell-shaped checks as they are touched is the open door
this table is the worklist for.

Which registries carry which gate follows a rule now, rather than from history. **Every contribution the
host filters before drawing takes `requires`**, because the question is the host's and the answer is the
same everywhere, so an author never has to remember which registries opted in. `when` is deliberately
not uniform: it is the contribution's own predicate over whatever context that draw site has — a task
for a pane, `UiSlotContext` for a shell slot, nothing at all for a rail source — so it exists where the
host has a context to hand it and is absent where there is none, such as a client schedule or a settings
page. Sources, ref panels and extension points gained `requires` on 2026-08-27 to close that out.

Every registry's `order` is a required field, not inferred from where its plugin activates. Plugin
activation order is invisible in the code, so leaving order optional and falling back to activation
order let a reorder land with nothing to catch it. Panes, rail sources, settings pages, shell slots
and commands all sort on this explicit field.

A rail source may also gate itself with a `when` predicate, for relevance that is not an integration
question. Core's own Fleet home is the one user of it: the predicate is true only once more than one
Node is registered, so a single-Node install never sees a rail entry for a concept it has not met.

A rail source behind a provider that enumerates projects (`supportsProjects`, see
[integrations](./integrations.md)) has a third gate: the active workspace has to link one of that
provider's projects. Connecting Rollbar or Linear is account-wide, but what their items are *about* is
per workspace, so a connected-but-unlinked source drew a row whose surface either sat empty or listed
another workspace's items. The mapping is read from core's own workspace rows rather than from the
plugin, so the gate holds whatever a plugin's manifest says, and it does not apply until both the
provider list and the mapping have loaded, so the rail does not flicker a row away and back on every
workspace switch. Linking happens on a connection's page under Settings > Services, or on a workspace's page, which is
also the only way back once a source is hidden. The gate asks only whether the workspace follows
anything of that provider's, not whether the routed project does: a source that vanished as you moved
between repositories in one workspace would read as a bug, so it stays and shows its own empty state.

### Rail source visibility

Whether a plugin's source has an icon in the desktop's left rail is the person's choice, and it is a
presentation choice, not a gate. The four gates above answer "can this source open?" through
`availableSources` (`packages/client-core/src/features/tabs/railSources.ts`), and nothing about
visibility changes that answer. `features/tabs/railVisibility.ts` applies the choice only where
`TabRail.tsx` projects its icon list. App's selected-source check still reads availability, so a hidden
source that a command selects, such as Docker's **Open Docker**, stays open.

- A source declares `showInRailByDefault: false` to start hidden, on a compiled `SourceContribution` or
  a loaded source descriptor (`packages/protocol/src/plugin/manifest/chromeDescriptors.ts`). Absent
  means shown. The source is registered either way.
- The choice is one device preference, `rail_visibility`, a JSON map from
  `<pluginId>:<sourceId>` to `true` or `false`, mirrored to `acorn.json` as `railVisibility`. The
  owner comes from the source registry, never from anything the plugin declared. An absent entry reads
  the source's default, and an entry for a source that is gone stays as inert data, so a plugin that
  comes back with the same ids comes back as the person left it. The map is bounded when it is read. It
  is a separate key from `rail_order`, so dragging and hiding never overwrite each other; a drag while a
  source is hidden keeps the hidden source's slot.
- Core's sources, Home among them, are always shown.
- Hiding the source on screen goes back to Home. Showing one adds its icon and moves nothing.
- Every hidden, available source gets a palette row, **Open <label>**, which the host registers and
  removes as the source becomes available or not (`host/palette/sourceOpeners.ts`). It opens the source the
  way its icon does and refuses with an error when the source needs a project and none is open. A
  plugin that already registers `source.<id>.open` keeps its own row and gets no second one.
- The switch is drawn in two places, both the host's: **Settings > Plugins > Rail and surfaces** lists
  every plugin source, and the plugin strip above a plugin's own settings page draws one for each id
  the page names in `railSourceVisibility`. Both read and write the one preference. The page's own code
  never touches it, and a loaded frame cannot reach it through `state.set` or a route.
- The terminal's source menu lists every available source whatever this preference says.

A Fleet home node card can also carry a plugin's own number beside core's task count
(`registries/rail/nodeStats.ts`). The card lives in client-core, which cannot import the agents or
workflows plugins to ask them directly, so a plugin registers its own labelled count instead. A stat
is fetched per Node the way the attention inbox is, but is not merged with it: an attention item is a
navigable row with a severity and a target, and a stat is one integer with a label.

A plugin's status markers on a rail control are data, not markup: `features/tabs/railMarkers.ts` takes a
callback returning marker descriptions for one task, source, or pane, and the host decides the corner,
the colour, the spin, and the tooltip legend
([ui-design.md § Rail controls and status markers](./ui-design.md)). The callback runs inside the
consuming render, so a plugin reads signals it already owns and the rail re-renders when they change,
rather than the host inventing a query observer per rail button. One throwing contribution is isolated;
the rest of the control still draws.

The marker's dot, tone, and legend display types live in `kit/tokens/rail.ts`. The tabs feature
re-exports those types from its public contract, so kit tooltip rendering does not depend on a product
feature and plugin imports keep the same names.

Loaded task markers enter through `core:task`, the generic annotation point. The rail sends the whole
visible task-id set once per contributor. Each contributor's request identity includes its descriptor
registration, the active node, `chromeDeps(pluginId)`, and the visible keys. The shared chrome watcher
already advances that freshness revision for plugin pushes, global status, and declared polling, so
annotations add no per-row query, timer, observer, or subscription. A changed identity synchronously
clears and aborts only that contributor, while an exact-generation guard rejects late answers. Chrome
resync clears retained annotation state before registrations are replaced. Results merge in registered
contributor order, independent of network completion order. For the budgets and response shape, see
[Task annotations](./plugins/cooperative-extension-points.md#task-annotations).

Workflow descendant grouping is a client-core task projection, not plugin-owned rail markup. Tasks
created through the workflow child seam carry `workflows:child`; desktop and terminal rails use the
same pure hierarchy projection to collapse them beneath the ordinary root, reveal only an active
descendant's ancestors, and preserve the full task list for drag-order writes. The workflows plugin
adds aggregate running and attention state through the rail-marker registry above. Expansion is a
device-local view preference and never mutates task ancestry.

Several client registries (`slots.ts`, `railMarkers.ts`, `contextMenus.ts`, `extensionPoints.ts`, and
`exclusiveSlots.ts`) hold no JSX import. The `logic` half of this package's vitest suite runs in a bare
Node environment with no Solid transform, so a module that imports a `.tsx` file cannot be loaded by a
test in it at all. Each of these registries keeps its rules (ordering, gates, resolution) in a plain
module for that reason, and pairs it with a small `.tsx` host that only draws what the registry already
decided, kept as thin as the job allows.

The hosts are no longer unchecked. A second vitest project, `hosts`, runs `.test.tsx` under jsdom with
the Solid transform and renders all seven of them
([testing.md § Test layers](./testing.md)). It answers "did the host draw it, and in what order", not
"did it look right"; the pixels are still the smoke checklist's job. Keeping the rules in a JSX-free
module is still the right shape, because a rule with a plain unit test is cheaper to reason about than
the same rule inferred from a rendered tree.

Each shell slot contribution mounts inside a stable DOM root with `display: contents`. The ordered
list reconciles those roots while lazy modules and conditional content change inside them. This keeps
empty text placeholders from detaching during startup and aborting queued effects, including the
first-run wizard's portal mount. `pnpm dev:agent:smoke` checks the wizard on a fresh desktop profile
and advances from the welcome screen to adding a project.

The shell imports no feature UI directly. `App.tsx`, `TaskView.tsx`, and `CommandPalette.tsx` consume
registry entries and client-core contracts. A feature that needs native behavior goes through the
platform seam (`client-core/src/infra/platform/`), which `@acorn/plugin-api/client` re-exports the plugin-safe
parts of; plugins do not name a shell binding and do not read the host global.

The seam's verbs are the host's, but a group being absent does not always mean the verb is gone.
`pickFolder` answers null where no host installs a picker, and callers ask `canPickFolder` first so
they can drop the affordance. `pickFiles` and `saveFile` behave differently on purpose: a page can
open its own file input and click its own download link, so the seam carries that fallback and every
caller gets a working verb. A host that installs the `files` group takes over with native dialogs,
and its save writes where the owner chose instead of into the downloads folder. Both verbs move
bytes, never paths, which is what lets an agent attachment on this machine reach a node on another
one.

`notify` is the same arrangement for telling somebody something happened while they were not
looking. A page has `Notification`, so `showNotification` falls back to it, holds the object until it
closes so the click handler survives collection, and asks for permission the first time. A host that
installs the group takes the banner over and gains the one thing a page cannot do: `canSetBadge`
answers true, Settings shows the app-icon row, and `trackBadge` puts the bell's pill number on the
icon. The tag on every banner is the notice id, so a click resolves back to the row it came from.
See [the renderer bridge](./shell.md#the-renderer-bridge) for the desktop half of both.

The router is registry-driven. A source contributes path shapes with an explicit `order`, and the desktop
shell composes them before rendering, so a static route stays ahead of a parameter route without embedding a
provider's URL scheme in `index.tsx`.

Core owns its own URLs as constants in `registries/commands/corePaths.ts` (`/p/:projectId`,
`/p/:projectId/new`, `/t/:taskId`) and never resolves them through the registry. A contributed route
addresses something inside a surface; it does not decide whether the surface renders. A browse source
renders at `/p/:projectId`, and GitHub's `/pulls/:number` and Linear's `/issues/:identifier` select an
item within that surface. A source that gates its render on its own route match becomes unreachable,
because selecting a source in the rail sets a signal rather than navigating.

Reading the routed project is opt in: `SourceContribution.projectScoped`, and `projectScoped` on the
manifest twin. GitHub, Linear, and Rollbar declare it; Home, Fleet, Docker, and the agent centre do
not. Every affordance that changes the project asks `sourceIsProjectScoped` about the source on
screen, which is why the topbar picker is absent on Home rather than sitting there moving nothing but
the breadcrumb, and why a command that does the same job cannot disagree with it. A manifest source
that declares it also gets `?project=` on its items route and the project in its cache key; one that
does not is fetched once and shared across projects, because its rows are the same rows either way.
The picker still appears in a task view, where nothing else names the task's project.

**A source may hand over its two halves instead of one component.** `SourceContribution.regions` takes
a `list` and a `detail`, which is the same shape a pane declares when it names the `list-detail` layout.
A source that declares it renders identically on the desktop — `SourceSurface` composes the
`ListDetail split` the source used to write by hand — and gains the ability to be drawn in two places
at once, which is what the terminal shell does: the list goes in a panel of its own down the left and
the detail fills the main panel ([docs/tui.md](./tui.md) § The screen).

Descriptor sources go the same way. `ChromeSourcePanel` used to be one component drawing the whole
surface on the shell's `.panes` card grid, which left Linear, Rollbar and the HTTP rail as the only
browse sources not on `ListDetail`. It hands over a list and a detail now, so all five compose
identically, and the two halves never shared state to begin with: which row is selected is the URL,
which is what makes a row click, a pasted deep link and the back button one thing.

It exists because a host cannot pull two columns out of one opaque component. Even the kit node cannot:
the `split` form of `ListDetail` takes both columns as `children`, so it does not know which of its
children is which. Naming them is the only honest answer, and the name to use is the one panes already
use. `component` stays, and a source that keeps it renders as it always did on both hosts, with the
terminal's Browse panel empty.

The one thing core asks a plugin for is where a task lives. `SourceContribution.taskPath` lets a
source claim a task's URL, so GitHub puts a PR-backed task at its PR URL, and `pathForTask` falls
back to `/t/:taskId`. The alternative, asking the registry for whichever source owned a route `kind`,
is a global first-match that only works while one plugin has routes.

Two smaller claims ride on the same relationship. **`origins`** maps the task origins a source creates
to the glyph each is drawn with, because a source's rail id and the origin it stamps on a task need not
match — GitHub's rail is `github` and its tasks carry `github-pr`. **`defaultPane`** is the pane a task
this source tracks opens on the first time it is activated: `defaultPaneForTask` asks whoever owns the
task's URL first and a link's provider second, so a PR-backed task whose body cites a ticket lands on
the pull request. A task no source claims is left alone and the layout reducer's default stands. Both
used to be tables of plugin names inside core.

Task panes are addressed with query params rather than path segments: `/t/:taskId?pane=…&item=…` is consumed
once into a `PaneIntent` and then stripped (`tasks/taskDeepLink.ts`). The pane layout is a row with focus and
maximise state persisted per task, so the URL carries the intent, not the layout.

## Node data access

`packages/client-core/src/infra/node/apiClient.ts` uses route builders and response types from
`@acorn/protocol/api.ts`. In the desktop it calls the platform seam's `nodeTransport().fetch(nodeId,
request)`, which the desktop helper sends through the pinned broker; with no transport it falls back to a
same-origin `fetch`. The standalone server can be tested with a direct
fetch client, but it does not provide a renderer shell. Shared repository-picker and task-status
reads are generic shell query wrappers backed by the owning source's `repository` contribution;
provider routes and response types do not live in client-core.

A response body is a `Uint8Array` the whole way from the broker, so binary is a read on the same
transport rather than a second one. `readBytes` and `sendRawBytes` are what a caller uses when the
answer is a file: under `app://` a route builder's URL resolves against the protocol handler rather
than a node, so a download cannot be an `href` or a `src` and comes back as bytes the caller turns
into a blob URL. `sendRawBytes` is also what carries a plugin frame's `api.getBytes` and `postBytes`
(`docs/plugins.md § Binary bridge calls`); the frame path needed a second `frameServices` method, not
new transport, because the only thing standing between a frame and these bytes was that the JSON door
hard-coded `content-type: application/json` and `JSON.stringify`.

TanStack Query is the server-data cache. There is one QueryClient/persister scope per Node. Query
keys do not need an ad hoc Node prefix because the cache itself is partitioned. Fleet queries fan out
per Node and must not write aggregate shapes into ordinary per-Node keys.

## Typed data authoring

Typed source authoring lives in `features/dataSources`, not in provider plugins or consumer panes.
Its pure editor and field-picker models sit beside host-kit Solid components, and its requests use
the same Node-partitioned TanStack cache as the rest of the renderer. Workflow and dashboard
consumers receive protocol values from this shared surface; they do not duplicate source forms.
The picker filter can request bounded metadata options on typing, while query preview remains an
explicit action. Both the DOM and terminal kit implementations carry that search callback. The lazy
`@acorn/plugin-api/ui/data-sources` facade exposes the connected controls to compiled consumers; a
feature-owned kit seam swaps primitives without duplicating the editor tree or its state model.

Workflow schedule setup follows the same rule. The workflows plugin owns a small modal host and pure
cadence/preview model, composes only shared kit nodes, and reuses the connected typed value and field
pickers. The workflow rail lists the Node projection, while activation and status mutations go
straight to device-only routes. They are not optimistic/offline mutations: failure stays visible in
the open editor and nothing is replayed after reconnect.

Dashboard authoring consumes `SourceQueryEditor` directly. Each query instance reports its described
fields and retained explicit preview through an observational callback; the dashboard's Display state
never writes back into the source query. The persistent two-region editor projects typed nested values
through pure `@acorn/dashboards-core/typedProjection.ts` rules into the existing host-owned panel views.
At narrow widths those regions stack without losing the draft or preview.
Published panels cache their revision and bounded source results under the active Node, workspace, and
dashboard ID. The renderer strips Solid's reactive cache metadata before handing those protocol values
to the strict typed-data projector, so cached data remains an offline fallback without becoming part of
the wire value.

## Startup readiness

The desktop opens its window as soon as the helper is listening, then shows the existing startup
loader while the helper selects a Node and the supervised local Node finishes booting. The renderer
does not mount the shell or plugin panes until that local Node emits its first broker status. This
keeps pane-owned resources from issuing requests before their routes exist.

`apps/desktop/src/client/index.tsx` starts `selectActiveNode()` and `applyNodePlugins()` without
blocking the renderer. Their effects arrive through the signals they already set: `activate.ts`
registers every compiled plugin before any node has answered, and `applyNodePlugins` re-runs that
registration with the node's disabled list when it arrives. The host skips a pass whose plugins and
disabled set match the last one, so a node that disables nothing costs no second registration and no
second `activate`. A plugin whose startup read depends on the node, such as the agent roster or the
terminal session list, waits for that node to report itself reachable rather than reading at
activation. `nodeGateHolds()` keeps those registered
surfaces unmounted until the selected local Node is reachable.

The cache partition still cannot wait for the fleet, because it decides which cache provider the
renderer mounts. The device remembers the last Node it talked to, and `activeNodeId()` answers from
that on the first tick (`packages/client-core/src/infra/node/activeNode.ts`). The fleet answer corrects
it, and a Node that has gone reaches the existing `node-replaced` reload. The startup loader sits
inside that provider, so releasing it draws the correct persisted partition without a remount.

`nodeGateHolds()` keeps the startup loader visible while fleet selection is in progress and while a
selected local Node has no status. The first `online`, `degraded`, `incompatible`, or named `offline`
status releases it. `nodeReady()` is the same condition turned around, and it is the gate for reads
that start before the shell mounts, such as the queries, schedules, and disk warning in `App.tsx`. The
fleet list remembers the local Node before the helper has handed it to the broker, and until then the
broker answers every request to it with `Unknown node`. The fleet fan-out skips a local Node in that
state and serves its cache, and runs again on the Node's first status. Known offline remote Nodes do not enter the startup gate because this app does not
supervise their processes. A later disconnect also leaves the shell mounted so cached reads, drafts,
and the normal connection UI remain available.

Fleet membership can arrive after the loader's first frame, so `fleet.ts` re-reads it when a status
names a Node that its list does not have. On a first launch, that push is the only news that the local
Node exists. `index.tsx` still invalidates active queries on the first usable status. This covers a
request started by non-shell startup work without making every feature part of the readiness contract.

## Connection and freshness UI

The broker exposes `online`, `degraded`, `offline`, `incompatible`, and `revoked`. Client-core maps
these plus query state to `live`, `refreshing`, `stale`, `offline`, `disabled`, and `error` displays.
Offline reads use cached values with a Node badge; mutations fail fast and retain drafts.

The chip retains one wording that is not one of those six for places outside the startup gate. A
supervised local Node that the broker has not reported reads "Starting" instead of "Offline". Its
freshness value stays `offline`, because nothing is live. A remote Node with no status is genuinely
offline because this app does not control its process.

The event client tracks per-connection sequence numbers and reconnects with backoff. A gap, heartbeat
failure, or Node restart marks the scope stale and refetches active queries. Feature streams render
attached/disconnected state independently of whether a process is still alive.

## Shell state

The TabRail is source → workspace → task. The main region can show Fleet home, a source, or the active
task. Task panes are an ordered/resizable row with persisted widths, pinning, and layout recipes.
The terminal drawer is a task surface and is available when the desktop terminal capability exists.

Overlays are shell-owned: command palette, settings, onboarding, notices, confirmations, and secret
entry are not rendered by arbitrary pane content. The shell positions native preview views over a
renderer pane host. `observeNativePage` owns shared page geometry, native overlay presentation, and
the overlap fallback for both preview and loaded-plugin pages. The optional `rendererLayer.update`
platform group sends geometry and input policy to the shell. The live Solid tree retains content,
callbacks, drafts, and query ownership; no second renderer or cache receives them. For the shell
contract and platform matrix, see [Native overlays](./native-overlays.md).

Focus is shell state too. `client-core/host/keys/focusRegions.ts` holds which region of which pane the keyboard
is in and what each region last had focused, and it is the one place `focusedPane` is written and the
one place `runtime:focus-changed` is emitted from. Beside it, `keys/collectionState.ts` holds every
list's `active`, `selected` and `offset` keyed by the item's own key. Both are module-level signals
and neither is persisted; see [state-ownership.md](./state-ownership.md) for why, and
[command-palette-and-shortcuts.md](./command-palette-and-shortcuts.md) for the keymap that reads
them.

The top bar's bell renders two kinds of item, and the difference matters to whatever produces one. A
notice is an event that already happened, such as a run finishing or a build failing. It is
client-local, dismissible, and gone once the ring rolls over it. An attention item
(`registries/rail/attention.ts`) is a state that lasts until something changes on the Node: a pending
approval is still pending after a person dismisses it, so it returns on the next fetch. Both come
from one reading of what an agent session is doing, and one gate decides which changes are worth
interrupting somebody for and which channels each wakes.
[notifications.md](./notifications.md) owns that model.

## Settings

Settings is a full-window layer, `packages/client-core/src/features/settings/SettingsView.tsx`, that
`apps/desktop/src/client/App.tsx` mounts over the shell, top bar included. It is not a route. A route
change would unmount the task's panes, so the workspace stays mounted underneath: a terminal, an agent
stream, or an editor keeps running and is where the person left it after Escape. ⌘,, the palette's
**Open settings**, the top bar menu, `openSettings(target)` on a slot's context, and the
`presentation:open-settings` event all open it. A target is `settings/<pageId>#<sectionId>`, and the
prefix and the section are optional, so a bare page id works. With no target, settings reopens on the
last page used, which is remembered in local storage and never sent to a node.

The rail holds **Back to acorn**, a search field (`/` focuses it; see Search below), and nine closed
groups: General, Workspaces and projects, Agents, Connections, Features, Automation,
Machines, Plugins, and Advanced. The lists are in `packages/protocol/src/chrome/settingsPages.ts`. A page
declares its group as `category` and what a change on it affects as `scope` (`device`, `node`,
`workspace`, or `project`) on its `SettingsContribution`
(`packages/client-core/src/host/registries/shell/settings.ts`). A missing `category` is `features`, a
missing `scope` is `node`, and the older `group: 'workspace'` still means `scope: 'workspace'`. A
plugin may use General, Agents, Connections, Features, Automation, and Machines. Core alone files
pages under Workspaces and projects, Plugins, and Advanced, and a compiled plugin that names one of
those, or an unknown scope, throws at registration. Workspaces are rows under Overview, each opening
its workspace page, and a workspace's projects are rows under it while it is expanded (see Workspaces
and projects below). The arrow keys
move through the rail, Enter opens a page, and the rail's single Tab stop is the open page's row, so
Tab moves into the page. A dot beside a row marks an attention row whose target is that settings page.
A page's body is capped at `--page-measure`, 720 px, unless it sets `fullWidth`. Below 900 px the rail is its own screen
and a page opens over it with a back link. The page is a size container, so when it is narrower than
32rem its inline rows stack, the control under the words, however wide the window is.

The header keeps to the page's width. Above the title, a small path names only what the page sits
under: its group, and on a project its workspace. The title line holds the page name, then a scope
chip, then the close button (an `x` with **Esc** in its tip) at the end. The chip says **This device**,
**Node: <label>**, **Workspace**, or **Project**, with the node named too when there is more than one.
The title already names the workspace or project, so its chip names only the kind.
A page that reads and writes the node in `context.scope.nodeId` sets `followsNodeSwitcher`, and its
chip becomes the node switcher when the fleet has two nodes or more. The switcher is local to
settings: it starts on the active node each time settings opens and never changes `activeNodeId`,
which would remount the shell on another node's cache. Switching it remounts the page, so nothing a
page held for one node shows under another, and a form holding changes asks first. Installed, Security and backup, Audit log,
Schedules, Run history, Telemetry, and Storage and memory follow it. Storage and memory hands the
switcher's node to each section a plugin draws in its `core:storage` point, so the agents section reads
that node too. Every other node page reads the active node, because
a compiled plugin's page calls the ambient API client and a loaded frame is pinned to the active node
(`host/frames/register.ts`), and its chip names that node as plain text rather than offering a
switch the body would not honour.

The page context is `{ scope: { nodeId, workspace?, project? }, navigate(target, opened?), workspace?,
onWorkspaceDeleted }`. `navigate` asks first when a form holds changes, and `opened` runs only once
the page is on screen. Every arrival on a page draws it afresh, so its own rail row, clicked from
one of its items, goes back to its list. `workspace` repeats `scope.workspace` and stays until the next plugin API
major. On a project's page `scope.project` is the project and `scope.workspace` is its workspace. A page that no longer passes its `requires` gate falls back to the first page, which says the
page is no longer available on this node.

### Search and deep links

Search is built from declarations, never from rendered controls
(`host/registries/shell/settingsSearch.ts`). A page declares `keywords` and `sections` on its
contribution, at most 16 of each. A section is `{ id, label, keywords?, rows? }`: `id` matches a
`SettingsSection` the page draws, and `rows` lists the labels of its rows. Core pages declare theirs
with their placement in `packages/client-core/src/features/settings/corePages.ts`, the table the
desktop's `apps/desktop/src/client/pageContributions.tsx` and the terminal client both register from,
so a page is findable before its chunk has loaded. A loaded plugin's settings frame declares `keywords` and `sections`
without `rows` (docs/plugin-authoring/the-manifest.md). The index adds the names of workspaces,
projects, connections, nodes, and plugins, each landing on the page that holds it. The registry
refuses a compiled page whose lists are past the limit, or whose section ids repeat or cannot be
carried by a link.

Results rank page names first, then section names, then row labels, then keywords, and within a
rank a match at the start of the text before one at the start of a word before one anywhere. Each
result names the section it lands on, with its page as a faint step above it, then the row or
keyword that matched. A section named like its page shows the name once. A plugin is found by its
name and by its id.
Enter opens the first result. A result with a section scrolls to it and marks it for three seconds
with an outline and a fill, which are there at once when motion is reduced; only the fade moves. A
deep link, `settings/<pageId>#<sectionId>`, and a palette section row land the same way. Reopening
settings on the remembered page does not scroll or mark anything. The palette's **Settings** group
lists one row per page and then one per declared section, from the same index.

A page that absorbs another keeps the old id working through `aliases` on its contribution. Each entry
is `<oldId>` or `<oldId>#<sectionId>`, the section the old page's rows sit in. A deep link, a
remembered page, or `openSettings` that names an old id lands on the page that lists it, at that
section, and settings remembers the live id from then on (`resolveSettingsAlias` in
`host/registries/shell/settings.ts`). An alias is read only when no page has the id, so it never takes
a live page's place. Limits and cost is the example: `agent-concurrency` and `agent-pricing` land on
its **Turns at once** and **Claude prices** sections.

### Pages and the save model

A page is `SettingsSection`s of `SettingRow`s, two kit nodes on `@acorn/plugin-api/ui` (docs/ui-design.md
§ Every node at 80 by 24). A row is the label and one line of description on the left and the
control on the right, or under them at the full width when `layout="stacked"`. The description is
only what a person needs to choose right now: a consequence that cannot be undone, a unit, or a
format. How the setting works or why it exists goes in `help`, behind a "?" after the label, on a row
or a section (docs/ui-design.md § The help mark). Text that restates the label goes nowhere. The label
names the row's one control, so clicking it flips a switch or focuses a field. Every inline row is at
least one control high plus its padding, whatever its control. The row draws the save state its
caller hands it on the label's line, so the control column holds only the control and never narrows:

- A switch or a select saves when it changes. `createSettingSave()` holds the row's `error`, and the
  control's own state is the signal that the change landed.
- A text field saves on blur or Enter. `createTextSetting({ value, save })` keeps what is typed as a
  draft, commits it through `save`, and shows **Saved** for about two seconds (`savedAt`). A write that
  fails or refuses the value keeps the draft in the field and puts the message on the row. A commit of
  the stored value writes nothing.
- Fields that only make sense together, such as a custom agent, a credential, an MCP server, or a new
  schedule, are a form with **Save** and **Cancel**. The form calls `useUnsavedChanges(dirty)`, and
  every way off the page asks first: Escape, a rail row, **Back to acorn**, the palette, and a deep
  link all go through one `leave()` in `SettingsView.tsx`. No settings page has a Save button outside a
  form.
- A row given `onReset`, which a caller passes only while the value differs from a known default,
  marks its label with a dot and offers **Reset**.
- A row given `from`, such as `.acorn/config.toml`, says **From …** and turns its control inert in a
  disabled fieldset, so the value this machine holds stays visible. Nothing draws **Managed by your
  organisation**; the slot is reserved for that layer.
- A row stored somewhere other than its page passes `scope="device"` and draws its own **This
  device** chip beside the label, the one a device page's header shows. **Tool call display** on
  Harnesses and defaults is the example: the page is the node's, and the row is this device's.
- A row that only seeds new agent sessions says so and names the control that changes an open
  session: **On for new sessions** with `/mcp` on MCP servers, and the composer's pickers on Harnesses
  and defaults.
- A detail page's delete, uninstall, unpair, or revoke sits in `SettingsSection tone="danger"` at the
  bottom and asks through `confirmAction` (`host/registries/shell/willPhase.tsx`), the same dialog the
  will events use. The dialog names what goes and what stays.

A page that lists things, such as custom agents or MCP servers, opens one as a detail in the same pane,
never in a modal. The detail calls `useSettingsDetail(title, back)`
(`features/settings/settingsDetail.ts`), and the header does the rest: it shows the item as the title
and makes the page's name in the path a link back to its list, with ⌘[ bound to it. Going back passes
through `leave()`, so a form with unsaved changes asks first. A detail with steps of its own, such as
Add connection's gallery and then one provider's form, passes a third argument, the label of where
`back` goes, so the link names the step before rather than the list. The hook returns false when nothing is
listening, which is what the same page drawn outside settings gets, and the page then draws its own
back link and asks by itself.

The helpers are in `features/settings/settingSave.ts`, `features/settings/unsavedChanges.ts`, and
`features/settings/settingsDetail.ts`, on `@acorn/plugin-api/client` for compiled plugins. `savePref(..., { throwOnFailure: true })` throws
instead of posting a background notice, so a row's error is said once, beside the row. A loaded
plugin's tree keeps the same state in its own signals, because `savedAt` and `error` cross to a
sandbox and a function does not.

### Forms and flows

A form or a flow takes its frame from where it starts. A flow that interrupts, such as first run or
an agent asking to install a plugin, is a `Modal`, and its footer follows the dialog rule in
docs/ui-design.md § Chrome and overlays. A flow started from a settings page stays on the page, such
as Add connection or Add a node.

- A form on a page ends in a left-aligned `Inline gap="row"` under its last field: the one `solid`
  primary first, then **Cancel** as `ghost`. A page is wide, and a button pushed to the far edge is
  hard to find from the field it belongs to.
- A flow of three or more screens says where the person is, in a muted line above its form: "Step 2
  of 3". A flow of two screens needs no count, because its title changes and the back link returns to
  the first screen.

Two shapes cover every form on a settings page:

- **The page form.** `Field`s in a `Stack gap="stack"`, label over control, md controls. Any error
  sits between the last field and the buttons, and the buttons are the left `Inline` above. Add
  connection and Replace key share their fields through
  `features/settings/connections/CredentialFields.tsx`. New MCP server and New custom agent take the
  same shape.
- **The boxed form.** The same fields and footer inside a `Card`, for a form that opens within a
  section rather than replacing the page: the Nodes pairing card and the run target form. A flow of
  three screens adds the "Step 2 of 3" line at the top of the card.

### Workspaces and projects

Overview (`features/workspaces/WorkspaceProjectAssignments.tsx`) is every project on the node in one
table, `features/workspaces/ProjectTable.tsx`, grouped under its workspace. A row's name and chevron
open the project's page, and a group's name opens the workspace's page. Selecting rows, one by one,
per group, or all at once, opens a bar under the table: **Move to workspace** (its last option
creates the workspace), **Hide** or **Show**, and **Set colour**. The bar loops the one-project
`PATCH` route rather than asking the node for a bulk route, and it reports each project that failed
by name. A workspace's own page draws the same table for its projects.

A workspace's page (`features/settings/WorkspaceSettings.tsx`) holds its name, its projects, the
services it follows (each connection's project map drawn from the workspace's side,
`features/settings/ProjectConnections.tsx`), and a danger zone that deletes it. A project's page (`features/settings/ProjectSettings.tsx`) has five
tabs: **General** (name, folder, task tab colour, workspace, hidden, task branch prefix, and the
danger zone), **Setup and scripts** (setup, its trigger, teardown, the dev script and restart command,
and run targets), **Preview** (the URL mode and page rules), **Database** (the connection script and
the query-generation schema), and **Connections** (each connection's project map drawn from this
project's side, `features/settings/ConnectionProjectMap.tsx` with a `project`, each linking to the
connection's page). Run targets are a table
with a small Save and Cancel form under it (`features/settings/RunTargetsTable.tsx`); the stored value
is still the JSON array the run-targets route checks. The Default workspace cannot be renamed or
deleted from any page, because it is where a deleted workspace's projects land.

The two pages are addressed by id: `settings/workspace/<workspaceId>` and
`settings/project/<projectId>`, each taking `#<sectionId>`. The same key is the rail row, the
remembered page, and the search result for that workspace's or project's name and sections. A section
on a tab that is not showing lands by picking its tab first. Each step of the path above the title is a
link: the group opens Overview and, on a project, the workspace opens its page. ⌘[ goes back: a
workspace to Overview, and a project to Overview when it was opened from there, otherwise to its
workspace. The step ⌘[ follows shows the chord in its tip. On a project the path reads
`Workspaces and projects › <workspace>`.

A settings page registered with `scope: 'workspace'` or `scope: 'project'` has no rail row. It is a tab
on every workspace's or project's page, after core's own tabs, and gets that workspace or project in
its context (`settingsDetailTabs` in `host/registries/shell/settings.ts`). A loaded frame with
`settingsScope: 'project'` gets the project id in its binding, like a project pane. Docker's tab is
the example (`plugins/docker/src/client/DockerProjectSettings.tsx`). The workspace page draws a tab
strip only when a plugin adds a tab.

A value a project's committed `.acorn/config.toml` sets is read-only on the project page, labelled
**From .acorn/config.toml**, with the file's value drawn above this machine's own. The node says which
values those are: the project config read carries `repoConfig`, which is only what the file sets
(`packages/node-core/src/server/runConfig.ts` § `readCommittedConfig`), so the page never parses repo
files. Those values are the dev script and restart command when the file declares a `dev` run
target, the database connection script, the preview mode and value, and the run targets, which the
page lists read-only above this machine's own. A machine target with the same name as a repo target
says the repo replaces it. The file wins whether or not it is trusted yet: trust decides whether a task
may run it, not which value applies. A key the home `~/.acorn/config.toml` sets is not reported.

### Agents

The Agents group is seven pages. The agents plugin owns four of them
(`plugins/agents/src/client/index.ts`):

| Page | Owner | What it holds |
| --- | --- | --- |
| Harnesses and defaults (`agent-defaults`) | agents | Each harness and whether this machine can run it, usage limits, new-session defaults with the task-context switch, inline diff chats, and the device's **Tool call display** |
| Custom agents | agents | A list, then one agent's editor with a danger zone |
| Tools and permissions (`agent-tools`) | core | The three tiers, then every tool grouped by owner or by tier |
| MCP servers (`agent-mcp-servers`) | agents | The servers acorn declares to every session, a list then one server's editor |
| MCP config files (`mcp`) | core | The servers a CLI loads by itself, for the project picked on the page |
| Limits and cost (`agent-limits`) | agents | Turns at once, then prices. `agent-concurrency` and `agent-pricing` are aliases |
| Review after archive (`findings-settings`) | findings | The findings plugin's settings frame |

The task-context switch writes core's `startup_context_injection` preference, which the memory
plugin's launch-context handler reads on the node, so it sits with the other things a session starts
with rather than on the terminal's page. The agents plugin reaches it through `PrefKeys` and
`savePref` on the plugin API, the way any page writes a core preference
(`plugins/agents/src/client/settings/startupContext.ts`). The two MCP pages link to each other,
because acorn can add a server to a session but cannot remove one a CLI loads by itself
(docs/mcp.md).

### Connections

The Connections group is two pages, both core's, in `features/settings/connections/` and
`features/settings/models/AiModelsSettings.tsx`. [integrations.md](./integrations.md) § Settings says
what each one holds.

| Page | What it holds |
| --- | --- |
| Services (`integrations`) | Every connection that is not a model key, then one connection's page, and the Add connection gallery |
| AI models (`ai-models`) | **Generate with**, a device row with its own chip, the model keys, and the agent CLIs this machine has |

A connection's page and the gallery are details of the list (`useSettingsDetail`), drawn by
`ConnectionsPage.tsx`, which both pages share. So a link to one from elsewhere in settings goes
through `openConnectionPage` in `connections/connections.ts`: a detail request
(`createDetailRequest` in `features/settings/settingsDetail.ts`) that is set only once settings has
moved to the list page, and that the list takes when it draws. Someone who chooses to stay on a form
with changes finds nothing opened later. A project's Connections tab, a workspace's page, and a search result for
a connection's name all use it. A search object carries the opener as `open`
(`host/registries/shell/settingsSearch.ts`), and the rail calls it instead of navigating.

The `needs-auth` dot on Services or AI models comes from the attention source
`core.connectionsNeedAuth`, registered by the shell in `apps/desktop/src/client/activate.ts`, through
the same `waiting(pageId)` read as the dot on Installed.

### Plugins

The Plugins group is two pages, both core's. **Installed** (`plugins`) lists the node's plugins and
this device's client-only ones, with **Needs you** and **This device** filters, and opens one plugin's
page with **Overview**, **Settings**, **Permissions**, and **Versions** tabs. **Install…** is one flow
for both targets. [plugins/activation.md § What the owner sees](./plugins/activation.md#what-the-owner-sees)
owns what each shows. **Rail and surfaces** (`rail-surfaces`, device) holds the **Show in left rail**
switch for every plugin source (see Rail source visibility above) and the replaced-surface picker.

Any page inside settings opens one plugin's page with `openPluginPage(navigate, pluginId)`
(`features/settings/plugins/installed.ts`), the same kind of detail request. The plugin strip's **Manage plugin** and a tool's owner on
Tools and permissions use it.

### The plugin strip

Every page a plugin contributes carries the host's plugin strip (`features/settings/plugins/PluginStrip.tsx`),
whether the page is compiled, a remote tree, or a frame. The settings view draws it for any page whose
registry owner is a plugin, and a workspace's or project's page draws it at the top of a plugin's tab.
It holds the plugin's name and origin, **Manage plugin**, a **Show in left rail** switch per source the
page names in `railSourceVisibility`, the **Enabled** switch, and a status line for off, waiting for
approval, failed, and offline. A plugin's page describes the active node, so the strip does too.

Plugin content cannot hide or cover the strip, for four reasons:

1. The strip is a DOM sibling that comes before the box the plugin's content is drawn in. On a plugin's
   own page it sits between the header and `.settings-body`, outside the scrolling body, so the page
   cannot scroll over it either.
2. The box around plugin content, `.settings-body[data-plugin]` or `.settings-plugin-content`, sets
   `contain: layout` and `isolation: isolate`. Anything inside, positioned or not, is placed and stacked
   within that box.
3. A compiled plugin draws only kit nodes, and no kit node takes a class or a style
   ([ui-design/closed-kit.md](./ui-design/closed-kit.md)). A remote tree is kit nodes too.
4. A frame is an iframe (`sandbox="allow-scripts allow-same-origin"`), which paints only inside its own
   box.

The strip's switches are drawn only for sources the plugin really registered, checked again against the
source registry's owner. A page may name only its own plugin's sources: a compiled page that names
another is refused when its plugin registers (`host/registries/extensionPoints/plugin.ts`), a core page
may not name any, and a loaded frame's foreign id is reported by the node's manifest reader and dropped
by `host/frames/register.ts`, keeping the page.

### Keys inside settings

While settings is open the task's own chords stand down: `App.tsx` passes `taskActive: false` to the
dispatcher, and the region chords do nothing while focus is inside an `aria-modal` surface
(`host/keys/install.ts`). Focus moves into the rail on open, Tab stays inside the layer, and focus
returns to where it was on close, so keys typed in settings never reach a terminal underneath. Menus,
select lists, and confirmations portal to the body and paint above the layer, and an open one takes
the first Escape.

## Startup budget

Both clients have a build check over what they load before they draw, and both fail the build two ways:
over a byte ceiling, and on a **chunk name**.

- **The renderer.** `apps/desktop/scripts/check-renderer-budget.mjs`, run from `@acorn/desktop`'s
  `build`, sums every script and stylesheet a cold window loads: 906,000 B for scripts, 200,000 B
  for styles. The script ceiling is the 2026-10-01 measurement, 862,188 B, plus about 5%. This includes
  the security changes to frame request ownership and tree validation, which run before plugin
  content is drawn. The previous ceiling used the 2026-09-29 measurement of 819,628 B. A change
  that needs more raises it in the same commit, with the reason in the commit message. It reads the graph from Vite's manifest, which `vite.config.ts` moves out of the shipped
  client folder to `dist/renderer-manifest.json`. The startup set is the static closure of the entry
  chunk plus the modules in the script's `STARTUP_IMPORTS` list, and every script and stylesheet
  `index.html` names, the startup guard among them. `STARTUP_IMPORTS` lists modules the page imports
  dynamically but always loads before it draws. Today that list names only `src/client/index.tsx`,
  which is the entry itself, so it adds nothing. Every other dynamic import is lazy and is not
  counted. The count has a floor too. Under 100,000 B of scripts the check is reading the wrong
  graph, and it fails rather than passes. That is how it went blind on 2026-09-24, when the entry
  was a 9.6 KB guard module and the check reported 9.6 KB while the window loaded 870 KB. The script
  also prints `hops`, the fetches that run one after another before the app can start, and how much
  more one dynamic import away would fetch. Neither of those is counted.
- **The terminal client.** `apps/tui/scripts/check-startup-graph.mjs`, run from `@acorn/tui`'s `build`.
  That bundle sets `modulePreload: false` and has one entry, so there is no preload list to read; the
  analogue is the static import closure of the `App` chunk `main.js` reaches for first, and everything
  in it is evaluated before the first cell is drawn. The ceiling is 1,175,000 B. The 2026-09-28
  security build measured 1,137,492 B across 131 eager chunks; validation at the Node and content
  boundaries must load before untrusted content is drawn. The earlier 2026-09-23 acceptance build
  measured 1,118,096 B across 123 eager chunks. The closure grew when the client
  took over its own painting: what
  used to be a 6 MB native library outside the bundle is about 98 KB inside it
  ([tui.md](./tui.md) § How a frame is drawn). Dropping a dependency moves this number by nothing —
  every bare import is left to the runtime, so a package that is only ever imported weighs nothing
  here. The walk is a regex over import edges rather than a real module graph, so it is approximate
  on purpose — it exists to catch a 300 KB regression, not to be exact.

The architecture reset briefly pulled DOM primitives, diff virtualization, and annotation rendering
into this closure through broad `public.ts` barrels. The TUI now imports narrow supported entrypoints
for its model and host adapters. That restored the original ceiling without exempting those chunks.

**Unused kit components drop out of the renderer.** A barrel such as `kit/components/content` used to
pull every component it re-exports onto the startup graph, drawn or not. Solid compiles a file that
uses a delegated event into a module-level `delegateEvents([...])` call, and the bundler must keep a
module that does work at import. The renderer's `vite.config.ts` declares
`packages/client-core/src/kit/components/**/*.tsx` side-effect-free, so a component nothing uses is
left out, and one that is used keeps its own call. On 2026-09-25 that took 67 KB off the startup
scripts, among them the graph, the timeline, the mention editor, and the virtual-list library behind
`Grid` and `Rows`. The declaration is true only while those files do nothing at module scope, so an
arch rule (`tools/arch/boundaries.test.ts`, "a kit component module does nothing at import") fails on
any top-level statement that is not an import, a declaration or a subcomponent assignment. Something
that has to run on import belongs in a `.ts` module outside `kit/components`.

**Why a name test as well as a byte total.** Between 2026-08-31 and 2026-09-02 the renderer's total
drifted from 1,317,605 B to 1,329,679 B across 31 unrelated commits while staying red, so nobody read
it. And a budget that only counts bytes lets the next heavy chunk in as long as something else shrank.
The denylist is `shiki`, `wasm`, `DiffPane`, `prModel`, `prSections`, `viewState` and `icon-nodes`:
each is a lazy surface that leaked into the eager graph, and a chunk with one of those names being
fetched at startup is wrong whatever it weighs. The renderer's list adds plugin code a registration
needs only when it draws: `MemoryAddForm`, `FindingsBundleReview`, the workflow editor's `draft-` and
`draftStore`, `stepFields`, `GithubImporter`, `PreviewTaskPane` and `PreviewPane`. All of those were
on the renderer's startup graph until 2026-09-25.

The renderer tests a name against modules as well as chunks. `vite.config.ts` writes
`dist/renderer-modules.json` beside the manifest, listing the source modules in each chunk, and the
check tests every folder on a startup module's path and its file name, written the way a chunk would be
named after it (`draft.ts` as `draft-`). That second test is the one that matters most. A module that
startup code imports statically merges into a startup chunk named after some other module, so a
chunk-name test alone never sees it. That is how the plugin code above reached startup unnoticed. The
terminal client's check still tests chunk names only. The shape of the mistake is always the same — a
string-keyed table from a name to a **value** rather than to a **loader**, which pulls every value into
whichever chunk holds the table. All five instances have been fixed: `kit/tokens/iconNodes.ts` (see
[ui-design.md](./ui-design.md) § Which names are drawn without waiting), the DOM host's kit table (see
[plugins.md](./plugins.md) § The tree contract), the CodeMirror language map (see
[editor.md](./editor.md)) and the GitHub plugin's PR pane contribution.

A chunk's name is one module's name, so a name here can move when the graph changes: the
pull-request model was `prModel` until its pane's contribution went lazy, after which the same modules
landed in a chunk called `prSections`. Both names stay listed. A prefix that names no chunk at all is
not an error — a module can be renamed or deleted — and neither script fails on one, which is what
makes the allowance list below keepable.

Each script also carries a short `KNOWN` list: denylisted names that are in the startup list **today**
and are somebody's open work. Those report loudly and do not fail the build. The list may only shrink —
once a chunk with that name is built and no longer fetched at startup, the check fails until the entry
is deleted, so a fix cannot quietly regress a month later. **Both lists are empty**, and a test in each
package asserts that they are: a name added back has to argue for itself.

## Telemetry

The renderer collects the same five record kinds the node does and posts them to the node in
batches. [telemetry.md](./telemetry.md) owns the model, the switch and the seam list; what belongs
here is the two things the renderer had to invent, because neither has an equivalent on the node.

**An interaction is the trace.** There is no async context in a browser, so a command or a page
change writes the open span into a module variable
(`packages/client-core/src/infra/telemetry/emitter.ts`) and `apiClient.send()` reads it. One click
is one trace across both processes: the command span, the `api.request` span under it, and the
node's `http.request` span under that. Work that continues after the span ends gets no parent, which
is the price of not having an async context and is smaller than the price of polyfilling one.

**A page change is a signal write.** Routes mount a no-op component and `App.tsx` draws from
`selectedSource()` and `activeTaskId()`, so there is no navigation event to time. `nav.change` starts
in `features/tasks/pageChange.ts` where the signal is written and ends on the second
`requestAnimationFrame`, the same pattern the boot marks use. Two writes in one change collapse into
one span, because opening a task writes both signals and two spans would report one click as two
navigations. A pane region that is still fetching at that frame has its own span, `pane.region`,
which runs from the host asking for the region to the child's `onMount`, so a suspended region is
measured to content rather than to the empty rectangle.

**An owner without a field for one.** Eight contribution types carry no plugin id, so `Registry` in
`kit/lib/state/registry.ts` keeps one in a side-map and `ownerOf(id)` answers for the seams. The three
registration passes that know the owner fill it: `host/chrome/chromeRegister.ts`,
`host/frames/register.ts` and `makeContext` in `host/registries/extensionPoints/plugin.ts`. Core
registers without one and reads as `core`.

`kit/` may import `kit/` and the highlighter and nothing else, so the error boundary in there cannot
reach the emitter. `kit/lib/telemetry/contributionErrors.ts` is the seam it reports through, and the client's
telemetry start-up installs the handler, the same trade `host/frames/broker.ts` makes with its
services.

## Restore and persistence

Launch restore proceeds in this order: fleet membership and Node records, active Node, selection and
main view, task, task layout, and pane-local state. Missing Nodes and unknown pane IDs render repair
states rather than throwing.

Device presentation preferences include theme, style pack, keybindings, and layout. Node preferences
include operational settings and setup state. Draft text remains client-local and is not treated as
successful server state. Secret fields are never persisted in renderer storage.

### Processing and responsiveness telemetry

Shared work hooks cover JSON decoding, query-cache serialization/restoration, markdown, row
reconciliation/mounting, highlighting, diff preparation, tree backlog, and terminal write completion.
The kit calls a host-installed callback in `kit/lib/telemetry/workTelemetry.ts`; it never imports the collector.
The desktop installs responsiveness monitoring in the renderer entrypoint, not the separately bundled
preload bridge, so it observes the same consent and interaction state as the application.
[Telemetry](telemetry.md#diagnosing-an-unresponsive-view) owns the vocabulary and diagnostic workflow.


### Node shell navigation lifetime

The desktop's keyed QueryCacheProvider contains PaneModelHost before the Router. The query provider
owns persistence independently; PaneModelHost leases the selected Node generation for detached pane
models. `setActiveNode` declares transport interest even for an equivalent selection, then batches a
changed signal, device memory, and `runtime:node-switched`. Event listeners see the new Node before
incoming reactive construction while the outgoing DOM still exists. Scope eviction carries `from`
and `to`; owners retire the captured outgoing generation rather than reading an ambient cleanup
scope. Individual region/pane removal preserves its model. Provider destruction retires observers
and drawn marks. The explicit host wrapper is available for the TUI composition programme.

TabRail memoizes the scalar stored `railOrder` value, parses it once per changed value, and shares a
pin membership Set. Selection, same-value preference writes, and unrelated preferences reuse that
projection. Row identity, reactive contributed markers, and the persisted representation remain the
rail's existing contracts.

## Preview pane lifetime

The preview pane mounts its toolbar and observers for the selected task. The desktop shell retains
its browser document when that pane unmounts. The bridge registers a native state listener before
`ensure` requests a replay, so the toolbar resumes the browsing URL and history controls without a
fresh navigation. Visibility changes hide or show the retained native page independently of home
reconciliation. Pending URL reads preserve the record; resolution and capacity failures offer a retry.
See [Host-owned webviews](./shell.md#host-owned-webviews) for ownership, policy, and recovery limits.
