---
title: Workspaces and projects
description: Every setting in the Workspaces and projects group, from the Node's project table to each project's tabs.
sources:
  - docs/frontend/settings-pages.md
  - docs/frontend/settings-groups.md
  - packages/client-core/src/features/settings/corePages.ts
  - packages/client-core/src/features/settings/WorkspaceSettings.tsx
  - packages/client-core/src/features/settings/ProjectSettings.tsx
  - packages/client-core/src/features/settings/ProjectConfigTabs.tsx
  - plugins/docker/src/client/DockerProjectSettings.tsx
covers:
  - workspaces
  - workspace.detail
  - project.detail
  - docker.project
checked: 52225e24f
---

This page lists every setting in **Settings** > **Workspaces and projects**, which reads **Projects**
when the Node keeps projects separate. Overview is stored on the Node. A workspace's page is stored on
that **Workspace**, and a project's page on that **Project**.
[Workspaces and projects](/docs/using/workspaces-and-projects/) covers adding, grouping, and arranging
them.

## Overview

Every project on the Node in one table, grouped under its workspace, with its folder, what acorn
detected in it, and its open tasks. **Add folder…** and **Import from GitHub** add a project. A row's
name opens the project's page, and a workspace's name opens the workspace's page.

| Setting | What it changes | Stored on | Default |
| --- | --- | --- | --- |
| **Move to workspace** | Moves the selected projects to another workspace, or a new one. Workspaces grouped only. | Node | |
| **Hide**, **Show** | Hides the selected projects from the rail, or shows them again. | Node | Shown |
| **Set colour** | The selected projects' rail colour. | Node | |
| **Group projects** | Turns separate projects into workspaces, one per project. Shown only while projects are separate, and can't be undone. | Node | Chosen in first-run setup |

Select rows with their boxes to show the bar with these actions.

## A workspace's page

One page per workspace, under its name in the rail. Workspaces grouped only.

| Setting | What it changes | Stored on | Default |
| --- | --- | --- | --- |
| **Name** | The workspace's name. The Default workspace can't be renamed. | Workspace | |
| **Projects** | The workspace's projects, in the same table as Overview. | Workspace | |
| **Connections** | Which projects in connected services, such as Linear, the workspace follows. | Workspace | None |
| **Delete workspace** | Deletes the workspace. Its projects move back to Default. The Default workspace can't be deleted. | Workspace | |

## A project's page

One page per project, under its name in the rail, with six tabs. A value the repository's
`.acorn/config.toml` sets shows read-only, marked **From .acorn/config.toml**.

### General

| Setting | What it changes | Stored on | Default |
| --- | --- | --- | --- |
| **Name** | The project's name. | Project | Set when you add the project |
| **Folder** | The repository folder. **Change folder…** picks another. | Project | |
| **Rail colour** | The project's colour in the rail and on its tasks' tabs. | Project | Set when you add the project |
| **Workspace** | The workspace the project is in. Workspaces grouped only. | Project | |
| **Hidden** | Hides its tasks from the rail. New tasks can't use it. | Project | Off |
| **Task branch prefix** | Text added to the start of each new task's branch name, such as `your-name/`. | Project | None |
| **Delete project** | Deletes the project and its tasks. Nothing on disk is removed. | Project | |

### Setup and scripts

[Task scripts](/docs/using/task-scripts/) covers these.

| Setting | What it changes | Stored on | Default |
| --- | --- | --- | --- |
| **Setup script** | Runs once in each new task's worktree, in its first terminal tab. | Project | None |
| **When to run it** | **When the terminal first opens**, **When the task is created**, or **Never**. | Project | When the terminal first opens |
| **Teardown script** | Runs in the worktree before acorn removes it. If it fails, the task stays open. | Project | None |
| **Command**, under **Dev script** | Adds a run button to each task that starts and stops this command. | Project | None |
| **Restart command** | What restarts the dev script. Blank stops and starts it instead. | Project | None |
| **Run targets** | Named commands acorn can start for a task. **Add run target** adds one. | Project | None |

### Preview

| Setting | What it changes | Stored on | Default |
| --- | --- | --- | --- |
| **Browser preview URL** | Where the Preview pane opens: **Dev-server port (default)**, **A fixed URL**, **localhost with a port**, or **A script that prints the URL**. Each but the first shows a field for its value. | Project | Dev-server port |

### Database

| Setting | What it changes | Stored on | Default |
| --- | --- | --- | --- |
| **Connection URL command** | A script that prints the task's database URL. | Project | `DATABASE_URL` from the worktree's `.env` or the environment |
| **Schema source** | What SQL generation reads as the schema: **Read the live database (default)**, **A script that prints it**, or **A file in the worktree**, each with a field for its value. | Project | Read the live database |
| **Schema notes** | Anything the schema doesn't say, such as what a status column's numbers mean. | Project | None |

### Connections

**Followed services** shows which projects in each connected service, such as Linear or Rollbar, this
project follows, and links to each connection's page. Change them there, or on the workspace's page.

### Docker

The Docker plugin's tab. It shows how containers are matched to the project's tasks, read from the
`[docker]` table of the project's `.acorn/config.toml`, then `~/.acorn/config.toml`, then the default.
It changes nothing itself: the page shows the keys to set.

| Setting | What it changes | Stored on | Default |
| --- | --- | --- | --- |
| **Compose project**, `compose_project` | A Compose project to suggest in the task summary. | Project | None |
| **Match labels**, `match_labels` | Label keys whose value equals the task's branch name. | Project | None |
| **Match container names**, `match_name` | Suggests containers whose names contain the branch name. | Project | On |

## In the terminal

These pages open in the desktop app. **Overview** also offers **Set up acorn**, to add a project from
the terminal client.
