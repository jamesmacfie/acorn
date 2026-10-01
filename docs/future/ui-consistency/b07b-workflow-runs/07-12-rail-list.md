# 07-12. The Workflows rail list: mid-list pane headers and problem rows that say nothing

**Status:** not started. Batch B07b. Written 2026-10-01. Line numbers are from 2026-10-01 and may
have moved.

**Schedules** and **Recent runs** are pane-level headers, so each draws a 48-high tinted bar in the
middle of the column, like the column's own header. A file that does not parse is a row reading
"⚠ repo:broken": the layer key, not the file name or the error, and pressing it does nothing. The
definitions count skips problem rows. Collapsed, two workspace workflows show as two identical layer
icons. Run rows have no time and no task, so two runs of one workflow look the same.

## Where to see it

Workflows in the left rail. For a problem row, add a file that does not parse under the fixture
repo's `.acorn/workflows/`, take the shots, and delete it. Collapse the list column to see collapsed
rows.

## Already done

- K1a capped row meta, so a long error no longer squeezes the run row's title to nothing or scrolls
  the column sideways (07-4's kit part).
- K2 noted that **Recent runs** draws a tinted bar mid-column after its chrome change.

## The fix

In `plugins/workflows/src/client/WorkflowsBrowse.tsx`:

- Around `:252, 277`: **Schedules** and **Recent runs** are `SectionHeader level="group"`.
- Around `:122, 197-208`: a problem row shows the file name as its title and the error as its second
  line, counts in the definitions count (`:173`), opens the file's editor (drop the early return at
  `:145`), and carries its problem in `tip` with a toned icon.
- Around `:215`: a definition's problems move from `title` to `tip`. The badge (`:237`) reads "Can't
  read".
- Around `:219-226`: a collapsed row shows the first letters of the name.
- Around `:174`: **New** with `Icon name="plus"`.
- Run rows: meta is the status word ([07-3](./07-3-status-words.md)) and the relative time. The task
  name and the error go in the row's `tip`.
- `editor/draftStore.ts:35`: the layer glyph's meaning moves to the styled tip (the words are in
  [07-19](../b07a-workflow-editor/07-19-save-and-publish-marks.md)).
- Around `:325`: the empty detail is a centred `EmptyState` with a title.

## Copy

| Where | Current text | Decision | New text |
| --- | --- | --- | --- |
| `:176` | Definitions | Rewrite, add `help` | **Workflows**. Help: "A workflow is a list of steps acorn runs for you in a task." |
| `:174` | + New | Rewrite | **New**, with `Icon name="plus"` |
| `:180` | Choose a project to see the workflows it can run. | Rewrite | Choose a project to see its workflows. |
| `:184` | Loading… / No workflows yet. | Keep | |
| `:237` | problem | Rewrite | Can't read |
| `:267` | No next check | Rewrite | No check planned |
| `:306` | The run list could not be read from this node. | Rewrite | Couldn't load recent runs. |
| `:326` | Choose a workflow, or make a new one. A workflow is a list of steps acorn runs for you in a task. | Rewrite, split | Title "No workflow open", body "Choose one, or make a new one." The second sentence is the header's help. |

The plan's overrules: row 722 renames the list to "Workflows", and row 729 wins over the baseline's
own wording for `WorkflowsBrowse.tsx:326`.

## What earlier batches give you

- **`SectionHeader help`** (K3), for the **Workflows** header.
- **Row `tip`** for the run row's task and error. Tips open with no delay, so a tip on every row can
  flash as the pointer moves down the list; K3 kept `TreeRow` on native `title` for that reason. Judge
  it in the window.

## Risk and checks

- Before you start, confirm what pressing a problem row should open; the editor already says when a
  file does not parse.
- Screens: the rail with runs, with a problem row and a committed file, collapsed, and empty.
- Tests: `plugins/workflows`.
