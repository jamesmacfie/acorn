# Phase 02: make the plugin realm policy tamper-resistant

## Completion note: October 9, 2026

Status: implemented. Loaded plugin workers start with `--frozen-intrinsics`, which freezes the
JavaScript prototypes used by the builtin and hostname policies before the bootstrap imports. The
bootstrap freezes `URL.prototype` and `Request.prototype` and captures their native accessors before
the plugin entrypoint imports. For non-Request inputs, native `fetch` receives the URL spelling that
the wrapper checked. ESM resolution, scoped `require`, `process.getBuiltinModule`, and fetch keep their
existing grants, worker data and RPC shapes, and author-facing refusal messages.

The built-in flag was compatible with the trusted bootstrap and loaded plugins on the bundled Node
24.21.0: the real `loader.test.ts` worker suite passed all 63 tests under the cached bundle binary.
Node 26.9.0 also passed the full node-core suite. Node emits an experimental warning for each worker
started with the flag. Plugins that assign to frozen JavaScript prototypes or redefine the frozen URL
and Request accessors receive a `TypeError`. The URL and Request freeze is necessary in addition to
capturing getters: a hostile rewrite of `URL.prototype.href` made the captured native `Request.url`
getter return a forged host before the freeze was added. No trusted dependency needed an exception.

Acceptance and scoped verification:

- Hostile worker code attempts to rewrite Set, String, RegExp, Array, and Function methods before
  requesting `node:net`, `node:child_process`, and `node:sqlite` through all three builtin entry
  points. Each refusal retains its original error. A second hostile worker changes the URL and
  Request globals and tries to replace their accessors before fetching. Declared hosts work and
  undeclared hosts throw. An honest worker loads granted `net` through all three paths, reaches its
  declared fetch host, and receives the existing error for ungranted sqlite. The two prior hostile
  sqlite plugins still fail before opening a database.
- `pnpm test:focus @acorn/node-core src/server/plugins/loader.test.ts`: 63 passed under bundled
  Node 24.21.0. `pnpm --filter @acorn/node-core test`: 1,673 passed in 162 files under Node 26.9.0
  with loopback sockets enabled. The sandboxed attempt hit socket restrictions in unchanged transport
  tests and was interrupted; the same suite then passed outside that restriction.
- `pnpm --filter @acorn/protocol test`: 295 passed in 38 files.
  `pnpm --filter @acorn/custody test`: 188 passed in 17 files.
  `pnpm --filter @acorn/node exec vitest run test/integration/pluginSystem/pluginLoader.test.ts
  test/integration/plugins/httpLoaded.test.ts test/integration/plugins/databaseLoaded.test.ts
  test/integration/pluginSystem/loadedModelProviders.test.ts
  test/integration/pluginSystem/loadedLinear.test.ts --maxWorkers=1`: all 14 tests passed.
  `pnpm --filter @acorn/arch-tests test`: 87 passed in 12 files.
- Scoped `tsc --noEmit` passed for node-core, protocol, node, custody, and tui. Scoped oxlint passed
  for all changed TypeScript. `pnpm --filter @acorn/node build` passed, including its service budget.

Unrelated consumer failures left unchanged: the full `@acorn/node` suite passed 272 tests and failed
one route-registry golden assertion because its golden list lacks
`GET /v1/p/github/repos/:owner/:repo/pulls/search`. The full `@acorn/tui` suite passed 720 tests,
skipped two, and timed out in `src/node/boot.test.ts` (rows persisted) and
`src/plugins/workerFactoryOwnership.test.ts` (worker fixture deadline). Both TUI files passed all 16
tests with `pnpm --filter @acorn/tui exec vitest run src/plugins/workerFactoryOwnership.test.ts
src/node/boot.test.ts --maxWorkers=1`. One of the five Node integration files also timed out under
parallel load; all 14 passed with one worker. None of those failures runs changed source. No full-repo
test or lint command was run.

Later phases must not treat these JavaScript guards as a native network boundary. The unchanged
bundled Node 24.21.0 grants no runtime network permission, and the fetch hostname list does not
confine other socket paths or SQLite by itself. Phase 03 was excluded: runtime pins, CI runtime line,
and permission flags other than `--frozen-intrinsics` remain unchanged. Phase 03 should recheck this
experimental flag against its selected runtime and retain the Web API freeze or equivalent protection.

Date: October 7, 2026. Status: proposed product requirements; implementation not started.
Source baseline: `823db58295b84ac9f9fb52f3f85b7a6550bd8761`.
Relationship: build before [phase 03](./03-runtime-network-and-fs-backstop.md).

This PRD stops a loaded plugin from defeating its own network and builtin allowlists by rewriting the
shared JavaScript intrinsics the policy checks depend on. The checks run as ordinary code in the same
realm as the plugin, so today the plugin can change the rules before it asks for a capability.

## Problem and outcome

The loaded plugin's node half runs in a `worker_threads` realm started by
`packages/node-core/src/server/plugins/isolation.ts`. The bootstrap at
`packages/node-core/src/server/plugins/nodePluginWorker.ts` installs two allowlists in that realm:

- A `fetch` wrapper that checks each request's hostname against the declared list, using
  `networkHostAllowed` from `packages/node-core/src/server/plugins/networkHosts.ts`.
- A builtin-family policy, `pluginBuiltinAllowed` from `packages/protocol/src/plugin/nodeBuiltins.ts`,
  that denies socket, child-process, and sqlite builtins unless the matching grant is set. It gates the
  ESM resolver hook, the scoped require, and the override of `process.getBuiltinModule`.

Both policies lean on shared mutable intrinsics. `networkHostAllowed` and `pluginBuiltinAllowed` both
call `Set.prototype.has`. The bootstrap does not freeze intrinsics before it imports the plugin
entrypoint. A plugin's `init` runs in the same realm, so it can replace `Set.prototype.has` (or another
method the policy walks through) with a function that returns the answer it wants, pull a builtin
through the now-permissive `process.getBuiltinModule`, and restore the method. The hostname allowlist
falls the same way: the check can be made to return true for any host.

This is consistent with the stated model, where
[the node realm](../../security/plugin-node-realm.md) is a resource boundary rather than a hostile-code
sandbox. The gap worth closing is narrower. The network allowlist is presented to plugin authors and
owners as a real control, "fetch to declared hostnames only," and on the bundled runtime it has no
enforcement a plugin cannot reach. [Phase 03](./03-runtime-network-and-fs-backstop.md) moves to Node 26,
whose runtime refuses sockets to a plugin with no network grant. Node 26 does not scope network access
by host or confine SQLite, so this phase stays the only guard for declared hostnames and databases.

The outcome: the JavaScript policy layer is not trivially bypassable from inside the realm. A plugin
that tampers with shared intrinsics finds them frozen, so defeating the allowlist takes more than a
one-line prototype rewrite. Phase 03's runtime refusal covers only plugins with no network grant.

## Starting points and owners

Inspect these files and their tests:

- `packages/node-core/src/server/plugins/nodePluginWorker.ts` owns the realm bootstrap: the require
  guard, the resolver hook, the `getBuiltinModule` override, and the `fetch` wrapper.
- `packages/node-core/src/server/plugins/networkHosts.ts` owns `networkHostAllowed`.
- `packages/protocol/src/plugin/nodeBuiltins.ts` owns `pluginBuiltinAllowed` and the family sets.
- `packages/node-core/src/server/plugins/isolation.ts` owns the worker launch, its `execArgv`, and the
  `workerData` the bootstrap reads.

Read [the node realm](../../security/plugin-node-realm.md) and its acceptance tests, which already run
two hostile plugins that try to reach sqlite.

## Required behaviour

Harden the realm so the policy decisions do not depend on intrinsics a plugin can rewrite. Prefer the
cheapest approach that holds, and state which one you took in the bootstrap.

- Freeze the intrinsics the policy relies on before the plugin entrypoint is imported. The realm boots
  trusted code first, so freezing after the host wiring and before the dynamic import of the plugin
  module is the window. Consider `--frozen-intrinsics` on the worker's `execArgv` if it is compatible
  with the trusted bootstrap dependencies, or an explicit freeze of the prototypes the policy walks.
- Alternatively, or in addition, rewrite the policy checks so they do not route through mutable
  prototype methods. Capture the method references at module load, before any plugin code runs, and
  call them in a way a later prototype rewrite cannot intercept.

Whatever the approach, the policy must give the same answer after a plugin has tried to rewrite
`Set.prototype.has`, array iteration, and the other intrinsics the checks touch. Preserve the behaviour
for honest plugins: a declared hostname still resolves, a granted builtin still loads, and an
undeclared one still throws the author-facing error.

If `--frozen-intrinsics` breaks a trusted bootstrap dependency, record which one and why, and fall back
to capturing method references. Do not weaken the trusted dependency to fit the flag.

## Contracts and data flow

The policy is called at three moments: ESM resolution, scoped require, and `process.getBuiltinModule`,
plus every `fetch`. Each must read a policy result that plugin code cannot have altered. Keep the
author-facing error messages, since they document the grant model. Do not change the shape of
`workerData` or the RPC contract; this is a hardening of the realm's own guards, not a change to what
the host sends.

## Acceptance and verification

Extend the hostile-plugin acceptance tests in the node realm suite:

- A plugin that rewrites `Set.prototype.has` before requesting `node:net`, `node:child_process`, and
  `node:sqlite` is still refused each one.
- A plugin that rewrites the same intrinsic before calling the wrapped `fetch` is still held to its
  declared hostnames, and an undeclared host still throws.
- An honest plugin with a declared `net` host and a granted builtin still reaches both, and an
  undeclared builtin still throws the author-facing error.
- The two existing hostile plugins that reach for sqlite still fail before obtaining a database handle.

Run the full `@acorn/node-core` and `@acorn/protocol` suites, their consumers, and `pnpm lint`. Run
`pnpm --filter @acorn/arch-tests test` if a policy module's shape changes. Record whether
`--frozen-intrinsics` was usable on the bundled runtime, since phase 03 may change that runtime.

Update [the node realm](../../security/plugin-node-realm.md) to describe how the policy survives
intrinsic tampering, and to state plainly that the JavaScript layer alone is not the network boundary.

## Verify before building

- Confirm which intrinsics each policy check walks through, so the freeze or the captured references
  cover all of them, not only `Set.prototype.has`.
- Confirm the order of the bootstrap: trusted dependencies load, host wiring runs, then the plugin
  entrypoint imports. The freeze belongs in the gap before the plugin import.
- Confirm `--frozen-intrinsics` compatibility with the trusted bootstrap dependencies on the runtime
  phase 03 selects.
- Confirm the hostile-plugin test harness can install a prototype rewrite before the policy runs, so
  the regression actually exercises the bypass.
