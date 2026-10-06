# Archive and restore

Archiving a task removes its worktree and stops what was running in it, and keeps everything else.
This page covers the archive dialog, the order the Node tears a task down in, and how restore puts
it back. `archiveTask` and `restoreTask` in `packages/node-core/src/server/storage/archive.ts` own
both.

## Archive a task

Archive opens a confirmation dialog with the task title above the confirmation text. The dialog asks
every plugin what it has to say about the task, such as running containers, uncommitted files, or
live sessions, and offers each cleanup the plugin declared. With nothing to report, the dialog still
appears as the explicit barrier. A plugin reaches that dialog only through a
[task check](../plugins/task-checks.md#task-checks). A cleanup that fails names
its plugin, and the task is archived anyway.

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
6. Remove the worktree. `removeWorktree` refuses a dirty tree unless forced. A folder that git no
   longer tracks, because its `.git` link is gone, can't go through `git worktree remove`. The Node
   prunes git's record instead and, when forced, deletes the folder if it sits inside the worktrees
   folder. A folder outside it stays on disk.
7. Drop the terminal plugin's saved sessions, and mark the task archived.

The teardown, the stops, and the cleanups sit before removal, so anything that needs the worktree
still has it, and nothing is writing into it when it goes.

The teardown takes seconds. While it runs, the task's close button and its rail row both spin. One
flag in `packages/client-core/src/features/tasks/archiveLifecycle.ts` holds that state until the
archive finishes or fails. On the rail row, teardown is the highest-priority marker
([status markers](../ui-design/shell-hierarchy.md#status-markers)). Markers it outranks keep their
place in the row's tooltip.

The same flag pauses the changes pane's Git reads during the archive. The pane stays mounted, so it
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

Two things delete later or elsewhere:

- If you set **Keep agent history for archived tasks**, a task archived longer than that loses its
  agent transcripts. Its sessions still list, with a note
  ([retention](../data-layer/backup-and-retention.md)).
- Deleting a project deletes its task rows. Plugin rows are left pointing at nothing, so those tasks
  can't be restored.

## Browse archived tasks

The **Archive** entry at the bottom of the rail lists archived tasks, newest first, with a search box
over every [search provider](../plugins/search-providers.md#search-providers).
Selecting a task previews it read-only in the ordinary pane host, without adding it to the rail.

Only panes that declare `readsArchived` appear in the preview. The agents and notes panes opt in.
Every other pane would need the worktree or would start work on an archived task
([pane contributions](../panes/contributions.md)). The agents pane shows the transcripts and turns
its composer off. The list uses the shared browse sidebar, which resizes and collapses to task icons
and remembers its state on the device.

## Restoring a task

Restore is `POST /v1/core/tasks/:id/restore`. It sets the task active and rebuilds the worktree
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
