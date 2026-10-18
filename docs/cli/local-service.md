# The local service

This page covers the CLI commands that run and administer a Node on this machine: `node start`,
`status`, `stop`, `restart`, `pair`, `devices`, `revoke`, `reach`, and `service`. It's part of the
[command-line client](../cli.md). The service code is in `apps/cli/src/supervision/`.

## Start, check, and stop

```sh
acorn node start --background --output json
acorn node status --output json
acorn workspace list --output json
acorn node stop --output json
```

`start`, `status`, `stop`, and `restart` select only this machine's data root, and `--node` is refused.
`start` takes exactly one of `--background` and `--foreground`, and runs the standalone entry from the
extracted archive. `--background` returns after the Node answers an authenticated health request. A
second `start` returns the same `running` service.

`status` reports `running`, `starting`, `stopped`, or `running-unowned`, plus the Node ID, PID, endpoint,
protocol, health, and log path when known. A desktop or hand-started Node is `running-unowned`: the CLI
can read through it when paired, but `stop` refuses it.

A clean root starts without stdin or a pairing prompt. Creating a workspace is a separate Node operation,
so `workspace list` may return an empty array at first. Ordinary reads never create a service.

## Run under a service manager

`acorn node start --foreground` is the background start, attached. It uses the same launcher pipes,
service record, and token custody, so the CLI holds the Node's token afterward. The Node writes to the
command's stdout and stderr, which systemd keeps in its journal. `--log FILE` writes them to a log that
rotates at 8 MiB instead, for launchd and Windows, which don't rotate. Neither carries a credential.

The command forwards SIGTERM and SIGINT to the Node and exits with the Node's exit code. The Node treats
a repeated signal as the same stop, so a terminal or systemd that also signals it directly can't cut its
drain short. A crash is the service manager's to restart. Like `--background`, it drops
`ACORN_ADVERTISE_HOST` from the Node's environment, so choose the hosts with `acorn node reach` instead.

## Start at login

```sh
acorn node service install
acorn node service status
acorn node service uninstall
```

`install` registers the installed Node with launchd, a systemd user unit, or a Windows scheduled task,
and starts it through that definition. It runs the shim an archive installer writes, and refuses when
the shim is missing. The definition records the `PATH`, `ACORN_DATA_DIR`, `HOME`, and `XDG_CONFIG_HOME`
of the shell that runs `install`, so run it again after installing a harness somewhere new. It stops a
Node this CLI started first, so the service's launcher owns the Node, and waits up to two minutes for
the Node to answer. Its `problem` says when neither `claude` nor `codex` is on that `PATH`, when Linux
refused lingering, or when the Node didn't start.

`uninstall` stops the Node and removes the definition. `status` answers a `NodeServiceRegistration`
with the manager, the file, whether the manager has it loaded, and whether the Node is running. Each
platform's file is in [install a Node from an archive](../node-distribution/install.md#start-at-login).

## Stop and restart

`stop` asks the Node over `POST /v1/core/node/stop` with its device token, then waits up to 40 seconds
for the 30-second drain and the lock release. The route answers only a device on this computer, so a
paired client on another machine can't stop the Node, and it writes a `node.stop.requested` audit row.
When the Node doesn't take the request, `stop` sends SIGTERM on macOS and Linux. Windows ends a process
outright for SIGTERM, so there it reports `node_stop_refused` instead. `stop --force` kills a service
only after the same ownership proof, and never targets an unknown PID. An already stopped service
returns `stopped`.

`restart` sends `{ "restart": true }`, and the Node exits with code 75 after its drain. A foreground
launcher starts it again in the same process, so a service manager sees no exit. A background Node has
no launcher left, so `restart` stops it and starts it with `--background`. A desktop's Node refuses the
route, because the desktop owns its lifetime.

## Pair from the terminal

`acorn node pair` opens a pairing window and prints what a person on the other machine needs: the
address, the certificate fingerprint as six identity words, and a code valid for ten minutes. With
`--output json` it writes one `PairingWindow` resource with `endpoints`, `identity`, `code`, and
`expiresAt`. The code is meant to be read, so it's printed. No device token is. `--close` closes the
window early.

The address is each host the Node answers other machines on, from `GET /v1/core/node/reach`. A Node
with no hosts, or one still waiting to restart onto new ones, gets the address the CLI reached it on,
which for the local Node is loopback. To reach it from another machine, run `acorn node reach`.

`pair` uses the CLI's device token, and with none it pairs the CLI first, as every command does. It
also takes `--node`, because opening a code needs no authority a paired device lacks. A Node that runs
as another operating system user is paired by that user, such as `sudo -u acorn acorn node pair`.

## Choose who can reach the Node

```sh
acorn node reach
acorn node reach 192.168.1.20 workshop.local
acorn node reach --private
```

With no arguments, `reach` prints the address another machine connects to, where the hosts come from,
and this machine's IPv4 addresses. With hosts, it sets the list the Node answers on besides loopback,
and `--private` clears it. The Node checks the list and refuses all of it over one bad entry. With
`--output json` it writes one `NodeReach` resource with `hosts`, `source`, `port`, `endpoints`,
`candidates`, `restartRequired`, and `restarted`.

The Node takes the change only from a device on its own computer, so `reach` refuses `--node`. The
listener binds at boot, so a change restarts a Node the CLI started, as `acorn node restart` does, and
the Node keeps its port. Any other Node, such as the desktop's, answers on the new list after its own
restart, and `reach` says so. [Reach a Node from another machine](../node-distribution/reaching.md)
covers the rules, the fixed port, and the firewall.

## List and revoke devices

`acorn node devices` lists each paired device: its ID, name, `pairedAt`, `lastSeenAt`, `revokedAt`, and
`thisTerminal` for the CLI's own row. `acorn node revoke ID` revokes one and closes its sockets.
Revoking the CLI's own device needs `--force`, because the CLI must pair again afterward. Both take
`--node`.

## Records and logs

The CLI keeps a mode-`0600` service record and a mode-`0600` log in its custody directory's `services/`
subdirectory, at mode `0700`, keyed by the canonical data-root path. A foreground Node records `foreground: true` and logs only with
`--log`. The log rotates to `.log.1` at 8 MiB.
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
