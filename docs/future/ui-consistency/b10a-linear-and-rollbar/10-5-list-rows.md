# 10-5. Linear and Rollbar list rows spend their width on everything except the title

**Status:** not started. Batch B10a. Written 2026-10-01. Line numbers are from 2026-10-01 and may
have moved.

In the 300-pixel Linear list, a row's title gets 31 pixels ("Log…"), because the plugin sends two
meta fields, the key and the state word, and the host reserves two 84-pixel tracks. The state word
repeats what the glyph already says. Rollbar puts "#1042" first, then a count badge whose width changes
with the number, so each title ends at a different place, and counts print unformatted ("1284"). The
title is how people tell issues apart.

## Where to see it

The Linear and Rollbar rail sources, with the area 10 seed (see
[the README](../README.md#seeds-for-populated-views)).

## Already done

- K1a capped row meta at half the row and gave the body a floor (07-4).
- K1a made `RowActions` hide until hover, focus, or selection (08-4).

## The fix

Rail items are built on the node side. Rebuild the linear and rollbar bundles and restart the node, or
nothing changes.

- `plugins/linear/src/shared/rail.ts:52-58`: `fields` is the identifier only. Keep the connection name
  when several connections are named.
- `plugins/rollbar/src/shared/rail.ts:24-35`: drop `fieldsFirst`, so the title leads. The count is plain
  faint meta, formatted with `toLocaleString()`.
- Both keep `short` for the collapsed rail.
- `packages/client-core/src/host/chrome/ChromeSourcePanel.tsx:328`: the row's `title` becomes `tip`.
  `Row tip` exists.

## Copy

No copy rows. The visible change is the count's thousands separator ("1,284").

## Risk and checks

- Before you start, confirm the host still reserves one 84 track per field.
- Tips open with no delay; a tip on every row can flash as the pointer moves down the list (K3 kept
  `TreeRow` on native `title` for this reason). Judge it in the window.
- Screens: both lists populated, and collapsed.
- Tests: `plugins/linear`, `plugins/rollbar`, client-core.
