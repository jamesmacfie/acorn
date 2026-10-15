# Phase 9: write the feature pages

Date: October 15, 2026. Status: proposed. Needs phases 6 and 7. Can run beside phase 8.

## Goal

Each feature group has one page that a developer reads in two minutes and leaves knowing what acorn does
in that area, what it looks like, and where the docs are. A feature page sells by showing. It's the
bridge between the landing page and the docs, not a second copy of either.

## The page shape

Every feature page uses one template:

1. **Title and one sentence** saying what this part of acorn does.
2. **A picture**: a snapshot or a specimen.
3. **Three to six sections**, each answering one question a reader has. A section is a heading, a short
   paragraph, a picture where one helps, and a link to the docs page that owns the detail.
4. **In the terminal**: one short section on how this feature works in the terminal client, and what it
   doesn't do there. [First-party plugins in the terminal](../../first-party-plugins/terminal.md) has
   the facts.
5. **Related features**: two or three links.
6. **Get started**: the download action and the docs link.

Every page carries `sources` like a docs page, so phase 4's report covers it.

## The pages

Each outline lists the questions to answer, in order, and the internal docs to write from. Treat the
lists as starting points. Cut a section if its picture would be weak.

### `/features/tasks/`

What's a workspace, a project, and a task. When a task gets its branch and its worktree. The row of
panes, and saving it per task. Task scripts for setup and teardown. Archiving a task, what it cleans
up, and restoring it. Sources: `docs/workspaces-and-tasks.md` and its topic pages, `docs/panes.md`.

### `/features/agents/`

Claude Code and Codex as managed sessions in a task, using their own logins. The transcript: tool calls,
diffs, approvals, questions, and attachments. Queued turns and steering a running turn. Delegation to a
child session or a child task. Custom agents. Memory that agents write and you can undo. Usage and cost.
Sources: `docs/managed-agents.md` and its topic pages, `docs/notes-and-memory.md`.

### `/features/review/`

GitHub pull requests: the list, the detail, checks and Actions logs, review threads, and merge. The diff
viewer: split and unified, word-level changes, viewed files. Git in a task: changes and staging, commit
and push, history, stashes, merge and rebase, and resolving a conflict. Explaining a commit with a
model. Sources: `docs/github-integration.md`, `docs/diff-rendering.md`, `docs/git-client/history.md`,
`docs/git-client/conflicts.md`.

### `/features/desktop-and-terminal/`

The desktop app and the terminal client are two clients of the same workspace, drawing the same panes
from the same code. What the terminal client draws differently: one pane at a time, and the rectangles
it can't draw. The command line for scripts. One specimen of a plugin pane on both hosts. Sources:
`docs/tui.md`, `docs/ui-design/shell-hierarchy.md`, `docs/cli.md`.

### `/features/task-tools/`

The panes a task can show beside its agents: Editor, Database, HTTP, Docker, Preview, Notes, Context,
Linear, and Rollbar. One section each, one picture each, and a link to its built-in plugin page. Sources:
the plugin pages in the [site map](./site-map.md#built-in-plugins).

### `/features/automation/`

Workflows: a graph of agent, terminal, check, and gate steps, written in a file or in the app. Runs you
can watch, with gates you answer. Schedules for work that runs whether or not a client is open.
Dashboards over typed data sources. The command line for scripting. Sources: `docs/workflows.md`,
`docs/schedules.md`, `docs/dashboards.md`, `docs/cli.md`.

### `/features/browser/`

The extension's sidebar: talk to a task's agent, send a page, a selection, a screenshot, or an element.
Task chips on GitHub, Linear, and other sites that bring an item into a task. Matching a page to its
task. Waiting requests on the toolbar badge. How it connects: a native bridge to your Node, with no
token in the browser. Sources: `docs/browser-extension.md` and its topic pages.

### `/features/nodes/`

A Node holds your data and runs your agents. The desktop app runs one on your machine. Pair others,
including a standalone Node on a server, and use them from the desktop, the terminal, or the command
line. The fleet view across Nodes. Backups. Sources: `docs/architecture-overview.md`,
`docs/architecture/fleet.md`, `docs/node-distribution.md`, `docs/data-layer/backup-and-retention.md`.

### `/features/plugins/`

Most of acorn is plugins, and the ones you install use the same seams. A plugin draws with acorn's own
components, so its pane works in both clients. What a plugin can add, as a grid of links to the guides.
Plugins extending each other through extension points. How trust works: permissions in the manifest,
accepted per device. Asking your agent to write one. Sources: `docs/extensibility.md`,
`docs/plugin-map.md`, `docs/contribution-kinds.md`.

### `/features/security/`

What acorn keeps from agents: task-scoped tokens, no provider credentials, path confinement, and a
check on changed project instructions. What it keeps from plugins: the sandbox, the permission list,
and per-device consent. Where your credentials live. The audit log. Telemetry off by default. And what
acorn doesn't protect against, in plain words. Sources: `docs/security.md` and its topic pages,
`docs/telemetry.md`.

### `/features/`

The index: one card per page above, each with its one sentence and a small picture, in phase 1's
order.

## Steps

1. Build the template as an Astro layout from the phase 6 components.
2. Write each page from its sources. Verify every UI claim in a `dev:agent` or `dev:tui:agent` session,
   because internal docs describe contracts, not what's on screen.
3. Add specimens that don't exist to phase 3's gallery, and ask for any missing snapshot in phase 7.
4. Run the voice review on each page and get James's approval.

## Acceptance

- All ten pages and the index are written, out of draft, and approved.
- Every section links to a docs page.
- Every page has an "In the terminal" section that matches `docs/first-party-plugins/terminal.md`.
- Each page passes the budget check and axe.
