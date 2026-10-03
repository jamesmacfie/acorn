# Plugin commands

This page covers how the CLI discovers and runs a plugin's own commands. It's part of the
[command-line client](../cli.md). [CLI command authoring](../plugin-authoring/cli-commands.md) covers
how a plugin declares one.

## Discover and run a command

`plugin list` reads the roster. Plugin rows tell the loaded runtime apart from the installed candidate,
which may be waiting for a restart.

`plugin ID commands` discovers commands from that Node's running plugin declaration. Each
`PluginCommand` includes its title, summary, read or write risk, scope, required core capability, and
input and output schemas. An installed candidate waiting for a restart contributes none. A disabled
toggle hides a plugin's commands at once, even while its other routes stay active until restart.
`plugin ID COMMAND --help` reads the selected Node's current descriptor, schemas included.

`--input-file` takes a JSON object, or `-` for stdin. Its `nodeId` must match the selected Node, and a
scoped command also needs `workspaceId`, `projectId`, or `taskId`. The CLI and the Node both check types
and unknown fields against the descriptor. The Node checks that the resource exists and belongs to the
named scope before it calls the plugin's own `/cli/COMMAND` route
([core routes](../api-reference/core-routes.md#node-administration)).

A write command needs an idempotency key. The CLI makes one unless you pass `--request-id UUID` for a
retry, and the Node's replay store handles matching retries. A command never receives the device token
in its input. Success returns one `PluginCommandResult` with `pluginId`, `command`, and a typed `result`.
JSON Lines prints that resource as one line, and discovery prints one `PluginCommand` per line.

## Example: a database query

The loaded database plugin offers `query`, with the same read-only transaction and 200-row ceiling as its
workflow capability. It needs a task with a reachable PostgreSQL connection. A null cell is
`{ "value": "", "isNull": true }`. `nodeId` and `taskId` must come from the same Node, because a remote
Node can't use the local machine's project path or database environment.

```sh
NODE_ID="$(acorn node info --output json | jq -r .nodeId)"
TASK_ID="$(acorn task list --output json | jq -r '.[0].id')"
jq -n --arg nodeId "$NODE_ID" --arg taskId "$TASK_ID" \
  '{nodeId: $nodeId, taskId: $taskId, sql: "select 42 as answer", maxRows: 20}' > query.json
acorn plugin database commands --output json
acorn plugin database query --input-file query.json --output json
```

## Memory has no CLI command

Memory is a compiled plugin with no CLI command descriptor. Import memories through the project's
**Memory** rail entry in the desktop or the terminal client
([notes and memory](../notes-and-memory.md#the-memory-page-and-transcript)).
