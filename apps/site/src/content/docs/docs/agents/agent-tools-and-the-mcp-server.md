---
title: Agent tools and the MCP server
description: The tools acorn gives agents, how a session reaches them, what scopes them, and how to add your own MCP servers.
sources:
  - docs/agent-tools.md
  - docs/mcp.md
  - docs/mcp/managed-servers.md
  - docs/mcp/result-size.md
  - docs/agent-tools/orchestration.md
  - packages/protocol/src/agents/toolPermissions.ts
  - plugins/agents/src/client/settings/AgentMcpServersSettings.tsx
checked: 1e5d6a032
---

This page covers acorn's own tools for agents, the MCP server that carries them, the token that scopes
them to one task, and the MCP servers you add for your agents. MCP, the Model Context Protocol, is how
a harness such as Claude Code calls tools that live outside it.

## The tools

Every agent acorn starts in a task, managed or in the terminal drawer, can call these:

| From | Tools |
| --- | --- |
| The task and pull request | `task_current`, `task_context`, `repo_info`, `linked_issues`, `pr_current`, `pr_changed_files`, `pr_review_comments`, `pr_checks`, `pr_create`, from whichever code host holds the task's repository |
| Issues and errors | `issue_detail`, `issue_comment`, `issue_image`, for whichever tracker is linked |
| GitHub | `github_pull_create`, an older name for `pr_create` |
| Git | `local_changes`, `local_diff`, `git_log` |
| Notes and memory | `notes_list`, `notes_read`, `notes_write`, `notes_append`, and five `memory_` tools |
| Task scripts | `task_scripts_status`, `task_scripts_wait`, `task_scripts_logs` |
| Run targets | `run_targets`, `run_status`, `run_start`, `run_stop`, `run_restart`, in a task with run targets |
| The preview browser | Six `browser_` tools: navigate, snapshot, click, fill, screenshot, and console |
| Other agents | `agent_spawn`, `agent_prompt`, `agent_wait`, `agent_read`, `agent_cancel` |
| Agent history | `session_history_search`, `session_history_read`, `agent_session_list`, `agent_session_search`, `agent_session_read` |
| Workflows | Listing, reading, drafting, and validating workflows, and running one you approved for agents |
| Data sources | Four read-only tools that describe connected data sources, and `dataset_write` |
| Plugins | `plugin_authoring` and `plugin_request` |

A plugin can add its own tools, named after the plugin. **Settings** > **Agents** > **Tools and
permissions** lists every tool with its owner and tier.

No acorn tool reads or writes a file, opens a database, or talks to Docker. An agent edits files with
its harness's own tools, in the worktree.

## Who can call what

Each tool has a tier: read, write, or execute. **Read tools** are always on, **Write tools** are on by
default, and **Execute tools** are off until you turn them on. A tool's own switch overrides its tier.
[Permissions and approvals](/docs/agents/permissions-and-approvals/#acorns-tool-tiers) covers the page.

A workflow step, a custom agent, and a delegated child can narrow this further. Nothing widens it.

## How a session reaches the tools

acorn ships an MCP server, `acorn`, that runs as a small child process beside the agent and calls the
Node on the same computer. It holds no data of its own: every call goes to the Node, which checks it.

- Claude Code and Codex get it registered through their own CLI before acorn starts them. In a managed
  session, acorn also declares it directly, so the session's own token is used.
- A harness a plugin adds gets it through the protocol, on every start and resume.

To take acorn's tools away from a CLI you run outside acorn, run `claude mcp remove acorn` or
`codex mcp remove acorn`.

### Long results

An agent gets at most 32 KiB of any one result, about 8,000 tokens. A longer one keeps its start and
its end, with one line between them that says how much was left out and where the full text is. The
full text goes to `acorn-tool-output` in your temp folder, readable only by you, and is deleted after
seven days. A managed Claude Code session may read it without asking. A Claude Code session in the
terminal drawer asks first.

### The task-scoped token

The server authenticates with a token the Node signs for one task and one session. The token, not
anything the agent sends, decides which task a call reaches and which tools it may use.

- A call can't name another task. Paths are checked against the task's worktree.
- The token can't pair devices, manage plugins, read the audit log, make backups, or change
  connections.
- A token lasts 48 hours. The Node refreshes it every 12 hours and at boot, so a terminal that
  reattaches after a restart keeps working.
- No tool returns your GitHub token or an API key. A tool uses them on the Node and returns only the
  result. What an agent can read from disk is a separate question, covered in
  [Credentials and secrets](/docs/security/credentials-and-secrets/).

## Add your own MCP servers

**Settings** > **Agents** > **MCP** has two sections.

**Servers** holds the servers acorn adds to every agent session, on every harness:

1. Click **Add server**.
2. Give it a **Name** and pick a **Transport**: **Command (stdio)** with a command, arguments, and
   environment, or **URL (HTTP)** with a URL and headers. Mark a value **Secret** to seal it on the
   Node.
3. Save, then click **Test**. acorn connects to it as an agent would, lists its tools, and
   disconnects.

Before a server's first **Test** or session, acorn asks you to confirm its exact command or address,
with secret names and no values. Editing it asks again.

**Install an MCP package** installs an npm package at an exact version, with install scripts turned
off. A version younger than seven days needs a reason, which the audit log records. **Review tool
definition changes** holds back a server's tools until you approve their definitions, and again
whenever they change.

**On for new sessions** decides whether a new session starts with the server. Nothing in Settings
changes an open session: type `/mcp` in its message box to open its server list, change the switches,
and click **Apply**. That restarts the agent on the same conversation, so wait for the turn to end.

**Config files** lists the servers each CLI loads from its own config, such as `~/.claude.json` and a
project's `.mcp.json`, with secret values masked. acorn can't turn these off. **Create .mcp.json** adds
an empty one to the project folder, for you to commit.

## In the terminal

The terminal client's sessions use the same tools and servers. **MCP** draws in the terminal client's
Settings too. **Tools and permissions** opens in the desktop app.

## Limits

- A standalone Node offers no MCP server, so agents on it have no acorn tools.
- An HTTP server reaches only a harness that supports HTTP servers. The session says which servers it
  runs without.
- Sign-in to an MCP server that needs OAuth stays with each CLI.
- Claude Code reports a server's status only through its own SDK, so the `/mcp` panel shows less for
  it than for Codex.
- A pinned package runs as its own code. acorn checks what it installs, not what it does.
