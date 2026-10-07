# Phase 03: give the plugin limits an operating-system backstop

Date: October 7, 2026. Status: proposed product requirements; implementation not started.
Source baseline: `823db58295b84ac9f9fb52f3f85b7a6550bd8761`.
Relationship: pairs with [phase 02](./02-plugin-realm-intrinsics.md).

This PRD gives the loaded plugin's network and filesystem grants an enforcement layer below the
JavaScript policy, by running the plugin worker on a Node runtime whose permission model covers both.
On the runtime Acorn bundles today, the network allowlist has no backstop a malicious plugin cannot
reach, and the SQLite builtin ignores the filesystem grants.

## Problem and outcome

Acorn bundles Node 24.21.0, pinned in `node-runtime.json`. The supported range in that file and in the
root package engines spans Node 22, 24, and 26. The loaded plugin worker is launched by
`packages/node-core/src/server/plugins/isolation.ts` with `--permission` and explicit
`--allow-fs-read` and `--allow-fs-write` grants.

Two runtime behaviours leave the plugin limits without an operating-system backstop on Node 24:

- Node 24 has no network permission flag. `isolation.ts` only passes `--allow-net` when it detects
  Node 26 or later. So on the bundled runtime, the hostname allowlist in
  `packages/node-core/src/server/plugins/nodePluginWorker.ts` is the only thing between a plugin and
  outbound sockets. A raw socket connect under `--permission` is refused on Node 26 with an
  access-denied error and is not refused on Node 24. Combined with [phase 02](./02-plugin-realm-intrinsics.md),
  a plugin that defeats the JavaScript layer gets unrestricted egress on Node 24.
- The SQLite builtin does not honour the filesystem permission model on Node 24. A worker launched with
  `--permission` and a narrow `--allow-fs-read` is correctly denied an ordinary file read, yet opens a
  SQLite database at a path outside its grants. The builtin import guard is the only thing standing
  between a plugin and arbitrary database files, including `core.sqlite` and peer plugin databases. The
  `projects` table holds the setup and database-url scripts the node runs later, so a write there is
  delayed code execution.

The outcome: the plugin worker runs on a runtime where `--allow-net` enforces the hostname allowlist at
the socket, and where the filesystem permission model covers the SQLite builtin. The grants Acorn
already computes gain an enforcement layer a plugin cannot reach from inside its realm.

## Starting points and owners

Inspect these files and their tests:

- `node-runtime.json` pins the desktop bundle's Node version and declares the supported range.
- `apps/desktop/scripts/stage.mjs` stages the bundled Node runtime for the desktop app.
- `packages/protocol/src/runtime/nodeRuntime.ts` holds the shared runtime policy the host enforces
  before it starts a worker.
- `packages/node-core/src/server/plugins/isolation.ts` builds the worker `execArgv`, including the
  conditional `--allow-net`.
- The root `package.json` engines range and the standalone tarball manifest, which carry the same
  supported floors.

Read [the node realm](../../security/plugin-node-realm.md), which documents the runtime floor and the
grant model, and [the dated review](../../security/review-2026-10-01.md), which records the runtime pin
and the dependency posture.

## Required behaviour

Move the bundled desktop runtime, and the standalone tarball's tested floor, onto the Node line that
carries network permissions, so `--allow-net` applies to the plugin worker. Keep the shared runtime
policy and the supported range in agreement with whatever the bundle ships, so a worker never starts on
a runtime below the floor the policy promises.

Confirm two enforcement properties on the selected runtime:

- With `--allow-net` passed, the worker's `fetch` is held to its declared hostnames at the socket, and
  a raw socket connect from the worker is refused by the runtime, not only by the JavaScript wrapper.
- The filesystem permission model covers the SQLite builtin. A worker with a narrow `--allow-fs-read`
  and `--allow-fs-write` cannot open a database file outside its grants. If the selected runtime still
  exempts SQLite, keep the builtin import guard from phase 02 as the primary control and record the
  residual limit plainly.

Preserve the plugin grant model. A plugin with a declared `net` host still reaches it, a plugin with
the `sockets` grant still gets raw sockets within the runtime's policy, and a plugin with migrations
still opens its own database at the pre-created paths. The change is the runtime floor and the flags
that follow from it, not the shape of the grants.

If moving the bundled runtime forces a coordinated change, such as a native module rebuild or a
packaging adjustment, record the dependency and sequence it before the version bump. Do not ship a
runtime the native modules cannot load.

## Contracts and data flow

The chain is the staged runtime, the shared runtime policy that admits it, and the `execArgv` the
worker launches with. The `--allow-net` branch in `isolation.ts` keys on the detected major version;
once the bundle ships the newer line, that branch applies in production rather than only in a developer
environment that happens to run a newer Node. Keep the detection honest: the flag goes on only when the
running Node supports it.

## Acceptance and verification

Verify on the selected runtime, in a disposable plugin profile:

- A plugin declaring one hostname reaches it and is refused a second host at the socket, with
  `--allow-net` in effect.
- A plugin that obtains a raw socket builtin is refused the connection by the runtime.
- A worker with narrow filesystem grants cannot open a SQLite database outside those grants, or, if the
  runtime still exempts SQLite, the builtin import guard refuses the builtin and the residual limit is
  recorded.
- The desktop app boots, a bundled plugin loads and serves its routes, and an agent PTY runs, all on
  the new runtime.

Run `pnpm --filter @acorn/desktop test`, which stages the bundle and runs the desktop and Rust suites,
plus the full `@acorn/node-core` and `@acorn/protocol` suites and `pnpm lint`. Run a dependency audit on
the refreshed graph. Record the runtimes exercised and any platform not covered.

Update `node-runtime.json`, [the node realm](../../security/plugin-node-realm.md), and the packaging
section the runtime pin lives in, so the shipped docs name the runtime that carries the backstop.

## Verify before building

- Confirm the exact Node version on the newer line that carries network permissions, and that it is in
  the supported range the shared policy enforces.
- Confirm the native modules the bundle ships load on the selected runtime before pinning it.
- Confirm, on that runtime, whether the SQLite builtin honours `--allow-fs`, so the residual note is
  accurate.
- Confirm the standalone tarball's tested floor and the root engines range move together with the
  bundle, so no path starts a worker below the floor.
