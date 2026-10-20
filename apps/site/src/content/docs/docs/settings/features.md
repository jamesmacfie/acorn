---
title: Features
description: The Settings pages built-in plugins add to the Features group, and where each is stored.
sources:
  - docs/frontend/settings.md
  - docs/frontend/settings-groups.md
  - plugins/terminal/src/client/index.ts
  - plugins/docker/src/client/index.ts
  - plugins/editor/src/client/index.ts
  - plugins/git/src/client/index.ts
  - plugins/http/acorn-plugin.config.mjs
covers:
  - terminal
  - docker
  - editor
  - http-variables
  - git
  - git-display
checked: '7dd4aed34'
---

This page lists the pages in **Settings** > **Features**. acorn itself adds none: each comes from a
built-in plugin, and its settings are covered with that plugin. Each page starts with the plugin's
strip: its name, **Manage plugin**, an **Enabled** switch, and a **Show in left rail** switch for each
rail icon the page names. With the plugin off, the strip says so.

| Page | From | What it holds | Stored on |
| --- | --- | --- | --- |
| **Terminal** | Terminal | What the terminal drawer opens when you click its button, and the drawer's text size. | This device |
| **Docker** | Docker | Whether destructive actions ask twice, whether stopped containers show, and where task linking rules live. Shows the Docker engine's status. | This device |
| **Editor** | Editor | Word wrap, indentation when a file has none to detect, and line blame. | This device |
| **API requests** | HTTP | Variables for the API pane, per project. | Node |
| **Git** | Git | The Git identity for a repository or for your user on the Node, the pull strategy, and auto-fetch. | Node |
| **Git display** | Git | The history graph, and unified or split diffs. | This device |

The Docker plugin also adds a **Docker** tab to each project's page
([Workspaces and projects](/docs/settings/workspaces-and-projects/#docker)).

## In the terminal

The terminal client draws **Docker**, **Editor**, **Git**, and **Git display**. **Terminal** names the
desktop app, because its settings shape the desktop's terminal drawer. **API requests** isn't listed in
the terminal client.
