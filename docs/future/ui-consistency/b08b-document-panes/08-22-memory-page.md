# 08-22. The Memory page is a wall of full-width cards

**Status:** not started. Batch B08b. Written 2026-10-01. Line numbers are from 2026-10-01 and may
have moved.

Each memory on the Memory page is a `Card` with a pill, its slug name, its description, and its
absolute file path. The filter is an md input about 1,360 pixels wide, not the filter kind, and it shows
even when there are no memories. The page ignores any measure, so on a wide window the cards run the
full width. Other lists in the app are rows.

## Where to see it

**Memory** in the left rail. The fixture has no memories; the area review added one and removed it.
Do not add one through the app (see the safety note).

## Already done

- K1a's 00-16 fixed the page's alert (button in `actions`, no outer margin) and applied the baseline's
  rewrite: "To get suggestions, choose a review model and where they go."
- K2 added `DetailColumn measure="page"`.

## The fix

The partial fix. **Open** and **Delete** for a memory need new memory routes and a way to open a file
outside the worktree, so they are deferred (see [deferred.md](../deferred.md)).

In `plugins/memory/src/client/MemoryCenter.tsx:37-85`:

- Each memory is a `Row variant="stacked"`: the name, the description, type and scope `Badge`s, and the
  path as a muted mono second line. Keep the path visible: until **Open** exists, it is the only way to
  find the file (the plan's overrule on row 731).
- The filter is `kind="filter"`, shown only when there is something to filter.
- Cap the column with `DetailColumn measure="page"`.

## Copy

| Where | Current text | Decision | New text |
| --- | --- | --- | --- |
| `MemoryCenter.tsx:43` | Durable knowledge and suggestions distilled from completed tasks. | Move to `help` on the page title | What agents learned from your finished tasks, and the changes they suggest. |
| `MemoryCenter.tsx:60` | Agents propose these as they work, and you can add one by hand from a task's Context pane. | Keep | |
| `MemoryCenter.tsx:54` | Filter by name or description… | Rewrite | Filter memories… |
| `MemoryCenter.tsx:58` | Nothing matches that filter. / No memories yet. | Rewrite | No memories match / No memories yet |
| `MemoryCenter.tsx:75` | {absolute path} | Keep visible | As the row's muted mono second line. |

## What earlier batches give you

- **`DetailColumn measure="page"`** (K2's P13). If the page is not a `DetailColumn`, note it and use the
  page's own cap instead.
- **`Heading help`** (K3), for the page title's explanation.
- **`formatPath`** (B05) is in core only, not in `@acorn/plugin-api`. The memory plugin cannot import it
  today; showing the path whole is fine.

## Risk and checks

- Before you start, read the safety note: never add, edit, or delete a memory through the app.
- To see a populated page, seed one memory file by hand in a scratch home folder, or judge from code
  and tests.
- Screens: Memory empty and, if seeded safely, with one memory.
- Tests: `plugins/memory`.
