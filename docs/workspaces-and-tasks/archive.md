# Archive and restore

Archiving a task removes its worktree and stops what was running in it, and keeps everything else.
This page covers the archive dialog, the order the Node tears a task down in, how restore puts it
back, and how delete removes it for good. `archiveTask` and `restoreTask` in
`packages/node-core/src/server/storage/archive.ts` own archive and restore, and `deleteTask` in
`packages/node-core/src/server/storage/taskDeletion.ts` owns delete.

## Archive a task

Archive opens a confirmation dialog with the task title above the confirmation text. The dialog asks
every plugin what it has to say about the task, such as running containers, uncommitted files, or
live sessions, and offers each cleanup the plugin declared. If the task has active child tasks, it
also warns that all subtasks, including nested subtasks, will be archived. With nothing to report,
the dialog still appears as the explicit barrier. A plugin reaches that dialog only through a
[task check](../plugins/task-checks.md#task-checks). A cleanup that fails names
its plugin, and the task is archived anyway.

The Node archives descendants before their parent, running the lifecycle below for each task.
It claims the whole tree before teardown, so another archive cannot overlap it and plugins cannot
create more subtasks while it runs. A failure leaves the parent active and names the failing subtask.
Subtasks already archived stay archived, and retry skips them. Selected plugin cleanups apply to the
task whose concerns appeared in the dialog. Restore acts on one task at a time.

Without the terminal capability, the status-only archive also archives every descendant and runs
each task's archiving hook. It retains their worktrees. Task-scoped callers cannot archive a tree
containing tasks outside their scope.

Archive first claims the task's worktree lifecycle. While the claim holds, root reads return no path,
and archive waits for a worktree creation already in flight before it reads the path to remove. An
archived task returns no root either. So a pane refresh can't read a half-removed tree or recreate
the folder.

The Node then runs these steps in order:

1. Refuse a task with running sessions, unless forced.
2. Run the project's teardown script in the worktree. A non-zero exit pauses the archive, and the
   client offers to abort or continue with `skipTeardown`.
3. Kill the task's running terminal sessions.
4. Run core's `core:task-archiving` hook, where the agents plugin stops the provider process behind
   each of the task's agent sessions ([operations](../managed-agents/operations.md)).
5. Run the plugin cleanups you ticked in the dialog.
6. Set the worktree aside. `setWorktreeAside` refuses a dirty tree unless forced, then renames the
   folder to a sibling ending in `-<timestamp>-acorn-archive`. A folder that git no longer tracks,
   because its `.git` link is gone, is set aside only when forced and only if it sits inside the
   worktrees folder. A folder outside it stays on disk.
7. Drop the terminal plugin's saved sessions, and mark the task archived. If either step throws, the
   folder is renamed back and the task stays active.
8. Run `git worktree prune`, so restoring the task can check its branch out again, then delete the
   set-aside folder in the background.

The rename is what makes archive safe on a big project. `git worktree remove` deleted in place, so a
folder with about 150,000 files ran past git's 30-second limit and was left half deleted on
a task that was still active. A rename takes no time, and the slow delete happens after the task is
archived.

At boot, `reconcileWorktrees` looks for set-aside folders in the worktrees folder. If the task that
owned one is still active and its folder is missing, the Node stopped before the archive finished, so
the folder goes back where it was. Any other set-aside folder is deleted.

The teardown, the stops, and the cleanups sit before removal, so anything that needs the worktree
still has it, and nothing is writing into it when it goes.

The teardown takes seconds. While it runs, the task's close button and its rail row both spin. One
flag in `packages/client-core/src/features/tasks/archiveLifecycle.ts` holds that state until the
archive finishes or fails. On the rail row, teardown is the highest-priority marker
([status markers](../ui-design/shell-hierarchy.md#status-markers)). Markers it outranks keep their
place in the row's tooltip.

The same flag pauses the Changes tab's Git reads during the archive. The pane stays mounted, so it
can show a teardown failure, and it keeps its last status instead of showing the removal as deleted
files. A failed archive clears the flag and triggers a fresh read.

When the archive finishes, the client moves you away only if you're still on that task. You may have
opened another task during the teardown. With nothing left to show, you land on the default browse
view at the archived task's project. The rail keeps its workspace scope while the task list refreshes,
including when the task used the project folder instead of a worktree.

## What archive keeps

Archive removes the worktree folder, stops terminal sessions and agent provider processes, drops the
terminal plugin's saved sessions, and clears client memory. It keeps the task row, its links and pull
requests, its branch, its agent sessions, its notes, and every plugin's rows. Plugins store `task_id`
as a plain ID, and none of them deletes on archive.

Three things delete later or elsewhere:

- [Deleting a task](#deleting-a-task) removes it and every plugin's rows for it.
- If you set **Keep agent history for archived tasks**, a task archived longer than that loses its
  agent transcripts. Its sessions still list, with a note
  ([retention](../data-layer/backup-and-retention.md)).
- Deleting a project deletes its task rows. Plugin rows are left pointing at nothing, so those tasks
  can't be restored.

## Browse archived tasks

The **Archive** entry at the bottom of the rail lists archived tasks, newest first, with a search box
over every [search provider](../plugins/search-providers.md#search-providers).
Selecting a task previews it read-only in the ordinary pane host, without adding it to the rail.
Each row offers compact **Restore task** and **Delete task** icons with tooltips, leaving room for
the task title.

Only panes that declare `readsArchived` appear in the preview. The agents and notes panes opt in.
Every other pane would need the worktree or would start work on an archived task
([pane contributions](../panes/contributions.md)). The agents pane shows the transcripts and turns
its composer off. The list uses the shared browse sidebar, which resizes and collapses to task icons
and remembers its state on the device.

## Restoring a task

Restore is `POST /v1/core/tasks/:id/restore`. It answers 409 when the task was deleted, or restored by
another request, while it checked the branch. It sets the task active and rebuilds the worktree
before it answers, through the same `resolveTaskCwd` a pane would use, so the copied files and setup
run again. It rebuilds right away because both ways it can fail need you:

- **The branch is checked out in another worktree.** Git refuses, the task stays archived, and the
  reason comes back.
- **A local task's branch is gone,** often because a merged pull request deleted it. Restore answers
  `branchMissing`, and the client asks before it retries with `newBranch`. A new branch from the
  project checkout would hold none of the task's commits. A pull request task fetches its head again,
  so it can't lose its branch this way.

Containers, terminal sessions, and scrollback don't come back. Agent sessions do: the list counts a
session under an archived task as retired, so it returns with its task. Its provider process stopped
at archive, and the next prompt starts it and resumes the conversation. A session you archived on its
own comes back from Agent Center ([client surfaces](../managed-agents/client-surfaces.md)).

## Deleting a task

Delete removes a task, its subtasks, and every plugin's data for them. It can't be undone. The git
branch stays, because a local branch can hold commits that exist nowhere else. Remove it from the Git
client or a terminal.

You delete from two places:

- **The archive dialog.** The confirm button is a split button. Its menu offers **Archive task** and
  **Delete task**. Choosing **Delete task** relabels the button, gives it the danger tone, and shows a
  warning. Plugin concerns and cleanups work as they do for archive. `WillConfirmationHost` takes a
  list of actions, and `WillDecision.action` says which one you chose.
- **The Archive page.** Each row and the preview have **Delete**, which opens the same dialog with
  **Delete task** as the only action.

Delete is `POST /v1/core/tasks/:id/delete`. Unlike archive, it's device-only: a task-scoped agent
token can archive its own tree but never delete one. The Node runs these steps:

1. If any task in the tree is still active, archive the tree first with the options you chose. A
   refused archive stops the delete and answers with the archive's reason. Without the terminal
   plugin, the client archives with the status flip first and then deletes.
2. Claim every task in the tree with the archive gate and check that each is still archived. Another
   archive in progress, or a restore that got there first, answers 409.
3. In one core transaction, delete the `tasks`, `task_pulls`, `task_links`, and `task_script_attempts`
   rows, and the client preferences keyed by those task ids, and insert a row in `deleted_tasks` for
   each.
4. Broadcast the tasks change, run the `core:task-deleted` hook with the deleted ids, and answer
   `{ ok: true, taskIds }`.

Steps 2 and 3 await nothing, so a restore either writes before them and is refused, or finds the rows
gone and answers 409.

### Tombstones and plugin purges

`deleted_tasks` keeps one row per deleted task forever. `ctx.core.tasks.deleted()` returns the ids to
plugins, and `GET /v1/core/tasks/deleted` returns them to the client. A plugin must never infer
deletion from a task missing from `load` or `active`, because a transient empty answer would read as
every task gone.

Every plugin that stores task data calls `registerDeletedTaskPurge` from `@acorn/plugin-api/node` with
one idempotent purge function. The helper runs it from two places: the `core:task-deleted` hook, and a
daily `<plugin>:deleted-task-purge` schedule at 04:10 that hands it every tombstoned id. The schedule
catches up a plugin that was disabled, slow, or restarting when the hook ran.

| Plugin | What its purge deletes |
| --- | --- |
| agents | Sessions with their events, search rows, turns, requests, attachment references, and artifacts. Then the tasks' attachments, spawn rows, webhooks, and the deleted sessions' idempotency records. Files nothing else uses go too. A session with a provider process or a turn in flight waits for the daily run |
| browser | Captures |
| changes | Review notes |
| database | The task's scratch buffer. Saved queries belong to the project and stay |
| http | Ad-hoc requests. A request saved to the repo tree has no task id and stays |
| notes | The `notes/task/<taskId>/` folder |
| terminal | Saved session rows |
| workflows | Settled runs on the task, with their steps, turn admissions, dispatch rows, and agent launch receipts. A running or cancelling run waits for the daily run. Processing history stays, so a scheduled workflow doesn't process the same records again |

Provider-side sessions, such as a Claude Code session file, stay, for the reason the archived-history
prune leaves them ([retention](../data-layer/backup-and-retention.md#retention)). The database file
keeps its size until a `VACUUM`.

### References that outlive a task

Memory entries and the memory feed keep their rows, and the origin reads **Deleted task** without a
link. So does a workflow step whose child task was deleted. Notes promoted to the workspace keep their
`originTaskId`. Delegated child sessions and child tasks go with their parent. Notices left the bell
when the task was archived.

Deleting a project still deletes its task rows without tombstones, so plugin rows for those tasks stay
behind.
