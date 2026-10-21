# Placements

A placement is a surface that holds panels: a Home tab or a plugin region. This page covers Home and
its tabs, plugin regions, the panel menu, cells a plugin draws, and the grid every placement uses. The
grid component is `packages/client-core/src/features/dashboards/PanelGrid.tsx`, and its arithmetic is
`packages/dashboards-core/src/layout.ts`.

## Placements

Home is a dashboard and nothing else. With no panels placed, it shows one ghost button. Panels already
placed still render when their plugin goes away.

A Home board belongs to one workspace, and switching workspace switches the board. A row's in-app
action resolves against the workspace you're in, so a shared board could offer rows whose project is
somewhere else. The workspace is the scope key's third segment, `home/<tabId>/<workspaceId>`, so
the same panel can be placed in several workspaces with its own rect in each. The routed project
decides the workspace. With no project routed, Home draws an unscoped board, keyed `home`. The next
workspace to open Home adopts it (`adoptUnscopedHome` in `persist.ts`). Adoption doesn't overwrite a
board.

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
beside its list, or a `pane.aside` beside a plugin pane. Both are stored per workspace under
`plugin-region/<pluginId>:<id>/<workspaceId>`, because a panel's plan reads one workspace, and the
routed workspace picks the board, as it does for Home. Regions stored before they had a workspace are
keyed `plugin-region/<pluginId>:<id>`. The first workspace that draws one adopts it, and the next
starts empty (`adoptUnscoped` in `persist.ts`, the rule Home's adoption uses). Adoption doesn't
overwrite a board. The host draws the region, and the manifest only reserves it, because
panels are host components and a frame is a separate realm. An aside shares the `extensionPoints` key
with the cooperative kinds, but you fill it, not another plugin
([cooperative extension points](../plugins/cooperative-extension-points.md)).

A region's constraints are one small vocabulary (`region.ts`): which sources, a required field role,
which views, and a maximum panel count, four by default. The constraints check only publication
metadata, without fetching records. A region with no constraint accepts any panel. They're enforced
twice. The panel studio checks them at publish: the review describes each source and refuses a panel
the region wouldn't show, with the reason, such as "This area only shows Board and List panels"
(`regionRefusal`). The host checks again at render, because a plugin can narrow its region in an
update. A refused panel isn't drawn there and nothing is deleted.

The registration passes list every region in `panelRegionRegistry` (`region.ts`), so an agent's
panel card can offer it in **Add to dashboard**
([panels from a conversation](../dashboards.md#panels-from-a-conversation)). The card lists each region
under its rail source's or pane's label. Opening the menu describes the plan's sources, and only when
some region is on, because a region checks sources and field roles. A region that would refuse the
plan is left out, and a full one is disabled, as **Duplicate** is. App cells go on Home tabs only.

A region's `sources` can name another plugin's source, such as `agents:turns`. The list only limits
what draws there, and grants no read.

**Remove from this dashboard** unplaces a panel. **Delete panel** destroys the definition and asks first. A
region whose plugin is disabled disappears, and its panels survive to return with it.

## The panel menu

Each placed panel has a menu in its header (`PanelGridItem.tsx`). It reads top to bottom:

- **Edit…** opens the studio on the panel. **Edit with AI…** opens it with the AI docked and its box
  focused.
- **Rename** makes the header title editable. Enter saves and Escape cancels.
- **View as** lists the views from `availableViews`. A view the plan can't use, or the region
  refuses, is disabled and shows the reason. Switching keeps the options the new view also has, as
  the studio's **Show as** does (`switchView`).
- **Sort by** lists the plan's output columns with the first sort ticked, then the two directions.
  Picking a column makes it the first sort and keeps the others behind it.
- **About this panel** opens a read-only dialog with the outline in the studio's words, the original
  request, the requirements, and the published revision.
- **Duplicate** publishes a copy titled "_title_ copy" and places it beside the original at its size.
  A toast offers **Edit…**. It's disabled when the region is full.
- **Move or resize**, **Move up**, **Move down**, and **Move to** arrange the panel, then **Remove
  from this dashboard** and **Delete panel**.

`Menu` has no submenu, so **View as**, **Sort by**, and **Move to** are flat labelled groups.

Rename, **View as**, and **Sort by** are quick edits. Each publishes a revision straight away
through `publishPanelPlan` in `panelPublish.ts`, the path the studio and **Add as panel** use, and
updates the panel definition on this device. A quick edit refuses when the draft differs from the
published revision, or when this device holds a studio copy the Node doesn't have yet, because
publishing would ship those edits unseen. The refusal is a toast with **Open**. Quick edits have no
undo. **Edit…** can change a panel back.

## Cells a plugin draws

A definition with no publication names its kind in `view.kind`, and a plugin can draw that kind on
Home. Trellis draws `app`, a project app ([project apps](../agent-built-apps/project-apps.md#on-a-dashboard)).
A compiled plugin registers through `ctx.contribute(dashboardCellRegistry, …)` with the kind as its
`id`, a `component` for the cell's body, and optional `menuItems` (`cells.ts`). The grid keeps the
frame, the definition's title, the gestures, and the menu's layout items and **Remove from this
dashboard**. Rename, **View as**, **Sort by**, **About**, **Duplicate**, and **Delete panel** need a
publication, so a cell has none of them. The body gets `refreshes`, a count that goes up when the
window regains focus and after a reported plugin or account change, so a cell that runs its own reads
refreshes when panels do. A kind nobody registered, from a newer build or a plugin that's off, draws
inert. Cells go on Home tabs only, because a region's constraints read publication metadata.

Anything that puts a definition on Home, an agent's panel card or a plugin's cell, lists the tabs with
`homeTabsToAddTo` and places with `placeOnHomeTab`, both in `cells.ts`. Each kind takes its size from
the tuning table in `layout.ts`.

## Drawing a panel

Each placed panel draws inside its own `Suspense` (`PanelGridItem.tsx`), because a panel's queries
suspend whatever boundary is above them. A panel still waiting for its revision or its run shows its
title and a busy line while the others draw. Without the boundary, one slow panel held the whole page.

On the Node, a run queries every source at once and then settles them in plan order, so its problems
and budgets read the same as when each source waited for the one before it.

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
