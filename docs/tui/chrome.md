# Terminal chrome

This page covers the shell the terminal client draws around the panes: the screen, the panels, the
palette, overlays, and the notification count and inbox. Read it before you change
`apps/tui/src/chrome/`. It's part of [the terminal client](../tui.md). On the desktop this shell is
bespoke DOM, and [UI design](../ui-design/shell-hierarchy.md) § Shell hierarchy has the two side by side.

## Chrome

`apps/tui/src/chrome/` draws the shell around the panes. It's terminal-owned, not kit.

### The screen

Left to right and top to bottom: one top bar line, a column of three framed panels, the active pane
with a strip of pane labels above it, and one footer line.

The three panels are Menu, Browse, and Tasks. Menu lists the browse sources this workspace has, which
the desktop draws under its task list. Browse shows what's under the chosen source: the source's own
`list` region, drawn here instead of inside its view. Tasks lists the workspace's tasks.

The top bar follows the active Node's `core.workspaces` preference. With workspaces on, it shows the
workspace name and the routed project name. With workspaces off, it shows **Project** and the paired
project name once. The `w` picker and the palette's workspace commands say **Project** while off.
The `p` shortcut opens the same picker in that mode. Settings uses the same projected category label
as the desktop. Command IDs, shortcut IDs, and preference keys keep their workspace spelling.

Setup reads the preference and the project list from the active Node. If the preference is unset and
the Node has no projects, it asks whether to keep each project separate or group them into
workspaces. Separate projects is selected by default. Setup waits for the Node to save the answer
before it opens project creation. A failed save stays on the question and shows the error for retry.
With workspaces off, setup omits workspace selection and creates a project without a workspace ID.
With workspaces on, setup keeps the workspace step and passes its chosen ID.

A successful empty project list opens setup at its first step, including after the last project is
deleted. A pending or failed project or preference read does not count as empty, even if its query
retains cached data. Setup keeps that data visible while the read settles. Setup belongs to the active
Node; responses from a Node that was switched away from do not change setup or navigation.
The top bar keeps its last confirmed wording during a refetch.
Switching Nodes remounts the shell under that Node's query cache and restores its saved workspace
choice. The terminal clears the previous Node's open task and transient dialogs during the switch.

A generic task route stays on its task after creation. The project fallback applies to project
routes; a task route has no project segment to validate against the workspace roster.

With no explicit task or source, the screen opens on the first available Menu source once its
provider and workspace-link gates have loaded, with focus on that row. Switching workspace clears the
old task and source. A workspace this session hasn't visited repeats that default, and one it has
opens on what you left. An explicit `--task` path opens in Tasks. `/` hides the column.

`acorn` restores the open workspace and, from that, what was open in it. It uses two Node
preferences: `core.workspace-views`, which the desktop writes too, and `last_workspace`, which only
this host reads ([state ownership](../state-ownership.md) § Scope rules). The restore replays a
workspace switch through `apps/tui/src/chrome/restore.ts`. Nothing records a view until that pass
has run, so the default source can't overwrite the stored one.

The column takes about a third of the width, between 20 and 34 cells, the shape `list-detail` uses
for its own list column. At 80 columns the pane gets 54, under `list-detail`'s 80-cell threshold, so
panes show one group at a time.

Frames go one level deep. Each panel is a box with its name in the top border, drawn in the accent
tone while the keys are inside it (`apps/tui/src/panel.tsx`). Each layout frames every region it
holds, and nothing frames something that already has a frame, because a frame costs two rows and two
columns. The name in the border is what the desktop puts in a region's `aria-label`, and the lit
border is what `:focus-within` does there. The border reads the store's focus signal, because a
frame that lit itself would have to be focusable and would become a stop.

A panel is a place on the screen. A growing panel takes the room left over, so 40 pull requests in
Browse can't push Tasks off the screen, and what's inside clips or scrolls. A `Rows` marked `virtual`
gets its height from the panel, draws only the rows that fit, and draws its own scrollbar. A
non-virtual body uses a `ScrollViewport`. The virtual window holds still until the caret walks off an
edge, then follows by exactly as much as it has to. The wheel can show another part of the list
without moving the caret.

A row clips instead of squeezing. Its parts give up cells in order: trailing controls first, then the
meta, then the title down to 16 cells, never the caret or leading glyphs. Past that, the row runs off
the right edge and the frame cuts it. In a 28-cell rail, a pull request reads as its number and title.

### What is drawn bespoke

The rail's task list uses the same `rail.taskList` exclusive slot as the desktop, so a plugin that
replaces it replaces it on both hosts. `ExclusiveSlotHost` is host-supplied, because the DOM copy
imports `Dynamic` from `solid-js/web`, which would add a second Solid renderer. The arbitration rule
in `exclusiveSlots.ts` is shared. The top bar and pane strip are terminal-owned, and the desktop's
`rail`, `topbar`, and `pane.switcher` replacements apply only to providers that support this form
factor.

#### Task markers

The task list reads the allocator's complete ordered marker legend instead of its four-corner desktop
placement. A row shows a count: `N marks` where seven cells fit, and `+N` in a narrow rail. Focus the
row and press `Shift+F10` or the menu key to open the **Task markers** dialog, a virtual list of every
marker label. The plugin supplies no action or terminal UI. Loaded task marks arrive through the same
`core:task` annotation point as on the desktop
([task annotations](../plugins/rows-and-annotations.md#task-annotations)).

A Menu source row shows its count the same way, and its menu key opens **Source markers**. The pane
strip puts `+N` after a pane's label and lists the shown pane's labels on a line under the strip
([source and pane annotations](../plugins/rows-and-annotations.md#source-and-pane-annotations)).

#### The palette and overlays

The palette is a `Modal` over the same session the desktop's uses
([the palette session](../command-palette-and-shortcuts/palette.md)). This host binds keys to it,
draws its rows, and prints its breadcrumb, and fetches and runs nothing. `apps/tui/src/chrome/Shell.tsx`
builds the session, not `Palette.tsx`, because the component mounts only while the overlay is up and a
shortcut aimed at a group has to be able to open it. It doesn't use the kit's collection, because a
collection's keys are bare keys and something is always being typed in a palette. So its arrows sit
above the trap, and Escape steps back one frame, closing at the root.

An overlay takes the whole screen under the top bar. It's a sibling of the rail-and-pane row in
`Shell.tsx`, not a child of the pane column. The row is `visible={false}` while an overlay is up, so
the rail and pane keep their queries and models. `pushScope` in the region store does what the DOM
palette's `prevFocus` does.

Toasts are the same `toast()` store the desktop's `ToastHost` draws, so `bridge.ui.toast` lands on a
line above the footer. Toasts never take focus.

#### The count and the inbox

The top bar's right edge shows `◔ N` in the warn tone when something is waiting, and nothing
otherwise. It's the number on the desktop's bell and app icon: unread notices plus attention rows.
`trackBadge` calls the platform seam's `setBadge`, and this host's `notify` group writes the signal the
top bar reads (`apps/tui/src/kit/notify.ts`). [Notifications](../notifications.md) owns what goes into
it.

`n` opens `apps/tui/src/chrome/Inbox.tsx`, the bell's two sections, "Needs you" and "Notifications",
as an overlay. It reuses the bell's data, not its component, drawn as one collection so `j` and `k`
walk all of it. Two collections in a dialog would leave the second unreachable, because a dialog is a
scope with no regions. Enter switches Node if the row belongs to another, opens the task, and runs the
row's target through the desktop's handler table.

An unseen notice reaches `initSystemNotices`, and this host's seam writes a terminal notification
sequence ([notification channels](../notifications/channels.md#terminal)). `ACORN_TUI_NOTIFY` is the
switch: `off`, `bell`, `terminal`, or `both`, the default. DEC mode 1004 reports focus: the parser
turns `ESC [ I` and `ESC [ O` into `focus` and `blur`, and `apps/tui/src/main.tsx` passes them to
`setHostFocused`. An unknown answer counts as focused, so a terminal that never reports stays quiet.
