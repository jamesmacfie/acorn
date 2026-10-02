# Telemetry retirement and histogram admission

Unit 28 fixes helper telemetry resurrection, stale collector preference answers, histogram capacity,
and ambiguous series identities. The pending handoff is deleted. The shipped contract is in
[Telemetry](../../docs/telemetry.md).

## Owners and data flow

The desktop helper reads the adopted Node's preference through its authenticated broker, uses the
Node collector in its own process, and posts encoded runtime batches back through the same broker.
The Node revalidates and scrubs records before sinks receive them. The client emitter aggregates
renderer and terminal workloads, then its poster sends those records to the Node. Telemetry uses
HTTP batches rather than broker invalidation, QueryClient persistence, or UI content caches.

Changes stay with those owners:

- `packages/custody/src/telemetry.ts` binds preference application, sinks, queues, footprint sampling,
  and final delivery to an adoption and consent owner.
- `packages/custody/src/telemetryRequests.ts` owns captured Node targets, unique request IDs,
  cancellation, and request deadlines. Aborts address only the admitted request ID.
- `packages/node-core/src/server/telemetry/collector.ts` joins preference reads and rejects answers
  after restart, stop, last-sink retirement, explicit consent updates, or reader-lease disposal.
- `packages/client-core/src/infra/telemetry/emitter.ts` and the Node collector enforce total
  histogram admission and discard pending diagnostics on consent-off.
- `packages/protocol/src/runtime/telemetry.ts` supplies the shared typed series fingerprint.
  Length-prefixed dimensions and sorted JSON label tuples preserve scalar types and separators.

There is no persisted-data migration or posted-record schema change. `startTelemetry` returns an
additive disposable preference-reader lease. Callers that ignore the return keep their behavior.
Disposing the lease detaches its reader without removing another sink or changing accepted consent.
Plugin telemetry verbs and returned span leases keep their contracts.

## Lifecycle and delivery policy

Adoption-triggered and collector-triggered preference reads join for the same live owner. The remote
answer precedes the helper's buffered tick flush. Off polling remains once a minute; on polling uses
the collector's five-second tick. Every adoption, including a restart with the same Node ID, and consent revocation cancel that owner's
requests and discard buffered work. Re-enable creates a distinct consent owner.

Each request captures its Node and has a 10-second deadline. A split post cannot retarget later
batches. Accepted batches commit individually; retries contain only failed and unattempted batches.
The held retry queue keeps at most 500 records. An ambiguous network failure can still cause a
retry of a batch that the Node accepted before its response was lost; there is no delivery receipt
or deduplication protocol in this unit.

Disposal flushes the final collector window, removes its sink and reader, and retires polling and
footprint sampling. It joins an admitted helper post, then attempts the final queued window once.
A five-second total deadline cancels outstanding owned requests. Failed final posts cannot restore
a queue. Repeated disposal is inert. Other subscribed collector owners continue working.

Shell crash files retain validation, unconditional deletion after reading, and best-effort
forwarding. The Node's redaction remains authoritative. Shell crash and renderer footprint posts
have no retry queue and can be cancelled at retirement.

## Histogram policy

Both emitters admit at most 200 series per flush window across names, owners, labels, and units.
An admitted hot series keeps exact count, sum, minimum, and maximum at capacity. A distinct series
is refused without label stripping or attribution to another operation. Node durations remain
milliseconds; client workload units stay independent. Percentiles keep the established 20,000
sample limit.

`telemetry.histogram.refused` is one fixed count metric, independent of histogram slots, record
drops, and attribute truncations. Its scalar count saturates at `Number.MAX_SAFE_INTEGER`.
Flushing resets admission capacity and the pending counter. Consent-off discards pending samples
and diagnostics. Client retry keeps a flushed refusal record with its original window, subject
to the independent record queue bound. Summary record counts are not sample totals.

## Paired evidence

The fresh baseline uses the production owners at the task's starting checkout. Historical area-16
probes and evidence remain unchanged. The helper baseline replays the original held-read fixture:
[before](./16-helper-telemetry-before-unit28.json) changes from no sinks after disposal to a live
`core` sink when the held answer resolves. The separate
[adapted replay](./unit28-helper-probe.test.ts) asserts retirement instead and records
[after](./unit28-helper-after.json): no sinks, no collection, and no posts.

The emitter runner and source hashes are in [the probe](./unit28-probe.mts),
[before](./unit28-before.json), and [final after](./unit28-after-adoption.json).
Intermediate measurements remain in [first after](./unit28-after.json) and
[second after](./unit28-after-final.json), and [reader-lease replay](./unit28-after-committed.json). Each runs the same supported workload and keeps its
source/probe hashes. [The final hash manifest](./unit28-hashes.json) also covers the request owner,
protocol fingerprint, tests, and probe configuration.

| Observation | Before | Final after |
| --- | --- | --- |
| Node distinct unlabelled names | 1,000 histograms, no refusals | 200 histograms, 800 refused samples |
| Client distinct unlabelled names | 1,000 histograms, no refusals | 200 histograms, 800 refused samples |
| Four legal label identities, each emitter | Two merged series | Four distinct series |
| Stable measured calls, each emitter | 100,000 admitted | 100,000 admitted |
| Node CPU for 100,000 measured calls | 52.404 ms | 52.799 ms |
| Client CPU for 100,000 measured calls | 64.490 ms | 62.465 ms |

CPU measurements include loop and JIT costs in one Node isolate. Other agents share the host.
The first after run costs 69.368 ms on Node and 77.449 ms on the client; the second costs 54.943 ms
and 64.355 ms. This variation does not establish a CPU improvement or a precise regression.
Typed labelled keys serialize tuples; there is no unbounded identity cache. The benefit proved here
is admission, attribution, and retirement correctness. No native latency or retained-heap claim
comes from these measurements.

## Verification

All commands use the repository's `rtk` prefix. Focused suites pass:

| Command | Result |
| --- | --- |
| `rtk proxy pnpm --filter @acorn/custody exec vitest run src/telemetry.test.ts src/telemetryLifecycle.test.ts --maxWorkers 1` | Two files, 23 tests pass. |
| `rtk proxy pnpm --filter @acorn/node-core exec vitest run src/server/telemetry src/server/routes/telemetry.test.ts --maxWorkers 1` | Six files, 74 tests pass. |
| `rtk proxy pnpm --filter @acorn/client-core exec vitest run src/infra/telemetry/emitter.test.ts src/infra/telemetry/queue.test.ts --maxWorkers 1` | Two files, 39 tests pass. |
| `rtk proxy pnpm --filter @acorn/protocol exec vitest run src/runtime/telemetry.test.ts --maxWorkers 1` | One file, 11 tests pass. |
| `rtk proxy pnpm --filter @acorn/plugin-sentry-telemetry exec vitest run --maxWorkers 1` | Ten files, 112 tests pass, including privacy and bounded retry. |
| `rtk proxy pnpm --filter @acorn/arch-tests exec vitest run docPaths.test.ts --maxWorkers 1` | One file, three tests pass. |
| `rtk git diff --check` | Passes. |
| `rtk proxy pnpm lint` | Oxlint and all 37 package tasks pass; inherited warnings remain. |

The regression tests cover held preference answers, A/B ordering, joined reads, remote revocation
before tick export, surviving sinks, prior-consent failures, repeated disposal, shutdown success
and failure, a hung final delivery, split-batch target binding, and partial-delivery retries.
Collector tests exercise initial and tick readers independently. Histogram tests cover unlabelled
names, labelled names, mixed owners and client units, exact admitted aggregates, reset at flush,
client retry, and consent transitions. The two label-stripping expectations are updated to the
explicit refusal contract.

Run the evidence commands from the repository root with unused tags:

```sh
rtk proxy env ACORN_PERF_TAG=before-unit28 packages/node-core/node_modules/.bin/vitest run --config plans/performance/16-node-probe.config.ts plans/performance/16-helper-telemetry-probe.test.ts --maxWorkers 1
rtk proxy env ACORN_PERF_TAG=after packages/node-core/node_modules/.bin/vitest run --config plans/performance/unit28-probe.config.ts
rtk proxy env ACORN_PERF_TAG=after-adoption node --import ./node_modules/.pnpm/tsx@4.22.4/node_modules/tsx/dist/loader.mjs plans/performance/unit28-probe.mts
```

The first baseline attempts used the package working directory and the tsx CLI. The package-relative
output path failed after reproducing resurrection; the CLI could not open its sandboxed IPC pipe.
The root-working-directory and Node import commands above produce the preserved evidence.
An initial lint run caught an inferred optional test attribute type; explicit `TelemetryAttrs[]`
annotations fix it. The corrected repository lint passes.

## Remaining limits

The host runs Node 24.11.0, below the repository's declared supported patch floor; pnpm reports
that engine warning. These focused results do not certify a supported release host. Disposable
fixtures use fake timers and a controlled broker, and settle their owners and temporary files.
No paid service, normal profile, private content, or live Sentry ingestion is involved.

This unit changes telemetry lifecycle and aggregation without changing UI layout. The coordinator's
native, two-Node, and sustained-use acceptance remain separate. Queue representation and opt-in
User Timing retention remain deferred. No instrumentation is removed to improve the fixture.
