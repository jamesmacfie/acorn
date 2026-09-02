# Phase 3: the node listens sooner

Status: not started. Waits on phase 0 for the boot breakdown that decides its gated half.

## Goal

The node's boot sheds the work that runs in series for no ordering reason, and binds its listener as
early as its own boot allows. Definite work in this phase: the login-shell probe leaves the critical
path, the bundled-plugin rewrite becomes a no-op when nothing changed, and plugin initialisation runs
concurrently. Gated work: the listener binds before plugin initialisation, with plugin routes
answering "starting" until their plugin is ready. This is the node's half of
[decisions.md](./decisions.md) decision 2.

## Why this phase, and why now

`apps/node/src/composition/runtime.ts` boots in one serial chain, and three links in it exist for
history rather than dependency.

The first is `inheritLoginShellPath`, which on a packaged macOS build runs `$SHELL -lic 'printf %s
"$PATH"'` with a five-second timeout before anything else. A developer's shell profile with a version
manager in it costs half a second to two seconds, every launch. The `PATH` it recovers is for spawning
agents and build commands later, not for binding a listener now.

The second is in the helper rather than the node, but it sits on the same critical path.
`packages/custody/src/plugins/pluginCache.ts`'s `putBundled` computes a bundle's sha256 and then
writes the bundle regardless of whether the cache already holds that hash, then rewrites the index
through `writePrivateAtomic`, which fsyncs, and then `packages/custody/src/plugins/pluginTrustStore.ts`
records the trust decision, which fsyncs again. Five bundled plugins means five bundle writes and ten
fsynced JSON rewrites per launch, for bytes that changed at the last app update.

The third is `packages/node-core/src/server/pluginHost/host.ts`. `initPlugins` runs
`for (const plugin of plugins) await plugin.init(ctx)` and then a second serial pass for `ready`.
Each of nine plugins opens its own SQLite file and runs its migration chain inside `init`
(`packages/node-core/src/server/plugins/storage.ts`). The file's own header says declaration order is
not load-bearing and cross-plugin needs resolve through the capability registry at call time. The
loop is serial because loops are.

Then there is the listener. `startListener` runs after both plugin passes, so a client cannot reach
`/v2/node` or a core route until the last plugin has finished. Whether that matters depends on a
number nobody has: how long the plugin passes take once they run concurrently. Phase 0's per-plugin
marks produce it. This phase spends it.

## Scope

In, definite:

- `inheritLoginShellPath` starts at boot and is awaited at the first process spawn that needs it
  (`packages/node-core/src/server/core/proc.ts`), not before `openDataRoot`.
- `putBundled` returns early when `has(hash)` is true, and the trust store records a decision only
  when the stored one differs. The index rewrite follows the same rule.
- `initPlugins` runs the `init` pass with `Promise.allSettled` and the `ready` pass the same way,
  with per-plugin failure isolation: a plugin that throws is recorded as failed and the rest proceed,
  which is what the serial loop does today one at a time.
- A measurement, not a change, of the ten SQLite opens and migrations: drizzle's `migrate` on an
  up-to-date journal is one `SELECT` against `__drizzle_migrations`, so the expectation is
  milliseconds each. If the marks say otherwise, the answer is a journal check before `migrate`,
  written down here so nobody optimises this before reading the number.
- A measurement of the service bundle's evaluation time. `apps/node/vite.config.ts` emits one
  1,093,602-byte chunk of 344 modules, evaluated whole before `startServiceRuntime`. If it is over
  100 ms, the fix is per-plugin chunks through dynamic imports in `apps/node/src/composition/plugins.ts`.

In, gated on the phase 0 breakdown:

- If the plugin passes still exceed 300 ms after concurrency and dominate the boot (not `migrate`,
  not the cert read), the listener binds after core migration and before `initPlugins`. Until a
  plugin's `init` resolves, its routes under `/v2/p/<plugin>/*` answer 503 with the standard envelope
  `{ code: 'plugin_starting', retryable: true }` and a `Retry-After`; `/v2/node` reports `state:
  'starting' | 'ready'`; a `node:ready` frame is pushed when the last plugin resolves. No new client
  code is needed: `packages/protocol/src/errors.ts` already carries `retryable`, and
  `packages/client-core/src/infra/node/apiClient.ts` already retries on it.
- If the breakdown shows the passes under the mark, this half is refused and refused.md says why:
  it is a wire contract every client and the MCP child would have to honour, and a contract is not
  worth 200 ms.

Out: reconciliation, which already runs after `listening`. The helper's ready line (phase 2).
Splitting the node into processes (refused.md).

## Design

**The shell probe becomes a promise the spawner awaits.** `inheritLoginShellPath` returns a promise
stored on the runtime; `proc.ts`'s spawn path awaits it once. The listener, the migrations, and the
plugin inits do not depend on `PATH` and never did. The five-second timeout stays, and a spawn that
arrives before the probe resolves waits at most that long, once.

**Idempotent custody writes.** `putBundled(bytes)` hashes, checks `has(hash)`, and returns the hash
without touching disk when it is present. `writeIndex` is called only when an entry was added. The
trust store's `record` compares the stored decision and writes only on change. The three fsyncs per
plugin become zero on the common launch.

**Concurrent plugin passes with the failure semantics kept.** The host collects `init` promises,
awaits `allSettled`, records each rejection against its plugin exactly as the serial loop's `catch`
does, and runs `ready` only for the plugins whose `init` settled fulfilled. One thing to check first:
a plugin that consumes a capability in `init` that another plugin provides in its `init`. The
header says this does not happen; the test below proves it, by initialising in reverse order and
shuffled.

**The gated listener.** `packages/node-core/src/server/index.ts` mounts plugin routers in a loop
after core routes. With the gate on, each plugin's mount is wrapped in a middleware that checks a
per-plugin `ready` flag and answers 503 until it flips. Core routes are unaffected because core is
migrated before the bind. `/v2/node`'s body gains `state`, which the client's node chip already
knows how to draw for `starting`.

## Code touched

- `apps/node/src/composition/runtime.ts`: the probe's placement, the listener's placement if gated.
- `packages/node-core/src/server/core/proc.ts`: await the probe.
- `packages/custody/src/plugins/pluginCache.ts`, `pluginTrustStore.ts`.
- `packages/node-core/src/server/pluginHost/host.ts`: `initPlugins`.
- `packages/node-core/src/server/index.ts`, `packages/protocol/src/errors.ts` (the new code), the
  node route in `packages/node-core/src/server/routes/` that serves `/v2/node`, if gated.

## Tests

- `pluginCache.test.ts`: `putBundled` twice with the same bytes writes once; the index and trust
  files' mtimes do not change on the second call.
- `host.test.ts`: initialising the roster reversed and shuffled produces the same registrations; a
  plugin whose `init` rejects is recorded failed and its neighbours are ready.
- `apps/node/test/integration/`: the composition root boots with every plugin and `[service:boot]
  listener-up` occurs before the last plugin mark, if gated; a request to a not-yet-ready plugin route
  returns 503 with `retryable: true` and succeeds after `node:ready`.
- `proc.test.ts`: a spawn before the probe resolves waits for it; a spawn after does not.

## Docs owed

`docs/node-distribution.md`: boot order and the `starting` state if gated. `docs/plugins.md`
§ Activation: init is concurrent and order is not a contract; a plugin that needs another's
capability at init time is a bug. `docs/api-reference.md`: the 503 code, if gated.
`docs/security.md` § Third-party plugin bundles: the cache write is idempotent.

## Done when

- `[service:boot] install` drops by the sum of the serial plugin inits minus the longest one, per
  the phase 0 marks.
- A packaged macOS build's `listener-up` no longer includes the shell probe.
- A second launch with unchanged bundled plugins performs no writes under the plugin cache
  directory (assert with mtimes).
- If gated: a client connecting during boot sees `starting` and then `ready` without a reconnect.

## Verify before building

- Confirm `runtime.ts` still awaits `inheritLoginShellPath` first, and `host.ts` still loops
  serially in both passes. Read at `17a9acdf`.
- Confirm `putBundled` still writes without a `has` check. The hash comparison exists one line above
  the write.
- Read the phase 0 breakdown before touching the listener's position. The gate is a number, and this
  file does not have it.
- Confirm `packages/protocol/src/errors.ts` still carries `retryable` and that `apiClient.ts`
  honours it, before claiming the gated half needs no client code.
