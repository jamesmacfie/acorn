---
title: Archive and restore
description: Put a finished task away, find it again, read it, and bring it back onto its branch.
sources:
  - docs/workspaces-and-tasks/archive.md
  - docs/plugins/task-checks.md
  - packages/client-core/src/features/tasks/restoreTask.ts
  - packages/client-core/src/features/tasks/confirmTaskArchive.ts
  - apps/desktop/src/client/TaskView.tsx
checked: 90ded85ca
---

This page covers archiving a task, what it cleans up and what it keeps, the checks plugins run first,
finding and reading an archived task, restoring it, and deleting it for good. Archive a task when its
work is merged or abandoned.

## Archive a task

1. Open the task, and click **Archive task**, the **×** at the bottom of the pane switcher.
2. Read the dialog. It names the task, and it lists anything a plugin wants you to know first, such as
   uncommitted files, running containers, or live agent sessions. A plugin can offer a cleanup there,
   with a box to tick, such as stopping the task's containers.
3. Click **Archive task**.

While acorn tears the task down, the **×** and the task's rail tab both spin. When it's done, the
window moves to the project's default view, unless you've already opened another task.

If the task has subtasks, the dialog says they'll be archived too.

## What archiving does

acorn runs these steps in order:

1. Runs the project's teardown script in the worktree. If it fails, the archive stops and the task stays
   active. [Task scripts](/docs/using/task-scripts/#when-a-script-fails) covers what to do.
2. Stops the task's terminal sessions and its agents' processes.
3. Runs the cleanups you ticked. A cleanup that fails names its plugin, and the archive carries on.
4. Removes the worktree folder.

Archiving keeps everything else: the task, its branch and commits, its pull request link, its agent
sessions and transcripts, its notes, and every plugin's data about it. Removing the worktree is quick
even for a big project, because acorn renames the folder first and deletes it afterward.

If you set **Keep agent history for archived tasks** in **Settings** > **Agents** > **Harnesses and
defaults**, transcripts of tasks archived for longer than that are deleted. The sessions still list.

## Find an archived task

1. Click **Archive** at the bottom of the left rail's sources. Archived tasks are listed newest first,
   each with its project and branch.
2. Type in **Search archived tasks**. The search covers titles, branches, and agent transcripts.
3. Select a task to read it.

The preview opens the task read-only in its usual panes, without adding it back to the rail. Only panes
that make sense without a worktree appear: the agent sessions, with their full transcripts and the
message box turned off, and the notes.

## Restore a task

Click **Restore task** on the row or in the preview. acorn sets the task active, makes its worktree
again on its branch, copies the project's files in, and runs setup again. The task opens.

Agent sessions come back with the task. The next message you send starts the agent again, and it
carries on the same conversation. Terminal sessions, their scrollback, and containers don't come back.

Two things can stop a restore:

- **The branch is checked out somewhere else.** The task stays archived, and acorn says where. Check
  out another branch there, then try again.
- **The branch is gone**, often because a merged pull request deleted it. acorn asks **Branch no
  longer exists**. **Restore on a new branch** cuts a new branch from the project's current checkout.
  The task's old commits won't be on it. A pull request task fetches its branch again instead.

## Delete a task

Deleting removes a task, its subtasks, and every plugin's data about them. It can't be undone.

- In the archive dialog, open the menu on the **Archive task** button and choose **Delete task**. The
  button turns red and says what you'll lose.
- On an archived task, click **Delete task** on its row or in its preview.

The Git branch stays, because it might hold commits nowhere else. Remove it from the Git pane or a
terminal. An agent can archive its own task, but only you can delete one.

## In the terminal

The terminal client can't archive, restore, or delete a task, and it has no Archive page. Use the
desktop app.

## Limits

- Archiving removes the worktree folder, so anything in it that isn't committed and pushed is gone.
  The dialog warns about uncommitted files first.
- Restoring rebuilds the worktree from the branch. Files the branch never had don't come back.
- Containers, terminal sessions, and scrollback don't come back with a restore.
- Deleting a project deletes its tasks, and those can't be restored.
