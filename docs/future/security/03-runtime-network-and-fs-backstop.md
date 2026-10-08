# Phase 03: move the bundled runtime to Node 26

Date: October 7, 2026. Revised October 8, 2026, after testing Node 26.8.1. Status: proposed product
requirements; implementation not started.
Source baseline: `823db58295b84ac9f9fb52f3f85b7a6550bd8761`.
Relationship: build after [phase 02](./02-plugin-realm-intrinsics.md), which remains the primary
control for everything this phase leaves open.

This PRD moves the desktop bundle from Node 24 to Node 26, so the runtime refuses network access to a
loaded plugin that declares no network grant. That holds even when the plugin defeats the JavaScript
policy in its realm. The upgrade does not enforce declared hostnames and does not confine SQLite.
This PRD records both limits so no doc claims them.

## Problem and outcome

Acorn bundles Node 24.21.0, pinned in `node-runtime.json`. The supported range in that file, the root
package engines, and `packages/protocol/src/runtime/nodeRuntime.ts` already admits Node 22, 24, and 26.
`packages/node-core/src/server/plugins/isolation.ts` launches the loaded plugin worker with
`--permission` and explicit `--allow-fs-read` and `--allow-fs-write` grants. It adds `--allow-net`
only when it detects Node 26 or later and the plugin declares a host or the `sockets` grant.

Node 24 has no network permission, so under `--permission` every plugin can open sockets once it gets
past the realm's JavaScript checks. Node 26 adds one. The October 8 probe ran Node 24.11.0 and 26.8.1
with `--permission` and a narrow read grant:

| Check | Node 24 | Node 26 |
| --- | --- | --- |
| Raw socket connect without `--allow-net` | Connects | Refused with `ERR_ACCESS_DENIED` |
| Connect to another host with `--allow-net=example.com` | Not applicable | Connects |
| SQLite opens a database outside the read grants | Opens | Opens |
| Ordinary file read outside the read grants | Refused | Refused |

The probe ran in a plain process rather than a plugin worker. The terminal client recorded that a
worker's `execArgv` takes `--permission` with grants of its own on Node 24 and 26
(`apps/tui/src/plugins/workerFactory.ts`), so the worker is expected to match. Acceptance confirms it.

Three facts follow:

- A plugin that declares no `net` host and no `sockets` grant gets a runtime refusal on every socket.
  Defeating the JavaScript layer from [phase 02](./02-plugin-realm-intrinsics.md) no longer gives it
  egress. This is the gain.
- Node 26's network permission is on or off. `node --help` documents `--allow-net` without a value,
  and a host value is accepted and ignored. A plugin that declares one host gets unrestricted sockets
  from the runtime. Only the realm's `fetch` wrapper holds it to its declared hostnames.
- The SQLite builtin ignores the filesystem grants on both lines. The builtin import guard is the only
  thing between a plugin and arbitrary database files, including `core.sqlite`, peer plugin databases,
  and the `projects` rows whose scripts the node runs later.

The outcome: the bundle ships Node 26, plugins without a network grant lose network access at the
runtime, and the docs state that hostname enforcement and SQLite confinement rest on phase 02's
realm hardening. Socket-level hostname enforcement remains rung 3 in
[the node realm](../../security/plugin-node-realm.md).

## Starting points and owners

Inspect these files and their tests:

- `node-runtime.json` pins the desktop bundle's Node version and declares the supported range.
- `apps/desktop/scripts/node-runtime.mjs` downloads and verifies the pinned runtime, and
  `apps/desktop/scripts/stage.mjs` stages it into the bundle.
- `packages/protocol/src/runtime/nodeRuntime.ts` holds the shared runtime policy the host enforces
  before it starts a worker.
- `packages/node-core/src/server/plugins/isolation.ts` builds the worker `execArgv`, including the
  conditional `--allow-net`.
- `packages/node-core/src/server/plugins/storagePolicy.ts` installs the SQLite authorizer that plugin
  storage requires. Its error message names the Node 24 runtime.
- `scripts/rebuild-node-abi.mjs` probes and rebuilds node-pty, the only native module the bundle ships.
- `.github/workflows/ci.yml` and `.github/workflows/build-desktop.yml` set `node-version: 24`.
- `scripts/pack-node.mjs` and the root `package.json` engines range set the standalone tarball's floor.

Read [the node realm](../../security/plugin-node-realm.md), which documents the runtime floor and the
grant model, and [the dated review](../../security/review-2026-10-01.md), which records the runtime pin
and the dependency posture.

## Required behaviour

Pin the bundle to a current Node 26 release at or above the tested 26.8.1, inside the supported range.
Move continuous integration to the same line, so the tests run on the runtime that ships. Keep Node 22
and 24 in the supported range for the standalone tarball unless the gate shows a reason to drop them,
and keep the shared runtime policy, both engines fields, and `node-runtime.json` in agreement.

Keep the `--allow-net` branch keyed on the running major version. Pass it only when the plugin declares
a host or the `sockets` grant. Do not pass a host value. Node ignores it, and a reader would take it
for enforcement.

Preserve the plugin grant model. A plugin with a declared host still reaches it, a plugin with the
`sockets` grant still gets raw sockets, and a plugin with migrations still opens its own database
through the storage policy. The change is the runtime and the docs, not the shape of the grants.

Fix what the gate finds on Node 26 at its cause. Known areas to watch: the process-level
`localStorage` workaround in `vitest.browser.setup.ts` and `plugins/vitest.shared.ts`, the HTTP client
test that already branches on a native API Node 26 provides, and any `node:sqlite` behaviour the
storage shim relies on.

## Contracts and data flow

The chain is the pinned runtime, the shared runtime policy that admits it, and the `execArgv` the
worker launches with. Once the bundle ships Node 26, the `--allow-net` branch applies in production
rather than only on a developer machine that happens to run a newer Node. No wire contract,
`workerData` field, or grant schema changes.

## Acceptance and verification

Verify on the pinned Node 26, in a disposable plugin profile, through a real plugin worker:

- A plugin with no `net` host and no `sockets` grant has a raw socket connect refused by the runtime
  with `ERR_ACCESS_DENIED`, including after it rewrites the intrinsics phase 02 freezes.
- A plugin that declares one host reaches it through `fetch`, and the realm's wrapper refuses an
  undeclared host. Record that a raw connection to an undeclared host is not refused by the runtime.
- A plugin with the `sockets` grant opens a raw socket.
- A worker with narrow filesystem grants is refused the SQLite builtin by the import guard. Record
  that the runtime would open a database outside the grants if the guard were bypassed.
- A plugin with migrations opens its own database, and the storage policy installs its authorizer.
- The desktop app boots, a bundled plugin loads and serves its routes, and an agent PTY runs.

Run `pnpm --filter @acorn/desktop test`, which stages the bundle and runs the desktop and Rust suites,
then the full `pnpm test` gate on Node 26, and `pnpm lint`. Run a dependency audit on the refreshed
graph. Record the runtimes and platforms exercised and any platform not covered.

Update `node-runtime.json`, [the node realm](../../security/plugin-node-realm.md), the packaging section
the runtime pin lives in, and the docs that name Node 24 as the shipped runtime. The node realm page
states that the runtime refuses network only to plugins without a network grant, and that hostname
enforcement and SQLite confinement depend on the realm's JavaScript layer.

## Verify before building

- Re-run the probe on the selected 26 release. A later release may add host-scoped network
  permissions or extend the filesystem model to SQLite. If either changed, update this PRD and the
  node realm page before relying on it.
- Confirm a plugin worker, not only a process, applies `--permission` and `--allow-net` as the probe did.
- Confirm node-pty's prebuilt binary loads on the selected release on every desktop target.
- Confirm the standalone tarball's tested floor and the root engines range move with the bundle, so no
  path starts a worker below the floor.
