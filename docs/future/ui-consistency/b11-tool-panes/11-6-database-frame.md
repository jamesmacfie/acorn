# 11-6. The Database frame has no inset, and its list has no header

**Status:** not started. Batch B11. Written 2026-10-01. Line numbers are from 2026-10-01 and may
have moved.

Everything the Database tree draws starts on the pane edge or the divider. The not-configured error is a
red inline line at the pane's left edge. The table filter starts at the edge with no bar. The row
editor's fields start on the divider and run to the pane's right edge. The table list names its landmark
but draws no header and no count. With no connection, its fallback is an empty `EmptyState` that still
takes 65 pixels.

## Where to see it

The Database pane: not configured, and connected with the row editor open (area 11's fake data patch).

## The fix

The partial fix. A code for the "not configured" error, and an action that opens the project's Database
settings, are server changes and are deferred (see [deferred.md](../deferred.md)).

In `plugins/database/src/tree/DatabasePanel.tsx:233-303, 469-520`:

- The list column gets `SectionHeader` "Tables" with `count`.
- The row editor uses `DetailColumn scroll`.
- With no connection, draw no list fallback.
- The not-configured state stays an `Alert` until the server sends a code, but it moves into the detail
  column.

## Copy

| Where | Current text | Decision | New text |
| --- | --- | --- | --- |
| `plugins/database/src/tree/app.tsx:17` | This pane needs a task — its database comes from the task's worktree. | Rewrite | Open a task to see its database. |
| `DatabasePanel.tsx:238` | Tables (landmark only) | Keep | Also as the list header's label. |
| `DatabasePanel.tsx:239` | Filter tables… | Keep | |
| `DatabasePanel.tsx:240` | No tables. / (empty) | Rewrite | "No tables" when connected. Draw nothing when not. |
| `DatabasePanel.tsx:303` | Select a table or run a query. | Rewrite, centred `EmptyState` title | Choose a table, or run a query |

Held for the error code: the node's message at `packages/node-core/src/server/core/data.ts` (around
`:232`), whose rewrite is a centred `EmptyState` with **Open Database settings**.

## Risk and checks

- Before you start, confirm the list column is a kit `ListColumn` that a `SectionHeader` can head.
- The frame region takes no padding and is not in the chrome pull-back list. Measure every edge after.
- Screens: not configured, connected with nothing selected, and the row editor.
- Tests: `plugins/database`. Rebuild the bundle.
