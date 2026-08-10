# Workspaces and tasks

Workspaces and tasks are core Node entities. A workspace groups local projects; a project is the
machine-scoped identity for one folder or one known remote repository.

## Workspace and project

A workspace has a name, sort order, icon, and colour. A project belongs to exactly one workspace and
has a stable opaque ID, display name, optional folder path, and optional Git/GitHub facets. A project
may be a plain folder or a Git checkout. Facets are cached observations and may be refreshed; the
project ID is the application identity.

`path` is nullable and the model still tolerates a path-null project, but nothing creates one any
more — the GitHub importer's "defer" action, which was the only producer, is gone. Existing rows stay
readable and are repaired by giving them a folder in Settings → Projects.

The `Default` workspace is created lazily by the first project, not at boot: both `createProject` and
`createProjectRef` fall back to it when no workspace is named. The owner adds folders from Settings →
Projects or imports repositories explicitly through the GitHub plugin. Moving or hiding a project
changes only its core row; deleting a project never deletes its folder.

Settings → Projects lists projects **grouped under their workspace** rather than giving every row a
workspace dropdown in isolation: the grouping is what is being edited, so it is the layout. The card
owns the column tracks and its header and rows subgrid into them, so names, selects and buttons share
one set of columns. Workspace and project names are edited in place; a row's workspace menu moves it,
and its last option creates the workspace being moved to; a workspace can be deleted from its own
header (except the default, which is where an orphaned workspace's projects land); and a project whose
workspace has vanished appears under `Unassigned` so it can always be rescued.

Deleting a project takes its tasks and task links with it — `tasks.project_id` has no foreign key, so
rows left behind are invisible in every rail and impossible to remove. The confirmation names the task
count before it happens. Nothing on disk is touched: the folder and any task worktrees remain.

A node with zero projects opens the first-run wizard (`plugins/onboarding`) instead: welcome, add
projects by folder or GitHub, name them and their workspace, done. Its gate is `shouldShowOnboarding` —
zero projects and no `onboarded` preference — and both finishing and skipping write that preference, so
it never opens twice. Everything it offers is also in Settings → Projects.

Opening is a one-way door (`onboardingVisible`). "No projects yet" is the right trigger and the wrong
latch, because the wizard's own first step creates a project: re-evaluating the trigger every render
unmounted the wizard mid-flow and dropped the owner into the app on the project they had just added.
Once open it stays open until it closes itself.

The GitHub step is a batch, not a single choice: an account has many repositories and taking several is
the normal case, so importing does not leave the screen. The list stays put with a running tally of what
has been added, and the owner presses Done adding when finished. The naming step then covers the whole
batch: a name field per project, and a workspace picker per project whose last option creates a new
workspace — so one run can spread its projects across several new workspaces, each one appearing in the
next row's list as soon as it exists.

The batch is whatever the adding reported, never inferred. `ProjectImporterProps.onImported` carries the
project ids it produced, because an import may REPAIR an existing path-less project rather than create
one; an earlier version diffed the project list against a snapshot taken on entry and silently dropped
exactly those, showing only the last repository of several.

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
