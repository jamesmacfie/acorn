# Command-line client

`acorn` with no arguments opens the terminal client. With a command it runs a headless client of one
Node's `/v1` API. The CLI shares the terminal client's fleet, pinned certificate, and device-token
store through `@acorn/custody`. Ordinary commands attach to a running local Node or a paired remembered
Node and never start one. The explicit local service commands below own a background Node. The Node
continues to own tasks, plugins, and execution.
The terminal client's existing `--node` and `--task` switches still open that host when no
subcommand follows them.

The local Node uses `ACORN_DATA_DIR`, then the desktop app's data root when present, then the
development root. `--node ID` selects a remembered Node ID, and an unambiguous label also works.
`--node https://HOST:PORT` pairs interactively when it is not remembered. Scripts cannot pair for
the first time. An unavailable Node, missing token, changed certificate, rejected credential, or
incompatible protocol exits with a connection error. A command never falls back to a different Node.
If a local Node needs pairing, open **Settings → Nodes → Pair another client** in the desktop that
started it. For a standalone Node, run `kill -USR1 PID` and read the code from its launching
terminal. Then run the CLI command in an interactive terminal to enter the code.

## Commands

```text
acorn [--node NODE] node info
acorn [--node NODE] workspace list|show ID|create --name NAME|rename ID --name NAME|remove ID
acorn [--node NODE] workspace external-projects list ID|replace ID --file FILE|-
acorn [--node NODE] project list [--workspace ID] [--include-hidden]|show ID
acorn [--node NODE] project add --workspace ID --path ABSOLUTE [--name NAME]
acorn [--node NODE] project rename ID --name NAME|move ID --workspace ID|hide ID|unhide ID|detect ID|remove ID
acorn [--node NODE] project config show ID|set ID --patch-file FILE|-
acorn [--node NODE] task list [--project ID] [--status active|archived|all]
acorn [--node NODE] task show ID|create --project ID --title TEXT [--branch NAME] [--skip-setup]
acorn [--node NODE] agent providers|list [--task ID|--workspace ID]|show ID
acorn [--node NODE] agent start --task ID --profile ID [--provider ID] --prompt TEXT|--prompt-file FILE|-
acorn [--node NODE] agent send ID --prompt TEXT|--prompt-file FILE|-
acorn [--node NODE] agent events ID [--after-seq N] [--limit N] [--follow] [--output jsonl]
acorn [--node NODE] agent wait ID [--until ready|attention|turn-completed|stopped] [--timeout SECONDS] [--check]
acorn [--node NODE] workflow list --task ID
acorn [--node NODE] workflow start --task ID --definition ID [--inputs-file FILE|-] [--request-id UUID]
acorn [--node NODE] workflow run list --task ID
acorn [--node NODE] workflow run show ID|steps ID|wait ID [--until finished|attention] [--timeout SECONDS|30m] [--check]
acorn [--node NODE] run list [--workspace ID]
acorn [--node NODE] plugin list
acorn [--node NODE] plugin ID commands [--output json]
acorn [--node NODE] plugin ID COMMAND --help
acorn [--node NODE] plugin ID COMMAND --input-file FILE|- [--request-id UUID] [--output json|jsonl]
```

Workspace, project, task, and agent writes accept `--request-id UUID`. Reuse the same ID and body after an ambiguous response.
Task creation and agent start derive distinct stable UUID keys for their two Node calls. The
device replay store retains non-5xx responses for 24 hours; the Agents plugin keeps its own
session and turn operation records. A domain write can still happen before the generic replay
record is saved, so inspect a resource after an ambiguous transport error. If task creation or
agent start completes only its first call, the CLI exits 7 and writes the created resource with
its ID to stdout. Retry with the same request ID to resume the second call.

`project add` requires an explicit workspace ID and an absolute path on the selected Node host.
The Node reuses a project registered through another spelling of the same folder, including a
symlink. Names can repeat; scripts should select IDs. Moving a project changes membership, never
its folder. `project list` includes hidden rows in JSON; text omits them unless
`--include-hidden` is set. Removing a project deletes its task rows and links, but leaves the
folder and worktrees on disk. Removing a workspace reassigns its projects to Default and removes
its provider mappings. Default cannot be removed.

`project config set` takes a JSON object with exact project configuration route fields; unknown
fields and malformed browser rules fail before a write. Script fields may be executed later under
the Node's project configuration rules. `workspace external-projects replace` takes a complete
`{ "projects": [...] }` JSON object. An empty array deliberately clears the mapping. Each row
requires `integrationId` and `externalId`, with optional `projectId`. The Node validates the
connected provider and project membership. Provider mappings do not register local projects.

`task create` sends origin `local`, then invokes the desktop-equivalent `on-created` hook. The
hook seeds notes and may prepare a worktree or execute a created-trigger setup script. A branchless
task runs in its project folder, and a non-Git project has no worktree isolation. The hook itself
is best effort in the Node; a successful response does not prove that every setup action succeeded.

`--workspace -`, `--project -`, `--task -`, and positional session `-` read one
`acorn.cli/v1` resource from stdin and require the expected `kind` and selected `nodeId`. A command
refuses to read stdin twice. Use a file for one input when piping a prompt or JSON body as well.

```sh
set -o pipefail
acorn workspace create --name Platform --output json |
  acorn project add --workspace - --path /srv/repos/api --output json |
  acorn task create --project - --title 'Review API' --branch review-api --output json
```

`agent providers` reports the Agents plugin's provider/profile roster, installation,
authentication, and diagnostics. `start` creates an interactive managed session and queues one
text prompt of at most one million characters. A prompt is input to the provider, not a shell
command. When more than one provider matches a profile, select one with `--provider`. `start`
returns an `AgentSession` with `firstTurnId`; `send` returns an `AgentTurnAck`. Both acknowledge
queued work. The CLI warns when another managed session already exists on the task. Multiple
sessions on a task can share its worktree; use a workflow child task for
isolation.

`agent show` reads the durable snapshot and reports the latest turn status and pending request
count. `agent events` pages the durable event ledger. `--follow --output jsonl` uses WebSocket
notices to trigger more reads, with periodic refresh if a notice is missed; it resumes from the
last durable sequence after a gap or reconnect. Ctrl+C stops only local following. `agent wait`
composes the Node's bounded long polls under one CLI timeout. `--check` exits 6 on a failed or
canceled latest turn while printing the session resource; timeout exits 5. Attention is reported,
never approved automatically.

`workflow list --task` reads published repository, user, and database definitions from the
Workflows plugin. IDs include `repo:` or `user:` for files; database rows use their own IDs.
Machine output includes source, declared inputs, published revision when available, validity,
runnable state, and parse or validation errors. The Node validates the selected definition again
at start, including the repository trust snapshot and contributed step kinds. An unavailable
Workflows plugin is a capability error.

`workflow start` sends only the returned definition ID and an optional JSON object of typed
inputs. Values keep their JSON types, including explicit null. It acknowledges a durable run and
returns a `WorkflowRun`; execution continues on the Node. Start errors from definition validation
or trust are reported as domain refusals. If the response is uncertain after a write, the CLI exits
7, prints the request ID, and directs you to `workflow run list --task ID` for inspection before
retrying. The device replay store cannot rule out a second run after a crash between run insertion
and replay save. Use `workflow run show ID` and `workflow run steps ID` for direct durable reads.

`workflow run wait ID` rereads the run and up to 200 compact step statuses at a bounded interval;
`stepsTruncated` says when more exist. `workflow run steps` returns step metadata and child run IDs,
without step result bodies. `--until finished` covers
success, failure, safety rail, completed with failures, and cancellation. `--until attention`
also catches a gate awaiting action. `--check` exits 6 for a failed or canceled terminal run and
prints the run resource; it never approves a gate. A plain show succeeds when it reads a failed run.
`--timeout` accepts seconds or a suffix such as `30m`, up to 24 hours. Ctrl+C stops the local wait.

`run list` is a bounded recent-summary view merged from available agent, workflow, and schedule
sources. JSON includes `failedSources`, `complete: false`, `sourceLimit: 200`, and
`truncated: "unknown"`; each source can impose a lower limit. Text output says that it is a
bounded view and names failed sources. `--workspace` selects runs whose task belongs to the
workspace; taskless schedule runs cannot be assigned to a workspace and are omitted by that
filter. Use `workflow run list --task ID` or `agent list` for owner history.

`plugin ID commands` discovers commands from that Node's running plugin declaration. Each
`PluginCommand` resource includes its title, summary, read/write risk, scope, required core
capability, input schema, and output schema. An
installed candidate waiting for restart contributes none, and a disabled toggle hides CLI
commands immediately even if the plugin's other routes remain active until restart.
`plugin ID COMMAND --help` reads the
selected Node's current descriptor, including input and output schemas. `--input-file` is a JSON
object (or `-` for stdin); its `nodeId` must match the selected Node, and a scoped command also
requires `workspaceId`, `projectId`, or `taskId`. The CLI and Node validate types and unknown fields
according to the descriptor. The Node checks the resource exists and belongs to the named scope
before invoking the plugin's own `/cli/COMMAND` route. Write commands require an idempotency key;
the CLI generates one unless `--request-id UUID` is supplied for retries. The Node's device replay
store handles matching retries. A command never receives the device token in its input. Success
returns one `PluginCommandResult` with `pluginId`, `command`, and a typed `result` object; JSON Lines
prints that one resource as one line. Discovery with JSON Lines prints one `PluginCommand` per line.

The loaded Database plugin offers `query`, which uses the same read-only transaction and 200-row
ceiling as its workflow capability. It requires a task with a reachable database. Null cells in
the result are represented as `{ "value": "", "isNull": true }`.

```json
{ "nodeId": "NODE_ID", "taskId": "TASK_ID", "sql": "select 42 as answer", "maxRows": 20 }
```

```sh
acorn plugin database commands --output json
acorn plugin database query --input-file query.json --output json
```

Get the selected Node and task IDs from the CLI before writing `query.json`:

```sh
NODE_ID="$(acorn node info --output json | jq -r .nodeId)"
TASK_ID="$(acorn task list --output json | jq -r '.[0].id')"
jq -n --arg nodeId "$NODE_ID" --arg taskId "$TASK_ID" \
  '{nodeId: $nodeId, taskId: $taskId, sql: "select 42 as answer", maxRows: 20}' > query.json
acorn plugin database query --input-file query.json --output json
```

This needs a task with a reachable PostgreSQL connection. `nodeId` and `taskId` must come from the
same Node; a remote Node cannot use the local machine's project path or database environment.

```sh
set -o pipefail
acorn task create --project "$PROJECT_ID" --title 'Review API' --output json |
  acorn agent start --task - --profile codex --prompt-file brief.md --output json |
  acorn agent wait - --until turn-completed --check --output json
```

## Local service

```sh
acorn node start --background --output json
acorn node status --output json
acorn workspace list --output json
acorn node stop --output json
```

For a complete script, replace the example project path and profile/definition IDs with resources
available on this Node. Each invocation is a separate process; the agent and workflow continue after
their starting process exits:

```sh
set -o pipefail
acorn node start --background --output json > node.json
acorn workspace create --name Platform --output json > workspace.json
acorn project add --workspace "$(jq -r .id workspace.json)" \
  --path /srv/repos/api --output json > project.json
acorn task create --project "$(jq -r .id project.json)" \
  --title 'Review API' --output json > task.json
acorn agent providers --output json
acorn agent start --task "$(jq -r .id task.json)" \
  --profile codex --prompt-file brief.md --output json > session.json
acorn agent show "$(jq -r .id session.json)" --output json
acorn workflow list --task "$(jq -r .id task.json)" --output json
acorn workflow start --task "$(jq -r .id task.json)" \
  --definition repo:review --inputs-file inputs.json --output json > run.json
acorn workflow run steps "$(jq -r .id run.json)" --output json
acorn run list --output json
```

These commands select only this machine's data root; `--node` is refused. `start` returns after the
Node answers an authenticated health request. A second start returns the same `running` service.
`status` reports `running`, `starting`, `stopped`, or `running-unowned`, plus the Node ID, PID,
endpoint, protocol, health, and log path when known. A desktop or manually started Node is
`running-unowned`; the CLI can read through it when paired, but `stop` refuses it. `stop` sends
SIGTERM and waits up to 40 seconds for the Node's bounded drain and lock release. `stop --force`
explicitly kills a service only after the same ownership proof; it does not target an unknown PID.
An already stopped service returns `stopped`.

The CLI keeps a mode-0600 service record and a mode-0600 log in its custody directory's `services/`
subdirectory (mode 0700), keyed by the canonical data-root path. The log rotates to `.log.1` at
8 MiB; if Windows cannot rename an open log, it truncates the active file at that limit. On
Windows, restrict the custody directory with an NTFS ACL because POSIX modes are
advisory. The launcher's initial device token crosses a private child pipe and is stored in the
same custody store the terminal client uses; it is absent from command output, process arguments,
and logs. A clean root starts without stdin or a pairing prompt. Workspace creation remains a
separate Node operation, so `workspace list` may initially return an empty array. Ordinary reads
do not create a service.

`--help` works without a Node or terminal. `workspace list` includes each workspace's project
membership. `project list` filters a complete `GET /v1/core/projects` response by workspace ID;
paths in the result belong to the Node host, including when the CLI is remote. `task list` defaults
to active tasks. `--status archived` reads the archive list, and `--status all` reads both. `task
show` looks for the ID in both lists. Plugin rows distinguish the loaded runtime from the installed
candidate; an installed candidate may be waiting for a restart.

## Output and errors

Text is a tab-separated table. It retains IDs and supports `--no-header`. `--output json` writes
one JSON object for `show` or one array for `list`, followed by one newline. Resources have
`apiVersion: "acorn.cli/v1"`, `kind`, and `nodeId` when connected to a Node. Individual resources
also have an `id`; service status and aggregate list envelopes do not. Documented CLI fields are
projected from the Node response. JSON Lines is available for `agent events`, plugin command
discovery, and plugin command results.
Service commands return a `NodeService` state object; a stopped service has null identity
fields. A failed command writes an error to stderr; partial writes and checked waits also write
their inspectable resource to stdout. JSON mode writes one error object containing its
code and message, and, when the Node supplied them, `requestId` and `retryable`.
The [resource schema](../apps/cli/schemas/resources-v1.schema.json) and
[error schema](../apps/cli/schemas/error-v1.schema.json) pin these shapes with golden examples.

| Exit | Meaning |
| --- | --- |
| 0 | Command succeeded. |
| 1 | Unexpected client or server failure. |
| 2 | Invalid command or output option. |
| 3 | Node connection, pairing, authentication, certificate, or protocol failure. |
| 4 | Missing resource or other domain refusal. |
| 5 | Lifecycle or wait timeout. |
| 6 | A failed or canceled checked wait. |
| 7 | An ambiguous mutation or composed write with a partial result. |

```sh
acorn workspace list --output json
acorn project list --workspace "$WORKSPACE_ID" --output json
acorn task list --project "$PROJECT_ID" --status all --output json
```

From a checkout, build `@acorn/cli` and `@acorn/tui`, then run `node apps/cli/bin/acorn.mjs`.
Build `@acorn/node` too before using `node start --background` from a checkout.
The standalone Node archive includes the same `bin/acorn.mjs` launcher and both client bundles.
After `npm install --omit=dev`, run `node bin/acorn.mjs --help`. Package managers expose its
`acorn` bin when the archive is installed as a package.
See [node distribution](./node-distribution.md) for Node setup and [terminal client](./tui.md)
for the no-argument interactive host.
