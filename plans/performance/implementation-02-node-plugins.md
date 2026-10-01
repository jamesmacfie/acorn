# Node plugin implementation

Unit 02 fixes the ownership failures in [the Node plugin audit](./02-node-plugins.md) and the
returned-span case in [the ownership audit](./16-ownership.md). Completed request contexts and
visitors release their function exports and receiver proxies. Rejected reload candidates release
their workers. Request cancellation reaches compiled mounts and loaded workers.

The paired fixtures establish retained-heap and authority improvements. They also measure higher
CPU and elapsed time per operation. This unit makes no startup, navigation, or visible-latency
improvement claim.

## Owners and contracts

The Node host creates an authenticated request context, adapts the mounted HTTP request, and passes
both to the selected plugin route. A compiled route receives those objects directly. A loaded
route receives them through its permissioned worker's message port. Provider methods retain their
principal, environment, and provider scope in the host. Credential visitors and SQLite storage
retain their established owners. The shell, broker, client cache, and UI contracts do not change.

The implementation keeps the transport, reference accounting, ownership policy, wire values, and
body reader in separate files beside the loaded-plugin owner. `PluginRpcEndpoint` remains the
private-port transport. Its internal diagnostics expose counts without exposing captured authority.
The public plugin API has no added parameter or property.

### Request and visitor ownership

`buildPluginRequestContext` explicitly marks its returned object with an internal WeakSet marker.
Encoding that graph creates an invocation scope. Derived provider and store methods inherit that
scope. Plain nested results can finish while an entered callback drains, but further calls through
a retired request scope reject. Weak references do not keep exported functions alive. Local exports
remain strongly held until their explicit owner retires.

Visitor policy applies only to the published `plugin.init.args[0]` and `plugin.ready.args[0]` host
context roots, or to the explicitly marked request provider graph. `providers.withConnection`,
`core.secrets.use`, `core.secrets.useOptional`, `telemetry.measure`, and request
`providers.withConnections` lend their callback arguments until the operation finishes. Their
generic visitor results retain realm ownership, including returned functions and objects of
methods. A callback can therefore return a callable that the plugin uses after the visitor operation
returns. An arbitrary capability with a similarly named method retains its callback.

Lifecycle contexts, route registrations, event subscriptions, disposal handles, and deliberate
capability results keep realm ownership. Capability lookup resolves the replacement implementation,
while a retained proxy to a preceding implementation keeps its established lifetime.

Ordinary argument scopes retire at the receiver's reply or cancellation seam and at the exporter's
settlement seam. Advertising the scope in the call avoids a separate release frame. A live nested
pending call retains its remote scope object, so a delayed result cannot recreate a retired scope.
The guard follows arrays, records, Request signals, and AbortSignal reasons. It needs no permanent
set of retired IDs.

### Function identity and returned resources

Stable export identity includes the original function, scope, synchronous or asynchronous mode,
and lifetime policy. Class methods reuse one binding per instance and method. Separate simultaneous
visitor scopes remain independent even when both use the same callback. Encoding transactions
claim shared identities until publication or rollback. Failure in one encoding cannot remove a
callback that another concurrent encoding has published.

`telemetry.startSpan` results own a separate resource scope. A span can remain open after the call
that starts it. Its first `end` retires the scope and receiver proxy cache. Repeated `end` calls are
local no-ops, including the shared inert handle. Overlapping spans and sibling fields stay usable
until each span ends. Methods named `undefined` carry no terminal policy.

### Cancellation and body encoding

The compiled mount adapter forwards `raw.signal`. The Request wire value carries pre-abort state
and live signals. A live Request abort settles the caller and sends cancellation without waiting
for plugin code that ignores its signal. Owned listeners, signals, argument scopes, and late replies
retire on success, failure, cancellation, and endpoint close. Error-shaped reasons use the wire
error codec, preserving name and message without exporting bound exception methods.

Outgoing calls register before asynchronous body encoding. Endpoint close therefore settles a
caller whose Request body is held. The body reader uses removable retirement and signal listeners,
one cancellation race around its drain, and an observed drain rejection. It cancels the reader
without awaiting an authored cancellation hook. Successful reads leave no reaction attached to a
realm-long unresolved promise. Byte-view offsets, Buffer chunks, empty bodies, and chunk order are
preserved. Non-Uint8Array chunks reject.

Fetch bodies remain fully buffered. The unit introduces no body cap or streaming protocol. Async
dispatch remains concurrent. Synchronous dispatch retains nested message draining, the five-second
wait ceiling, and reuse of completed 4 MiB reply buffers.

### Reload candidate ownership

The host closes an unstarted isolated candidate when reload rejects an unknown or disabled owner.
Initialization, registration replay, and ready failures dispose the candidate and revoke its
registration context. Replay cleanup preserves the original error if disposal also throws. An
isolated plugin's repeated disposal joins the same operation and awaits worker termination.

Initialization rejection preserves the preceding serving instance. Once commit begins, replay and
ready rejection retain the documented contained-failure behavior. Candidate initialization may
already have changed its SQLite schema. Cleanup closes that database without resetting its rows
or schema. The tests reopen the database and successfully checkpoint its write-ahead log.

## Changed files

The unit changes the following production owners:

| File | Change |
| --- | --- |
| `packages/node-core/src/server/plugins/pluginRpc.ts` | Add invocation and resource scopes, cancellation, publication transactions, late-result guards, and retirement fencing. Keep the port private. |
| `packages/node-core/src/server/plugins/rpcReferences.ts` | Own strong exports, scoped leases, stable identities, class bindings, active calls, and publication claims. |
| `packages/node-core/src/server/plugins/rpcOwnership.ts` | Mark request authority and classify only published host-context visitor and span contracts. |
| `packages/node-core/src/server/plugins/rpcValues.ts` | Extract wire values, clone-shape guards, error conversion, and synchronous reply constants. |
| `packages/node-core/src/server/plugins/rpcBody.ts` | Own cancellable buffered byte-stream reads and removable listeners. |
| `packages/node-core/src/server/pluginHost/requestContext.ts` | Mark the actual production request context as invocation-owned. |
| `packages/node-core/src/server/pluginHost/fetchRoute.ts` | Forward the raw Request signal to compiled mounts. |
| `packages/node-core/src/server/pluginHost/host.ts` | Dispose rejected candidates, await unstarted cleanup, and revoke failed candidate contexts. |
| `packages/node-core/src/server/plugins/isolation.ts` | Join worker termination and make isolated candidate disposal idempotent. |
| `packages/node-core/src/server/plugins/loader.ts` | Explicitly discard the asynchronous unstarted-cleanup return in dependency rejection. |

Tests, documentation, and measurement files changed are:

| File | Change |
| --- | --- |
| `packages/node-core/src/server/plugins/rpcLifetimes.test.ts` | Test invocation and visitor lifetimes, generic returned callables, shared callbacks, rollback races, late deliveries, capability replacement, class modes, and overlapping spans. |
| `packages/node-core/src/server/plugins/rpcCancellation.test.ts` | Test real-worker pre/live abort, nested visitors, body validation, pending encoding, uncooperative handlers/hooks, endpoint retirement, and repeated successful reads. |
| `packages/node-core/src/server/plugins/reloadOwnership.test.ts` | Test all candidate rejection stages and successful replacement with real permissioned workers, disposal errors, context revocation, and durable SQLite state. |
| `packages/node-core/src/server/plugins/pluginRpc.test.ts` | Await the deliberately slow callback before worker teardown in the concurrent dispatch test. |
| `packages/node-core/src/server/plugins/__fixtures__/rpcWorker.ts` | Exercise Request cancellation and nested provider visitors across a real worker port. |
| `packages/node-core/src/server/plugins/__fixtures__/hostModesPlugin.mjs` | Use a callable returned by a telemetry visitor after its lending operation ends. |
| `packages/node-core/src/server/pluginFetchRoute.test.ts` | Verify compiled mount pre-abort and live-abort forwarding. |
| `docs/plugins/activation.md` | Document candidate cleanup, idempotent isolated disposal, and serving-instance behavior by failure stage. |
| `docs/security/node-plugin-security.md` | Document RPC owners, generic results, resource spans, cancellation, buffered bodies, and preserved synchronous behavior. |
| `plans/performance/bench-node-rpc-paired.mjs` | Import the selected production endpoint, request-context builder, and telemetry owner for matched route, body, and span workloads. |
| `plans/performance/bench-plugin-reload-paired.mjs` | Import the selected isolation, host, and capability owners for the preserved repeated-replay rejection workload. |
| `plans/performance/implementation-02-node-plugins.md` | Record the implementation, evidence, verification, and limits. |

The owning documents remain in their indexed locations, so no documentation index entry is added.
Unit 01's startup and custody changes remain intact.

## Regression verification

The tests cover real lifetimes and races, including close during Request or Response body encoding,
cancellation while a nested authority call drains, concurrent publication followed by another
encoding's rollback, and delivery of a nested result after the outer route finishes. Two added
held-delivery cases failed before the final recursion fix: an AbortSignal reason and a Request signal
reason recreated retired function proxies. Both reject after `retiredScope` follows those codec
branches.

An intermediate ten-file run completed 107 tests but reported an unhandled rejection. A synchronous
visitor rejects an asynchronous callback at that seam, but the callback had already started work.
The synchronous answer owner now observes that Promise's rejection before reporting the original
contract error. The concurrent dispatch fixture also awaits its intentionally slow call before
terminating its worker. The final replay has 109 passing tests and no unhandled errors.

Run the focused owner suites with:

```sh
rtk proxy pnpm --filter @acorn/node-core exec vitest run src/server/plugins/pluginRpc.test.ts src/server/plugins/rpcLifetimes.test.ts src/server/plugins/rpcCancellation.test.ts src/server/plugins/reload.test.ts src/server/plugins/reloadOwnership.test.ts src/server/plugins/loader.test.ts src/server/plugins/hostCallModes.test.ts src/server/plugins/functionMode.test.ts src/server/pluginFetchRoute.test.ts src/server/pluginHost/dispatch.test.ts --maxWorkers 2
```

The final run passes 10 files and 109 tests in 6.98 seconds. Node emits its experimental SQLite
warning during the worker and storage fixtures. All task-owned workers terminate and temporary
plugin directories are removed.

Additional checks pass:

| Command | Result |
| --- | --- |
| `rtk proxy pnpm --filter @acorn/node-core exec tsc --noEmit` | Exit 0. |
| Targeted oxlint command below | Exit 0, no warnings. |
| `rtk proxy pnpm --filter @acorn/arch-tests exec vitest run docPaths.test.ts --maxWorkers 1` | One file, three tests pass. |
| `rtk git diff --check` | Exit 0. |

```sh
rtk proxy pnpm exec oxlint packages/node-core/src/server/plugins/rpcBody.ts packages/node-core/src/server/plugins/rpcReferences.ts packages/node-core/src/server/plugins/rpcOwnership.ts packages/node-core/src/server/plugins/rpcValues.ts packages/node-core/src/server/plugins/pluginRpc.ts packages/node-core/src/server/plugins/rpcLifetimes.test.ts packages/node-core/src/server/plugins/rpcCancellation.test.ts packages/node-core/src/server/plugins/reloadOwnership.test.ts packages/node-core/src/server/plugins/isolation.ts packages/node-core/src/server/plugins/loader.ts packages/node-core/src/server/pluginHost/host.ts packages/node-core/src/server/pluginHost/requestContext.ts packages/node-core/src/server/pluginHost/fetchRoute.ts packages/node-core/src/server/pluginFetchRoute.test.ts
```

Earlier targeted body/lifetime/mode runs also pass. The repeated-body test performs 500 operations
with both endpoints open and checks owned counters and Request listeners after completion. The
paired probe extends this to 10,000 body operations with forced collection. An initial architecture
test command used the wrong `@acorn/arch` filter and matched no package. The corrected
`@acorn/arch-tests` command above runs the actual suite. A broader plugin-test lint invocation reports
the inherited useless-spread warning in `pluginRpc.test.ts`; the targeted owner check is warning-free.

## Source provenance and probe adaptations

The original `bench-node-rpc.mjs`, `bench-plugin-reload.mjs`, `16-telemetry-probe.mts`, and all their
before artifacts remain unchanged. Their static imports cannot select an archive by changing the
working directory. The paired runners dynamically import every measured owner from
`ACORN_PERF_SOURCE_ROOT`. The after route workload calls the actual marked
`buildPluginRequestContext`, so it exercises production invocation ownership.

Before source is the untouched `git archive` of commit
`f8e4b59caadfe846a9e2c6491ac42b91ec3cf66f` at `/tmp/acorn-perf-original-f8e4b59c`.
All 165 `@acorn` workspace links resolve inside that archive. Its external pnpm dependency store is
shared with the implementation checkout. Both variants use Node 24.11.0 and the same workload.
The RPC probe uses two endpoints in one isolate. It performs no provider or network operation.
Five forced collections follow each sample, outside measured operation CPU and elapsed time.

The pre-abort observation changes from `{ requestAborted: false, explicitAborted: true }` to both
fields being true. The telemetry fixture anchors the API at its actual published init-context path,
uses the same visitor repeatedly, and calls `end` twice to verify its idempotent contract. These are
explicit acceptance adaptations. The original area-16 probe and result remain preserved.

Run the matched probes with distinct tags:

```sh
rtk proxy env ACORN_PERF_SOURCE_ROOT=/tmp/acorn-perf-original-f8e4b59c ACORN_PERF_TAG=before-unit02-final node --expose-gc --import tsx plans/performance/bench-node-rpc-paired.mjs
rtk proxy env ACORN_PERF_SOURCE_ROOT=. ACORN_PERF_TAG=after-unit02-final-reader node --expose-gc --import tsx plans/performance/bench-node-rpc-paired.mjs
rtk proxy env ACORN_PERF_SOURCE_ROOT=/tmp/acorn-perf-original-f8e4b59c ACORN_PERF_TAG=before-unit02-paired node --import tsx plans/performance/bench-plugin-reload-paired.mjs
rtk proxy env ACORN_PERF_SOURCE_ROOT=. ACORN_PERF_TAG=after-unit02-paired node --import tsx plans/performance/bench-plugin-reload-paired.mjs
```

The runners refuse to overwrite evidence. The commands above produced the linked artifacts; use
different tags for repeats. Intermediate RPC artifacts remain under `before-unit02-paired`,
`after-unit02-paired`, `after-unit02-paired-v2`, and `after-unit02-final`. The first after design sent
an additional release frame per argument scope. Reply ownership removes that ordinary frame. The
`final-reader` artifact records the reader with one cancellation race. That targeted change does
not establish a CPU improvement, and no further optional optimization was attempted.

## Retained heap and counts

The authoritative matched evidence is [before](./evidence/node-rpc-before-unit02-final.json) and
[after](./evidence/node-rpc-after-unit02-final-reader.json). Heap figures use decimal MB:

| Workload | Before heap at sample counts | After heap at sample counts | Final ownership result |
| --- | --- | --- | --- |
| Routes at 1,000, 11,000, and 21,000 calls | 25.003, 66.673, 108.590 MB | 21.968, 22.174, 22.339 MB | Zero completed host function exports, scopes, calls, signals, or body readers. Only three serving descriptor functions remain. |
| Bodies at 1,000, 5,000, and 10,000 calls | 21.177, 21.236, 21.018 MB | 22.410, 22.513, 22.139 MB | Owned call, scope, signal, and reader counts return to zero while endpoints stay open. |
| Spans at 1,000, 5,000, and 10,000 rounds | 22.269, 27.286, 33.444 MB | 22.284, 22.301, 22.310 MB | Six persistent telemetry functions remain. Closed spans, visitors, scopes, and calls retain no transport references. |

At 21,000 route calls, retained heap is 86,250,520 bytes lower, a 79.4% reduction. The before codec
encodes 84,000 request functions, and its realm map retains them. The after codec still encodes the
fresh request graphs, but their local exports and remote proxy caches retire. The weakly observed
principal remains reachable before endpoint close in the before fixture and is collected before
close in the after fixture.

At 10,000 span rounds, retained heap is 11,133,832 bytes lower, a 33.3% reduction. The body fixture
has a fixed final increase of 1,121,032 bytes, or 5.3%, with no measured growing reader/listener
retention. Route traffic remains 21,000 calls plus 21,000 results. Span traffic falls from 100,000
frames to 90,000 because the second `end` is local; the 10,000 resource releases remain explicit.

The coordinator's [independent after replay](./evidence/node-rpc-after-unit02-coordinator.json)
confirms the counts and plateau with the production owners. Its final route, body, and span heaps
are 22.700, 22.240, and 22.406 MB. The principal is collected, both abort observations are true,
and ordinary routes use 42,000 frames. Focused tests overlap that replay, so its CPU and elapsed
values are not used for timing comparison.

The repeated-reload evidence is [before](./evidence/plugin-reload-before-unit02-paired.json) and
[after](./evidence/plugin-reload-after-unit02-paired.json). The baseline worker count is one from the
tsx loader. Three rejected replay candidates increase the before count to two, three, and four.
Host disposal leaves four, and manual candidate cleanup restores one. Every after phase remains
at one, including host disposal and repeated manual candidate disposal. The separate lasting tests
exercise unknown, disabled, init, replay, ready, and successful paths with permissioned workers.

## CPU and elapsed trade-off

These totals sum the same fixture batches, excluding forced collection. A span round includes
`startSpan`, two `end` attempts, and `measure`:

| Workload | CPU before / after | Extra CPU per operation | Elapsed before / after | Extra elapsed per operation |
| --- | --- | --- | --- | --- |
| 21,000 routes | 1,184.228 / 1,516.237 ms, +28.0% | 332.009 ms total, 15.81 microseconds per route | 785.347 / 1,070.570 ms, +36.3% | 285.223 ms total, 13.58 microseconds per route |
| 10,000 bodies | 480.060 / 694.927 ms, +44.8% | 214.867 ms total, 21.49 microseconds per body | 342.186 / 486.439 ms, +42.2% | 144.253 ms total, 14.43 microseconds per body |
| 10,000 span rounds | 316.978 / 467.624 ms, +47.5% | 150.646 ms total, 15.06 microseconds per round | 266.980 / 353.714 ms, +32.5% | 86.733 ms total, 8.67 microseconds per round |

Explicit ownership, signal transport, and retirement bookkeeping add work in these tiny operations.
The acceptance benefit is bounded retained authority and heap, cancellation, and worker cleanup.
One paired run cannot establish a precise production throughput regression. It does show that this
implementation must not be described as an RPC CPU or latency optimization.

## Remaining gates and limits

The coordinator reviewed the changed owners, lifetime policy, reload cleanup, owning documents,
focused results, source selection, and paired evidence. The independent after replay confirms the
scope and listener counts. The unit is accepted for the removed retained authority and rejected
workers. The measured CPU overhead remains a disclosed cost; native responsiveness and cumulative
gates are still open.

The coordinator owns cumulative `pnpm lint`, bounded `pnpm test`, desktop staging, native UI/TUI
launches, and sustained use. This unit runs no paid provider, normal profile, or external messaging
workload. It rebuilds or stages no application assets and creates no branch or commit.

The same-isolate heap fixtures do not measure whole-process RSS, WebKit heap, native startup, or
navigation latency. The worker fixtures measure ownership and termination rather than a real
plugin's steady-state CPU. The dependency store is shared, so the archive is source provenance
without a separately frozen dependency installation.

Cancellation settles the caller and retires transport authority. It does not forcibly stop authored
handler work that ignores its signal. Generic returned callback graphs deliberately remain realm-owned,
and open spans remain resource-owned until `end`. No persisted plugin data, schema, credentials,
execution records, or caches are deleted to obtain these results.
