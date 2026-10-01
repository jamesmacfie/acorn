# 10-4. The first panel on an empty Home draws on 44-pixel cells

**Status:** not started. Batch B10b. Written 2026-10-01. Line numbers are from 2026-10-01 and may
have moved.

After publishing the first panel on an empty Home, the panel lands 176 by 176 and its rows give the title
3 pixels. `PanelGrid` attaches its `ResizeObserver` once, on mount, but on an empty Home the grid is not
in the page yet, so the observer is never attached and the cells stay at their 44-pixel starting value
until Home remounts. Window resizes are not measured either. The first thing a person makes on Home
looks broken.

## Where to see it

An empty Home › **Add panel** › publish a list panel. Then leave Home and come back to see the correct
size. Delete the panel after.

## The fix

- `packages/client-core/src/features/dashboards/PanelGrid.tsx:128-134`: delete the `onMount` block.
- Set up the observer in the grid's `ref` (around `:362`), with `onCleanup` disconnecting it. The first
  callback does the initial measure.

## Copy

No copy rows.

## Risk and checks

- Before you start, confirm the grid element is still assigned in a `ref` callback.
- `PanelGrid` is shared by three hosts. The change is internal and applies to all three.
- Screens: Home with its first panel, before and after a remount, and after a window resize.
- Tests: the client-core dashboards tests.
