# 11-18. Smaller tool-pane defects

**Status:** not started. Batch B11. Written 2026-10-01. Line numbers are from 2026-10-01 and may
have moved.

Five small defects in the API and Database panes. Item g, fixed 200-pixel `Grid` columns, is left for
the performance work, which owns the virtual grid (see [deferred.md](../deferred.md)). Item h (the Docker
log is 11 pixels and the diff 12) is a note, not a fix.

## Where to see it

The API pane's list and Variables view, and the Database pane's saved-queries picker.

## Already done

- f. K3's `Field` change fixed the folder field's accessible name ("FolderSlash-separated…").

## The fix

- **a.** `plugins/http/src/tree/HttpList.tsx:18`: the header reads "Requests", not the project's name.
  `:37`: folder names use `SectionHeader level="sub"`, so they keep their case.
- **b.** `HttpList.tsx:51`: **Variables** becomes a `SegmentedControl` **Requests** | **Variables**, not a
  button that turns solid.
- **c.** In the panel, the Variables view's bare `Heading level={3}` becomes a detail `Toolbar` with
  `Heading level={2}` "Variables". The settings mount is 06-16's, deferred.
- **d.** `plugins/http/src/tree/HttpVariables.tsx:104, 112`: the inputs get `label`s, not just
  placeholders.
- **e.** `plugins/database/src/tree/DatabasePanel.tsx:263`: the picker trigger reads "Saved queries", so
  loading a query no longer widens it.

## Copy

| Item | Where | Current text | Decision | New text |
| --- | --- | --- | --- | --- |
| a | `HttpList.tsx:18` | {project name} (list header) | Rewrite | Requests |
| a | `HttpList.tsx:20` | + Request | Rewrite | New request, with a plus icon |
| a | `HttpList.tsx:25` | This task | Keep | |
| a | `HttpList.tsx:28` | Nothing yet — new requests you make here stay with this task until you file them. | Rewrite, add `help` | Inline: "No requests in this task". Help on "This task": "Requests you make here stay with this task until you save them to the project." |
| a | `HttpList.tsx:37` | Ungrouped | Keep | In body case. |
| a | `HttpList.tsx:44` | No saved requests for this project yet. | Rewrite | No saved requests in this project |
| e | `DatabasePanel.tsx:263` | Queries | Rewrite | Saved queries |

## What earlier batches give you

- **`SectionHeader help`** (K3), for the "This task" explanation. A tree passes `help` as a string, so
  loaded plugins can use it.

## Risk and checks

- Before you start, note that a tree cannot fill a header's `actions` slot (11-7, deferred). **New
  request** stays in its own row until then.
- Screens: the API list with a saved request in a folder, the Variables view, and the saved-queries
  picker with a query loaded.
- Tests: `plugins/http`, `plugins/database`. Rebuild both bundles.
