# Standalone Node distribution

This page covers running an acorn Node without the desktop app: the tarball, how the Node boots, how
clients reach it, and how to operate it. Read it before you change the standalone entry, the packer, or
the boot order.

`pnpm pack:node` builds a self-contained tarball. It holds the Node service, the headless CLI and the
terminal client under one `acorn` launcher, shared chunks with the pure-JavaScript dependencies bundled
in, migrations, and a `package.json` naming the packages installed beside them: native modules and
packages loaded at run time (`apps/node/externals.ts`). The tarball isn't an npm package, because native
dependencies make a platform-specific artifact the safer unit.
[Dependency security](./node-distribution/dependency-security.md) covers how those are pinned and checked.

## Runtime

`apps/node/src/entries/` holds the three build entries, `standalone.ts`, `service.ts`, and `mcp.ts`, and
`apps/node/src/composition/` holds what they share. The standalone entry uses `ACORN_DATA_DIR` or a local
`.acorn` root, binds HTTPS with TLS 1.3, and runs plugin initialization, reconciliation, the WebSocket
listener, and a bounded shutdown. Once it's listening, it prints one JSON handshake line on stdout with
the `nodeId`, endpoint, and certificate fingerprint and PEM. A service manager keeps stdout in a log, so
the handshake carries a device token only when a launcher sets `ACORN_LAUNCHER_PIPES=1`. The Node then
reads the launcher's saved token from file descriptor 4, reuses it while it authenticates or issues a new
device, and writes the handshake with `deviceToken` to file descriptor 3 instead of stdout.
`acorn node start --background` and the terminal client launch this way, through `launchNode` in
`@acorn/custody/local`. A Node started without the pipes issues no launcher device.

Standalone and desktop-supervised Nodes boot through one function, `bootNode` in
`apps/node/src/composition/boot.ts`, so they share the plugin graph, the reconcile sequence, and the
drain. Each difference is a named option. The supervised Node passes the app version, the keys the
desktop delivered, the start config's disabled-plugin override, and the staged MCP entry, and a packaged
app turns on the login-shell `PATH` probe. The standalone Node passes none of these. Its telemetry
release is the protocol version, because it has no app version. Work only one host does stays in its
entry: `runtime.ts` reports service states and installed bytes, and `standalone.ts` handles
enrollment, the pairing banner, the handshake, and signals.

After the handshake, a Node started by hand prints a pairing banner: the address, the certificate
fingerprint as six words, and a live pairing code. Compare those words with the ones acorn shows on its
pairing screen, because that comparison is what makes pairing safe. A code opens automatically only
while no device is paired, lasts ten minutes, and allows five attempts, so a copy in a log exposes far
less than a token would. For another code, run `acorn node pair` on the Node's machine. It works on every
platform from a terminal acorn has paired ([pair from the terminal](./cli/local-service.md#pair-from-the-terminal)).
On macOS and Linux, `kill -USR1 <pid>` also opens one. A Node the CLI starts prints no banner, because
the CLI holds its token.

A standalone Node supports pure-Node features: workspaces, tasks, providers, Git, files, Docker, the
bundled loaded plugins, and core routes. Shell-only operations such as native dialogs, child webviews, and
window management are unavailable. It wires the terminal, managed-agent, and workflow engines when their
dependencies are present, and an unsupported native adapter reports an explicit unavailable state.

## Boot order

The Node binds its listener at the end of one chain: open the data root and take its lock, reconcile
bundled packages, open and migrate `core.sqlite`, load the packages installed in the data root, run every
plugin's `init` and then every plugin's `ready`, mint or read the TLS certificate, and listen. Plugin
`init` runs for every plugin at once, and so does `ready` ([activation](./plugins/activation.md)).
`bootNode` returns once the Node is listening, and the tmux, worktree, workflow, and agent reconcile
steps run after that. The supervised Node reports `ready` when they finish. The standalone Node waits
for them before it prints its handshake, because a launcher acts on that line.

On a packaged app, the login-shell `PATH` probe starts at the first step and nothing waits on it. A
standalone Node skips it, because it inherits its shell's `PATH`. A window-launched process
on packaged macOS inherits a minimal `PATH`, so the Node asks the owner's login shell with
`$SHELL -lic 'printf %s "$PATH"'`. That took 520 ms on one developer machine and up to two seconds with a
version manager in the profile. The probe has a five-second ceiling, and `runProcess` and `runHeadless`
wait for it before they `spawn` (`packages/node-core/src/server/core/loginShellPath.ts`).

Two spawn paths skip that gate on purpose. A terminal session runs `$SHELL -lc`, which reads the profile
itself. The managed-agent drivers in `plugins/agents/src/server/` call `spawn` directly, so an agent
started in the first two seconds of a packaged launch can see the inherited `PATH`. Move them onto
`spawnsReady()` if that shows up as a missing-binary report.

`[service:boot] <label> +<offset>ms (<step>ms)` prints one line per step, always, so a slow bind says so
without anyone asking. Read the labels as wall-clock slices: with plugins initializing together, a
plugin's line says when it finished, not how long it worked. Per-request timing sits behind
`ACORN_PERF=1`.

## Reaching a node with `acorn`

`acorn` with no command is the [terminal client](./tui.md). It opens the workspace for the Node this
machine's data root holds: `ACORN_DATA_DIR`, else the desktop app's root if the app is installed, else
the development root. It reads the root's lock. If a Node holds it, `acorn` attaches, reading the
endpoint from `node.json` and the certificate to pin from `tls/cert.pem`. If nothing holds it, `acorn`
starts a Node, owns its lifetime, and drains it on the way out. A second `acorn` attaches and leaves the
Node running when it quits.

`acorn` keeps its own device token in its config directory, at mode `0600`, never in the Node's root. A
Node the desktop started has a token that belongs to the desktop, so the first `acorn` against it asks
to pair: allow it in the desktop, or type a code from **Settings → Nodes**. `acorn --node https://host:4317` pairs with a Node
elsewhere, and remembers it so the next time is `acorn --node <name>`. The [CLI](./cli.md) uses the same
custody.

## Reaching a node from another machine

A Node answers on loopback until a person on its machine chooses the hosts it answers other machines on:
with `acorn node reach`, the **Settings → Nodes** switch, the first-boot question, or
`ACORN_ADVERTISE_HOST`. A Node with hosts keeps its port. [Reach a Node from another
machine](./node-distribution/reaching.md) covers each way in, firewalls, and why a name beats an address.

## Plugins

Both hosts build the `PLUGIN_STATE` bridge, the roster, installer, and disabled list, through
`apps/node/src/composition/pluginState.ts`. Both ship the loaded plugins listed in
`scripts/bundled-plugins.mjs`: the desktop in its app resources, the tarball in a `plugins` folder
beside `dist/`. Before discovery, both call `reconcileBundledPackages` to copy them into the data root.
`ACORN_BUNDLED_PLUGINS_DIR` names another folder and wins. A checkout has none, so `pnpm dev:node`
reconciles nothing unless you set it. Other plugins arrive through the owner's install route.

Reconciliation hashes the source and installed package on each pass and leaves the ownership file alone
when the status, version, fingerprint, and installation time match. A missing ownership row is repaired
after exact package placement. Owner overrides, uninstall tombstones, and development markers keep their
own rules. Both roots report every ownership row at boot, because a package frozen by an owner-installed
row looks like a missing feature.

The disabled list is the data root's file, unioned with any start-config override. Only the supervised
host passes an override, so tests and `pnpm dev:node` can pin a list without writing into a data root.

## Archives

`pnpm pack:node --platform <os>-<arch>` writes a self-contained archive for the machine it runs on:
`acorn-node-<version>-<platform>.tar.gz`, or `.zip` on Windows, with a `.sha256` file beside it. The
target machine needs no Node.js, npm, or compiler.

```text
bin/acorn, bin/acorn.cmd   launchers that run lib/bin/acorn.mjs on runtime/node
runtime/                   the Node.js release node-runtime.json pins, with its LICENSE
lib/                       the tarball's tree, with npm ci --omit=dev and the prune step already run
install.sh                 the installer, install.ps1 on Windows (node-distribution/install.md)
README.md, BUILD           how to check and install it; version, commit, build time, and platform
```

`.github/workflows/build-node.yml` builds macOS arm64 and x64, Linux x64 and arm64, and Windows x64 on
`v*` tags and manual dispatches, each on its own platform. Each job extracts its archive outside the
checkout with a bare environment, then runs `scripts/node-archive/smoke.mjs`: help, a node-pty
terminal, `node start`, `node status`, `node pair`, `node stop`, a log search for device tokens, and an
install and uninstall where the runner isn't root or an administrator. The run keeps each archive as a
14-day artifact, and nothing publishes it.

The Linux archives build node-pty in a Debian 11 container, so they need glibc 2.31 or later: Ubuntu
22.04, Debian 11, Raspberry Pi OS 11, or later. musl distributions such as Alpine can't run them. On
macOS, Gatekeeper refuses the unsigned `pty.node` from a browser download until the installer clears
the quarantine mark from its copy.

## Install and start

A platform archive installs with its own installer ([install a Node from an archive](./node-distribution/install.md)).
These steps install the platform-neutral tarball on a machine with its own Node.js instead.

```sh
tar -xzf acorn-node-*.tar.gz
cd acorn-node
npm ci --omit=dev
npm rebuild
node scripts/prune-runtime.mjs
ACORN_DATA_DIR=/var/lib/acorn-node npm start
node bin/acorn.mjs --help
```

`scripts/prune-runtime.mjs` removes installed files that no runtime loads, including the Claude Agent
SDK's executable for this platform ([runtime file policy](./shell/packaging.md#runtime-file-policy)).
It's a separate command because npm skips install scripts when `ignore-scripts` is set. Running it
again removes nothing. Run it again after every `npm ci`. npm still downloads the executable package,
because the lockfile lists it as an optional dependency, so the download is larger than what stays
installed. The packer pins the Claude adapter to the version the policy reviewed, so `npm ci` can't
install one the prune step refuses.

Claude Code agents need `claude` installed on this machine and on the Node process's `PATH`. The Node
never downloads it ([harnesses](./managed-agents/harnesses.md#claude-code)).

The machine needs Node 22.23.2 or later in branch 22, 24.18.1 or later in branch 24, or 26.5.1 or later
in branch 26. These floors include the
[July 29, 2026 permission model security fixes](https://nodejs.org/en/blog/vulnerability/july-2026-security-releases)
and the `node:sqlite` APIs the shim needs. The packed `package.json` copies the root `engines` range, and
because a package manager may treat that as a warning, the loaded plugin worker factories also enforce
the policy. The desktop bundles Node 24.21.0, pinned in `node-runtime.json` and checked against its
archive checksum.

The Node generates its RSA-2048 key with Node's native crypto and signs its self-signed certificate with
the packaged `node-forge`, loaded only when minting, so no OpenSSL executable is needed. The key and
certificate persist under `tls/` and are reused, including ones OpenSSL made.

`node-pty` is the only native module. It ships prebuilt binaries for macOS and Windows and compiles from
source on Linux, which needs the usual build tools. If installation skipped lifecycle scripts, run
`npm rebuild` before diagnosing a missing-bindings failure. The prune step keeps node-pty's sources, so
a later `npm rebuild` still works.

`SESSION_ENC_KEY` is optional. Unset, the Node generates one into `session.key` in the data root at mode
`0600` and never mints it again. Agents on a standalone Node run as its user and can read that file,
and the Node warns about it at boot ([Node keys](./security/credentials.md#node-keys)). A damaged key file is an error, because a silent replacement would turn
"this file is wrong" into "every stored credential is gone". GitHub uses acorn's public client ID unless
`GITHUB_CLIENT_ID` overrides it ([connecting](./github-integration.md#connecting)).

## Operations

Use a dedicated mode-`0700` data root, and only one process may hold it. The `0700` and `0600` modes are
POSIX permissions. On Windows they're advisory, so the archive installer gives the data root an access
list for its user and SYSTEM alone, with inherited entries removed. Run `acorn node stop`, or send
SIGTERM on macOS and Linux, for a graceful drain: open task script waits abort, the listener closes,
plugins dispose, SQLite closes, and the lock releases, within a 30-second deadline. A setup script that
was waiting to start is recorded as interrupted by `shutdown`. Busy agents and workflows keep the
computer awake ([keep awake](./node-distribution/keep-awake.md)).
