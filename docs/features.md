# Features

This page lists what acorn does for the person using it, one surface at a time, with a link to the
doc that owns each one. Read it after the [architecture overview](./architecture-overview.md), so the
machinery has something to hang on.

acorn is a task-oriented coding workspace with GitHub review built in. Every feature shares the
desktop shell. Node-backed data goes to the active Node and renders with its connection freshness.

## Workspaces and tasks

A workspace is a named group of projects. A task is work on one project and branch, with an optional
worktree, a linked pull request or external issue, panes, terminal sessions, and managed agent
sessions. Tasks can start from GitHub, Linear, Rollbar, or the local new-task command. A task's
worktree is created the first time the task needs files or processes.

The Archive rail entry lists archived tasks, with a search over titles, branches, and agent
transcripts. It previews one read-only and restores it onto its branch. [Workspaces and
tasks](./workspaces-and-tasks.md) § Restoring a task covers it.

## GitHub review

The GitHub source provides repository search, pinned repositories, open and closed pull requests,
pull request detail, checks, Actions logs, labels, reviewers, comments, review threads, merge and
draft actions, and a create form. The diff viewer has unified and split modes, syntax highlighting,
word-level changes, viewed-file state, inline threads, and context you expand on demand. See [GitHub
integration](./github-integration.md) and [diff rendering](./diff-rendering.md).

## Task panes

Each task shows a row of panes. These ship with acorn:

- `agents`: managed Claude Code and Codex sessions, requests, context, artifacts, and lifecycle.
- `pr`: linked pull-request review.
- `changes`: the uncommitted diff, staging, commit and push, and review notes.
- `notes`: task, workspace, and global Markdown notes.
- `context`: choose, preview, size, and send task context.
- `editor`: worktree files, code editing, and ripgrep search.
- `preview`: a hardened browser preview. Agents get their own browser from the `browser` plugin,
  which has no pane.
- `database`: task-scoped PostgreSQL schema, rows, SQL, and project-scoped saved queries.
- `docker`: containers matched to the task, with logs, stats, exec, and lifecycle actions.
- `http`: encrypted requests, variables, auth helpers, and response inspection.
- `workflows`: the runs on this task, with progress, step transcripts, and gate controls.
- `linear` and `rollbar`: the two external-item panes, each from a loaded package you install and
  trust. Linear's pane also renders as the reference panel beside a pull request.

Every pane names one of the host's layouts and fills its regions. The host draws the arrangement, the
divider, and the drag handle, and owns keyboard navigation inside the pane. [Panes](./panes.md)
§ Layout model covers it. A loaded package's pane draws the same components from a Web Worker with no
DOM, so the Linear and Rollbar panes are the shell's own nodes, not iframes.

You can reorder and resize the row, and it's saved per Node and task. Plugins register the panes. A
saved pane ID that no plugin provides renders as a placeholder.

## Terminals and agents

The terminal drawer runs shells, run targets, raw provider TUIs, and tool terminals. Terminal
sessions use the Node's process broker, PTY and tmux reconciliation, bounded replay, and the
authenticated event socket. [Terminal](./terminal.md) covers it.

The Agent pane and Agent Center manage structured Claude Code and Codex sessions. They provide
durable normalized event ledgers, queued turns, permission and question requests, attachments,
artifacts, usage, search, archive, fork, compact, import, terminal handoff, delegated sessions, and
short generated titles after the first accepted prompt. Delegation can share the parent task or
create a child task with a lazy worktree. Aider runs through its terminal profile. It keeps the
prompt as its title, because its profile has no contained one-shot mode. [Managed
agents](./managed-agents.md) covers sessions.

Custom agents are saved starting points for a session: a harness, its model, effort, and mode,
instructions for its system prompt, and a ceiling on acorn's own tools. The owner keeps them under
Settings > Custom agents, and a plugin can ship them. Each one is listed under New, in the palette,
and to `agent_spawn` by name.

## Integrations and model providers

GitHub uses device-flow OAuth. You manage Linear connections, and Rollbar connections when its
loaded package is installed, from Settings > Services. They provide sources and task links. A
connection that needs signing in again is listed first, marks Services with a dot in the settings
rail, and leads its page with the fix. [Integrations](./integrations.md) covers connections.

OpenAI and Anthropic are model-provider connections, used by features such as SQL generation. The
model-provider plugin doesn't store prompts or responses. Settings > AI models lists what you can
generate with, both keys and installed agent CLIs. It holds the one **Generate with** default that
every Generate control opens on. That default is a device setting on a Node page, as
[state ownership](./state-ownership.md) § Scope rules explains. The first-run wizard shows the same
list on a **Generate with AI** step, with a key form per provider. The step never blocks: an agent
CLI on the machine needs no setup, and you can skip both and find the list in Settings later.

## Notes, memory, and context

Notes are Markdown at task, workspace, and global scope. Agents write durable memory directly, with
hash conflict checks, guarded content, history, and Undo from the transcript. Each new session starts
with the memory contract and capped private and project indexes. The Memory page lists, edits, and
imports memories. The context feature assembles provider, task, and notes sections within byte and
token budgets and can sync an immutable snapshot to an agent session. [Notes and
memory](./notes-and-memory.md) covers all three.

## Workflows

Workflows come from trusted `.acorn/workflows/*.toml` files or from definitions the owner writes in
the app. The Node stores runs, steps, gates, budgets, branches, joins, and trigger state. Agent,
terminal, GitHub-check, and human-gate steps use typed capabilities and structured step output. The
editor creates and revises both kinds of definition, and the run pane shows progress and gate
controls. [Workflows](./workflows.md) covers them.

## Docker, database, and HTTP

Each Node lists its own Docker containers and matches them to tasks by Compose, project, and worktree
metadata. Docker commands run through the process broker, behind a trust check where configuration is
executable. See [Docker](./docker.md).

The database pane leases a task-scoped PostgreSQL connection, reads the schema, pages rows, edits
primary-key values, runs SQL, and stores saved queries per project. See [database](./database.md). The
HTTP pane encrypts request and variable data at rest, and only an interactive device can send a
request. See [HTTP client](./http-client.md).

## Settings and fleet

Settings is a full-window view with a searchable rail of nine groups:

| Group | Pages |
| --- | --- |
| General | Appearance, Notifications, Keyboard shortcuts, and Command line. |
| Workspaces and projects | Overview, a table of every project with a bar for moving, hiding, and colouring several at once. Under it, a page per workspace and a page per project with General, Setup and scripts, Preview, Database, and Connections tabs. Values a project's `.acorn/config.toml` sets are read-only. |
| Agents | Harnesses and defaults, Custom agents, MCP servers, Tools and permissions, MCP config files, and Limits and cost. |
| Connections | Services, with a page per connection and an Add connection gallery, and AI models. |
| Features | Terminal, Docker, API requests, and any plugin page that names no group. |
| Automation | Schedules, Run history, and Workflows. |
| Machines | Nodes, Security and backup, Audit log, Telemetry, Storage and memory, and Sentry export. |
| Plugins | Installed, with a page per plugin, and Rail and surfaces. |
| Advanced | Device config file, Clear cache, Extension points, and the Style gallery in development builds. |

A few pages need more detail:

- **Harnesses and defaults** sets each harness, when an idle agent stops, how long an archived task
  keeps its agent history, what a new session starts on, and whether a terminal agent gets the task's
  context.
- **Storage and memory** shows the Node's running agents and their memory, the Node's own memory, its
  database and blob cache sizes, and this device's saved cache for that Node. It has buttons to stop
  idle agents and clear the cache.
- **Installed** lists the Node's plugins and this device's. Each plugin page has Overview, Settings,
  Permissions, and Versions tabs, and one Install flow serves either target. Every plugin page carries
  a strip with the plugin's origin, its rail switches, and its enabled switch.
- **Rail and surfaces** has a **Show in left rail** switch for every plugin source and the
  replaced-surface picker. A hidden source still opens from the palette.
- **Notifications** switches sound, system notifications, the app-icon count, and each of the three
  agent events worth interrupting for. See [notifications](./notifications.md) § Settings.

Each page's header says whether a change affects this device, a Node, a workspace, or a project. One
Node switcher serves the Node pages that can read another Node. [Frontend](./frontend.md) § Settings
covers the window.

The terminal client has a Settings route with the same groups, pages, and order. It draws the plugin
pages written with the shared kit and its own Notifications page, which shows the `ACORN_TUI_NOTIFY`
alert choice and the three event switches. Every other page is listed and says why to open it in the
desktop app. See [terminal client](./tui.md) § Settings.

Plugins are managed per Node. With more than one Node, the shell adds Fleet home, Node labels,
aggregate Agent Center, attention, and search, Node-aware palette rows, and partial and offline
states. [Client state and fleet behavior](./architecture/fleet.md) covers the rules.

## Command-line client

`acorn` with no arguments opens the terminal client. Headless commands use the same paired-Node
custody to manage workspaces and projects, create tasks, queue managed agent turns, start published
workflows, and inspect durable runs from a later process. `acorn node start --background` starts a
persistent local service. Loaded Node plugins can declare typed commands under
`acorn plugin ID COMMAND`. The Node checks scope and sends them to the plugin's own route.
[CLI](./cli.md) covers commands, JSON schemas, examples, and exit codes.
