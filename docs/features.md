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

The Archive rail entry lists archived tasks with a search over titles, branches and agent transcripts,
previews one read-only, and restores it onto its branch
([workspaces-and-tasks](./workspaces-and-tasks.md) § Restoring a task).

## Task panes

- `agents` — managed Claude/Codex sessions, requests, context, artifacts, and lifecycle.
- `pr` — linked pull-request review.
- `changes` — uncommitted diff, staging, commit/push, and review notes.
- `findings` — quiet observations plus explicit, consolidated memory-review bundles with retained provenance and history.
- `notes` — task, workspace, and global Markdown notes.
- `context` — choose, preview, size, and send task context.
- `editor` / `search` — worktree files, code editing, and ripgrep search.
- `preview` — hardened browser preview. Agents get their own browser instead, from the `browser`
  plugin, which has no pane.
- `database` — task-scoped PostgreSQL schema, rows, SQL, and project-scoped saved queries.
- `docker` — task-matched containers, logs, stats, exec, and lifecycle actions.
- `http` — encrypted requests, variables, auth helpers, and response inspection.
- `linear` and `rollbar` — the two external-item panes, each supplied by a loaded package that is
  installed and trusted. Linear's also renders as the reference panel beside a pull request.

Every pane names one of the host's layouts and fills its regions; the host draws the arrangement, the
divider and the drag handle, and owns the keyboard navigation inside it ([panes](./panes.md) § Layout
model). A loaded package's pane draws the same components from a Web Worker with no DOM, so linear's
and rollbar's are the shell's own nodes rather than an iframe.

The row is ordered/resizable and persisted per Node/task. Contributions are registered by plugins;
unknown persisted pane IDs render safely as placeholders.

## Terminals and agents

The terminal drawer provides shells, run targets, raw provider TUIs, and tool terminals. Terminal
sessions use the Node process broker, PTY/tmux reconciliation, bounded replay, and the authenticated
event socket.

The Agent pane and Agent Center manage structured Claude and Codex sessions: durable normalized event
ledgers, queued turns, permission/question requests, attachments, artifacts, usage, search, archive,
fork, compact, import, terminal handoff, agent-driven delegated sessions, and short generated titles
after the first accepted prompt. Delegation can share the parent task or create a selectable child
task with a lazy worktree. Aider is available through its terminal profile and keeps the deterministic
prompt fallback because its profile has no contained one-shot mode.

Custom agents are saved starts for a session: a harness, its model, effort and mode, instructions for
its system prompt, and a ceiling on acorn's own tools. The owner keeps them under Settings > Custom
agents, a plugin can ship them, and each is listed under New, in the palette, and to `agent_spawn` by
name.

## Integrations and model providers

GitHub uses device-flow OAuth. Linear connections, and Rollbar connections when its loaded package is
installed, are managed from Settings > Services and expose provider sources and task links. A
connection that needs signing in again is listed first, dots Services in the settings rail, and its
page leads with the fix. OpenAI and Anthropic are model-provider connections used by features such as
SQL generation; prompts and responses are not persisted by the model-provider plugin. Settings > AI
models lists what this owner can generate with, keys and installed agent CLIs, and holds the one
"Generate with" default every Generate control in the app opens on, a device row on a node page
([state-ownership.md](./state-ownership.md) § Scope rules). The first-run wizard shows the same list
on a **Generate with AI** step and offers a key form per provider. It never blocks: an agent CLI
already on the machine needs no setup at all, and someone who wants neither a CLI nor a key moves on
and finds this in Settings later.

## Notes, memory, and context

Notes are Markdown at task, workspace, and global scope. Agents write durable Memory directly with
hash conflicts, guarded content, history, and transcript Undo. Each new session starts with the
memory contract and capped private and project indexes. Findings review remains during phase 1
measurement. The context feature assembles provider, task, and notes sections within byte/token
budgets and can sync an immutable snapshot to an agent session.

Findings retains evidence discovered during a task without notifying the owner or creating a review
obligation. Managed agents, paired devices, and registered plugin producers can record bounded,
structured observations. The task pane shows their full history.

## Workflows

Workflows come from trusted `.acorn/workflows/*.toml` files or owner-authored database definitions.
The Node persists runs, steps, gates, budgets, branches, joins, and trigger state. Agent, terminal,
GitHub-check, and human-gate steps use typed capabilities and structured step output. The desktop
editor creates and revises both definition kinds, while the run pane shows progress and gate controls.

## Docker, database, and HTTP

Docker inventory is Node-local and matched to tasks using Compose/project/worktree metadata. Docker
execution is process-brokered and trust-gated where configuration is executable.

The database pane leases a task-scoped PostgreSQL connection, introspects schema, pages rows, edits
primary-key values, runs SQL, and stores project-scoped saved queries. The HTTP pane stores request
and variable data encrypted at rest; sending is restricted to an interactive device principal.

## Settings and fleet

Settings is a full-window view with a searchable rail of nine groups. General holds Appearance,
Notifications, Keyboard shortcuts, and Command line. Workspaces and projects holds Overview, a table
of every project with a bar for moving, hiding, and colouring several at once, then a page per
workspace and, under it, a page per project with General, Setup and scripts, Preview, Database, and
Connections tabs. Values a project's `.acorn/config.toml` sets are read-only there. Agents holds Harnesses and defaults (each harness, when an idle agent stops, how long an
archived task keeps its agent history, what a new session starts on, and whether a terminal agent is
sent the task's context), Custom agents and MCP servers (each a list, then
one item's editor in the same pane), Tools and permissions (grouped by owner or by tier), MCP config
files (for a project picked on the page, whether or not a task is open), Limits and cost (concurrency
and pricing), and Review after archive. Connections holds
Services (each connection, a page per connection with where it shows up, and an Add connection
gallery) and AI models (the model keys, the agent CLIs, and Generate with). Features holds Terminal, Docker, API requests, and any plugin page that names no group.
Automation holds Schedules, Run history, and Workflows. Machines holds Nodes, Security and backup,
Audit log, Telemetry, Storage and memory, and Sentry export. Storage and memory shows the node's
running agents and their memory, the node's own memory, its database and blob cache sizes, and this
device's saved cache for that node, with buttons to stop idle agents and clear the cache. Plugins holds Installed (the node's plugins and this device's,
filtered to what needs you or to this device, each opening a page with Overview, Settings, Permissions,
and Versions tabs, and one Install flow for either target) and Rail and surfaces (a Show in left rail
switch for every plugin source, and the replaced-surface picker). Every plugin page carries a host-drawn
strip with the plugin's origin, a link to its page, its rail switches, and its enabled switch. A hidden
source still opens from the palette. Advanced holds Device config file,
Clear cache, Extension points, and the Style gallery in development builds. Each page's header says
whether a change affects this device, a node, a workspace, or a project, and one node switcher serves the node
pages that can read another node ([frontend.md](./frontend.md) § Settings). The Notifications page
switches sound, system notifications, the app-icon count, and each of the three things an agent can
do that is worth interrupting for ([notifications.md](./notifications.md) § Settings). The terminal
client has a Settings route with the same groups, pages, and order. It draws the plugin pages written
with the shared kit and its own Notifications page, which shows the `ACORN_TUI_NOTIFY` alert choice
and the three event switches. Every other page is listed and says to open it in the desktop app, and
why ([tui.md](./tui.md) § Settings). Plugins are
managed per Node. With more than one Node, the shell adds Fleet home, Node labels, aggregate Agent
Center/attention/search, Node-aware palette rows, and partial/offline states.

## Command-line client

`acorn` with no arguments opens the terminal client. Headless commands use the same paired Node
custody to administer workspaces and projects, create tasks, queue managed agent turns, start
published workflows, and inspect durable runs from a later process. `acorn node start --background`
explicitly starts a persistent local service. Loaded Node plugins can declare typed commands under
`acorn plugin ID COMMAND`; the Node validates scope and dispatches them through the plugin's owned
route. See [CLI](./cli.md) for commands, JSON schemas, examples, and exit codes.
