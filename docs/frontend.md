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
rail sources, commands/keybindings, settings pages, slots, rail markers, palette rows,
context-section slots, ref panels, agent contexts/renderers, schedules, persisted-state slices, Node
stats, attention sources, brand marks, and content links. The host owns the returned disposables so a plugin can be disabled and
reactivated without duplicate entries.

A pane registers either a `component` or a `layout` plus a `regions` record. The layouts are the
host's, one per name in `client-core/src/layouts`, and the registry turns a declared one into the
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
has two forms: `'desktop'` asks whether a desktop shell is hosting this renderer, and `{ plugin: id }`
asks whether the node runs that plugin. An array means all of them. Both are answered by
`hasHostCapability()` in `client-core/src/hostCapabilities.ts`. `when` is a free predicate the
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
was reviewed on 2026-08-28. **One survives.**

| Site | Decision |
| --- | --- |
| `plugins/preview` task pane | **Kept.** A `WebContentsView` the shell positions over the renderer. No HTTP route behind it, nothing for a browser client to draw. |
| `plugins/agents` pane and three settings pages | → `{ plugin: 'agents' }`. Managed sessions are `/v2` plus the shared WebSocket. |
| `plugins/editor` pane, file palette, find-in-files command | → `{ plugin: 'editor' }`. File reads and ripgrep are routes. |
| `plugins/terminal` settings page, and the four terminal commands in `TaskView` | → `{ plugin: 'terminal' }`. The drawer is a WebSocket stream, not a shell feature. |
| `plugins/changes` pane | → `{ plugin: 'changes' }`. |
| `plugins/notes` task pane | → `{ plugin: 'notes' }`. |
| `plugins/workflows` settings page | → `{ plugin: 'workflows' }`. |
| `tasks/taskStatus.ts` schedule | **Gate dropped.** `/v2/core/task-statuses` is a core route. It stays a *client* clock deliberately: it refreshes what a window is drawing, and nothing needs it when no window is open. |

Adding a new `'desktop'` gate means writing a row here saying what only a shell can do.

Which registries carry which gate follows a rule now, rather than from history. **Every contribution the
host filters before drawing takes `requires`**, because the question is the host's and the answer is the
same everywhere, so an author never has to remember which registries opted in. `when` is deliberately
not uniform: it is the contribution's own predicate over whatever context that draw site has — a task
for a pane, `UiSlotContext` for a shell slot, nothing at all for a rail source — so it exists where the
host has a context to hand it and is absent where there is none, such as a client schedule or a settings
page. Sources, ref panels and extension points gained `requires` on 2026-08-27 to close that out.

Every registry's `order` is a required field, not inferred from where its plugin activates. Plugin
activation order is invisible in the code, so leaving order optional and falling back to activation
order let a reorder land with nothing to catch it. Panes, rail sources, settings pages, shell slots,
and palette rows all sort on this explicit field.

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
(`registries/nodeStats.ts`). The card lives in client-core, which cannot import the agents or
workflows plugins to ask them directly, so a plugin registers its own labelled count instead. A stat
is fetched per Node the way the attention inbox is, but is not merged with it: an attention item is a
navigable row with a severity and a target, and a stat is one integer with a label.

A plugin's status markers on a rail control are data, not markup: `registries/railMarkers.ts` takes a
callback returning marker descriptions for one task, source, or pane, and the host decides the corner,
the colour, the spin, and the tooltip legend
([ui-design.md § Rail controls and status markers](./ui-design.md)). The callback runs inside the
consuming render, so a plugin reads signals it already owns and the rail re-renders when they change,
rather than the host inventing a query observer per rail button. One throwing contribution is isolated;
the rest of the control still draws.

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
