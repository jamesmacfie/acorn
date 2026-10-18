---
title: Task scripts
description: Run a setup script in each new worktree and a teardown script before it's removed, and read what they did.
sources:
  - docs/workspaces-and-tasks/task-scripts.md
  - docs/workspaces-and-tasks/worktrees.md
  - docs/workspaces-and-tasks/archive.md
  - docs/cli.md
  - packages/node-core/src/server/projects/runConfig.ts
  - packages/client-core/src/features/settings/ProjectConfigTabs.tsx
  - packages/client-core/src/features/tasks/taskScripts.ts
  - apps/desktop/src/client/TaskView.tsx
checked: '1d9bd200d'
---

This page covers a project's setup and teardown scripts: what they're for, where you set them, how to
read their output, and what happens when one fails. Set them up when a fresh worktree needs work
before it's useful, such as installing dependencies.

## What the scripts do

- The **setup script** runs once in each new task worktree, so the task starts ready to work, for
  example with `pnpm install`.
- The **teardown script** runs in the worktree when you archive the task, before acorn removes it, for
  example to stop a database or remove a container.

Both run in the task's worktree. A task that works in the project folder has no worktree, so neither
runs for it.

## Set the scripts

1. Open **Settings** > **Overview**, and click the project.
2. Open the **Setup and scripts** tab.
3. Type a command into **Setup script**, and choose **When to run it**:
   - **When the terminal first opens**, the default.
   - **When the task is created**.
   - **Never**. You can still run it by hand.
4. Type a command into **Teardown script**.

These two scripts are machine settings. A repository's `.acorn/config.toml` can't set them. A
`[scripts]` table there is ignored with a warning, so a repository you clone can't run a setup script
you didn't write.

To skip setup for one task, tick **Skip setup script** when you create it. The task remembers, so setup
stays skipped when the worktree is made later or the task is restored.

## Read the output

The setup script runs as a terminal session titled **Setup**, in the task's terminal drawer, so you can
watch it. While it runs, the task's rail tab shows a pulsing dot under its icon.

Each run is recorded on the Node, with up to the last 64 KiB of its output. acorn removes its own
tokens from the output before it stores it, but a script can still print a secret of its own, so don't
print one. The record says whether the script is **starting**, **running**, **succeeded**, **failed**,
**skipped**, or **interrupted**, and why, such as `exit 1` or `not configured`.

To read a record from a shell or a script:

```sh
acorn task scripts status TASK_ID
acorn task scripts logs TASK_ID --phase setup --tail 100
acorn task scripts wait TASK_ID --phase setup --timeout 5m
```

Agents read the same records with their own tools, so an agent can wait for setup before it runs your
tests.

## When a script fails

**Setup.** The task stays usable, and the record says **failed**, with the exit code. Fix the script,
then run **Run setup script** from the command palette on the task. The command appears when the
project has a setup script and the last attempt failed, was interrupted, or was skipped. It doesn't
appear before the worktree exists, while setup runs, or after it succeeds.

**Teardown.** The archive stops, and the task stays active with its worktree. The task shows the
error, and **Archive anyway (skip teardown)** archives it without running the script again.

If the Node stops while a script runs, the record says **interrupted**. A restart never runs a script
again on its own.

## In the terminal

The terminal client shows both scripts' state on a line above the open pane, such as **Setup skipped
(not configured) · Teardown not started**. It has no terminal drawer. Press `t` for the task's
terminal sessions.

## Limits

- Only the last 64 KiB of each run's output is kept.
- **Archive anyway (skip teardown)** doesn't run the script, so anything it would have stopped keeps
  running.
- The repository can't set these scripts. Each machine that runs a Node sets its own.
