# Workspaces and tasks

Workspaces and tasks are core Node entities. A workspace groups local projects; a project is the
machine-scoped identity for one folder or one known remote repository.

## Workspace and project

A workspace has a name, sort order, icon, and colour. A project belongs to exactly one workspace and
has a stable opaque ID, display name, optional folder path, and optional Git/GitHub facets. A project
may be a plain folder, a Git checkout, or a GitHub candidate that has not been cloned yet. Facets are
cached observations and may be refreshed; the project ID is the application identity.

The first-run bootstrap creates `Default`. The owner adds folders from Settings → Projects or imports
GitHub candidates explicitly through the GitHub plugin. Moving or hiding a project changes only its
core row; deleting a project never deletes its folder.

Provider projects from Linear and Rollbar are separate external references in
`workspace_external_projects`, keyed by the exact integration connection. They do not become local
projects and do not change project identity.

## Task

A task contains:

- one required `projectId`;
- an optional branch and optional worktree path;
- origin: `github-pr`, `linear`, `rollbar`, or `local`;
- optional pull-request number, title/icon, rail sort, status, archive timestamp, and parent task;
- task links to external items and feature-owned terminal/agent/pane state.

Tasks are intentionally branchless-capable: a null branch runs in the project root. A branch creates
an isolated Git worktree lazily when the first filesystem-dependent surface needs one. The project
row, not a copied owner/name pair, is the source of task identity.

Tasks created from external items retain a `task_links` record tied to the exact provider connection.
This avoids collisions when two Linear or Rollbar connections expose the same visible identifier.

## Worktrees and setup

Worktrees are created lazily for editor, changes, terminal, preview, or agent execution. The Node
derives and revalidates the path; clients cannot choose an arbitrary worktree path. A task with no
branch uses the mapped project folder directly. Archive runs the configured teardown flow where the
desktop runtime is available and reports partial failures instead of pretending removal succeeded.

Project configuration lives on `projects`: setup/dev/restart/teardown/database/preview values,
run targets, browser rules, and branch prefix. A committed `.acorn/config.toml` can override these
machine-local values. Executable committed configuration is hash-gated by `config_acks`; changing
the snapshot requires a new review before a task or workflow executes it.

## Task creation and navigation

The rail creates local tasks from a project and derives a branch from the title when the project is
Git-backed. An explicitly entered branch is preserved. PR, Linear, and Rollbar promotions resolve or
create the appropriate project and task link, then reuse an existing task when that exact link is
already present.

The desktop stores task ordering, layout, last pane/source, and drafts per Node. `⌘1`–`⌘9` activates
the corresponding visible task. A task can be archived without deleting its historical row.
