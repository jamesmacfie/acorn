# Frontend

The renderer is a SolidJS application bundled into the desktop app. It loads from
`app://acorn`; it does not run from a Node origin and cannot make direct network requests.

The framework choice is a private implementation detail: third-party plugin UI runs in its own frame
with its own bundle, so a plugin author's framework is their own. The shell's workload is a dense,
always-on surface with live panes and streams, which is what fine-grained reactivity is for. For more
information, see [extensibility.md](./extensibility.md) § Some decisions that look like gaps.

## Composition

`apps/desktop/src/app/client/index.tsx` creates the renderer runtime and mounts `App.tsx`. The
runtime installs the client plugin host, scoped persistence, query clients, broker event handling,
notification sources, and the shell registries before rendering.

`App.tsx` composes the top bar, TabRail, main view, task view, notices, overlays, Node gate, and
appearance. It selects a Node-aware cache scope and keys task content by Node/task identity so a
switch disposes the previous task scope.

## Registries and plugins

The client plugin host activates `apps/desktop/src/app/client/plugins.ts`. Plugins register panes,
rail sources, commands/keybindings, settings pages, shell/task slots, palette rows, context sections,
ref panels, agent contexts/renderers, pollers, persisted-state slices, Node stats, and attention sources. The host owns
the returned disposables so a plugin can be disabled and reactivated without duplicate entries.

Rail sources declare their `order` and may declare `isDefault`. `defaultSourceId()` resolves the
explicit default lazily after plugin registration, with declared rail order as a bare-host fallback.
The shell consumes that accessor for initial selection, persistence, workspace restoration, and task
fallbacks; provider-specific navigation commands belong to the owning plugin.

Every registry's `order` is a required field, not inferred from where its plugin activates. Plugin
activation order is invisible in the code, so leaving order optional and falling back to activation
order let a reorder land with nothing to catch it. Panes, rail sources, settings pages, shell slots,
and palette rows all sort on this explicit field.

A rail source may also gate itself with a `when` predicate, for relevance that is not an integration
question. Core's own Fleet home is the one user of it: the predicate is true only once more than one
Node is registered, so a single-Node install never sees a rail entry for a concept it has not met.

A Fleet home node card can also carry a plugin's own number beside core's task count
(`registries/nodeStats.ts`). The card lives in client-core, which cannot import the agents or
workflows plugins to ask them directly, so a plugin registers its own labelled count instead. A stat
is fetched per Node the way the attention inbox is, but is not merged with it: an attention item is a
navigable row with a severity and a target, and a stat is one integer with a label.

Several client registries (`slots.ts`, `contextMenus.ts`, `extensionPoints.ts`, and
`exclusiveSlots.ts`) hold no JSX import. The vitest suite for this package runs in a bare Node
environment with no Solid transform, so a module that imports a `.tsx` file cannot be loaded by a test
at all. Each of these registries keeps its rules (ordering, gates, resolution) in a plain module for
that reason, and pairs it with a small `.tsx` host that only draws what the registry already decided,
kept as thin as the job allows because that half can only be checked by looking at the running app.

The shell imports no feature UI directly. `App.tsx`, `TaskView.tsx`, and `CommandPalette.tsx` consume
registry entries and client-core contracts. A feature that needs native behavior goes through the
platform seam (`client-core/src/platform/`), which `@acorn/plugin-api/client` re-exports the plugin-safe
parts of; plugins do not name a shell binding and do not read the host global.

The router is registry-driven. A source contributes path shapes with an explicit `order`, and the desktop
shell composes them before rendering, so a static route stays ahead of a parameter route without embedding a
provider's URL scheme in `index.tsx`.

Core owns its own URLs as constants in `registries/corePaths.ts` (`/p/:projectId`,
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

The one thing core asks a plugin for is where a task lives. `SourceContribution.taskPath` lets a
source claim a task's URL, so GitHub puts a PR-backed task at its PR URL, and `pathForTask` falls
back to `/t/:taskId`. The alternative, asking the registry for whichever source owned a route `kind`,
is a global first-match that only works while one plugin has routes.

Task panes are addressed with query params rather than path segments: `/t/:taskId?pane=…&item=…` is consumed
once into a `PaneIntent` and then stripped (`tasks/taskDeepLink.ts`). The pane layout is a row with focus and
maximise state persisted per task, so the URL carries the intent, not the layout.

## Node data access

`packages/client-core/src/apiClient.ts` uses route builders and response types from
`@acorn/protocol/api.ts`. In the desktop it calls the platform seam's `nodeTransport().fetch(nodeId,
request)`, which the desktop helper sends through the pinned broker; with no transport it falls back to a
same-origin `fetch`. The standalone server can be tested with a direct
fetch client, but it does not provide a renderer shell. Shared repository-picker and task-status
reads are generic shell query wrappers backed by the owning source's `repository` contribution;
provider routes and response types do not live in client-core.

TanStack Query is the server-data cache. There is one QueryClient/persister scope per Node. Query
keys do not need an ad hoc Node prefix because the cache itself is partitioned. Fleet queries fan out
per Node and must not write aggregate shapes into ordinary per-Node keys.

## Connection and freshness UI

The broker exposes `online`, `degraded`, `offline`, `incompatible`, and `revoked`. Client-core maps
these plus query state to `live`, `refreshing`, `stale`, `offline`, `disabled`, and `error` displays.
Offline reads use cached values with a Node badge; mutations fail fast and retain drafts.

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

The top bar's bell renders two kinds of item, and the difference matters to whatever produces one. A
notice is an event that already happened, such as a run finishing or a build failing. It is
client-local, dismissible, and gone once the ring rolls over it. An attention item
(`registries/attention.ts`) is a state that lasts until something changes on the Node: a pending
approval is still pending after a person dismisses it, so it returns on the next fetch. That is why
attention items are fetched per Node rather than pushed, and why they carry no `read` flag. A notice
is fired once and forgotten.

## Restore and persistence

Launch restore proceeds in this order: fleet membership and Node records, active Node, selection and
main view, task, task layout, and pane-local state. Missing Nodes and unknown pane IDs render repair
states rather than throwing.

Device presentation preferences include theme, style pack, keybindings, and layout. Node preferences
include operational settings and setup state. Draft text remains client-local and is not treated as
successful server state. Secret fields are never persisted in renderer storage.
