# Database performance implementation record

October 2, 2026. Unit 18 implemented from the merged production owners at `4b8a611a`.
The user explicitly requested this unit, deletion of its handoff, and a commit while other agents
work in the same branch. No branch or subagent was created. Unit sequencing in the historical
handoff does not establish acceptance of other units.

## Ownership and compatibility

Node owns URL resolution, trust, the PostgreSQL driver, task pools, transactions, and catalog SQL.
The loaded Database plugin calls its permission-scoped `core.data` projection from its Node bridge.
Its routes return serializable results through the broker to the loaded pane and host completions.
No URL, socket, driver, persisted data, migration, renderer protocol, or tree-slot authority changes.
No renderer code changes in this unit.

The lifecycle proposal presented before implementation was one pool per task, one revocable claim
per granted data service, serialized explicit source refreshes, and draining of admitted readers.
Core's unscoped disconnect administratively retires every task claim. A scoped disconnect releases
only that consumer. Plugin disposal also releases pending claims. Headless consumers can retain a
pool independently of pane presence. A surviving claim keeps a shared opening alive, while the
retired caller fails its own admission check. The drain policy matches [node-postgres pool shutdown](https://node-postgres.com/apis/pool). A successful explicit refresh replaces the shared pool;
a failed refresh preserves the healthy pool. Retired catalogs fail instead of publishing stale data.

## Changed owners

- `packages/node-core/src/server/core/data.ts`: applies the row cap before cell conversion, composes
  consumer services, and fences automatic schema connection after asynchronous config resolution.
- `packages/node-core/src/server/core/dataPools.ts`: reserves ownership before any await, joins
  implicit readers, serializes explicit refreshes, tracks pending candidates, closes each candidate
  once, and drains admitted operations before ending a retired pool.
- `packages/node-core/src/server/core/dataCatalog.ts`: executes one fixed catalog statement using
  information-schema visibility and the original primary-key membership semantics. [PostgreSQL table visibility](https://www.postgresql.org/docs/14/infoschema-tables.html) defines the permission filter. Shares waves by
  entry and schema generation, fences invalidation, and clears only the wave that owns the slot.
- `plugins/database/src/server/database.ts`: owns pending task operations and bridge generations,
  clears explicit state before teardown, and makes disposal idempotent. Late cleanup never calls
  disconnect against a replacement bridge. Row and write operations recheck their captured bridge
  generation after catalog resolution, before admitting SQL, so retirement cannot reacquire a claim.
- Colocated service and bridge tests cover retirement, replacement, errors, draining, shared
  consumers, row conversion, query rollback, source refreshes, and catalog retry.
- `docs/database.md` owns the shipped lifecycle, catalog freshness, and result-cap behavior.
- The unit handoff is deleted and its programme row links to this implementation record.

## Paired evidence

The immutable fresh baseline is `13-data-unit18-before.json`, captured with the original probe
before editing. `unit18-before-hashes.json` preserves source and probe hashes. The original audit
artifacts and probe are unchanged. `18-data-probe.test.ts` adapts the fixture's catalog rows and
fail-before expectations to the production owner, and writes `18-data-unit18-after.json`.

| Mock-driver workload through the actual service | Before | After |
| --- | ---: | ---: |
| Pools created for 20 concurrent cold queries | 20 | 1 |
| Pools alive after disconnect | 19 | 0 |
| Pools alive after held handshake completes following disconnect | 1 | 0 |
| Statements for eight readers and 100 catalog tables | 1,608 | 1 |
| Cells converted from a 250,000-cell driver result, 200 returned | 250,000 | 200 |
| Conversion workload elapsed time | 43.779 ms | 0.195 ms |
| Conversion workload process CPU | 68.245 ms | 0.244 ms |
| Sampled conversion heap delta | 31,535,048 bytes | 72,848 bytes |

Both mock measurements use Node 24.11.0. Driver allocation occurs before timing. Heap deltas measure
sampled transient allocation, not retained memory. Mock pools own no socket and do not enforce four
clients. These counts do not establish desktop latency or a PostgreSQL memory bound.

`18-postgres-probe.test.ts` initializes disposable PostgreSQL 14 and 15 clusters with synthetic roles
and tables on owned loopback ports. It compares the production catalog against the preserved
pre-unit SQL, including quoted and Unicode identifiers, composite keys, zero-column tables, enum,
array and domain types, views, hidden tables, and column-only grants. It tests permission-error
catalog retry, table and column rename/add/drop, a concurrent drop, bound values, cell types,
multi-statement final results, row caps, read-only enforcement through a writing function, statement
timeout, SQL-error rollback, committed writes, shared consumers, actual sessions, and draining.

| Real PostgreSQL workload | PG 14 | PG 15 |
| --- | ---: | ---: |
| Original SQL statements, eight readers and 100 tables | 1,608 | 1,608 |
| Production statements, same catalog | 1 | 1 |
| Original SQL elapsed time | 265.600 ms | 202.095 ms |
| Production catalog elapsed time | 9.571 ms | 7.955 ms |
| Actual backend connections for 20 cold queries | 4 | 4 |
| Actual backend connections after disconnect/drain | 0 | 0 |

Real timings include `log_statement=all` and local cluster execution. They compare the original SQL
with the production owner, and are single runs, not statistical latency estimates. Backend counts
include only client backends and exclude the observer pools. The first session-count fixture
mistakenly included PostgreSQL's logical replication launcher. The failed evidence is retained in
`18-postgres-14-failed-background-count.json` and `18-postgres-15-failed-background-count.json`.
An earlier fixture SQL quoting failure was corrected before accepting equivalence.

`18-postgres-14-after.json` and `18-postgres-15-after.json` report successful acceptance and cleanup.
Each cluster stops through `pg_ctl`; the owned postmaster PID, Unix socket, and PID file are absent.
The temporary cluster directories are removed, and no normal PostgreSQL service is inspected.

## Verification commands and outcomes

All shell commands use `rtk`. Commands below show the underlying invocation for readability.

- `ACORN_PERF_TAG=unit18-before pnpm --filter @acorn/node-core exec vitest run --config ../../plans/performance/13-node-probe.config.ts plans/performance/13-data-probe.test.ts`: four baseline probes pass their fail-before expectations.
- `ACORN_PERF_TAG=unit18-after pnpm --filter @acorn/node-core exec vitest run --config ../../plans/performance/18-node-probe.config.ts plans/performance/18-data-probe.test.ts`: four after probes pass.
- `pnpm --filter @acorn/node-core exec vitest run --config ../../plans/performance/18-node-probe.config.ts plans/performance/18-postgres-probe.test.ts`: both PostgreSQL gates pass. Sandbox escalation permits the disposable loopback listeners.
- `pnpm --filter @acorn/node-core exec vitest run src/server/core/dataLifecycle.test.ts src/server/core/data.test.ts src/server/plugins/permissions.test.ts`: 46 tests pass.
- `pnpm --filter @acorn/plugin-database test`: 95 tests pass in 10 files.
- `pnpm --filter @acorn/node-core lint` and `pnpm --filter @acorn/plugin-database lint`: both TypeScript checks pass.
- `pnpm lint`: stops in oxlint on another agent's unused `desc` and `sql` imports in
  `plugins/agents/src/server/sessions/sessionRepository.ts`. The full output is `unit18-lint.txt`.
  Those edits are outside this commit.
- The loaded-plugin integration test first runs under default Node 24.11.0 and correctly fails
  the project's patched-runtime security gate. The following rerun with installed Node 26.8.1
  passes its one test: `/Users/jamesmacfie/.nvm/versions/node/v26.8.1/bin/node node_modules/vitest/vitest.mjs run test/integration/plugins/databaseLoaded.test.ts`, from `apps/node`.
- `pnpm --filter @acorn/arch-tests exec vitest run docPaths.test.ts boundaries.test.ts`: 59 tests pass.
- `git diff --check`: passes.

## Costs and limits

The shared pool retains one claim per participating capability consumer until disconnect. A refresh
can overlap a replacement pool with a retiring pool while admitted readers finish; each individual
pool keeps its four-client limit. A caller waiting on a retired admission receives a retryable error.
A disconnect can settle before admitted operations drain; the last operation closes its retired pool.
A hung driver or catalog call still depends on driver/database timeouts. Repository helper processes
retain their existing deadline; this work fences their late results and does not add process abort.

The returned-row cap bounds conversion work only. The driver still produces and buffers the complete
SQL result. The catalog has no TTL; DDL outside this service needs explicit Connect to refresh it.
No SQL cursor, streaming driver, scratch-document recovery, broader pool budget, native UI timing,
whole-programme completion, or sustained-use acceptance is claimed.
