# Sustained-use validation record

October 2, 2026. Preparation is recorded against a concurrently edited branch. Final sustained-use
acceptance remains open. The unit 29 handoff is deleted at the user's request; the complete workload
remains in [the sustained validation plan](./sustained-validation-plan.md).

## Ownership and admission

The full gate covers the composed desktop, helper, independent Nodes, shared client cache,
loaded plugin owners, and terminal host. It does not change application behavior or content budgets.
The Node API, protocol, broker, selected cache partition, and UI must retain their originating Node
through navigation and delayed completion. A fixture cannot substitute synthetic seam timings for
actual target content readiness.

Final acceptance requires reviewed units 09–28, freshly staged artifacts, exclusive measurements,
two authenticated disposable Nodes, and confirmed native and document focus. Units 22, 23, 26, 27,
and 28 lack implementation records at the preparation snapshot. Other agents are editing source
in this branch. Existing native launch records also report a failing service bundle budget. These
are admission failures, so no mixed-use sample or latency comparison is accepted.

## Reproduce preparation

Run `rtk proxy node plans/performance/unit29-preparation.mjs TAG` with a unique tag on a supported
Node runtime. The script runs `pnpm lint --force`, bounded `pnpm test --force`, the Node service
build, and the TUI build sequentially. The force flag avoids accepting cache hits from another
runtime. It captures source and build hashes before and after, command exit codes,
elapsed intervals, log hashes, and source changes. It refuses an occupied evidence directory.
It records zero workload cycles and unobserved focus explicitly. Build files present on disk do
not establish successful staging or the identity of a running app.

The [first command and result index](./evidence/unit29-cumulative-20261002/results.json) uses the
shell's Node 24.11.0, below the repository's runtime floor, and cannot supply runtime acceptance.
Lint passes 37 package tasks, but tests fail in seven package tasks. Preserve this attempt as a
failed setup record. Its original script snapshot remains beside the evidence.

The [pinned-runtime command and result index](./evidence/unit29-pinned-20261002/results.json) uses
the bundled Node 24.21.0 through a temporary executable symlink in `/tmp/acorn-unit29-runtime`.
Both Turborepo commands bypass cache hits. Eight source files change during the run, so even
passing package results are observations of that run rather than a final immutable-source gate.

| Pinned-runtime command | Result |
| --- | --- |
| `pnpm lint --force` | Fails on `collector.test.ts:288`, where a union with optional undefined attributes does not satisfy the telemetry attribute contract. Ten tasks pass before the failure stops dependents. |
| `pnpm test --force` | 32 of 37 package tasks pass. Plugin API facade snapshot, unclassified project worktree route, telemetry histogram expectation, desktop staging, and three TUI editor assertions fail. |
| `pnpm --filter @acorn/node build` | Fails at 3,094,961 bytes against the 3,062,000-byte service ceiling. |
| `pnpm --filter @acorn/tui build` | Fails at 1,197,556 eager bytes against the 1,175,000-byte startup ceiling. |

The TUI's captured cells show `! editor window.addEventListener is not a function`; the `$EDITOR`
offer does not appear. These are actual terminal-host functional failures, not terminal emulator
latency measurements. The unclassified route is `projectWorktreesRoute` at
`/v1/core/projects/x/worktrees`. The snapshot and telemetry expectations overlap concurrent work;
the logs retain their exact failures without updating another agent's source or assertions.

[CLI checks](./evidence/unit29-cli-checks.json) prove that the preparation runner rejects an
unsupported runtime before creating evidence and refuses to overwrite an occupied directory.
The runner pins test concurrency to six package tasks and three workers, records its own snapshot
and runtime executable hash, and distinguishes failed, unstable, and recorded preparation.

The [disposable session inventory](./evidence/unit29-sessions.json) checks only session names,
statuses, and launcher/app liveness. All 17 recorded launchers are absent. No fixture window,
Node, PostgreSQL cluster, HTTP server, preview, Shell, or provider is launched by this validation
outside repository test fixtures. Native focus activation, screenshots, actual PTY navigation,
and final process/port measurements are skipped because fresh build admission fails. No stale
app is used to substitute for the failed final artifact.

[Separate desktop checks](./evidence/unit29-desktop-checks.json) run on the pinned runtime after
repository preparation. Desktop JavaScript tests excluding boot pass 149 tests and fail six
renderer-connection tests because the fixture supplies no document `watch` capability. Rust passes
all 62 tests. The documentation and boundary run passes 58 tests and fails one on a concurrent
unit 22 index link whose implementation record is absent at that instant. These failures remain
in the evidence. The staged desktop boot test cannot run after failed service admission.

## Remaining acceptance

Follow the retained plan after the implementation review and staging prerequisites pass. Warm a
fixed visited set, perform 200 mixed cycles, and take equivalent settled samples at warmup, 10,
50, 100, and 200. Record identical active owners and idle, grace, and persistence windows. Run the
separate expanding visited-set case, adverse owner transitions, real PostgreSQL checks, and actual
two-Node terminal composition. Verify exact drafts, acknowledgements, offline content, and durable
terminals on return. Inspect screenshots and captured cells.

Use the separate focus automation bundle and record native and document visibility and focus at
every transition and sample. Focus loss disqualifies visible latency; empty plugin placeholders
cannot count as completed navigation. Attribute processes precisely and report omitted WebKit
processes. Record CPU deltas separately from elapsed time, residency separately from live heap,
and production-owner counters separately from DOM sizes. Stop owned fixtures and prove their PIDs
and ports are gone. A bounded successful run still cannot establish several days of active use.

## Recorded improvements and costs

These accepted unit comparisons retain their original workloads and source identities. Preparation
does not replay them or establish that their gains add up to an application speedup.

| Accepted owner workload | Recorded improvement | Cost or limit |
| --- | --- | --- |
| Seven-client cold custody, median five processes | 96.91 ms to 36.19 ms; 14 metadata fsyncs to two | Public-operation timing, not first paint. [Startup record](./implementation-01-startup.md). |
| 21,000 loaded RPC calls, forced-GC retained heap | 108.590 MB to 22.339 MB | CPU increases from 1,184.228 ms to 1,516.237 ms. [Plugin owner record](./implementation-02-node-plugins.md). |
| 3,000-query cache burst | 3,032 full captures to one; CPU 1,791.524 ms to 137.997 ms | First dirty capture waits up to five seconds; abrupt loss can omit that interval. [Cache record](./implementation-04-cache.md). |
| Terminal ring, saturated eight-byte chunks | Retained heap 3,730,424 bytes to 82,192 bytes; overflow CPU 106.087 ms to 2.233 ms | Initial fill and ordinary chunks cost more; terminal attachment latency is unproven. [Terminal record](./implementation-07-terminals.md). |

[Accepted performance results](./implementation-results.md) and each unit's record own the remaining
comparisons and conditional findings. This preparation makes no native latency, resource plateau,
or multi-day stability claim.
