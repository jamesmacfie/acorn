# What a plugin loses in the terminal

This page lists what each extension kind and host slot does in the terminal client compared with the
desktop. Read it before you add an extension kind or a host slot. It's part of
[the terminal client](../tui.md).

## What a plugin loses here

A plugin writes no terminal UI, declares no `tui` surface, and learns nothing about the host. This
table is everything that changes, one row per cooperative extension kind and host UI slot:

| Kind or slot | Desktop | Terminal | Where the answer lives |
| --- | --- | --- | --- |
| `rows` (`pane.footer`) | A strip of rows under the pane's frame | A `Rows` collection at the end of the pane, one per contributor, headed by its label and plugin ID | `apps/tui/src/kit/host.tsx` § `ExtensionRows`, drawn by `apps/tui/src/plugins/ExtendedPane.tsx` |
| `annotation` | Marks in the diff row under the code. `core:task` marks become rail markers. | Diff marks below the code. Task rows show a count and offer `Shift+F10` for the full legend. | `apps/tui/src/kit/showing/diffRows.tsx` § `AnnotatedDiffLine`, and [task markers](./chrome.md#task-markers) |
| `remote` (a `Slot`) | The contributor's tree in the owner's view | The same tree in the same place, from the same batch | `apps/tui/src/kit/host.tsx` § `Slot` |
| `rectangle` (`pane.inline-*`) | Another plugin's iframe | One muted line naming the point | [Rectangles](./rectangles.md#rectangles) |
| `hook` | Runs on the Node | Runs on the Node | Nothing to draw on either host |
| `pane.aside` | A dashboard grid beside the pane | One muted line naming the point | [Dashboards](../future/dashboards/README.md#the-terminal-client) |
| `rail.taskList` (exclusive slot) | The replacement draws instead of core's list | The same, through the same arbitration | `apps/tui/src/chrome/slot.tsx` |
| `overlay`, `drawer`, `task.footer`, `task.switcher.extra`, `topbar.*` | Host UI slots a plugin fills | Not drawn | [Plugins](../plugins.md) |

The last row costs five first-party registrations. GitHub's and Agents' `overlay` entries mount
commands that need the router or a query client, and onboarding's first-run screen is a real
`overlay`. Terminal takes `drawer` and Docker takes `task.footer`. The terminal client's overlays are
a fixed set the shell draws, so giving a plugin those places would be a contract for both hosts.

Terminal still registers its Node-scoped session source here. Shared code can list sessions and send
its action with the selected Node and session, but this shell has no Terminal session panel to type
into. The editor's file PTY is a separate view.

So GitHub's changed-file and pull request searches and Agents' two settings are desktop-only, because
the registrations that create them aren't mounted. The editor's `⌘P` works here, because it's a
`search` command its plugin registers at boot.

A canvas isn't lost. The kit's `Graph` node draws cards on a grid with curved edges on the desktop,
and here it draws an indented list: the same cards in the same order with the same selection,
indented by rank, with `⇐ n` on a card that waits on more than one. Both hosts take ranks from
`packages/client-core/src/kit/lib/layout/graphLayout.ts`. Dragging an edge becomes a picker under the
list. A plugin writes the same `Graph` for both.

A contribution is as reachable as the nodes it draws. A contributor that draws a `Button` inside a
`Slot` is a stop, reached with `↓` and pressed with Enter. One that draws only `Text` isn't a stop.
A plugin can't change the `packages/client-core/src/kit/tokens/focusRoles.ts` table. A `Card` with an
`onPress` is one stop, and the walk doesn't go inside it, so a card that holds controls doesn't take
a press.

A plugin's own chord is pressed with Ctrl here. A manifest chord is `meta+ctrl+alt+shift+key`, and the
command layer rewrites `meta` to `ctrl`, because a terminal emulator keeps Cmd. So `meta+shift+p` is
Ctrl+Shift+P, and `meta+ctrl+alt+shift+d` is Ctrl+Option+Shift+D. The manifest doesn't change.

What a reader loses per plugin is one row each in
[first-party plugins in the terminal](../first-party-plugins/terminal.md). Everything
crosses except three rectangles, and the PTY, the rectangle an agent workspace depends on, works well
in a terminal.

The four plugins that register a settings page draw it in the Settings route, except the terminal
plugin's drawer page, which the route lists and points at the desktop
([settings](./sources-and-settings.md#settings)).
