# Palette data

This page covers the rows the palette session draws, what a manifest command can declare, the verbs
a row can run, context-menu rows, and the decisions the palette refuses. Read it before you add a
manifest command or widen what a row can do. It's part of
[command palette and shortcuts](../command-palette-and-shortcuts.md).

## Palette data

Every row the session draws is a `SessionRow`: an ID that stays the same across a refresh, a label,
and an optional hint, badge, and breadcrumb. It has one of three actions: enter this command's frame,
run this, or nothing. A row with no action is a line that explains why the list is short, and it's
never the selection. The renderers get that and no more, so neither knows what a run target, a task,
or a Rollbar issue is.

Rows can be static or backed by a task or a Node. Fleet rows carry a Node label and tolerate some
Nodes being unavailable. A row's action goes to the Node that owns its resource. No action spans
Nodes as one step.

Run targets, layout recipes, and workflow definitions come from the Node's task configuration. The
session reads them once when their frame opens and filters on the device after that. Pane and source
commands are registered by the plugin that owns them.

A compiled plugin whose rows are already on the machine uses the load-once adapter
(`packages/client-core/src/host/registries/commands/localSearch.ts`): no delay, no minimum query, one
fetch when the frame opens, and local filtering after that.

## Manifest commands

A loaded plugin's manifest `commands` join the same command registry. One command supplies both its
optional palette row and any keybinding target. Every manifest command states its `kind`, and its
`palette` flag says whether it appears in the palette. A manifest can declare an action, a group, a
search, an input, or a setting. [The manifest](../plugin-authoring/the-manifest.md#contributions)
lists each kind's fields and bounds.

A declarative search names a route in the plugin's own namespace and one fixed verb for the picked
row. The host sends the query and the identifiers the declared scope owns, drops every field of the
answer it doesn't name, caps the rows it draws, and runs the manifest's verb. A response can't name a
route, a URL, a command, or a verb, which is why a plugin's live rows are safe to draw in a host view.

A declarative setting names two routes in the plugin's own namespace and a fixed list of choices. The
host sends a GET to the read route when the frame opens, and a PUT to the write route with the chosen
value and the identifiers the declared scope owns. Both answer `{ value }`. A value that names none
of the declared choices is refused in both directions. Secrets and free-form values can't be
settings.

### The navigate verb

A search can pick its row with `navigate`, which no other command can name. Rollbar and Linear use
it. Their item detail belongs to the project, not a task, so picking a row changes the URL and the
view beside the rail list follows, as a click in that list does. Only a search at project scope can
use it, because it needs a selected row and a routed project. The host still builds the address from
the pattern it registered, with the row's sanitized ID as the item.

### The surfaceAction verb

`surfaceAction` delivers the command's own ID into a region of one of the plugin's own panes, and the
plugin handles it as it would its own button click. Database's **Run query** and HTTP's **New
request** use it, because running the editor's SQL and starting a blank draft happen inside a pane,
not on the Node. When nobody has the pane open, nothing is listening and nothing happens.

## Context-menu rows

Context-menu rows have the same limits as commands but their own registry. A menu row is a label, an
order, a check over what's under the cursor, and one verb from the same fixed set a command takes, so
a right-click can do exactly what a command can do. They stay separate
(`packages/client-core/src/host/registries/panes/contextMenus.ts`) because a command is global and a
menu row is about one thing. Core's own row actions register there too
([UI design](../ui-design/interaction.md) § Menus and right-click).

## What the palette refuses

Each of these is decided. The sentence after each says what would reopen it.

- **A plugin-drawn palette frame.** The palette owns global focus, reserved keys, navigation,
  loading, errors, and running results, so a plugin returns facts and a fixed verb, and a custom flow
  is a pane or an overlay. An architecture rule holds it, and nothing reopens it.
- **A second registry for each interactive kind.** Groups, searches, inputs, and settings share
  shortcuts, capability gates, ownership, and outcomes with commands. A kind with no command meaning
  at all, such as a background job nobody invokes, would reopen it.
- **Commands returned from a loaded search response.** A route's answer is untrusted, and letting it
  choose a verb or a URL makes it more powerful than the reviewed manifest. A schema-bounded result
  action contract with a trust disclosure would reopen it.
- **Secondary actions on a result.** Deferred, not refused. A result has one primary action until
  someone using a concrete view asks for a second one.
- **Fleet search by default.** It multiplies provider requests, latency, rate limits, and partial
  errors, so scope defaults to the active Node. One indexed fleet query from a control plane would
  reopen it.
- **Calling a model as you type.** Generation costs money, takes longer, and is something you ask
  for once. Database's **Generate SQL** is an input you submit. Nothing reopens it for ordinary
  typing.
- **Building commands from Settings pages.** A page is a component, not a field schema. A typed
  settings schema that every renderer draws would reopen it.
- **Free-form secret settings.** A `setting` is a bounded choice with a visible value. A dedicated
  secret-entry design would reopen it.
- **Adding children to another owner's group.** It hides lifecycle coupling and makes ownership
  unclear during a disable. An extension point the parent owns would reopen it.
- **Replacing every picker with the palette.** The editor and GitHub file finders became commands
  because each had a shortcut and one outcome. The workspace picker uses the overlay helper
  (`packages/client-core/src/host/palette/overlay.ts`). A picker becomes a command when it's globally
  useful and needs no extra context.
