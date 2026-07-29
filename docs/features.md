# Features

A capabilities tour: what acorn can do, where each feature lives in the UI, and the deeper doc for
each. For system design (the one-server model, caches, request flow) read
[architecture-overview.md](./architecture-overview.md) instead — this doc is the feature map.

## What acorn is

acorn began as a **GitHub pull-request review tool** and has grown into a **local macOS agent
workspace**: a keyboard-driven desktop app for reviewing PRs *and* driving coding agents (Claude
Code, Codex, aider) against your repositories, each in its own git worktree. It is a SolidJS
single-page app served by one Hono server running in Electron's Node utility process, backed by
a local SQLite mirror of GitHub. Everything runs on one machine for one user.

The UI is token-driven: colour themes compose independently with style packs that control
typography, shape, density, chrome, and motion. See [ui-design.md](./ui-design.md).

---

## PR review

The original core, default-on. Pick a repo from the searchable **repo picker** in the top bar
(pinned repos float to the top; pins persist); the left **Reviews** pane shows a virtualized list of
open/closed PRs. Selecting one opens the **Navigator** (PR detail: title/metadata, conversation
timeline, checks, labels, reviewers) and the **Diff** pane beside it.

Diffs are Shiki-highlighted with unified/split toggle, word-level intra-line highlighting, inline
review-comment threads, per-file "viewed" state, and gap expansion for unchanged regions. See
[diff-rendering.md](./diff-rendering.md).

Write actions go straight to GitHub then update the local mirror (`client/mutations.ts`): merge /
enable-or-disable auto-merge, close / reopen, mark draft / ready, add a comment, submit a review
(approve / request changes / comment), add / remove labels, request / remove reviewers, resolve
threads, reply to review threads, and **re-run failed Actions** (`rerunFailed`). A **create-PR flow**
(the `+ New PR` button, or `c`) opens a compose form with a live compare preview.

→ [github-integration.md](./github-integration.md) · [api-reference.md](./api-reference.md) ·
[diff-rendering.md](./diff-rendering.md)

## Workspaces

A **workspace** is a named group of repos (e.g. "Runn", "Acorn") — the top-level unit picked in the
top bar. A repo belongs to exactly one workspace (a partition); the active workspace is *derived*
from the current repo. Workspaces carry identity (a color plus an emoji / lucide / github icon,
rendered as a 3px accent on task rows); the per-repo scripts (setup / dev / dev-restart / teardown /
db) plus browser-preview config are repo-level, edited per-repo in **Settings → (workspace)**.

First run bootstraps a Default workspace and assigns every mirrored repo; an **onboarding modal**
lets you re-group afterwards. Repos can be **hidden** from a workspace. Repo→workspace assignment
lives in **Settings → Workspaces**.

→ [workspaces-and-tasks.md](./workspaces-and-tasks.md)

## Tasks

A **task** is the single-repo unit of work: repo + branch + optional git worktree + optional linked
PR + its panes and terminals. Its `origin` is one of `github-pr | linear | rollbar | local`. Tasks
appear as rows in the left **TabRail**, scoped to the active workspace.

From a task row you can **pin to top**, **drag-reorder**, **rename**, and **archive** (archive runs
a guarded worktree teardown on desktop). **⌘1–⌘9** jump to the Nth task in the rail. Each row
carries live status glyphs: a PR-checks dot, an agent-working spinner, an unread "needs you" marker,
and worktree status (dirty file count, or a "needs repair" warning if the worktree vanished). New
tasks are created on a fresh branch (slugged from the title) via the rail's `+` button.

→ [workspaces-and-tasks.md](./workspaces-and-tasks.md)

## Panes

Inside a task, the view is a flat left→right row of registered **panes**. One pure reducer owns pane
order, widths, pins, show/add/close, and recipe replacement. A switcher click keeps pinned panes and
shows the target; ⌘/Ctrl-click opens it beside the others. Dividers resize/equalize the row, while
focus and maximize stay session-only. Pane shortcuts are contribution-owned and user-overridable.

| Pane | What it shows |
| --- | --- |
| `pr` | PR review — the Navigator + Diff (only when a PR is linked) |
| `changes` | Uncommitted working-tree review (see below) |
| `notes` | Scratchpad-first task/workspace/global markdown library |
| `context` | Select, preview, size, and sync assembled context to a chosen agent session |
| `editor` | In-app code editor over the worktree |
| `preview` | Kept-alive `WebContentsView` preview of the running app, with browser chrome and agent CDP tools |
| `linear` / `rollbar` | The linked issue panel(s) |
| `database` | Task-scoped PostgreSQL browser/editor, saved queries, and model-assisted SQL |
| `search` | Ripgrep-backed worktree search |
| `docker` | Containers linked to this task, with logs/stats/exec |
| `http` | Encrypted repo/task API requests and variables |

The switcher also hosts **run targets** (one ▶ per configured target — they run as terminal
sessions, acorn allocates no ports), the **Agents** toggle, and the **Terminal** toggle.

→ [panes.md](./panes.md)

## Docker

The always-visible Docker Source browses Compose projects, containers, images, volumes, and
networks, with guarded lifecycle/prune actions. A conditional task pane, rail badge, and footer
badge show containers matched to the current task. Docker daemon events flow through the shared
WebSocket so logs, stats, task summaries, and browse state refresh without an aggressive poll loop.

→ [docker.md](./docker.md)

## API requests

The always-visible API Requests Source and task pane share a server-side HTTP client. Saved
requests belong to a repo; new task-pane requests can remain task-local until filed. URLs, headers,
bodies, auth, request variables, and repo variables are encrypted at rest. Variables can be plain,
secret, or command-backed, resolve only when referenced, and redact from the response timeline.
Only an interactive cookie-authenticated user may send requests.

→ [http-client.md](./http-client.md)

## Local-changes review

The **Changes** pane brings the PR-review experience to uncommitted worktree changes: a GitHub-style
diff over the task's dirty working tree, with **inline review notes** you can attach to lines and
send to the agent working in that worktree. This closes the loop between reviewing an agent's output
and telling it what to fix, without leaving acorn.

→ [panes.md](./panes.md)

## Terminals & agents *(desktop-only)*

The bottom **terminal drawer** is per-task and holds persistent shell / agent sessions running in
the task's git worktree — a plain shell, or a coding agent (Claude Code, Codex, aider). Opening a
terminal creates the worktree on first use, and a PR is inherited automatically once the agent opens
one.

The right-rail **Agents panel** is the roster + launcher + activity feed for agent sessions, and
"agent working" status flows back to the TabRail (spinner) and the topbar. All of this is
desktop-only — always on when the native terminal capability is present (`capabilities()`,
`apps/desktop/src/core/client/capabilities.ts`); the old `acorn:term` flag is gone. Bridge-absent
(a plain browser via `dev:node`) is the degraded mode.

The panel also reads provider usage without persisting it: Claude uses bounded local transcript
aggregates, while Codex uses its app-server usage/status surface. A configurable pricing catalog
turns token categories into local cost estimates; the cache is five minutes and no usage row is
written to SQLite or IndexedDB.

→ [terminal-and-agents.md](./terminal-and-agents.md)

## Integrations

External issue trackers surface both as browse **Sources** (extra icons in the TabRail, shown only
when connected) and as **task links**:

- **Linear** (live) — browse issues, open the Linear panel beside a task, post comments, link
  tickets to tasks. A task can link several Linear tickets and switch between them.
- **Rollbar** — browse errors as a Source and open the Rollbar pane on a linked task.

Connect / disconnect in **Settings → Integrations**; tokens are encrypted at rest.
The same registry also hosts shared OpenAI and Anthropic model-provider connections used by
model-assisted features such as SQL generation.

→ [integrations.md](./integrations.md)

## Notes & memory

**Markdown notes** live at task (the safe default), workspace, and global scopes — edited in the
Notes pane and written by agents via the MCP
`notes_*` tools. Alongside them sits a **memory system** — durable, searchable facts an agent can
write and recall across sessions (FTS5 full-text search, MCP `memory_*` tools).

→ [notes-and-memory.md](./notes-and-memory.md)

## MCP

acorn ships a stdio **MCP server** (`apps/desktop/src/core/mcp/server.ts`) that exposes the current
task's context to any agent launched from it — task/PR context, changed files, local diffs, git log,
repo info, linked issues, notes, memory, run targets, and browser driving. Tools loopback into the
running app's Hono API (never their own DB), and return structured "no active task" results when
launched outside acorn. Configure in **Settings → MCP**.

→ [mcp.md](./mcp.md)

## Workflows *(desktop-only)*

Composable multi-agent orchestration: committed `.acorn/workflows` run as multi-step agent
sequences. The durable runtime supports registry-backed step kinds, profiles and policies; explicit
joins and conditional branches; named-output templates; per-run tool ceilings; bounded fan-out;
cancellation; human/policy gates; live step events; run-scoped handoffs; and app-open triggers.
Definitions remain file-authored, and execution advances only while the app is open.

→ [workflows.md](./workflows.md)

## Command palette & shortcuts

- **⌘K** — the command palette: fuzzy-filtered run targets, layouts, workflows, pane actions,
  "go to task" navigation, and visible (non-invocable) config parse-error rows
  (`core/client/palette/model.ts`).
- **⌘P** — go-to-file across the task worktree.
- **`/`** — find file within the current PR's changed files (the finder overlay).
- **`j` / `k`** — next / previous PR; **`[` / `]`** — previous / next file; **`c`** — create PR;
  **`?`** — open the shortcut reference (Settings → Shortcuts); **Esc** — close overlay.

The full reference lives in Settings → Shortcuts; per-pane keys are user-overridable there.

→ [command-palette-and-shortcuts.md](./command-palette-and-shortcuts.md)

## Notifications

A topbar **bell** (`NotificationBell`) surfaces agent-status notices and per-task unread markers.
Selecting a notice navigates to the relevant task and marks it read; unread tasks also show a
"needs you" marker in the TabRail. Notices persist across sessions (the last ~50, in a prefs blob —
ephemeral app state, not a table).

## Settings

Reached from the account menu. A left tab rail:

| Tab | Contents |
| --- | --- |
| Workspaces | Repo→workspace assignment (and hide/ignore repos) |
| *(per workspace)* | Identity (color/icon), scripts, browser preview, projects |
| Appearance | Theme (12 themes) + follow-system light/dark |
| Integrations | Connect / disconnect Linear, Rollbar |
| Agent tools | Per-tool policy and permission controls |
| Agent pricing | Provider/model pricing overrides used for local usage estimates |
| Docker | Daemon status, stopped-container visibility, destructive confirmations |
| API requests | HTTP-client behavior and stored-variable controls |
| API | Opt-in public automation listener and bearer-token administration |
| MCP | MCP server config |
| Workflows | Read-only workflow inspector |
| Terminal | Default profile when the terminal button is clicked |
| Shortcuts | Editable per-pane keys + the global shortcut reference |
| Permissions | Re-request GitHub access |

---

## Availability

Be aware of what's real today:

- **Shipped, default-on:** GitHub PR review (list / detail / diff / write actions), Workspaces,
  Tasks, the TabRail, panes, local-changes review, Docker/API-request sources, database/model
  providers, notifications, integrations (Linear and Rollbar), settings, command palette, and the
  file finder.
- **Desktop-only (capability-gated, always on):** the terminal drawer, agent sessions, run targets,
  and workflows — available whenever the Electron terminal capability is present (`capabilities()`);
  the `acorn:term` localStorage flag has been deleted.
- **Deliberate workflow limits:** no GUI workflow authoring, daemon/background runner, general DAG,
  cost budgeting, or recovery graph. See [workflows.md](./workflows.md).

## Source

- Client shell: `apps/desktop/src/core/client/App.tsx`; capabilities: `core/client/capabilities.ts`
- TabRail: `apps/desktop/src/core/client/tabs/{TabRail.tsx,sources.ts,railOrder.ts}`
- Task view + panes: `apps/desktop/src/core/client/tasks/{TaskView.tsx,layout.ts}`
- Write actions: PR verbs in `apps/desktop/src/plugins/github/client/mutations.ts`; workspace/repo and
  task/review-note writes in `core/client/{workspaces,tasks}/mutations.ts`
- Palette / shortcuts: `apps/desktop/src/core/client/palette/model.ts`, `plugins/github/client/Shortcuts.tsx`
- Settings shell: `apps/desktop/src/core/client/settings/`; contributed pages live with plugins
- MCP server: `apps/desktop/src/core/mcp/server.ts`

See also: [architecture-overview.md](./architecture-overview.md) ·
[workspaces-and-tasks.md](./workspaces-and-tasks.md) · [panes.md](./panes.md) ·
[terminal-and-agents.md](./terminal-and-agents.md) · [integrations.md](./integrations.md) ·
[notes-and-memory.md](./notes-and-memory.md) · [mcp.md](./mcp.md) · [workflows.md](./workflows.md) ·
[command-palette-and-shortcuts.md](./command-palette-and-shortcuts.md) ·
[docker.md](./docker.md) · [http-client.md](./http-client.md)
