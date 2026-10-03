# Descriptors

This page covers descriptors: contributions that are data the host draws, not code. It covers rail
sources, content links, routes, and which action verbs each click site takes. It's part of the
[plugin reference](../plugins.md). Agent contexts, resolvers, schedules, and themes are in
[more descriptors](./more-descriptors.md).

The public manifest schema is `@acorn/protocol/plugin/contract.ts`, and its private `manifest/`
modules group surface, chrome, command, extension, display, and Node runtime descriptors.
`packages/node-core/src/server/plugins/manifest.ts` applies the rules that need the plugin id or
compare contributions. Clients use the same wire types and check values from roster rows again.

## Descriptors

The descriptor kinds are rail sources, slot badges in the task footer or the topbar, commands and
keybindings, attention items, node stats, context-menu rows (`contextMenus`), URL recognizers
(`contentLinks`), renderer routes (`routes`), agent contexts (`agentContexts`), reference resolvers
(`refResolvers`), typed data sources (`dataSources` and `dataSourceDiscoveries`), schedules
(`schedules`), and color themes (`themes`).

The host renders them with its own components and fetches their content from routes in the plugin's
own `/v1/p/<id>/` namespace (`packages/client-core/src/host/chrome/`). They stay live when no frame
of the plugin is mounted. A plugin that ships only descriptors needs no client bundle and no trust
prompt, because none of its code runs on the device. [Keeping a descriptor
fresh](./freshness.md) covers when the host reads them again.

## Rail sources

A rail source's rows come from a route on the plugin's node half, and the host draws them. A source
can declare:

- `createTask`: the row supplies the task seed and an optional external link. The host owns the
  modal, the origin namespace, the connection ownership check, create-before-link ordering, and
  partial-failure reporting.
- `projectScoped`: the items route reads the shell's project. The host appends `?project=`, keys the
  cache by it, and offers the topbar project picker while the source is on screen.
- `showInRailByDefault: false`: the source starts with no desktop rail icon. It still registers, the
  palette offers **Open <label>**, and the person's **Show in left rail** choice wins.
- `requiresGitProject: true`: the source draws only while the active workspace has a Git project.
- `emptyState`: one bounded message and at most one action, shown when the route answered with no
  items. It isn't shown when the fetch failed, because an unreachable Node has its own banner. It
  takes the narrow verb set described in [action verbs](#action-verbs).
- `tracksRef`: whether a task already tracks an external item, for a source that records the
  relationship somewhere other than `task.links`. A github-pr task records its pull request as
  `pullNumber`. The host asks links first, then every source.
- `defaultPane`: the pane a tracked task opens on the first time it's activated. The device checks it
  against the panes this manifest declares.

A row may give its icon a semantic `severity` and ask for `fieldsFirst` when a stable identifier
must come before the title. `short` is the row at the width of an icon rail, a few characters such
as a ticket key or an HTTP verb. A row with neither `short` nor `icon` gets a dot and a tooltip. Two
places in `client-core/host/chrome/chromeData.ts` rebuild a rail row field by field from an
allowlist, so a field added to `PluginRailItem` must be added to both, or it's dropped silently.

A source can offer a panel area beside its list instead of a detail pane: a dashboard the person
composes, under constraints the source declares in `panels`
([placements](../dashboards/placements.md)). A source declaring both `panels` and a `navigate`
`onSelect` is a parse error, because the detail half of the browse is drawn in that rectangle.

A device-held source uses `tree: { list, detail }` instead of a route ([device-held
plugins](./client-half.md#device-held-plugins)). The list's mount props carry `collapsed`, which is
`true` while the reader has the list at icon width. Give each row a `collapsedIcon` and a `label`
for its tooltip then, and leave out headers and toolbars.

## Content links

A `contentLinks` entry uses a bounded `https://` host and path grammar and delivers one captured path
segment to one of three destinations:

- A task-scoped `openPane` from the same manifest, which receives it as a `plugin:select` intent in
  the active task.
- The plugin's own reference panel, shown over whatever the reader was looking at.
- The plugin's own route, for a compiled recognizer that declares a `path` resolver.

A link must have a pane or a panel, or the manifest is rejected. The grammar is exact-arity, with no
trailing wildcard, so a URL shape with an optional last segment needs one entry per arity.

The clicking surface picks the destination: a pull-request conversation asks for the panel, a note
takes the pane, a dashboard row asks for the route. Each is a preference, and the host falls through
the other two in a fixed order when the one asked for is missing. The panel is never named. The host
stamps the plugin id onto every recognizer and resolves the panel by provider, so a manifest can't
point a link at another plugin's panel. Taking a route also selects the rail source that owns it.

## Routes

A `routes` entry gives a project-scoped surface a URL. Its `path` is confined at parse time to the
prefix the host mints from the plugin id, `/p/:projectId/x/<plugin-id>/`, so it can't claim core's
paths or another plugin's. It names a project-scoped `surface` from the same manifest and one `item`
parameter of its own path. The host does the matching and supplies the value.

A source's `onSelect: { "verb": "navigate", "surface": … }` changes that URL from a clicked row. The
URL is where a project-scoped surface keeps its selection, because it has no layout state. A route
addresses an item inside a surface and never gates whether the surface renders, because the rail
selects a source by signal and doesn't navigate.

## Action verbs

A descriptor hands the host a verb from a closed set, and the host runs it. The full set belongs to a
rail source's `onSelect`, the one click site with a selected row, a routed project, and the host's
promotion callback in scope ([the action verbs](../plugin-authoring/contributions.md#the-action-verbs)).

Commands, slot badges, context-menu rows, and a source's `emptyState` take the narrow set:
`openPane`, `openTask`, `runNodeAction`, `openUrl`, `openOverlay`, and `surfaceAction`. `createTask`
needs a selected row, and `navigate` needs a routed project. A `search` command's `onSelect` also
takes `navigate`, because picking a row supplies both halves of the address.

`surfaceAction` is the one verb whose effect lands inside a plugin. It delivers the command's own id
to a region of one of the plugin's panes. It may only name a pane from the same manifest that draws a
frame or tree region, and it's useful only on a command, because what it delivers is the command id.
In a `document-over-frame` pane, the host flushes the document before delivering it
([surface actions](../editor/composed-panes.md#surface-actions)).
