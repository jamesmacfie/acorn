# Rail and routing

This page covers how rail sources are gated, ordered, and shown, the markers and stats a plugin adds,
and how routes and tasks map to sources. Read it before you add a rail source or a route. It's part of
[frontend](../frontend.md).

## Rail sources

Rail sources declare their `order` and may declare `isDefault`. `defaultSourceId()` resolves the
default after plugin registration, falling back to rail order. The shell uses it for the first
selection, persistence, workspace restore, and task fallbacks. Provider navigation commands belong to
the owning plugin.

A rail source can gate itself with `when`. Core's Fleet home uses it: it shows only once more than one
Node is registered.

A rail source behind a provider that lists projects (`supportsProjects`, see
[integrations](../integrations.md)) has one more gate: the active workspace has to link one of that
provider's projects. Connecting Rollbar or Linear covers the account, but their items belong to a
workspace. The mapping comes from core's workspace rows, not the plugin, and the gate waits until both
the provider list and the mapping have loaded, so the rail doesn't flicker. You link projects on a
connection's page under **Settings > Services**, or on a workspace's page. The gate asks only whether
the workspace follows any of that provider's projects, not whether the routed project does.

### Rail source visibility

Whether a plugin's source shows an icon in the left rail is your choice, and it's presentation, not a
gate. `availableSources` (`packages/client-core/src/features/tabs/railSources.ts`) still answers "can
this source open", and `packages/client-core/src/features/tabs/railVisibility.ts` applies your choice
only where `TabRail.tsx` lists icons. So a hidden source that a command selects, such as Docker's **Open
Docker**, still opens.

- A source declares `showInRailByDefault: false` to start hidden, on a compiled `SourceContribution`
  or a loaded source descriptor (`packages/protocol/src/plugin/manifest/chromeDescriptors.ts`).
  Absent means shown.
- The choice is one device preference, `rail_visibility`, a JSON map from `<pluginId>:<sourceId>` to
  `true` or `false`, mirrored to `acorn.json` as `railVisibility`. The owner comes from the source
  registry. An absent entry reads the source's default, and an entry for a missing source stays, so a
  plugin that comes back with the same IDs comes back as you left it. It's separate from `rail_order`,
  so dragging and hiding never overwrite each other.
- Core's sources, Home among them, always show.
- Hiding the source on screen goes back to Home. Showing one adds its icon and moves nothing.
- Every hidden, available source gets a palette row, **Open \<label\>**
  (`packages/client-core/src/host/palette/sourceOpeners.ts`). A plugin that registers
  `source.<id>.open` keeps its own row.
- The switch is drawn in two places: **Settings > Plugins > Rail and surfaces** lists every plugin
  source, and the plugin strip above a plugin's settings page draws one for each source the page names
  in `railSourceVisibility`. A plugin page's own code never touches the preference.
- The terminal client's source menu lists every available source whatever this preference says.

### Markers, stats, and grouping

A Fleet home Node card can carry a plugin's own number beside core's task count
(`packages/client-core/src/host/registries/rail/nodeStats.ts`). A stat is fetched per Node, like the
attention inbox, but isn't merged with it: a stat is one labeled integer.

A plugin's markers on a rail control are data. `features/tabs/railMarkers.ts` takes a callback that
returns marker descriptions for a task, source, or pane, and the host decides the corner, color, spin,
and legend ([rail controls](../ui-design/shell-hierarchy.md#rail-controls)). The callback runs inside
the rail's render, so a plugin reads signals it already owns. A throwing contribution is isolated. The
display types live in `kit/tokens/rail.ts`.

Loaded task markers come through `core:task`, the annotation point. The rail sends the visible task
IDs once per contributor. Each request's identity includes the contributor's registration, the active
Node, `chromeDeps(pluginId)`, and the visible keys, and the shared chrome watcher already advances that
freshness, so annotations add no per-row query, timer, or subscription. A changed identity clears and
aborts only that contributor, and a generation check rejects late answers. Results merge in
registration order ([task annotations](../plugins/rows-and-annotations.md#task-annotations)).

Tasks created through the workflow child seam carry `workflows:child`. Both rails use the same pure
hierarchy projection to fold them under their root, show only an active descendant's ancestors, and
keep the full list for drag-order writes. Expansion is a device-local view preference.

## Routing

The router is registry-driven. A source contributes path shapes with an explicit `order`, and the shell
composes them before rendering, so a static route stays ahead of a parameter route.

Core's URLs are constants in `packages/client-core/src/host/registries/commands/corePaths.ts`:
`/p/:projectId`, `/p/:projectId/new`, and `/t/:taskId`. A contributed route addresses something inside
a view, and never decides whether the view renders. A browse source renders at `/p/:projectId`, and
GitHub's `/pulls/:number` and Linear's `/issues/:identifier` select an item in it. Selecting a source
in the rail sets a signal instead of navigating, so a source that gated its render on a route match
would be unreachable.

Reading the routed project is opt-in: `SourceContribution.projectScoped`, or `projectScoped` in a
manifest. GitHub, Linear, and Rollbar declare it, and Home, Fleet, Docker, and Agent Center don't.
Every control that changes the project asks `sourceIsProjectScoped` about the source on screen, which
is why the top bar's project picker is absent on Home. A manifest source that declares it gets
`?project=` on its items route and the project in its cache key. The picker still appears in a task
view.

A source can hand over two halves instead of one component. `SourceContribution.regions` takes a
`list` and a `detail`, the shape a `list-detail` pane declares. On the desktop, `SourceSurface`
composes them with `ListDetail split`. The terminal client draws the list in its Browse panel and the
detail in the main area ([terminal chrome](../tui/chrome.md) § The screen). Descriptor sources do the
same. A source that keeps `component` renders as before, with the terminal's Browse panel empty.

### Where a task lives

`SourceContribution.taskPath` lets a source claim a task's URL, so GitHub puts a PR-backed task at its
pull request's URL, and `pathForTask` falls back to `/t/:taskId`. Two more claims ride on this:

- `origins` maps the task origins a source creates to their glyphs, because a source's rail ID and
  the origin it stamps can differ. GitHub's rail is `github`, and its tasks carry `github-pr`.
- `defaultPane` is the pane a task opens on the first time. `defaultPaneForTask` asks the owner of the
  task's URL first and a link's provider second. A task no source claims keeps the layout default.

Task panes use query parameters: `/t/:taskId?pane=…&item=…` becomes a `PaneIntent` once and is then
stripped ([addressing a pane](../panes.md#addressing-a-pane)).
