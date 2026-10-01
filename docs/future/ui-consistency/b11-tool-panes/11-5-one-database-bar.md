# 11-5. The Database pane is three bars with a header nested in one

**Status:** not started. Batch B11. Written 2026-10-01. Line numbers are from 2026-10-01 and may
have moved.

The Database pane's first bar is a `Toolbar` with a `SectionHeader` inside it. The next row is an actions
toolbar with no fill and four md buttons, three of them solid (**Save**, **Generate**, **Execute**), and
**Execute** ends exactly on the pane's edge. A third, 26-high result bar is always drawn, even when
empty. Connection state is a coloured word ("connecting…", "error"), and **Reconnect** is a "⟳" text
glyph. Four solid-looking buttons give no sign of which one runs the query.

## Where to see it

The Database pane on a task, with area 11's fake data patch: not configured, connected, and with a
query result.

## Already done

- K2's chrome change made the nested pane header blend into the bar rather than show as a box of
  another colour. The nesting is still there.
- K4a's 03-5 left the row editor's "✕" (`:476`) for this finding.

## The fix

The partial fix. A host header region for document layouts, so the bar can sit above the SQL editor,
changes the layout contract and is deferred (see [deferred.md](../deferred.md)).

In `plugins/database/src/tree/DatabasePanel.tsx:224-302`, merge the connection bar and the actions row
into one `Toolbar`:

- `Heading level={2}` "Database", the connection as a `Badge`, then `ToolbarSpacer`.
- The saved-queries `Picker size="sm"`.
- **Save** and **Generate** as sm outline.
- **Run** as the one sm solid, with `tip="Run query"` and `tipKey="⌘↵"`. A `tipKey` needs a `tip`.
- `IconButton icon="refresh-cw"` named "Reconnect".
- `:471-477`: drop the nested `SectionHeader`s. `:476`'s "✕" becomes `IconButton icon="x"`.
- `:296-302`: the result bar only with a result. "+ Row" becomes **Add row**.

## Copy

| Where | Current text | Decision | New text |
| --- | --- | --- | --- |
| `DatabasePanel.tsx:225` | Database (`SectionHeader`) | Keep | As `Heading level={2}`. |
| `DatabasePanel.tsx:227` | connecting… / error / connected | Rewrite | Connecting… / Not connected / the database name, as a `Badge` |
| `DatabasePanel.tsx:230` | ⟳ (title Reconnect) | Rewrite | `IconButton icon="refresh-cw"`, tip "Reconnect" |
| `DatabasePanel.tsx:259` | ⌘↵ to run | Remove | Only because **Run** carries `tip` and `tipKey` (the plan's overrule). |
| `DatabasePanel.tsx:265` | No saved queries yet. | Rewrite | No saved queries. Use **Save** to keep the one in the editor. |
| `DatabasePanel.tsx:293` | Execute | Rewrite | Run |
| `DatabasePanel.tsx:125, 152` | SELECT · 2 rows · 12ms / 40 of 1284 rows | Keep | Add the thousands separator: "40 of 1,284 rows". |
| `DatabasePanel.tsx:300` | + Row | Rewrite | Add row |
| `DatabasePanel.tsx:476` | ✕ (title Close) | Rewrite | `IconButton icon="x"`, tip "Close" |

## What earlier batches give you

- **`formatChord`** (B02), for the `tipKey`. B02 noted `DatabasePanel.tsx:259` still writes the chord by
  hand.
- **Chrome-bar buttons are sm** (K1a), except a bar holding an input; this bar holds a `Picker`, so set
  the sizes explicitly.
- **Numbers in tree text** (K4a), so counts render in the tree.

## Risk and checks

- Before you start, check what `Picker` claims when it sits in a toolbar (K3 made it claim the nearest
  `Field`).
- The pane has no top bar for the pane's pin and close to reserve room in (B02's note). The pin still
  floats over the SQL editor; that is the deferred header region.
- Screens: Database not configured, connected, a query result.
- Tests: `plugins/database`. Rebuild the database bundle.
