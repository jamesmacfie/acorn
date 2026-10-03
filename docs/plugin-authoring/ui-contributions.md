# UI contributions

This page covers the manifest keys that change how acorn looks or what its menus offer: themes, style
packs, context-menu rows, and replacements for core surfaces. It's part of
[the manifest](./the-manifest.md).

## Themes

A theme has no route and no bundle behind it, so it's the cheapest contribution a plugin can make:
`{ id, label, dark?, tokens }`. `tokens` must carry exactly the palette token names and nothing else.
A missing name, an unknown name, a derived token such as `--danger`, or a style token such as
`--radius` fails the parse.

Values are a hex color or a flat color function, such as `#1e1e2e`, `rgba(0, 0, 0, 0.42)`, or
`oklch(0.7 0.15 250)`. Named colors, `var()`, and nested functions are refused. `dark: true` says the
theme is dark, and the host writes `--is-dark` and `--color-scheme` from it, so never set those two.
The theme appears in **Settings > Appearance** as `plugin:<your-id>:<theme-id>`, and falls back to the
built-in default whenever your package is missing.

Call the `plugin_authoring` agent tool for the current token list. It's read from the Node's own
schema, and one wrong name means the manifest doesn't parse. [Plugin
themes](../ui-design/appearance.md#plugin-themes) owns the token contract.

## Style packs

A package may declare `contributions.styles`, up to eight. A style entry has an `id`, a `label`, an
optional `description`, and a partial `tokens` map, such as
`{ "--row-h": "28px", "--font-mono": "'JetBrains Mono', monospace" }`. The host generates the CSS, and
the manifest can't contain selectors. `@acorn/protocol/styleValues.ts` lists the supported token
families and value rules. A bad token rejects the pack at install, and the client checks it again
before adding a style to the shell.

A pack may set the role aliases the built-in packs set, such as `--radius-surface: var(--radius-lg)`
and `--font-ui`. [Plugin style packs](../ui-design/appearance.md#plugin-style-packs) lists the tokens a
pack may not set.

## Context menus

A `contextMenus` entry is `{ id, location, surface?, label, icon?, order?, when?, action }`. `location`
is a closed list: `task.row`, `item.row`, `rail.source`, and `rail.pane`. Call `plugin_authoring` for
the current list. A location this Node doesn't have is a parse error.

`when` is a map, not an expression. Every named fact must equal the target's own, so
`{ "origin": "github", "pinned": true }` means both, and `{ "pinned": "true" }` matches nothing,
because a string isn't a Boolean. Naming a fact the location doesn't supply is refused. Your row lands
in the same menu core's rows come from, after them by default, with order 500 against core's 10, 20,
and 30. The host namespaces its id to `plugin:<your-id>:<row-id>`.

Desktop icon menus use `rail.source` and `rail.pane`. Set `surface` to the exact id of a source or
task pane in this manifest, even when it differs from your plugin id. The host adds its own Open and
pane layout actions, and your rows follow them. A `runNodeAction` receives
`{ "rail": { "location": "rail.source", "sourceId": "...", "projectId": "..." } }` or
`{ "rail": { "location": "rail.pane", "paneId": "...", "taskId": "...", "projectId": "..." } }`. An
empty project id means no routed project. `task.row` and `item.row` requests keep their
`{ "item": "..." }` body. A source icon names no task, so use `runNodeAction`, `openUrl`, or
`openOverlay` there.

Rail menus are desktop-only, so use a command or a visible control when an action must also work in
the terminal. These locations need a Node and desktop release that knows them. API major 3 alone
doesn't make an older release accept a location. [Context menus](../plugins/menus-and-markers.md#context-menus)
covers what the host binds.

## Replacing a core surface

A `coreSlot` surface offers to draw one of acorn's own surfaces: `{ target: "coreSlot", id, label,
coreSlot }` plus a client bundle. The designated surfaces are `rail.taskList`, `pane.switcher`, `rail`,
and `topbar`. The last three require a `single` layout with one remote-tree `body`, and the host gives
that tree data and named actions.

A `rail` or `topbar` tree can place its one nested host slot with the `Slot` node and the `slotRef`
in its props. Declare `placesSlots: ["rail.taskList"]` or `["topbar.right"]` when you place it, or
Settings warns. Declaring a replacement takes nothing: the person picks the provider in **Settings >
Plugins > Rail and surfaces**, and acorn draws its own again when your plugin is disabled or its
surface fails ([replacing a core surface](../plugins/replacing-core-surfaces.md)). A `coreSlot`
surface isn't a pane, so no pane verb can name it.
