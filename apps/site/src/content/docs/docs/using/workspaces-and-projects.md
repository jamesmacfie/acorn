---
title: Workspaces and projects
description: Add projects, group them into workspaces or keep them separate, and change their settings.
sources:
  - docs/workspaces-and-tasks/projects.md
  - docs/workspaces-and-tasks/workspace-icons.md
  - docs/workspaces-and-tasks.md
  - docs/frontend/settings-groups.md
  - packages/client-core/src/features/workspaces/ProjectTable.tsx
  - packages/client-core/src/features/workspaces/WorkspaceIconEditor.tsx
  - packages/client-core/src/features/settings/ProjectConfigTabs.tsx
checked: 90ded85ca
---

This page covers adding projects, choosing between grouped workspaces and separate projects, hiding
and coloring projects, workspace icons, and the settings on each project's page. Read it when you add
your second repository.

A project is a folder on the Node's machine, usually a Git checkout. A workspace groups projects so
they share a task list, notes, and Home dashboards. [Concepts](/docs/start/concepts/) explains both.

## Separate projects or grouped workspaces

The first-run setup asks how to arrange projects. You can change your mind once, in one direction:

- **Keep each project separate.** Each project has a workspace of its own, with the same name. The top
  bar's first picker is labeled **Project** and lists your projects. The Settings group is called
  **Projects**.
- **Group projects into workspaces.** A workspace holds several projects. The top bar's first picker
  chooses a workspace, and a second picker chooses the project inside it. The Settings group is called
  **Workspaces and projects**.

To switch from separate projects to workspaces:

1. Open **Settings** > **Projects** > **Overview**.
2. Under **Group projects into workspaces**, click **Group projects**, then click it again to confirm.

Each project becomes a workspace of its own, with nothing moved. You can then move projects together.
Grouping can't be undone, because a workspace's notes, dashboards, and saved queries have no project
that would inherit them.

## Add a project

Pick whichever is nearest:

- In the top bar's first picker, choose **Add project…** and pick a folder.
- In the command palette, run **Add project**.
- In **Settings** > **Overview**, click **Add folder…** or **Import from GitHub**. Importing clones a
  repository, or links one you already have on this computer.
- From the command line, run `acorn project add --path /absolute/path`.

If the folder already belongs to a project in another workspace, acorn names that workspace and sends
you to **Overview** to move it. A project you add goes at the end of its workspace.

## Arrange, hide, and color projects

**Settings** > **Overview** is one table of every project on the Node, grouped under its workspace.

1. Tick the projects you want to change. A bar opens under the table.
2. Choose an action:
   - **Move to workspace** moves them. Its last option, **New workspace…**, creates one. This appears
     only with workspaces grouped.
   - **Hide** takes their tasks out of the rail, and new tasks can't use them. When every selected
     project is hidden, the button reads **Show**.
   - **Set rail colour** gives each task in those projects a colored strip down its rail tab. **No
     colour** removes it.

To reorder projects inside a workspace, drag a row's grip, or focus the grip and press Alt+Up or
Alt+Down. The top bar's project list follows that order.

## Give a workspace an icon

With workspaces grouped, each workspace shows an icon beside its name. Without one, it shows the
workspace's initials.

1. Open the workspace's page in **Settings**, under **Overview**.
2. Under **General** > **Icon**, choose **Icon and background** or **Image**.
3. For an icon, pick a glyph and a **Solid colour** or a **Gradient** of two to four colors. It saves
   as you change it.
4. For an image, choose a PNG, JPEG, or WebP file up to 5 MiB, frame the square crop, and click
   **Save image**.

**Reset icon** goes back to initials. To show workspaces as a rail of icons down the left edge, turn on
**Settings** > **Appearance** > **Show workspace rail**. With projects separate, it's called **Show
project rail**. The rail replaces the top bar's dropdown while it's on.

## Project settings

Click a project in **Overview** to open its page. It has these tabs:

| Tab | What it holds |
| --- | --- |
| **General** | The name, the folder, the rail colour, the workspace, **Hidden**, the **Task branch prefix** added to each new branch, and **Delete project** |
| **Setup and scripts** | The setup script and **When to run it**, the teardown script, the dev script and its restart command, and run targets. [Task scripts](/docs/using/task-scripts/) covers them. |
| **Preview** | The URL the Preview pane opens |
| **Database** | The script that finds the task's database connection |
| **Connections** | Which Linear or Rollbar projects this project follows |
| **Docker** | How containers are matched to a task |

A value set by the repository's `.acorn/config.toml` shows read-only, labeled **From
.acorn/config.toml**. [Project configuration](/docs/using/project-configuration/) explains why.

## Delete a project

On the project's **General** tab, click **Delete project**. The confirmation says how many tasks go with
it. acorn doesn't touch the disk: the folder and any task worktrees stay where they are.

## In the terminal

The terminal client follows the Node's choice of separate projects or workspaces, and its top bar says
**Project** or names the workspace to match. `w` and `p` switch workspace and project. It has no
**Group projects** control and no icon settings, and it draws no workspace icons. Its setup adds a
project from an absolute path you type.

## Limits

- Grouping projects into workspaces can't be undone.
- The folder picker works only for the Node on this computer. For a Node on another machine, type an
  absolute path on that machine.
- Deleting a project deletes its tasks, and they can't be restored. With projects separate, it also
  makes that project's notes, dashboards, and saved queries unreachable.
- The Default workspace can't be renamed or deleted, because a deleted workspace's projects move there.
