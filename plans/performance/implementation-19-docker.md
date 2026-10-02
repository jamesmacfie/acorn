# Docker performance implementation

Date: October 2, 2026. Unit 19 is implemented. Native verification remains blocked by the service bundle size gate.

## Owners and changes

The Docker plugin owns daemon discovery, fixed-argument CLI children, and shared log/stats producers on the Node. Its routes cross the authenticated broker into disposable client signals and pane resources. No database, migration, persisted cache, protocol, capability, or broker contract changes.

- `plugins/docker/src/server/dockerService.ts` joins cold health readers, fences invalidated inventory waves, retires failed children once, drains normal output until stdio close, and cancels watcher retry/publication on disposal. Intentional stream stop suppresses end callbacks. The 32-child budget, CLI arguments, filtered environment, health taxonomy, TTLs, debounce, and bounded backoff remain in place.
- `plugins/docker/src/server/dockerBridge.ts` skips matcher reads after authoritative tasks and an empty inventory succeed. Nonempty matching retains its config freshness and order. Bounded config fanout was not selected.
- `plugins/docker/src/shared/logTail.ts` owns bounded UTF-16 blocks and cached projection for the client display tail and Node replay. The client publishes reactive updates every 50 ms and immediately on clear/end. Hidden same-Node streams continue; two views share a buffer and the eight-buffer LRU remains.
- `plugins/docker/src/client/dockerScope.ts` captures Node selection generations. Streams, exec sessions, inventory, task summaries, detached task roots, view selection, actions, and palette results follow this ownership. Cleanup sends to the origin Node without reacquiring its interest. Stale completions cannot refresh incoming documents or focus incoming terminals. Failed reads preserve established data. Plugin activation returns refresh/stream cleanup through the host lifecycle.

The shipped contract is documented in [Docker](../../docs/docker.md). The unit handoff is removed, and the programme points here.

## Evidence

Baseline hashes are in [unit19-before-hashes.json](./unit19-before-hashes.json). Captured baseline service and store source under `evidence/` change only relative import destinations to run beside production. Historical area 13 probes and results are preserved.

| Workload | Before | After |
| --- | --- | --- |
| Sixteen cold health readers | 16 CLI calls | 1 CLI call |
| Sixteen cold inventory readers | 1 CLI call | 1 CLI call |
| Empty inventory with 300 tasks | 1 home-config read | 0 matcher reads |
| 32 actual missing-binary children | 32 retained, 0 ends | 0 retained, 32 ends |
| Healthy CLI fixture after those failures | Refused by exhausted budget | Output delivered, end delivered |
| A stream after selecting B with the same container ID | Replayed on B, consumed B output, detached B | Ends on retirement, detaches A, no B replay or delivery |
| Eight prefilled tails, 24,000 small chunks, hidden | 1,872.849 ms CPU | 15.628 ms CPU |
| Same workload with reactive consumer reads | 1,746.544 ms CPU, 24,008 projections | 126.995 ms CPU, 808 projections |
| Retained display text | 4,194,304 UTF-16 units | 4,194,304 UTF-16 units |

The fresh baseline discovery result is [13-docker-unit19-cumulative-before.json](./13-docker-unit19-cumulative-before.json), and its scope result is [13-docker-scope-unit19-cumulative-before.json](./13-docker-scope-unit19-cumulative-before.json). The historical empty-summary assertion expected 301 reads and failed because safer config reads had already removed 300 repository reads. The recorded one-read result is the matched cumulative baseline.

Paired source-capture evidence:

- [Before spawn](./unit19-spawn-node26-final-before.json) and [after spawn](./unit19-spawn-node26-final-after.json).
- [Before tails](./unit19-logs-node26-before.json) and [after tails](./unit19-logs-node26-after.json).
- [After discovery](./unit19-discovery-node26-after.json) and [after scope](./unit19-scope-node26-after.json).
- [Backing segment bound](./unit19-segments-node26-after.json).

The log probe uses one Solid browser runtime, fake 50-ms time steps, and mocked stream transport. It runs the production store with hidden ingestion and reactive consumers. CPU includes fixture work and excludes DOM, native layout, and painting. Projection counts represent consumer accessor evaluations. Backing block counts are inspected separately from retained text. Initial spawn probes use a fixed 100-ms wait and can fail before the healthy child closes. Diagnostic output records a still-tracked child without a spawn error. The probe waits for actual child close and producer end instead. The missing-binary workload and admission assertions are unchanged. Historical Node 24 results retain the fixed-wait probe provenance. The supported Node 26 replay uses the same tail/chunk workload. Paired log CPU values above are from Node 26.8.1.

## Verification

Commands use the repository's `rtk` prefix. Initial commands used Node v24.11.0, below the declared security floor. Final Docker tests, types, hub suites, and paired log/spawn probes use supported Node v26.8.1. The installed runtime is selected with `PATH=/Users/jamesmacfie/.nvm/versions/node/v26.8.1/bin:$PATH`. No shared native dependency rebuild is needed.

```sh
rtk pnpm --filter @acorn/plugin-docker lint
rtk pnpm --filter @acorn/plugin-docker test
rtk proxy env ACORN_PERF_TAG=unit19-cumulative-before pnpm exec vitest run --config plans/performance/13-node-probe.config.ts plans/performance/13-docker-probe.test.ts
rtk proxy env ACORN_PERF_TAG=unit19-cumulative-before pnpm exec vitest run --config plans/performance/13-renderer-probe.config.ts plans/performance/13-log-probe.test.tsx plans/performance/13-docker-scope-probe.test.tsx
rtk proxy env ACORN_PERF_TAG=unit19-before pnpm exec vitest run --config plans/performance/unit19-node-probe.config.ts plans/performance/unit19-spawn-probe.test.ts
rtk proxy env ACORN_PERF_TAG=unit19-before pnpm exec vitest run --config plans/performance/unit19-renderer-probe.config.ts plans/performance/unit19-log-probe.test.tsx
rtk proxy env ACORN_PERF_TAG=unit19-after pnpm exec vitest run --config plans/performance/unit19-node-probe.config.ts plans/performance/unit19-discovery-probe.test.ts
rtk proxy env ACORN_PERF_TAG=node26-after pnpm exec vitest run --config plans/performance/unit19-node-probe.config.ts plans/performance/unit19-spawn-probe.test.ts
rtk proxy env ACORN_PERF_TAG=unit19-after pnpm exec vitest run --config plans/performance/unit19-renderer-probe.config.ts
rtk proxy pnpm lint
rtk proxy pnpm test --filter=@acorn/plugin-docker --filter=@acorn/custody --filter=@acorn/arch-tests
rtk proxy pnpm dev:agent -- --session perf-docker-19
rtk proxy pnpm dev:agent:ui -- --session perf-docker-19 stop
```

Docker types and focused tests pass. Owner regressions cover held health/discovery, watcher error/late close, disposal, real ENOENT through SharedDockerStreams, healthy subsequent admission, surviving viewers, A/B/A summaries, failed observations, post-mutation inventory waves, held actions/focus, exact UTF-16 tails, clear, end/reopen, LRU, and Node partitioned view eviction.

Final outcomes:

- Docker suite: 112 tests pass in 19 files on Node 26.8.1. Docker TypeScript passes.
- Custody suite through bounded `pnpm test`: 167 tests pass in 15 files.
- WebSocket hub and security: 46 tests pass in two files on Node 26.8.1 with disposable loopback listener permission. The command is `pnpm --filter @acorn/node-core exec vitest run src/server/transport/wsHub.test.ts src/server/transport/wsHubSecurity.test.ts --maxWorkers=2`.
- Documentation paths: three tests pass using `pnpm --filter @acorn/arch-tests test docPaths.test.ts`.
- Final supported-runtime Node probes: all three tests pass together after fixing the fixture completion wait. Before spawn probe: one test passes. Renderer probes: four tests pass. Before log probes: three tests pass. Before spawn: one test passes.
- `pnpm lint` runs oxlint, then stops in concurrent work at `packages/client-core/src/kit/components/layout/Rows.test.tsx:163`, where an `afterEach` callback returns `VitestUtils`. An earlier run stops on concurrent editor/TUI exports. These files are outside this commit.
- The bounded three-package test run passes Docker and custody but initially fails architecture on concurrent `plugins/editor/src/server/searchProcess.ts` child-process admission. Its first doc-path failure is a temporary link to this report while it was being written; the completed report passes the dedicated doc-path rerun.
- An attempted hub command with `test --` unexpectedly runs the unfiltered Node-core suite. It encounters runtime-floor and sandbox listener failures and is interrupted. The explicit `exec vitest run` command above passes with Node 26 and listener permission. This failed broad attempt does not establish repository-wide test health.
- `git diff --check` passes.

[Final source and probe hashes](./unit19-after-hashes.json) identify the delivered owners. [Verification output](./unit19-verification.txt) preserves the failures and final focused results. Earlier Node 24 artifacts remain available with their original tags.

## Costs and remaining verification

Block storage bounds retained backing text to the tail plus one block; cached projected text can retain an additional tail per buffer. Small blocks are copied to avoid retaining huge source chunks. Visible reactive publication can lag ingestion by up to 50 ms, plus event-loop scheduling delay. Explicit accessor reads return the latest ingested tail. Whole-log DOM virtualization and visibility policy were not selected.

The Tauri launcher failed before starting its window because its static service graph was 3,076,666 bytes against a 3,062,000-byte ceiling. Stop reported that the session was not running. No screenshot, native log/stats/terminal transition, visible latency, real daemon cadence, authenticated two-Node native composition, or sustained-use claim is made. Disposable CLI fixtures and their directories are retired. Other agents' changes remain outside this unit's commit.
