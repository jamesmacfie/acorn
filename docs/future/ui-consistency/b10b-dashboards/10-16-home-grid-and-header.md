# 10-16. Home's grid and header

**Status:** not started. Batch B10b. Written 2026-10-01. Line numbers are from 2026-10-01 and may
have moved.

Panels sit 6 apart on a page padded 14, a fixed rung that does not move with the style pack. A "PANELS"
group header labels something obvious. **Add panel** jumps from the top-left corner on an empty Home to
the far right once a panel exists. Tab names cut at 16 characters with the whole row free, and the
chevron shows only on the active tab, so the tabs shift sideways every time you pick one.

## Where to see it

Home with panels, and with two or more dashboard tabs. Tabs only show once a workspace has two named
tabs, and nothing in the app creates the second one (10-2, deferred), so write two tabs into the
preference to review them, and remove them after.

## Already done

- K1a's 00-17 made the dashboard tab focus ring read the focus tokens.
- K2's 02-11 made the dashboard tab strip fade the edge that overflows.
- K3 routes a `Button`'s `title` to the styled tip, so the **+** button's limit text already shows as a
  styled tip.

## The fix

- `packages/client-core/src/features/dashboards/dashboards.css:106`: grid gap `var(--gap-stack)`.
- `PanelGrid.tsx:357-358`: drop the "Panels" group header on Home only, through a prop. `PanelGrid` is
  shared by three hosts.
- `packages/client-core/src/features/workspaces/Home.tsx:40-50`: **Add panel** in the header row, beside
  the title.
- `dashboards.css:79`: tab `max-width: 24ch`.
- `DashboardTabs.tsx:210-226`: always draw the chevron, and fade it in on the active tab, hidden from
  focus when inactive.
- `DashboardTabs.tsx:238`: the **+** tip through the styled tip, with the copy below.
- The default tab name stays "Home" (plan decision 14).

## Copy

| Where | Current text | Decision | New text |
| --- | --- | --- | --- |
| `PanelGrid.tsx:358` | Panels | Remove on Home only | **Add panel** moves into Home's header. |
| `DashboardTabs.tsx:128, 135, 142` | Rename / Move left / Move right | Keep | |
| `DashboardTabs.tsx:157` | Delete dashboard / Delete — press again | Rewrite | Delete dashboard, with `confirm="Delete dashboard?"` |
| `DashboardTabs.tsx:237` | New dashboard | Keep | |
| `DashboardTabs.tsx:238` | {8} dashboards is the limit. (`title`) | Rewrite | You can have up to 8 dashboards. As the styled tip. |
| `homeTab.ts:23` | New dashboard (default name) | Keep | |
| `homeTab.ts:37` | Home (default tab name) | Keep | Plan decision 14 and the overrule on row 711. |
| `PanelGrid.tsx:404` | Could not delete the published panel. Reconnect the Node and try again. (screen reader only) | Rewrite | Shown as a toast: "Couldn't delete this panel. Try again." |

Skipped on purpose: row 707 (the **Delete dashboard** explanation about a "library") describes behaviour
that does not exist; see 10-2 in [deferred.md](../deferred.md). **New dashboard** in Home's header is
10-2's too.

## Risk and checks

- Before you start, check what else reads `PanelGrid`'s header (the source panel and the extended pane).
- Screens: Home with five panels, Home tabs with the tab menu and rename, and an empty tab.
- Tests: the client-core dashboards tests.
