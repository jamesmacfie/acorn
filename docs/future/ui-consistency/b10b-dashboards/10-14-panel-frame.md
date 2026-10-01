# 10-14. The dashboard panel frame: three left edges, and a menu trigger that vanishes

**Status:** not started. Batch B10b. Written 2026-10-01. Line numbers are from 2026-10-01 and may
have moved.

A panel is a `Card` at the small pad, and inside one card text starts at three insets: the title at 21
(after a 6-pixel grip), a stat or table at 9, and list rows at 26. The title is a hand-drawn span, not a
heading. The panel menu's trigger passes `data-open` to `IconButton`, which the closed kit drops, so in a
real window moving the pointer into the menu fades its trigger out. **Delete panel** and **Remove from
here** share a group, and delete arms with a hand-built label ("Delete — press again").

## Where to see it

Home with a few panels (add them, and delete them after). Hover a panel, open its "···" menu, and arm
**Delete panel**.

## Already done

- K1a left the panel and tab menus' hand-built armed labels for this batch.
- K4a gave `Menu.Item` a separator rule for destructive items and a `confirm` prop path; `ContextMenuItems`
  inserts a separator before the first danger item.

## The fix

- `packages/client-core/src/features/dashboards/PublishedDashboardPanel.tsx:59-66`: `Card` at its
  default pad. The title is a `Heading level={3}`.
- `dashboards.css:307-316`: the grip is an absolute overlay that takes no inline space, so the title,
  rows, and body share the card's edge.
- `PanelGridItem.tsx:60` and `DashboardTabs.tsx:218`: `opens="menu" expanded={open()}` in place of the
  dropped `data-open`. `dashboards.css:333-337` keys on `[aria-expanded='true']`.
- `PanelGridItem.tsx:48-103`: menu order **Edit**, **Move or resize**, **Move up**, **Move down**,
  **Move to**, a separator, **Remove from this dashboard**, then **Delete panel** with
  `tone="danger"` and `confirm="Delete panel?"`, replacing the hand-armed label.
- `PublishedDashboardPanel.tsx:68`: "Panel unavailable" gets **Edit panel** and **Try again**.

## Copy

| Where | Current text | Decision | New text |
| --- | --- | --- | --- |
| `PanelGridItem.tsx:67` | Edit | Keep | |
| `PanelGridItem.tsx:73, 76, 80` | Move up / Move down / Move to | Keep | |
| `PanelGridItem.tsx:87` | Remove from here | Rewrite | Remove from this dashboard |
| `PanelGridItem.tsx:98` | Delete panel / Delete — press again | Rewrite | Delete panel, with `confirm="Delete panel?"` |
| `PublishedDashboardPanel.tsx:62` | Refresh {title} | Keep | |
| `PublishedDashboardPanel.tsx:68` | Panel unavailable / Reconnect the source or edit this panel to repair its query and field mappings. | Rewrite | Title "Couldn't load this panel". Body "Its source may be disconnected, or a field it uses changed." Actions **Try again**, **Edit panel**. |
| `PublishedDashboardPanel.tsx:69` | Refresh failed. Showing the last cached data. | Rewrite | Couldn't refresh. Showing the last data we got. |
| `PublishedDashboardPanel.tsx:70` | Some sources returned partial data: host budget, upstream cap. | Rewrite | Only part of the data loaded. Narrow the query to see all of it. |
| `PublishedDashboardPanel.tsx:71` | Loading published panel… | Rewrite | Loading… |
| `views/PanelBody.tsx:18-19` | View unavailable / This panel uses a "{kind}" view, which this version does not draw. | Rewrite | Title "Can't draw this view". Body "This version of acorn has no {kind} view. Edit the panel to choose another." |

`:69` uses the plan's one phrase for stale data, "Showing the last data we got." **Move or resize** is
[10-17](./10-17-move-and-resize.md)'s too.

## What earlier batches give you

- **`Menu.Item confirm`** with a "{Verb} {thing}?" label, and the destructive-item rule in
  `docs/ui-design.md` § Menus and right-click: `tone="danger"`, last, below a separator.
- **`IconButton opens="menu" expanded`** (used by B02 for the app menu trigger).

## Risk and checks

- Before you start, check the menu trigger renders `aria-expanded` with the new props.
- Panel header buttons are `opacity: 0` until hover, so the driver's snapshot omits them; press them
  with a DOM `click()`.
- Screens: five panels, the panel menu, delete armed, and "Couldn't load this panel" (from code).
- Tests: the client-core dashboards tests.
