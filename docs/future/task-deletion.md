# Delete a task

Date: October 9, 2026. Status: implemented October 10, 2026. The
[reference](../workspaces-and-tasks/archive.md#deleting-a-task) describes what shipped. It differs from
this design in two places: `ctx.core.tasks.deleted()` is on the public task service, because the loaded
http and database plugins purge too, and the workflows purge keeps processing history.

[Archive and restore](../workspaces-and-tasks/archive.md) owns the archive lifecycle this plan builds
on. [Retention](../data-layer/backup-and-retention.md#retention) owns the time-based prune of archived
agent history.

## Summary

Let the owner delete a task for good, from the archive dialog or from the Archive page. Deleting
removes the task, its subtasks, and every plugin's data for them: agent sessions and transcripts,
attachments and artifacts, task notes, saved requests, browser and terminal state, and workflow runs.
Memory entries stay, and any link from one to a deleted task reads **Deleted task**.

Acorn has no task deletion today. Archive keeps everything so restore can put it back. The only bulk
removal is the archived-history prune, which keeps each session row and replaces its transcript with a
note.

## Problem and evidence

On the development database measured on October 9, 2026, archived tasks held 494,089 of 541,222 agent
events, about 745 MB of the 802 MB of event JSON. The search index holds a second copy of that text.
The owner's history setting was **Forever**, the default, and the oldest archived task was two weeks
old, so the prune had removed nothing. An owner who knows a task is finished has no way to remove it.

Deleting a project already deletes its core task rows (`packages/node-core/src/server/projectDeletion.ts`)
but tells no plugin. Every plugin's rows for those tasks stay behind with nothing pointing at them.

## The interaction

### The archive dialog

The archive confirmation is the shell's will-phase dialog (`WillConfirmationHost` in
`packages/client-core/src/host/registries/shell/willPhase.tsx`), opened by `confirmTaskArchive`.

1. The confirm button becomes a split button: **Archive task** with a chevron, drawn the way the
   commit footer draws **Commit** and its options (`Toolbar.Group joined` in
   `plugins/changes/src/client/ChangesPane.tsx`).
2. The chevron menu offers **Archive task** and **Delete task**.
3. Choosing **Delete task** relabels the button **Delete task**, gives it the danger tone, and adds a
   warning above the buttons: "Deleting removes this task, its subtasks, and their agent
   conversations, notes, and saved requests. You can't restore a deleted task. The git branch stays."
4. Plugin concerns and their cleanups show and apply exactly as they do for archive.

The dialog takes a list of actions rather than a delete flag, so the shared host stays generic:
`actions: { id, label, danger?, warning? }[]`, with the first as the default. `WillDecision` gains the
chosen `action`. Every other caller passes nothing and sees no change.

### The Archive page

The Archive page (`packages/client-core/src/features/archive/ArchivePage.tsx`) gets a **Delete** action
beside **Restore** on each row and in the preview. It opens the same dialog with **Delete task** as
the only action. An archived task has no worktree and no running sessions, so no plugin concerns
appear.

## The Node side

### Delete route

`POST /v1/core/tasks/:id/delete`, beside `/archive` and `/restore` in
`packages/node-core/src/server/routes/projects/worktree.ts`. Unlike archive, it's device-only. A
task-scoped agent token can archive its own tree, but it must not be able to delete one.

1. If the task is active, run `archiveTask` for the tree first, with the cleanups the owner ticked.
   A failed archive stops the delete and returns the archive's reason.
2. Claim the tree with the archive gate (`beginTaskArchive`), so a restore can't run beside it.
3. In one core transaction, for the task and every descendant from `taskArchiveTree`: delete the
   `tasks`, `task_pulls`, `task_links`, and `task_script_attempts` rows, delete prefs keyed by those
   task ids, and insert a tombstone for each.
4. Broadcast the tasks change, then run the `core:task-deleted` hook with the deleted ids.
5. Answer `{ ok: true, taskIds }`. Plugin purges finish in the background.

The git branch stays. A local branch can hold commits that exist nowhere else, and deleting it is a
separate repository decision. The Git client or a terminal can remove it.

### Tombstones

A core table, `deleted_tasks (id text primary key, deleted_at integer)`, kept forever. A row is about
50 bytes. It does two jobs:

- **Plugin catch-up.** `ctx.core.tasks.deleted()` returns the ids, the same shape as
  `ctx.core.tasks.archivedBefore()`. A plugin that was disabled, slow, or mid-restart when the hook ran
  finds the ids later and purges them.
- **Labels.** The client asks for the ids once and renders any reference to one as **Deleted task**
  with no link, instead of a broken route.

A plugin must never infer deletion from a task being absent from core's list. A transient empty answer
would read as "every task is gone".

### The plugin seam

Each plugin that stores task data purges it with one idempotent function, `purgeDeletedTasks(ids)`,
called from two places:

- The `core:task-deleted` hook, observe only, for a prompt purge. It's fail-open like
  `core:task-archiving`, so a slow handler delays nothing.
- A daily schedule that reads `ctx.core.tasks.deleted()`, so a missed hook is caught up. The
  archived-history prune (`plugins/agents/src/server/sessions/historyRetention.ts`) has the same shape.

| Plugin | What it deletes |
| --- | --- |
| agents | Sessions, events and search rows, turns, requests, attachment references, artifacts, operations, spawn rows, and webhooks for the task. Attachment and artifact files that nothing else uses. |
| browser, changes, database, http, terminal | Their rows keyed by `task_id`. |
| workflows | Runs rooted at the task, and their step rows. |
| notes | The `notes/task/<taskId>/` folder. |

Agents reuses the batched delete in `removeArchivedHistory` (`plugins/agents/src/server/sessions/runtime.ts`).
It removes about 22,000 events a second in steps of 200, and gives the event loop a turn between
steps. A full delete also removes the session rows, rather than leaving a note. It ends with
`mergeSearchIndex`, as the prune does.

## References that outlive a task

| Reference | After delete |
| --- | --- |
| Delegated child sessions and child tasks | Deleted with the parent. They're descendants in `taskArchiveTree`, or sessions on the same task. |
| A parent session's delegation cards, when only the child task is deleted | Read **Deleted task**. The parent transcript is unchanged. |
| A workflow run's step, when only its child task is deleted | Reads **Deleted task**. |
| Notification bell rows for the task | Removed from the client's notice ring when the tasks change arrives. |
| Memory entries and memory feed rows (`MemoryDetail.tsx`, `MemoryFeed.tsx`) | Kept. The origin link reads **Deleted task** and doesn't navigate. |
| Workspace and global notes whose `originTaskId` names the task | Kept, like memory. The origin reads **Deleted task**. |
| Search hits | Gone, because the rows are gone. |

## Decisions to confirm

- **The branch stays.** Recommended above. The alternative is a task check offering "Also delete
  branch `name`", which shows what will go before the owner confirms.
- **Promoted notes stay.** A note copied to the workspace was the owner's choice to keep beyond the
  task, so it's treated like memory.
- **No bulk delete in the first version.** The Archive page deletes one task at a time. Selecting many
  rows and deleting them is a follow-up. The retention setting already covers deleting by age.

## Out of scope

- Shrinking the database file. Deleted rows free pages for reuse, and the file stays the same size
  until a `VACUUM` ([retention](../data-layer/backup-and-retention.md#retention)).
- Purging plugin data for tasks removed by project deletion. The same tombstones and seam fix that
  leak: `deleteProject` would insert a tombstone for each task. Do that as its own change.
- Deleting provider-side sessions, such as a Claude Code session file. The archived-history prune
  leaves those alone for the same reason: removing one means starting its CLI.

## Acceptance

- Delete an active task with a subtask and a delegated child from the archive dialog. The worktrees
  go, then every row in the table above. Its agent search hits are gone.
- Delete an archived task from the Archive page. It leaves the list, and nothing restores it.
- Disable a plugin, delete a task, enable the plugin, and run its schedule. Its rows for the task are
  gone.
- A memory entry written in a deleted task still opens. Its origin reads **Deleted task**.
- Restore and delete started together on one task: one succeeds and the other answers 409.
- `pnpm --filter @acorn/arch-tests test` passes with the new route and hook documented.
- Update [archive and restore](../workspaces-and-tasks/archive.md), [hooks](../plugins/hooks.md#hooks-that-exist),
  and [retention](../data-layer/backup-and-retention.md#retention).
