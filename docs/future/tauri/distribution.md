# Distribution

Status: historical, 2026-08-22. This file is subordinate to [bundle.md](../bundle.md), which owns
node packaging; it records only what the Tauri work changes or converges. The end state has three
consumption shapes and one node artifact.

## Desktop: client + node

The Tauri bundle carries `apps/node/dist`, migrations, bundled plugins, and the pinned Node binary.
The embedded node and the standalone node share `apps/node/src/server/composition.ts` and the same
reconciliation and drain plan — supervision is the only difference, restating
[bundle.md](../bundle.md)'s "one artifact, two hosts" conclusion, now with the helper as the
supervisor instead of Electron main.

## Headless nodes

Stay `scripts/pack-node.mjs` tarballs, on [bundle.md](../bundle.md)'s ordering: Linux and Windows
CI matrix first, the `openssl`-on-Windows snag, macOS after Developer ID. Tauri adds one
convergence: the pinned, checksummed Node build the desktop bundles is the same artifact the
tarball includes when [bundle.md](../bundle.md)'s "bundle a runtime, eventually yes" item triggers.
One runtime pin, two consumers, enforced by the shared manifest in
[node-runtime.md](./node-runtime.md).

Service-manager setup (launchd and systemd unit examples) is documentation in
[docs/node-distribution.md](../../node-distribution.md)'s successor, not a new installer product.

Rejected: Tauri-built headless installers. Tauri's bundler is app-shaped — windows, icons,
updater — while a headless node wants a tarball and a unit file. Also rejected, again: publishing
the node to npm; the artifact is platform-specific
([docs/node-distribution.md](../../node-distribution.md)).

## Remote clients

Nothing new is built. A desktop's embedded node is a node: `advertiseHost` plus pairing
([docs/node-distribution.md](../../node-distribution.md) § Reaching a node from another machine)
already makes it reachable from another machine's client, which covers "connect to another
machine's client + node". The one named UX gap: the local node's advertise setting is a
terminal-first flow today, and the desktop could surface it. Internet reachability and the relay
stay out of scope, deferred to [remote.md](../remote.md).

## What closes this file

The [bundle.md](../bundle.md) matrix ships and the desktop bundles the same runtime pin the
tarball uses.
