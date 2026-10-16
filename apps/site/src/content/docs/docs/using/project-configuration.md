---
title: Project configuration
description: Configure a project from a .acorn/config.toml file in its repository, and trust a file that changed.
sources:
  - docs/workspaces-and-tasks/project-config.md
  - docs/workspaces-and-tasks/worktrees.md
  - docs/frontend/settings-groups.md
  - packages/node-core/src/server/projects/runConfig.ts
  - packages/client-core/src/features/settings/trust/ConfigTrustDialog.tsx
checked: 90ded85ca
---

This page covers `.acorn/config.toml`: what a repository can set for acorn, how it combines with the
project's settings and your own file, why its values are read-only in Settings, and what happens when
it changes. Use it to share run targets, a preview, and pane layouts with everyone who works on the
repository.

## What the file sets

Commit `.acorn/config.toml` at the root of the repository. It can set these:

```toml
# Files to copy into each new worktree, such as ones Git ignores.
copy = [".env.local"]

# A command acorn can run for a task, with a Run button in the pane switcher.
[scripts.run.dev]
command = "pnpm dev"
url = "http://localhost:5173"   # or url_command, a command that prints the URL
default = true

# The script that prints the task's database connection, for the Database pane.
[database]
url_script = "./scripts/db-url.sh"

# What the Preview pane opens: mode is "url", "port", or "script".
[preview]
mode = "port"
value = "5173"

# A layout: the panes to open, the run target to start, and the preview to point at it.
[layout.review]
panes = ["git", "agents"]
terminal = "dev"
browser = "run:dev"
```

A run target can also set `stop`, `restart`, and `icon`. A layout's `panes` open left to right, split
equally. Unknown pane names are dropped. Apply a layout to a task from **Apply a layout** in the
command palette's **Run** group.

The setup and teardown scripts aren't in this file. [Task scripts](/docs/using/task-scripts/) explains
why. [Configuration files](/docs/reference/configuration-files/#the-project-config-file) lists every key.

## Where a value comes from

A value comes from the first of these that sets it:

1. The repository's `.acorn/config.toml`, in the task's own checkout. A branch can change it.
2. Your own `~/.acorn/config.toml`, which applies to every project on this machine.
3. The project's page in **Settings**.

Run targets and layouts combine by name: a target in a later layer replaces one with the same name in
an earlier layer, and the rest are kept. The `copy` list comes whole from one layer and never combines.

## Why some settings are read-only

When the repository's file sets a value, the project's page in **Settings** shows it read-only, labeled
**From .acorn/config.toml**, with the file's value above this machine's own. The file wins, so a value
typed on the page would never be used. Change the file instead.

## Trust a changed file

A committed file can run code on your machine, through its run targets and its database script. So
before a task or a workflow runs anything the file set, acorn asks you to review it.

1. acorn opens **Review project configuration**, with the file's contents. If you've trusted it before,
   it shows what changed since, and says **These settings changed since you last trusted them.**
2. Read it. Click **Trust configuration**, or **Trust and run** when acorn was about to run something.
   **Not now** runs nothing.

acorn remembers what you trusted. The same file runs without asking again, and any change to it asks
again. Values from your own `~/.acorn/config.toml` or the project's page never need a review, because
you wrote them.

## In the terminal

The terminal client uses the same file and the same layers. Run targets and layouts are in its palette,
under **Run**.

## Limits

- The repository's file wins whether you've trusted it or not. Trust decides whether acorn runs it, not
  whether acorn reads it.
- A line acorn can't read, such as a run target with no `command`, is reported and skipped. The rest of
  the file still applies.
- The file can't set the setup or teardown scripts, or the web pages the browser extension suggests the
  project on.
