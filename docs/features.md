# Features

A capabilities tour: what acorn can do, where each feature lives in the UI, and the deeper doc for
each. For system design (the one-server model, caches, request flow) read
[architecture-overview.md](./architecture-overview.md) instead — this doc is the feature map.

## What acorn is

acorn began as a **GitHub pull-request review tool** and has grown into a **local macOS agent
workspace**: a keyboard-driven desktop app for reviewing PRs *and* driving coding agents (Claude
Code, Codex, aider) against your repositories, each in its own git worktree. It is a SolidJS
single-page app served by one in-process Hono server running in the Electron main process, backed by
a local SQLite mirror of GitHub. Everything runs on one machine for one user.

The whole UI is monospace (Berkeley Mono), 1px borders, square panes, token-driven light/dark — see
[ui-design.md](./ui-design.md).

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
rendered as a 3px accent on task rows) and per-workspace scripts (setup / dev / dev-restart /
teardown) plus browser-preview config, all edited in **Settings → (workspace)**.

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

Inside a task, the view is a flat left→right row of open **panes** (one pure reducer,
`applyLayoutAction`, owns every transition in
`apps/desktop/src/client/features/tasks/layout.ts`). A switcher click **shows** a single pane;
⌘/Ctrl-click **opens one beside** the others; each slot gets a close button when more than one is
open. Every pane has an overridable single-key shortcut (Settings → Shortcuts).

| Pane | What it shows |
| --- | --- |
| `pr` | PR review — the Navigator + Diff (only when a PR is linked) |
| `changes` | Uncommitted working-tree review (see below) |
| `notes` | Workspace / global markdown scratchpad |
| `context` | What an assembled agent "send" will include |
| `editor` | In-app code editor over the worktree |
| `preview` | Live `<webview>` preview of the running app, with browser chrome (agent-drivable over CDP) |
| `linear` / `rollbar` | The linked issue panel(s) |

The switcher also hosts **run targets** (one ▶ per configured target — they run as terminal
sessions, acorn allocates no ports), the **Agents** toggle, and the **Terminal** toggle.

→ [panes.md](./panes.md)

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
desktop-only — always on when the preload bridge is present (`capabilities()`,
`apps/desktop/src/client/features/capabilities.ts`); the old `acorn:term` flag is gone. Bridge-absent
(a plain browser via `dev:node`) is the degraded mode.

→ [terminal-and-agents.md](./terminal-and-agents.md)

## Integrations

External issue trackers surface both as browse **Sources** (extra icons in the TabRail, shown only
when connected) and as **task links**:

- **Linear** (live) — browse issues, open the Linear panel beside a task, post comments, link
  tickets to tasks. A task can link several Linear tickets and switch between them.
- **Rollbar** — browse errors as a Source and open the Rollbar pane on a linked task.

Connect / disconnect in **Settings → Integrations**; tokens are encrypted at rest.

→ [integrations.md](./integrations.md)

## Notes & memory

**Markdown notes** live at two scopes — the workspace (shared by every task in the group) and
global (shared across all workspaces) — edited in the Notes pane, written by agents via the MCP
`notes_*` tools. Alongside them sits a **memory system** — durable, searchable facts an agent can
write and recall across sessions (FTS5 full-text search, MCP `memory_*` tools).

→ [notes-and-memory.md](./notes-and-memory.md)

## MCP

acorn ships a stdio **MCP server** (`apps/desktop/src/mcp/server.ts`) that exposes the current
task's context to any agent launched from it — task/PR context, changed files, local diffs, git log,
repo info, linked issues, notes, memory, run targets, and browser driving. Tools loopback into the
running app's Hono API (never their own DB), and return structured "no active task" results when
launched outside acorn. Configure in **Settings → MCP**.

→ [mcp.md](./mcp.md)

## Workflows *(in progress, desktop-only)*

Composable multi-agent orchestration: committed `.acorn/workflows` run as multi-step agent
sequences. The engine has real scaffolding today — schema (`workflow_runs` / `workflow_steps`),
harness run/gate routes, a read-only **WorkflowsSettings** inspector, and command-palette entries —
but it is not a finished orchestrator. Treat it as in-progress.

→ [workflows.md](./workflows.md)

## Command palette & shortcuts

- **⌘K** — the command palette: fuzzy-filtered run targets, layouts, workflows, pane actions,
  "go to task" navigation, and visible (non-invocable) config parse-error rows
  (`features/palette/model.ts`).
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
| MCP | MCP server config |
| Workflows | Read-only workflow inspector |
| Terminal | Default profile when the terminal button is clicked |
| Shortcuts | Editable per-pane keys + the global shortcut reference |
| Permissions | Re-request GitHub access |

---

## Maturity

Be aware of what's real today:

- **Shipped, default-on:** GitHub PR review (list / detail / diff / write actions), Workspaces,
  Tasks, the TabRail, panes, local-changes review, notifications, integrations (Linear live,
  Rollbar), settings, command palette, and the file finder.
- **Desktop-only (bridge-gated, always on):** the terminal drawer, agent sessions, run targets,
  and workflows — available whenever the Electron preload bridge is present (`capabilities()`);
  the `acorn:term` localStorage flag has been deleted.
- **In progress:** the workflow engine — scaffolding exists (schema, routes, inspector, palette),
  but it is not a finished orchestrator.
- **Design-stage (not shipped):** future proposals live in `docs/next/` (the architecture review,
  the plugin-platform design, and its implementation guide) — the features above describe what
  exists in code today.

## Source

- Client shell: `apps/desktop/src/client/App.tsx`; capabilities: `client/features/capabilities.ts`
- TabRail: `apps/desktop/src/client/features/tabs/{TabRail.tsx,sources.ts,railOrder.ts}`
- Task view + panes: `apps/desktop/src/client/features/tasks/{TaskView.tsx,layout.ts}`
- Write actions: `apps/desktop/src/client/mutations.ts`
- Palette / shortcuts: `apps/desktop/src/client/features/palette/model.ts`, `client/Shortcuts.tsx`
- Settings: `apps/desktop/src/client/features/settings/` (SettingsModal is pure tab chrome; each tab body is its own component)
- MCP server: `apps/desktop/src/mcp/server.ts`

See also: [architecture-overview.md](./architecture-overview.md) ·
[workspaces-and-tasks.md](./workspaces-and-tasks.md) · [panes.md](./panes.md) ·
[terminal-and-agents.md](./terminal-and-agents.md) · [integrations.md](./integrations.md) ·
[notes-and-memory.md](./notes-and-memory.md) · [mcp.md](./mcp.md) · [workflows.md](./workflows.md) ·
[command-palette-and-shortcuts.md](./command-palette-and-shortcuts.md)

