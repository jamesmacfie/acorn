# Standalone Node distribution

This page covers running an acorn Node without the desktop app: the tarball, how the Node boots, how
clients reach it, and how to operate it. Read it before you change the standalone entry, the packer, or
the boot order.

`pnpm pack:node` builds a self-contained tarball. It holds the Node service, the headless CLI and the
terminal client under one `acorn` launcher, shared chunks with the pure-JavaScript dependencies bundled
in, migrations, and a `package.json` naming the packages installed beside them: native modules and
packages loaded at run time (`apps/node/externals.ts`). The tarball isn't an npm package, because native
dependencies make a platform-specific artifact the safer unit.

## Runtime

`apps/node/src/entries/` holds the three build entries, `standalone.ts`, `service.ts`, and `mcp.ts`, and
`apps/node/src/composition/` holds what they share. The standalone entry uses `ACORN_DATA_DIR` or a local
`.acorn` root, binds HTTPS with TLS 1.3, and prints one JSON handshake line with the `nodeId`, endpoint,
certificate fingerprint and PEM, and a device token for the launcher or first client. It runs plugin
initialization, reconciliation, the WebSocket and tunnel listeners, and a bounded shutdown. Standalone
and desktop-supervised Nodes use the same `apps/node/src/composition/composition.ts` graph,
reconciliation sequence, and drain order. They differ in supervision and native capability injection.

After the handshake it prints a pairing banner: the address, the certificate fingerprint as six words,
and a live pairing code. Compare those words with the ones acorn shows on its pairing screen, because
that comparison is what makes pairing safe. A code opens automatically only while no device is paired.
`kill -USR1 <pid>` opens another without a restart. Windows has no `SIGUSR1`, so pairing a second device
there means a restart.

A standalone Node supports pure-Node features: workspaces, tasks, providers, Git, files, the database
plugin, Docker, HTTP, and core routes. Shell-only operations such as native dialogs, child webviews, and
window management are unavailable. It wires the terminal, managed-agent, and workflow engines when their
dependencies are present, and an unsupported native adapter reports an explicit unavailable state.

## Boot order

The Node binds its listener at the end of one chain: open the data root and take its lock, reconcile
bundled packages, open and migrate `core.sqlite`, load the packages installed in the data root, run every
plugin's `init` and then every plugin's `ready`, mint or read the TLS certificate, and listen. Plugin
`init` runs for every plugin at once, and so does `ready` ([activation](./plugins.md#activation)).
`startServiceRuntime` returns once the Node is listening, and the tmux, worktree, workflow, and agent
reconcile steps run after that.

The login-shell `PATH` probe starts at the first step and nothing waits on it. A window-launched process
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
for a pairing code: `kill -USR1 <pid>` opens one. `acorn --node https://host:4317` pairs with a Node
elsewhere, and remembers it so the next time is `acorn --node <name>`. The [CLI](./cli.md) uses the same
custody.

## Reaching a node from another machine

A Node answers on loopback until someone says otherwise. Binding beyond `127.0.0.1` puts a service that
runs PTYs, spawns agents, and executes repository commands on a network, so the Node never guesses. It
advertises an address only when the operator answers the first-boot question or sets
`ACORN_ADVERTISE_HOST`.

On first boot at a terminal it lists this machine's IPv4 addresses and asks which to advertise, and
pressing Enter keeps it private. The answer is recorded as `advertiseHost` in `node.json`, and "none" is
recorded as an empty string so the question doesn't come back. Only IPv4 is offered, because the answer
ends up in a URL the operator types and in a `Host` comparison. The prompt is skipped without recording
anything when there's no TTY (launchd, systemd, Docker, CI) or no network address to offer.

Set `ACORN_ADVERTISE_HOST` for an install with no terminal. It wins over the recorded answer, so a
service manager can set it without touching the data root, and it takes a comma-separated list for a
machine reached by both an IP and a hostname. With it set the listener binds `0.0.0.0` and accepts that
`Host` as well as loopback. Every other `Host` gets a 403, which keeps a DNS-rebinding page out.

What stands between the network and the Node is a device bearer token and a rate-limited pairing code,
so advertise only on a network you trust. An SSH tunnel, `ssh -N -L <port>:127.0.0.1:<port>`, reaches a
loopback-only Node with no exposure, as long as the local and remote ports match, because the `Host`
guard compares the port too.

## Plugins

Both hosts build the `PLUGIN_STATE` bridge, the roster, installer, and disabled list, through
`apps/node/src/composition/pluginState.ts`. The desktop ships every built plugin as app resources and
copies them into the data root before discovery. A standalone Node has no `resourcesPath`, so plugins
arrive only through the owner's install route. A developer running from a checkout can name a source with
`ACORN_BUNDLED_PLUGINS_DIR`, and the root then reconciles as the desktop's does. Both call one
`reconcileBundledPackages`.

Reconciliation hashes the source and installed package on each pass and leaves the ownership file alone
when the status, version, fingerprint, and installation time match. A missing ownership row is repaired
after exact package placement. Owner overrides, uninstall tombstones, and development markers keep their
own rules. Both roots report every ownership row at boot, because a package frozen by an owner-installed
row looks like a missing feature.

The disabled list is the data root's file, unioned with any start-config override. Only the supervised
host passes an override, so tests and `pnpm dev:node` can pin a list without writing into a data root.

## Install and start

```sh
tar -xzf acorn-node-*.tgz
cd acorn-node-*
npm install --omit=dev
npm rebuild
ACORN_DATA_DIR=/var/lib/acorn-node npm start
node bin/acorn.mjs --help
```

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
`npm rebuild` before diagnosing a missing-bindings failure.

`SESSION_ENC_KEY` is optional. Unset, the Node generates one into `session.key` in the data root at mode
`0600` and never mints it again. A damaged key file is an error, because a silent replacement would turn
"this file is wrong" into "every stored credential is gone". GitHub uses acorn's public client ID unless
`GITHUB_CLIENT_ID` overrides it ([connecting](./github-integration.md#connecting)).

## Operations

Use a dedicated mode-`0700` data root, and only one process may hold it. The `0700` and `0600` modes are
POSIX permissions. On Windows they're advisory, so restrict the data root with an NTFS ACL. Send SIGTERM
for a graceful drain: the listener closes, plugins dispose, SQLite closes, and the lock releases, within
a 30-second deadline.

## Dependency security policy

The root `package.json` owns runtime dependency security overrides. `pnpm-workspace.yaml` repeats them,
and `tools/arch/dependencySecurity.test.ts` rejects disagreement. The packer copies the policy into the
generated npm manifest, because npm doesn't read pnpm's settings. For a direct dependency, npm's `$name`
reference uses that dependency's declared patched range. Hono's catalog floor and other direct runtime
floors move with the policy.

The root manifest's `acornStandalone` policy pins the keymap provider to the release tested in the
workspace, and its optional Solid adapter peer follows the standalone Solid dependency through a
package-specific override. The test checks the pin against the source declaration and the lockfile.

The workspace lockfile pins exact versions and integrity hashes. The standalone manifest carries ranges
and overrides but no npm lockfile, so a later install can resolve different compatible versions. The
floors cover reviewed advisories. They don't make the install reproducible or cover advisories published
after the review.
