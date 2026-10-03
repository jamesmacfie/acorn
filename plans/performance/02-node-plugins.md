# Node plugin performance audit

Audit date: September 30, 2026. Reviewed commit: `f8e4b59c`. Status: read-only audit complete. No source changes, branches, commits, installations, builds, or changes to the shared `perf-baseline` session.

Loaded route traffic retains request-scoped remote procedure call (RPC) references until the worker closes. A controlled experiment retained about 40 MiB per 10,000 completed calls. Rejected reload candidates can also survive host disposal. Request cancellation disappears at the RPC boundary, so cooperative provider work continues after its caller cancels.

## Scope and architecture

The Node service owns authentication, plugin registration, provider credentials, capability resolution, and core storage. Each loaded node half runs in a separate permissioned `node:worker_threads` realm. `isolation.ts` exports an owner-bound context over one `MessagePort`. `nodePluginWorker.ts` imports the plugin in that realm and projects lifecycle functions back to the host. `pluginRpc.ts` replaces functions with opaque IDs and proxies, carries ordinary data with structured clone, and supports published synchronous calls with bounded shared reply buffers.

HTTP requests reach a registered fetch handler through `servePluginFetch`. Internal schedules, tools, context sections, task checks, hooks, and data-source invocations resolve the same handler through `dispatchPluginRoute`. Both construct a provider runtime bound to a principal and plugin owner. Provider credentials stay behind visitor callbacks, and connection-scoped data sources receive a narrower provider runtime. Responses then return through the Node API and broker to the client cache and UI. This audit covers the Node-to-worker portion of that flow.

Plugin SQLite work does not cross the port statement by statement. The worker opens its own exact database path through trusted `workerStorage.ts`, reuses one handle for its lifecycle, runs synchronous Drizzle operations in its own thread, and closes the handle during worker disposal. The host database and its encryption service do not cross the boundary.

The built bundled roster has eight packages: `agent-cost`, `database`, `findings`, `http`, `linear`, `model-providers`, `rollbar`, and `sentry-telemetry`. `agent-cost` has no node half. The seven node halves are relevant to repeated request, capability, and callback traffic. The activation document's four-package description predates the wider roster. This audit follows `apps/desktop/scripts/build-bundled-plugins.mjs:14` and actual callers.

Read the documentation index, architecture overview, conventions, plugin activation, the rung-2 and resource-abuse sections of the Node plugin security document, the future index, the ecosystem README and blockers, and the sandbox README and enterprise policy proposal. Read the `improve` playbook's performance section and finding format. The proposed fixes preserve per-plugin realms, permission grants, owner checks, storage ownership, and capability seams.

The sandbox documents above were retired on 2026-10-03 and remain in Git history. For implementation,
use `docs/security.md` for shipped containment and `docs/future/cloud/isolation.md` for proposed
worker isolation and team policy.

## Priorities

| ID | Finding | Impact | Effort | Fix risk | Confidence |
| --- | --- | --- | --- | --- | --- |
| NODE-PLUGIN-01 | Release transient RPC function references | Four retained host functions and four remote proxies per loaded route call. About 40 MiB retained per 10,000 calls in the controlled experiment. | M | MED | HIGH |
| NODE-PLUGIN-02 | Dispose every rejected reload candidate | One extra running plugin worker per registration-replay failure. Three rejected candidates survived host disposal. | S | LOW | HIGH |
| NODE-PLUGIN-03 | Propagate Request cancellation across the worker seam | A pre-aborted Request arrives un-aborted. Loaded Linear and Rollbar data-source reads lose the cancellation they use to stop provider work. | S-M | MED | HIGH |

Implement NODE-PLUGIN-02 first. NODE-PLUGIN-01 and NODE-PLUGIN-03 both change RPC ownership and should share cancellation and nested-callback characterization tests. Keep all fixes deferred until the complete performance audit has been reviewed.

## Findings

### [NODE-PLUGIN-01] Release transient RPC function references

- **Evidence**: `packages/node-core/src/server/plugins/pluginRpc.ts:100` allocates an ID for every function serialization. `pluginRpc.ts:279` does the same for synchronous serialization. Neither branch reuses the function's identity or records a call-scoped lifetime.
- **Evidence**: `packages/node-core/src/server/plugins/pluginRpc.ts:77` and `pluginRpc.ts:79` keep strong maps of local functions and remote proxies. `pluginRpc.ts:243` clears those maps only when the entire endpoint closes. Settling a call at `pluginRpc.ts:369` releases its abort listeners but no function references.
- **Evidence**: `packages/node-core/src/server/pluginHost/requestContext.ts:43` creates four provider methods per request. Those methods close over `env`, `principal`, `pluginId`, and connection scope. `pluginHost/fetchRoute.ts:26` and `pluginHost/dispatch.ts:90` pass this fresh context into every handler invocation.
- **Evidence**: `plugins/findings/src/node/index.ts:67` resolves `AGENTS_REVIEW_INPUT` on each completed turn. Its stable implementation has two methods at `plugins/agents/src/node/index.ts:217`. Re-encoding that implementation also creates distinct IDs. `plugins/sentry-telemetry/src/node/index.ts:44` creates a credential visitor on each delivery attempt. Linear and Rollbar data-source handlers create similar visitors.
- **Impact**: Successful ordinary calls permanently add references in both realms. A request context remains reachable even after the route returns and the application drops it. Transient credential visitors and repeated capability results extend the same growth mechanism. Repeated lookup of a stable function also creates avoidable proxy and registration allocations. This is independent of the shipped 4 MiB reply-buffer pool.
- **Effort**: M, about a day including ownership design and real-worker regression coverage.
- **Risk**: MED. Registration callbacks and disposal handles deliberately outlive the call that created them. Releasing every function on return would break event subscriptions, telemetry subscriptions, registered routes, capability implementations, and retained context services.
- **Confidence**: HIGH. Source ownership and a forced-GC experiment both confirm retention.
- **Fix sketch**: Add explicit lifetimes for request contexts and use-scoped visitors at the fetch and internal-dispatch boundaries. Release local references and remote proxies after the invocation and its nested callbacks finish, including failure and cancellation paths. Preserve registration ownership until its handle disposes or the realm closes. Reuse IDs for repeated serialization of a stable function where that lifetime is persistent, and make capability replacement resolve to the replacement implementation.

#### Measurement

The preserved [RPC benchmark](./bench-node-rpc.mjs) imports the actual `PluginRpcEndpoint` and actual `buildPluginRequestContext`. It connects two endpoints with a real `MessageChannel`, invokes a trivial asynchronous route with a `Request` and fresh provider context, consumes each complete response, and forces garbage collection between samples. The script counts every host function encoding through the public `encode` method. It also creates a weak reference to a request principal that the test itself drops. The coordinator independently reproduced the retention in [the baseline evidence](./evidence/node-rpc-before.json).

The endpoints share one V8 isolate in this experiment. This exposes the exact retention mechanism and counts both endpoint maps. It is not a measurement of a whole Node process with seven production workers, and its bytes-per-request slope must not be substituted for production RSS.

| Completed calls | Host function encodings | Heap after forced GC, bytes | Heap, MiB |
| --- | --- | --- | --- |
| 1,000 | 4,000 | 24,091,376 | 22.98 |
| 11,000 | 44,000 | 65,774,952 | 62.73 |
| 21,000 | 84,000 | 107,693,176 | 102.70 |
| After closing both endpoints | 84,000 total | 20,114,768 | 19.18 |

Each additional 10,000 calls adds about 40 MiB after GC, approximately 4.1 KB per call in this fixture. The sampled principal remains alive after every call settles and disappears after both endpoints close. The remote route descriptor has two functions throughout the experiment, so repeated route registration is not responsible for the measured slope.

Run the preserved script from the checkout root:

```sh
rtk proxy node --expose-gc --import tsx plans/performance/bench-node-rpc.mjs
```

For a production confirmation, instrument endpoint reference counts in an isolated fixture or capture heap snapshots around repeated requests to a loaded no-op route. Do not attach debug fields to the public plugin API. Separate persistent registration counts from in-flight invocation counts. After the fix, serial completed requests must return scoped counts to baseline and the post-GC heap must plateau. Assert that subscriptions still fire after the registration call returns, nested provider visitors finish before release, and reload can replace a capability without reusing stale proxies.

#### Compatibility and maintenance

The lifetime protocol belongs to the host and worker transport. It need not widen plugin permissions or change plugin-facing signatures. Keep the realm lifetime for the `ctx` exported during `init` and `ready`. Give `PluginRequestContext` an invocation lifetime. Functions returned as capabilities and registration handles need explicit ownership rather than a blanket promise-return rule. Keep disposal idempotent and reject invocation of a released request-scoped function clearly.

### [NODE-PLUGIN-02] Dispose every rejected reload candidate

- **Evidence**: `packages/node-core/src/server/pluginHost/host.ts:566` rejects a candidate for an unknown loaded owner or a disabled plugin without releasing the candidate supplied by the loader.
- **Evidence**: `packages/node-core/src/server/pluginHost/host.ts:657` catches registration replay failures, clears registrations, closes host-visible storage, forgets the plugin, and returns failure at line 675. It never calls `next.plugin.dispose()` or terminates the candidate realm.
- **Evidence**: `packages/node-core/src/server/plugins/isolation.ts:201` terminates the worker in the wrapper's `dispose` finally block. The host's final disposal at `pluginHost/host.ts:711` visits only `started`, which excludes a candidate rejected before its successful insertion at line 683.
- **Evidence**: `packages/node-core/src/server/plugins/reload.ts:38` disposes unrelated loaded candidates, but it delegates ownership of the selected candidate to `host.reload` and does not release it after a failed outcome.
- **Impact**: A malformed registration during the development reload loop leaves a worker, port, RPC maps, pooled buffers, and potentially a worker-owned SQLite connection or plugin timers alive. Repeating the failure adds one realm per attempt. Host disposal does not reach those realms. A disabled-plugin reload also creates an unused selected realm that has no final owner.
- **Effort**: S, hours including coverage of rejection stages.
- **Risk**: LOW. The candidate never becomes the serving instance on these paths. Cleanup must preserve the original rejection and must not dispose the preceding instance that is still serving after an init failure.
- **Confidence**: HIGH. The actual worker and host reproduced one additional worker per failed replay and retained all three after host disposal.
- **Fix sketch**: Make ownership transfer into `host.reload` explicit and release the candidate on every rejection path. After partial initialization, dispose its plugin lifecycle and close its realm and worker storage. Before initialization, use the unstarted-realm disposer. Revoke rejected candidate contexts and preserve the reported registration error if cleanup also fails.

#### Measurement

The [reload benchmark](./bench-plugin-reload.mjs) imports actual `isolateNodePlugin`, `initPlugins`, and `CapabilityRegistry`. It creates a temporary package under `/tmp`, starts each candidate in a real permissioned worker, and registers the same capability twice during buffered candidate initialization. Initialization succeeds. The duplicate becomes an error when the host replays its buffered registrations. The script counts `process.report.getReport().workers.length` without printing the report or its environment values.

| Stage | Worker count |
| --- | --- |
| Baseline | 1 |
| First rejected candidate | 2 |
| Second rejected candidate | 3 |
| Third rejected candidate | 4 |
| After host disposal | 4 |
| After explicit disposal of the three candidates | 1 |

The baseline worker belongs to the `tsx` loader. The three additional workers belong to rejected plugins. The experiment manually disposes them before removing its temporary files. The duplicate-capability fixture is the trigger for the worker leak, not a claim about a production plugin registering duplicate capabilities.

Run the preserved script from the checkout root:

```sh
rtk proxy node --import tsx plans/performance/bench-plugin-reload.mjs
```

Add real-worker lifecycle tests for disabled-owner rejection, candidate init rejection, registration replay rejection, ready rejection, and successful replacement. Verify that only the successfully committed realm remains, its route answers, the preceding realm still answers after a rejected init, and all plugin workers exit after host disposal. For a candidate that opens storage, verify that its WAL handle closes after failed replay. Keep schema rollback outside the promise, as the activation document specifies.

#### Compatibility and maintenance

This fix is internal lifecycle ownership and changes no manifest or plugin API. Preserve the candidate-then-commit sequence and fresh module graph. The future ecosystem split and rung-3 process isolation still need one clear candidate owner, so the cleanup contract must apply to any later realm adapter.

### [NODE-PLUGIN-03] Propagate Request cancellation across the worker seam

- **Evidence**: `packages/node-core/src/server/plugins/pluginRpc.ts:106` serializes URL, method, headers, and body for a `Request`, omitting its signal. `pluginRpc.ts:173` reconstructs a `Request` with a fresh un-aborted signal. The same endpoint already transports standalone `AbortSignal` arguments and releases their listeners.
- **Evidence**: `packages/node-core/src/server/pluginHost/dispatch.ts:85` correctly attaches the invocation's signal to the internal request. `packages/node-core/src/server/dataSources/dispatch.ts:50` races cancellation so the caller can stop waiting, but the signal never reaches a loaded handler.
- **Evidence**: `plugins/linear/src/server/data/issueSourceHandler.ts:13` checks the request signal and passes it to `readIssues` and `readIssueOptions` at line 21. `plugins/rollbar/src/server/data/errorSourceHandler.ts:13` and line 26 do the same. Their provider HTTP helpers combine this signal with their own request timeouts.
- **Evidence**: `packages/node-core/src/server/pluginHost/fetchRoute.ts:21` also omits `raw.signal` when constructing the forwarded HTTP request. That independent omission applies before RPC encoding.
- **Impact**: Cancellation and host data-source deadlines free the caller while cooperative plugin work continues. A paginated Linear or Rollbar read can keep issuing provider requests because its request signal never becomes aborted. Those abandoned calls still hold pending RPC state, contexts, and visitors until they complete or the realm closes. This adds sustained network, CPU, and memory work during repeated query cancellation.
- **Effort**: S-M, hours to a day including live abort propagation and cleanup tests.
- **Risk**: MED. Listeners must cover request-body encoding and response-body encoding, survive nested credential visitors, and release after completion. Avoid introducing a permanent subscription to every request signal.
- **Confidence**: HIGH. A pre-aborted request arrives with `request.signal.aborted === false`, while the same signal passed as a separate argument arrives with `aborted === true`.
- **Fix sketch**: Include a Request's signal in its wire representation using the endpoint's call-scoped signal mechanism, and restore it in the reconstructed Request. Forward `raw.signal` through `servePluginFetch`. Tie cancellation cleanup to the invocation lifetime introduced for NODE-PLUGIN-01, while preserving the deliberate host deadline race against an uncooperative handler.

#### Measurement and tests

The RPC measurement script sends a Request whose controller is already aborted and passes the same signal explicitly. The route returns:

```json
{"requestAborted":false,"explicitAborted":true}
```

This isolates the missing Request field from a general failure of the signal transport. `pluginRpc.test.ts` already tests abort propagation after an ordinary callback starts, but it passes a standalone signal. Plugin data-source tests exercise the handler directly and therefore do not cross the loaded worker boundary.

Add real-worker tests for pre-aborted Requests, aborts after a handler starts, successful completion without abort, and rejection during body encoding. Verify that a cooperative request stops after cancellation, does not request its next provider page, and leaves no signal or request-scoped function references after settling. Keep a separate test proving that a handler which ignores cancellation cannot hold the host caller beyond its budget.

#### Compatibility and maintenance

The Request wire record is an internal host-worker format. Both ends ship together. Preserve fetch-shaped handlers and public signatures. The fix strengthens the published cancellation behavior without broadening authority. It remains necessary if the worker later becomes a process under rung 3.

## Synchronous calls, serialization, storage, and residual limits

`hostCallModes.ts` explicitly classifies published synchronous registration, event, logging, telemetry, capability lookup, and read-shaped calls. Type checking refuses an unclassified host context method. `functionMode.ts` explicitly keeps codec methods and provider identity contracts synchronous while routes, lifecycle hooks, schedules, and capability implementations use promises.

A host-to-plugin synchronous call blocks the Node main thread in `Atomics.wait` until the worker answers. Nested port draining avoids a known deadlock and the five-second ceiling bounds a missing reply. A busy worker can therefore still stall Node route handling and heartbeat delivery during a synchronous codec call. No real production stall was measured in this pass. Replacing those signatures wholesale would require a contract migration with wider risk, so it is not a performance recommendation here. Prefer async shapes when adding APIs, as the security document requires.

Synchronous replies are bounded to 4 MiB and pool their buffers. Serialization happens before the size check at `pluginRpc.ts:355`, so that limit bounds the delivered reply, not every temporary allocation. Asynchronous Requests and Responses are fully buffered with `arrayBuffer`, cloned through the port, and copied by `bodyBuffer` during reconstruction. There is no transport-wide asynchronous size limit or streaming backpressure protocol.

Host data-source and manifest-tool output limits apply after the Response has crossed RPC. An oversized or endless loaded response can therefore consume worker resources before the host reader enforces its limit. This is an identified containment limit, not a measured honest-workload regression or a fourth recommended optimization. Carry the call's output budget into a future response transport design rather than adding an arbitrary global cap that breaks supported HTTP payloads. The HTTP plugin itself caps external response data at 5 MiB and cancels its upstream reader in `plugins/http/src/server/send.ts:334`.

The worker database adapter retains one connection and mirrors the host SQLite adapter. Construction failures close a handle before rethrowing. Disposal closes the worker handle after plugin cleanup. No unnecessary storage RPC, connection-per-query pattern, or source-evidenced storage performance fix was found. Database schema and provider query optimization belong to their separate audits.

## Shipped changes and rejected ideas

The September 25 changes are already present and must not be rediscovered as pending fixes:

- `d40f09dd`, concurrent loaded-worker startup. `loader.ts:467` starts packages together and folds outcomes back in directory order. Its commit records an M2 Pro graph-step median reduction from 358 ms to 113 ms, and listener-up from 562 ms to 358 ms. These are historical measurements against its seeded profile, not results of this audit.
- `66b545d0`, pooled synchronous reply buffers. `pluginRpc.ts:259` reuses an answered buffer. Its commit records held 4 MiB blocks falling from 97-113 to 10 and idle large-allocation growth becoming flat. It deliberately discards a timed-out buffer because the peer might still write to it.
- Asynchronous RPC dispatch runs concurrently at `pluginRpc.ts:315`, and synchronous calls are answered outside that queue. Reintroducing serialized call dispatch would restore the documented provider waterfall and deadlock.

Rejected approaches:

- Running loaded node halves in the host to avoid messaging. This removes the shipped permissioned realm boundary.
- Passing a host database, secret service, or live Hono instance to the worker. This violates storage, credential, and fetch-carrier contracts.
- Releasing all callbacks when their registration RPC returns. Findings' four event subscriptions and Sentry's telemetry subscription must outlive registration.
- Caching a capability forever in a consumer plugin. Capabilities resolve at call time so replacement and absence remain observable.
- Replacing workers with an unrestricted process or weakening file, network, native addon, or nested worker denial. Rung 3 is a separate containment proposal, not a shortcut for this performance work.
- Adding a policy resolver to every invocation. The enterprise proposal requires the unmanaged path to skip that resolver entirely.

`createPluginReloader` reuses the whole loader, and `loadExternalPlugins` ignores the retained `reimport` option. Reload therefore starts every installed node half and disposes unrelated candidates after import. This is a source-evidenced development-loop cost, not a boot serialization regression. No additional benchmark or priority finding was added after the three measured issues covered the key remaining risks.

## Verification and handoff

The controlling audit recorded a passing baseline for `pnpm lint` and bounded `pnpm test`. The complete test baseline completed 35 task groups, with 34 cached. This specialist ran the two isolated probes above and did not rerun the suite for a report-only change. The probes used Node 24.11.0 and installed dependencies. Heavy baseline test work had ended before they ran.

Run the focused suites after implementing these changes:

```sh
rtk proxy pnpm --filter @acorn/node-core exec vitest run src/server/plugins/pluginRpc.test.ts src/server/plugins/hostCallModes.test.ts src/server/plugins/loader.test.ts src/server/plugins/reload.test.ts src/server/pluginHost/host.test.ts src/server/dataSources/runtime.test.ts
rtk proxy pnpm lint
rtk proxy pnpm test
```

Extend the colocated RPC and reload tests with real-worker fixtures under `__fixtures__`. Keep the standalone probes for forced-GC and worker-count acceptance. The coordinator preserved the [reload benchmark](./bench-plugin-reload.mjs) and independently reproduced the leak in [the worker-count evidence](./evidence/plugin-reload-before.json). Run it with `rtk proxy node --import tsx plans/performance/bench-plugin-reload.mjs`.

For release acceptance, run an isolated `dev:agent` session and exercise repeated loaded-plugin requests and rejected reloads. Compare Node heap after GC, worker counts, plugin registration counts, event delivery, and provider cancellation. End the UI driver when finished. Do not infer visible-frame timing from the hidden or unfocused baseline renderer.

Not audited here: renderer and tree-worker performance, native dialogs, frame rendering, broker/client caching, model-provider SDK internals, real paid provider calls, core database indexes, plugin query plans, Postgres pools, HTTP command-variable security, installer supply-chain behavior, remote fleet throughput, or OS hostile-code resource isolation. No claims are made about those areas.
