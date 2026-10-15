---
title: Files, processes, and project configuration
description: How acorn keeps file access inside a task, starts processes, decides when a repository's own configuration may run, and guards a force push.
sources:
  - docs/security/process-and-paths.md
  - docs/security/instruction-review.md
  - docs/security/credentials.md
  - plugins/git/src/server/changes/localDiff.ts
  - plugins/git/src/client/changes/RemoteBar.tsx
checked: 52225e24f
---

This page covers four controls on what the Node does with your files and your shell: keeping file
access inside a task, the one way it starts processes, the trust check on a repository's own
configuration and workflows, and the guard on force pushes. Read it before you open a repository you
didn't write.

## Paths stay inside the task

When acorn reads or writes a file for you, in the Editor or the **Changes** tab, the Node resolves the
path and checks it lands inside the task's worktree or acorn's data folder. It follows symbolic links
before it checks, so a link a branch added that points at `~/.ssh` is refused. A link it can't resolve
is refused too.

The Editor checks again right before it saves, and refuses to save over a file that changed since you
opened it. Deleting from the file tree moves the file to the system Trash, on macOS and Linux. No acorn action
deletes a file for good.

acorn's tools for agents never read or write files at all. An agent edits files with its harness's own
tools, which these checks don't cover.

## How acorn starts processes

acorn starts short commands, such as a Git call, a setup script, or a Docker command, through one
process broker on the Node:

- It runs each command in an explicit folder.
- It builds the environment from a list of allowed variables, so a command never inherits acorn's keys
  or your GitHub token. A caller that needs more names it, such as Docker's own variables.
- It caps how much output it keeps, and how long the command may run.
- On a stop or a timeout, it ends the whole process group, so no child is left holding the command open.

Long-running processes, such as terminals and agent CLIs, follow the same environment rules. A test
lists every file in acorn allowed to start a process, with its reason.

## A repository's configuration

A repository can carry its own settings in `.acorn/config.toml` and its own workflows in
`.acorn/workflows/`. Both can hold commands. A branch you check out can change them, so acorn runs them
only after you've trusted the exact file:

- A run target from the file, such as a dev server.
- The file's script that prints the database connection.
- A workflow defined in the repository.

The first time, and whenever the file changes, acorn opens **Review project configuration** with the
file's contents and what changed ([Project configuration](/docs/using/project-configuration/#trust-a-changed-file)).
Trust is bound to a hash of the exact bytes, so a change in any byte asks again, and so does a file that
changed back after you trusted another version.

The hash also covers the project's own script settings, which only a paired device can change. A write
you didn't make shows the script for review instead of running it.

Setup and teardown scripts you typed into the project's settings run without asking, because you
wrote them. acorn ignores `[scripts] setup` and `[scripts] archive` in a repository's file, so a
committed file can't run a command when a worktree is created or archived.

A workflow you write in the app has no file to hash, so only a paired device can create or start one.
An agent can start a workflow only one you approved for agents, for that exact version, with the
**Execute tools** tier on.

## Instruction files

Files such as `CLAUDE.md` and `AGENTS.md` aren't commands, but an agent follows them. acorn can check
them for hidden characters, and ask you to approve them before each change reaches an agent
([Permissions and approvals](/docs/agents/permissions-and-approvals/#check-instruction-files)).

## The force push guard

**Force push**, in the **Changes** tab's **Remote actions** menu, uses `git push --force-with-lease`, never a bare `--force`. Git
then checks that the remote branch is where this Node last saw it, so a commit someone else pushed
since your last fetch fails the push instead of disappearing. The first press turns the item into
**Force push?**, and the second sends it. A plugin can refuse a force push alone, through the same check that runs before every push.

## Limits

- The path check happens before the file is opened. A process that swaps part of the path for a link
  in between can slip past it. That window is narrow, and an agent working in its own worktree is the
  case it leaves open.
- These checks bound what acorn does. An agent's own shell commands run as you and aren't confined to
  the worktree, unless you keep Claude Code out of the data folder
  ([What acorn doesn't protect against](/docs/security/what-acorn-doesnt-protect-against/)).
- A config file over 1 MiB, or a snapshot of more than 256 files, isn't run. acorn reports an error
  instead.
- The `[docker]` table in the file is read without the trust check, because it only names which
  containers belong to a task.
