# Standalone Node distribution

`pnpm pack:node` builds a self-contained tarball for running an acorn Node without the Electron
desktop. The artifact contains the Node service/standalone entrypoints, shared chunks, migrations,
workspace production dependencies, and native modules.

## Runtime

The standalone entry uses `ACORN_DATA_DIR` or a local `.acorn` root, binds HTTPS/TLS 1.3, and prints
one JSON handshake line. The line contains `nodeId`, endpoint, certificate fingerprint and PEM, and a
device token for the launcher/first client. It also runs plugin initialization, reconciliation,
WebSocket/tunnel listeners, and bounded shutdown.

After the handshake it prints a human pairing banner: the address to connect to, the certificate
fingerprint as six words, and a live pairing code. Compare those words against the ones acorn shows
on its pairing screen — that comparison is what makes pairing safe. A code is opened automatically
only while no device is paired yet; `kill -USR1 <pid>` opens another without restarting the node and
killing its live agent and terminal sessions.

## Reaching a node from another machine

A node answers on loopback only until someone says otherwise. On first boot at a terminal it lists
this machine's IPv4 addresses and asks which to advertise; pressing Enter keeps it private. The
answer is recorded as `advertiseHost` in the data root's `node.json`, so it is asked once.

Set `ACORN_ADVERTISE_HOST` for an install with no terminal to answer — launchd, systemd, Docker, CI.
It accepts a comma-separated list when a machine is reached by both an IP and a hostname, and it
overrides the recorded answer. With it set the listener binds `0.0.0.0` and accepts that Host as well
as loopback; every other Host still gets a 403, which is what keeps a DNS-rebinding page out.

Understand what this exposes before setting it. A node runs PTYs, spawns agents and executes
repo-configured commands, and what stands between the network and all of that is a device bearer
token plus a rate-limited pairing code. Advertise on a network you trust. An SSH tunnel
(`ssh -N -L <port>:127.0.0.1:<port>`) reaches a loopback-only node with no exposure at all, as long
as the local and remote ports match — the Host guard compares the port too.

It supports pure-Node features such as workspaces, tasks, providers, Git, files, database, Docker,
HTTP, and core routes. Electron-only operations such as native dialogs, browser views, and window
management are unavailable. The terminal, managed-agent, and workflow engines are wired by the
standalone composition when their dependencies are present; unsupported native adapters report an
explicit unavailable state.

Standalone and Electron-supervised Node hosts use the same `apps/node/src/server/composition.ts` graph,
post-listener reconciliation sequence, and bounded drain order. The host difference is supervision and
native capability injection, not a second plugin assembly.

## Plugins

Both hosts build the `PLUGIN_STATE` bridge — the roster, the installer, the owner's disabled list —
through one builder, `apps/node/src/server/pluginState.ts`. One thing differs on purpose:

- **Bundled packages have nothing to be reconciled from.** The desktop ships every built plugin as app
  resources and copies them into the writable data root before discovery. A standalone node has no
  `resourcesPath`, so by default the step does nothing and plugins arrive only through the
  owner-authenticated install route. Nothing is stale as a result; there is simply no app-owned copy.
  A developer running against a repo checkout can name one with `ACORN_BUNDLED_PLUGINS_DIR`, and then
  this root reconciles exactly as the desktop's does — both call one
  `reconcileBundledPackages`, so the outcome and the boot summary cannot differ. A service-managed node
  sets no such variable.

Both roots report every ownership row at boot, whether or not they had a bundled copy to offer, because
a package frozen by an owner-installed row is the failure that looks like a feature that was never built.

The disabled list is the data root's file, unioned with any start-config override. Only the supervised
host passes an override (tests and `dev:node` pin a list without writing into a data root); a
standalone node's list is the file alone.

## Install and start

```sh
tar -xzf acorn-node-*.tgz
cd acorn-node-*
pnpm install --prod
pnpm rebuild
ACORN_DATA_DIR=/var/lib/acorn-node pnpm start
```

The target machine needs Node 24.4+ (or 22.18+ on the 22 LTS line — the `node:sqlite` surface the
shim uses is newer than the module itself, and the packed `package.json` pins this in `engines`) and
OpenSSL for the Node certificate.
`node-pty` is the only native module left; it ships prebuilt binaries for macOS and Windows and
compiles from source on Linux, so a Linux target also needs the usual build prerequisites. If package
installation ignores lifecycle scripts, native bindings may remain unbuilt; run the package's rebuild
step before diagnosing a missing-bindings failure.

`SESSION_ENC_KEY` is optional. Supply it and it is used; leave it unset and the node generates one
into `session.key` in the data root at mode 0600, beside the TLS private key that already has the
same blast radius. It is never re-minted — a damaged key file is an error, because silently
generating a replacement would turn "this file is wrong" into "every stored credential is gone".

If GitHub is enabled, its plugin reads the optional `GITHUB_CLIENT_ID`; connection uses device flow
and does not need a client secret or callback URL.

## Operations

Use a dedicated mode-`0700` data root. Only one process may hold it. Send SIGTERM for a graceful
drain; the listener closes first, plugins dispose next, SQLite closes, and the root lock releases.
The drain has a 30-second deadline.

The tarball is not an npm package: native dependencies and workspace package boundaries make a
platform/architecture-specific artifact the safer distribution unit.
