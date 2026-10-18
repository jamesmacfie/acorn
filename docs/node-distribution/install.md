# Install a Node from an archive

A platform archive carries its own installer: `install.sh` on macOS and Linux, and `install.ps1` on
Windows. It installs the archive for one user, puts `acorn` on the `PATH`, gives the Node a fixed data
root, and, if the person agrees, registers the Node with the platform's service manager. Running a
newer archive's installer upgrades in place, and removal keeps the data. This page is part of
[Node distribution](../node-distribution.md). The sources are `scripts/node-archive/install.sh`,
`scripts/node-archive/install.ps1`, and `apps/cli/src/supervision/service.ts`.

## Where things go

| | macOS | Linux | Windows |
| --- | --- | --- | --- |
| Install root | `~/Library/Application Support/acorn-node` | `$XDG_DATA_HOME/acorn-node`, else `~/.local/share/acorn-node` | `%LOCALAPPDATA%\acorn-node` |
| One version | `<root>/versions/<version>` | Same | Same |
| Current version | `<root>/current`, a symbolic link | Same | `<root>\current`, a junction |
| Command | `~/.local/bin/acorn` | Same | `<root>\bin\acorn.cmd`, on the user `PATH` |
| Data root | `<root>/node`, mode `0700` | Same | `<root>\node`, with an access list for this user and SYSTEM |
| Logs | `<root>/logs/node.log` | The systemd journal | The CLI's service log, which `acorn node status` names |

The command is a shim, not a link. It sets `ACORN_DATA_DIR` to `<root>/node` when the variable is
unset, then runs `<root>/current/bin/acorn`. So every `acorn` in every shell talks to the installed
Node, and a person can still point it elsewhere with the variable. The archive's own `bin/acorn`
refuses to run without the variable, so an archive that isn't installed never falls back to the
desktop's data root. The CLI's custody folder stays in the operating system's config folder.

## Install and upgrade

```sh
acorn-node-<version>-<platform>/install.sh [--service | --no-service] [--force]
```

On Windows, Windows blocks a downloaded script, so run
`powershell -ExecutionPolicy Bypass -File install.ps1 [-Service | -NoService] [-Force]`. The installer:

1. Refuses to run as root or as an elevated administrator. A Node runs agents with its user's rights.
2. Stops when the desktop's data root holds a `node.json`, unless given `--force`, because one machine
   runs one Node.
3. Copies the archive beside `versions/<version>`. On macOS it clears the quarantine mark from the
   copy, and on Windows it unblocks it.
4. If the current version's Node runs, stops it with `acorn node stop`.
5. Moves the copy into place, points `current` at it, writes the shim, and creates the data root with
   its permissions. On Windows it adds `<root>\bin` to the user `PATH`, and sets the data root's access
   list with `icacls`, removing inherited entries.
6. Starts the Node again if step 4 stopped it: through `acorn node service install` when a service is
   registered, and with `acorn node start --background` otherwise.
7. With no service registered, asks whether to start the Node at login. `--service` and `--no-service`
   answer for a script, and a run with no terminal answers no. Yes runs `acorn node service install`.
8. Keeps the previous version's folder and deletes any older one.
9. Prints the next steps: `acorn node start` when nothing started the Node, then `acorn node reach`,
   `acorn node pair`, and `acorn agent providers`. On macOS and Linux it also says when `~/.local/bin`
   isn't on the `PATH`, and how to add it.

A failure before step 5 leaves the earlier version current. A running Node keeps the files of the
version it started from, because the runtime resolves its script through the link once.

To upgrade, extract the newer archive and run its installer. The data root stays, and the Node runs its
migrations at boot. Migrations only go forward, so there's no rollback command. To go back, restore a
backup and install the earlier version. Upgrade the Node and the desktop clients from the same tag, so
clients don't ask to trust the bundled plugins again. `acorn node info` reports the Node's build.

## Start at login

`acorn node service install`, `uninstall`, and `status` write, remove, and read the platform's
definition ([the local service](../cli/local-service.md#start-at-login)). `install` refuses to run
before the installer has written the shim. It records the `PATH` of the shell that runs it,
`ACORN_DATA_DIR`, and `HOME` and `XDG_CONFIG_HOME` when set, because a service manager hands its jobs a
short `PATH`, and the CLI under the service must find the same custody folder as the person's shell.
It stops a Node the CLI started, so the service's launcher owns the Node, starts the Node through the
service, and waits up to two minutes for it. It warns when neither `claude` nor `codex` is on the
recorded `PATH`.

| | macOS | Linux | Windows |
| --- | --- | --- | --- |
| Definition | `~/Library/LaunchAgents/sh.acorn.node.plist` | `~/.config/systemd/user/acorn-node.service` | Task **acorn node**, running `<root>\acorn-node-service.cmd` |
| Loaded with | `launchctl bootstrap gui/<uid>` | `systemctl --user enable --now acorn-node` | `schtasks /Create /XML`, then `/Run` |
| Runs | `acorn node start --foreground --log <root>/logs/node.log` | `acorn node start --foreground` | `acorn node start --background` |
| After a crash | Restarts, because `KeepAlive` asks only for an unsuccessful exit | `Restart=on-failure`, after 5 seconds | Stays down until the next sign-in or a manual start |
| Stop timeout | `ExitTimeOut` 45 seconds | `TimeoutStopSec=45`, with `KillMode=mixed` | None |

`acorn node stop` drains the Node, which exits 0, so neither launchd nor systemd starts it again.
The LaunchAgent keeps the default `ProcessType` and writes the launcher's own errors to
`<root>/logs/launcher.log`.

On Linux, `install` runs `loginctl enable-linger`, so the user manager starts at boot and keeps the
Node running after logout or the end of an SSH session. When that's refused, it reports the
`sudo loginctl enable-linger <user>` command. On a machine with no systemd user manager, it says to
start the Node from a login script and fails.

On Windows the task runs at sign-in for this user, on battery too, with no time limit. A scheduled task
can't set environment variables, so the script it runs records them. `--background` returns once the
Node answers, so the script's console window closes after a few seconds.

## Remove

`install.sh --uninstall` and `install.ps1 -Uninstall` run `acorn node service uninstall` and
`acorn node stop`, then remove `versions`, `current`, the logs, the shim, and the `PATH` entry. They
keep the data root and the CLI's custody folder, and print both paths. `--purge` or `-Purge` also
deletes the data root after the person types its path.

## Limits

- A LaunchAgent runs only while the person is logged in. A Mac with nobody logged in needs automatic
  login, which FileVault turns off. A root LaunchDaemon is out of scope.
- Windows doesn't restart a Node that crashed.
- The recorded `PATH` goes stale when a person installs a harness somewhere else later. Running
  `acorn node service install` again records the new one.
- The installer refuses root, so a container that runs as root sets `ACORN_DATA_DIR` and runs
  `bin/acorn` from the extracted archive instead.
