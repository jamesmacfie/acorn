# The local service

This page covers the CLI commands that own a background Node on this machine: `node start
--background`, `node status`, and `node stop`. It's part of the [command-line client](../cli.md). The
code is in `apps/cli/src/supervision/`.

## Start, check, and stop

```sh
acorn node start --background --output json
acorn node status --output json
acorn workspace list --output json
acorn node stop --output json
```

These commands select only this machine's data root, and `--node` is refused. `start` runs the
standalone entry from the extracted archive and returns after the Node answers an authenticated health
request. A second `start` returns the same `running` service.

`status` reports `running`, `starting`, `stopped`, or `running-unowned`, plus the Node ID, PID, endpoint,
protocol, health, and log path when known. A desktop or hand-started Node is `running-unowned`: the CLI
can read through it when paired, but `stop` refuses it.

`stop` sends SIGTERM and waits up to 40 seconds for the Node's 30-second drain and lock release.
`stop --force` kills a service only after the same ownership proof, and never targets an unknown PID. An
already stopped service returns `stopped`.

A clean root starts without stdin or a pairing prompt. Creating a workspace is a separate Node operation,
so `workspace list` may return an empty array at first. Ordinary reads never create a service.

## Records and logs

The CLI keeps a mode-`0600` service record and a mode-`0600` log in its custody directory's `services/`
subdirectory, at mode `0700`, keyed by the canonical data-root path. The log rotates to `.log.1` at 8 MiB.
If Windows can't rename an open log, the CLI truncates it at that limit instead. On Windows, restrict the
custody directory with an NTFS ACL, because POSIX modes are advisory there.

The launcher's first device token crosses a private child pipe and is stored in the same custody store
the terminal client uses. It never appears in command output, process arguments, or logs.

## A complete script

Each invocation is its own process, and the agent and workflow keep running after their starting process
exits. Replace the project path and the profile and definition IDs with ones available on your Node.

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
