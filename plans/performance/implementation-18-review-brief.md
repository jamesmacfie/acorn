# Unit 18 coordinator review brief

Source review on October 1, 2026. Read report 13, docs/database.md, the data capability ownership,
and reviewed tree bridge/cancellation work. Start after preceding units pass coordinator review.
Return the pool/catalog lifecycle proposal before editing. Disposable real Postgres is a required
gate; this host has Homebrew PG 14 and 15 binaries, and no normal database is needed.

## Pool admission and retirement

`createDataSourceService.connect` awaits URL resolution before publishing any pending owner, then
creates and handshakes a Pool. Concurrent implicit readers therefore multiply pools, and disconnect
cannot retire a pending operation. Reserve task/generation ownership before the first await. Join
matching implicit readers; serialize explicit Connect refreshes with their fresh script/.env semantics.
Close rejected/replaced/retired candidates exactly once and prevent late publication. Captured old
readers must have an explicit drain/failure policy rather than receive a closed pool accidentally.
Independent tasks remain independent. Keep URLs/credentials Node-only, scoped core.data capability,
config trust, root confinement, environment fallback, pool max four, connection and statement timeouts,
read-only transaction enforcement, rollback, and release behavior.

Trace the Database plugin bridge too: its connected Set is updated only after connect completes,
and dispose disconnects only tasks already in that Set. A held connect can survive bridge retirement
and recreate explicit pane connection state. Own pending bridge operations and their generation;
do not let late cleanup disconnect an unrelated replacement or another granted core.data consumer.
Describe shared per-task pool versus plugin connection authority and explicit Disconnect semantics
before adding lease/refcount behavior. Do not hide a driver connection behind an unrevoked tree slot
to preserve module reuse. Preserve headless core.data users independently of whether a pane is drawn.

## Catalog waves and SQL equivalence

`liveSchema` reads tables once, then columns and PKs for every table. Replace that N+1 catalog shape
with a bounded statement count, and join matching catalog misses by pool/schema generation. A DDL
invalidation, disconnect, or refresh must fence a held wave before it publishes. Old finally cleanup
cannot clear a replacement wave. Preserve explicit connection behavior and existing cache freshness
policy; do not introduce a longer TTL as a substitute for generation checks.

Combined SQL must return exactly the existing visibility and data shapes: BASE TABLE filtering,
schema/table order, column ordinal order, nullable values, information_schema data_type representation,
quoted schema/table/column names, composite PK membership, empty tables/columns where supported,
and permission-limited roles. Broad pg_catalog queries must not accidentally expose objects omitted
by information_schema. Use bound values or trusted fixed SQL; keep SQL construction in its owner.
Prove equivalence through actual PG 14/15 before accepting mocked statement-count gains. Verify
table/column rename/add/drop and failed catalog retry, not just cold empty schemas.

## Returned-row normalization

The driver result currently normalizes every row/cell before slicing to maxRows. Apply the cap before
cell conversion while preserving fields, command, rowCount, truncated, ms, and exact returned cells.
Cover strings, null/undefined, booleans, numbers, Date, JSON objects, Unicode, parameter binding,
multi-statement last-result selection, and row caps. This removes conversion of discarded rows; it
does not bound PG's production/buffering of the original result. Driver streaming/cursor execution
is unselected and would need distinct transaction/protocol proof. Do not claim a driver memory bound
from reduced JavaScript conversion alone.

## Evidence

Capture fresh cumulative pre-unit-18 owner artifacts. Twenty concurrent cold queries create one
matching pool, disconnect/failed handshake leave zero candidates, and held connect/catalog/dispose
cannot republish. Count actual catalog statements across eight readers and 100 tables. Use a
synthetic 250,000-cell driver result to count conversion only for the accepted rows and measure CPU
and transient allocation separately. Then initialize disposable /tmp PG clusters with owned loopback
ports, create only synthetic data/roles, run the actual service/SQL/transaction paths, inspect sessions
and close behavior, stop through pg_ctl, and verify every owned PID/socket is gone. No installed
normal PG service, private connection URL, external DB, or paid model is required. Keep credentials
out of evidence and distinguish fake pool counts from actual backend connections/resources.
