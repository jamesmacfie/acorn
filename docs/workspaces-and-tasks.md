# Workspaces and tasks

Workspaces, projects, and tasks are core Node entities. Read this page for the data model and to
find the topic page that owns worktrees, archive, task creation, project configuration, and task
script results.

## Workspace and project

A workspace groups projects. It has a name and a sort order, and no icon or color, because the
workspace switcher is navigation, not repository identity. The node publishes
`workspace:changed { workspaceId }` after a create, a rename, or a delete.

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

<a id="worktrees-and-setup"></a>
<a id="worktree-status-reads"></a>

[Worktrees and setup](./workspaces-and-tasks/worktrees.md) covers how the Node creates, names, and
revalidates a worktree, the setup script, copied files, and the coalesced `git status` reads behind
the rail markers.

<a id="restoring-a-task"></a>

[Archive and restore](./workspaces-and-tasks/archive.md) covers the archive dialog, the teardown
order, what archive keeps, and how restore rebuilds the worktree.

<a id="task-creation-and-navigation"></a>

[Task creation and navigation](./workspaces-and-tasks/task-creation.md) covers the **New task**
dialog, branch naming, child tasks made by workflows and delegation, and how the rails group them.

[Project configuration](./workspaces-and-tasks/project-config.md) covers the settings on the
project row, the `.acorn/config.toml` layers, run targets, and layout recipes.

<a id="durable-task-script-results"></a>
<a id="retention-and-recovery"></a>

[Task script results](./workspaces-and-tasks/task-scripts.md) covers the durable setup and
teardown attempts that the CLI, MCP tools, desktop, and terminal client read.
