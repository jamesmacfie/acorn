# Unit 11: agent queue, discovery, roster cursors, and daily usage

Date: October 2, 2026. Base commit: `b55caf78`.

## Ownership and compatibility

The Agents Node plugin owns durable queue admission, live provider generations, discovery, and
session roster storage. Workspace membership remains in CoreServices. The broker forwards the
opt-in without changing Node authority. The client sends continuation reads to its captured Node.

The compatibility proposal stated before editing adds `cursorFormat=tuple-v1`. Older clients retain
numeric timestamp responses. Clients requesting tuple cursors can continue with numeric responses
from older Nodes. Older Nodes retain their tie omission limitation. Tuple cursors encode the seek
values and survive deletion of their anchor. Roster reads are live, rather than a snapshot spanning
pages: concurrent edits can move rows across the cursor. Event sequence pagination is unchanged.

Queue admission belongs to the unit 10 live-session/process generation. No second startup or
reservation map owns that generation. The single serial pump reserves both ceilings before startup,
counts pending and active admissions, rechecks the durable head after asynchronous work, and releases
only its own reservation. Pending cancellation joins process retirement, including a late native
handle. Shutdown leaves undispatched durable turns queued. A startup failure records an error against
the accepted queued turn, without creating provider execution history or rejecting acceptance.
A failed session is attempted once per pump invocation. Explicit creation and configuration retain
their readiness contracts. Deferred heads, the dirty rescan, dynamic ceilings, and five-turn fairness
retain their behavior.

## Changes

- `runtime.ts` schedules durable enqueues and Codex plan continuations through the pump, and joins
  cancellation to the reserved live owner.
- `runtimeEngine.ts` owns admission on that generation and discovers providers by registry revision
  and wave identity. Forced calls each start a wave. Ordinary misses join the matching generation.
  Only the latest wave from an unchanged registry can cache descriptors. Stopped waves cannot cache.
- `drivers/registry.ts` advances its revision on registration, matching disposal, and nonempty clear.
- `sessions/store.ts` selects earliest queued ordinals and session rows in one statement. Migration
  `0011_agent_queue_heads.sql` appends a partial `(session_id, ordinal)` index for queued turns.
  The Drizzle schema, migration journal, and snapshot advance together. Applied SQL is unchanged.
- `shared/sessionList.ts`, the managed route capability, store, and captured-Node client implement
  bounded tuple opt-in and deterministic `(updatedAt DESC, id DESC)` ordering.
- `usage/claudeDailyUsage.ts` appends parsed records in a loop. The accepted file limit, partial line
  tolerance, cross-file last-winner deduplication, local days, model pricing, and skipped-file
  accounting retain their behavior. History caching and streaming aggregation remain deferred.

The owning contract is in [managed agents](../../docs/managed-agents.md).
The unit 11 handoff is deleted. The performance index points to unit 12, which is outside this change.

## Evidence and verification

[Pre-source and probe hashes](./evidence/unit11-pre-source.json) bind the fresh cumulative baseline
to unit 10. Frozen pre-probe text retains its assertions. The replay updates those assertions to
require two admitted starts and zero skipped compact files. It also adapts the historical fake
CoreServices from `root` to the production `requireRoot` contract. The pre10 audit's 20 discovery
calls are already reduced to one by preceding work, so this unit claims no additional ordinary-miss
count reduction. Its discovery gains protect registry and forced-wave identity.

| Synthetic workload | Fresh pre11 | Accepted production replay |
| --- | --- | --- |
| Empty queue, 100 idle sessions | 101 statements; median 13.591 ms | 1 statement; median 0.664 ms |
| Empty queue, 1,000 idle sessions | 1,001 statements; median 81.978 ms | 1 statement; median 0.561 ms |
| Empty queue, 5,000 idle sessions | 5,001 statements; median 408.019 ms | 1 statement; median 0.476 ms |
| 20 cold queued sessions, provider limit two | 20 starts, two active turns | Two starts, two active turns |
| 20 simultaneous ordinary discovery requests | One probe | One probe |
| Accepted 19 MB file, 200,000 compact records | One skipped file, zero sessions | Zero skipped files, one session, unknown model `x` retained |

The matched artifacts are [queue before](./11-runtime-pre11.json),
[queue after](./11-runtime-accepted11.json), [usage before](./11-daily-spread-pre11.json), and
[usage after](./11-daily-spread-accepted11.json). Both phases retain history mutation checks in their
`11-daily-*.json` artifacts. The selected grouped query's exact SQL and actual EXPLAIN plan are
captured in the after artifact. It scans the covering partial queued-head index, then seeks session
and turn rows through their existing unique indexes. The pre-index candidate EXPLAIN was inspected
before migration. No additional roster index is introduced.

The analyzer's compact-file wall time increases from 130.804 to 300.510 ms, and process CPU from
174.354 to 400.983 ms, because it includes the records it previously lost. Endpoint RSS changes
are -344,064 and +78,970,880 bytes, respectively. These samples do not measure retained heap or
peak memory. Intermediate `after11` artifacts are retained. The `final11` replay overlapped the
repository suite and is superseded for timing by the idle `accepted11` replay.

The isolated pre-source replay fails 11 regression cases for queue startup, cancellation, error
attribution, tuple reach, anchor deletion, and accepted usage. A separate fixed-clock replay fails
the same-millisecond forced-wave case. The fixed clock corrects Vitest's wait helper advancing the
fake Date between starts. See [pre regressions](./evidence/unit11-regressions-before.log) and
[forced-wave before](./evidence/unit11-discovery-before.log). Production gates cover public enqueue
acceptance during held startup, active/reserved counts, late handles, held workspace cancellation,
input edits, head reorder, deferred head selection, archive/controller filters, startup failure,
shutdown, replacement discovery, superseded force, diagnostic retry, and legacy client continuation.

Commands run through `rtk proxy` with bundled Node 24.21.0 at `/tmp/acorn-unit10-node24/node` and
`pnpm_config_verify_deps_before_run=false`. Turborepo commands use `--env-mode=loose` to preserve
that environment setting. Disposable tests invoke no provider or paid service.

- Baseline: `ACORN_PERF_TAG=pre11 pnpm --filter @acorn/plugin-agents exec vitest run --config ../../plans/performance/11-probe.config.ts` using the frozen pre-probes: three checks pass.
- Accepted replay: `ACORN_PERF_TAG=accepted11 pnpm --filter @acorn/plugin-agents exec vitest run --config ../../plans/performance/11-probe.config.ts`: three checks pass. [Replay log](./evidence/unit11-probe-accepted.log).
- Lifecycle and captured-Node gate: `pnpm --filter @acorn/plugin-agents exec vitest run src/server/sessions/runtimeQueue.test.ts src/client/sessions/managedClient.test.ts src/server/sessions/runtimeStartup.test.ts src/server/sessions/runtimeIdleStop.test.ts`: 32 checks pass. [Lifecycle log](./evidence/unit11-lifecycle-after.log).
- Discovery gate: `pnpm --filter @acorn/plugin-agents exec vitest run src/server/sessions/runtimeProviders.test.ts`: 10 checks pass. [Discovery log](./evidence/unit11-discovery-after.log).
- `pnpm --filter @acorn/arch-tests exec vitest run docPaths.test.ts`: all three documentation path checks pass. [Documentation log](./evidence/unit11-doc-paths.log).
- `pnpm lint --env-mode=loose`: 37 tasks pass. [Lint log](./evidence/unit11-lint.log).
- `pnpm db:check`: all 11 database chains replay, including all eight Agents migrations. [Migration log](./evidence/unit11-migrations.log).
- `pnpm exec drizzle-kit generate --config ./drizzle.config.ts` against a disposable copy of the Agents migration chain: no schema changes. [Schema comparison](./evidence/unit11-schema-diff.log).
- `pnpm test --env-mode=loose` under the sandbox: 31 of 37 tasks pass; process inspection and loopback listeners are refused. [Sandbox log](./evidence/unit11-suite-sandbox.log).
- The same bounded command with host access: 36 of 37 tasks pass. Agents has 1,023 passing checks and one skipped; Node has 280; client-core has 2,246; TUI has 661 and two skipped; architecture has 74. [Host suite log](./evidence/unit11-suite-host.log).

The remaining six failures are the unchanged desktop `rendererConnection.test.ts` fixtures reading
missing `helper.config.watch`. [The main-merge review](./merge-main-review.md) already records this
fixture/contract failure. The desktop boot and Rust stages remain blocked behind it. No unrelated
fixture repair is included in unit 11. An initial probe also exposed an ambiguous SQL aggregate
alias; the grouped head alias is unique and the production gates pass after that correction.

[Final source and probe hashes](./evidence/unit11-after-source.json) identify the shipped owners.
All probes use disposable databases and directories and clean them in `finally`. The isolated
pre-source and schema directories are retired before commit.

## Limits and costs

Provider counts use fake handles, rather than native provider memory. No real provider process,
paid invocation, normal profile, or external message is involved. Serial provider startup retains
its throughput limit. Explicit interactive creation can still start handles independently of queued
turn admission. The partial index adds storage and write maintenance for queued turns.

The daily analyzer still reads, parses, deduplicates, and aggregates every selected file. Correctly
including the compact file costs the corresponding CPU and memory; no history-cache saving is claimed.
No UI layout changes are included. Native process ownership remains the unit 10 contract, including
its Windows and detached-descendant limits. This unit does not establish sustained-use or native
visible-latency improvements.
