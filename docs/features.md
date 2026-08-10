# Features

acorn combines GitHub review with a task-oriented coding workspace. The desktop shell is shared by
all features; Node-backed data is addressed to the active Node and rendered with its connection
freshness.

## GitHub review

The GitHub source provides repository search, pinned repositories, open and closed pull requests,
PR detail, checks, Actions logs, labels, reviewers, comments, review threads, merge/draft actions,
and create-PR. The diff viewer supports unified/split modes, syntax highlighting, word-level changes,
viewed-file state, inline threads, and lazy context expansion.

## Workspaces and tasks

A workspace is a named group of projects. A task is work on one project and branch, with an
optional worktree, linked PR or external issue, panes, terminal sessions, and managed agent sessions.
Tasks can originate from GitHub, Linear, Rollbar, or the local task command. Worktrees are created
lazily when a task first needs filesystem/process access.

## Task panes

- `agents` — managed Claude/Codex sessions, requests, context, artifacts, and lifecycle.
- `pr` — linked pull-request review.
- `changes` — uncommitted diff, staging, commit/push, and review notes.
- `notes` — task, workspace, and global Markdown notes.
- `context` — choose, preview, size, and send task context.
- `editor` / `search` — worktree files, Monaco editing, and ripgrep search.
- `preview` — hardened browser preview and agent browser tools.
- `database` — task-scoped PostgreSQL schema, rows, SQL, and project-scoped saved queries.
- `docker` — task-matched containers, logs, stats, exec, and lifecycle actions.
- `http` — encrypted requests, variables, auth helpers, and response inspection.
- `linear` — linked issue panel; `rollbar` provides the equivalent sandboxed pane when the loaded
  Rollbar package is installed and trusted.

The row is ordered/resizable and persisted per Node/task. Contributions are registered by plugins;
unknown persisted pane IDs render safely as placeholders.

## Terminals and agents

The terminal drawer provides shells, run targets, raw provider TUIs, and tool terminals. Terminal
sessions use the Node process broker, PTY/tmux reconciliation, bounded replay, and the authenticated
event socket.

The Agent pane and Agent Center manage structured Claude and Codex sessions: durable normalized event
ledgers, queued turns, permission/question requests, attachments, artifacts, usage, search, archive,
fork, compact, import, and terminal handoff. Aider is available through its terminal profile.

## Integrations and model providers

GitHub uses device-flow OAuth. Linear connections, and Rollbar connections when its loaded package is
installed, are managed from Settings and expose
provider sources and task links. OpenAI and Anthropic are model-provider connections used by features
such as SQL generation; prompts and responses are not persisted by the model-provider plugin.

## Notes, memory, and context

Notes are Markdown at task, workspace, and global scope. Memory is durable reviewed knowledge with an
index, search, proposals, and agent tools. Agents propose memory changes; accepting a proposal is a
human-gated action. The context feature assembles provider, task, notes, and memory sections within
byte/token budgets and can sync an immutable snapshot to an agent session.

## Workflows

Workflows are loaded from trusted `.acorn/workflows/*.toml` files. The Node persists runs, steps,
gates, budgets, branches, joins, and trigger state. Agent, terminal, GitHub-check, and human-gate
steps use typed capabilities and structured step output. Authoring is file-based; the desktop shows
inspection, problems, palette rows, activity, attention, and gate controls.

## Docker, database, and HTTP

Docker inventory is Node-local and matched to tasks using Compose/project/worktree metadata. Docker
execution is process-brokered and trust-gated where configuration is executable.

The database pane leases a task-scoped PostgreSQL connection, introspects schema, pages rows, edits
primary-key values, runs SQL, and stores project-scoped saved queries. The HTTP pane stores request
and variable data encrypted at rest; sending is restricted to an interactive device principal.

## Settings and fleet

Settings includes workspaces, appearance, integrations, MCP, agent tools, pricing, workflows,
terminal, Docker, HTTP requests, shortcuts, Nodes, Plugins, and Security. Nodes and plugins are
managed per Node. With more than one Node, the shell adds Fleet home, Node labels, aggregate Agent
Center/attention/search, Node-aware palette rows, and partial/offline states.
