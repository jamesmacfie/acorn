# The browser host

This page covers `acorn browser install`, `status`, and `uninstall`. These commands register the
native host that the [browser extension](../browser-extension.md) starts in Chrome and Firefox. It's
part of the [command-line client](../cli.md). The code is in `apps/cli/src/browser/hostInstall.ts`.

## Install, check, and remove

```sh
acorn browser install
acorn browser status
acorn browser uninstall
```

Each command acts on both browsers. Add `--browser chrome` or `--browser firefox` to act on one. The
commands work on this computer only, so `--node` is refused. They run on macOS only.

For each browser, `install` writes two files:

1. A launcher script, `native-host`, in that browser's bridge folder,
   `~/Library/Application Support/acorn/browser-bridge/<browser>/`. It runs the Node runtime and host
   entry that ran the install, by absolute path, because a browser starts the host without a shell
   `PATH`. The folder is mode 0700 and the script mode 0700.
2. A registration, `com.acorn.browser_bridge.json`, that names the launcher and allows only the
   Acorn extension. Chrome reads it from `~/Library/Application Support/Google/Chrome/NativeMessagingHosts/`
   and Firefox from `~/Library/Application Support/Mozilla/NativeMessagingHosts/`.

Run `install` again to repair either file, for example after the Node runtime moved. The pairings in
the bridge folder stay.

`status` reports, per browser, whether the registration exists, where the launcher and bridge folder
are, how many Nodes that browser has paired, and any problem with a repair step. It finds a missing
registration, one that names another launcher or extension, a launcher that isn't executable, and a
launcher whose runtime or entry no longer exists.

`uninstall` removes the registration and the launcher. It keeps the bridge folder, which holds that
browser's pairings and tokens, and names it. Delete that folder to remove the pairings. Removing them
here doesn't revoke the devices on their Nodes.

## Development options

These options serve [the development loop](../local-development/extension-dev-loop.md). They need
one `--browser`:

| Option | Effect |
| --- | --- |
| `--development` | Uses the host name `com.acorn.browser_bridge_dev`, so a development registration never replaces the installed one. |
| `--bridge-dir ABSOLUTE` | Keeps the launcher and pairings in another folder. |
| `--registry-dir ABSOLUTE` | Writes the registration to another folder. Chrome started on its own profile reads `<profile>/NativeMessagingHosts` instead of the user-level folder. |

An Acorn task's credentials limit the CLI to `task scripts`, so run these commands outside a task
session.
