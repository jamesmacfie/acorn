# Standalone Node distribution

`pnpm pack:node` builds a self-contained tarball for running an acorn Node without the Electron
desktop. The artifact contains the Node service/standalone entrypoints, shared chunks, migrations,
workspace production dependencies, and native modules.

## Runtime

The standalone entry uses `ACORN_DATA_DIR` or a local `.acorn` root, binds HTTPS/TLS 1.3 on loopback,
and prints one JSON handshake line. The line contains `nodeId`, endpoint, certificate fingerprint and
PEM, and a device token for the launcher/first client. It also runs plugin initialization,
reconciliation, WebSocket/tunnel listeners, and bounded shutdown.

It supports pure-Node features such as workspaces, tasks, providers, Git, files, database, Docker,
HTTP, and core routes. Electron-only operations such as native dialogs, browser views, and window
management are unavailable. The terminal, managed-agent, and workflow engines are wired by the
standalone composition when their dependencies are present; unsupported native adapters report an
explicit unavailable state.

Standalone and Electron-supervised Node hosts use the same `apps/node/src/server/composition.ts` graph,
post-listener reconciliation sequence, and bounded drain order. The host difference is supervision and
native capability injection, not a second plugin assembly.

## Install and start

```sh
tar -xzf acorn-node-*.tgz
cd acorn-node-*
pnpm install --prod
pnpm rebuild
ACORN_DATA_DIR=/var/lib/acorn-node pnpm start
```

The target machine needs Node, OpenSSL for the Node certificate, and the native build prerequisites
required by `better-sqlite3`/`node-pty`. If package installation ignores lifecycle scripts, native
bindings may remain unbuilt; run the package's rebuild step before diagnosing a missing-bindings
failure.

`SESSION_ENC_KEY` must be supplied to boot. If GitHub is enabled, its plugin reads the optional
`GITHUB_CLIENT_ID`; connection uses device flow and does not need a client secret or callback URL.

## Operations

Use a dedicated mode-`0700` data root. Only one process may hold it. Send SIGTERM for a graceful
drain; the listener closes first, plugins dispose next, SQLite closes, and the root lock releases.
The drain has a 30-second deadline.

The tarball is not an npm package: native dependencies and workspace package boundaries make a
platform/architecture-specific artifact the safer distribution unit.
