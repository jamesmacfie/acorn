---
title: Glossary
description: The words acorn uses, what each one means, and the page that explains it.
sources:
  - docs/conventions.md
  - docs/architecture-overview.md
  - docs/workspaces-and-tasks.md
checked: 07aa959a0
---

The words acorn uses on screen and in these docs, each in a sentence or two, with the page that says
more.

| Term | What it means |
| --- | --- |
| acorn | A workspace for working with coding agents, one task at a time. Written in lowercase. [What is acorn](/docs/) |
| agent session | One managed Claude Code or Codex conversation in a task, with its transcript, approvals, and queue. [Agent sessions](/docs/agents/agent-sessions/) |
| browser extension | The Chrome and Firefox extension that shows your tasks and their conversations beside the page you're reading. [Set up the extension](/docs/browser-extension/set-up-the-extension/) |
| built-in plugin | A plugin acorn ships, such as Git or GitHub. [Built-in plugins](/docs/built-in-plugins/) |
| command line | `acorn` with a command, such as `acorn task list`, for scripts and agents. [The command line](/docs/automation/the-command-line/) |
| compiled plugin, loaded plugin | Two ways a plugin runs: built into acorn, or installed as a package that runs in a sandbox. Only plugin authors need the difference. [Plugins](/features/plugins/) |
| dashboard | A grid of panels over your data sources. Home is one. [Dashboards](/docs/automation/dashboards/) |
| data source | A set of records a plugin can read, each with the same typed fields, such as GitHub pull requests. [Data sources and saved queries](/docs/automation/data-sources-and-saved-queries/) |
| dataset | A copy of a source's records the Node keeps on a schedule, so a panel can show history. [Dashboards](/docs/automation/dashboards/#keep-a-history) |
| desktop app | acorn's app for macOS and Windows. [Desktop and terminal](/docs/start/desktop-and-terminal/) |
| device | A computer with a client on it. A device pairs with Nodes and keeps its own settings, such as appearance and shortcuts. [Nodes](/docs/nodes/) |
| device token | What a paired device presents to a Node. It gives full control of that Node. [Pair a device or a remote Node](/docs/nodes/pair-a-device-or-a-remote-node/#what-a-device-token-can-do) |
| fleet | Every Node a device is paired with, shown together once there are two. [The fleet view](/docs/nodes/the-fleet-view/) |
| gate | A workflow step that waits: for your approval, or for something outside acorn, such as CI. [Steps, gates, and budgets](/docs/automation/steps-gates-and-budgets/) |
| harness | The program acorn drives to run an agent, such as Claude Code or Codex. [Harnesses and defaults](/docs/agents/harnesses-and-defaults/) |
| identity words | Six words made from a Node's certificate. You compare them when you pair, so you know you're talking to your own Node. [Pair a device or a remote Node](/docs/nodes/pair-a-device-or-a-remote-node/#get-a-pairing-code) |
| kit, component | The shared set of components a plugin draws with, which the desktop app and the terminal client each draw in their own way. [Plugins](/features/plugins/) |
| Node | The process that holds your projects and runs your agents, on your computer or another one. Written with a capital N. [Nodes](/docs/nodes/) |
| pairing | Giving a client a token for a Node, with a one-time code or your approval in the desktop app. [Pair a device or a remote Node](/docs/nodes/pair-a-device-or-a-remote-node/) |
| pane | One view in a task's row, such as Changes, Editor, or Database. [Panes](/docs/using/panes/) |
| plugin | Anything that adds a feature to acorn, built in or installed. [Built-in plugins](/docs/built-in-plugins/) |
| project | A repository, or a folder, that tasks are made in. It belongs to a workspace. [Workspaces and projects](/docs/using/workspaces-and-projects/) |
| run | One go at a workflow, on one task. [Workflows](/docs/automation/workflows/) |
| saved query | A query a workspace keeps for dashboards, workflows, and schedules to reuse. [Data sources and saved queries](/docs/automation/data-sources-and-saved-queries/#saved-queries) |
| schedule | Work a Node runs on a timer, whether or not a client is open. [Schedules](/docs/automation/schedules/) |
| standalone Node | A Node run without the desktop app, such as on a server. [Run a standalone Node](/docs/nodes/run-a-standalone-node/) |
| step | One thing a workflow run does, such as an agent turn or a command. [Steps, gates, and budgets](/docs/automation/steps-gates-and-budgets/) |
| task | One piece of work on one project, with its own branch, worktree, agent sessions, terminals, and panes. [Tasks and worktrees](/docs/using/tasks-and-worktrees/) |
| terminal client | `acorn` on its own, which draws acorn in a terminal. [Desktop and terminal](/docs/start/desktop-and-terminal/) |
| workflow | A set of steps acorn runs on a task, written as a file or in the app. [Workflows](/docs/automation/workflows/) |
| workspace | A group of projects, such as one per client or team. You can turn workspaces off. [Workspaces and projects](/docs/using/workspaces-and-projects/) |
| worktree | A separate checkout of a repository, on the task's own branch, so tasks don't change each other's files. [Tasks and worktrees](/docs/using/tasks-and-worktrees/) |
