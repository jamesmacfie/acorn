# Terminal & agents

The terminal drawer, agent sessions, and the agent-monitoring surfaces: the bottom drawer of
persistent local shell/agent sessions scoped to the active task, and the right-rail Agents panel that
watches them. This describes what is in code today. (The historical design record, `vNext.md`, has
been removed — see git history for the original rationale.)

> **Availability.** This surface is **desktop-only and always on** (the old `acorn:term`
> localStorage flag is deleted). In Electron the native terminal capability is present; in a plain
> browser (`dev:node`) `terminalApi()` returns `null` and consumers show a degraded state
> (`capabilities()`, `apps/desktop/src/core/client/capabilities.ts`). The workflow runtime is
> implemented with deliberate limits documented in [workflows.md](./workflows.md).

## 1. Overview

- The **terminal drawer** is a bottom overlay of persistent local sessions, **scoped to the active
  task** — a session opened under task A never appears under task B, regardless of the URL
  (`TerminalPanel.tsx`, `visibleSessions`).
- A session is a **shell** or an **agent** (Claude Code / Codex / Aider). Agents run as ordinary PTY
  sessions launched in the task's **git worktree**, which is created lazily on the first terminal for
  that task.
- The **Agents panel** is a right-rail overlay opened from the task view's Agents toggle (glyph `⠿`,
  `TaskView.tsx:347`). It is a managed monitoring surface over the same sessions plus workflow steps
  — a roster, a launcher, and a per-agent activity feed. It never replaces the raw xterm drawer; the
  drawer stays the escape hatch for interactive TUIs.

The whole UI follows the app's flat/monospace design language ([ui-design.md](./ui-design.md)):
Berkeley Mono, 1px borders, token-driven light/dark. xterm renders to its own canvas and can't read
CSS, so `terminal/theme.ts` ships an explicit light and dark `ITheme` (full ANSI palette per mode)
that mirrors the app tokens and follows the theme live.

## 2. Sessions & persistence

The wire contract is defined once in `apps/desktop/src/core/shared/terminal.ts` (`TerminalSession`,
`CreateOpts`, `ServerMsg`) and imported by main, server, and renderer; it never exposes `node-pty`
types. The main process owns PTYs in `plugins/terminal/main/terminal.ts`. Request/response control
travels through authenticated loopback HTTP routes, while PTY output/input, status, and workflow
events use the single WebSocket. The preload retains only the native folder picker used to map a
repository checkout.

### Two backends

`profiles.ts` gives each profile a `backendPreference`; `resolveBackend` (`terminalUtils.ts`)
degrades `tmux` → `node-pty` when tmux isn't on PATH. The degrade is no longer silent: profiles
carry a `tmuxMissing` hint (`listProfiles`) and the drawer's profile menu renders
"tmux missing — won't survive restart" next to the existing "not found" affordance.

| Backend | Used by (default) | Lifetime | Persisted? |
| --- | --- | --- | --- |
| `node-pty` | Shell | Dies with the app process (survives a window reload, since the PTY lives in main) | No — in-memory `sessions` map only |
| `tmux` | Claude Code / Codex / Aider | Survives an app restart; the tmux server keeps running | Yes — one row per session in `terminal_sessions` |

Only tmux sessions are DB-persisted. Each is a detached `tmux new-session -A -d` named
`acorn-<uuid>` (`terminalUtils.ts:17-23`); the tmux status bar is turned off per session
(`set-option status off`, `ensureTmuxSession` in `terminal.ts`) so the drawer shows only the program, and acorn drives
it through a separate **attach PTY**. Killing the attach PTY only detaches — to actually stop a tmux
agent, `killSession` kills the tmux session itself, which EOFs the attach PTY (`killSession`, `terminal.ts`).

### Persistence & reconciliation

The `terminal_sessions` table (`server/db/schema.ts:423`) is a **machine-scoped** subset of the meta:
`id, title, kind, profileId, backend, status, cwd, taskId, command, argvJson, tmuxSession,
cols, rows, createdAt, exitedAt, exitCode`. There is no stored pid or `last_attached_at` — liveness
is re-derived from tmux, not a pid. Repo/branch/PR are **not** stored loosely; they derive through
the `taskId → tasks` join.

On startup, `reconcileTmux` (`terminal.ts`) reads every row, intersects against
`tmux list-sessions` (`parseTmuxSessions`), re-attaches survivors (rebuilding an attach PTY), and
**deletes rows whose tmux session is gone**. `isWorktree` is derived, never persisted:
`tasks.worktreePath` is the truth (docs/workspaces 03) and main recomputes
`cwd === task.worktreePath` both at session create and during `reconcileTmux`, so a session that
survives an app restart keeps its worktree-cleanup affordance.

**No terminal output is ever stored.** Recent output lives only in an in-memory ring buffer per
session (`RING_CAP = 256 KiB`, `terminalUtils.ts:6`), trimmed to the last bytes and replayed to a
renderer on attach. Nothing is written to disk or the DB.

### The renderer session store

`plugins/terminal/client/sessions.ts` is a single lifted store so the rail and
topbar can read live session state even when the drawer is closed:

- `initSessions()` (called once in App) pulls the list, then subscribes to the **single** `onStatus`
  ping from main; every ping calls `refreshSessions()`.
- `refreshSessions()` re-lists and, before replacing the snapshot, calls `trackSessionEdges` — the
  notification-centre edge detection that fires toasts on idle/exit transitions (see
  [frontend.md](./frontend.md) notifications).
- `workingCountFor(taskId)` (running agent, not idle) feeds the rail's per-task spinner and the topbar
  badge; `agentSessionsFor(taskId)` (running agents, newest first) is the send-to-agent target picker.

## 3. The drawer UI (`TerminalPanel.tsx`)

A `Portal`-rendered `<aside class="terminal-drawer">`, one per active task.

- **Resizable.** Height seeds once from the `term_height` pref, then drag-to-resize persists it back
  (`onHandleDown` → `setPref('term_height', …)`). The live height is published as the
  `--term-drawer-h` CSS var so the task panes shrink to sit above the drawer rather than being covered.
- **Tab strip.** One tab per visible session with a status dot (running / exited / idle) and a one-
  click `✕` that kills-then-drops (`closeTab` → `api.remove`); closing the last tab closes the drawer.
  An `idle` badge shows on an agent that has gone quiet.
- **Profile menu.** The `+` opens a menu of `profiles()` (Shell / Claude Code / Codex / Aider). A
  profile whose command isn't on PATH is **disabled** with a "not found" hint (`available: false`).
- **First-use repo-path prompt.** `startProfile` looks up the task's repo → local checkout mapping
  (`api.repoPath.get`). If unmapped, it shows an inline prompt with a **native folder picker**
  (`api.repoPath.pick`, `📁`); `submitPath` validates the path in main (`api.repoPath.set`) before
  spawning. See §4 for what the checkout is used for.
- **Rail default.** On mount, if the `term_rail_default` pref names a profile (not `empty`), the
  drawer auto-launches it, showing a "Launching…" loader instead of the empty state.
- **Ctrl-C interrupt.** While the active session is running, a `^C` button writes `\x03` to the
  foreground process (`term:interrupt`).
- **Cmd/Ctrl+W** closes the active tab when focus is inside the drawer — main suppresses the native
  window-close accelerator and pings `onClosePane` (`preload.ts:11`).

### `TerminalSurface.tsx`

One xterm bound to one live session over the authenticated WebSocket. Keyed by session id in the parent, so switching tabs
unmounts this component (detach, PTY keeps running) and remounts a fresh xterm that **replays the ring
buffer**. Local scrollback beyond the 256 KiB ring is lost on a tab switch (marked `ponytail:`). It
attaches via `api.attach`, writes keystrokes with `api.write`, and reports resizes with `api.resize`
(a `ResizeObserver` refits on drawer drag). Shift+Enter is remapped to send a bare `\n` (Claude's
newline) instead of the `\r` that would submit.

## 4. Profiles & worktrees

### Profiles (`core/main/agentProfiles/`, `core/main/profiles.ts`)

Profiles are registry contributions. Each declares command, backend preference, MCP registration,
headless argv, resume argv, stream parsing, and an optional tool-free one-shot structured argv. The
built-ins are `shell`, `claude-code`, `codex`, and `aider`; unsupported capabilities are absent
instead of inferred from profile ids. `profileAvailable` checks `which`; shell is always available.

### Worktrees (`core/main/worktrees.ts`, `resolveTaskCwd` in `core/main/taskWorktree.ts`)

The task's git worktree is created **lazily on the first terminal** (Flow C). The renderer passes the
base checkout as `opts.cwd`; main derives the worktree from it via `ensureWorktree`, persists
`worktreePath` on the task, and cwds the session there. Worktrees live under the app data dir, keyed
by branch (`worktreeBranchDirName` = `<owner>-<repo>-<branch-slug>`); all git runs in the **main
checkout** (which owns the `.git` the worktree links to). A PR task checks out `pull/<n>/head`
detached; a local-first task reuses or creates its branch from the resolved base ref (per-repo pref →
`origin/main` → `origin/master` → HEAD). On the fresh-create path only, the workspace setup script
runs as a "Setup" tab first (`maybeRunSetup`), and configured `copy` files are carried in.

### `ACORN_*` environment injection (`buildSessionEnv`, `terminalUtils.ts:138`)

Every task-scoped session and lifecycle script starts from a controlled `childEnv` whitelist (HOME,
PATH, SHELL, LANG, LC_ALL, USER, LOGNAME, TMPDIR, TERM — **never** `SESSION_ENC_KEY` /
`GITHUB_CLIENT_SECRET`), plus the acorn identity vars:

| Var | Value |
| --- | --- |
| `ACORN_TASK_ID` | The task id — the keystone that scopes every task-aware MCP tool |
| `ACORN_WORKTREE_PATH` | The session cwd (the task's worktree) |
| `ACORN_REPO` | `owner/name` |
| `ACORN_BRANCH` | The task branch |
| `ACORN_TASK_SLUG` | Filesystem/DNS-safe branch slug (isolation handle for parallel tasks) |
| `ACORN_TASK_TITLE` | The task title |
| `ACORN_SESSION_ID` | This session's id — used for `author: agent` provenance on MCP notes/memory writes |
| `ACORN_API_URL` / `ACORN_API_TOKEN` | The loopback URL + token for the in-process API, so an agent's MCP server can call back |
| `ACORN_TOOL_CEILING` | Workflow-only encoded allowlist/risk cap, forwarded by MCP and intersected with user permissions |

`ACORN_TASK_ID` is the keystone: the acorn MCP server reads it to scope every task-aware tool (see
[mcp.md](./mcp.md)). When an **agent** profile spawns, its acorn MCP server is auto-registered with
the agent's CLI first (`registerAcornMcp`, idempotent, failures swallowed), so the current task's
tools are always available with no manual "Register" click.

## 5. Agent status — the one `AgentState` vocabulary

`AgentState` is declared **once** in `shared/terminal.ts:7` and reused verbatim everywhere. No other
module redeclares it:

```
starting | working | waiting | idle | blocked | permission | done | unknown
```

Each transport emits only the subset it can detect:

- **PTY transport** (interactive drawer/tmux sessions) emits `working | idle | blocked | done |
  unknown`, derived without transcript-scraping (`ptyState`, `terminal.ts:103`):
  - Shells are always `unknown`.
  - An agent flips **`working` → `idle`** after `IDLE_MS` (10s) of PTY output silence
    (`computeIdle`, one interval in `startIdleWatch`), and back to `working` on the next byte of output.
  - On the busy→idle edge, if the tail of the ring matches an input-prompt heuristic
    (`matchBlockedPrompt` — a small pattern list: `(y/n)`, `press enter`, a trailing `?`), the state
    is **`blocked`** instead of `idle`. This is a heuristic with a known ceiling (`ponytail:`).
  - An exited agent is `done`.
- **Headless / managed transport** (workflow steps, `main/headless.ts`) runs an agent CLI to
  completion capturing `stream-json`, and can emit the full set. The renderer maps events with
  `streamJsonToAgentState` (`agents/model.ts:11`): `system → starting`, `assistant/tool_use/
  tool_result/user → working`, `permission_request → blocked`, `result → done`.

## 6. The Agents panel (`agents/AgentsPanel.tsx` + `agents/model.ts`)

One right-rail overlay, toggled from the task view. `model.ts` holds the pure, unit-tested mappers;
`AgentsPanel.tsx` is thin glue. Workflow transitions refetch on WS status pings; parsed headless
events arrive live on `workflow:step:event`. Running steps expose kill-step and cancel-run actions,
and a quiet step shows a no-output hint after 30 seconds.

- **Roster** (`buildRoster`) merges the task's live PTY sessions with its workflow steps into one
  ordered list: **needs-you first** (`blocked` / `waiting-gate`), then active (`working`/`starting`),
  then the rest, newest first. Each row shows a state glyph, title, the state word, and — for a
  workflow step — its `costUsd`.
- **`+ New agent`** launcher lists the terminal profiles (disabled when not on PATH); launching one
  `create`s an interactive session and opens the raw drawer (`setTerminalOpen`) — interactive agents
  live in the drawer, not this panel.
- **Per-agent view.** For a **workflow step** it renders an activity feed parsed from the persisted
  headless `stream-json` (`stepFeed` → `feedFromEvents` → `streamJsonToFeedItems`): messages,
  thinking, tool calls/results, and a final `result` line with cost. For a step at a human gate it
  shows an inline **Approve / Reject** that calls `api.workflow.gate` (see [workflows.md](./workflows.md)).
  For an interactive **session** it just points to the terminal drawer.
- **Open in terminal.** For a step with a captured `sessionId`, `resumeCommandFor` builds
  `codex resume <id>` or `claude --resume <id>` (session ids are validated as opaque tokens — never
  shell metachars) and opens it as a raw TUI in the drawer.

### Provider usage

The panel's **Usage** section is account-scoped, unlike the task-scoped roster below it. One
main-process service collects Claude and Codex concurrently, caches the normalized snapshot for
five minutes, and retains a stale last-good provider when its next refresh fails. The rail toggle
reads that same client store, so hovering never launches a subprocess; its tooltip summarizes each
provider's current session percentage and health. The panel's `↻` action forces a refresh.

- **Claude** runs `claude /usage --allowed-tools ""` through a bounded PTY and replays the
  full-screen output through `@xterm/headless` before parsing session, weekly, model-specific, reset,
  plan, account, and optional Extra Usage fields. `CLAUDE_CODE_OAUTH_TOKEN` is deliberately omitted
  so the CLI uses its existing stored login. API-billed accounts fall back to `claude /cost`.
- The Claude collector also reads recent `~/.claude/projects/**/*.jsonl` assistant usage records.
  It returns only aggregate token/time/session counts and locally estimated cost/cache savings;
  prompts, responses, project paths, message IDs, and request IDs never reach the renderer.
  Estimates use a local table checked against
  [Anthropic's published pricing](https://platform.claude.com/docs/en/about-claude/pricing) and are
  labeled estimated rather than billed cost.
- **Codex** first uses newline-delimited JSON-RPC with
  `codex -s read-only -a untrusted app-server` and `account/rateLimits/read`. A failed RPC probe
  falls back to the same bounded PTY runner with `/status`; this fallback can report the 5-hour and
  weekly percentages but may not include reset times.

Both commands inherit a small environment allowlist and have a 20-second deadline and 2 MiB output
cap. Acorn does not call provider usage HTTP APIs, read OAuth credentials into the renderer, refresh
tokens, or store usage in SQLite/IndexedDB. Claude may require its dedicated
`<dataDir>/agent-usage-probe` directory to be trusted. Acorn first answers the CLI prompt; if that
does not stick, it atomically adds only that exact path's `hasTrustDialogAccepted` entry to
`~/.claude.json`, preserving unknown keys and refusing malformed/unexpected config shapes.

Health derives from percentage remaining: green at 50% or above, yellow from 20% to below 50%, red
above 0% to below 20%, and neutral at 0% or when unavailable. A missing, logged-out, outdated,
timed-out, or no-longer-parseable CLI becomes a provider-local error and does not hide the other
provider.

## 7. Send-to-agent

The Changes / Editor / Context panes can push text into a live agent without leaving them.
`agent/reference.ts` formats a `path` / `path:42` / `path:42-48` reference (`formatFileReference`) and
`sendReferenceToAgent` delivers it as a **draft** to the task's most-recent running agent session
(`agentSessionsFor(taskId)[0]`).

Delivery is `api.sendToAgent(sessionId, text, submit)` where `submit ∈ 'now' | 'after-ready' |
'draft'`. Main wraps the payload in **bracketed paste** (`wrapBracketedPaste`, `terminalUtils.ts:126`)
so an agent TUI treats a multi-line prompt as one block instead of submitting per line; stray paste
markers are stripped (an embedded `ESC[201~` would end the paste early — an injection risk). `now`
submits with a trailing `\r`; `after-ready` is queued and flushed on the next busy→idle edge
(`agentSender.onIdle`); `draft` inserts the text without submitting, letting the user finish the
thought. Queued sends are cleared if the session exits.

## 8. Transport and native residue

`terminalApi()` in `plugins/terminal/client/terminalClient.ts` composes three transports and returns
`null` off-desktop:

| Transport | Operations |
| --- | --- |
| Loopback HTTP | List/create/control sessions; profiles; repo mappings; task lifecycle/status; run targets; workflow commands; send-to-agent. Bodies are validated and task paths are re-derived in main. |
| WebSocket | PTY attach/input/output, session status edges, workflow notices, and live step events. `attach` returns an unsubscribe that detaches without killing the PTY. |
| Preload IPC | `repoPath.pick()` only—the native `dialog.showOpenDialog` capability. Raw `ipcRenderer` is never exposed. |

Preview `WebContentsView` operations use their own narrow preload surface because view ownership,
bounds, and navigation are Electron capabilities; agent browser tools remain server-projected.

## Source

- Renderer terminal: `apps/desktop/src/plugins/terminal/client/{TerminalPanel,TerminalSurface}.tsx`,
  `sessions.ts`, `terminalClient.ts`, `theme.ts`
- Renderer agents: `apps/desktop/src/plugins/agents/client/{AgentsPanel.tsx,model.ts}`,
  `apps/desktop/src/core/client/agent/reference.ts`
- Capability + panel wiring: `apps/desktop/src/core/client/capabilities.ts`,
  `apps/desktop/src/core/client/tasks/TaskView.tsx`
- Wire contract & vocabulary: `apps/desktop/src/core/shared/terminal.ts`
- Terminal engine: `apps/desktop/src/plugins/terminal/main/`; worktrees, profiles, headless execution,
  preload and notifications: `apps/desktop/src/core/main/`; cross-feature wiring:
  `apps/desktop/src/app/main/`
- Schema: `apps/desktop/src/core/server/db/schema.ts` (`terminal_sessions`, `workflow_runs`, `workflow_steps`)

## See also

- [workflows.md](./workflows.md) — the headless step runner, run targets, and human gates
- [mcp.md](./mcp.md) — how `ACORN_TASK_ID` + the loopback env scope the task-aware MCP tools
- [panes.md](./panes.md) — the Changes/Editor/Context panes that feed send-to-agent
- [workspaces-and-tasks.md](./workspaces-and-tasks.md) — tasks, worktrees, and archive/teardown
- [frontend.md](./frontend.md) — the notification centre driven by session edge-detection
