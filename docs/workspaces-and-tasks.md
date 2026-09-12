# Workspaces and tasks

Workspaces and tasks are core Node entities. A workspace groups local projects; a project is the
machine-scoped identity for one folder or one known remote repository.

## Workspace and project

A workspace has a name and sort order. It deliberately carries no icon or colour: the workspace
switcher is structural navigation, not repository identity. A project belongs to exactly one
workspace and has a stable opaque ID, display name, optional folder path, optional colour, and
optional Git/GitHub facets. A project may be a plain folder or a Git checkout. Facets are cached
observations and may be refreshed; the project ID is the application identity.

The project colour is an optional machine-local accent edited in Settings → Projects. Every task for
that project draws it as the strip down the left of its left-rail tab. Clearing the colour removes the
project strip; an active tab still uses the application theme's normal active accent.

`path` is nullable and the model tolerates a path-null project, but nothing creates one. The GitHub
importer's "defer" action was the only producer, and it is gone. Rows that predate that stay readable
and are repaired by giving them a folder in Settings → Projects.

The `Default` workspace is created lazily by the first project, not at boot: both `createProject` and
`createProjectRef` fall back to it when no workspace is named. The owner adds folders from Settings →
Projects or imports repositories explicitly through the GitHub plugin. Moving or hiding a project
changes only its core row; deleting a project never deletes its folder.

Settings → Projects lists projects grouped under their workspace rather than giving every row a
workspace dropdown in isolation. The grouping is what is being edited, so it is the layout. The card
owns the column tracks, and its header and rows subgrid into them, so names, selects, and buttons
share one set of columns. Workspace and project names are edited in place. A row's workspace menu
moves it, and the menu's last option creates the workspace being moved to. A workspace can be deleted
from its own header, except the default, which is where an orphaned workspace's projects land. A
project whose workspace has vanished appears under `Unassigned` so it can always be rescued.

Deleting a project takes its tasks and task links with it, because `tasks.project_id` has no foreign
key and rows left behind are invisible in every rail and impossible to remove. The confirmation names
the task count first. Nothing on disk is touched: the folder and any task worktrees remain.

A node with zero projects opens the first-run wizard (`plugins/onboarding`) instead: welcome, add
projects by folder or GitHub, name them and their workspace, done. Its gate is `shouldShowOnboarding`,
meaning zero projects and no `onboarded` preference, and both finishing and skipping write that
preference, so it never opens twice. Everything it offers is also in Settings → Projects.

Opening is a one-way door (`onboardingVisible`). "No projects yet" is the right trigger and the wrong
latch, because the wizard's own first step creates a project: re-evaluating the trigger every render
unmounted the wizard mid-flow and dropped the owner into the app on the project they had just added.
Once open it stays open until it closes itself.

The GitHub step is a batch, not a single choice. An account has many repositories and taking several
is the normal case, so importing does not leave the screen. The list stays put with a running tally
of what has been added, and the owner presses **Done adding** when finished. The naming step covers
the whole batch: a name field per project, and a workspace picker per project whose last option
creates a new workspace. One run can spread its projects across several new workspaces, each
appearing in the next row's list as soon as it exists.

The batch is whatever the adding reported, never inferred. `ProjectImporterProps.onImported` carries
the project ids it produced, because an import may repair a path-less project rather than create one.
Diffing the project list against a snapshot taken on entry drops exactly those, and shows only the
last repository of several.

Provider projects from Linear and Rollbar are separate external references in
`workspace_external_projects`, keyed by the exact integration connection. They do not become local
projects and do not change project identity.

A link may name one project in the workspace instead of the whole of it. That is what lets two
repositories in one workspace show different Linear issues or different Rollbar errors: the routed
project names the workspace, then keeps the links that either name it or name no project at all.

The map is edited in Settings → Integrations, under the connection itself, and that surface is the
host's for every provider rather than any one plugin's. Under the connection because one Linear or
Rollbar connection usually serves every workspace on the machine, so its whole map reads better in one
place than a checkbox list repeated on every workspace page. The host's because of ownership: the
table is core's, the routes are core's (`PUT /v2/core/integrations/:id/mappings` replaces every row
one connection owns; `PUT /v2/core/workspaces/:id/external-projects` is the same table from the
workspace's side), and a plugin cannot write it at all — both are permanently unmappable on the frame
bridge, and `CoreServices.projects` exposes a provider-scoped read with no write. When the only writer
lived inside the Linear plugin's browse pane, deleting that pane made the mapping unwritable and left
every integration silently unscoped.

The providers decide which of them appear, not the map. A provider declares a `projects` source
on its contribution, and one that declares none is absent rather than present and empty
([integrations.md](./integrations.md)). A link is added and removed one at a time against the rows the
server holds, so a connection whose list fails to load still shows its links, by external id.

A rail scoped to nothing mapped is not always empty: Rollbar, which has no linked-project concept,
reads every connection unscoped. Linear, which does have one, declares its own `emptyState` for "no
followed projects" instead of falling back to any issues ([integrations.md § Linear](./integrations.md)).

## Task

A task contains:

- One required `projectId`.
- An optional branch and optional worktree path.
- An origin: `github-pr`, `linear`, `rollbar`, or `local`.
- Optional primary pull-request number, title and icon, rail sort, status, archive timestamp, and parent task.
- Task links to external items, and feature-owned terminal, agent, and pane state.
- Zero or more durable `task_pulls` relations for PRs Acorn created in the task. The scalar primary
  still owns worktree, checks, and task-context behavior; related PRs are review-only neighbours.

A task can be branchless: a null branch runs in the project root. A branch creates an isolated Git
worktree lazily, when the first filesystem-dependent surface needs one. The project row, not a copied
owner and name pair, is the source of task identity.

Tasks created from external items retain a `task_links` record tied to the exact provider connection.
This avoids collisions when two Linear or Rollbar connections expose the same visible identifier.

## Worktrees and setup

Worktrees are created lazily for editor, changes, terminal, preview, or agent execution. The Node
derives and revalidates the path; clients cannot choose an arbitrary worktree path. A task with no
branch uses the mapped project folder directly.

The directory is keyed by owner, repo, and branch, so revalidation checks the branch as well as the
path. Before a resolved worktree is handed out, persisted or reused, its on-disk HEAD must still be
the task's branch. A directory that was pruned, moved, or checked out onto something else is refused
with a `worktree-stale` 409, and a worktree that cannot be created is refused with
`worktree-unavailable` rather than falling back to the main checkout. Either fallback hands the task
another branch's files, which is the tree its agent then reads and edits.

A new task branch starts from the branch checked out in the mapped project folder. Acorn runs
`git worktree add -b` from that folder without an explicit start point, so Git uses the folder's
current `HEAD`. Remote-tracking refs such as `origin/main` do not take precedence over local commits.
If the task branch already exists, Acorn checks out that branch without changing its history.

A project's `.acorn/config.toml`, committed or personal, may list `copy` paths: repo-relative files,
usually gitignored (`.env.local` and similar), copied into a freshly created worktree so it works
without a setup script. Missing sources warn rather than fail worktree creation, existing targets
are never overwritten, and a repo's list wins over a personal one outright rather than merging with
it.

Archive runs the configured teardown flow where the desktop runtime is available and reports partial
failures instead of pretending removal succeeded. Its order is guard, repo teardown script, stop
sessions, plugin cleanups, remove worktree, mark archived. The two teardown steps sit before removal
so anything that needs the worktree still has it.

Before any of that, the confirmation dialog asks every plugin what it has to say about this task,
such as running containers, uncommitted files, or live sessions, and offers whatever cleanup each one
declared. That is a plugin contribution called a task check, and it is the only way anything reaches
that dialog ([plugins.md § Task checks](./plugins.md)). A cleanup that fails names its plugin, and
the task is archived anyway.

The teardown takes seconds, so while it runs the task's close button and its rail row both spin,
whichever of the two started the archive. One shared flag in `client-core/tasks/archiveLifecycle.ts`
holds it, cleared when the archive finishes or fails. On the rail row the teardown is the
highest-priority marker and it takes the slot under the task's glyph
([ui-design.md § Rail controls and status markers](./ui-design.md)). It no longer blanks the row's
other markers the way it used to: anything it outranks keeps its place in the hover tooltip, because a
marker that loses its corner should lose the pixels, never the state.

Project configuration lives on `projects`: setup/dev/restart/teardown/database/preview values,
run targets, browser rules, and branch prefix. A committed `.acorn/config.toml` can override these
machine-local values.

The `dev` run target layers in this order, each entry overriding the last: `workspaces.devScript`
and `devRestartScript` as a base target, then `projects.run_targets` (the per-project Settings
surface), then `~/.acorn/config.toml`, then the committed `./.acorn/config.toml`, which always
wins. The base `dev` target carries no URL and gets no `default` flag, so it never shadows a repo's
real default target. Executable committed configuration is hash-gated by `config_acks`; changing
the snapshot requires a new review before a task or workflow executes it.

A `[layout.<id>]` block in the same config seeds a task's pane layout: known panes open left to
right, unknown or duplicate pane ids are dropped, and a recipe naming no valid pane does nothing.
`terminal = "<run-target-id>"` auto-starts that target and opens the terminal drawer; `browser =
"run:<id>"` points the browser pane at that target's resolved URL once it is up.

## Task creation and navigation

The rail creates local tasks from a project and derives a branch from the title when the project is
Git-backed. An explicitly entered branch is preserved. Ticking "Use the project folder and its
current branch" creates the task with no branch, so it works in the project folder on whatever is
already checked out and never gets a worktree. PR, Linear, and Rollbar promotions resolve or
create the appropriate project and task link, then reuse an existing task when that exact link is
already present.

The desktop stores task ordering, layout, last pane/source, and drafts per Node. `⌘1`–`⌘9` activates
the corresponding visible task. A task can be archived without deleting its historical row.
