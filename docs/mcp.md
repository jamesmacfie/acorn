# MCP

acorn ships a **stdio MCP server** that exposes the current task's tools to an agent, plus a
read-only **Settings → MCP** inspector for the agents' own config files. This doc covers how the
server is launched, secured and inspected. **The tool catalog and contract live in
[agent-tools.md](./agent-tools.md)** — the MCP server is only one *projection* of the agent-tool
registry, not the source of tool definitions.

> Maturity: the MCP server and its Settings surface are wired and used when the desktop app is
> running (the agent/terminal features it depends on are desktop-only and always on; see
> [terminal-and-agents.md](./terminal-and-agents.md)). The tool surface requires the main-process
> registry and degrades to a clean `503` without it (e.g. `dev:node`).

## 1. What it is

The server is a stdio MCP server named **`acorn`** (`acorn-dev` in unpackaged builds), built on
`@modelcontextprotocol/sdk` in `apps/desktop/src/mcp/server.ts` (the stdio entry is the dedicated
`apps/desktop/src/mcp/main.ts`, and the loopback HTTP client lives in `apps/desktop/src/mcp/api.ts`).
It defines **no tools of its own** — it is a generic proxy over the agent-tool registry: it fetches
the manifest (`GET /api/tasks/:id/tools`) to serve `tools/list`, and proxies each `tools/call` to
`POST /api/tasks/:id/tools/:name`. Dynamic availability rides through: the server polls the manifest
and emits `tools/list_changed` when the available set changes (e.g. `run_*` appearing once a repo
gains run targets). Two properties define it:

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
| `ACORN_SESSION_ID` | this terminal session's id, sent as `x-acorn-session-id` and stamped on notes/memory writes for provenance |

These are injected into every task-scoped terminal session by the main process
(`buildSessionEnv`, `apps/desktop/src/main/terminalUtils.ts:138-157`, plus `internalApiEnv` and
`ACORN_SESSION_ID` in `spawnOne`, `apps/desktop/src/main/terminal.ts`). See
[terminal-and-agents.md](./terminal-and-agents.md) for the full `ACORN_*` injection story.

## 2. The key design property: everything goes over loopback

The tools **never open their own SQLite DB or GitHub client.** Every call goes through the running
app over loopback with `x-acorn-internal: <ACORN_API_TOKEN>` (`apiCall` in
`apps/desktop/src/mcp/api.ts`); the tool handlers run in the app's main process against the same
local mirror the UI reads — including the git tools, which resolve the task's worktree server-side
(no more `ACORN_WORKTREE_PATH` in the MCP process).

That token is matched by `internalUser` in `apps/desktop/src/server/middleware/auth.ts:14-22`: a
request bearing the correct `INTERNAL_TOKEN` is resolved to the machine's single user (this is a
single-user, machine-local app). Two consequences follow:

- **An agent sees exactly what the UI sees.** Both read the same local mirror through the same Hono
  routes, so there is one source of truth and no drift.
- **The internal user has an empty GitHub token** (`{ token: '', login, … }`). Internal callers can
  read the local mirrors but can **never** call GitHub. An agent cannot exfiltrate or spend your
  GitHub credentials through the MCP surface.

**Graceful degradation is structural, never a protocol error** (`apps/desktop/src/mcp/server.ts`):

- No `ACORN_TASK_ID` → `tools/list` is empty and a call returns `{ status: 'no-active-task', hint: … }`.
- App not reachable → `{ status: 'acorn-not-running', detail: … }` (fetch threw).
- An API error → `{ status: 'api-error', detail: '<status> <body>' }`.

Because the registration is user-wide and plain terminals load the server too, returning a *result*
rather than throwing keeps those sessions clean.

## 3. Tool catalog

The catalog, contribution shape, risk tiers and permissions all live in
**[agent-tools.md](./agent-tools.md)** — the registry (`apps/desktop/src/server/agentTools`) is the
single source of truth, and the MCP `tools/list` is derived from it. This doc no longer duplicates
the per-tool table; a stale copy here would be exactly the hand-synced ladder Phase 4 removed.

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

- The **tool surface** is served by `apps/desktop/src/server/routes/agentTools.ts` from the registry
  installed by `apps/desktop/src/main/agentToolsWiring.ts`. Without the registry — e.g. running the
  server alone with `dev:node`, no Electron — the tool routes return a clean
  `503 { error: 'bridge-unavailable' }` and the MCP server reports an empty `tools/list`, rather than
  crashing. A handler's typed `ToolError` becomes the machine `error` code
  (`not_found`/`bad_request`/`failed` → 404/400/500, human message in `detail`), so a domain error
  like an unknown run target no longer reads as service-unavailable. Run keeps its own renderer routes
  in `harness.ts` (the run pane / preview home); the context/repo-info routes (`taskContext.ts`) do
  not need the registry.
- The `mcp__acorn-dev__*` tools an operator may see listed in Claude Code are exactly this server's
  registered surface — the `acorn-dev` name is the unpackaged build's **registration** name
  (`serverName(false)`, `apps/desktop/src/main/mcpRegister.ts:13`; the packaged build registers as
  `acorn`). The server's *self-reported* MCP name follows the registration: the launcher env
  carries `ACORN_MCP_NAME` (set by `launcherSpec`), so an `acorn-dev` registration self-reports as
  `acorn-dev` (`src/mcp/server.ts` falls back to `acorn` only when launched outside a
  registration).

## Source

- MCP proxy server: `apps/desktop/src/mcp/server.ts` (entry: `src/mcp/main.ts`, loopback
  client: `src/mcp/api.ts`)
- Tool registry + projection: `apps/desktop/src/server/agentTools/`,
  `apps/desktop/src/server/routes/agentTools.ts` (contributions wired by
  `apps/desktop/src/main/agentToolsWiring.ts`) — see [agent-tools.md](./agent-tools.md)
- Run renderer routes + context: `apps/desktop/src/server/routes/harness.ts`,
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

