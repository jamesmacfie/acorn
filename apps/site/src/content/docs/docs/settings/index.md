---
title: Settings
description: How Settings is laid out, where each setting is stored, and how changes save.
sources:
  - docs/features.md
  - docs/frontend/settings.md
  - docs/frontend/settings-groups.md
  - docs/frontend/settings-pages.md
  - docs/state-ownership/scope-rules.md
  - docs/tui/sources-and-settings.md
  - packages/client-core/src/features/settings/corePages.ts
  - packages/protocol/src/chrome/settingsPages.ts
checked: 'aa6684ee9'
---

This page covers how Settings works: opening it, its groups, what the label beside each page's title
means, how a change saves, and finding a setting. The pages after this one list every setting in each
group, with what it changes and its default.

## Open Settings

Press ⌘, on macOS, or Ctrl+, on Windows. You can also run **Open settings** from the command palette,
or choose it from the top bar's menu. Settings covers the whole window, and your task keeps running
underneath. Press Escape, or **Back to acorn**, to return to it.

Settings opens on the page you used last.

## The groups

The rail on the left holds nine groups, in this order:

| Group | What's in it |
| --- | --- |
| [General](/docs/settings/general/) | This screen: appearance, notifications, shortcuts, the command line, and on the desktop, what closing the window does. |
| [Workspaces and projects](/docs/settings/workspaces-and-projects/) | Every project on the Node, each workspace's page, and each project's page. Reads **Projects** when projects are kept separate. |
| [Agents](/docs/settings/agents/) | Harnesses and new-session defaults, custom agents, tool permissions, MCP servers, and limits and prices. |
| [Connections](/docs/settings/connections/) | Services such as GitHub and Linear, and API keys for generating text. |
| [Features](/docs/settings/features/) | Pages built-in plugins add, such as Terminal, Docker, Editor, and Git. |
| [Automation](/docs/settings/automation/) | Schedules, datasets, run history, and workflows. |
| [Machines](/docs/settings/machines/) | Nodes, security and backup, the audit log, telemetry, and storage. |
| [Plugins](/docs/settings/plugins/) | Installed plugins, and what shows in the left rail. |
| [Advanced](/docs/settings/advanced/) | The device config file, clearing the cache, and extension points. |

A plugin can add pages to General, Agents, Connections, Features, Automation, and Machines. Only acorn
itself adds pages to the other three.

Use the arrow keys to move through the rail and Enter to open a page. Below 900 pixels wide, the rail
is its own screen.

## Where a setting is stored

Beside each page's title, a label says what a change on it affects:

| Label | Stored on | Reaches |
| --- | --- | --- |
| **This device** | The device you're using | Only this device. Your other devices keep their own. |
| **Node: …** | The Node | Every device paired with that Node. |
| **Workspace** | One workspace on the Node | That workspace's tasks. |
| **Project** | One project on the Node | That project's tasks. |

A row stored somewhere other than its page carries its own **This device** label, such as **Tool call
display** on **Harnesses and defaults**.

Every Node, workspace, and project page works on the Node you're using, the one the top bar shows. With
two or more Nodes paired, the **Node** label on those pages is a picker. Picking another Node switches
to it, the same as the top bar's Node picker, and Settings stays open on the same page.

A value a project's committed `.acorn/config.toml` sets shows read-only, marked **From
.acorn/config.toml**, with the file's value above this machine's own
([Project configuration](/docs/using/project-configuration/)).

## How a change saves

- **A switch or a picker** saves as soon as you change it.
- **A text field** saves when you leave it or press Enter, and shows **Saved** for a moment. A refused
  value stays in the field, with the reason beside it.
- **A form**, such as a custom agent, a credential, or an MCP server, saves only with its **Save**
  button. Leaving it with changes asks first.
- **A row that differs from its default** shows a dot beside its label and offers **Reset**.
- **Deleting something**, such as a project or a connection, sits under **Danger zone** at the bottom
  of its page and says what goes and what stays before it asks.

A row that only seeds new agent sessions says so, and names the control that changes an open one.

## Find a setting

Press `/` in Settings, or click the search field, and type. Results rank page names first, then
section names, setting names, and keywords. A workspace, project, connection, Node, or plugin is found
by its name. Pick a result to go to its section, which is outlined for a moment.

**Copy link** in a page's header copies an `acorn://` link to that page and section
([Links into acorn](/docs/using/links-into-acorn/)).

## In the terminal

Run **Open settings** from the command palette. The terminal client lists the same nine groups and the
same pages, in the same order:

- Pages a plugin draws with acorn's components, such as **Harnesses and defaults**, **Docker**, and
  **Workflows**, draw in the terminal too.
- **Notifications** has a terminal version.
- Every other page shows **desktop app** beside it, and says where to change it. A Node page changed on
  the desktop applies to the terminal too. A device page doesn't, and for **Appearance**, **Keyboard
  shortcuts**, **Rail and surfaces**, and **Device config file** the page names the terminal client's
  own `acorn.json` instead.

Escape climbs one level at a time: a detail, the page, the group, then Settings.

## Limits

- The terminal client doesn't list pages a loaded plugin draws in a frame, such as **API requests** and
  **Sentry export**.
- A link to a section in the terminal client opens the page, not the section.
