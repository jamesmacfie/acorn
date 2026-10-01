# MCP

acorn ships a stdio MCP server for agents launched from a task. The server is a thin child-process
client: it receives a task-scoped environment, resolves the Node endpoint from the data root, and
calls `/v1` over loopback. It never opens SQLite or owns a second domain implementation.

acorn also hands every agent session the MCP servers you add in Settings → MCP servers, whichever
harness runs it. See § Your own servers.

## Launch environment

The Node injects only the values the MCP process needs:

- `ACORN_DATA_DIR`: the data root, used to resolve the preferred or bound port.
- `ACORN_API_TOKEN`: an HMAC task-scoped internal token.
- `NODE_EXTRA_CA_CERTS`: the Node's self-signed certificate, for normal TLS validation.
- Task and session identifiers, plus the allowlisted process environment. The token, rather than the
  session environment or request header, is authoritative for the session ID and effective tool
  ceiling.

`ACORN_TASK_ID` is what the server addresses, so without it `tools/list` is empty. A managed session
puts both identifiers in the provider process's own environment, not only in a protocol MCP
declaration, because Claude Code and Codex start this server from their CLI registration and pass it
only what they inherited (`plugins/agents/src/server/sessions/runtimeEngine.ts`).

The endpoint is resolved at call time because Node ports are ephemeral. The signing key is persisted
so a tmux-reattached process still authenticates after a Node restart. Rotating the key revokes
outstanding internal tokens.

## Tool surface

The MCP server projects the Node agent-tool registry, so the surface is whatever the enabled plugins
register for the addressed task. [Agent tools](./agent-tools.md) owns the per-tool contract; the
registered groups are:

- Task and pull-request context, from core: `task_current`, `task_context`, `pr_current`,
  `pr_changed_files`, `linked_issues`, `repo_info`.
- Issues and errors, from core over whichever provider owns them: `issue_detail` reads one in full,
  `issue_comment` posts on a linked one, and `issue_image` returns an image from a linked one as an
  image block. The tools are core's, so one name covers every tracker and the provider's key stays in
  core's secret scope. Each call is the provider's own hook (docs/agent-tools.md § issue_detail).
- Plugin authoring and the install request, from core: `plugin_authoring`, `plugin_request`.
- Typed-source metadata, from core: `data_sources_list`, `data_sources_discover`,
  `data_source_describe`, and `data_source_options`.
- Local git reads, from `changes`: `local_changes`, `local_diff`, `git_log`.
- Notes, from `notes`, and memory, from `memory`.
- The run targets a repo configures, from `terminal`: `run_targets`, `run_start`, `run_stop`,
  `run_restart`, `run_status`.
- Browser automation, from `browser`.
- The pull request, from `github`: two reads over the local mirror, `pr_review_comments` and
  `pr_checks`, and one write, `github_pull_create`.
- Managed-session orchestration, from `agents`: `agent_spawn`, `agent_prompt`, `agent_wait`,
  `agent_read`, and `agent_cancel`.

Nothing here reads or writes a file, drives a workflow run, opens a database, or talks to Docker. An
agent that needs a file uses its own harness tools inside the worktree. Driving a workflow from a step
of one is a loop; the interactive HTTP sender is denied to this principal outright, under Security
below; and arbitrary SQL against a task's database would be execute-tier, which is denied by
default.

The server returns structured results for absent task context, unavailable optional plugins, and
provider errors. It never returns device tokens, provider credentials, raw secret fields, or arbitrary
database handles.

The proxy assigns a UUID call ID once per `tools/call` and sends it as
`x-acorn-tool-call-id`. If the first loopback request loses the Node during a restart, the retry keeps
the same ID. Stateful handlers scope it to the signed session and tool so the logical call remains
idempotent.

## Security

The internal token is checked on every HTTP request and WebSocket upgrade. Task routes compare the
token's task ID with the addressed task. Device administration, plugin administration, backups,
imports, audit/security reads, provider-connection administration, and the interactive HTTP sender
are unavailable to the MCP principal.

Each tool validates its own input at the Node boundary. Paths are confined to the task worktree,
process execution is brokered, output is bounded, and provider responses are normalized before they
reach the agent.

## Configuration

The profile launchers and the Node's `mcp` entrypoint (`apps/node/src/entries/mcp.ts`, emitted as
`mcp.js` beside the service) handle MCP registration. Settings → MCP config files lists the servers
each CLI loads from its own config files, with secret values masked, and never starts one.

**MCP config files reads one project, picked on the page.** It starts on the open task's project when
there is one, and it reads the same files either way: `.mcp.json` and `.cursor/mcp.json` in the
project's folder, and `~/.claude.json` (`GET /v1/core/projects/:id/mcp`,
`packages/node-core/src/server/routes/projects/projects.ts`). A task's worktree checks out the same
committed files, so the open task does not change what the page shows. **Create .mcp.json** writes
an empty file into the project's folder and refuses any path already there, a committed symlink
included, so it never writes where a link points (`POST /v1/core/projects/:id/mcp/starter`). A task on a new branch picks it up once it is committed.
Both routes are device-only, like every project route. Until 2026-09-29 the two were task routes,
`/v1/core/tasks/:id/mcp` and `/mcp/starter`, which read the open task's worktree; they are deleted.

Which CLI a harness registers through, and what that CLI wants on its command line, is the harness's
own declaration (`plugins/agents/src/server/profiles/mcpCommands.ts`). Core owns the shape of the
exchange only — remove, then add, through a login shell, with the failure turned into a sentence — and
knows neither CLI by name.

**There is a second door, and a harness gets one of the two.** An agent that speaks ACP takes MCP
declarations in the protocol, on `session/new` and again on the call that picks a session back up, so
acorn names its own server there instead of writing a config file. That door is for a contributed
harness: it has no `mcp add` command, and a manifest has no field to declare one, so the protocol is
the only way it could ever reach these tools. Claude Code and Codex keep the config-file door, and
`mcpRegistration` on the profile is what the runtime tests to decide — whoever already has a door keeps
it, and nothing is offered twice
(`acornMcpServers` in `plugins/agents/src/server/sessions/runtimeEngine.ts`).

The whole launch environment is named in the declaration rather than left to inheritance. The agent
process already holds these values, because they are the session environment acorn spawned it with,
but an agent is free to scrub credential-shaped names out of what it hands its own children, and
DeepSeek's does exactly that: a stdio server that loses `ACORN_API_TOKEN` fails every call. The token
is re-declared on every start for the same reason it is minted there — the previous one is already
dead, so an agent that kept the old declaration would hold nothing useful.

A standalone node offers no server through either door. It receives no service handshake, so it never
learns the staging directory its own `mcp.js` sits in (`configureAcornMcp` in
`node-core/server/mcpRegister.ts`).

Registration also refreshes once at boot for every installed agent CLI, not only at session spawn.
The registered launcher command is the Node's own binary path, which in a dev build is a checkout
path that goes stale after a reinstall. A restored tmux session never re-spawns, so without the boot
pass it would keep pointing at a launcher that no longer exists and show as disconnected.

## Your own servers

Settings → MCP servers holds the MCP servers acorn declares to agent sessions. The page is a list,
then one server's editor in the same pane, a form with **Save** and **Cancel**, and **Remove server**
in the editor's danger zone. It links to MCP config files, and that page links back, because the two
have different owners and different powers. The agents plugin owns
them (`plugins/agents/src/server/mcpServerStore.ts`), in one row per server in its own database. A
server is a command with arguments and an environment, or a URL with headers. A value marked secret is
sealed by the node's secret service on the way in. The settings page reads it back as a name with no
value, and an edit that leaves it empty keeps the stored one. The plaintext exists only when a provider
starts. The routes accept only an interactive device, reads included, for the reason project config
does: a stdio server is a command the next session runs.

acorn never writes these into a CLI's config file. Each harness receives them through the door it
already has, on every start, because none keeps declared servers between processes:

| Path | Claude Code and contributed ACP harnesses | Codex |
| --- | --- | --- |
| New session | `mcpServers` on `session/new` | `config.mcp_servers` on `thread/start` |
| Resume | `mcpServers` on `session/load` or `session/resume` | `config.mcp_servers` on `thread/resume` |
| Terminal handoff | `--mcp-config`, values as `${VARIABLE}` | one `-c mcp_servers.NAME={...}` per server |

A declared server sits beside the CLI's own servers rather than replacing them. An HTTP server goes
only to an ACP agent that reports HTTP support at `initialize`. The session says which servers it runs
without when one does not. A contributed harness has no terminal spelling yet, so its handoff carries
none.

**Each session keeps its own list.** A new session starts with the servers switched on for new
sessions, decided on the node rather than taken from the request. The list lives on
`config.mcpServers`, and the general session patch cannot change it, the same way it cannot touch the
tool ceiling. A server removed from Settings drops out of every session's next start. A server whose
secret no longer opens, for example after the node's key changed, is left out with a transcript
warning rather than failing the start.

Nothing in Settings changes a session that is already open. **On for new sessions** seeds the next
start, and the page says so and names `/mcp`.

**`/mcp` in the composer opens the session's panel** (`plugins/agents/src/client/sessions/AgentMcpPanel.tsx`)
instead of sending a turn. Exactly `/mcp`: `/mcp:server:prompt` is how Claude Code runs a server's
prompt and still goes to the agent. The panel's switches are a draft until **Apply**, because a harness
reads its servers only when its process starts. Applying stops the provider and starts it again, which
resumes the same conversation with the new list, so a turn in progress blocks it. Codex reports every
server it has, its own config's included, with start-up state, tool count, and sign-in state
(`mcpServerStatus/list` and `mcpServer/startupStatus/updated`). Claude Code reports server status only
through its SDK, which the ACP adapter does not expose, so the panel says so instead of guessing.

**Settings' Test button** (`plugins/agents/src/server/mcpProbe.ts`) connects to one server the way an
agent would, lists its tools, and disconnects. It answers whether the command starts or the URL
answers, not what a running session has connected. A failure shows the server's last stderr with its
secrets and anything token-shaped removed.

**What is not built.** Sign-in for OAuth servers stays with each CLI, because each harness runs its own
flow and stores its own tokens. Servers from a CLI's own config cannot be switched off from acorn: a
declaration can add a server, and nothing in either protocol removes one.

**Secrets in the terminal handoff.** Every value goes through the terminal's environment and the
command line only names it. Claude Code expands `${NAME}` in `--mcp-config`. Codex reads header values
from any variable (`env_http_headers`), but forwards a stdio server's environment by name into its own
(`env_vars`), so only secrets go that way and plain values are written inline. Two servers that need
different secrets under one name are refused, so neither runs with the other's value. The terminal
passes that environment the way it passes acorn's own token, which with the tmux backend means
`tmux new-session -e` for the moment the session is created.
