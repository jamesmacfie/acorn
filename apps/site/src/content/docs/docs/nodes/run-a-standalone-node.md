---
title: Run a standalone Node
description: Run acorn's Node without the desktop app, on a server or another machine, start and stop it from the command line or a service manager, and know which plugins it has.
sources:
  - docs/node-distribution.md
  - docs/node-distribution/reaching.md
  - docs/node-distribution/install.md
  - docs/node-distribution/keep-awake.md
  - docs/cli/local-service.md
  - apps/node/src/entries/standalone.ts
  - apps/node/src/composition/plugins.ts
  - scripts/pack-node.mjs
  - scripts/node-archive/README.md
checked: '1aaa5e5b6'
---

A standalone Node is acorn's Node with no desktop app: on a server, a build machine, or Linux, where the
desktop app doesn't run. You pair the desktop app, the terminal client, or the command line with it.
This page covers installing it, the settings it reads, starting and stopping it, running it as a
service, and what it can do.

## Install it

### From a platform archive

A packaging run of acorn's GitHub Actions builds a self-contained archive for macOS arm64 and x64, Linux
x64 and arm64, and Windows x64. It carries its own Node.js and every dependency, so the machine needs no
Node.js or build tools. Download `acorn-node-<platform>` from the run's artifacts, then check, extract,
and install it, as yourself rather than as root:

```sh
shasum -a 256 -c acorn-node-*.tar.gz.sha256
tar -xzf acorn-node-*.tar.gz
acorn-node-*/install.sh
```

The installer copies the Node into your user's application data folder, puts an `acorn` command in
`~/.local/bin`, keeps the Node's data in a private folder beside it, and asks whether to start the Node
when you log in. It stops if the desktop app already runs a Node on this machine, because one machine
runs one Node. On Windows, extract the zip, then run
`powershell -ExecutionPolicy Bypass -File install.ps1` in its folder, from a PowerShell window that
isn't elevated. Then start the Node, unless it already starts at login, and pair:

```sh
acorn node start --background
acorn node pair
```

On Linux, the archive needs glibc 2.31 or later, which Ubuntu 22.04, Debian 11, and Raspberry Pi OS 11
have. The archive's `README.md` covers the rest, and the run keeps it for 14 days.

To upgrade, extract a newer archive and run its installer. The Node keeps its data and its paired
devices. `install.sh --uninstall`, or `install.ps1 -Uninstall`, removes acorn and keeps the Node's data.

### From the tarball

The machine needs Node.js 22.23.2 or later in branch 22, 24.18.1 or later in branch 24, or 26.5.1 or
later in branch 26. On Linux it also needs the usual build tools, because `node-pty`, the one native
module, compiles when you install.

1. Build the archive in a checkout of acorn with `pnpm pack:node`. It writes
   `apps/node/release/acorn-node-<version>.tar.gz`. Copy it to the machine.
2. Unpack it and install what it needs:

   ```sh
   tar -xzf acorn-node-*.tar.gz
   cd acorn-node
   npm ci --omit=dev
   npm rebuild
   node scripts/prune-runtime.mjs
   ```

   `prune-runtime.mjs` removes installed files nothing loads. Run it again after every `npm ci`.

3. Start it, with a folder of its own for its data:

   ```sh
   ACORN_DATA_DIR=/var/lib/acorn-node npm start
   ```

   It prints **acorn node ready**, with the address under **Connect to**, its **Identity** as six words,
   and a **Pairing code**.

The first time it starts in a terminal, it asks which address to answer on. Enter alone keeps it on
this machine. [Pair a device or a remote
Node](/docs/nodes/pair-a-device-or-a-remote-node/#let-other-machines-reach-the-node) explains the
choice and how to pair.

To run agents on it, install Claude Code or Codex on that machine, signed in with its own login, and
on the `PATH` the Node starts with. acorn doesn't download either.

## The settings it reads

A standalone Node reads its settings from the environment. These are the ones you're likely to set:

| Variable | What it does |
| --- | --- |
| `ACORN_DATA_DIR` | The folder the Node keeps everything in. Give each Node its own. |
| `ACORN_ADVERTISE_HOST` | The addresses other machines reach it at, separated by commas. It wins over `acorn node reach`. Without either, the Node answers only on this machine. |
| `ACORN_PORT` | The port to listen on. Without it, the Node uses the port it had last time. A private Node takes another port if that one's taken. A reachable Node won't start without it. |
| `SESSION_ENC_KEY` | The key it encrypts stored credentials with. Without it, the Node makes one and keeps it in its data folder. |

[Environment variables](/docs/reference/environment-variables/#the-node) lists every one.

The data folder should be readable only by the user the Node runs as. Only one Node can use a folder
at a time. On Windows, file modes don't protect it. The installer restricts its folder to you, so
restrict a folder you choose yourself in its properties.

## Start and stop it from the command line

The command line can run a Node for this machine in the background, from the archive's folder:

```sh
node bin/acorn.mjs node start --background
node bin/acorn.mjs node status
node bin/acorn.mjs node restart
node bin/acorn.mjs node stop
```

- `node start --background` returns once the Node answers. Running it again returns the same Node.
- `node status` says **running**, **starting**, **stopped**, or **running-unowned**, with the Node's ID,
  address, process ID, and log file. **running-unowned** is a Node something else started, such as the
  desktop app or a terminal.
- `node stop` asks the Node to finish what it's doing, and waits up to 40 seconds, on Windows too. It
  won't stop a Node it didn't start. `node stop --force` kills a Node it started that won't stop.
- `node restart` stops the Node and starts it again.
- `node start --foreground` runs the Node the same way, but stays attached and writes the Node's output
  to the terminal, for a service manager. `--log <file>` writes it to a file that starts over at 8 MB
  instead.

These always use this machine's data folder, and refuse `--node`. The command line keeps the Node's log
in its config folder, under `services/`, and starts a new log file at 8 MB.

A Node started this way prints no pairing banner, because the command line on that machine already has
its token. It also ignores `ACORN_ADVERTISE_HOST`. To let other machines reach it, run
`node bin/acorn.mjs node reach <address or name>`, which restarts the Node on the same port. To pair a
client on another machine, run `node bin/acorn.mjs node pair`. It prints the
Node's address, its identity, and a pairing code. `node devices` lists the paired devices, and
`node revoke <id>` revokes one.

## Run it as a service

An installed archive registers itself with `acorn node service install`, which is what the installer
runs when you ask it to start the Node at login. On macOS a LaunchAgent starts the Node when you log in,
and on Linux a systemd user service starts it at boot. Both restart it after a crash. On Windows a
scheduled task starts it when you sign in, but nothing restarts it after a crash. A Mac starts it only
once someone logs in. On Linux the service keeps running after you log out. If Linux refuses that, the
command prints the `sudo loginctl enable-linger` line to run.

- `acorn node service status` says whether the service is registered and the Node is running.
- `acorn node service uninstall` stops the Node and removes the service.
- The service keeps the `PATH` it was installed with. After you install Claude Code or Codex
  somewhere new, run `acorn node service install` again.

For a Node from the tarball, start it from a service manager yourself. With no terminal, the Node
asks no question, so set `ACORN_ADVERTISE_HOST` if other machines should reach it. Open the port in the
machine's firewall too. A systemd unit looks
like this:

```ini
[Unit]
Description=acorn Node
After=network-online.target

[Service]
User=acorn
WorkingDirectory=/opt/acorn-node
Environment=ACORN_DATA_DIR=/var/lib/acorn-node
Environment=ACORN_ADVERTISE_HOST=build.local
Environment=ACORN_PORT=4317
ExecStart=/usr/bin/node --disable-warning=ExperimentalWarning dist/standalone.js
TimeoutStopSec=40

[Install]
WantedBy=multi-user.target
```

When the service stops, the Node gets SIGTERM and finishes within 30 seconds: it stops waiting on task
scripts, closes its connections and databases, and releases its data folder. The pairing banner goes to
the service's log. The Node never writes a device token to its output, so the log holds at most a pairing
code, which lasts ten minutes. Once a device is paired, the banner shows the commands that open a new
pairing code: `acorn node pair`, from a terminal acorn has paired with the Node, or `kill -USR1 <pid>`,
which writes the code to the log.

## Keep the computer awake

While an agent works or waits for you, or a workflow runs, the Node keeps its computer from sleeping
when idle. A minute after the last one finishes, it lets the computer sleep again. That way a client on
another machine can still reach it while there's work on it. A closed laptop lid still sleeps a Mac.

On macOS the Node runs `caffeinate`, on Linux `systemd-inhibit`, and on Windows a hidden PowerShell
process. Each ends with the Node, so a Node that crashes never leaves the computer awake. On a Linux
machine without logind, or where polkit refuses, the Node can't do this and says so.

To turn it off, switch off **Keep this computer awake while agents work** on the Node's row in
**Settings** > **Machines** > **Nodes**, from any paired desktop app.

## Which plugins it has

A standalone Node has the plugins built into the Node: Agents, Agent browser, Docker, Editor, Git,
GitHub, Memory, Notes, Preview, Terminal, and Workflows.

The plugins the desktop app installs as packages, such as Database, HTTP, Linear, and Rollbar, aren't
on a standalone Node. Install the ones you want from a paired desktop app, in **Settings** >
**Plugins** > **Installed** > **Install…** ([Plugin trust and
permissions](/docs/security/plugin-trust-and-permissions/#install-a-plugin-on-a-node)). Running from a
checkout, `ACORN_BUNDLED_PLUGINS_DIR` points the Node at a folder of built packages, which it installs
and keeps up to date the way the desktop app does.

## Limits

- What needs a window doesn't work: folder pickers, native dialogs, and the Preview pane, which acorn
  refuses for a Node on another machine.
- Add a project by typing its path on the Node's machine.
- On Windows there's no `SIGUSR1`. Run `acorn node pair` for a new pairing code.
- Agents on a standalone Node run as the Node's user, so they can read its keys, from its data folder or
  its environment. The Node warns about this when it starts. The desktop app's Node keeps its keys
  sealed instead ([Credentials and secrets](/docs/security/credentials-and-secrets/)).
