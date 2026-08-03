# MCP

acorn ships a **stdio MCP server** that exposes the current task's tools to an agent, plus a
read-only **Settings → MCP** inspector for the agents' own config files. This doc covers how the
server is launched, secured and inspected. **The tool catalog and contract live in
[agent-tools.md](./agent-tools.md)** — the MCP server is only one *projection* of the agent-tool
registry, not the source of tool definitions.

> Maturity: the MCP server and its Settings surface are wired and used when the desktop app is
> running (the agent/terminal features it depends on are desktop-only and always on; see
> [terminal-and-agents.md](./terminal-and-agents.md)). The tool surface requires the node-side
> registry and degrades to a clean `503` without it (e.g. `dev:node`).

## 1. What it is

The server is a stdio MCP server named **`acorn`** (`acorn-dev` in unpackaged builds), built on
`@modelcontextprotocol/sdk` in `packages/node-core/src/mcp/server.ts` (the stdio entry is the dedicated
`packages/node-core/src/mcp/main.ts`, and the loopback HTTPS client lives in `packages/node-core/src/mcp/api.ts`).
It defines **no tools of its own** — it is a generic proxy over the agent-tool registry: it fetches
the manifest (`GET /v2/core/tasks/:id/tools`) to serve `tools/list`, and proxies each `tools/call` to
`POST /v2/core/tasks/:id/tools/:name`. Dynamic availability rides through: the server polls the manifest
and emits `tools/list_changed` when the available set changes (e.g. `run_*` appearing once a repo
gains run targets). Two properties define it:

**It is launched by the agent, not by acorn.** acorn never starts or supervises the MCP process.
Instead it registers the server through each agent's *own* mechanism — `claude mcp add --scope user`,
`codex mcp add` — pointing at an "Electron-as-node" launcher: the app's own binary run with
`ELECTRON_RUN_AS_NODE=1` against the bundled entry `out/main/mcp.js` (built from `packages/node-core/src/mcp/main.ts`;
`launcherSpec` in `packages/node-core/src/main/mcpRegister.ts` also passes the flavoured registration
name through as `ACORN_MCP_NAME`). This means the user needs no system Node, and acorn
does not write through into the agents' config files — the agent owns its config
(`packages/node-core/src/main/mcpRegister.ts:1-4`).

**It scopes itself entirely from inherited environment.** The registration is *user-wide*, so every
Claude Code / Codex process the user opens loads the server — including plain terminals with no task.
The server therefore reads its identity from the env it inherits (`packages/node-core/src/mcp/server.ts` + `packages/node-core/src/mcp/api.ts`):

| Env var | Meaning |
| --- | --- |
| `ACORN_TASK_ID` | which task this session belongs to (empty = no task) |
| `ACORN_DATA_DIR` | the node's data root; the client reads `<dataDir>/node.json` and resolves `https://127.0.0.1:<port>` from it |
| `ACORN_API_URL` | a fixed origin used **only** when there is no `ACORN_DATA_DIR` (tests, hand-wiring). No default |
| `ACORN_API_TOKEN` | the private persisted internal token sent as `x-acorn-internal` |
| `ACORN_SESSION_ID` | this terminal session's id, sent as `x-acorn-session-id` and stamped on notes/memory writes for provenance |
| `NODE_EXTRA_CA_CERTS` | `<dataDir>/tls/cert.pem` — how the child trusts the node's certificate with zero code |

The endpoint is resolved from the **data root**, not from a baked URL, and that shape is deliberate:
this process can outlive the node that spawned it (agent panes run in tmux and are reattached after
an acorn restart, keeping the environment of the boot that created the session). The internal token
survives that because it is persisted, but the listening port is ephemeral, so a baked
`ACORN_API_URL` would point at nothing. `node.json` is the one thing both stable in location and
current in content, so `api.ts` re-reads it on every miss — and a connection failure forgets the
cached endpoint and asks again once before reporting `acorn-not-running`.

These are injected into every task-scoped terminal session by the utility service
(`buildSessionEnv`, `packages/node-core/src/main/taskEnv.ts`, plus `internalApiEnv` and
`ACORN_SESSION_ID` in `spawnOne`, `plugins/terminal/src/main/terminal.ts`). See
[terminal-and-agents.md](./terminal-and-agents.md) for the full `ACORN_*` injection story.

## 2. The key design property: everything goes over the node's HTTPS API

The tools **never open their own SQLite DB or GitHub client.** Every call goes through the running
node over loopback HTTPS with `x-acorn-internal: <ACORN_API_TOKEN>` (`apiCall` in
`packages/node-core/src/mcp/api.ts`); the tool handlers run in the app's utility service against the same
local mirror the UI reads — including the git tools, which resolve the task's worktree server-side
(no more `ACORN_WORKTREE_PATH` in the MCP process).

The node is **TLS-only**, and the child needs no TLS code to talk to it. The node's self-signed
certificate is a CA with an `IP:127.0.0.1` SAN (`packages/node-core/src/main/tls.ts`) and the service
exports `NODE_EXTRA_CA_CERTS` pointing at it (`apps/node/src/service/runtime.ts`), so `fetch()`
validates **fully** — there is no `rejectUnauthorized: false` anywhere. The ceiling of that trick is
documented in `api.ts`: the variable is read once at process start, so a certificate replaced
mid-life needs a restart, and only Node/Electron children honour it.

That token is matched by `internalPrincipal` in `packages/node-core/src/server/middleware/auth.ts`: a
request bearing the correct `INTERNAL_TOKEN` resolves to a `Principal` of kind `internal` carrying
the machine's active GitHub identity. That identity is bound by the GitHub **device-flow connect**
(`plugins/github/src/server/routes/deviceAuth.ts`, the only writer of `ACTIVE_IDENTITY`); while it is
unbound, internal traffic fails closed. Two consequences follow:

- **An agent sees exactly what the UI sees.** Both read the same local mirror through the same Hono
  routes, so there is one source of truth and no drift.
- **The internal principal is not walled off from GitHub.** A `Principal` has no token field; the
  GitHub credential lives in the encrypted `integrations` row keyed by `ownerId(c)`
  (`plugins/github/src/server/githubToken.ts`), `ownerId` returns `principal.userId` for either kind,
  and `requireUser` admits both. Nothing in the github plugin's routers gates on principal kind, so
  the older guarantee that "an agent cannot exfiltrate or spend your GitHub credentials through the
  MCP surface" **no longer holds**. The only kind-based gates in the tree are
  `packages/node-core/src/server/routes/agentTools.ts` (the renderer projection requires `device`,
  the MCP projection requires `internal`) and `plugins/http/src/server/routes/http.ts`, where `send`
  requires `device` and answers an internal caller `403 interactive_user_required`. This is a
  recorded consequence of moving the credential off the principal — see
  [vNext/phase1-notes.md](./vNext/phase1-notes.md).

**Graceful degradation is structural, never a protocol error** (`packages/node-core/src/mcp/server.ts`):

- No `ACORN_TASK_ID` → `tools/list` is empty and a call returns `{ status: 'no-active-task', hint: … }`.
- App not reachable → `{ status: 'acorn-not-running', detail: … }` (fetch threw).
- An API error → `{ status: 'api-error', detail: '<status> <body>' }`.

Because the registration is user-wide and plain terminals load the server too, returning a *result*
rather than throwing keeps those sessions clean.

## 3. Tool catalog

The catalog, contribution shape, risk tiers and permissions all live in
**[agent-tools.md](./agent-tools.md)** — the registry (`packages/node-core/src/server/agentTools`) is the
single source of truth, and the MCP `tools/list` is derived from it. This doc no longer duplicates
the per-tool table; duplicating it here would create a hand-synced ladder.

## 4. Registration & inspection — Settings → MCP

`packages/client-core/src/settings/McpSettings.tsx` renders two things.

**A read-only inspector** of the MCP config files the agents in this task's worktree would load —
`.mcp.json`, `.cursor/mcp.json` (worktree-relative) and `~/.claude.json` (home)
(`MCP_CANDIDATES`, `packages/protocol/src/mcp.ts:78-82`). These are the *only* paths the
service-side inspector reads.
`inspectMcpConfig` parses each file's `mcpServers` / `mcp.servers` / `servers` node into per-server
rows (name, transport, status, command/url, env); unparseable JSON surfaces as one `invalid` row so
breakage is visible (`packages/protocol/src/mcp.ts:34-72`). acorn **never launches** any of these
servers — it only shows what the agent is configured to load.

**Secret masking happens in the utility service, before crossing to the renderer.** `maskSecretEnv` masks any env
value whose key looks like a credential (`*_TOKEN`/`*_KEY`/`*_SECRET`/…) or whose value carries a
known prefix (`sk-`, `ghp_`, `xox…`), keeping keys intact so the user sees *what* is configured
without leaking the value (`packages/protocol/src/mcp.ts:16-29`).

The inspector and **Create `.mcp.json`** action use task-scoped plugin routes
(`/v2/p/terminal/tasks/:id/mcp` and `…/mcp/starter`). In normal use
acorn's own server is auto-registered whenever a Claude Code / Codex terminal launches, via the
agent's CLI and the idempotent launcher in `packages/node-core/src/main/mcpRegister.ts`. To opt out,
remove the registration with the corresponding agent CLI.

## 5. Maturity & operational notes

- The **tool surface** is served by `packages/node-core/src/server/routes/agentTools.ts` from the registry
  installed by the utility runtime through `apps/node/src/wiring/agentToolsWiring.ts`.
  Without the registry — e.g. running the
  server alone with `dev:node`, no Electron — the tool routes return a clean
  `503 { error: { code: 'bridge-unavailable', message, requestId, retryable } }` and the MCP server
  reports an empty `tools/list`, rather than
  crashing. A handler's typed `ToolError` becomes the machine `error.code`
  (`not_found`/`bad_request`/`failed` → 404/400/500, human message in `error.message`), so a domain error
  like an unknown run target no longer reads as service-unavailable. Run keeps its own renderer routes
  in `harness.ts` (the run pane / preview home); the context/repo-info routes (`taskContext.ts`) do
  not need the registry.
- The `mcp__acorn-dev__*` tools an operator may see listed in Claude Code are exactly this server's
  registered surface — the `acorn-dev` name is the unpackaged build's **registration** name
  (`serverName(false)`, `packages/node-core/src/main/mcpRegister.ts:13`; the packaged build registers as
  `acorn`). The server's *self-reported* MCP name follows the registration: the launcher env
  carries `ACORN_MCP_NAME` (set by `launcherSpec`), so an `acorn-dev` registration self-reports as
  `acorn-dev` (`packages/node-core/src/mcp/server.ts` falls back to `acorn` only when launched outside a
  registration).

## Source

- MCP proxy server: `packages/node-core/src/mcp/server.ts` (entry: `packages/node-core/src/mcp/main.ts`, loopback
  HTTPS client: `packages/node-core/src/mcp/api.ts`)
- Tool registry + projection: `packages/node-core/src/server/agentTools/`,
  `packages/node-core/src/server/routes/agentTools.ts` (contributions wired by
  `apps/node/src/wiring/agentToolsWiring.ts`) — see [agent-tools.md](./agent-tools.md)
- Run renderer routes + context: `packages/node-core/src/server/routes/harness.ts`,
  `packages/node-core/src/server/routes/taskContext.ts`
- Internal-loopback auth: `packages/node-core/src/server/middleware/auth.ts`
- Config parser + secret masking: `packages/protocol/src/mcp.ts`
- Registration launcher: `packages/node-core/src/main/mcpRegister.ts`
- Direct-git tools: `plugins/changes/src/main/localDiff.ts`
- Settings UI + HTTP client: `packages/client-core/src/settings/{McpSettings.tsx,mcpClient.ts}`

See also: [terminal-and-agents.md](./terminal-and-agents.md) ·
[notes-and-memory.md](./notes-and-memory.md) · [api-reference.md](./api-reference.md) ·
[workflows.md](./workflows.md) · [workspaces-and-tasks.md](./workspaces-and-tasks.md)
