---
title: The command line
description: "Script acorn with the acorn command: choose a Node, read and write workspaces, projects, and tasks, run agents and workflows, call plugin commands, and read the output and exit codes."
sources:
  - docs/cli.md
  - docs/cli/workspaces-projects-tasks.md
  - docs/cli/agents-and-workflows.md
  - docs/cli/plugin-commands.md
  - docs/cli/local-service.md
  - apps/cli/src/args.ts
checked: '034e42840'
---

`acorn` with a command is acorn's command-line interface (CLI): it talks to a Node and prints what it
gets back, for scripts and for agents. `acorn` on its own opens the terminal client instead. This page
covers choosing a Node, the commands, and reading what they print. [Command line
reference](/docs/reference/command-line-reference/) has every command's options.

## Install it

- **From the desktop app.** **Settings** > **General** > **Command line** installs `acorn` on your
  `PATH`. Open a new terminal afterwards.
- **From a checkout.** Build `@acorn/cli` and `@acorn/tui`, then run `node apps/cli/bin/acorn.mjs`.
- **From a standalone Node.** Run `node bin/acorn.mjs` in its folder.

## Choose a Node

Without `--node`, a command uses this machine's Node: the one in `ACORN_DATA_DIR`, else the desktop
app's, else a checkout's. It needs that Node to be running, and doesn't start one.

`--node` picks another Node you've paired with, by ID or name:

```sh
acorn --node 192.168.1.20:4317 task list
```

Pair first, in an interactive terminal, with `acorn --node https://<address>`
([Pair a device or a remote Node](/docs/nodes/pair-a-device-or-a-remote-node/#pair-the-terminal-client-or-the-command-line)).
A command never falls back to another Node. If the one you named can't be reached, or its identity
changed, it stops with exit code 3.

## Read and change workspaces, projects, and tasks

```sh
acorn workspace list
acorn project add --path /srv/repos/api --name api
acorn task create --project "$PROJECT_ID" --title "Review the API" --branch review-api
acorn task list --status all
```

- `project add` takes an absolute path on the Node's machine.
- `task create` makes a worktree when you give `--branch` or `--base`, and may run the project's setup
  script, as the desktop app does. Without either, the task has no branch and works in the project
  folder.
- `task scripts status`, `wait`, and `logs` read a task's setup and teardown scripts.
- With workspaces off, `workspace create` and `remove` refuse, and say to add a project instead.

Paths are always on the Node's machine, even when you run the command elsewhere. Names can repeat, so a
script should keep IDs.

A command can read the previous command's result from standard input with `-`:

```sh
set -o pipefail
acorn workspace create --name Platform --output json |
  acorn project add --workspace - --path /srv/repos/api --output json |
  acorn task create --project - --title "Review the API" --branch review-api --output json
```

## Agents and workflows

```sh
acorn agent providers
acorn agent start --task "$TASK_ID" --profile claude-code --prompt-file brief.md --output json
acorn agent wait "$SESSION_ID" --until turn-completed --check
acorn agent send "$SESSION_ID" --prompt "Now add a test for it."
acorn agent events "$SESSION_ID" --follow --output jsonl
```

- `agent providers` lists the harnesses on the Node and whether each is installed and signed in.
- `agent start` opens a managed agent session in a task with your first prompt, and returns once the
  Node has queued it. The agent keeps working after the command exits. `agent send` queues another.
- `agent wait` waits for the session to be ready, need you, finish a turn, or stop. It reports a
  question or approval, and never answers one.
- `agent events --follow` prints the session's events as they happen.

Workflows work the same way: `workflow list`, `workflow start`, and `workflow run wait`
([Start and schedule runs](/docs/automation/start-and-schedule-runs/#start-a-run-from-the-command-line)).
`run list` shows recent agent sessions, workflow runs, and schedule runs together.

## Plugin commands

Plugins can add their own commands:

```sh
acorn plugin list
acorn plugin database commands
acorn plugin database query --help
acorn plugin database query --input-file query.json --output json
```

A plugin command takes its input as a JSON object from a file, or `-` for standard input, and the Node
checks it against the command's own description before the plugin sees it. The Database plugin's
`query` runs read-only SQL against a task's database, up to 200 rows.

## Read the output

Every command takes `--output text`, `json`, or `jsonl`:

- `text`, the default, is a tab-separated table with a header, and `--no-header` leaves the header out.
- `json` writes one object for a `show` and an array for a `list`.
- `jsonl` writes one object per line, for `agent events` and plugin commands.

Every resource in JSON has `"apiVersion": "acorn.cli/v1"`, a `kind`, and the `nodeId` it came from,
and a single resource has its `id`. When a command fails, it writes the error to standard error, as one JSON object with
`--output json`. [JSON Schemas](/docs/reference/json-schemas/#validate-command-line-output) has the
schemas for both.

| Exit code | Meaning |
| --- | --- |
| 0 | It worked. |
| 1 | Something unexpected went wrong. |
| 2 | The command or an option was wrong. |
| 3 | The Node couldn't be reached, paired with, or trusted. |
| 4 | Something is missing, or the Node refused. |
| 5 | A wait timed out. |
| 6 | A `--check` wait ended in failure. |
| 7 | A change may or may not have happened, or only part of it did. |

### Retry a change safely

Changes to workspaces, projects, tasks, and agents take `--request-id <uuid>`. If a command exits 7, or
the connection drops, run it again with the same request ID and the same input. The Node remembers
answers for 24 hours, so a repeat doesn't make a second task. When `task create` or `agent start`
finished only part of the work, the command prints what it made.

## Inside a task

Terminals, scripts, and agents in a task get credentials for that task alone. With them, the command
line can read the task's scripts, and nothing else:

```sh
acorn task scripts wait --phase setup --check
```

It leaves out the task ID and reads it from the environment
([Environment variables](/docs/reference/environment-variables/#set-for-processes-in-a-task)). Other
commands refuse, and say to run them outside the task's session.

## Run a Node in the background

`acorn node start --background`, `node status`, `node restart`, and `node stop` run a Node for this
machine with no desktop app, and `node start --foreground` runs one under a service manager. `node pair`
prints a pairing code for a client on another machine, `node reach` chooses the addresses that machine
connects to, and `node devices` and `node revoke` manage the paired devices ([Run a standalone
Node](/docs/nodes/run-a-standalone-node/#start-and-stop-it-from-the-command-line)). On a Node installed
from a platform archive, `node service install` starts it at login
([Run it as a service](/docs/nodes/run-a-standalone-node/#run-it-as-a-service)).

## Limits

- The command line can't archive, restore, or delete a task, approve a gate, or answer an agent's
  question. Use the desktop app.
- `--help` works with no Node, so `acorn <command> --help` always answers.
- A script can't pair with a Node for the first time.
