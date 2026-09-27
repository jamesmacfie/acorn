# Command and data contract

Status: proposal, 2026-09-27. Surveyed against commit `e0445287`.

## Command grammar

No arguments open the terminal client. Subcommands use singular resource nouns and explicit verbs:

```text
acorn [--node NODE] workspace list|show|create|rename|remove
acorn [--node NODE] workspace external-projects list|replace
acorn [--node NODE] project list|show|add|rename|move|hide|unhide|detect|remove
acorn [--node NODE] project config show|set
acorn [--node NODE] task list|show|create
acorn [--node NODE] agent providers|list|show|start|send|events|wait
acorn [--node NODE] workflow list|start
acorn [--node NODE] workflow run list|show|steps|wait
acorn [--node NODE] run list
acorn [--node NODE] plugin list
acorn [--node NODE] plugin PLUGIN_ID commands
acorn [--node NODE] plugin PLUGIN_ID COMMAND [command options]
acorn node info|start|status|stop
```

`--help` for built-in commands works without connecting to a Node. Plugin help and availability are
read from the selected active Node; if that Node is offline, help says so.
Use IDs as the stable argument. Names may be accepted only for an unambiguous project, Node, or
profile lookup and must never replace IDs in output. No command inherits a task from the TUI's last
selection. A `--project` path lookup may be added only if it rejects more than one match.
`node start` takes `--background`; `node status` and `node stop` act only on the explicit local
service record. The precise workspace/project write semantics are in
[workspace-and-project-commands.md](./workspace-and-project-commands.md).

Examples below specify the intended contract; they are not commands that work in this checkout.

```sh
acorn --node build-box task list --project "$PROJECT_ID" --output json
acorn workspace list --output json
acorn project list --workspace "$WORKSPACE_ID" --output json
acorn project add --workspace "$WORKSPACE_ID" --path /srv/repos/api --output json
acorn task create --project "$PROJECT_ID" --title "Investigate timeout" --branch timeout-review --output json
acorn agent providers --output json
acorn agent start --task "$TASK_ID" --profile codex --prompt-file brief.md --output json
acorn agent events --session "$SESSION_ID" --follow --output jsonl
acorn workflow list --task "$TASK_ID" --output json
acorn workflow start --task "$TASK_ID" --definition repo:review --inputs-file inputs.json --output json
acorn workflow run steps "$RUN_ID" --output json
acorn run list --output json
acorn plugin memory search --project "$PROJECT_ID" --query "deployment" --output json
```

## JSON resources and stdin

`--output text` is the default and is for a person. `--output json` writes one UTF-8 JSON value and
one final newline. A singular command writes one object; a list writes an array or a documented
page object when a cursor exists. `--output jsonl` is for record and event streams and writes one
complete object per line. Never print headings, spinners, progress, ANSI control bytes, pairing
secrets, or debug output on stdout in a machine mode. Put diagnostics on stderr.

Project Node responses into a CLI-owned schema. The minimal typed resource is:

```json
{
  "apiVersion": "acorn.cli/v1",
  "kind": "Task",
  "nodeId": "node-opaque-id",
  "id": "task-opaque-id",
  "projectId": "project-opaque-id",
  "title": "Investigate timeout",
  "status": "active"
}
```

The IDs above illustrate shape, not valid UUIDs. A real task ID follows the Node contract. Workspace,
project, agent, and workflow objects use `kind: "Workspace"`, `"Project"`, `"AgentSession"`, and
`"WorkflowRun"` with the same common fields. A project includes `workspaceId` and its Node-host
absolute `path`. Give each kind its own documented fields and schema snapshot. Preserve the
distinction between a resource's status and whether the CLI request succeeded.

`--workspace -`, `--project -`, `--task -`, `--session -`, and `--run -` each read one JSON resource or a typed reference object from
stdin and verify its `kind`, `nodeId`, and `id`. They do not interpret arbitrary text as an ID. A
literal ID remains `--task ID` and needs the selected Node. `--prompt-file -`, `--inputs-file -`,
`--sql-file -`, and plugin `--input-file -` read one bounded input from stdin. Refuse a command that
would need to read stdin twice; suggest a file for one input. Input validation uses the owning
route's limits and reports the failing field before a write.

```sh
set -o pipefail
acorn task create --project "$PROJECT_ID" --title "Investigate timeout" --output json |
  acorn agent start --task - --profile codex --prompt-file brief.md --output json |
  acorn agent wait --session - --until turn-completed --check
```

```sh
set -o pipefail
acorn workspace create --name "Platform" --output json |
  acorn project add --workspace - --path /srv/repos/api --output json |
  acorn task create --project - --title "Investigate timeout" --output json
```

For `project add`, the path is resolved on the selected Node host. In particular, `--path .` from a
remote laptop must not silently register the laptop's current directory. Require an absolute Node
path for remote Nodes; a local-only `--path .` convenience may resolve locally with explicit
documentation. Workspace/project names can recur, so scripts should pipe resources or pass IDs.

`agent start` acknowledges the queued first turn, not its completion. The last command waits for a
durable state. A shell pipe is appropriate for this short sequence. Use a workflow definition for
branches, retries, budgets, gates, child tasks, or work that must recover after the launching shell
exits. `--inputs-file` preserves JSON booleans, numbers, objects, arrays, and explicit nulls; do not
turn workflow input values into strings.

## Reads, waits, and errors

List commands accept documented filters, `--limit`, and `--cursor` when their Node route is paged.
Do not imply complete history from the merged `/v1/core/runs` read: its plugin sources are bounded
and it reports failed sources. `run list` must expose `failedSources` and a completeness field.
Use owner routes for full agent and workflow histories.

`agent events --follow` first pages the durable event ledger, then uses WebSocket frames as hints to
fetch later pages. On reconnect or sequence gap, resume from the last durable event sequence. A
workflow wait rereads its run and steps after invalidation or a bounded polling interval. Neither
command treats the WebSocket as a replay log. `--timeout` bounds the entire CLI wait; individual Node
long polls may have a shorter ceiling. Ctrl+C stops the local wait and does not cancel the run.

A query's exit status says whether the query succeeded, even if it read a failed run. A wait with
`--check` succeeds only when its requested completion is successful; failure, cancellation, and
timeout have distinct nonzero statuses. Without `--check`, a reached `--until` predicate succeeds
and the returned JSON carries the actual state. Attention is a state to inspect, not permission to
approve automatically. Proposed stable exit codes are:

| Code | Meaning |
| --- | --- |
| `0` | Command or requested wait predicate succeeded. |
| `1` | Unexpected client or server failure not classified below. |
| `2` | Usage, JSON, schema, or typed-input error. |
| `3` | Node connection, pairing, authentication, fingerprint, or protocol error. |
| `4` | Domain refusal, conflict, missing resource, or unavailable capability. |
| `5` | Wait timed out. |
| `6` | `--check` reached a failed or canceled terminal state. |
| `7` | Mutation result is ambiguous or a composed operation partially completed. |

Freeze these numbers with implementation tests and help before scripts rely on them. A plain
`show` of a failed run exits `0`; a failed `--check` exits `6` and still prints the run resource.

Preserve the Node's error code, message, `requestId`, and `retryable` in machine error output on
stderr as one JSON object and newline; text mode gets a concise human message. A `5xx` or lost
connection after a mutation is ambiguous. Report the idempotency key and
any known resource IDs, and tell the caller how to inspect before retrying. Do not automatically
repeat a mutation just because its transport failed.

## Verify before building

- Check `packages/protocol/src/api.ts`, `plugins/agents/src/contract/wire.ts`,
  `plugins/workflows/src/contract/wire.ts`, and their route schemas for real fields and bounds.
- Check `docs/api-reference.md` for error envelopes, idempotency, protocol versioning, and event
  semantics; update the proposed examples if those contracts change.
- Confirm that every machine output example parses as exactly one JSON value or a sequence of JSON
  Lines records, and that commands never write progress to stdout.
