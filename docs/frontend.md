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
workspace switch. Linking happens in Settings → Integrations, under the connection, which is
also the only way back once a source is hidden. The gate asks only whether the workspace follows
anything of that provider's, not whether the routed project does: a source that vanished as you moved
between repositories in one workspace would read as a bug, so it stays and shows its own empty state.

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
status releases it. Known offline remote Nodes do not enter the startup gate because this app does not
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
renderer pane host and hides them while overlays cover them.

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

## Startup budget

Both clients have a build check over what they load before they draw, and both fail the build two ways:
over a byte ceiling, and on a **chunk name**.

- **The renderer.** `apps/desktop/scripts/check-renderer-budget.mjs`, run from `@acorn/desktop`'s
  `build`, sums every script and stylesheet a cold window loads: 776,000 B for scripts, 200,000 B
  for styles. The script ceiling is the 2026-09-25 measurement, 738,695 B, plus about 5%. A change
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
  in it is evaluated before the first cell is drawn. The ceiling is 1,130,000 B. The 2026-09-23
  acceptance build measured 1,118,096 B across 123 eager chunks. The closure grew when the client
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
needs only when it draws: `MemorySection`, `FindingsBundleReview`, the workflow editor's `draft-` and
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
`kit/lib/registry.ts` keeps one in a side-map and `ownerOf(id)` answers for the seams. The three
registration passes that know the owner fill it: `host/chrome/chromeRegister.ts`,
`host/frames/register.ts` and `makeContext` in `host/registries/extensionPoints/plugin.ts`. Core
registers without one and reads as `core`.

`kit/` may import `kit/` and the highlighter and nothing else, so the error boundary in there cannot
reach the emitter. `kit/lib/contributionErrors.ts` is the seam it reports through, and the client's
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
The kit calls a host-installed callback in `kit/lib/workTelemetry.ts`; it never imports the collector.
The desktop installs responsiveness monitoring in the renderer entrypoint, not the separately bundled
preload bridge, so it observes the same consent and interaction state as the application.
[Telemetry](telemetry.md#diagnosing-an-unresponsive-view) owns the vocabulary and diagnostic workflow.
