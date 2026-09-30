# Terminal chrome and plugins

Part of [tui.md](../tui.md).

## Chrome

`apps/tui/src/chrome/` draws the shell around the panes, which on the desktop is bespoke DOM rather
than kit. [ui-design.md](../ui-design.md) § Shell hierarchy has the two hierarchies side by side.

### The screen

Left to right and top to bottom: one topbar line, a column of three framed panels, the active pane in
the rest with a strip of pane labels above it, one footer line.

The three panels are Menu, Browse and Tasks, read down the screen. Menu is the browse sources this
workspace has, which the desktop draws under a rule below its task list. Browse is what is under the
chosen one — the source's own `list` region, drawn here rather than inside the surface it belongs to.
Tasks is the tasks in the workspace. With no explicit task or source, the screen opens on the first
available Menu source after its provider and workspace-link gates have loaded, with focus on the same
row. Switching workspace clears the old task/source and, for a workspace this session has not been in
before, repeats that defaulting pass; a workspace you have already been in opens on what you left it
on. Closing the picker restores focus by region when the old row was replaced. An explicit `--task`
path still opens in Tasks. `ctrl+b` hides the whole column.

**Reopening where you left off.** `acorn` restores the workspace that was open and, from that,
whatever was open in it. Two preferences and both the node's: `core.workspace-views`, which the
desktop writes too, and `last_workspace`, which only this host reads
([state-ownership.md](../state-ownership.md) § Scope rules). The desktop's own three — a last path, a
last task and a last source — are device preferences in `localStorage`, and a terminal has neither a
router to hold a path nor `localStorage` to hold the preference, so none of them is used here.

The restore replays a workspace switch rather than setting the choice, so the one function that knows
how to apply a remembered view is the one that applies it (`apps/tui/src/chrome/restore.ts`). Nothing
records a view until that pass has run, or the default source the shell picks for the first workspace
on screen would land before the stored one had been read and overwrite it with a choice nobody made.

The column takes about a third of the shell's width, between a floor of 20 cells and a ceiling of 34,
which is the shape `list-detail` uses to size its own list column. A fixed number could not be right at
both ends: thirty reads well at 120 and leaves the agents session list clipping its own titles at 80.
So at 80 columns the pane is 54 and every pane in the roster inherits that — well under `list-detail`'s
own 80-cell threshold, which means one group at a time with `expand` switching between them.

**Frames, one level deep.** Each panel is a box with its name in the top border, drawn in the accent
tone while the keys are inside it, in `apps/tui/src/panel.tsx`. Each layout puts one round every region
it holds, and nothing wraps a frame round something that already has one: a frame costs two rows and
two columns, and at 24 rows the body has 22 to spend. `header-body-footer`'s pinned strips stay bare
for the same arithmetic — a frame round one line of content is three rows of chrome.

**A panel is a place on the screen, not a wrapper round a list.** A growing panel takes the room left
over rather than the room its contents want, so a Browse list of forty pull requests cannot push the
Tasks panel off the bottom of the screen. What is inside it either clips or scrolls. A `Rows` marked
`virtual` is handed its height by the panel, draws only the rows that fit, and puts its own scrollbar
down the right edge. A non-virtual document/detail body uses a `ScrollViewport` and its bar.
The virtual window holds still until the caret walks off an edge, then follows by exactly as much as
it has to; wheel input can inspect another part of the list without moving the caret.

**A row clips, it does not squeeze.** A `text` is a box to yoga, so a row of them at a width they do
not fit is a row of boxes each shrunk and each cutting its own content: `[ST]` drew as `[ST`, the gaps
between the fields closed up, and the one-cell caret column shrank to nothing, so a focused list
looked exactly like an unfocused one. The parts of a row now give up cells in an order — the trailing
controls first, then the meta, then the title down to sixteen cells, and never the caret or the
leading glyphs. Past that the row runs off the right edge and the frame cuts it. In a 28-cell rail
that means a pull request reads as its number and its title, and its timestamp is simply not there.

The name in the border is the string the DOM host puts in a region's `aria-label`, and the lit border
is what `:focus-within` does to a region's edge there. Same two facts, one rendering each. The lit
border is read off the store's focus signal, and it has to be: a border a node lit for itself would
need that node to be `focusable`, and a focusable frame is a stop in the cycle, so a region holding
another frame would open on the frame instead of on the list inside it.

There is no collapse to a strip of marks below 100 columns any more. It only ever said anything because
every row carried a glyph, and most of those glyphs drew nothing: a source's glyph is a Lucide name,
this host has no brand marks at all, and `Icon` draws a name it has no character for as nothing. The
rail's leading icons went with it. `ctrl+b` is the one way to lose the column.

### A descriptor source's list

A plugin contributes a rail source in one of two ways, and only one of them shipped with a terminal
answer. A compiled plugin hands over a component, which is kit and draws here. A plugin that
contributes by manifest hands over a *descriptor*, and the host draws the list — through
`ChromeSourcePanel`, which is `<main class="panes">` around `<section>`s and the DOM kit's primitives.
The chrome registry named it directly, so selecting Linear or any other descriptor source in `acorn`
handed the reconciler a `main` and it refused.

`client-core/host/chrome/sourcePanel.ts` is the seam, and it is the third of exactly this shape after
`KIT_COMPONENTS` and the layout table: the host package supplies its own and the DOM's is the
fallback, so nothing on the desktop moved. It hands back a whole contribution rather than a component,
because the two hosts do not put the halves in the same place — the desktop draws one surface across
the window, and this host puts the list in the Browse panel and the detail in the main one.

`apps/tui/src/plugins/SourcePanel.tsx` is this host's. Everything that is not drawing is imported
rather than rewritten: `readRailItems` and `chromeKey` are the query, so both hosts share one cache
entry; `runChromeAction` is what a row press does; and `projectSurfaceRegistry` is what the detail is,
which is the same surface the desktop draws beside its own list. Two things are left out and they are
omissions rather than gaps in the seam: the create-task menu on a row, and the dashboard panels beside
the list. Each is a surface of its own on this host and neither is what a rail list is for.

The title filter is here. `/` — the `search` intent, so `Ctrl+F` reaches it too — puts the keys in a
field above the rows, what is typed narrows the list by title, `↓` goes back to the rows and `Escape`
leaves the panel. The field is drawn only once there is a list to filter, and that is a focus rule
rather than a tidy one: entering a region lands on its first collection row, else on its first stop, so
a field above an empty list takes the keys the moment the panel opens and `j` types a `j`. The two
walks out of the field differ on purpose — `↓` walls at the last stop so a filter matching nothing
leaves the caret where it is, and Escape does not, so the same reader can still climb out. The filter
is per source and goes when the source does, because a source change unmounts the panel.

The source-panel factory is keyed by `(pluginId, descriptorId)`. Chrome contribution resyncs update a
signal holding the current descriptor and return the same `regions.list` and `regions.detail`
functions. `Dynamic` therefore updates labels and descriptor props in place instead of treating a
roster/trust refresh as a new component and remounting the list, which would discard its caret,
virtual window and query subscriptions.

### A loaded document region

Loaded pane registration is shared by desktop and terminal. For a manifest `document` region it uses
`client-core/host/frames/documentSurface.ts` to select the host's editor, just as a `remote` region
selects the host's tree renderer. The desktop uses CodeMirror. The terminal supplies
`apps/tui/src/plugins/DocumentSurface.tsx`, an editable text field for a writable route and a text
view for a read-only route. It resolves and bounds the declared document route, reads and saves through
the Node API, and hands the sibling plugin tree a live `read`/`write`/`flush` handle. A pane-scoped
shortcut pressed in the field flushes before it dispatches the command. Syntax highlighting and
completion popups are desktop editor features; the terminal field is plain text.

### What is drawn bespoke

The rail's task list goes through the same `rail.taskList` exclusive slot the desktop's does, so a
plugin that offers to replace it replaces it on both hosts. `ExclusiveSlotHost` is host-supplied like
the component table, because the DOM's copy reaches for `Dynamic` from `solid-js/web` and pulling that
in would put a second Solid renderer in the graph to render one child. The arbitration rule in
`exclusiveSlots.ts` is shared unchanged. The topbar and pane strip remain terminal-owned drawings;
the desktop's `rail`, `topbar`, and `pane.switcher` replacement contracts apply only to providers
that declare support for the host's form factor.

#### Task markers

The task list consumes the allocator's complete ordered marker legend rather than its four-corner
desktop placement. A terminal row shows its count instead of replacing Lucide icon names with
ambiguous symbols. It says `N marks` where seven cells fit and `+N` in a narrow rail. The full
ordered legend remains available from the row.

Focus the task row and press `Shift+F10` or the menu key to open the host-owned **Task markers**
modal. Its virtual list contains every marker label, including labels represented by `+N`. The plugin
supplies no action or terminal UI. This projection does not change the desktop allocator or its
corner assignments. Loaded task marks arrive through the same `core:task` annotation point as the
desktop; see [Task annotations](../plugins/cooperative-extension-points.md#task-annotations).

The palette is a `Modal` over the same session the desktop's runs on
(`client-core/host/registries/commands/sessionStore.ts`). The query, the order, the cursor, the frame stack
and what Enter does are that object's; this host binds keys to it, draws its rows and prints its
breadcrumb, and fetches and invokes nothing itself. The session is built in `chrome/Shell.tsx` rather
than in `chrome/Palette.tsx`, because the component is mounted only while the overlay is up and a
shortcut aimed at a group has to be able to open it.

It does not use the kit's collection: a collection's keys are bare keys, a bare key does not fire while
something is being typed into, and in a palette something always is. So the arrows are bound above the
trap and the session owns the cursor they move. Escape is the single way back — it pops a frame, and
at the root it closes, which is the `Modal`'s `onDismiss`.

An overlay takes the whole screen under the topbar, and hides what is there rather than replacing it.
It is a sibling of the rail-and-pane row in `chrome/Shell.tsx`, not a child of the pane column: an
overlay belongs to the screen, and mounted inside the column it drew in the pane's width with the rail
still beside it, which read as one more panel rather than the thing being asked. Opening the palette
must not tear down the rail and the pane behind it and throw away their queries and their models, so
the row is `visible={false}` while an overlay is on top, the same thing `TabPanel` does for a hidden
tab. `visible` is yoga's `display: none`, so the row gives up its height and the overlay takes it.
`pushScope` in the region store is this host's answer to the DOM palette's `prevFocus`.

Notifications are the same `toast()` store the desktop's `ToastHost` draws, so `bridge.ui.toast` and
every plugin that calls it lands on a line above the footer. They never take focus.

**The count and the inbox.** The topbar's right edge carries `◔ N` in the warn tone when something
is waiting, and nothing when nothing is. It is the number the desktop's bell puts on its pill and on
the app icon — unread notices plus the rows in the attention inbox — and it gets here the same way it
gets onto the dock: `trackBadge` calls the platform seam's `setBadge`, and this host's `notify` group
writes the signal the topbar reads (`apps/tui/src/kit/notify.ts`). One number with one meaning on
both hosts, and [notifications.md](../notifications.md) owns what goes into it.

`n` opens what is behind it. `apps/tui/src/chrome/Inbox.tsx` is the bell's two sections — "Needs you"
and "Notifications" — as an overlay, because there is no popover here and the column has no room for a
fourth panel. It reuses the bell's data and not its component: the same `createAttentionInbox`
fan-out and the same notice ring, drawn as one collection rather than two so that `j` and `k` walk the
whole thing. Two collections inside a modal would leave the second unreachable, because a dialog is
a scope with no regions in it and `nextRegion` has nowhere to go. Enter switches node if the row belongs to another one, opens the task, and
dispatches the row's target through the same handler table the desktop uses.

**Asking the terminal to notify.** An unseen notice reaches `initSystemNotices`, which is the same
channel the desktop raises an OS banner from; here the seam writes an escape sequence and the
emulator decides. OSC 9 for iTerm2, Ghostty, WezTerm and Warp, OSC 99 for kitty, OSC 777 for rxvt,
wrapped in a tmux DCS passthrough with every ESC doubled when `TMUX` is set, and title and body
stripped of anything that could end the sequence early. A terminal on none of those lists gets the
BEL and nothing else. `ACORN_TUI_NOTIFY` is the switch, in the `ACORN_TUI_OSC52` pattern: `off`,
`bell`, `terminal`, or `both`, which is the default. Settings › General › Notifications shows the
value and where it came from, and changing it means changing the variable ([tui.md](../tui.md) § Settings).

Whether the terminal is the window the reader is looking at comes from DEC 1004: the parser turns
`ESC [ I` and `ESC [ O` into a `focus` and a `blur` event, `apps/tui/src/main.tsx` feeds them to
`setHostFocused`, and the gate's seen rule reads them. Unknown counts as focused, so a terminal that
never reports stays quiet.

### Navigation

`Tab` and `Shift+Tab` cycle regions, beside `F6`, which is what the DOM host spells the same intent
because the browser owns Tab. The cycle reads down the screen: Menu, Browse when it has a list,
Tasks, the pane strip when a task is open, then the pane/source regions. `right`/`l` crosses from the
rail to main and `left`/`h` comes back; neither wraps. `Ctrl+Option+Right` and
`Ctrl+Option+Left` take the same spatial edge before they cycle a task pane, so the advertised pane
chord works from Menu, Browse, and Tasks. In a rail list, Up/Down and `j`/`k` move; `Enter` performs the
row's ordinary activation and then enters main. An overlay or entered PTY keeps first refusal on
Escape. A tabbed detail adds one deliberate level: `left`/`right` (or `h`/`l`) choose a tab, `down`/`j`
enters its controls, `Tab` steps between them from inside a text field (§ The five key groups), and
Escape, Up from the first control, or `left`/`right` from any of them return
to the tab strip — the last pair changing the tab on the way. Moving a focused control beyond the viewport
reveals it automatically; mouse wheel/trackpad input scrolls the viewport independently.

Escape climbs one level each press, and where it goes at the top of a region is the shell's to say
rather than the keys module's. `apps/tui/src/chrome/topology.ts` is the whole of it, and it is the one
file in the chrome that names a region by string anywhere but where it declares one. A source detail
goes to the Browse list it came from, or to the Menu row that chose the source when the source draws no
list of its own. A task pane's own regions go to the strip above them, and the strip goes to the Tasks
list the task was opened from. From the rail there is nowhere further left, so Escape falls through to
the shell's own layer and clears a notification instead. The same file says which region takes the keys
when the screen first has any — Tasks when the session opened with a task and no source, Menu otherwise
— and which regions a first crossing into a column passes over, which is the pane strip and nothing
else.

**No digit jumps to a region.** lazydocker binds `1` to `6` to its six panels and it works there
because those six are always drawn, always in that order. Ours are not a fixed set: Browse registers
nothing without a list, the rail goes on `ctrl+b`, the strip draws only while a task is open, and a
pane's own regions are its layout's. So `3` would name a different region on nearly every screen,
which is the opposite of what a direct jump is for. The footer settles the rest: it already runs out
of line before `esc back` on every screen we draw, so nine more rows are nine keys it cannot say, and
a key the footer cannot say is what § The footer exists to prevent. Tab and the column moves are the
region keys, and `ctrl+1` to `ctrl+9` are the `tabs` layout's, which is a fixed set drawn in one strip.

`w` switches workspace and `p` switches project, both through an overlay, because that is the shape
that takes the keys off whatever had them. Neither restores what you were looking at. Both schedule a
settle, so the caret lands on the first row of the roster that replaced the old one rather than on
whatever survived the switch. The command chord opens the palette from anywhere except an entered PTY.

With a task open, `t` opens its terminal sessions. The palette offers the same route when the active
Node has the Terminal plugin. The task rail may shorten a title to preserve its marker count; a line
across the screen repeats the selected task's complete title, wrapping when needed. A source row with
a promotion contract offers `Shift+F10` to create a task or attach to an active one. The source owns
the seed and link operation; the terminal supplies the task choices and reports write errors.

A pane opens with the keys already somewhere, because there is no click to put them there. And a
region opens on its list where it has one rather than on the first field above it, because the first
thing focused is the thing the bare keys drive and landing in a filter box means `j` types a `j`.
Menu and Browse also select the row they open on; other regions only focus it. Which source a
workspace opens on is one derivation in `apps/tui/src/chrome/model.ts`: the first source the Menu
actually draws, once both gates behind that list have answered. The Rail reads it and draws. It used
to be an effect in the Rail, and the shell and the Rail agreed about the answer only because one of
them waited for the other.

## Loaded plugins

A terminal has no iframe, so the sandbox a tree-emitting plugin runs in is different here and nothing
else is. [security.md](../security.md) § Rung 0 owns the containment claim and the flags; this section
owns the shape.

### The sandbox

A `node:worker_threads` worker started with `execArgv: ['--permission', '--allow-fs-read=<bootstrap>',
'--allow-fs-read=<bundle>']`, receiving the tree port for `tree:mount`, `tree:batch`, and the rest,
plus a scoped bridge port for each mounted tree's SDK verbs. Host selection and surface actions target
one mount; appearance updates reach every live mount. `workerHost.ts`'s `_setWorkerFactory` is the seam, and
`apps/tui/src/plugins/workerFactory.ts` is what it substitutes. Everything else in that file — slot
bookkeeping, the 30-second grace, the heartbeat, the fail-fanout — is shared.

**A worker thread's grants are its own.** `--permission` looks process-wide, which would have forced a
child process per plugin with the two ports over an IPC channel. Measured on Node 24 and 26, `execArgv`
applies the permission model to the thread: the worker is denied a read the parent is allowed. So there
is no child process, and the TUI process itself runs with no permission flags at all.

**Node's permission model does not cover the network**, which is the one thing the DOM worker's CSP
gave away free. `apps/tui/src/plugins/pluginWorker.js` runs before a stranger's module scope, installs
a `module.registerHooks` resolver refusing fourteen builtins, and deletes five globals. `module` is on
that list so a bundle cannot register a hook of its own and undo this one, and `worker_threads` so it
cannot start a thread that inherited none of it.

The batch rules are shared rather than copied. `client-core/host/tree/treeState.ts` holds the store,
the pre-flight check, `apply()`, the prop sanitiser and the coalescer with no JSX in them, and each
host writes a shell over it. Two copies of those rules would have been two copies of a security
decision. The coalescer's tick is the renderer's here and `requestAnimationFrame` there.

### Reserved regions

A pane that reserved a `pane.footer` or a `pane.aside` is wrapped by the frame registry, and until the
wrapper became a seam that wrapper was the DOM's: a `div` around an `aside` holding a `PanelGrid` sized
in pixels. Registering such a pane here handed the reconciler a `div` and it refused, so the pane threw
rather than drawing — the same failure the descriptor rail list had, and the same fix.
`client-core/host/chrome/extendedPane.ts` is the seam, `apps/tui/src/plugins/ExtendedPane.tsx` is this
host's answer, and `App.tsx` installs it beside `setLayouts`, `setRemoteTree` and `setSourcePanel`. It
draws the reserved regions under the owner's own tree in reading order: a terminal pane is one
rectangle, and there is no second column for an aside and no row to spare for a strip that is empty
most of the time.

### Custody

There is no helper process to hash bytes, so the TUI implements `PluginCustody` over files
(`apps/tui/src/plugins/custody.ts`): a content-addressed cache directory under the config root, one
file per bundle named by hash, and an acknowledgement file beside it keyed by `(pluginId, hash)`.
Bytes are hashed on arrival and a mismatch is refused and never re-keyed, which is the desktop's rule.
The schemas are `@acorn/protocol`'s; no custody type is defined in this package. Device provenance is
natural here and `{ path }` is an allowed source form, though nothing offers it yet: a person at a
terminal installing a plugin is installing it here.

The shared distribution snapshot selects only the active runtime of the current Node after custody
accepts its exact bytes. Installed updates remain separate offers. A stale or unreachable Node retains
its last roster for explanation while withholding its loaded UI. TUI custody can forget one recorded
decision for reconsideration, and ending development mode withdraws its auto-accepted hashes through
the same shared reconciliation as desktop.

No module outside `packages/client-core/src/host/plugins/host.ts` calls `pluginCustody()`, and this
host does not add a second caller.

### The trust prompt

`apps/tui/src/plugins/TrustPrompt.tsx` draws the prompt as a kit tree in a `Modal`: the same three
tiers, the same permission-key diff, the same accept, refuse and show-me actions, all of it read off
`trustModel.ts` lines, which are data. A plugin cannot draw over it, because a plugin draws inside a
slot and the modal owns the key layer. Nothing in the prompt is terminal-specific.

### The third column

[security.md](../security.md) carries the terminal in five places: § Trust boundaries as a fifth entry
where the first two collapse into one process, § Transport and auth for the upgrade header, § Third-party
plugin bundles for the two file-backed stores, § The containment ladder rung 0 for the worker thread
and rung 2 for what it settled, and the summary table for the token and consent files.

The terminal sits between desktop and web on that ladder. It holds the token in the same process as
the UI, which the desktop does not, and it holds it in a file with real modes, which the web cannot.

## What a plugin loses here

A plugin writes no terminal UI, declares no `tui` surface, and learns nothing about the host. What
crosses is decided here, and the table below is the whole of it: one row per cooperative extension
kind and per host UI slot, what the desktop does with it, what this host does, and where the answer
lives.

| Kind or slot | Desktop | Terminal | Where the answer lives |
| --- | --- | --- | --- |
| `rows` (`pane.footer`) | A strip of rows under the pane's frame | A `Rows` collection at the end of the pane, one per contributor, headed by its label and the contributing plugin's id | `apps/tui/src/kit/host.tsx` § `ExtensionRows`, drawn by `apps/tui/src/plugins/ExtendedPane.tsx` |
| `annotation` | Marks inside the diff row, under the code; `core:task` marks become rail markers | Diff marks appear below the code; task rows show a count and offer `Shift+F10` inspection of the full legend | `apps/tui/src/kit/showing/diffRows.tsx` § `AnnotatedDiffLine`; § Task markers above |
| `remote` (a `Slot`) | The contributor's tree, in the owner's surface | The same tree, in the same place, drawn from the same batch | `apps/tui/src/kit/host.tsx` § `Slot` |
| `rectangle` (`pane.inline-*`) | Another plugin's iframe | One muted line naming the point | § Rectangles |
| `hook` | Runs on the node | Runs on the node | Nothing to draw on either host |
| `pane.aside` | A dashboard grid the user composed, beside the pane | One muted line naming the point | [future/dashboards/README.md](../future/dashboards/README.md) |
| `rail.taskList` (exclusive slot) | The replacement draws in place of core's list | The same, through the same arbitration | `apps/tui/src/chrome/slot.tsx` |
| `overlay`, `drawer`, `task.footer`, `task.switcher.extra`, `topbar.*` | Host UI slots a plugin fills | Not drawn | [Plugin extension points](../plugins.md) |

The last row costs five first-party registrations, and two of them draw nothing: github's and agents'
`overlay` entries are where a command that needs the router or a query client gets mounted, and
onboarding's first-run screen is the one `overlay` that is really a screen. The terminal plugin takes
`drawer` and docker takes `task.footer`. The terminal's overlays are a fixed set the shell draws and
its drawer is the rail, so giving a plugin those places is a contract for both hosts rather than a
component for this one.

Terminal still registers its node-scoped session source on this host. Shared code can list sessions
and dispatch its send action with the selected node and session identity, but this shell has no
Terminal session panel to select or type into. The editor's file PTY is a separate surface and does
not stand in for Terminal's drawer.

What that costs a reader here is small and named: github's changed-file and pull-request searches and
agents' two settings are desktop-only, because the registrations that mint them are not mounted. The
editor's ⌘P quick-open used to be in the same list and is not any more — it is a `search` command its
plugin registers at boot, so it works here.

**A canvas is not one of the losses.** The kit's `Graph` node draws cards on a grid with the edges as
curves on the desktop, and here it draws the indented list the workflows editor drew before the
canvas existed: the same cards in the same reading order with the same selection, indented by rank
instead of placed by coordinate, and `⇐ n` on a card that waits on more than one. Both hosts take the
ranks from the same `kit/lib/layout/graphLayout.ts`, so neither can put a card under the wrong one. Positions
and wires are not drawn, and the one affordance that would otherwise go with them — dragging an edge
into place — is a picker under the list instead. A plugin writes the same `Graph` for both.

**A contribution is as reachable as the nodes it draws.** A contributor that draws a `Button` inside a
`Slot` is a stop, reached with `↓` from the strip above it and pressed with Enter, inside the region
its host registered. A contributor that draws only `Text` is not a stop, and `↓` walks past it. The
kit decides which is which on both hosts. A plugin cannot change the
`packages/client-core/src/kit/tokens/focusRoles.ts` table.

**A plugin's own chord is pressed with Ctrl here.** A manifest chord is `meta+ctrl+alt+shift+key` and
`meta` is the platform command key, which a terminal emulator keeps for itself. The command layer
rewrites the leading `super` to `ctrl` for every chord (§ Keys and focus), so a plugin that declared
`meta+shift+p` is pressed as Ctrl+Shift+P, and one that declared `meta+ctrl+alt+shift+d` is pressed as
Ctrl+Option+Shift+D. Nothing in the manifest changes.

What a *reader* loses beyond that is one row per plugin in
[first-party-plugins.md](../first-party-plugins.md) § What each of these loses in a terminal, and it is
short. The whole workspace crosses except three rectangles, and the rectangle that defines an agent
workspace, the PTY, is the one a terminal does best.

A `Card` that takes an `onPress` is one stop and the walk does not go inside it, so a pressable card
with its own controls in it reaches the card and nothing else. No first-party pane draws one; a card
that holds controls holds them instead of a press.

The four plugins that register a settings page draw it in the Settings route, except the terminal
plugin's drawer page, which the route lists and points at the desktop ([tui.md](../tui.md) § Settings).
One thing nothing draws rather than draws worse: the rail's drawer sources are the rail's browse
sources, not the terminal plugin's profiles.
