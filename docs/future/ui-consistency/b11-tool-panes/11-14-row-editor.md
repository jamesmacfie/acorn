# 11-14. The Database row editor uppercases column names and keeps a stale selection

**Status:** not started. Batch B11. Written 2026-10-01. Line numbers are from 2026-10-01 and may
have moved.

The row editor writes column names in the uppercase label treatment, so `created_at` reads
"CREATED_AT" and a camel-case `userId` would read "USERID". The null toggle is a lower-case "null"
checkbox. Fields are resizable textareas with no label element tying them to their column. After an
ad-hoc query, the table list still highlights the last table opened, though the grid shows the query's
result. "Read-only (no single-table PK)." explains the rule in abbreviations.

## Where to see it

The Database pane with area 11's fake data patch: open a three-row table and select a row; then run an
ad-hoc query and select a result row.

## The fix

In `plugins/database/src/tree/DatabasePanel.tsx`:

- `:469-520`: each column is a `Field`. The label is the column name in body case. The hint is the type
  plus "Primary key".
- `:499`: "Set to NULL".
- `:506`: the copy below, split by cause.
- `:134-159`: `execute()` also clears `selected`.

## Copy

| Where | Current text | Decision | New text |
| --- | --- | --- | --- |
| `DatabasePanel.tsx:473` | {table} · new row / {table} · row / Row | Rewrite | New row in {table} / Row in {table} / Row (sentence case, `Heading level={3}`) |
| `DatabasePanel.tsx:485` | PK | Rewrite | Primary key (a `Badge`) |
| `DatabasePanel.tsx:499` | null | Rewrite | Set to NULL |
| `DatabasePanel.tsx:506` | Read-only (no single-table PK). | Rewrite, split by cause | For a query result: "To edit a row, open its table from the list." For a table with no primary key: "This table has no primary key, so its rows can't be edited here." |
| `DatabasePanel.tsx:512` | Confirm delete | Done | K1a made it **Delete row?**. |

## What earlier batches give you

- **`Field`** labels only its caption and hands its control an id (K3), so each textarea is named by its
  column.

## Risk and checks

- Before you start, check how the editor knows a row comes from a query rather than a table.
- Screens: the row editor on a table row and on a query result row.
- Tests: `plugins/database`. Rebuild the bundle.
