# Workspaces and tasks

Workspaces, projects, and tasks are core Node entities. Read this page for the data model and to
find the topic page that owns worktrees, archive, task creation, project configuration, and task
script results.

Core task records expose the inspected worktree path, whether it has changes, and modified and
untracked counts. Uninspected or unavailable worktrees retain null counts. Project-scoped
`core/local-branches` and `core/local-worktrees` data sources inspect local Git refs and the complete
worktree roster, including worktrees Acorn did not create and detached heads. Branch divergence uses
the last fetched upstream/default refs. Reads do not fetch; each record has an observation time.
On workspace panels, choose a local Git project through the source's Project scope option; a
project-scoped panel uses its project by default.

## Workspace and project

A workspace has a name, a sort order, and optional appearance metadata.
[Workspace icons](./workspaces-and-tasks/workspace-icons.md) covers glyph backgrounds, durable image
thumbnails, and the optional desktop rail. The Node publishes `workspace:changed { workspaceId }`
after a create, rename, appearance change, or delete.

The Node stores `core.workspaces` as `on` or `off`. While on, a workspace can group projects.
While off, each project owns one workspace with the same name. If the preference is unset,
the Node uses `on` when projects exist and `off` when none do. Project creation stores that
choice with the project. Settings can switch `off` to `on` after confirmation. This writes one
preference row without changing project or workspace rows. Each paired workspace becomes an ordinary
grouped workspace with the same ID, name, and data. The Node publishes `workspaces-mode:changed { mode }`
after commit, and desktop and terminal clients refetch that Node's preferences and update their wording.

Grouped workspaces can't switch back to separate projects. A workspace can hold several projects,
and its Home boards, notes, saved queries, workflow definitions, and Linear and Rollbar links have no
rule for which project would inherit them.

A project belongs to one workspace. It's a folder on the Node's machine, either a plain folder or a
Git checkout. The project row in `packages/node-core/src/server/db/schema.ts` holds a stable opaque
ID, a display name, an optional folder path, an optional color, and optional Git and GitHub facets.
The facets are cached observations that the Node refreshes. The project ID is the identity. Project
membership changes publish `project:changed`.

[Projects and workspaces](./workspaces-and-tasks/projects.md) covers registering, arranging, and
deleting projects, the first-run wizard, and the map from Linear and Rollbar projects to local
projects.

## Task

A task is the single-project unit of work, and each one is a rail row. A task holds these fields:

- One required `projectId`.
- An optional branch and an optional worktree path.
- An origin. It's a source ID the owning plugin declared, or `local` for a task core made itself.
  The source that tracks a task also names the pane it opens on first activation (`defaultPane`).
  A task no source claims lands on the layout reducer's default.
- An optional primary pull request number, title, and icon, plus rail sort, status, archive time,
  and parent task.
- Task links to external items, and feature-owned terminal, agent, and pane state.
- Zero or more `task_pulls` relations for pull requests acorn created in the task. The primary pull
  request owns worktree, checks, and task context behavior. Related pull requests are for review
  only.

A task with a null branch runs in the project folder. A task with a branch gets its own Git
worktree, created the first time a surface needs files. The project row, not a copied owner and
repository name, is the source of task identity.

A task made from an external item keeps a `task_links` row tied to the exact provider connection.
Two Linear or Rollbar connections can expose the same visible identifier, and the connection keeps
them apart.

## Pages

[Worktrees and setup](./workspaces-and-tasks/worktrees.md) covers how the Node creates, names, and
revalidates a worktree, the setup script, copied files, and the coalesced `git status` reads behind
the rail markers.

[Archive and restore](./workspaces-and-tasks/archive.md) covers the archive dialog, the teardown
order, what archive keeps, and how restore rebuilds the worktree.

[Task creation and navigation](./workspaces-and-tasks/task-creation.md) covers the **New task**
dialog, branch naming, child tasks made by workflows and delegation, and how the rails group them.

[Project configuration](./workspaces-and-tasks/project-config.md) covers the settings on the
project row, the `.acorn/config.toml` layers, run targets, and layout recipes.

[Task script results](./workspaces-and-tasks/task-scripts.md) covers the durable setup and
teardown attempts that the CLI, MCP tools, desktop, and terminal client read.
