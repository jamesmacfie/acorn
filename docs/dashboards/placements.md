# Placements

A placement is a surface that holds panels: a Home tab or a plugin region. This page covers Home and
its tabs, plugin regions, and the grid every placement uses. The grid component is
`packages/client-core/src/features/dashboards/PanelGrid.tsx`, and its arithmetic is
`packages/dashboards-core/src/layout.ts`.

## Placements

Home is a dashboard and nothing else. With no panels placed, it shows one ghost button. Panels already
placed still render when their plugin goes away.

A Home board belongs to one workspace, and switching workspace switches the board. A row's in-app
action resolves against the workspace you're in, so a shared board could offer rows whose project is
somewhere else. The workspace is the scope key's third segment, `home/<tabId>/<workspaceId>`, so
the same panel can be placed in several workspaces with its own rect in each. The routed project
decides the workspace. A board saved before boards were per workspace is adopted, once, by the first
workspace to open Home (`adoptLegacyHome` in `persist.ts`). Adoption doesn't overwrite a board.

## Home tabs

Home can hold up to eight dashboards per workspace. The tab bar is present from the default Home tab,
so its **+** is available before a second dashboard exists.
It's an ARIA tablist: arrows move and activate, Home and End jump, and the grid is the `tabpanel`.
The bar's **+** creates a tab and drops into an inline rename. Names are made unique as
`New dashboard`, `New dashboard 2`, and so on. Rename, move, and delete live in the active tab's
overflow and each tab's context menu. Deleting asks first, and panels stay in the library and on other
tabs. A panel moves between tabs through **Move to…**, keeping its definition and taking a fresh rect.

Creating the first extra dashboard also names the original tab `Home`.

Which tab you're reading is device view state, the `core.home-tab` slice, not part of the Node
preference, because syncing it would move another client's view. A remembered tab that was deleted,
or belongs to another workspace, falls back to the default tab.

The `pane` surface remains in the scope grammar so stored pane placements parse, and
nothing draws them.

## Plugin regions

A plugin region is the same `PanelGrid` in a rectangle a plugin reserved: a rail source's side panel
beside its list, or a `pane.aside` beside a plugin pane. Both are stored under
`plugin-region/<pluginId>:<id>`. The host draws the region, and the manifest only reserves it, because
panels are host components and a frame is a separate realm. An aside shares the `extensionPoints` key
with the cooperative kinds, but you fill it, not another plugin
([cooperative extension points](../plugins/cooperative-extension-points.md)).

A region's constraints are one small vocabulary (`region.ts`): which sources, a required field role,
which views, and a maximum panel count, four by default. The constraints check only publication
metadata, without fetching records. A region with no constraint accepts any panel. They're enforced
twice: the editor doesn't offer a disallowed option, and the host checks again at render, because a
plugin can narrow its region in an update. A refused panel isn't drawn there and nothing is deleted.

**Remove from this dashboard** unplaces a panel. **Delete panel** destroys the definition and asks first. A
region whose plugin is disabled disappears, and its panels survive to return with it.

## The grid

A placement is 12 columns of square cells (`COLS`), each panel at an explicit `{x, y, w, h}`. Twelve
divides into halves, thirds, quarters, and sixths, and a fixed count makes a rect mean the same thing
on every window and every client. Square cells make "3 wide, 2 tall" mean something. Rows run down
without limit, because the page scrolls. The cell size is the feature's one pixel measurement, a
`ResizeObserver`, so panel heights change with window width.

Three behaviors keep the grid predictable:

- **A dragged panel pushes what it lands on down,** never sideways. Down always has room, so a push
  always succeeds.
- **A widening resize pushes neighbors right and stops at the wall.** The handle stops moving instead
  of wrapping a neighbor onto the next row. Growing taller pushes down.
- **Vertical compaction is always on.** Removing a panel closes the gap, at the cost of deliberate
  vertical gaps.

The preview during a gesture is the layout algorithm on the candidate, so release saves exactly what
you saw, and Escape writes nothing. A panel drags by its header only. Panels are placed absolutely
from the measured cell, not by `grid-area`, which can't be animated. Each view kind has a minimum and
an arrival size in a tuning table in `layout.ts`. No plugin can influence a rect.

Every pointer gesture has a keyboard equivalent through the same functions. **Move or resize** in the
overflow menu enters layout mode: arrows move a cell, Shift+arrows resize, Enter commits, and Escape
restores. A live region and a caption announce the position. Move up and move down swap with the
neighbor in reading order.

Below about twelve 44px cells, the grid collapses to one column in reading order and gestures turn
off. Storage doesn't change, so widening restores the layout. `placements` is rewritten to reading
order, `(y, x)` with ID as a tiebreak (`readingOrder`), on every commit. That gives a client with no
geometry a sensible order, makes the collapse need no second opinion, and keeps screen reader order
matching visual order.
