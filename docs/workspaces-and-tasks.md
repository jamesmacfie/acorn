# Workspaces and tasks

Workspaces and tasks are core Node entities. A workspace groups repositories; a task is work on one
repository and branch.

## Workspace

A workspace has a name, sort order, icon/color identity, and repository membership. A repository
belongs to exactly one workspace. Repository filesystem/configuration data is stored separately in
`repo_paths` because it describes one repository, not the group.

The first-run bootstrap creates `Default` and assigns mirrored repositories that have not already
been assigned. Settings → Workspaces can regroup or hide repositories. Hidden repositories retain
their membership and can be restored.

## Task

A task contains:

- repository owner/name and branch;
- origin: `github-pr`, `linear`, `rollbar`, or `local`;
- optional worktree path and pull-request number;
- title/icon, rail sort, status, archive timestamp, and optional parent task;
- task layout and terminal/agent sessions stored by their owning features.

Tasks created from external items retain a `task_links` record tied to the exact provider connection.
This avoids collisions when two Linear or Rollbar connections expose the same visible identifier.

## Worktrees

Worktrees are created lazily when the editor, changes, terminal, preview, or agent execution first
requires filesystem access. The path is derived and revalidated by the Node; clients cannot choose an
arbitrary worktree path. Archive runs the configured teardown/cleanup flow where the desktop runtime
is available and reports partial failures instead of pretending removal succeeded.

## Repository configuration

`repo_paths` stores machine-local checkout paths, editor commands, setup/dev/restart/teardown/db
scripts, run targets, preview configuration, browser rules, and branch prefixes. A committed
`.acorn/config.toml` takes precedence where configured. Executable content is hash-gated by
`config_acks`; a changed snapshot must be reviewed before a task or workflow executes it.

The setup/dev/teardown/database/preview values are repository-level because a workspace can contain
multiple repositories with different build systems.

## Task creation and navigation

The rail creates local tasks with a slugged branch, applying a repository branch prefix when present.
An explicitly entered branch is preserved. PR, Linear, and Rollbar promotions reuse an existing task
when its provider link identifies the same work; otherwise they create one.

The desktop stores task ordering, layout, last pane/source, and drafts per Node. `⌘1`–`⌘9` activates
the corresponding visible task. A task can be archived without deleting its historical row.
