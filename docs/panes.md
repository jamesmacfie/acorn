# Panes

A task draws as a flat, ordered row of panes that plugins contribute. Read this page to find which
panes ship, how a pane is addressed, and which topic page owns the layout, region, model, and
contribution rules. `PaneId` is a persisted string that the contribution owns. Core keeps no closed
list of pane IDs.

## Shipped panes

These panes ship with acorn:

| ID | Order | What it shows |
| --- | ---: | --- |
| `pr` | 10 | The linked GitHub pull request |
| `agents` | 15 | The managed Agent pane |
| `changes` | 20 | The worktree diff, staging, commit, and remote actions |
| `workflows` | 25 | Workflow runs on this task, their nodes, and the selected node's work, which for an agent node is its whole conversation |
| `notes` | 30 | Task, workspace, and global notes |
| `context` | 40 | Context selection and sync |
| `editor` | 50 | The worktree editor, with find in files as a sidebar panel |
| `database` | 70 | A loaded plugin's tree: a host-drawn SQL editor over the plugin's result grid |
| `docker` | 75 | The task's containers |
| `http` | 76 | A loaded plugin's tree: an API request client for this task |
| `preview` | 80 | The browser preview |
| `linear` | 90 | A loaded plugin's tree: the linked issue, the selected row, or a content-link target |
| `rollbar` | 100 | A loaded plugin's tree: the linked item |

Some panes appear only when the task has something to show:

- `workflows` uses `list-detail` and a `when` gate, so a task that has never run a workflow gets no
  button ([workflows](./workflows.md) § The run pane). It declares the same 640px minimum width as
  `agents`, because an agent node draws the same composer.
- `preview` has a `when` gate too. A task with no run-target URL and no project preview setting gets
  no button ([shell](./shell/webviews.md) § Host-owned webviews has the check).
- `database` is gated through its manifest's `availability` route. A task with no connection script
  and no `DATABASE_URL` in its worktree `.env` or the Node's environment gets no button
  ([database](./database.md) § Connection resolution).

Compiled provider panes appear when their provider is connected and the task has relevant data. The
four loaded panes, `database`, `http`, `linear`, and `rollbar`, come from manifests and appear
whenever the plugin runs on the Node the window is talking to. All four draw **trees**: their code
runs in a worker and emits a tree of the host's own components, which the host mounts. So they get
the host's focus behavior, keys, ARIA, and appearance, and ship no stylesheet
([plugins](./plugins.md) § The tree contract). A `frame` region is still available for a pane that
draws its own pixels, and none of the four needs one.

A task pane whose manifest also names a `providerId`, as `linear` and `rollbar` do, is a
linked-items view. The host hides it on tasks with no link from that provider. `database` and `http`
are useful with nothing linked, so they show on every task their gate allows.

`database` is the one composed pane. Its manifest declares a `document-over-frame` layout. The host
draws the SQL editor in the `document` region and the drag handle, and the plugin draws everything
below them. The lower region names a `remote` entry instead of `"frame"`, so both halves are
host-drawn components. To the task layout row it's one pane with one ID, and the row knows nothing
about the split inside it ([plugins](./plugins.md) § Document surfaces).

Three loaded plugins also declare a project-scoped pane: `http-project`, `linear-issue`, and
`rollbar-item`. These aren't in the table because they aren't part of a task's layout. See
[pane scope](#pane-scope).

## Pages

<a id="layout-model"></a>

[Pane layouts](./panes/layout.md) covers the two layers of layout: the task layout row and the
switcher, then the eight named layouts inside a pane with their desktop, narrow, and terminal
projections.

<a id="the-host-owns-a-regions-inset"></a>

[Pane regions](./panes/regions.md) covers what the host does inside each region: inset and padding,
the reading width, per-pane layout state, hidden regions, splits drawn inside a region, and the
wizard.

<a id="there-is-no-keepalive"></a>

[Pane models](./panes/models.md) covers the state a pane's regions share, how long it lives,
`pane.shown()`, and why there's no `keepAlive`.

<a id="contributions"></a>

[Pane contributions](./panes/contributions.md) covers registering a pane, `hidden`, `collapsible`,
`readsArchived`, availability gates, the region kinds a loaded plugin can declare, `prefetch`, rail
markers, and find in files.

## Addressing a pane

A task's URL is `/t/:taskId`. The layout row holds focus and maximize state, and a URL that tried to
own it would go stale the moment you moved a pane. What a URL can address is what `PaneIntent`
models: `/t/:taskId?pane=<paneId>&item=<id>` opens that pane on that item.

`packages/client-core/src/features/tasks/taskDeepLink.ts` reads the parameters once and strips them,
because the layout restores itself from its own persisted state. A lingering `?pane=` would keep
asserting a view you'd left. An unknown pane ID is rejected instead of dispatched, so a bad link
can't push a placeholder into the durable layout. Every pane gets this without contributing a route.

## Pane scope

A pane is task-scoped unless something says otherwise. A loaded plugin can also declare a
project-scoped pane with `"scope": "project"` in its manifest. It draws beside its own rail source's
list at `/p/:projectId`, has no task, and never enters a task layout. None of the layout row,
`?pane=` and `?item=` addressing, or `paneRegistry` applies to it. It lives in its own registry,
`packages/client-core/src/host/registries/panes/projectSurfaces.ts`, so those consumers don't branch
on a scope they can't act on.

A project-scoped pane exists because a rail row click often has no task, and `openPane` needs one.
It has no layout state to keep a selection in, so its selection lives in the URL. Each pane gets one
route under the host-minted `/p/:projectId/x/<plugin-id>/` prefix. So a clicked rail row, a pasted
link, and the back button all work the same way. The task-scoped verb, `openPane`, and the
project-scoped one, `navigate`, name separate sets of panes. The manifest parser checks this, so
neither verb can reach a pane it would fail on. See [frames](./plugins/frames.md).

## Not a pane: the reference panel

A reference panel shows one item over whatever you were looking at, and you dismiss it instead of
closing it. It has no layout entry, no `PaneId`, no `?pane=` address, and nothing persisted. A plugin
contributes one keyed by the provider whose items it renders, and may only name its own provider
(`packages/client-core/src/host/registries/panes/refPanels.ts`). The shell holds which item is open
and draws it in one place, so any surface that renders content can call
`openRefPanel({ providerId, displayId })` and get any installed provider's panel. Opening a second
panel replaces the first.

When the named provider has no registered panel, `openRefPanel` returns `false` instead of opening.
A claim can come from a plugin's recognizer or from a plugin naming a provider it doesn't own, and
opening anyway would leave an empty overlay with no way to dismiss it. The caller then falls back,
for example to the browser URL. [Plugins](./plugins.md) § The client half of a loaded plugin owns
the loaded plugin's side.

Any reference panel can offer a "find or create a task for this" action through one host-drawn
component, `packages/client-core/src/host/components/RefPanelTaskLink.tsx`. Creating a task writes
a worktree to disk and needs `core.tasks:write`. A plugin that drew the button itself would need that
permission for everything it does, to earn one click. So the host draws the button and does the
write. The same component works whether the host wraps the panel, as for a loaded plugin's
`refPanel` frame, or the panel draws its own chrome, as a first-party panel does.

A pane answers "show me this provider's items for this task". It's richer, and it takes over the
area you were using. A panel answers "let me glance at this one thing". It needs no task, so it also
works in browse views and beside a rail list. The clicking surface picks one and falls back to the
other.

## Data and actions

Pane reads use the active Node's typed API client and the TanStack Query cache. Pane writes go to the
Node that owns the task. Offline, reads stay visible and marked stale, and writes fail fast and keep
your local text. Preview and loaded-plugin `webview` panes are child webviews the shell owns. Plugin
pages use the manifest's host allowlist and an isolated, temporary data store, and have no debugger
access. Terminal and agent panes use the Node's event and stream socket.
