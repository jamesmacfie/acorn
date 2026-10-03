# MCP

This page covers acorn's own MCP server for agents launched from a task, how it's registered with each
harness, and the MCP servers the owner adds in Settings. Read it before you change a tool's exposure or
how a harness receives servers.

acorn ships a stdio MCP server, a thin child-process client. It receives a task-scoped environment,
resolves the Node endpoint from the data root, and calls `/v1` over loopback. It never opens SQLite or
owns a second domain implementation. acorn also hands every agent session the servers you add in
Settings → MCP servers, whichever harness runs it ([your own servers](#your-own-servers)).

## Launch environment

The Node gives the MCP process only what it needs:

- `ACORN_DATA_DIR`: the data root, used to resolve the preferred or bound port.
- `ACORN_API_TOKEN`: an HMAC task-scoped internal token.
- `NODE_EXTRA_CA_CERTS`: the Node's self-signed certificate, for normal TLS validation.
- The task and session identifiers, plus the allowlisted process environment. The token, not the
  environment or a request header, is authoritative for the session ID and the tool ceiling.

`ACORN_TASK_ID` is what the server addresses, so without it `tools/list` is empty. A managed session
puts both identifiers in the provider process's environment. Managed Codex also receives an explicit MCP
declaration with the signed token, data root, identifiers, and certificate path, because its MCP child
doesn't inherit arbitrary environment variables (`plugins/agents/src/server/sessions/runtimeEngine.ts`).

The endpoint is resolved at call time, because Node ports are ephemeral. The signing key persists, so a
tmux-reattached process still authenticates after a Node restart, and rotating the key revokes every
outstanding token.

## Tool surface

The server projects the Node's agent-tool registry, so its tools are whatever the enabled plugins
register for the addressed task. [Agent tools](./agent-tools.md) owns each tool's contract. The groups:

- Task and pull request context, from core: `task_current`, `task_context`, `pr_current`,
  `pr_changed_files`, `linked_issues`, and `repo_info`.
- Issues and errors, from core over whichever provider owns them: `issue_detail` reads one in full,
  `issue_comment` posts on a linked one, and `issue_image` returns an image from a linked one. They're
  core's tools, so one name covers every tracker and the provider's key stays in core's secret scope.
- Plugin authoring and the install request, from core: `plugin_authoring` and `plugin_request`.
- Typed-source metadata, from core: `data_sources_list`, `data_sources_discover`,
  `data_source_describe`, and `data_source_options`.
- Task script reads, from core: `task_scripts_status`, `task_scripts_wait`, and `task_scripts_logs`.
- Local Git reads, from `changes`: `local_changes`, `local_diff`, and `git_log`.
- Notes, from `notes`, and memory, from `memory`.
- A repository's run targets, from `terminal`: `run_targets`, `run_start`, `run_stop`, `run_restart`,
  and `run_status`.
- Browser automation, from `browser`.
- The pull request, from `github`: `pr_review_comments` and `pr_checks` over the local mirror, and the
  write `github_pull_create`.
- Managed-session orchestration, from `agents`: `agent_spawn`, `agent_prompt`, `agent_wait`,
  `agent_read`, and `agent_cancel`.

Nothing here reads or writes a file, drives a workflow run, opens a database, or talks to Docker. An agent
that needs a file uses its harness's own tools in the worktree. Driving a workflow from one of its steps
would be a loop, the HTTP sender is refused to this principal, and arbitrary SQL would be execute-tier,
which is denied by default.

The task script tools use the launch token's task, so no input can name another task, and they never
start a script. Check status and wait on setup before work that depends on it. A wait timeout leaves the
script running ([task script tools](./agent-tools/browser-and-scripts.md#task-script-tools),
[durable results](./workspaces-and-tasks/task-scripts.md#durable-task-script-results)).

The server returns structured results for absent task context, unavailable optional plugins, and provider
errors. It never returns device tokens, provider credentials, raw secret fields, or database handles.

The proxy assigns a UUID call ID once per `tools/call` and sends it as `x-acorn-tool-call-id`. If the
first loopback request loses the Node during a restart, the retry keeps the same ID. Stateful handlers
scope it to the signed session and tool, so the call stays idempotent.

## Security

The internal token is checked on every HTTP request and WebSocket upgrade, and task routes compare its
task ID with the addressed task. Device administration, plugin administration, backups, imports, audit
and security reads, provider connection administration, and the interactive HTTP sender are unavailable
to the MCP principal. Each tool validates its own input at the Node boundary. Paths are confined to the
task worktree, process execution is brokered, output is bounded, and provider answers are normalized
before they reach the agent.

## Configuration

The profile launchers and the Node's `mcp` entry (`apps/node/src/entries/mcp.ts`, built as `mcp.js`
beside the service) register acorn's server. Which CLI a harness registers through, and what that CLI
wants on its command line, is the harness's own declaration
(`plugins/agents/src/server/profiles/mcpCommands.ts`). Core owns only the shape of the exchange: remove,
then add, through a login shell, with a failure turned into a sentence.

An ACP harness without CLI registration receives acorn's server through the protocol, on `session/new`
and again on load or resume. Claude Code uses its CLI registration. Managed Codex receives it through
`config.mcp_servers` on `thread/start` and `thread/resume`. The declaration uses the registered name,
`acorn` or `acorn-dev`, to override that config-file entry with the session's explicit environment, and
never writes the signed token into the user's config file (`acornMcpServers` in `runtimeEngine.ts`).

The declaration names the whole launch environment rather than relying on inheritance, because an agent
may scrub credential-shaped names from what it passes its children. DeepSeek's does, and a stdio server
that loses `ACORN_API_TOKEN` fails every call. The token is declared again on every start, because the
previous one is dead.

A standalone Node offers no server through either path. It gets no service handshake, so it never learns
the staging directory its `mcp.js` is in (`configureAcornMcp` in
`packages/node-core/src/server/mcpRegister.ts`). Registration also refreshes once at boot for every
installed agent CLI, because the registered launcher is the Node's own binary path, which in a
development build goes stale after a reinstall, and a restored tmux session never spawns again.

**Settings → MCP config files** lists the servers each CLI loads from its own config files, with secret
values masked, and never starts one. It reads one project, picked on the page, starting on the open
task's project: `.mcp.json` and `.cursor/mcp.json` in the project's folder, and `~/.claude.json`
(`GET /v1/core/projects/:id/mcp`). **Create .mcp.json** writes an empty file into the project's folder
and refuses any path already there, a committed symlink included
(`POST /v1/core/projects/:id/mcp/starter`). A task on a new branch picks it up once it's committed. Both
routes are device-only.

## Your own servers

Settings → MCP servers holds the servers acorn declares to agent sessions: a list, then one server's
editor with **Save**, **Cancel**, and **Remove server**. It links to MCP config files, and that page
links back, because the two have different owners. The agents plugin owns these, one row per server in
its database (`plugins/agents/src/server/mcpServerStore.ts`). A server is a command with arguments and
an environment, or a URL with headers. A value marked secret is sealed by the Node's secret service,
read back as a name with no value, and kept when an edit leaves it empty. The routes accept only an
interactive device, reads included, because a stdio server is a command the next session runs.

acorn never writes these into a CLI's config file. Each harness receives them on every start, because
none keeps declared servers between processes:

| Path | Claude Code and contributed ACP harnesses | Codex |
| --- | --- | --- |
| New session | `mcpServers` on `session/new` | `config.mcp_servers` on `thread/start` |
| Resume | `mcpServers` on `session/load` or `session/resume` | `config.mcp_servers` on `thread/resume` |
| Terminal handoff | `--mcp-config`, values as `${VARIABLE}` | One `-c mcp_servers.NAME={...}` per server |

A declared server sits beside the CLI's own servers. An HTTP server goes only to an ACP agent that
reports HTTP support at `initialize`, and the session says which servers it runs without. A contributed
harness has no terminal spelling, so its handoff carries none.

**Each session keeps its own list.** A new session starts with the servers switched on for new sessions,
decided on the Node. The list lives on `config.mcpServers`, which the general session patch can't change.
A removed server drops out of every session's next start. A server whose secret no longer opens is left
out with a transcript warning. Nothing in Settings changes an open session: **On for new sessions** seeds
the next start, and the page names `/mcp`.

**`/mcp` in the composer opens the session's panel** (`plugins/agents/src/client/sessions/AgentMcpPanel.tsx`).
Exactly `/mcp`: `/mcp:server:prompt` still goes to the agent. The panel's switches are a draft until
**Apply**, which restarts the provider on the same conversation, so a turn in progress blocks it. Codex
reports every server with start-up state, tool count, and sign-in state. Claude Code reports status only
through its SDK, which the ACP adapter doesn't expose, so the panel says so.

**The Test button** (`plugins/agents/src/server/mcpProbe.ts`) connects to one server as an agent would,
lists its tools, and disconnects. A failure shows the server's last stderr with secrets and token-shaped
text removed.

**Secrets in the terminal handoff** go through the terminal's environment, and the command line only names
them. Claude Code expands `${NAME}` in `--mcp-config`. Codex reads header values from any variable but
forwards a stdio server's environment by name, so only secrets go that way. Two servers needing different
secrets under one name are refused. With the tmux backend, the environment passes through
`tmux new-session -e`.

OAuth sign-in stays with each CLI. Servers from a CLI's own config can't be switched off from acorn,
because nothing in either protocol removes a server.
