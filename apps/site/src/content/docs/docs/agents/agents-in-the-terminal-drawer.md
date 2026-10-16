---
title: Agents in the terminal drawer
description: Run Claude Code, Codex, or Aider as their own CLI in a task's terminal, and when to choose that over a managed session.
sources:
  - docs/terminal.md
  - docs/terminal/run-targets.md
  - docs/terminal/client.md
  - docs/terminal/activity.md
  - plugins/terminal/src/client/attention.ts
  - docs/managed-agents/palette.md
  - docs/managed-agents/defaults.md
  - plugins/terminal/src/client/TerminalPanel.tsx
  - plugins/agents/src/server/profiles/aider.ts
checked: 52225e24f
---

This page covers running an agent's own CLI in the task's terminal drawer, instead of as a managed
session in the Agent pane. Use it when you want the CLI exactly as it is outside acorn, or an agent
acorn doesn't manage, such as Aider.

## Start an agent in the drawer

1. Open a task, then press ⌘⇧T to open the terminal drawer.
2. Click **New terminal** (**+**) in the drawer, and pick **Claude Code**, **Codex**, or **Aider**.

The CLI starts in the task's worktree, in a tab of its own. A CLI the Node can't find is marked **Not
installed**, and says "acorn can't find … on your PATH."

The command palette's **New Claude Code terminal** and **New Codex terminal** do the same in one step.

Each tab is a real terminal on the Node. It keeps running while you switch tasks, and when tmux is
installed, after acorn quits. Without tmux, the menu marks each choice **Closes when acorn quits**.
**Hide terminals** closes the drawer and leaves them running.

## What a drawer agent gets from acorn

A drawer agent is the CLI itself, so acorn records no transcript and draws no cards. It still gets:

- **acorn's tools**, through acorn's MCP server, registered with Claude Code and Codex before the CLI
  starts. The tools are scoped to the task, under the same **Tools and permissions** switches
  ([Agent tools and the MCP server](/docs/agents/agent-tools-and-the-mcp-server/)).
- **The task's context**, when **Send task context at startup** is on under **Harnesses and defaults**:
  the pull request, linked issues, and notes, sent when the CLI first goes idle. It's on by default.
- **Notifications**, when the CLI asks for permission, finishes, or exits with an error. acorn reads
  this from the terminal's output: an agent silent for 10 seconds counts as finished.

## Managed session or drawer

| | Managed session | Drawer |
| --- | --- | --- |
| Transcript you can search and export | Yes | No |
| Request cards, queue, steering, goals | Yes | No |
| Custom agents and plugin skills | Yes | No |
| Delegating to managed sessions, through acorn's tools | Yes | Yes |
| The CLI's own interface and slash commands | Through the message box | Yes, exactly |
| Aider and other CLIs | Only harnesses acorn drives | Any profile |

You can move between them. **Continue in terminal** in a managed session's menu opens the same
conversation in the drawer, and **Return to managed mode** brings it back once the CLI has exited
([Agent sessions](/docs/agents/agent-sessions/#hand-a-session-to-the-terminal)).

## Run targets

The drawer also runs the project's run targets, such as a dev server, declared in `.acorn/config.toml`
or under the project's **Setup and scripts** tab. From the palette's **Run** group:

- **Run a target** starts a target and opens the drawer, or stops it if it's running.
- **Apply a layout** sets the pane layout, starts the layout's target, and points the browser pane at
  its URL.
- **Focus a terminal** selects a live session in this task.

A target from a committed `.acorn/config.toml` runs only once you've trusted that file
([Project configuration](/docs/using/project-configuration/)). An agent can start targets with the
`run_` tools, which are in the **Execute tools** tier.

## In the terminal

The terminal client has no drawer. Its **Sessions** view lists the task's terminal sessions and
opens one full screen, in the task's worktree. Enter gives it the keyboard, and Escape gives it back.
Closing the view leaves the session running.

## Limits

- A newly installed CLI appears in the menu within five minutes, or after a reload.
- A drawer agent's turns don't pass acorn's instruction file checks, because acorn doesn't send them.
- Killing a session happens in the drawer. The palette can't do it.
