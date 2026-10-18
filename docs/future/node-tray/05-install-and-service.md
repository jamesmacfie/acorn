# Phase 5: install, run at login, upgrade, and remove

Date: October 18, 2026. Status: proposed. Depends on [phase 2](./02-terminal-pairing.md) and
[phase 4](./04-platform-archives.md).

## Goal

One command installs an extracted archive for the current user. It puts `acorn` on the `PATH`, gives
the Node a fixed data root, and, if the person agrees, registers the Node to start at login and
restart after a crash. Running a newer archive's installer upgrades in place, and removal keeps the
data.

## Starting point

- Phase 4's archive holds `bin/acorn`, `runtime/`, `lib/`, and an empty slot for the installer.
- The CLI's `dataRootDir()` reads `ACORN_DATA_DIR`, then the desktop's data root if it holds
  `node.json`, then the checkout's development root (`packages/custody/src/local/paths.ts`). An
  installed archive has no checkout, so without the variable the lookup throws.
- The desktop keeps its Node's data at `<app data>/com.acorn.desktop/node`, and a standalone Node
  refuses that root once its keys are sealed.
- Phase 2 gives a service manager `acorn node start --foreground`, with `--log FILE` for managers that
  don't rotate logs, and `acorn node stop` drains on every platform.
- The standalone Node inherits its `PATH` and skips the login-shell probe the desktop runs
  ([boot order](../../node-distribution.md#boot-order)). A service manager hands it a short default
  `PATH`, so `claude` or `codex` in the person's home folder isn't found.
- `acorn agent providers` lists the harnesses the Node found ([the CLI](../../cli.md#commands)).
- [Version skew](../split/04-version-skew.md): a client and a Node from different builds still work
  together, but the client asks to trust every bundled plugin again.

## Design

### Where things go

| | macOS | Linux | Windows |
| --- | --- | --- | --- |
| Install root | `~/Library/Application Support/acorn-node` | `$XDG_DATA_HOME/acorn-node`, else `~/.local/share/acorn-node` | `%LOCALAPPDATA%\acorn-node` |
| One version | `<root>/versions/<version>` | Same | Same |
| Current version | `<root>/current`, a symbolic link | Same | `<root>\current`, a junction |
| Command | `~/.local/bin/acorn` | Same | `<root>\bin\acorn.cmd`, on the user `PATH` |
| Data root | `<root>/node`, mode `0700` | Same | `<root>\node`, with an access list for this user and SYSTEM |
| Logs | `<root>/logs/node.log` | The systemd journal | `<root>\logs\node.log` |

The command is a two-line shim, not a link. It sets `ACORN_DATA_DIR` to `<root>/node` when the
variable is unset, then runs `<root>/current/bin/acorn`. So every `acorn` in every shell talks to the
installed Node, and a person can still point it elsewhere with the variable. The CLI's custody folder
stays where it is, in the operating system's config folder.

### The installer

The installers are `install.sh` on macOS and Linux and `install.ps1` on Windows. Their sources are
`scripts/node-archive/install.sh` (new) and `scripts/node-archive/install.ps1` (new). Run from an
extracted archive, the installer:

1. Refuses to run as root or as an elevated administrator. A Node that runs agents as root is the
   wrong default, and a per-user install needs no elevation.
2. Stops with a warning when the desktop's data root holds a `node.json`, unless given `--force`,
   because the machine would have two Nodes.
3. Copies the archive into `versions/<version>`. On macOS it removes the quarantine attribute from
   that copy. On Windows it runs `Unblock-File` on it.
4. If an earlier version is current and its Node runs, stops it with `acorn node stop`.
5. Points `current` at the new version, writes the shim, and creates the data root with its
   permissions. On Windows it sets the access list with `icacls`, removing inherited entries.
6. Starts the Node again if step 4 stopped it, through its service when one is registered.
7. Asks whether to start the Node at login, or takes `--service` and `--no-service` in a script. Yes
   runs `acorn node service install`.
8. Keeps the previous version folder and deletes any older one.
9. Prints the next steps: `acorn node reach`, `acorn node pair`, and `acorn agent providers`. It also
   says when `~/.local/bin` isn't on the `PATH`, and how to add it.

A failure before step 5 leaves the earlier version current and its Node running.

On Windows the person runs `powershell -ExecutionPolicy Bypass -File install.ps1`, because a
downloaded script is blocked by default. The README says so.

### Run at login

`acorn node service install`, `uninstall`, and `status` live in one CLI module,
`apps/cli/src/supervision/service.ts` (new). Each platform's file is written in one tested place, and
both installers call it.

`install` records the `PATH` of the shell that runs it into the service definition, so the Node finds
the same `claude` and `codex` the person does. It warns when neither is on that `PATH`. It also records
`ACORN_DATA_DIR`.

On macOS it writes `~/Library/LaunchAgents/sh.acorn.node.plist` and loads it with
`launchctl bootstrap gui/<uid>`:

- `ProgramArguments` runs the shim with `node start --foreground --log <root>/logs/node.log`.
- `RunAtLoad` is true. `KeepAlive` restarts it only after an unsuccessful exit.
- `ProcessType` stays at its default. `Background` lets macOS throttle the Node's work.

A LaunchAgent runs while the person is logged in. A Mac with nobody logged in needs automatic login,
which FileVault turns off. The doc says so, and leaves a root LaunchDaemon out of scope.

On Linux it writes `~/.config/systemd/user/acorn-node.service`, then runs
`systemctl --user daemon-reload` and `systemctl --user enable --now acorn-node`:

- `ExecStart` runs the shim with `node start --foreground`. Logs go to the journal.
- `Restart=on-failure` and `RestartSec=5`.
- `TimeoutStopSec=45`, which covers the 30-second drain.
- `KillMode=mixed`, so systemd sends `SIGTERM` to the Node alone and the Node stops its own children.

It then runs `loginctl enable-linger`, so the Node starts at boot and keeps running after logout.
When that's refused, it prints the `sudo loginctl enable-linger <user>` command. On a machine with no
systemd user manager, it prints a recipe and exits with an error.

On Windows it registers a scheduled task, **acorn node**, that runs at logon for this user. The task
runs `acorn node start --background`, which starts the Node with no console window and returns.
Windows doesn't restart it after a crash. The doc records that limit.

`uninstall` stops the Node and removes the definition. `status` names the manager, the file, and
whether it's loaded and running.

### Upgrade

Extract the newer archive and run its installer. The data root stays, and the Node runs its
migrations at boot. Migrations only go forward, so there's no rollback command. A person who needs
the earlier version restores a backup and installs that version.

Upgrade the Node and the desktop clients from the same tag, so clients don't ask to trust the bundled
plugins again. `acorn node info` reports the Node's build.

### Remove

`install.sh --uninstall` and `install.ps1 -Uninstall` run `acorn node service uninstall`, stop the
Node, and remove `versions`, `current`, the shim, and the `PATH` entry. They keep the data root and
the CLI's custody folder, and print both paths. `--purge` deletes the data root too, after the person
types its path.

## Steps

1. Write the shim and teach `bin/acorn` to refuse a missing `ACORN_DATA_DIR` with a clear message.
2. Write `service.ts` with a writer per platform, and unit tests that compare each generated file with
   a fixture.
3. Write `install.sh` and `install.ps1`, and copy them into each archive in phase 4's packer.
4. Add the installer steps to phase 4's smoke test: install into the temporary home, register the
   service where the runner allows it, check `acorn node status`, and uninstall.
5. Rewrite "Install and start" in [Node distribution](../../node-distribution.md#install-and-start)
   with the tested commands, and add `acorn node service` to [the local service](../../cli/local-service.md).
6. In [Operations](../../node-distribution.md#operations), replace the advice to set an NTFS access
   list by hand with the installer's access list.

## Acceptance

- Unit tests cover each platform's service file, the refusal to run as root, the desktop data root
  warning, and the shim's data root default.
- On a clean virtual machine for each operating system: install from an archive, register the
  service, reboot, and find the Node running. `acorn node pair` opens a code, and a client on another
  machine pairs.
- Upgrade to a second build: the data, the paired devices, and the service survive, and
  `acorn node info` reports the newer build.
- Uninstall: the command and the service are gone, and the data root is still there.
- A Linux install over SSH keeps the Node running after the SSH session ends.

## Risks

- The recorded `PATH` goes stale when a person installs a harness somewhere else later. Running
  `acorn node service install` again refreshes it, and the warning in `install` names that command.
- Without restart on Windows, a crashed Node stays down until the next logon or a manual start.
  Revisit after phase 8 with a measured crash rate.
- The macOS LaunchAgent needs a logged-in session, which suits a Mac someone uses, not a Mac in a
  cupboard.

## Verify before building

- Check whether `acorn node start --background` on Windows needs `windowsHide: true` to start
  without a console window, in `apps/cli/src/supervision/lifecycle.ts`.
- Check whether the scheduled task can run `--foreground` without a visible window, which would give
  Windows restart on failure.
- Check that `loginctl enable-linger` for one's own user works without `sudo` on Ubuntu 22.04,
  Debian 12, and Raspberry Pi OS.
- Check whether a LaunchAgent's `node` process is subject to App Nap with the default `ProcessType`.
