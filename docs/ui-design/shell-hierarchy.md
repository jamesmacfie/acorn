# Shell hierarchy

This page covers how the desktop shell is arranged, the shared rules for chrome bars, text, and
headings, and the rail controls with their status markers. Read it before you add chrome or a rail
control. It's part of [UI design](../ui-design.md).

## Shell hierarchy

The desktop shell has this hierarchy:

```text
Topbar: Node/workspace context, repo/PR controls, global actions
TabRail: sources → workspaces → tasks
Main: Home, Fleet overview, source browse, or active task
Task: ordered pane row
Bottom drawer: terminals and raw provider sessions
Overlays: palette, settings, onboarding, notices, confirmations
```

The shell owns navigation chrome and dialogs. Plugins supply content through registries and slots.
The shell positions a child webview over a pane host, and page content never owns the chrome around
it.

The terminal client draws the same hierarchy in fewer cells (`apps/tui/src/chrome/`):

```text
Topbar:   one line. Workspace, project, task count, branch, and node state
Left:     Menu sources, Browse list, and workspace Tasks in one column
Main:     one pane or source detail, with a strip of pane labels above it
Overlays: palette, cheat sheet, pickers, inbox, trust, and quit confirmation
Footer:   one line. What the keyboard will do, and the node's state when it needs a sentence
```

Three things differ. The terminal draws one pane, not a row, because two panes at 80 columns are two
40-column panes and the kit's floor is 80, so `nextPane` switches which pane is drawn. The region
cycle covers the whole screen for the same reason. And an overlay hides the pane instead of replacing
it, so opening the palette keeps the pane's queries and model ([terminal chrome](../tui/chrome.md)).

The desktop top bar, left rail, pane switcher, and rail task list each have a core provider in an
exclusive slot. A selected plugin provider can draw one of them with the host's data and verbs. The
rail provider places the host's task-list slot, and the top bar provider places the host's right-side
status slot. Settings warns when a provider says it leaves out either. The terminal hosts only
`rail.taskList`.

### Geometry

The top bar spans the window, and the rails and panes start under its bottom border, so that border
is one line across the app. The left TabRail is the first thing in `.shell-body`, and the right pane
switcher is fixed at `top: var(--topbar-h)`.

Both rails are built from one component, `tabs/RailTab.tsx`, a square control styled by
`.tabrail-tab`. Its side is `--pane-head-h`, the height of the pane header beside it, so a rail
button, a pane header, and the top bar share one row height, and a style pack that moves the header
moves the rails too. Every rail control uses it, including the bottom-pinned **+** on the left and
**Close task** on the right, which share `.tabrail-bottom`. It isn't a `Button`, because a rail
control changes only its icon and background on hover, and `.ui-btn:hover` also changes the border
color. `.pane-switcher` restates only what differs on the right: the glyph font, and the active accent
on the right edge.

### Chrome bars

`--pane-head-h` is the height of every bar that's a pane's chrome: a plain `Toolbar`, a pane-level
`SectionHeader`, and `.diff-toolbar`. Chrome means the bar at the top of a pane, or the header of a
list or detail column. `Toolbar size="sm"` is for a strip inside the content, such as a filter row,
a find bar, or a status line. Tab strips are the exception at `--tab-h`, so a strip under a pane
header reads as subordinate. When a `Tabs` or `DocumentTabs` strip is itself the header,
`level="pane"` gives it `--pane-head-h`. Both heights include the bottom divider. The editor's file
navigation and document strip, the host's `tabs` layout, and the terminal drawer use the pane level.

Every chrome bar paints `--bg-subtle`: the rails, the pane switcher, the task footer, `Toolbar`,
`Tabs`, `DocumentTabs`, a pane-level `SectionHeader`, and `.diff-toolbar`. So headers across a split
read as one row. The top bar keeps the page's `--bg`, because it spans every pane and reads as the
frame. A group label keeps the list's own color. Only a pane header and a group label stick to the top
of their scroller. A `sub` heading and a `Fold` summary scroll with their content, unless `sticky` asks
otherwise.

Text in a list column starts on one edge, the pane padding: the header's label, a group label, a
filter strip, a banner, and the first tab label. A `Row` adds its 3px selection marker on top. Where a
split has a collapse control on its divider, the first bar on each side pads by half the control more.

A button in chrome takes the small height, `--control-h-sm`, whatever size its caller passed. That
covers the actions of a `SectionHeader`, a `SettingsSection`, and an `Alert`, actions beside a `Tabs`
or `DocumentTabs` strip, and every button in a `Toolbar`. A bar that holds a field is a form row, so
its buttons match the field's height. A `bare` text button in a row of actions, such as **Reset
section** or **Cancel**, takes the small height too, so its target isn't just its text. Buttons in a
row are `--gap-row` apart.

### Text and headings

A `Fold` or `SectionHeader` whose label is content, such as a path, a name, or a sentence, uses
`level="sub"`. The default `group` level uses the uppercase label style, which suits a word that names
a group, such as "Tracked".

`Text` draws at the working size, `--fs-sm`, whatever its emphasis. Two containers size their own
content, the agent transcript and a description list's value, and `Text` inside them takes their size.
In a `Table`, a column's label uses the uppercase label style, and a row's own label,
`TableCell header`, reads as ordinary text at medium weight.

`Heading level` is the role, not a size. A page title is 1. The title of a pane, or of a selected item
in a detail column, is 2, including one inside a `Toolbar`. A heading inside content is 3. So a Linear
issue and a Docker container have titles of the same size.

A top-level page, such as Home, Memory, or Agent Center, opens with `Heading level={1}`. Page actions
go in an `Inline spread` beside it. The page's description goes behind a help mark on the title, or
stays as one muted line under it when you need it to act. Settings draws its title as host chrome at
the same size and weight.

## Rail controls

`RailTab` is presentation only. It takes a `label`, which becomes the tooltip title and the accessible
name, a `glyph` resolved through `kit/components/content/Icon.tsx`, and explicit `active`, `tone`,
`accent`, `busy`, `sublabel`, and `markers` props. It never reads task state or asks a registry
anything. `children` stays for a compound center, but prefer `glyph` plus `sublabel`.

`active` sets the visual class only. The caller still sets `aria-current`, `aria-pressed`, or
`aria-expanded`, because source navigation, a multi-open pane, a running process, and an open drawer
say different things. `busy` swaps the glyph for the shared spinner, sets `aria-busy`, switches the
tooltip to `busyLabel`, and refuses activation without native `disabled`, which would swallow the
pointer event the tooltip needs.

### Status markers

A marker is a small status icon around the outside edge of a control: CI checks, an unread agent, a
dirty worktree, a plugin's own state. A marker is data. It carries an ID, a label in words, an icon
name or a `StatusDot` tone, an optional tone, an optional `busy` flag that spins an icon or pulses a
dot, and an ordered list of positions it would like:

```text
top-start   top-end
     bottom-center
bottom-start   bottom-end
```

`tabs/railMarkers.ts` places them, and the host owns placement. It orders markers by priority, then
ID, gives each the first free position on its list, draws at most one per position, and lists the
rest in the tooltip legend and the control's accessible description. Compact chrome may hide an icon,
never a state. `bottom-center` is reserved for host lifecycle: a pulsing dot while a setup script
prepares a new worktree, and a spinner while teardown removes it.

Core's markers come from `tasks/railStatus.ts`. Compiled plugins publish theirs through
`packages/client-core/src/features/tabs/railMarkers.ts` ([plugins](../plugins.md) § Rail markers).
Loaded plugins publish task facts through the `core:task` annotation point, and the host turns each
accepted fact into a marker. The plugin supplies severity, bounded text, and an optional icon, never
placement, color, or action ([task annotations](../plugins/cooperative-extension-points.md#task-annotations)).

Contributed priorities are clamped below core's, so a plugin can't push a core lifecycle state out of
its corner. Placement requests are preferences. A CSS selector in a feature or plugin stylesheet that
positions a rail marker means placement has escaped the host.
