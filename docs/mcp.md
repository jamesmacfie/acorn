# MCP

acorn ships a stdio MCP server for agents launched from a task. The server is a thin child-process
client: it receives a task-scoped environment, resolves the Node endpoint from the data root, and
calls `/v2` over loopback. It never opens SQLite or owns a second domain implementation.

## Launch environment

The Node injects only the values the MCP process needs:

- `ACORN_DATA_DIR`: the data root, used to resolve the preferred or bound port.
- `ACORN_API_TOKEN`: an HMAC task-scoped internal token.
- `NODE_EXTRA_CA_CERTS`: the Node's self-signed certificate, for normal TLS validation.
- Task and session identifiers, plus the allowlisted process environment.

The endpoint is resolved at call time because Node ports are ephemeral. The signing key is persisted
so a tmux-reattached process still authenticates after a Node restart. Rotating the key revokes
outstanding internal tokens.

## Tool surface

The MCP server projects the Node agent-tool registry, so the surface is whatever the enabled plugins
register for the addressed task. [Agent tools](./agent-tools.md) owns the per-tool contract; the
registered groups are:

- Task and pull-request context, from core: `task_current`, `task_context`, `pr_current`,
  `pr_changed_files`, `linked_issues`, `repo_info`.
- Plugin authoring and the install request, from core: `plugin_authoring`, `plugin_request`.
- Local git reads, from `changes`: `local_changes`, `local_diff`, `git_log`.
- Notes, from `notes`, and memory, from `memory`.
- The run targets a repo configures, from `terminal`: `run_targets`, `run_start`, `run_stop`,
  `run_restart`, `run_status`.
- Browser automation, from `browser`.
- One write, from `github`: `github_pull_create`.

Nothing here reads or writes a file, drives a workflow, opens a database, or talks to Docker. An
agent that needs a file uses its own harness tools inside the worktree.

The server returns structured results for absent task context, unavailable optional plugins, and
provider errors. It never returns device tokens, provider credentials, raw secret fields, or arbitrary
database handles.

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

Registration also refreshes once at boot for every installed agent CLI, not only at session spawn.
The registered launcher command is the Node's own binary path, which in a dev build is a checkout
path that goes stale after a reinstall. A restored tmux session never re-spawns, so without the boot
pass it would keep pointing at a launcher that no longer exists and show as disconnected.
