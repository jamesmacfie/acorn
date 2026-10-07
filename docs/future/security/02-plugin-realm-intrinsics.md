# Phase 02: make the plugin realm policy tamper-resistant

Date: October 7, 2026. Status: proposed product requirements; implementation not started.
Source baseline: `823db58295b84ac9f9fb52f3f85b7a6550bd8761`.
Relationship: pairs with [phase 03](./03-runtime-network-and-fs-backstop.md).

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
enforcement a plugin cannot reach. See [phase 03](./03-runtime-network-and-fs-backstop.md) for the
operating-system backstop that makes the control hold even when the JavaScript layer is defeated.

The outcome: the JavaScript policy layer is not trivially bypassable from inside the realm. A plugin
that tampers with shared intrinsics finds them frozen, so defeating the allowlist takes more than a
one-line prototype rewrite, and the backstop in phase 03 catches what remains.

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
