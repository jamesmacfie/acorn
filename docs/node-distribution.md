# Standalone Node distribution

`pnpm pack:node` builds a self-contained tarball for running an acorn Node without the desktop app.
The artifact contains the Node service and standalone entrypoints, shared chunks, migrations,
workspace production dependencies, and native modules.

## Runtime

`apps/node/src/entries/` holds all three build entries — `standalone.ts`, `service.ts`, and the MCP
server — and `apps/node/src/composition/` holds what any two of them share. The standalone entry uses
`ACORN_DATA_DIR` or a local `.acorn` root, binds HTTPS/TLS 1.3, and prints one JSON handshake line. The line contains `nodeId`, endpoint, certificate fingerprint and PEM, and a
device token for the launcher/first client. It also runs plugin initialization, reconciliation,
WebSocket/tunnel listeners, and bounded shutdown.

After the handshake it prints a human pairing banner: the address to connect to, the certificate
fingerprint as six words, and a live pairing code. Compare those words against the ones acorn shows
on its pairing screen. That comparison is what makes pairing safe. A code opens automatically only
while no device is paired. `kill -USR1 <pid>` opens another without restarting the node and killing
its live agent and terminal sessions. `SIGUSR1` does not exist on Windows, so pairing a second device
there means a restart.

## Boot order

The node binds its listener at the end of one chain: open the data root and take its lock, reconcile
bundled packages, open and migrate `core.sqlite`, load the packages installed in the data root, run
every plugin's `init` and then every plugin's `ready`, mint or read the TLS certificate, listen.
Three things that used to be in that chain for history rather than dependency are not any more.

The login-shell `PATH` probe starts at the first mark and nothing waits on it. On a packaged macOS
build a window-launched process inherits a minimal `PATH`, so the node asks the owner's login shell
what theirs is with `$SHELL -lic 'printf %s "$PATH"'`. That costs 520 ms on this developer's machine
and up to 2 seconds on a profile with a version manager in it, and the answer is needed to spawn
agents and build commands, not to migrate a database or bind a listener. The probe keeps its
five-second ceiling, and the first process the node spawns waits for it: `runProcess` and
`runHeadless` both await the gate in `packages/node-core/src/server/core/loginShellPath.ts` before
they call `spawn`. A spawn that arrives after the probe has settled waits for nothing.

Two spawn paths do not go through that gate, and both are deliberate. A terminal session runs
`$SHELL -lc`, which reads the profile itself, so the probe would tell it nothing it does not already
know. The managed-agent drivers under `plugins/agents/src/server/` call `spawn` directly, so an agent
started in the first two seconds of a packaged launch can see the inherited `PATH`. Move them onto
`spawnsReady()` if that ever shows up as a missing-binary report.

Plugin `init` runs for every plugin at once, and so does `ready`. See
[docs/plugins.md](./plugins.md) § Activation for what that means for a plugin author.

Opening the blob cache no longer chmods every file in it. The sweep is a permission migration for
files an older build wrote, it is synchronous, and it sat inside the `migrate` step
([caching.md](./caching.md) § Immutable blob cache).

Reconciliation runs behind the listener, not in front of it. `startServiceRuntime` returns as soon as
the node is listening, and the tmux, worktree, workflow, and agent reconcile steps continue after
that.

`[service:boot] <label> +<offset>ms (<step>ms)` prints one line per step, unconditionally, so a node
that took 11 seconds to bind says so without anyone having asked. Per-request timing is the opposite
and sits behind `ACORN_PERF=1`. Read the labels as wall-clock slices rather than per-plugin costs
once the passes overlap: with 16 plugins initialising together, a plugin's line says when it
finished, not how long it worked.

## Reaching a node with `acorn`

`acorn` is the terminal client (`apps/tui/`, [docs/tui.md](./tui.md)). Run it and it opens the
workspace for the node this machine's data root holds: `ACORN_DATA_DIR`, else the desktop app's root
if the app is installed here, else the dev checkout's. It reads the root's lock to decide what to do.
A node already holds it, so `acorn` attaches, reading the endpoint from `node.json` and the
certificate to pin from `tls/cert.pem`; nothing holds it, so `acorn` starts one and owns its
lifetime, draining it on the way out. A second `acorn` in a second terminal finds the lock and
attaches, and leaves the node running when it quits. The one that started it owns it, which is the
desktop's rule too.

Attaching needs a device token, and `acorn` keeps its own — in its config directory, at mode 0600,
never in the node's data root. A node the desktop started is a node whose token belongs to the
desktop, so the first `acorn` against one asks for a pairing code the same way any other client
does: `kill -USR1 <pid>` opens one.

`acorn --node https://host:4317` pairs with a node elsewhere: the fingerprint as six words to compare
against what that node printed, then the code. It remembers what it pairs with, so the second time is
`acorn --node <name>`.

## Reaching a node from another machine

A node answers on loopback only until someone says otherwise. Binding beyond `127.0.0.1` puts a
service that runs PTYs, spawns agents, and executes repo-configured commands onto a network, so
nothing infers the answer: a node advertises an address only because someone said so, either by
answering the first-boot question below or by setting `ACORN_ADVERTISE_HOST`. A machine with three
interfaces and a VPN has no obvious answer to guess at, and guessing wrong would fail as a bare 403
from the Host guard with nothing to debug against.

On first boot at a terminal it lists this machine's IPv4 addresses and asks which to advertise;
pressing Enter keeps it private, one keystroke away from exposure rather than something that happens
because an installer's return key was held down. Only IPv4 addresses are offered: the answer ends up
in a URL the operator types and in a Host header comparison, and a bracketed IPv6 literal is a worse
first experience than the v4 address every one of these machines also has. The answer is recorded as
`advertiseHost` in the data root's `node.json`, so it is asked once; recording "none" (an empty
string) is what stops it reappearing every boot.

The prompt is skipped, without recording anything, when there is no TTY to ask at (launchd, systemd,
Docker, CI) or when the machine has no network address to offer. A laptop booted off the network gets
asked once it is plugged in, because that case alone is not treated as an answer.

Set `ACORN_ADVERTISE_HOST` for an install with no terminal to answer: launchd, systemd, Docker, CI.
It takes priority over the recorded answer, so a service manager or container can set it without
touching the data root, and an operator who already answered "none" can still override it for one run
without editing `node.json`. It accepts a comma-separated list when a machine is reached by both an IP
and a hostname, since that is a real case and the alternative would be two settings that have to agree.
With it set the listener binds `0.0.0.0` and accepts that Host as well as loopback; every other Host
still gets a 403, which is what keeps a DNS-rebinding page out.

Understand what this exposes before setting it. A node runs PTYs, spawns agents and executes
repo-configured commands, and what stands between the network and all of that is a device bearer
token plus a rate-limited pairing code. Advertise on a network you trust. An SSH tunnel
(`ssh -N -L <port>:127.0.0.1:<port>`) reaches a loopback-only node with no exposure at all, as long
as the local and remote ports match, because the Host guard compares the port too.

It supports pure-Node features such as workspaces, tasks, providers, Git, files, database, Docker,
HTTP, and core routes. Shell-only operations such as native dialogs, child webviews, and window
management are unavailable. The standalone composition wires the terminal, managed-agent, and
workflow engines when their dependencies are present. Unsupported native adapters report an explicit
unavailable state.

Standalone and desktop-supervised Node hosts use the same `apps/node/src/composition/composition.ts` graph,
post-listener reconciliation sequence, and bounded drain order. The host difference is supervision and
native capability injection, not a second plugin assembly.

## Plugins

Both hosts build the `PLUGIN_STATE` bridge, meaning the roster, the installer, and the owner's
disabled list, through one builder: `apps/node/src/composition/pluginState.ts`. One thing differs on
purpose. Bundled packages have nothing to be reconciled from. The desktop ships every built plugin as
app resources and copies them into the writable data root before discovery. A standalone node has no
`resourcesPath`, so the step does nothing and plugins arrive only through the owner-authenticated
install route. Nothing goes stale as a result; there is no app-owned copy. A developer running
against a repo checkout can name one with `ACORN_BUNDLED_PLUGINS_DIR`, and then this root reconciles
as the desktop's does. Both call one `reconcileBundledPackages`, so the outcome and the boot summary
cannot differ. A service-managed node sets no such variable.

Both roots report every ownership row at boot, whether or not they had a bundled copy to offer,
because a package frozen by an owner-installed row is the failure that looks like a feature nobody
built.

The disabled list is the data root's file, unioned with any start-config override. Only the
supervised host passes an override, so tests and `pnpm dev:node` pin a list without writing into a
data root. A standalone node's list is the file alone.

## Install and start

```sh
tar -xzf acorn-node-*.tgz
cd acorn-node-*
pnpm install --prod
pnpm rebuild
ACORN_DATA_DIR=/var/lib/acorn-node pnpm start
```

The target machine needs Node 24.4+, or 22.18+ on the 22 LTS line, because the `node:sqlite` surface
the shim uses is newer than the module itself. The packed `package.json` pins this in `engines`. It
also needs OpenSSL for the Node certificate. OpenSSL is present on macOS and Linux and absent on
stock Windows, where the node refuses to start at first boot without it.

`node-pty` is the only native module. It ships prebuilt binaries for macOS and Windows and compiles
from source on Linux, so a Linux target also needs the usual build prerequisites. If package
installation ignores lifecycle scripts, native bindings may remain unbuilt. Run the package's rebuild
step before diagnosing a missing-bindings failure.

`SESSION_ENC_KEY` is optional. Supply it and it is used; leave it unset and the node generates one
into `session.key` in the data root at mode 0600, beside the TLS private key that has the same blast
radius. It is never re-minted. A damaged key file is an error, because silently generating a
replacement would turn "this file is wrong" into "every stored credential is gone".

If GitHub is enabled, its plugin reads the optional `GITHUB_CLIENT_ID`; connection uses device flow
and does not need a client secret or callback URL.

## Operations

Use a dedicated mode-`0700` data root. Only one process may hold it. The `0700`/`0600` modes on the
data root and key files are POSIX permissions. On Windows they are advisory, and restricting the
data root is the operator's job, with an NTFS ACL on the directory. Send SIGTERM for a graceful
drain: the listener closes first, plugins dispose next, SQLite closes, and the root lock releases.
The drain has a 30-second deadline.

The tarball is not an npm package: native dependencies and workspace package boundaries make a
platform/architecture-specific artifact the safer distribution unit.
