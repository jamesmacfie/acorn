# 10-19. Linear task panes list bare ids, and the menu offers Create task twice

**Status:** not started. Batch B10a. Written 2026-10-01. Line numbers are from 2026-10-01 and may
have moved.

A task with two linked Linear issues gets a narrow list of rows reading only "ACO-51" and "ACO-57", so
you cannot tell them apart without opening each. The rail row menu offers **Create task…** for an issue
that already has a task.

## Where to see it

The seeded task with two Linear links (area 10 seed), its Linear pane; and a Linear rail row's menu for
ACO-42, which already has a task.

## The fix

The partial fix. Rollbar titles in the task pane need a batch title read, and are deferred (see
[deferred.md](../deferred.md)).

- `plugins/linear/src/tree/app.tsx:188-210`: rows show the title, read in a batch through
  `/v1/p/linear/issues`, with the key as meta.
- `packages/client-core/src/host/chrome/ChromeSourcePanel.tsx:165-177`: **Open task** when
  `taskTracksRef` finds one, as two registrations with complementary `when` guards.

## Copy

| Where | Current text | Decision | New text |
| --- | --- | --- | --- |
| `ChromeSourcePanel.tsx:169` | Create task… | Rewrite | "Open task" when one exists; "Create task…" otherwise. |
| `linear/src/tree/app.tsx:155` | No Linear issues are linked to this task. Pick one from the Linear rail, then choose Create task from its row menu. | Rewrite | This task has no Linear issues. |
| `linear/src/tree/app.tsx:158` | Could not read this task. | Rewrite | Couldn't load this task. |
| `linear/src/tree/app.tsx:194` | Linked Linear issues (list label) | Keep | |
| `rollbar/src/tree/app.tsx:139` | No Rollbar items are linked to this task. Select one from the Rollbar rail, then choose Create task from its row menu. | Rewrite | This task has no Rollbar errors. |
| `rollbar/src/tree/app.tsx:143` | Could not read this task. | Rewrite | Couldn't load this task. |
| `rollbar/src/tree/app.tsx:172` | Linked Rollbar items | Rewrite | Linked Rollbar errors |

GitHub's row menu uses the same two-registration pattern, shipped in B09:
`plugins/github/src/client/PullList.tsx`, the `github.pull.create-task` and `github.pull.open-task`
items.

## Risk and checks

- Before you start, confirm `/v1/p/linear/issues` accepts a batch of identifiers.
- Screens: the Linear task pane with two links, the Rollbar task pane with two links, and the row menu
  on an issue with and without a task.
- Tests: `plugins/linear`, `plugins/rollbar`, client-core.
