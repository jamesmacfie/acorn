# Workspaces, projects, and tasks

This page covers the CLI's core commands: workspace, project, and task reads and writes, retrying a
write, piping one command into the next, and reading task setup scripts. It's part of the
[command-line client](../cli.md).

## Retrying a write

Workspace, project, task, and agent writes accept `--request-id UUID`. Reuse the same ID and body after
an ambiguous answer. Task creation and agent start make two Node calls each and derive a stable key for
each from the request ID. The Node's device replay store keeps non-5xx answers for 24 hours, and the
agents plugin keeps its own session and turn operation records. A domain write can still land before
the replay record is saved, so inspect the resource after an ambiguous transport error.

If task creation or agent start completes only its first call, the CLI exits 7 and writes the created
resource with its ID to stdout. Retry with the same request ID to finish the second call.

## Workspaces and projects

`workspace list` includes each workspace's project membership. Removing a workspace moves its projects
to Default and removes its provider mappings, and Default can't be removed.

`project add` needs an explicit workspace ID and an absolute path on the selected Node's host. The Node
reuses a project registered through another spelling of the same folder, including a symlink. Names can
repeat, so scripts select by ID. Moving a project changes membership, never its folder. `project list`
filters a complete `GET /v1/core/projects` answer by workspace. JSON includes hidden rows, and text
leaves them out unless `--include-hidden` is set. Paths belong to the Node's host, including when the
CLI is remote. Removing a project deletes its task rows and links and leaves the folder and worktrees on
disk.

`project config set` takes a JSON object of exact project configuration fields. Unknown fields and
malformed browser rules fail before a write. Script fields may run later under the Node's configuration
trust rules.

`workspace external-projects replace` takes a complete `{ "projects": [...] }` object, and an empty array
clears the mapping. Each row needs `integrationId` and `externalId`, with an optional `projectId`. The
Node checks the connected provider and project membership. Provider mappings don't register local
projects.

## Tasks

`task list` defaults to active tasks. `--status archived` reads the archive list, and `--status all`
reads both. `task show` looks for the ID in both lists.

`task create` sends origin `local`, then calls the same `on-created` hook as the desktop. The hook seeds
notes and may prepare a worktree or run a created-trigger setup script. A branchless task runs in its
project folder, and a non-Git project has no worktree isolation. The hook is best effort, so a
successful answer doesn't prove every setup action succeeded.

`--base BRANCH` starts a worktree task from a local branch's last commit, without uncommitted changes.
With `--branch NAME`, acorn keeps the exact name and refuses a taken one. With `--base` alone, it derives
the name from the title and adds a numeric suffix on a clash. With neither, the task is branchless.
Without a base an unused local branch can be reused, and with a base every local branch name counts as
taken.

## Piping resources

`--workspace -`, `--project -`, `--task -`, and a positional session `-` read one `acorn.cli/v1` resource
from stdin, and check its `kind` and its `nodeId` against the selected Node. A command won't read stdin
twice, so use a file for a prompt or JSON body when you're also piping a resource.

```sh
set -o pipefail
acorn workspace create --name Platform --output json |
  acorn project add --workspace - --path /srv/repos/api --output json |
  acorn task create --project - --title 'Review API' --branch review-api --output json
```

## Task scripts

```sh
acorn task scripts status "$TASK_ID" --output json
acorn task scripts wait "$TASK_ID" --phase setup --timeout 5m --check --output json
acorn task scripts logs "$TASK_ID" --phase setup --tail 100
```

These reads never create a worktree or start a script. Status returns `TaskScripts`, wait returns
`TaskScriptWait`, and logs return `TaskScriptLogs`. Text status prints one row per phase, and JSON
includes bounded attempt history. `--attempt ID` picks a kept attempt for wait or logs. Without it, the
command uses the current one and binds a wait to its identity and generation. Logs say when capture is
unavailable or earlier output was cut, and are capped at 1,000 lines and 32 KiB.

A wait makes Node calls of at most 30 seconds under one deadline: five minutes by default, in seconds or
with an `s`, `m`, or `h` suffix, up to 24 hours. A timeout exits 5. `--check` exits 6 for failure,
interruption, unknown history, or no request, and still prints the resource. A confirmed exit zero and
the intentional skips, `user_skipped`, `disabled`, `not_configured`, and `not_applicable`, pass a check.
A skip keeps its reason, and passing doesn't mean dependencies were installed. Ctrl+C exits 130 and stops
only the local wait.

Inside a task-scoped launch, `TASK_ID` may be left out. The CLI reads `ACORN_TASK_ID`, the task's
`ACORN_API_TOKEN`, the expected `ACORN_NODE_ID`, and `NODE_EXTRA_CA_CERTS` from the launch environment,
and checks the pinned certificate and Node identity before it sends the token. A different task or Node
is rejected. That connection permits only the task's script reads and never falls back to device
credentials, and every other command is refused.
