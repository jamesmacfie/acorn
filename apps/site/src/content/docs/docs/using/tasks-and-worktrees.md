---
title: Tasks and worktrees
description: Start a task from scratch or from GitHub, Linear, Rollbar, or Sentry, and how its Git worktree works.
sources:
  - docs/workspaces-and-tasks/task-creation.md
  - docs/workspaces-and-tasks/worktrees.md
  - docs/git-client/worktrees.md
  - docs/data-layer/data-root.md
  - docs/frontend/acorn-links.md
  - packages/client-core/src/features/integrations/PromoteToTaskModal.tsx
  - packages/client-core/src/host/chrome/ChromeSourcePanel.tsx
  - plugins/github/src/client/PullList.tsx
  - plugins/git/src/client/WorktreeBrowse.tsx
checked: '3c529e16d'
---

This page covers creating a task, from scratch or from a pull request or issue, how and where its Git
worktree is made, moving between tasks, and cleaning up worktrees. A task is one piece of work on one
project. [Concepts](/docs/start/concepts/) explains the model.

## Create a task

1. Click **+** at the bottom of the left rail, press ⌘⇧N, or run **New task** from the command palette.
2. Pick where the task works, with the tabs at the top of **New task**:
   - **New worktree** creates a branch and a worktree for it. This is the usual choice.
   - **Project folder** works in the project folder itself, on whatever branch it has checked out.
   - **Existing worktree** takes over a Git worktree that already exists and that no task uses. Its
     setup script doesn't run.
3. Choose the **Project**, and type a **Title**.
4. Optionally, open **Advanced**. **Branch name** starts as a name made from the title, and **Branch
   from** starts on the branch checked out in the project folder. Uncommitted changes in that folder
   don't carry over.
5. Tick **Skip setup script** if you don't want the project's setup script to run for this task.
6. Click **Create task**.

The task opens, and it's added to the left rail. If the branch name is taken, acorn adds `-2`, `-3`,
and so on, and shows the name it will use before you create the task. A name you typed yourself shows
an error instead.

A project that isn't a Git checkout has no branch options. Its tasks work in the project folder.

## Create a task from a pull request or an issue

A task can start from something you already track, and it stays linked to it:

- **GitHub.** In the GitHub source's list of pull requests, right-click a pull request and choose
  **Create task**, or click **Create task** in the pull request's pane. The task checks out the pull
  request's branch. If a task already has that pull request, the menu offers **Open task** instead.
- **Linear, Rollbar, and Sentry.** In the source's list, right-click an issue or an item and choose
  **Create task…**. A dialog offers **New task**, with a **Title**, a **Branch**, and **Skip setup
  script**, or **Attach to task**, which links the item to a task you already have.

A Linear or Rollbar source shows in the rail only when the workspace follows one of that service's
projects. You link them on the connection's page under **Settings** > **Services**. A Sentry issue
offers a task only through a connection made there, not one read from the environment variables.

## When the worktree is made, and where

A task with a branch doesn't get its worktree when you create it. acorn makes the worktree the first
time something needs the files: the editor, the Git pane, a terminal, the preview, or an agent. A task
you only look at costs nothing on disk.

The worktree is a folder in the Node's data under `worktrees/`, named after the repository and the
branch. You can't choose the path. To find it, click the copy icon beside **Worktree** in the strip at
the bottom of the task.

When the worktree is new, acorn:

1. Copies any files a `.acorn/config.toml` lists under `copy`, such as `.env.local`. A
   file that's missing is skipped with a warning.
2. Runs the project's setup script, unless you skipped it. [Task scripts](/docs/using/task-scripts/)
   covers it.

If the branch is already checked out somewhere else, in the project folder or another worktree, Git
refuses, and acorn tells you which path holds it. Check out another branch there, then open the task
again.

If you switch branches inside a task's worktree, acorn follows: the task takes the branch you checked
out.

## Switch between tasks

- Click a task in the left rail.
- Press ⌘1 to ⌘9 to open the first nine tasks in the rail.
- In the command palette, open **Go to**, choose the task search, and type part of a title.
- Open a link to it. Right-click a task in the rail and choose **Copy link**, or run **Copy link** from
  the palette. [Links into acorn](/docs/using/links-into-acorn/) covers what a link can name.

Tasks that a workflow created sit folded under the task that started them.

## Clean up worktrees

Archiving a task removes its worktree. [Archive and restore](/docs/using/archive-and-restore/) covers
it. To see every worktree a repository has, including ones acorn didn't make:

1. Click **Git** in the left rail, then the **Worktrees** tab.
2. Select a worktree. The detail lists its branch, its last commit, its changed files, and the task
   that owns it, with **Open task**.
3. For a worktree no task owns, click **Remove worktree**, then confirm. For registrations whose folder
   is gone, click **Prune missing registrations**.

acorn won't remove the main checkout, a locked worktree, a worktree with uncommitted changes, or one a
task owns. Archive the owning task instead. A worktree no task owns offers **Attach to task**, which
starts a task in it.

## In the terminal

Run **New task** from the palette with <kbd>Ctrl</kbd> <kbd>K</kbd>. The form asks for a title, offers
**Use the project folder and its current branch** and a custom branch, and creates the task. Open
tasks from the **Tasks** panel or with **Go to task** in the palette. The **Worktrees** tab works the
same way, inside the Git source.

## Limits

- A worktree's path is fixed by acorn. You can't move it or choose where it goes.
- A branch can be checked out in only one place, so two tasks can't share a branch.
- A remote-only branch can't be a task's base. Fetch it to a local branch first.
- Creating a task from a pull request or an issue needs that service connected.
