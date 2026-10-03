# Pane layouts

This page covers the two layers of pane layout: the row of panes a task shows, and the named layout
inside each pane. Read it before you add a pane, change the switcher, or add a layout. It's part of
[panes](../panes.md).

## Layout model

The two layers answer different questions. The task layout row says which panes a task shows and in
what order. The named layout says how the host arranges one pane's regions.

### The task layout row

The task layout row is the persisted list of pane IDs, optional relative widths, and pinned IDs. The
layout reducer owns show, add, close, unpin, pin, move, resize, equalize, maximize, and replacing the
row with a recipe. Pinned panes survive a selection in the switcher, and a normal selection focuses
the target. Closing the last unpinned pane falls back to the PR pane when one is available.

When none of the row's panes can draw for a task, such as the PR pane on a project with no GitHub
remote, the host draws the first pane the task offers. The switcher marks that pane. Show, add,
close, and pin act on the layout as drawn, so the first such action saves it as the task's layout.
Rendering never saves the repair, because a render can run before the saved layouts load.

Each pane's pin and close buttons are `xs` icon buttons at its top right, centered on the header
line. The bar under them reserves their width with `padding-inline-end` (`task-view.css`), so a
pane's own controls never sit beneath them.

The pane switcher is the `pane.switcher` exclusive slot. Core registers the default provider, and a
client plugin can replace how it renders. The host passes available panes, labels, icons,
visibility, pinning, shortcuts, the task, and maximized state through
`packages/protocol/src/chrome/paneSwitcher.ts`. The provider calls host verbs for show, add, close,
pin, maximize, and equalize. It owns no layout row and no keyboard listener. A missing, disabled,
untrusted, incompatible, or failed provider falls back to core. Three render failures disable that
provider until plugin state syncs again.

The host clamps widths to pane minimums and normalizes them on load. Unknown IDs become
placeholders, so a disabled plugin or a stale layout can't crash the task view. Maximize and focus
are session UI state and don't rewrite the saved row.

### Named layouts

Inside a pane, the host owns the arrangement. A pane names one of the layouts below and supplies a
component for each region. It never draws the split, the divider, or the drag handle itself.
`packages/protocol/src/chrome/paneLayouts.ts` lists the names and each layout's regions.

Each host package owns the components that draw the layouts, the same way it owns
`KIT_COMPONENTS`. The desktop's are in `packages/client-core/src/host/layouts` and the terminal's are
in `apps/tui/src/layouts`. A host hands its table to `packages/client-core/src/host/layouts/table.ts`
before the first pane draws.

There are eight names and seven components. `document-over-frame` and `frame-beside-document` are
the same two regions with the axis flipped, so one component draws both. The position is in the name
instead of a prop, so it's never a setting a plugin turns.

Each layout carries three projections: the desktop one and the terminal one, both built, and a
narrow one for a mobile web app, written down here and not built. Writing them is the layout's half
of the kit's admission rule ([the closed kit](../ui-design/closed-kit.md#the-closed-kit)). A layout
earns a name when two or more surfaces need it and the existing layouts can't express it. Its
regions are semantic names, not positions, and all three projections are on this page before it
lands. A new named layout is the answer, never a setting.

| Layout | Regions | Desktop | Narrow | Terminal |
| --- | --- | --- | --- | --- |
| `single` | `body` | One region, with the pane's padding and focus group | Unchanged | One frame, titled with the pane's name |
| `list-detail` | `list`, `detail`, optional `list-header` and `list-footer` | Two columns with a host-drawn split and drag handle. The list width is a style token, and `collapsible` adds a control that narrows it to a rail. | One region at a time. Selecting in the list shows the detail, and a back control returns. | As narrow below 80 columns, two columns above. A key switches groups. Two frames, `List` and `Detail`, with the header and footer strips inside the list's frame. |
| `header-body-footer` | `header`, `body`, `footer`, all optional, so `header-body` is this layout with no footer | The body scrolls. The header and footer stay pinned. | Unchanged. The footer stays pinned. | The body is framed and titled with the pane's name. The pinned strips are bare, because a frame around one line costs three rows. |
| `tabs` | One `panel:<tab id>` per entry in `tabs`. The host draws the bar. | The bar, then one panel at a time | The bar scrolls sideways | The bar is one line. The panel is framed and titled with the open tab. |
| `document-over-frame` | `document`, `frame` | A host-owned editor over a plugin region, with the handle between | The frame region collapses to a sheet the document can open | Both halves, each framed. The document is a read-only host text view. |
| `frame-beside-document` | The same two, with the axis flipped by the name | Side by side | As `document-over-frame` | The same |
| `stack-split` | `top`, `bottom` | Two stacked regions with a handle | `bottom` becomes a full-height sheet | As on the desktop, each region framed |
| `wizard` | `step`. The host draws the indicator and a footer with every action: skip, back, next, and finish on the last step. | One step at a time | Unchanged | The step is framed and titled with the pane's name |

### Terminal rules

Every terminal region draws a frame, and no rule between two regions. A frame carries the region's
name in its top border and lights up while the keys are inside it, which is what a landmark's label
and `:focus-within` do on the desktop. Two frames that meet already draw a line. Frames go one level
deep: the region is framed, and the pane around it isn't
([terminal chrome](../tui/chrome.md) § The screen).

A `frame` region holds a loaded plugin's tree, which draws in cells like anything else, so the
terminal draws both halves of the two document layouts. Only an iframe's pixels can't cross into a
terminal, and a frame region isn't an iframe.

Every handle is a key in a terminal, because there's no grip to drag. Ctrl with Shift and an arrow
moves a split (`apps/tui/src/layouts/split.ts`). The terminal keeps the position in the same
host-owned session signal the desktop's drag writes. That's why `SplitHandle` and `SplitCell` are
`absent` in the support matrix: the handle isn't a node there.

### Rules for every host

Every region is a focus group. One chord moves between regions, focus inside a region is roving, and
each region remembers the item it was last on
([command palette and shortcuts](../command-palette-and-shortcuts.md)). The task layout row is the
outermost group.

A region can hold a `Slot` node, and a region can itself be a slot. A rectangle slot is a sibling
region, never a child of another region's iframe, and its position is the region name.
`pane.inline-below` is a `header-body-footer` footer, and `pane.inline-beside` is a `list-detail`
detail ([plugins](../plugins.md) § Cooperative extension points).

Nothing in a layout reads the window width. Breakpoints are style tokens, so a mobile shell can set
them, and a drag clamps against the layout's own element (`shell.css` § Layouts). The terminal keeps
the same rule against the terminal's size: a layout asks its own box how wide it turned out, and only
the renderer handles `SIGWINCH`.
