# Projects and workspaces

This page covers how projects get onto a Node, how you arrange them into workspaces, and how
provider projects from Linear and Rollbar map onto them. The data model is in
[workspaces and tasks](../workspaces-and-tasks.md).

## Add a project

You add folders from Settings → Projects, import repositories through the GitHub plugin, or add them
in the first-run wizard. When the active Node is local and the host has a folder picker,
**Add project…** at the foot of the topbar's workspace switcher and **Add project** in the palette
pick a folder and add it to the active workspace (`addProjectFromFolder`). The topbar reaches it
through the `addProject` verb, gated by `canAddProject`, so a replacement topbar can offer the same
thing. If the folder belongs to a project in another workspace, the action names that workspace
and directs you to Settings → Overview to move it. Changing Nodes while the picker is open cancels
the add. The `Default` workspace doesn't exist until the first project needs it:
`createProject` and `createProjectRef` fall back to it when no workspace is named.

The CLI registers a local folder only with an explicit workspace and an absolute path on the Node's
machine. Core compares the resolved path with registered project paths, so a symlink or `..` alias
reuses the project ID it finds. The row keeps the path as first registered.
[Command-line client](../cli.md) has the commands.

`path` is nullable, and the model reads a project with no path, but nothing creates one. Give an old
path-less row a folder in Settings → Overview to repair it.

## Arrange projects

Settings → Overview is one table of projects grouped under their workspaces. Select rows to open a
bar that moves them to a workspace, hides or shows them, or sets their color. The last workspace
option creates a workspace. A row opens its project's settings page, which holds the name, folder,
color, workspace, visibility, and [project configuration](./project-config.md).

A workspace's own page renames and deletes it. The default workspace can't be renamed or deleted,
because a deleted workspace's projects move there. A project whose workspace has vanished shows under
`Unassigned`, so you can rescue it. [Frontend](../frontend/settings-groups.md) § Workspaces and
projects has the pages.

The project color is a machine-local accent. Every task in that project draws it as the strip down
the left of its rail tab. With no color there's no strip, and an active tab uses the theme's accent.

## Delete a project

Deleting a project deletes its tasks and task links, because `tasks.project_id` has no foreign key,
and leftover rows would be invisible in every rail and impossible to remove. The confirmation names
the task count first. acorn doesn't touch the disk: the folder and any task worktrees stay. Moving or
hiding a project changes only its core row.

## The first-run wizard

A Node with no projects opens the first-run wizard in `plugins/onboarding`. Its steps are welcome,
add projects by folder or from GitHub, name them and pick their workspaces, pick a model for text
generation, and done. Everything it offers is also in Settings → Overview.

`shouldShowOnboarding` opens it when there are no projects and no `onboarded` preference. Finishing
and skipping both write the preference, so the wizard opens once. Once open, `onboardingVisible`
keeps it open until it closes itself. The wizard's first step creates a project, so re-checking "no
projects yet" on every render would unmount it mid-flow.

The GitHub step takes a batch. The repository list stays put with a running tally of what you added,
until you press **Done adding**. The naming step then shows a name field and a workspace picker for
each project. The picker's last option creates a workspace, and a workspace you create appears in the
next row's list.

The batch is the list of project IDs that `ProjectImporterProps.onImported` reports. An import can
repair a path-less project instead of creating one, so diffing the project list would miss it.

## External projects

Linear and Rollbar projects are external references in `workspace_external_projects`, keyed by the
exact integration connection. They don't become local projects and don't change project identity.

A link names a workspace, and can also name one project in it. That lets two repositories in one
workspace show different Linear issues or different Rollbar errors. The routed project keeps the
links that name it or name no project.

You edit the map in Settings → Services, on the connection's own page. One connection usually serves
every workspace on the machine, so its whole map reads better in one place. Core owns the table and
both routes:

- `PUT /v1/core/integrations/:id/mappings` replaces every row one connection owns.
- `PUT /v1/core/workspaces/:id/external-projects` writes the same table from the workspace's side.

A plugin can't write the map. Both routes are unmappable on the frame bridge, and
`CoreServices.projects` gives a plugin a provider-scoped read with no write.

The providers decide which of them appear. A provider declares a `projects` source on its
contribution, and one that declares none is absent ([integrations](../integrations.md)). The page
adds and removes one link at a time against the rows the server holds, so a connection whose project
list fails to load still shows its links by external ID.

A rail scoped to an unmapped workspace isn't always empty. Rollbar has no linked-project concept and
reads every connection unscoped. Linear declares its own `emptyState` for "no followed projects"
([integrations](../integrations/linear.md)).

The Node batches mapping changes into one event, `workspace-projects:changed { providerId,
workspaceIds }`, whose IDs are the union of the old and new scopes. Deleting a connection sends the
same event after its cascade. Plugins re-read the owner-filtered `projects.externalProjects`
capability.
