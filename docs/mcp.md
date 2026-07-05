# MCP

acorn ships a **stdio MCP server** that exposes the current task's context — PR, linked issues,
notes, memory, local git, run targets, the preview browser — as tools an agent can call, plus a
read-only **Settings → MCP** inspector for the agents' own config files. This doc covers both.

> Maturity: the MCP server and its Settings surface are wired and used when the desktop app is
> running (the agent/terminal features it depends on are desktop-only and always on; see
> [terminal-and-agents.md](./terminal-and-agents.md)). The feature-tool endpoints require
> the main-process harness bridge and degrade to a clean `503` without it (e.g. `dev:node`).

## 1. What it is

The server is a stdio MCP server named **`acorn`** (`acorn-dev` in unpackaged builds), built on
`@modelcontextprotocol/sdk` in `apps/desktop/src/mcp/server.ts` (tools only — the stdio entry is
the dedicated `apps/desktop/src/mcp/main.ts`, and the loopback HTTP client lives in
`apps/desktop/src/mcp/api.ts`). Two properties define it:

**It is launched by the agent, not by acorn.** acorn never starts or supervises the MCP process.
Instead it registers the server through each agent's *own* mechanism — `claude mcp add --scope user`,
`codex mcp add` — pointing at an "Electron-as-node" launcher: the app's own binary run with
`ELECTRON_RUN_AS_NODE=1` against the bundled entry `out/main/mcp.js` (built from `src/mcp/main.ts`;
`launcherSpec` in `apps/desktop/src/main/mcpRegister.ts` also passes the flavoured registration
name through as `ACORN_MCP_NAME`). This means the user needs no system Node, and acorn
does not write through into the agents' config files — the agent owns its config
(`apps/desktop/src/main/mcpRegister.ts:1-4`).

**It scopes itself entirely from inherited environment.** The registration is *user-wide*, so every
Claude Code / Codex process the user opens loads the server — including plain terminals with no task.
The server therefore reads its identity from the env it inherits (`src/mcp/server.ts` + `src/mcp/api.ts`):

| Env var | Meaning |
| --- | --- |
| `ACORN_TASK_ID` | which task this session belongs to (empty = no task) |
| `ACORN_API_URL` | loopback base into the running app's Hono API (default `http://127.0.0.1:4317`) |
| `ACORN_API_TOKEN` | the per-app-run internal token sent as `x-acorn-internal` |
| `ACORN_WORKTREE_PATH` | the task's worktree, for the direct-git tools |
| `ACORN_SESSION_ID` | this terminal session's id, stamped on notes/memory writes for provenance |

These are injected into every task-scoped terminal session by the main process
(`buildSessionEnv`, `apps/desktop/src/main/terminalUtils.ts:138-157`, plus `internalApiEnv` and
`ACORN_SESSION_ID` in `spawnOne`, `apps/desktop/src/main/terminal.ts`). See
[terminal-and-agents.md](./terminal-and-agents.md) for the full `ACORN_*` injection story.

## 2. The key design property: everything goes over loopback

The tools **never open their own SQLite DB or GitHub client.** Every context/notes/memory/run/browser
tool calls the running app over loopback with `x-acorn-internal: <ACORN_API_TOKEN>`
(`apiCall` in `apps/desktop/src/mcp/api.ts`). The direct-git tools are the only exception — they shell
`git` against `ACORN_WORKTREE_PATH` via the same module the Changes pane uses.

That token is matched by `internalUser` in `apps/desktop/src/server/middleware/auth.ts:14-22`: a
request bearing the correct `INTERNAL_TOKEN` is resolved to the machine's single user (this is a
single-user, machine-local app). Two consequences follow:

- **An agent sees exactly what the UI sees.** Both read the same local mirror through the same Hono
  routes, so there is one source of truth and no drift.
- **The internal user has an empty GitHub token** (`{ token: '', login, … }`). Internal callers can
  read the local mirrors but can **never** call GitHub. An agent cannot exfiltrate or spend your
  GitHub credentials through the MCP surface.

**Graceful degradation is structural, never a protocol error** (`taskTool`, `apps/desktop/src/mcp/server.ts`):

- No `ACORN_TASK_ID` → task-scoped tools return `{ status: 'no-active-task', hint: … }`.
- App not reachable → `{ status: 'acorn-not-running', detail: … }` (fetch threw).
- An API error → `{ status: 'api-error', detail: '<status> <body>' }`.

Because the registration is user-wide and plain terminals load the server too, returning a *result*
rather than throwing keeps those sessions clean.

## 3. Tool catalog

Every tool returns a text content block (JSON stringified). Task-scoped tools resolve
`ACORN_TASK_ID`; the git tools resolve `ACORN_WORKTREE_PATH` (and return the same `no-active-task`
shape when it is missing).

| Tool | Returns | Backing |
| --- | --- | --- |
| `task_current` | current task: repo, branch, worktree, PR number, linked issues | `GET /api/tasks/:id/context?include=issues` |
| `task_context` | assembled context (PR, issues, notes, memory index); `include` filter | `GET /api/tasks/:id/context[?include=…]` |
| `pr_current` | linked PR (title, body, changed-file count) from the local mirror; `no-pr` if none | `GET /api/tasks/:id/context?include=pr` |
| `pr_changed_files` | changed file paths of the linked PR | `GET /api/tasks/:id/context?include=pr` |
| `linked_issues` | issues/errors linked to the task (Linear, Rollbar); optional `provider` filter | `GET /api/tasks/:id/context?include=issues` |
| `repo_info` | repo owner, name, default branch, task branch, worktree path | `GET /api/tasks/:id/repo-info` |
| `local_changes` | uncommitted changes (`git status`): staged/unstaged/untracked file list | `localChanges()` — direct git |
| `local_diff` | unified diff of one uncommitted file; `path`, `scope` (`unstaged`/`staged`) | `localDiff()` — direct git |
| `git_log` | recent commits on the branch; optional `n` (1–100, default 10) | `gitLog()` — direct git |
| `notes_list` | workspace notes for the task (slug, title, kind, author) | `GET /api/tasks/:id/notes` |
| `notes_read` | one note body; `slug` | `GET /api/tasks/:id/notes/:slug` |
| `notes_write` | replace a note body (creates if missing), attributed to this agent | `PUT /api/tasks/:id/notes/:slug` |
| `notes_append` | append to a note (findings/plans/handoffs), attributed to this agent | `POST /api/tasks/:id/notes/:slug/append` |
| `memory_search` | ranked, repo-scoped search over committed memory; `query`, optional `type` | `GET /api/tasks/:id/memory?q=…` |
| `memory_list` | the repo memory index (name + description); optional `type` | `GET /api/tasks/:id/memory` |
| `memory_get` | one memory in full (body + file path); `name` | `GET /api/tasks/:id/memory/:name` |
| `memory_write` | **PROPOSE** a new memory — human-gated, nothing lands directly | `POST /api/tasks/:id/memory/propose` |
| `browser_navigate` | navigate the preview browser to a URL (http(s) only) | `POST /api/tasks/:id/browser/navigate` |
| `browser_snapshot` | accessibility tree with element refs (`e1`, `e2`, …) | `GET /api/tasks/:id/browser/snapshot` |
| `browser_click` | click an element by snapshot `ref` | `POST /api/tasks/:id/browser/click` |
| `browser_fill` | fill a textbox by `ref` (replaces value) | `POST /api/tasks/:id/browser/fill` |
| `browser_screenshot` | screenshot of the current page (png data URI) | `GET /api/tasks/:id/browser/screenshot` |
| `browser_console` | recent page console output | `GET /api/tasks/:id/browser/console` |
| `run_targets` | declared run targets with live status | `GET /api/tasks/:id/run` |
| `run_start` | start a run target; `id` | `POST /api/tasks/:id/run/:target/start` |
| `run_stop` | stop a run target (runs its declared `stop` first); `id` | `POST /api/tasks/:id/run/:target/stop` |
| `run_restart` | restart a run target (declared restart, else stop+start); `id` | `POST /api/tasks/:id/run/:target/restart` |
| `run_status` | a target's `{ running, url?, exitCode? }`; `id` | `GET /api/tasks/:id/run/:target/status` |

Notes:

- **Writes are proposals or stamped, never silent.** `notes_write`/`notes_append` write through the
  harness attributed to `author: agent` with this session's id
  (the notes tools in `apps/desktop/src/mcp/server.ts`). `memory_write` **only proposes** — a human reviews
  before anything lands as memory (`.../memory/propose`, gated in `harness.ts:83-98`). See
  [notes-and-memory.md](./notes-and-memory.md).
- **The `run_*` tools are conditionally registered.** They only exist when the task actually has run
  targets (the `run_*` block in `apps/desktop/src/mcp/server.ts`), resolved once at connect via
  `hasRunTargets()`. An agent in a repo with nothing to run never sees them. See
  [workflows.md](./workflows.md).
- **The browser tools** drive the task's preview webview over CDP; navigate with a URL from
  `run_status`, not a guessed port. `browser_snapshot` yields refs for `browser_click`/`browser_fill`.
- The git tools keep git's default `-U` context (token-efficient hunks); the Changes pane uses the
  same `localDiff` with a large context value for its whole-file view
  (`apps/desktop/src/main/localDiff.ts:103-126`).

## 4. Registration & inspection — Settings → MCP

`apps/desktop/src/client/features/settings/McpSettings.tsx` renders two things.

**A read-only inspector** of the MCP config files the agents in this task's worktree would load —
`.mcp.json`, `.cursor/mcp.json` (worktree-relative) and `~/.claude.json` (home)
(`MCP_CANDIDATES`, `apps/desktop/src/shared/mcp.ts:78-82`). These are the *only* paths main reads.
`inspectMcpConfig` parses each file's `mcpServers` / `mcp.servers` / `servers` node into per-server
rows (name, transport, status, command/url, env); unparseable JSON surfaces as one `invalid` row so
breakage is visible (`apps/desktop/src/shared/mcp.ts:34-72`). acorn **never launches** any of these
servers — it only shows what the agent is configured to load.

**Secret masking happens in main, before crossing to the renderer.** `maskSecretEnv` masks any env
value whose key looks like a credential (`*_TOKEN`/`*_KEY`/`*_SECRET`/…) or whose value carries a
known prefix (`sk-`, `ghp_`, `xox…`), keeping keys intact so the user sees *what* is configured
without leaking the value (`apps/desktop/src/shared/mcp.ts:16-29`).

**Register / unregister buttons** register or remove acorn's own server with `claude` or `codex`
through the agent's CLI on explicit user action. Registration is **reuse-first** and remove-then-add
(idempotent); it never writes into config files directly (`apps/desktop/src/main/mcpRegister.ts:55-71`).
In normal use the server is auto-registered whenever a Claude Code / Codex terminal launches
(`spawnOne` in `apps/desktop/src/main/terminal.ts`); these buttons re-register or remove it manually.

Everything crosses the `window.acorn.mcp` bridge (`apps/desktop/src/main/preload.ts:106-112`):
`inspect(taskId)`, `createStarter(taskId)` (seeds a starter `.mcp.json`), `register(flavour)`,
`unregister(flavour)`.

## 5. Maturity & operational notes

- The **notes/memory/run/browser** endpoints are served by `apps/desktop/src/server/routes/harness.ts`,
  which delegates to four per-domain sub-bridges (`NotesBridge` / `MemoryBridge` / `RunBridge` /
  `BrowserBridge`) wired independently by `apps/desktop/src/main/harnessWiring.ts`. Without a
  bridge — e.g. running the server alone with `dev:node`, no Electron — every harness route returns a
  clean `503 { error: 'bridge-unavailable', kind: 'unavailable' }` and the corresponding tools report
  `api-error` rather than crashing. With the bridge up, failures are typed (`HarnessError` kinds
  `not_found`/`bad_request`/`failed` → 404/400/500), so a domain error like an unknown run target no
  longer reads as service-unavailable. The context/repo-info routes (`taskContext.ts`) do not need
  the bridge.
- The `mcp__acorn-dev__*` tools an operator may see listed in Claude Code are exactly this server's
  registered surface — the `acorn-dev` name is the unpackaged build's **registration** name
  (`serverName(false)`, `apps/desktop/src/main/mcpRegister.ts:13`; the packaged build registers as
  `acorn`). The server's *self-reported* MCP name follows the registration: the launcher env
  carries `ACORN_MCP_NAME` (set by `launcherSpec`), so an `acorn-dev` registration self-reports as
  `acorn-dev` (`src/mcp/server.ts` falls back to `acorn` only when launched outside a
  registration).

## Source

- Server + tool definitions: `apps/desktop/src/mcp/server.ts` (entry: `src/mcp/main.ts`, loopback
  client: `src/mcp/api.ts`)
- Loopback endpoints: `apps/desktop/src/server/routes/harness.ts` (bridges wired by
  `apps/desktop/src/main/harnessWiring.ts`),
  `apps/desktop/src/server/routes/taskContext.ts`
- Internal-loopback auth: `apps/desktop/src/server/middleware/auth.ts`
- Config parser + secret masking: `apps/desktop/src/shared/mcp.ts`
- Registration launcher: `apps/desktop/src/main/mcpRegister.ts`
- Direct-git tools: `apps/desktop/src/main/localDiff.ts`
- Settings UI + bridge: `apps/desktop/src/client/features/settings/McpSettings.tsx`,
  `apps/desktop/src/main/preload.ts`

See also: [terminal-and-agents.md](./terminal-and-agents.md) ·
[notes-and-memory.md](./notes-and-memory.md) · [api-reference.md](./api-reference.md) ·
[workflows.md](./workflows.md) · [workspaces-and-tasks.md](./workspaces-and-tasks.md)

