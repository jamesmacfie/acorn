# Packaging and installing a node on another machine

Design notes from the remote-node session (2026-08-10). The DX half shipped; the distribution half
did not. This records what was established so a future project starts from conclusions rather than
re-deriving them. Nothing below the "What shipped" section is scheduled.

The goal being worked towards: a node you download onto another computer, extract, run, and connect
to — with the desktop client shipping a node by default, and a standalone install being the same
artifact rather than a second product.

## What shipped

Enough that a hand-installed node on the LAN is pleasant to set up:

- **`advertiseHost` in `node.json`.** Binding beyond loopback is a recorded decision, not a lookup.
  On first boot at a real terminal the node lists this machine's IPv4 addresses and asks which to
  advertise; Enter means none. `ACORN_ADVERTISE_HOST` is the non-interactive path for launchd,
  systemd, Docker and the e2e harness, and it overrides the recorded answer.
  (`packages/node-core/src/main/advertise.ts`)
- **The Host allowlist widened to a set.** Loopback plus whatever was advertised. The listener binds
  `0.0.0.0` only when something is advertised, and the endpoint it *reports* stays loopback —
  children of the node validate its certificate fully against an `IP:127.0.0.1` SAN, so that origin
  cannot move. (`packages/node-core/src/main/server.ts`)
- **A pairing banner at boot.** Endpoint, identity words, and a live pairing code. The terminal the
  node was started from is the out-of-band channel pairing already depends on; printing there turns
  pairing from "read a device token out of a JSON blob and curl the code route" into copy, compare,
  paste. A code opens automatically only while nothing is paired yet; `SIGUSR1` opens another
  without a restart that would kill live agent and terminal sessions.
- **`fingerprintWords` moved to `packages/protocol`.** The node prints the phrase and the desktop
  shows it; two copies of the word list would be two things that can drift into a comparison that
  always passes.
- **`SESSION_ENC_KEY` generated into the data root** when unset, at 0600, beside the TLS private key
  that already has the same blast radius. It was a required env var that refused to boot without a
  hand-invented 64-hex secret, which bought nothing on a machine where the key lands next to the
  database anyway.
- **`better-sqlite3` replaced by `node:sqlite`.** See below — this is the load-bearing one for
  distribution.

## Native dependencies: down to one

This is what decides how hard a downloadable artifact is, and it is in better shape than expected.

**SQLite is no longer native.** `node:sqlite` is part of the runtime, so there is no ABI to match and
no compiler to have installed. Electron 42 bundles Node 24.17 and has it, which is what lets the
desktop-supervised and standalone hosts share one story. Drizzle publishes no `node:sqlite` driver
(0.45.2 ships better-sqlite3, bun, expo, op and proxy), so `main/sqlite.ts` presents the small
surface Drizzle's better-sqlite3 session actually calls — `prepare`, `transaction`, and
`run`/`all`/`get`/`raw` — over a `DatabaseSync`. Two behaviour differences are pinned there
explicitly: `node:sqlite` enforces foreign keys by default where better-sqlite3 does not, and it
returns null-prototype rows.

One wrinkle worth remembering: `drizzle-orm/better-sqlite3/driver.js` opens with a static
`import Client from 'better-sqlite3'` that it needs only for the convenience form
`drizzle('/path/to.db')`. Importing it would put the native package back on the dependency list to
satisfy a binding nothing uses, so `drizzleOverSqlite` assembles the session from published export
subpaths instead. `@types/better-sqlite3` stays a devDependency — Drizzle's declarations import from
it, and types do not need a compiler.

**node-pty is the only native module left**, and it builds against node-addon-api (N-API), so its
binaries are ABI-stable across Node versions *and* Electron. It ships prebuilds for `darwin-arm64`,
`darwin-x64`, `win32-arm64` and `win32-x64` — **not Linux**, which compiles from source today. So
Linux is the one platform needing a prebuild produced in CI, once.

`scripts/rebuild-node-abi.mjs` now probes node-pty rather than asserting anything: on a platform
where the prebuilt binary loads, it exits immediately.

## The build pipeline

A CI matrix, not new architecture. `scripts/pack-node.mjs` already assembles the artifact —
`dist/`, migrations, a generated `package.json` with only real runtime dependencies — and its own
header says the reason it stops short of shipping binaries is that prebuilt binaries per platform
triple are "a release pipeline rather than a script". That is a deliberate deferral.

Shape: GitHub Actions across macOS arm64/x64, Linux x64/arm64 and Windows; five tarballs on a
release. Linux and Windows first — see Gatekeeper below.

## Two snags

**`openssl` on PATH.** `ensureCert` shells out to it to mint the node's certificate. Present on
macOS and Linux, absent on stock Windows. Either bundle it or replace that call with a pure-JS
certificate mint. Small either way, but it is a dependency on a machine we do not control, and it
fails at first boot with the node refusing to start.

**macOS Gatekeeper.** A downloaded tarball containing `.node` binaries is quarantined, and clearing
that properly means Developer ID signing and notarization — the same purchase already blocking
desktop auto-update (see the auto-update constraint notes). Linux and Windows have no equivalent.
This is why macOS is last, not first.

## Whether to bundle a Node runtime

Eventually yes, so the install stops being "first install Node 24". Costs roughly 50MB in the
tarball. Not for a first release: requiring a modern Node is a reasonable ask of someone
deliberately installing a headless service, and it keeps the artifact small enough to iterate on.

Node SEA (single executable) is *not* the path — combining it with native modules is painful, and
node-pty means there is still one.

## One artifact, two hosts

`apps/node/src/server/composition.ts` already builds the same plugin graph for both hosts; the
difference is supervision and native capability injection, not a second assembly. The remaining
thing that made them different *artifacts* was ABI: desktop runs the node under Electron, standalone
under plain Node. With SQLite no longer native and node-pty ABI-stable, that difference stops
existing — which is what makes "the client ships a node, and you can also download one" a packaging
decision rather than a fork.

A related trap, found the hard way and worth stating as a rule: **the shared main-process barrel must
not re-export an Electron-only module.** A barrel evaluates every module on it, so
`registerFolderPickerIpc` (which statically imports `electron`) made
`@acorn/plugin-terminal/main/index.ts` unloadable in a plain-Node process — and `apps/node`'s
composition root imports `reconcileTmux` from that same barrel. The standalone node died at boot with
`The requested module 'electron' does not provide an export named 'dialog'`. Desktop-only exports
import from their module directly. Anything reachable from a node composition root has to stay
loadable without Electron, and the integration tests that would have caught it were failing for the
same reason.

## Ordering

1. `better-sqlite3` → `node:sqlite` — **done**, and it halves the problem.
2. A Linux node-pty prebuild produced in CI.
3. The CI matrix and release upload: Linux and Windows.
4. Replace or bundle `openssl`.
5. macOS, once there is a Developer ID.
6. Bundle a Node runtime, if "install Node first" turns out to be the adoption blocker.

## Not in scope here

Reaching a node across the internet rather than a LAN, browser clients, and the relay service are a
different problem with a different trust model — see [remote.md](./remote.md). Nothing in this
document assumes anything beyond a network the operator already trusts, and exposing a node that
runs PTYs, spawns agents and executes repo-configured commands is a decision that should stay
explicit at every layer.
