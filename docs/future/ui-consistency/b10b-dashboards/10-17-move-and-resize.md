# 10-17. Move and resize mode is hard to see and to learn

**Status:** not started. Batch B10b. Written 2026-10-01. Line numbers are from 2026-10-01 and may
have moved.

The panel being moved has no outline (`outline: none` on the focused slot), so only the lattice says a
mode started. The caption "Row 1, column 5, 3 wide, 2 tall" draws below the panel, over the next
panel's title. How to move is only in the `aria-label`. The menu item reads "Move / resize".

## Where to see it

Home with panels › a panel's menu › **Move / resize**.

## The fix

- `packages/client-core/src/features/dashboards/PanelGridItem.tsx:70`: "Move or resize".
- `PanelGridItem.tsx:116-147` and `dashboards.css:204-221`: the moving slot gets the focus-ring tokens
  and a raised border, with no `outline: none`. The caption moves inside the panel's bottom edge and
  adds "Arrow keys move. Shift and arrows resize. Enter to finish."

## Copy

| Where | Current text | Decision | New text |
| --- | --- | --- | --- |
| `PanelGridItem.tsx:70` | Move / resize | Rewrite | Move or resize |
| `PanelGrid.tsx:242` | Row {y}, column {x}, {w} wide, {h} tall | Keep | |
| (new) move caption | (none) | Rewrite | Arrow keys move. Shift and arrows resize. Enter to finish. |

## Risk and checks

- Before you start, check the caption's position does not depend on the next panel.
- Animations do not advance in the hidden driver window; finish them before a shot.
- Screens: move mode on a panel in the middle of the grid.
- Tests: the client-core dashboards tests.
