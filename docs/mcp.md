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

The MCP server projects the Node agent-tool registry. It exposes task context, files, Git/changes,
notes, memory, terminal/session operations, workflows, database/Docker operations, and preview/browser
tools according to the enabled plugins and task scope.

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

The profile launchers and the Node's `mcp` entrypoint handle MCP registration. Settings → MCP shows
the generated configuration and the active capability state. It does not store a provider secret.

Registration also refreshes once at boot for every installed agent CLI, not only at session spawn.
The registered launcher command is the Node's own binary path, which in a dev build is a checkout
path that goes stale after a reinstall. A restored tmux session never re-spawns, so without the boot
pass it would keep pointing at a launcher that no longer exists and show as disconnected.
