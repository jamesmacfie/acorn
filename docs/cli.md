# Command-line client

This page covers the headless `acorn` command: how it picks a Node, every command, its output, and its
exit codes. Read it before you script against a Node or change a CLI resource shape.

`acorn` with no arguments opens the [terminal client](./tui.md). With a command it runs a headless
client of one Node's `/v1` API. It shares the terminal client's fleet, pinned certificates, and
device-token store through `@acorn/custody`. Ordinary commands attach to a running local Node or a
paired remembered Node and never start one. The Node still owns tasks, plugins, and execution. The
source is `apps/cli/src/`, and `apps/cli/src/args.ts` holds the parser and the help text.

## Pages

| Page | What it covers |
| --- | --- |
| [Workspaces, projects, and tasks](./cli/workspaces-projects-tasks.md) | Core writes, request IDs, stdin piping, and task script reads |
| [Agents and workflows](./cli/agents-and-workflows.md) | Managed agent sessions, workflow runs, and the merged run list |
| [Plugin commands](./cli/plugin-commands.md) | Discovering and invoking a plugin's CLI commands |
| [The local service](./cli/local-service.md) | `node start --background`, `status`, and `stop` |

## Choosing a Node

The local Node uses `ACORN_DATA_DIR`, then the desktop app's data root when present, then the
development root. `--node ID` selects a remembered Node, and an unambiguous label works too.
`--node https://HOST:PORT` pairs interactively when that Node isn't remembered, so a script can't pair
for the first time. An unavailable Node, a missing token, a changed certificate, a rejected credential,
or an incompatible protocol exits with a connection error, and a command never falls back to another
Node. The terminal client's `--node` and `--task` switches still open that client when no command
follows them.

To pair with a local Node, open **Settings → Nodes → Pair another client** in the desktop that started
it. For a standalone Node, run `kill -USR1 PID` and read the code from its terminal. Then run the
command in an interactive terminal and enter the code.

## Commands

```text
acorn [--node NODE] node info|start --background|status|stop [--force]
acorn [--node NODE] workspace list|show ID|create --name NAME|rename ID --name NAME|remove ID
acorn [--node NODE] workspace external-projects list ID|replace ID --file FILE|-
acorn [--node NODE] project list [--workspace ID] [--include-hidden]|show ID
acorn [--node NODE] project add --workspace ID --path ABSOLUTE [--name NAME]
acorn [--node NODE] project rename ID --name NAME|move ID --workspace ID|hide ID|unhide ID|detect ID|remove ID
acorn [--node NODE] project config show ID|set ID --patch-file FILE|-
acorn [--node NODE] task list [--project ID] [--status active|archived|all]
acorn [--node NODE] task show ID|create --project ID --title TEXT [--branch NAME] [--base BRANCH] [--skip-setup]
acorn [--node NODE] task scripts status [TASK_ID]
acorn [--node NODE] task scripts wait [TASK_ID] --phase setup|teardown [--attempt ID] [--timeout 5m] [--check]
acorn [--node NODE] task scripts logs [TASK_ID] --phase setup|teardown [--attempt ID] [--tail 100] [--max-bytes 32768]
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
acorn [--node NODE] plugin ID commands
acorn [--node NODE] plugin ID COMMAND --help
acorn [--node NODE] plugin ID COMMAND --input-file FILE|- [--request-id UUID]
```

Every command takes `--output text|json|jsonl`, `--no-header`, and `--help`. `--help` works without a
Node or a terminal. Workspace, project, task, and agent writes also take `--request-id UUID`.

## Output and errors

Text output is a tab-separated table that keeps IDs and supports `--no-header`. `--output json` writes
one JSON object for `show` or one array for `list`, then a newline. JSON Lines works for
`agent events`, plugin command discovery, and plugin command results.

Resources have `apiVersion: "acorn.cli/v1"`, a `kind`, and a `nodeId` when connected. Single resources
also have an `id`. Service status and aggregate list envelopes don't. Task script resources use
`taskId` or `snapshot.taskId`, with execution identity in `attemptId`. Fields are projected from the
Node's answer. Service commands return a `NodeService` state object, and a stopped service has null
identity fields.

A failed command writes an error to stderr. Partial writes and checked waits also write their
inspectable resource to stdout. In JSON mode the error is one object with its code and message, plus
`requestId` and `retryable` when the Node supplied them. The
[resource schema](../apps/cli/schemas/resources-v1.schema.json) and
[error schema](../apps/cli/schemas/error-v1.schema.json) pin these shapes with golden examples.

| Exit | Meaning |
| --- | --- |
| 0 | The command succeeded. |
| 1 | An unexpected client or server failure. |
| 2 | An invalid command or output option. |
| 3 | A Node connection, pairing, authentication, certificate, or protocol failure. |
| 4 | A missing resource or another domain refusal. |
| 5 | A lifecycle or wait timeout. |
| 6 | An unsuccessful checked wait, including unknown or unrequested script outcomes. |
| 7 | An ambiguous mutation, or a composed write with a partial result. |

## Install the command

- **From a checkout**, build `@acorn/cli` and `@acorn/tui`, then run `node apps/cli/bin/acorn.mjs`.
  Build `@acorn/node` too before `node start --background`.
- **From the desktop**, Settings → Command line installs a headless `acorn` in a writable directory on
  the login shell's `PATH`. The launcher uses the desktop bundle's pinned Node and CLI, or the current
  checkout in a development build, and sets `ACORN_DATA_DIR` to that app's local Node root unless the
  caller set it. Open a new terminal afterwards. The action won't replace a command it didn't install.
  If no writable directory is on `PATH`, create `~/.local/bin`, add it to `PATH`, and try again. Moving
  the app or checkout means clicking the action again. This command is headless.
- **From a standalone Node archive**, run `node bin/acorn.mjs --help` after `npm install --omit=dev`.
  The archive's launcher includes both the CLI and the terminal client, and a package manager exposes
  its `acorn` bin when the archive is installed as a package ([node distribution](./node-distribution.md)).
