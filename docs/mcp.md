# MCP

acorn ships a stdio MCP server for agents launched from a task. The server is a thin child-process
client: it receives a task-scoped environment, resolves the Node endpoint from the data root, and
calls `/v2` over loopback. It never opens SQLite or owns a second domain implementation.

## Launch environment

The Node injects only the values the MCP process needs:

- `ACORN_DATA_DIR`: the data root, used to resolve the preferred or bound port.
- `ACORN_API_TOKEN`: an HMAC task-scoped internal token.
- `NODE_EXTRA_CA_CERTS`: the Node's self-signed certificate, for normal TLS validation.
- Task and session identifiers, plus the allowlisted process environment. The token, rather than the
  session environment or request header, is authoritative for the session ID and effective tool
  ceiling.

The endpoint is resolved at call time because Node ports are ephemeral. The signing key is persisted
so a tmux-reattached process still authenticates after a Node restart. Rotating the key revokes
outstanding internal tokens.

## Tool surface

The MCP server projects the Node agent-tool registry, so the surface is whatever the enabled plugins
register for the addressed task. [Agent tools](./agent-tools.md) owns the per-tool contract; the
registered groups are:

- Task and pull-request context, from core: `task_current`, `task_context`, `pr_current`,
  `pr_changed_files`, `linked_issues`, `repo_info`.
- One issue or error in full, from core over whichever provider owns it: `issue_detail`. The tool is
  core's because Linear and Rollbar ship loaded and cannot register a tool; the read is theirs
  (docs/agent-tools.md § issue_detail).
- Plugin authoring and the install request, from core: `plugin_authoring`, `plugin_request`.
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
`mcp.js` beside the service) handle MCP registration. Settings → MCP shows
the generated configuration and the active capability state. It does not store a provider secret.

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
