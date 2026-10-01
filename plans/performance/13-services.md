# Area 13: preview, Docker, Database, and HTTP services

## Scope and conclusion

Audited baseline `f8e4b59caadfe846a9e2c6491ac42b91ec3cf66f` on 2026-10-01. Application source was read-only. The audit used synthetic plugin databases, dependency stubs, actual owner modules, real failed child-process spawns, and real disposable loopback listeners. It did not use a normal profile, private database, live Docker mutation, external HTTP request, paid provider, or additional app instance.

The strongest long-session candidates are resource admission and retirement: concurrent database connection creation can orphan pools; pending connections and tunnels can survive disconnect; failed Docker spawns permanently occupy stream slots; and Docker subscriptions follow the ambient Node rather than their originating Node. The largest measured CPU candidates are repeated full log-tail maintenance, normalizing discarded SQL rows, and HTTP base64 decoding. Cold catalog and Docker discovery also repeat avoidable work.

These are owner measurements and correctness characterizations. They do not establish visible task-switch latency or a full day's retained RSS. The running `perf-baseline` main renderer was hidden/unfocused, and its driver cannot exercise native child webviews. Native acceptance and a visible sustained-use run remain implementation gates.

### Prioritized candidates

Effort is an estimate: S is a focused owner change; M spans an owner and its consumers or has several race conditions; L needs driver or cross-runtime work. Risk refers to implementation, not the likelihood of the finding.

| ID | Candidate | Evidence | Impact | Confidence | Effort / risk |
| --- | --- | --- | --- | --- | --- |
| 13.1 | Join and retire database pool creation | 20 cold queries created 20 pools; 19 survived disconnect; pending connect republished after disconnect | Connections, processes, memory, cold latency | High for owner race; real PG resource size unmeasured | M / medium |
| 13.2 | Batch and join catalog reads with generation-safe freshness | 8 readers × 100 tables caused 1,608 schema statements | DB CPU, queueing, pane startup | High for count | M / medium |
| 13.3 | Apply the row cap before normalization | 250,000 cells normalized for 200 returned rows; 58.9 ms CPU and 26.3 MB sampled heap delta | Node CPU and transient memory | High | S / low; driver production bound is L / high |
| 13.4 | Release Docker stream/watch ownership on spawn error/close | 32 actual failed spawns left 32 tracked children and zero end callbacks | All later attachments refused; retained child objects | High | S–M / medium |
| 13.5 | Join cold Docker health and skip empty-inventory matching | 16 health commands versus 1 joined inventory command; 301 serial config reads with zero containers | Node/process CPU, rail discovery latency | High for counts; actual disk latency unmeasured | S–M / low–medium |
| 13.6 | Buffer Docker log tails without full projection on every chunk | 24,000 small chunks across eight prefilled tails cost 1,960.5 ms CPU | Renderer CPU and allocations during long-running logs | High in synthetic steady-state workload | M / medium |
| 13.7 | Bind Docker stores/subscriptions to Node ownership | Attach sent to A, cleanup sent to B, B output delivered to A callback | Stale work, wrong data, stream lifetime | High for client channel; shared-viewer broker gate belongs to 16 | M / medium |
| 13.8 | Decode HTTP bodies without per-character iterable mapping | 5 MiB decode cost 249.7 ms CPU and 135.1 MB sampled heap delta in V8/jsdom | Plugin UI CPU and transient memory | High for this owner/runtime; WebKit benefit unmeasured | S / low–medium |
| 13.9 | Bind HTTP operations to request/draft lifetime and propagate cancellation | A response landed on B draft; caller abort did not abort outbound fetch | Wasted work and stale result publication | High for model and portable route | M / medium; depends on 02/16 |
| 13.10 | Align Database scratch UTF-8 limits while retaining failed drafts | Node accepted 4 MiB Unicode text; host refused it; failed oversized edit disappeared after remount | Broken pane and unsaved SQL loss; blocks safe size controls | High | S plugin + M host / medium; host fix belongs to 12 |
| 13.11 | Reserve pending tunnel slots and retire pending opens | 24 simultaneous opens bypassed cap 16; close/dispose allowed late live listener | Native/helper sockets and resources over time | High; real listeners | M / medium |
| 13.12 | Join preview URL resolution and suppress publication after retirement | 8 readers caused 8 script capability calls; disposed refresh emitted a change | Child process/Node CPU, redundant UI invalidation | High for counts/lifetime | M / medium |

The saved HTTP request list, native preview retention/navigation, and Docker log DOM projection are source-confirmed follow-ups. They are not selected performance fixes without their missing baseline or native acceptance gate.

## Architecture and custody

The inspected flow is Solid/client-core or a loaded UI tree → platform WebSocket → helper custody broker → pinned authenticated Node connection → Node API → owning core service or permission-scoped plugin runtime. Responses and events return through that connection to client stores or the loaded UI worker. Rust owns child browser webviews; the renderer only requests their creation, navigation, geometry, visibility, and teardown.

| Surface | Source and owner | Protocol/custody/cache | Consumer and lifetime |
| --- | --- | --- | --- |
| Preview URL | `plugins/preview/src/server/previewUrls.ts`; task/project config, run-target capability, recipe, or script through `core.proc` | Preview plugin route/event; client `tunnelUrl` requests helper-owned loopback listener for remote Node URLs; tunnel dials through pinned Node connection | `PreviewTaskPane`, host preview layout, desktop bridge, Rust `webviews.rs`; native views retained per task until explicit teardown/archive/window disposal |
| Docker inventory/actions | Compiled privileged Docker plugin; `DockerService`, fixed-argv CLI, `dockerBridge`, task core service/config matcher | Portable plugin routes; 5 s inventory and 10 s health caches; lazy event watcher invalidates lists, debounces changes; client singleton signals and 15 s summary scheduler | Browser/task panes and rail; live daemon state intentionally is not persisted in the query cache |
| Docker logs/stats/exec | Node Docker child processes and PTY owner; stream map keyed to Node-side WebSocket connection/kind/ref | Docker WS channel through shared helper Node socket; renderer channel registry and log store | Retained eight-log-buffer LRU; logs continue when their component hides/unmounts; stats attach only while selected; exec cleanup belongs to originating Node |
| Database | `CoreServices.data` owns URL resolution, trust, PG pool, catalog, queries, normalization; loaded Database plugin receives scoped `data` capability | Plugin database API and scratch routes; Node-only transient credential; loaded frame/tree bridge never receives URL, driver, or raw socket | Loaded Database pane; host CodeMirror document owns scratch text/save/flush; row grid is already virtualized; connect is explicit |
| HTTP | Loaded HTTP Node plugin owns SQLite records, encrypted fields, variable resolution, outbound fetch, response cap | Device-principal portable routes, loaded RPC, tree model; pair of list/detail panes shares one module-held model | UI worker retains current result, decodes base64 and text, optionally pretty-prints JSON; drafts are memory-only; saved records are durable and encrypted |

Read owning documents: `docs/README.md`, `docs/architecture-overview.md`, `docs/conventions.md`, `docs/database.md`, `docs/docker.md`, `docs/http-client.md`, relevant `docs/shell.md` and local-development sections. Read future indexes and relevant sandbox, remote/device UI, ecosystem, and project Database proposals. The proposals are not shipped contracts. Reviewed prior reports 03, 07, and 12 in detail and adjacent audit scope; generic cancellation belongs to 02, event interests to 05, targeted Node sends to 07, host document retention to 12, and shared helper/viewer lease ownership to 16.

### Existing work to preserve

Git history includes lazy renderer plugin UI/startup (`6fd22355`), preview task-ID cleanup capture (`90e12af3`), bounds/clipping (`6d008fd1`), HTTP command-variable sending (`3612efac`), host-mediated data capability (`6d51c19f`), and the broader recent performance changes (`48fe8e50`). Avoid undoing these to change service lifetimes.

Current code already has joined Docker inventory reads; Docker inventory/health TTLs; 300 ms event debounce and bounded watcher retry backoff; 32 stream child slots; eight log buffers with 512 Ki UTF-16 code-unit tails; exec admission limits; same-key tunnel joining, authentication, pinned Node dialing, stream backpressure and 60 s idle shutdown; native child-webview cap 32 and memoized bounds; PG pool `max: 4`, transactions, statement timeouts and catalog caching; HTTP streamed 5 MiB response-body cap; Database explicit table-row LIMIT and a virtualized host grid. The findings concern holes in those owners, not absence of all bounds.

### Telemetry lead

The coordinator found 2,302 Docker task-summary spans since September 26, median 445.175 ms and p95 2,669.865 ms. The same route filter returned no Database, HTTP pane, or preview spans. Missing release IDs and possible suspension mean this cannot prove a checkout regression or attribute the tail to matching/config reads. Use it to choose a visible current-release replay. [Filtered Sentry spans](https://acorn-u3.sentry.io/explore/traces/?query=timestamp%3A%3E%3D2026-09-26+span.description%3Ahttp.request+%28route%3A*%2Fdocker%2F*+OR+route%3A*%2Fpreview%2F*+OR+route%3A*%2Fdatabase%2F*+OR+route%3A*%2Fhttp%2F*%29&project=4512064444825600&statsPeriod=7d&table=span).

## Detailed findings

### 13.1 Database pool admission and disconnect race

**Owner evidence:** `packages/node-core/src/server/core/data.ts:225` reads a settled `pools` map entry before awaiting URL resolution. Line 235 creates a pool; line 240 publishes it only after the handshake. There is no pending operation owner. `disconnect` at line 259 only removes a published entry. Explicit connect refreshes the URL, and multiple refreshes can also race on the old pool.

**Measured baseline:** [13-data-before-v2.json](./13-data-before-v2.json), actual `createDataSourceService` with fake PG pools:

- Twenty concurrent cold `query` calls created twenty pools. Disconnect ended the one last published pool, leaving nineteen fake pools alive.
- Disconnect while a handshake was pending did not retire it; it published one live pool after disconnect completed.

Fake pools have no sockets, and the fixture explicitly closes all synthetic survivors. The count proves an admission/lifetime defect. It does not measure twenty real PG connection pools or their memory. Because `max: 4` is per pool, this race bypasses the intended per-task connection bound.

**Fix:** Give each task a connection owner containing the published pool, pending operation, and generation. Join overlapping implicit acquisition. Serialize explicit refresh according to its existing fresh-URL semantics. Disconnect retires the current generation, ends published/pending-created pools, and prevents late publication. If a retired caller is still using an old pool, define drain/close behavior explicitly rather than returning a closed pool. Failed handshakes and replaced pools close exactly once. Do not let one task block another.

**Invariants and verification:** Preserve Node-only URL custody, worktree root/config/trust checks, explicit Connect noticing changed `.env` or script output, permission-scoped `data:write`, and current transaction/read-only behavior. Test concurrent cold query/catalog/connect, simultaneous refreshes, URL change during refresh, rejection cleanup, disconnect during URL resolution and handshake, reconnect after retirement, and old completion versus replacement. After the same twenty-reader wave there must be one admitted owner and zero pools alive after disconnect. A disposable PG test must then verify actual connection counts, close/drain behavior, and no client leak. No credential TTL or persisted URL is proposed.

### 13.2 Catalog fanout and missing in-flight joining

**Owner evidence:** `core/data.ts:189` executes one table query and two queries per table (columns at 196, primary key at 201). `catalog` at 249 caches only the settled result. It has no in-flight entry or generation check. Disconnect, refresh, or DDL can invalidate the cache while an older read later repopulates it.

**Measured baseline:** With a warm connected owner, eight simultaneous catalog reads of 100 synthetic tables generated `8 × (1 + 2 × 100) = 1,608` schema statements. A later warm catalog call produced no new schema SQL. Fake PG does not enforce `max: 4`; its 2.126 ms elapsed value is not live PG latency or queue depth.

**Fix:** Batch columns and primary keys for the visible base-table set, then build the same ordered `DataTable[]` in the core owner. Join a catalog wave by pool generation. Invalidation retires the pending publication, and a subsequent reader resolves the fresh pool/schema. Do not extend freshness with a global TTL or cache credential authority. For a constant-query design, three inventory queries per fresh wave should replace 201 per reader; the exact SQL must preserve current visibility and metadata semantics.

**Verification:** Retain base-table/system-schema exclusions, schema/table ordering, ordinal column ordering, nullable/type strings, quoted and Unicode identifiers, composite PK membership, role permissions, empty catalog behavior, and DDL invalidation. Test disconnect/refresh/DDL while metadata is pending and make stale completion unable to commit. Verify SQL semantics on disposable PG, including a concurrently dropped table, not only against a stub that accepts any query string. Count statements and pool queue work after the same eight-reader workload through the new production owner.

### 13.3 Discarded SQL rows are normalized before the cap

**Owner evidence:** `core/data.ts:174` maps every driver row and every cell into `allRows`, then slices at 181. The query owner awaits a full PG result at 282. The public cap is at most 500 rows, but that cap currently bounds only the returned array.

**Measured baseline:** 250,000 already-produced synthetic driver rows containing an instrumented object cell, `maxRows: 200`: 250,000 normalized cells, 200 returned rows, `truncated: true`, 36.424 ms elapsed, 58.928 ms process CPU, 26,274,432-byte sampled heap delta. Driver-result allocation occurred outside the measured section. The heap delta is transient allocation, not a retained leak or peak driver memory.

**Immediate fix:** Slice the driver rows before cell normalization and compute `truncated` from the original row length. Preserve all other fields and exact cell normalization. The same workload should normalize 200 cells, with identical first 200 rows, metadata, truncation and timing semantics. Include null/undefined, dates, objects, booleans/numbers, duplicate field names, empty and multi-result queries, rowCount and command cases.

**Separate production-bound work:** This change cannot prove bounded PG production; the driver still buffers all returned rows. Installed `pg` 8.22.0 accumulates callback/Promise results in `pg/lib/query.js:60`; its row-event path can avoid that accumulation. The official [pg.Client API](https://node-postgres.com/apis/client) documents query row/end/error events and notes the advanced submittable API is subject to change. A host-owned evented query adapter could drain the full execution while retaining only the bounded rows needed from the final result. That needs an actual driver/PG baseline and tests for every statement's completion, errors, timeout, transaction COMMIT/ROLLBACK, parameters, final-result metadata and client release.

Do not append `LIMIT`, cancel execution after N rows, or close a cursor early for arbitrary interactive SQL: it may contain writes or multiple statements, and changing execution changes semantics. A row count does not bound one huge cell or many columns; a future byte policy needs an explicit compatible error/representation contract. Keep that larger change separate from the proven normalization fix.

### 13.4 Failed Docker spawns permanently consume stream capacity

**Owner evidence:** `plugins/docker/src/server/dockerService.ts:152` adds a spawned child to `streams`. The `error` listener at 168 does nothing; removal and end notification depend on `exit` at 169. `ensureEventsWatcher` has the same empty error handler at 111 and resets/retries only on exit. A failed spawn emits `error` and `close` without `exit`.

**Measured baseline:** [13-docker-spawn-before.json](./13-docker-spawn-before.json) uses the actual service and real `ChildProcess` with an isolated nonexistent PATH, so it cannot access the Docker daemon. Thirty-two streams produced 32 errors, 32 closes, zero exits, zero end callbacks and 32 tracked failed children. Attach 33 was refused by the budget and called end once; the failed set still contained 32 children. The fixture stopped all handles and disposed the service.

**Fix:** Centralize idempotent completion across error/close/exit. Remove the exact owned child from tracking, finish subscriptions once, and distinguish intentional `stop` from failure. The event watcher must release its exact child and schedule one retry under existing bounded backoff; a late old child cannot clear a replacement. Dispose clears retry/broadcast timers and prevents any new work. Keep the 32-slot budget.

**Verification:** Real missing-binary spawn, normal zero/nonzero exit, error then close, exit then close, synchronous spawn failure if supported, stop followed by error/close, dispose during spawn, and watcher recovery. End is exactly once for unexpected failure and remains suppressed for intentional stop under the current contract. Failed slots return to zero; a later healthy stream can be admitted. Watcher retries once per owned failure, not once per event or subscriber. No uncapped reconnect loop or plugin-specific broker workaround.

### 13.5 Repeated Docker health and serial empty matching

**Owner evidence:** `dockerService.ts:31` caches only settled health, so concurrent cold readers each run `docker version`. Inventory already joins `pending` at line 73. `dockerBridge.ts:109` gets tasks and containers concurrently but then awaits each task's overrides serially, even when there are no containers. `dockerConfig.ts:65` has a settled 30 s config cache, not an in-flight join.

**Measured baseline:** [13-docker-before-v2.json](./13-docker-before-v2.json): sixteen cold health callers generated sixteen version commands, while sixteen inventory readers generated one `ps`. A task-summary wave over 300 tasks with zero containers read 301 config files, peak concurrent reads one, and returned zero summaries. The synthetic filesystem adds 1 ms to each read; 381.993 ms elapsed is a waterfall demonstration, not actual disk latency. CPU was 11.631 ms.

**Fix:** Join a cold health probe in the Docker service and retire/clear it safely on failure and disposal. Once the existing authoritative task/inventory reads succeed, return an empty summary immediately when containers are empty. This removes every matcher-config read in that case, and is valid for custom matchers because no matcher can produce a container from an empty set. For nonempty inventories, consider a small bounded config-read worker loop preserving output order; do not introduce unbounded filesystem fanout or cache mutable task config longer. Preserve task root/permission handling and current match semantics.

**Freshness gates:** `cachedList` at line 79 can publish an older pending list after mutation/event invalidation. A join/freshness change should track generations so stale pending completion cannot commit, and its `finally` cannot delete a replacement. Characterize this race before selecting a broader cache rewrite; do not increase TTLs to mask it. Test unavailable/available transitions, event restart, custom positive/negative matchers, changed worktree config, empty task sets and mutation during pending reads. Health command count should be one per cold wave; zero containers should cause zero override reads after the normal authoritative scope reads.

### 13.6 Docker steady-state log tail processing

**Owner evidence:** `plugins/docker/src/client/dockerLogStore.ts:8` caps a tail at 512 Ki UTF-16 code units and line 9 retains eight buffers. Line 35 concatenates the retained text with every delivered chunk and slices the whole tail immediately. A background attachment deliberately outlives its component, so this work continues for hidden retained buffers.

**Measured baseline:** [13-logs-before-v2.json](./13-logs-before-v2.json), actual store with mocked stream transport, no DOM:

- Eight buffers are **each prefilled with 512 Ki characters before the timer**: 4,194,304 prefilled characters total.
- Deliver 3,000 chunks of 17 ASCII bytes/characters to each buffer: 24,000 chunks and **408,000 new delivered bytes total across all eight buffers**.
- The final retained tails total 4,194,304 characters. Elapsed was 1,889.043 ms and process CPU 1,960.539 ms.
- The nominal concatenated character volume is 12,583,320,000. This is a logical operation-size calculation, not physical copied bytes; V8 ropes may change copying behavior.

This measures full-tail steady-state maintenance, not empty-buffer growth. The probe now emits `prefilledCharacters` for future tags; the original `before-v2` is unchanged. The result excludes component work, DOM and native painting.

**Fix:** Keep an owner-held bounded segmented tail with append/truncate cursors, merge small segments to bound object count, and cache text projection. Publish/coalesce revisions so an unobserved tail does not materialize a whole string per chunk; materialize at a consumer/read boundary or bounded visible update cadence. Keep the current accessor and clear/end behavior, or move callers to an explicit typed snapshot owner. The replay must call the new production owner and include reads, not benchmark an unused buffer helper.

**Invariants:** Preserve exact last-N UTF-16 code units, including surrogate boundary behavior, byte/chunk ordering, stderr delivery, initial `--tail 300`, clear semantics, end state, eight-buffer LRU and detach, same-Node hidden continuity, reconnection and multiple subscribers. Do not quietly convert the existing cap to bytes or stop hidden streams and lose log continuity. Test fragmented Unicode, empty/chunk bursts, one large chunk, clear during stream, eviction, Node-qualified collisions and bounded segment counts. Re-run this identical prefilled workload, then a visible tail with consumer reads and log search. Report CPU, projections/publications, retained chars and segment count separately.

### 13.7 Docker client state follows the ambient Node

**Owner evidence:** `plugins/docker/src/client/wsChannel.ts:11` keys stream subscriptions by kind/ref, exec subscriptions by exec ID, and calls ambient `wsSend` on attach/detach at 61/68. Reattach enumerates these keys at 93. `dockerLogStore` keys buffers only by container target. `DockerTaskPane.tsx:23` keys its retained root only by task, and listens for task eviction at 54. `dockerStore.ts:16` has one in-flight/store owner and its refresh wiring is application-lived after first use; its summary scheduler is 15 s at 77. These stores have no captured Node generation.

**Measured baseline:** [13-docker-scope-before-v2.json](./13-docker-scope-before-v2.json) uses actual Docker channel, `activeNode` and `wsClient` with synthetic transport. Attach for `same-container` was sent to node A. After selecting B, the A attach remained in reattach frames, B's same-ID frame delivered `FROM B` to the A callback, and A cleanup sent detach to B. No detach reached A.

**Fix:** Capture origin Node when creating subscriptions, buffers, exec owners and retained task roots. Qualify keys by Node, route cleanup to the captured Node through the targeted-send seam, and retire/rebind in-flight/store work on Node switch with generation guards. Either bound explicitly retained per-Node stores or clear departing runtime state; do not combine A and B tails. Make outgoing interest removal happen before incoming reattach. Keep same-Node hidden continuity and device state semantics.

**Verification:** A/B same task/container/exec IDs; switching while fetching/attaching, old-frame delivery, reconnect on the same Node, departing cleanup after switch, two views sharing one tail, failed attach and explicit eviction. A cleanup must address A, B cannot feed A history, and stale A results cannot commit to B stores. Preserve cold/last-known rendering behavior for data that has an established offline contract rather than introducing indiscriminate clears.

**Shared-viewer dependency:** `plugins/docker/src/server/wsChannel.ts` keys a backend stream by Node-side connection/kind/ref. Multiple renderer sockets behind one helper Node socket can therefore share that key; an individual detach can terminate other viewers' stream. Area 16 owns the generic broker/viewer lease characterization. Coordinate with areas 05 and 07. Do not teach the helper hard-coded Docker plugin channels or create a second direct authenticated renderer socket to avoid the lease issue.

### 13.8 HTTP response decoding creates large transient work

**Owner evidence:** `plugins/http/src/tree/httpClient.ts:56` decodes with `Uint8Array.from(atob(bodyBase64), ch => ch.charCodeAt(0))`, then `TextDecoder`. `ResponseView.tsx:52` retains the decoded bytes/text beside the base64 result; pretty JSON can add another representation.

**Measured baseline:** [13-http-before-v2.json](./13-http-before-v2.json), actual decode owner, V8/jsdom `atob`:

| Body bytes | Elapsed ms | Process CPU ms | Sampled heap delta bytes |
| --- | ---: | ---: | ---: |
| 1,048,576 | 47.079 | 48.199 | 37,006,920 |
| 5,242,880 | 248.996 | 249.707 | 135,058,920 |

Exact decoded bytes/text were checked. These heap deltas are transient sampled allocations, not retained leaks. jsdom/V8 does not establish native WebKit timing.

**Fix:** Prefer a feature-detected native byte decoder when present, with a portable indexed-loop fallback over `atob` output that avoids iterable/per-character callback allocation. Keep this in the HTTP UI owner. Do not import Node Buffer into the loaded UI or assume a particular WebKit supports `Uint8Array.fromBase64`. A future binary bridge/result protocol may remove base64 duplication, but that is a separate contract change with capability/trust requirements.

**Verification:** Exact all-byte values, binary bodies, empty response, Unicode and malformed UTF-8 `TextDecoder` behavior, invalid base64/current error behavior, byte-array subviews where a new owner accepts them, response content metadata, and the existing streamed 5 MiB cap. After owner replay, verify the real loaded pane on native WebKit, response selection/download/copy, and large JSON/raw/binary modes. Avoid silently dropping the full response or disabling existing body functionality to reduce memory.

### 13.9 HTTP requests outlive their selected draft

**Owner evidence:** `plugins/http/src/tree/panelModel.ts:199` sends from the current draft and unconditionally publishes the awaited result at 206. `open` at 108 and `startNew` at 142 clear the result but do not retire that pending publication. `persist` at 170 can also finish after another selection or edit. `subjectKey` at 55 contains project/task IDs, not Node identity/bridge generation, while the module retains one model at 57. Client wrappers have no per-operation signal. `plugins/http/src/server/send.ts:137` runs command variables without caller cancellation; fetch at 262 uses only its 30 s timeout at 268. The portable send route at `routes/http.ts:563` does not pass `c.req.raw.signal` into sending.

**Measured baseline:** Actual model with held synthetic send: after request A began, the user selected a new draft B. Completion produced draft URL B with response URL A. A module characterization reused the model for identical project/task IDs on another bridge; native worker warm reuse is a gate for area 16, not a proven desktop reproduction here. [13-http-send-before-v2.json](./13-http-send-before-v2.json) exercises the actual portable route: aborting its caller Request left outbound fetch signal un-aborted, and the route returned 200 when the stub response eventually completed. No real HTTP request or command ran.

**Fix:** Capture request/draft/subject and Node operation generations; late completion belongs to its sending selection or is retired, never attaches to an unrelated draft. Preserve operation status for a request the owner chooses to retain. Thread a scoped AbortSignal through SDK/RPC/router, variable resolution, process capability, fetch, capped-body read and finally cleanup. Combine caller retirement with current deadlines; do not reset timeout at every layer. Use the area 02 RPC owner work before claiming UI cancellation reaches Node. Keep cancellation separate from write retry: an outbound mutation may already have occurred and must not be replayed automatically.

**Verification:** Switch selection/task/Node during send; type/edit while save is pending; old save/list refresh cannot overwrite newer draft; dispose/remount; same IDs on different Nodes; request/body read cancellation; command variable cancellation and deadline; several referenced variables; overridden command variables do not execute; secret resolution and device-only authorization remain. No cancellation claim should imply undoing a transmitted HTTP mutation. Retain exact outgoing request fields and error/truncation behavior. Preserve last-known saved request/offline and full draft behavior when changing model admission.

### 13.10 Database scratch byte mismatch and failed-draft retention

**Owner evidence:** `plugins/database/src/server/routes/database.ts:72` limits scratch strings to 2 Mi JavaScript characters; the completions body at 73 uses the same unit. `packages/protocol/src/plugin/bridge.ts:175` defines a 2 MiB document byte cap. Host `DocumentSurface.tsx:268` checks UTF-8 bytes, and frame document writes are capped in `host/frames/broker.ts:536`. Save at `DocumentSurface.tsx:142` catches write failures and restores its saved baseline but does not reject; teardown at 247 destroys the only editor text owner.

**Measured baseline:** Actual portable Database route with disposable plugin SQLite accepted 2,097,152 `é` characters, 4,194,304 UTF-8 bytes, status 200; GET returned all 4 MiB. The actual host surface refused to mount its editor or offer a document handle. ASCII at exactly 2,097,152 bytes was accepted; one-byte-over edit returned 400 and left the previous Node text.

Actual host CodeMirror with synthetic failed write retained an edited 2,097,153-byte document while visible, but `flush()` resolved despite the error. Close/remount restored the original ten-byte `SELECT 1;` document; the unsent edit was lost. [13-scratch-before-v2.json](./13-scratch-before-v2.json) and [13-surface-before-v2.json](./13-surface-before-v2.json) cover the two sides.

**Fix and dependency:** Align scratch/generated writes and completions with the existing shared UTF-8 byte contract, and coordinate the host draft/acknowledgement fix with area 12. Refused writes must retain the unsent document under captured Node/task/document URI ownership; flush must reject/block Execute when the write did not land. Switching or destroying a view cannot discard a dirty failed draft. Existing Unicode rows above the host cap need recovery/export or a compatible opening path; reducing the Node validator alone would strand them. Never silently truncate SQL.

**Performance guard:** Avoid UTF-8 encoding an entire multi-MiB document on each keystroke. Validate at the actual write/bridge boundary, with cheap character lower-bound checks where helpful, and preserve unsent editor text on refusal. The cap is a protocol/resource invariant, not a permission to discard text.

**Verification:** ASCII, two-/three-/four-byte code points, combining sequences, surrogate behavior, exact byte limit/one byte over, old oversize rows, generated/saved scratch replacement, plugin document writes, completion requests, failed/disconnected saves, flush-before-execute, remount and Node-switch restoration. Replay the actual host surface and portable route after the shared owner changes; a bypass helper that accepts text is insufficient.

### 13.11 Tunnel admission ignores pending opens and retirement

**Owner evidence:** `packages/custody/src/supervision/previewTunnel.ts:100` joins the same key with an `opening` map. Different keys enter `listen` at 112; line 113 checks only published `entries.size`, then awaits `listen` before publishing at 156. Close at 216 and disposal at 225 operate on published entries, not pending reservations. There is no disposed/generation publication guard.

**Measured baseline:** [13-tunnels-before.json](./13-tunnels-before.json) uses the actual owner and real loopback listeners, without dialing a remote Node or preview page. Twenty-four concurrent distinct opens created twenty-four reachable listeners with zero rejection despite cap 16. A pending open survived immediate task close; another survived immediate dispose. Eight same-key calls correctly produced one listener. Every test port was closed in `finally`.

**Fix:** Reserve admission synchronously over published plus pending entries. Track owner/key/Node/task generations and permanent disposal. Close retires matching pending opens; a late successful listen is closed before publishing its port/secret. Completion/finally must only remove its own reservation, so an old operation cannot clear a replacement. Capture Node with task in `PreviewTaskPane`/client cleanup: `tunnelUrl.ts:73` currently rereads `activeNodeId`, whereas the pane fix at `PreviewTaskPane.tsx:38` captures only task ID.

**Invariants:** Keep same-key joining, independent Nodes/tasks, local-Node no-hop behavior, loopback-only target classification, refusal of failed remote rewrite, ephemeral secret authentication, pinned authenticated Node resolution, stream backpressure, idle shutdown and actual socket closure. A task close on A must not close a same-ID task on B. Test cap including pending reservations, listen errors, close/dispose before/after callback, replacement after close, no publication of retired secret/port, dispose then open, and healthy admission after failure. The identical 24-request wave should publish at most 16 listeners; pending close/dispose should leave zero owned listeners.

### 13.12 Preview URL script fanout and stale publication

**Owner evidence:** `plugins/preview/src/server/previewUrls.ts:86` resolves every `forTask` independently. Script resolution at 17 invokes `core.proc` at 23, timeout 10 s. `refresh` at 92 publishes after await without a disposal/generation check. `refreshProject` at 107 fans out every active task, and disposal at 117 only clears maps.

**Measured baseline:** Eight simultaneous reads of the same script-configured task caused eight process capability calls. A held refresh completed after disposal and emitted one `plugin:preview:url-changed` event. All process calls were synthetic; counts characterize actual runtime ownership without running a repository script. See [13-preview-before-v2.json](./13-preview-before-v2.json).

**Fix:** Join only overlapping resolution of the same task/current generation. Configuration, run-target and recipe changes must invalidate/retire that generation and resolve fresh state. Retired/disposed work cannot mutate observed state or emit. If process cancellation becomes available, assign it to the resolution owner so retiring one joiner cannot cancel other valid consumers. Bound project-refresh process concurrency only after recording current workload/admission; do not introduce a stale script URL TTL or change the priority ladder to reduce calls.

**Verification:** Recipe > run-target > configured URL/port/script semantics; exact task root/environment; valid/invalid/failing/timed-out scripts; same-key concurrent read and refresh; changing config while resolving; duplicate announcements; disposal during process work; independent tasks; archived-task retirement. The overlapping eight-reader workload should use one operation and disposal should emit nothing. Preserve Node-owned resolution, capability checks and future OS process-policy seam.

## Source-confirmed follow-ups with missing gates

### HTTP saved request list overfetch

`plugins/http/src/server/routes/http.ts:380` selects all request columns without a limit and decrypts every row through `toRequest` at 89. That opens URL/headers/body/auth/variables for the entire list; request bodies can be large. `panelModel.ts:85` and 86 fetch full saved/ad-hoc lists, although list labels need id/name/folder/method. The palette already has a summary projection at route line 157. The rail helper at 171 selects encrypted fields with a 200 limit but uses summaries. There is currently no dedicated saved-request GET-by-ID detail route.

This is an unmeasured loading/payload/crypto lead. A list/detail split changes API and last-known offline/full-draft behavior, so do not select it from source alone. Baseline the actual route with disposable encrypted records and a synthetic secret owner, counting reveal calls, SQL columns and serialized bytes; then use disposable real encryption for CPU. Suggested bounded fixture: 100 requests with 64 KiB bodies, measuring saved and ad-hoc lists, refresh-after-save and selection. No private credentials/content are required.

If the baseline warrants it, share a typed metadata projection for rail/palette, add scoped detail fetch, and hydrate selected/copy/duplicate/export actions with a bounded cache and joined pending owner. Preserve the complete saved set, order/filter/search behavior, encrypted storage, task/project/device scoping, exact request/draft fields, dirty edits while details load, and last-known offline data. Do not arbitrarily truncate the pane to 200 rows or throw away already available full records for a latency claim. The after measurement must exercise the actual list/detail production path, including cold selection and offline reopen.

### Native preview retention, navigation and Node identity

Rust `apps/desktop/src-tauri/src/webviews.rs:26` caps all native child views at 32. Hidden preview pages are retained; ordinary task visits can therefore retain many active pages until archive or window teardown, and a 33rd surface can be refused. This is bounded count, not evidence of a leak or proof that pages are idle. The renderer cannot determine arbitrary page JS/network cost. Do not blank or evict pages blindly: browser navigation/form state is intentional retained behavior.

Two source gates need native acceptance. First, desktop `bridge.ts:218` uses `preview:<taskId>` while plugin surface keys include Node; same task IDs on A/B can share a native preview. An owner-qualified key migration must update the typed shell seam, event projection, teardown and Rust key policy/tests rather than injecting colon segments rejected by the current grammar. Second, `webview_ensure` at Rust line 229 compares the current navigation URL to the supplied home URL and can navigate an existing page back to home after remount. The documentation promises retained browsing; distinguish home configuration identity from current browser URL before claiming that changing ensure avoids reloads.

Required baseline: a visible isolated Tauri window; real preview navigate away from home, hide/remount, switch A/B with same task ID, change configured home, archive, window disposal and all-32 admission. Record native navigation counts, page lifecycle/JS/network work and process CPU/RSS. Preserve back/forward/reload, policy checks, plugin webview allowlists, form/navigation state and device UI seam. Any idle retention policy needs explicit recoverability, not a silent performance-driven state loss. No native child-view latency or retention improvement is claimed by this audit.

### Docker log projection and visibility

`ContainerDetail.tsx:58` derives all lines from the whole text; search at 70 lowercases/scans lines on changes, and its `forEach` still traverses after collecting 5,000 matches. `packages/client-core/src/kit/components/content/Log.tsx` renders all supplied lines. This can amplify 13.6, but the store-only benchmark excludes it.

Baseline a visible full short-line tail, find/follow, hidden tab and remount. Conditional options are early-exit search, stable line projection and virtualization/visible interest, preserving keyboard navigation, selection/copy, accessibility, follow position, search counts/highlights and TUI rendering. Do not ship a generic Log rewrite based only on the tail benchmark or reduce functionality to hide DOM cost.

## Compatibility and rejected shortcuts

- Keep credentials, PG drivers, HTTP variable commands and preview process execution in their current Node/core capability owners. Loaded plugin UI must not obtain direct drivers, sockets, raw URLs or helper authentication.
- Use captured Node and generation owners rather than global caches keyed only by task/container. This supports independent remote Nodes and future browser/device UI without a desktop-specific credential escape.
- Taskless project Database plans may introduce a different pool source/lifetime. Model a connection owner that can accept a future subject; do not move current task pools into the Database plugin or add a global URL cache that assumes all project/task credentials are interchangeable.
- Future OS isolation/task policy remains a `core.proc`/host data seam. Joining bounded admitted work preserves it; bypassing process services with direct plugin execution would make it harder to enforce.
- No longer cache TTLs, automatic SQL LIMIT injection, early write cancellation, retry of ambiguous mutations, arbitrary body/log dropping, or silent dirty-draft clearing is proposed.
- Do not disable hidden log continuity or native browser state solely to show lower memory. Their retention is product behavior; optimize owner processing and establish a compatible lifecycle policy first.
- A transient heap sample is not a retained memory measurement. Operation-count reductions are proven by the synthetic owner fixtures; real latency, PG/socket memory and native frame/paint benefits still need their respective current-runtime gates.

## Implementation sequence and acceptance

1. Apply independent lifecycle fixes 13.4 and 13.11 with exact cleanup/readmission tests. These prevent irreversible session degradation without changing user retention semantics.
2. Fix core PG admission 13.1, then catalog 13.2; share generation rules. Land slice-before-normalization 13.3 separately from the larger driver buffering change.
3. Coordinate 13.7 with captured targeted sends (07), event interests (05), and shared viewer leases (16). It is both an isolation and resource ownership requirement.
4. Coordinate scratch UTF-8 limits 13.10 with host draft/flush fixes (12); preserve existing oversized/unsent text before strengthening validation.
5. Implement log owner processing 13.6 and HTTP decode 13.8 using before/after actual-owner CPU/operation probes, then native visible acceptance.
6. Join Docker discovery 13.5 and preview URL resolution 13.12 with freshness/disposal races covered.
7. Bind HTTP draft operations 13.9 and cancellation after RPC lifetime ownership (02) and loaded worker reuse/eviction (16). Preserve offline and mutation semantics.
8. Only select the three unmeasured follow-ups after their bounded source-owner/native baselines. Defer driver-level SQL buffering until semantic execution and real-driver tests are concrete.

After implementation, run relevant owner tests and `pnpm lint`, followed by the bounded root `pnpm test` gate as appropriate. Desktop UI changes require visible real Tauri acceptance. Sustained usage should revisit task/workspace/Node transitions, opened/hidden panes, disconnect/reconnect and archives with counters for pools, pending connects/catalogs, child processes, stream leases, tunnel listeners/sockets, worker/model roots, tails and native pages. Compare start/end CPU and retained process RSS after settling. This audit's short fixtures cannot substitute for that run.

## Reproducible evidence and commands

All probes are stored beside this report. Tag defaults to `sample`; use a fresh tag for replay. Do not overwrite original `before` files. Run one bounded probe command at a time so CPU measurements do not compete. Fixtures close synthetic databases/pools, stop child handles and close real listeners. The loopback script needs the same local-network sandbox permission granted for its baseline; it makes no external connection.

### Authoritative baseline artifacts

| Owner | Tag / artifact | Cases and limitations |
| --- | --- | --- |
| Core data | `before-v2` / `13-data-before-v2.json` | 4 cases; mocked PG/fs/config, actual core owner |
| Docker health/matching | `before-v2` / `13-docker-before-v2.json` | 2 cases; mocked CLI/fs, actual service/bridge |
| Docker failed spawn | `before` / `13-docker-spawn-before.json` | Real failed spawns, no daemon |
| Docker tail | `before-v2` / `13-logs-before-v2.json` | 1 case; actual store, mocked channel; full prefill stated above |
| Docker Node scope | `before-v2` / `13-docker-scope-before-v2.json` | 1 case; actual channel/Node/wsClient, synthetic transport |
| HTTP model/decode | `before-v2` / `13-http-before-v2.json` | 3 cases, 4 records; mocked API, actual model/decode; jsdom/V8 |
| HTTP send cancellation | `before-v2` / `13-http-send-before-v2.json` | 1 case; actual portable route, disposable SQLite, stub fetch |
| Host scratch surface | `before-v2` / `13-surface-before-v2.json` | 2 cases; actual CodeMirror/host surface, mock read/write |
| Node scratch route | `before-v2` / `13-scratch-before-v2.json` | 1 case; actual portable route, disposable SQLite |
| Preview URL | `before-v2` / `13-preview-before-v2.json` | 1 case; actual runtime, stub core process capability |
| Preview tunnels | `before` / `13-tunnels-before.json` | 4 scenarios; actual owner, real loopback listeners |

Completed Vitest probe runs total five Node files/nine cases and four renderer files/seven cases, all passed in their successful runs. Standalone real-spawn and real-listener scripts completed. The unsuccessful first PG harness run used the wrong module resolution, attempted a synthetic hostname, and produced empty records; it is **not application evidence**. Preserve but exclude `13-data-before.json` and `13-data-sample-isolate.json`. The valid `before-v2` uses an explicit installed PG alias plus a bounded handshake wait. Other resolved harness issues were a missing partial child-process export, Vite dynamic asset-URL transformation, and a root testkit alias; none is an application diagnosis.

### Replay commands

Replace `root13-replay1` with a fresh tag. These current audit tests assert/record the old behavior; a fix verification must update the assertions and adapters to invoke the new production owner rather than retain an obsolete helper import.

```sh
rtk proxy env ACORN_PERF_TAG=root13-replay1 pnpm exec vitest run --config plans/performance/13-node-probe.config.ts plans/performance/13-data-probe.test.ts
rtk proxy env ACORN_PERF_TAG=root13-replay1 pnpm exec vitest run --config plans/performance/13-node-probe.config.ts plans/performance/13-docker-probe.test.ts
rtk proxy env ACORN_PERF_TAG=root13-replay1 pnpm exec vitest run --config plans/performance/13-node-probe.config.ts plans/performance/13-scratch-probe.test.ts
rtk proxy env ACORN_PERF_TAG=root13-replay1 pnpm exec vitest run --config plans/performance/13-node-probe.config.ts plans/performance/13-http-send-probe.test.ts plans/performance/13-preview-probe.test.ts
rtk proxy env ACORN_PERF_TAG=root13-replay1 pnpm exec vitest run --config plans/performance/13-renderer-probe.config.ts plans/performance/13-log-probe.test.tsx plans/performance/13-http-probe.test.tsx
rtk proxy env ACORN_PERF_TAG=root13-replay1 pnpm exec vitest run --config plans/performance/13-renderer-probe.config.ts plans/performance/13-surface-probe.test.tsx plans/performance/13-docker-scope-probe.test.tsx
rtk proxy node --import tsx plans/performance/13-docker-spawn-probe.mjs root13-replay1
rtk proxy node --import tsx plans/performance/13-tunnel-probe.mjs root13-replay1
```

For a quick coordinator gate, choose the data owner, Docker scope + scratch surface, and both standalone lifecycle scripts. The CPU-heavy tail run is about two seconds in the fixture and should be isolated from other benchmarks. No full lint/test run was added during this source-read-only audit; the coordinator owns cumulative implementation gates. `git status --short` at report preparation showed only untracked `plans/` and no application source changes.

### Remaining measurement gaps

- Real PG pool connection counts, catalog SQL semantics, queue depth and driver buffering under arbitrary writable/multi-statement SQL.
- Native WebKit HTTP decode and real loaded-worker Node switching/reuse; exact end-to-end RPC cancellation propagation.
- Shared renderer/viewer Docker subscription lease ownership behind one helper Node socket (area 16).
- Visible native child-webview navigate/remount/Node collision/retention and final task-switch/paint latency.
- Real Docker daemon watcher/log cadence, event invalidation race and short-line DOM/find/follow work; no live container mutation was authorized or needed here.
- Saved-request list decrypt/payload baseline and compatible offline detail hydration.
- Full-day or multi-day stable CPU/RSS after repeated transitions; no short synthetic result is labeled as this guarantee.
