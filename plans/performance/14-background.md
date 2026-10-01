# Background work, data dispatch, and workflows

Audit baseline: `f8e4b59c`. Investigation date: October 1, 2026. Application source remains unchanged.

The strongest opportunities are incremental Memory indexing, compact workflow read models, and
coalesced client refreshes. These reduce work that repeats during navigation and background updates.
Workflow live output also retains text that its UI does not display. Fix authoring's Node custody
before adding more asynchronous reuse or retention.

The measurements prove operation counts, selected string volume, and specific ownership failures.
They do not prove a visible interaction latency improvement, a heap reduction, or day-long stability.
Those claims need the after measurements and visible desktop checks described below.

## Scope and ownership

This audit follows these paths from input to consumer:

| Path | Source and Node owner | Client and consumer | Lifecycle and contracts |
| --- | --- | --- | --- |
| Background schedules | `node-core/server/schedules/{index,scheduler,cadence,nodeAction}.ts`; durable schedule state and run ring | Schedule API through the custody broker; Settings run rows | One Node scheduler, per-key serialization, concurrency admission, timeout signal, restart catch-up, declared and user cadence policies |
| Provider mirrors | Integration registry, scoped connection and credential services, `resourceRuntime.ts`, `sync/engine.ts`, `budgetRuntime.ts`, and item stores | Provider routes and plugin frames through broker and per-Node client state | User/resource request joining, stale cache, forced fresh reads, provider and connection admission, authorization before outbound work |
| Typed data | `dataSources/{authority,registry,runtime,dispatch,selection,validation,coreTasks}.ts`, query resolution | Typed source requests through Node API; saved-query editors, published panels, workflow selection | Reauthorization, source identity across awaits, bounded records, bytes, pages, time, and explicit completeness |
| Dashboards | Published revisions, `dashboards/{sampler,history,store,publication}.ts`, core schedules | `PublishedDashboardPanel.tsx`, `DashboardEditor.tsx`, dashboard client, recovery, and projection | Explicit Node client, query cancellation, stale cached read, sampling and compaction policies, compare-and-swap authoring |
| Workflow execution | Runner, run start, child lifecycle, dispatch, processing store and rules, schedules, data steps, termination | Run, step, selection, and history APIs; plugin event frames; run pane, processing view, task navigation, and notices | Frozen execution graph and authority, durable occurrence and dispatch identities, budgets, restart reconciliation, approval gates, cancellation |
| Workflow authoring | Definitions, file review and publication, draft queries, catalog, validation, generation request and authoring conversation | `workflowsClient.ts`, editor `draftStore.ts`, recovery store, browse detail | Device recovery qualified by Node, entity, and base revision; unsent changes, conflict handling, saved definition and repo publication boundaries |
| Memory and Findings | `memory.ts`, `knowledgeChannel.ts`, Memory's Findings target, Findings preparation and lifecycle | Knowledge routes, launch/context contribution, Memory library, Findings review | Files are truth; plugin SQLite is an index; fresh source discovery, content identities, recall statistics, durable approval receipts |
| Notifications | Notification state and adapters; workflow and agent attention contributions | Per-Node attention and notices projected into bell rows and targets | Bounded notice ring, state edges, delayed interruption, acknowledgement on viewing |

Solid client requests pass through `apiClient.ts`, the platform bridge, and the helper's custody
broker to the authenticated Node API. Node plugins own their SQLite and execution state. Loaded
plugins retain their permission-scoped worker and route boundaries. Events return through the Node
WebSocket, broker, client subscriptions, and visible stores. These optimizations belong at the
owning projection or lifecycle seam; they do not require core to read plugin tables.

The audit reads the documentation index, architecture and conventions, schedules, integrations,
data sources, dashboards, workflows and its execution and authoring documents, Memory, Findings,
and notifications. Relevant future material includes the future index, dashboards programme, and
compiled tier map. Runtime and source names above identify the inspected families; individual fixes
below identify the strongest source locations. Generic transport, plugin startup, cache persistence,
pane lifetime, agent execution, editor filesystem, and Docker concerns remain with reports 01-13.

## Baseline work to preserve

Git history establishes that this checkout includes the renderer lazy registration change
`6fd22355`, the architecture and recoverable reset work `efddc3b0`, workflow v2 `6734ce55`, and its
acceptance fixes. Workflow tasks and run watching, Findings review, event lifecycle, notification
contributions, and project Memory outside worktrees are part of the baseline, rather than proposed
performance work.

Source inspection confirms these useful mechanisms:

- The runner coalesces pending ticks, guards starting steps, and limits headless agent admission.
  Per-root tree limits and durable admissions remain separate safeguards.
- A workflow status edge mutates its row without fetching. Record loops use a paged projection
  instead of eagerly embedding every child summary in each step response.
- Node-wide run lists cap at 100. Run-count and navigation stores compare projections before
  publishing unchanged state. Their repeated backend reads still cost work.
- Workflow authoring debounces saves by 750 ms, uses revision conflicts, retains device recovery,
  and bounds undo history. Generation requires user action. Validation does not run record previews
  unless the author asks for them.
- Provider mirrors already join normal refreshes. Forced reads deliberately bypass a pre-existing
  refresh to obtain post-action data. Provider admission separates connection and provider limits.
- Data source responses enforce authority, identity, byte, record, page, and completeness bounds.
  Dashboard sampling and retention have explicit caps and cadence.
- Notifications react to state edges and retain a bounded notice ring. They do not interrupt on
  every token or every workflow event.

Do not replace these mechanisms with a second cache, more polling, parallel provider floods, or
background AI work.

## Measurement method and evidence

`14-node-probe.mjs` loads real production owners using `tsx` and real plugin SQLite migrations.
It creates disposable synthetic data, redirects Memory's home directory before source import, and
cleans up in `finally`. The SQL meter counts calls on the driver's prepared statements, rows
materialized, and the UTF-8 bytes of string cells selected. That byte count excludes numeric cells,
wire JSON framing, allocator overhead, and persisted write volume. Process CPU and wall time cover
the owner call, rather than fixture creation or module startup.

Renderer probes use Solid's browser build and jsdom. Subscription, read, and broker reply boundaries
are synthetic, while the scheduler, run model, draft store, workflow update API, and request delivery
owners are real. These probes measure admitted work and retained logical content. Their elapsed
suite times do not measure rendering latency.

| Owner and fixture | Before result | Evidence |
| --- | --- | --- |
| Memory, 300 files with 4 KiB bodies, cold reconcile | 300 file reads, 600 inserts and two deletes; 145.445 ms CPU, 125.008 ms wall | `14-memory-before.json` |
| Same Memory, five unchanged reconciles | 1,500 file reads, 6,319,900 bytes read, 3,000 inserts and 10 deletes; 540.508 ms CPU, 495.804 ms wall | Same artifact |
| Same Memory, four overlapping reconciles | 1,200 file reads, 2,400 inserts and eight deletes; 453.088 ms CPU, 357.346 ms wall; final 300 index and 300 full-text rows | Same artifact |
| Workflow task navigation, 10 roots and 1,000 historical child rows | Two selects, 1,010 rows, 33,292,920 selected string bytes; 100.225 ms CPU, 95.592 ms wall | `14-workflow-before.json` |
| Workflow Node-wide 100-run list | Three selects, 100 rows, 3,296,500 selected string bytes; 31.581 ms CPU, 28.899 ms wall | Same artifact |
| Five runs for one child task | Three selects, six rows, 197,756 selected string bytes; 0.883 ms CPU | Same artifact |
| Workflow selection, 300 children with four steps each, first 50 records | Six selects, 2,401 rows, 22,329,492 selected string bytes; 47.996 ms CPU, 33.526 ms wall | `14-processing-before.json` |
| Same selection, first 50 failed records | Same rows and bytes; 28.155 ms CPU, 26.712 ms wall; exact 150 failed and 150 completed counts | Same artifact |
| Client schedule held in flight, initial refresh and 30 edges | 31 calls, 31 simultaneously active, peak 31 | `14-client-schedules-before-v7.json` |
| Real run pane, 30 child edges with delayed reads | 30 runs reads and 30 steps reads | `14-run-pane-before-v7.json` |
| Run pane after viewing 12 runs, 200 stdout events per run | 4,928,680 logical text characters in event arrays, plus 4,000-character tail per step | Same artifact |
| Workflow editor cleanup after active Node A becomes B | Real update request for A's draft is delivered to Node B | `14-authoring-before-v7.json` |
| Reused draft store, A save acknowledgement after loading B | B's revision changes from five to two; B changes from clean to dirty | Same artifact |

The history fixture repeats 20 descendant task IDs per root across 100 run rows. Child admission
normally creates distinct task IDs. This is a historical volume envelope that exercises deduplication,
rather than a claim about the frequency of that exact execution pattern. Graph and definition bodies
use synthetic padding of representative size. No fixture reads private project data.

All authoritative renderer cases pass together: three files and four tests in 2.99 seconds. Eight
focused baseline files with 46 tests pass in 4.22 seconds. The verification record documents harness
refinements and excluded preliminary authoring artifacts. Preserve every before artifact.

The coordinator independently replays all four renderer cases and three Node cases. The renderer
suite passes in 3.04 seconds. Memory again issues 3,000 inserts and 10 deletes for five unchanged
passes at about 548 ms CPU. Navigation and processing select the same 33.29 MB and 22.33 MB of string
cells with identical answers. The six `14-*-coordinator-before.json` files preserve that replay.

## Findings

### [PERF-14-01] Reconcile Memory incrementally and join overlapping passes

- Evidence: `plugins/memory/src/server/knowledgeChannel.ts:49` discovers active task and checkout
  sources. Line 57 launches a separate reconciliation for each caller. Library, search, launch, and
  write paths use that owner.
- Evidence: `plugins/memory/src/server/memory.ts:92` reads each eligible file. Line 150 merges
  source winners, and lines 174-181 retain recall statistics, delete both projections, and reinsert
  every row and full-text entry.
- Evidence: `plugins/memory/src/server/findingsReview.ts:44` reconciles before reading candidates.
  Lines 141-142 and 163-164 each explicitly reconcile immediately before an `allRows` call that
  reconciles again. This compounds the unchanged work during validation and approval.
- Impact: Five unchanged reads rebuild 300 Memory rows and their full-text index five times.
  Multiple readers repeat filesystem and SQLite work together. The measured fixture consumes
  540.508 ms CPU for five unchanged reconciles. Natural overlapping passes retained the correct
  300 full-text rows in this fixture; duplicate full-text entries are not a reproduced finding.
- Effort: M, about one day for a database delta and request joining, with another day if a bounded
  file parse cache needs the full filesystem change matrix.
- Risk: MED. Files remain the source of truth. A shortcut can miss deletion, external edits, a
  newer checkout winner, authorization changes, or recall statistics updated during reconciliation.
- Confidence: HIGH for write and read amplification. MED for the extra benefit of file parsing reuse
  until an implementation is measured.
- Fix sketch: Give the knowledge owner one current reconciliation, with a generation barrier for
  explicit file writes. Discover authorized sources afresh, compare rows, and transactionally apply
  only index and full-text changes. Add a bounded file parse cache only when fresh file identity and
  change stamps prove reuse safe; do not cache source authorization or invent a stale time-to-live.

Start with the database delta if reliable file reuse adds too much complexity. It removes 3,000
inserts and 10 projection deletes in the unchanged fixture without weakening external discovery.
Transaction ownership must include both projections, while recall touches must survive the update.
Joining a pass after an explicit write must not acknowledge a snapshot taken before that write.

After gates:

1. Replay cold, unchanged, and overlapping cases through the knowledge owner. Unchanged passes
   issue zero index and full-text writes; overlapping ordinary reads share one current pass.
2. Check external file edits, addition, rename, deletion, missing and unreadable directories,
   atomic replacement, equal-size edits, and restored modification times with changed file identity
   or change time. Fresh discovery must observe topology and permission changes.
3. Preserve private and project scope, content IDs, newest-checkout winner, full-text search results,
   recall counts, and timestamps. Include a recall touch while reconciliation awaits filesystem work.
4. Interleave manual writes and Findings approval with a running reconciliation. The acknowledged
   file must be indexed, exact receipts must remain recoverable, and unloading must release state.

### [PERF-14-02] Select compact workflow history and navigation columns

- Evidence: `plugins/workflows/src/server/workflowRunProjection.ts:10` selects full 100-run rows,
  then returns scalar list fields. Line 45 selects full historical child rows before deduplicating
  by task; lines 52, 56, and 64 load full dispatch, source, and root rows for lineage.
- Evidence: `plugins/workflows/src/server/workflowRunReadModel.ts:26` and line 32 fetch full task
  and lineage rows. Lines 41-47 discard resolved graphs and authority fields after materialization.
- Impact: A compact rail projection materializes 33,292,920 string bytes for 200 descendants.
  The capped 100-run list still reads 3,296,500 bytes it mostly discards. Navigation's SQLite plan
  scans `workflow_runs` and uses a temporary tree for ordering. Repeated frames and polling multiply
  these costs without increasing visible information.
- Effort: S for explicit projections, several hours including existing read-model tests. M if SQL
  latest-per-task selection and an indexed query migration are needed after measuring the projection.
- Risk: MED. Lineage, reprocess ownership, root versus child cost, and offline cache seeds must stay
  exact. The run pane needs its frozen definition to draw the graph.
- Confidence: HIGH for selected volume and unused fields. MED for query-plan gains beyond projection.
- Fix sketch: Define typed scalar selects for the list, navigation, lineage, and usage consumers.
  Keep `defJson` where the run pane needs it, and leave full frozen graph and authority data in
  durable storage for execution and detailed consumers. Measure the narrower query before choosing
  latest-per-task SQL or a schema migration; use keyed lineage maps instead of repeated searches.

A compact select is the first fix. Adding an arbitrary history cap to task navigation changes its
meaning and drops historical descendant visibility. Removing durable graphs changes execution
recovery. Neither is required to avoid selecting unused columns.

After gates:

1. Replay all three owners. Navigation must return the same 10 groups, each with 20 descendants and
   20 attention rows, without selecting definition, resolved graph, or authority bodies.
2. The 100-run list must preserve ordering, status, terminal timestamps, error detail, unknown cost
   versus zero cost, and tree versus individual usage. Its SQL must omit execution bodies.
3. Task history must preserve frozen `defJson`, lineage, usage, and offline response shape. Exclude
   authority bodies that the response already removes. Keep full detail and result consumers intact.
4. Cover reprocess runs, missing lineage, deleted tasks, terminal and gated states, timestamp ties,
   restart, and source root ownership. Run `EXPLAIN QUERY PLAN` and compare CPU and bytes before
   adding an index. Add a migration rather than editing an applied migration.

### [PERF-14-03] Page workflow processing details before loading large results

- Evidence: `plugins/workflows/src/server/workflowProcessingReadModel.ts:151` loads every selected
  record snapshot. Lines 155-160 load all attempts, dispatch bodies, full runs, and full step output.
- Evidence: Line 165 maps every selected row and filters the complete step array for each run.
  Lines 172-181 calculate counts and only then filter and slice the requested page.
- Impact: A first page of 50 records materializes 2,401 rows and 22,329,492 string bytes from a
  300-child selection. Filtering to failures reads the same volume. Paging reduces response rows
  but does not bound backend detail reads. The nested step scan adds work proportional to selected
  records multiplied by fetched steps; its separate CPU contribution was not measured.
- Effort: M, about one to two days for a compact status pass, page detail selects, and fallbacks.
- Risk: MED. Counts apply to the whole selection. Missing run fallback, retry targeting, skipped
  decisions, provenance, and category cursors are behavioral contracts.
- Confidence: HIGH for detail overfetch. MED for the optimal SQL shape until plans are compared.
- Fix sketch: Compute exact categories from compact selected, attempt, dispatch, and run state.
  Choose eligible page IDs before reading snapshots and result previews. Read only required page
  fields and bounded prefixes, and group step summaries by run. Keep full named outputs and retained
  attempt details on the detail APIs that need them.

The detail result is not disposable. Canonical structured results can feed execution, capture, or
later inspection. Use SQL projections or prefixes only in UI summary reads, without truncating stored
results. A narrow pass over the whole bounded selection is acceptable when exact category counts
require it. Full graphs and output for every child are unnecessary for those counts.

After gates:

1. Replay both 50-record pages. Counts stay at 300 total, 150 failed, and 150 completed. The all page
   spans `item-0` through `item-49` with cursor 49; the failed page spans `item-1` through `item-99`
   with cursor 99. SQL detail bytes must scale with the page, rather than all children.
2. Preserve title and status fallback precedence, first failed retry step, bounded result preview,
   empty reasons, provenance, stable positions, and next-page semantics for every filter.
3. Test missing attempt, dispatch, run, and step rows; unadmitted, skipped, cancelled, live,
   safety-rail, and completed-with-failure cases. Include reprocessing and historical attempts.
4. Run processing store, retry, read-model, and route suites. Verify that full named outputs remain
   available and authorized through detail consumers, including after restart.

### [PERF-14-04] Coalesce client schedule and run-pane refreshes

- Evidence: `packages/client-core/src/host/registries/shell/schedules.ts:23` runs each refresh while
  visible, with no in-flight or pending flag. Timer, subscription, and visibility edges use it.
- Evidence: `plugins/workflows/src/client/runs/runStore.ts:38` reads both `allRuns` and
  `taskNavigation` per invocation. Its equality checks avoid unchanged downstream reactions, while
  backend work has already happened.
- Evidence: `plugins/workflows/src/client/runs/runPaneModel.ts:148` refetches runs and steps for each
  matching run, child, or reconnect edge. Step status updates at line 127 already avoid these reads.
- Impact: An initial held schedule plus 30 edges produces 31 simultaneous calls. Thirty child
  frames produce 30 runs and 30 steps reads through the real pane owner with 25 ms synthetic read
  delay. The schedule fixture uses a held synthetic contribution, so it does not claim 62 actual
  workflow backend requests. The workflow contribution's two-read fanout is source evidence.
- Effort: S-M, several hours for schedule joining and a day if pane resource ownership changes.
- Risk: MED. Dropping an event that arrives after a read's snapshot can leave the UI stale.
  Independent schedule owners and ordinary shared observers must retain independent lifetimes.
- Confidence: HIGH for redundant admission and read counts.
- Fix sketch: Let each owner run one refresh at a time. Mark intervening edges dirty and perform one
  follow-up after settlement, preserving further edges during that follow-up. Qualify async results
  and APIs by originating Node and resource generation. Dispose pending follow-ups, retain visibility
  and capability predicates, and handle synchronous throws and rejected promises.

Coalescing is not cancellation of a shared request. Another observer might still require it. Keep
joining local to the declared refresh owner, and use generation checks to prevent stale publication.
Continuous events may require more than two reads over time. The bound is one active read and one
pending edge per owner, rather than two reads for an arbitrarily long stream.

After gates:

1. Replay the initial held schedule and burst. Peak active runs becomes one. Release the first read
   and drain the one dirty follow-up. Verify an edge during the follow-up triggers another read.
2. Exercise two schedule contributions, hidden and visible transitions, capability filtering,
   synchronous throw, rejection, later recovery, reconnect, and disposal while the first read waits.
3. For the run pane, insert a child edge after the first mocked snapshot and verify the final rows
   include it. Switch selected run and Node, then dispose before delayed settlement. No outgoing
   owner may publish to the replacement or issue a later read through its API.
4. Keep step-status edges fetch-free. Verify commands still get a final authoritative refresh, and
   no ordinary observer cancels another observer's request.

### [PERF-14-05] Remove unused workflow stream copies and bound run-owned live state

- Evidence: `plugins/workflows/src/client/runs/runPaneModel.ts:56` retains event and tail dictionaries
  keyed by step. Line 116 changes selected run without retiring older run entries.
- Evidence: Line 139 stores the complete event in a 200-event ring, then line 142 separately stores
  a 4,000-character output tail. `NodeDetail.tsx:86` filters stdout, stderr, and managed-agent events
  out of the generic event display. Command views use the tail or canonical step result.
- Impact: Viewing 12 runs with 200 approximately 2 KiB stdout chunks retains 4,928,680 logical text
  characters in raw event arrays. Each run also retains its bounded tail. An event count does not
  bound bytes, and a per-step bound does not bound the dictionary across run selections.
- Effort: S for excluding unused stdout and stderr copies, several hours including consumers.
  M for an explicit nonvisible run retention policy, about one day including revisit behavior.
- Risk: MED. Output, unknown event inspection, revisit state, and durable execution results have
  different owners. Removing canonical result data would break consumers.
- Confidence: HIGH for retained logical text and unused stdout event display. MED for actual heap
  benefit until a retained-heap probe measures the after implementation.
- Fix sketch: Feed stdout and stderr directly into the bounded tail without also storing them in
  the generic event ring. Give live event and tail state an explicit run ownership and byte budget,
  retaining currently visible state and a small documented history budget. Reload authoritative
  details on revisiting a retired run; retain full canonical outputs and unsent authoring recovery.

The first change removes text that no event view displays, without changing the tail. Byte bounds
for unknown event views and nonvisible history need an explicit overflow policy and an indication
when the UI no longer has every live event. Report 07 owns host pane lifetime; this finding concerns
run entries inside one retained workflow pane.

After gates:

1. Replay the stdout fixture. Generic event arrays no longer retain these 4,928,680 characters.
   Every step's tail must remain exactly the last 4,000 characters, including chunk and line edges.
2. Test stderr, mixed event types, managed-agent references, unknown large events, selection changes,
   revisit, selected run deletion, reconnect, and model disposal. Inspect all consumers of `eventsFor`.
3. Use an actual retained-heap comparison after repeated run selection to establish memory savings.
   Measure allocation or CPU separately if changing object dictionary publication.
4. Full canonical results must still feed execution, capture, inspection, and retry. No persisted
   result or unsent draft may be truncated to satisfy a UI tail budget.

### [PERF-14-06] Bind workflow saves and acknowledgements to their originating owner

- Evidence: `plugins/workflows/src/client/editor/draftStore.ts:234` chooses `activeNodeId()` at save
  time. Line 242 calls the ambient workflow API, and lines 258-262 apply the acknowledgement to
  revision and saved state without checking the loaded definition generation.
- Evidence: Line 274 saves dirty state during cleanup. `workflowsClient.ts:165` calls its update
  helper without an explicit Node target. `apiClient.ts:145` uses the selected Node by default.
- Evidence: `packages/client-core/src/infra/node/activeNode.ts` and fleet provider ownership change
  the selected Node before the outgoing provider is cleaned up. `WorkflowsBrowse.tsx:316` keys
  ordinary definition navigation, so it mounts a fresh editor for that route.
- Impact: With connected synthetic Nodes, the real update API delivers A's cleanup draft to Node B.
  This can produce an error or target a same-ID definition there. A separate reused-store probe
  accepts A's delayed acknowledgement into B, changing revision five to two and clean state to dirty.
  The second case is conditional store reuse, not a demonstrated failure in ordinary keyed browsing.
- Effort: M, about one day for explicit client ownership, captured save inputs, and recovery races.
- Risk: MED. Unsent device recovery and revision conflict behavior must survive disposal, offline
  Nodes, retries, file authoring, and overlapping edits.
- Confidence: HIGH for the actual cleanup request's destination. HIGH for the reused-store race,
  with its route limitation stated above.
- Fix sketch: Capture Node identity when creating the editor owner, and provide a Node-qualified
  workflow client for reads and writes. Capture entity, target, definition, and base revision before
  each await. Acknowledge the exact originating recovery copy, and publish revision or saved state
  only when the loaded owner and save generation still match.

This is a correctness prerequisite for performance reuse. It avoids retries, false dirty state,
and wrong-Node writes while retaining recovery. Coordinate the explicit client shape with reports
07 and 12; do not add another transport layer or relax broker custody.

After gates:

1. Adapt the authoring probe to require cleanup delivery to Node A after active Node becomes B.
   Use the real update API and broker boundary. Test identical definition IDs on both Nodes.
2. The reused-store delayed acknowledgement must leave B at revision five and clean. Also test an
   edit made while the same entity saves: a successful save of version one must not clear version two.
3. Keep recovery under the originating Node and entity, preserve unsent data on failure, and only
   acknowledge the exact base revision and definition. Test offline cleanup, reconnect, revision
   conflict, failed update, dispose, and a recovery write newer than the response.
4. Qualify load, validation, catalog, generation, file review, and publication results by owner where
   they publish editor state. Run definition, recovery, file authoring, publication, and route suites.
   Verify a real desktop Node switch with an unsaved draft.

## Adjacent paths and ideas not selected for implementation

### Node scheduling and execution

The scheduler keeps one unreferenced timer, per-key serialization, four concurrent runs, and a
20-run ring. Declared plugin schedules retain their count and cadence limits, jitter, backoff, and
one catch-up policy. User schedule confirmation, durable occurrences, timezone cursors, and workflow
dispatch admissions cannot be relaxed to save writes. The four core schedules include daily audit
pruning and idempotency sweep, hourly dashboard sampling with a 120-second timeout, and daily
history compaction. Optional provider usage work belongs to report 09.

Runner ticks, headless admission, shutdown abort, recovery, and child dispatch already have owning
guards. There is no measured justification for a polling runner, parallel admission rewrite, or
in-memory replacement for durable cursor and dispatch state. An uncooperative callback can outlive
an abort until timeout; that behavior is an execution isolation question, not evidence that changing
schedule cadence improves CPU. Loaded worker execution remains report 02's boundary.

### Integrations and typed sources

`resourceRuntime.ts:40` rereads the connection before credential use. Needs-auth and disabled
connections can expose permitted cached rows without outbound refresh, and `requireFresh` refuses
that fallback. `sync/engine.ts:33` joins normal refreshes and clears its promise in `finally`.
Forced reads deliberately bypass a pre-action refresh. Coalescing force with that promise can
return pre-action data, so this audit rejects it.

`budgetRuntime.ts` holds per-provider and per-connection semaphores. It obtains a connection slot
before the provider slot to avoid one busy connection consuming all provider admission. These
ordinary shared mirror refreshes must not be cancelled by a departing observer. Expired rate-limit
backoff keys and semaphore metadata are candidates for a later measured churn probe; no retained
heap or realistic cardinality measurement supports a fix here.

`dataSources/runtime.ts:101` authorizes each invocation and reauthorizes paged queries at line 156.
It validates the registered source identity, schema revision, cursor, record identity, and bounds.
Limits include 100 pages, 5,000 selected records, 16 MiB total selection data, 256 KiB per record,
1 MiB detail, and a 60-second query budget. `dispatch.ts` races the full body read against abort,
caps accumulated chunks, cancels the reader, and removes its listener. Removing checks or increasing
bounds is not an optimization.

`selection.ts` stores at most 16 ephemeral selections within the aggregate byte budget, expires them
after 60 seconds, and cleans expiry on the next call. A bounded selection can remain allocated
while idle until another call. This is a stated retention bound, rather than evidence of a leak.
An extra sweeping timer is not justified without an actual idle memory problem. Discovery source
metadata can accumulate until plugin unload, but this audit does not measure its cardinality.

### Dashboards and query authoring

Published panels capture their Node and query scope, share TanStack state, use a 30-second stale
period, and forward query cancellation. They do not add an independent background poll. Each query
does resolve, describe, then execute in sequence. Execution also validates the description at the
Node boundary. A same-operation validated-description reuse could reduce duplicate work, but it
needs a provider fixture showing actual calls and a freshness contract. A cross-request description
cache could hide changed permissions or revisions, so no cache is proposed.

`PublishedDashboardPanel.tsx:20` clones adapter data before typed projection. It prevents reactive
adapter bookkeeping from leaking into protocol processing. No measured allocation or visible panel
profile demonstrates that replacing it improves performance. Preserve that plain-data boundary if
a later profile identifies it as a hot path.

The hourly sampler caps a pass at 200 panels, propagates its signal, reports overflow, and skips a
panel when a source is unavailable. It does not record a fake zero. Queries run sequentially under
existing provider admission. History keeps an hourly window, daily compaction, and a 1,000-sample
cap. These low-frequency, bounded paths do not merit a broad SQL or parallelism rewrite from this
audit's evidence.

Dashboard authoring retains device recovery and revision conflicts. Overlapping create/save flushes
remain a source lead: before implementing a serialization change, hold the first draft save, edit
again, complete a second save, then release the first response. Assert published revision, dirty
state, and recovery still describe the newest edit. This case was not run, so it is an investigation
recipe rather than an additional proven finding.

### Findings, memory context, and notices

Findings preparation uses durable jobs, leases, checkpoints, target fingerprints, bounded model
input, and a bounded correction attempt. No model work was exercised or added. Repeated Memory
target reconciliation is covered by finding 14-01. Historical Findings checkpoint projection and
task-load scans remain unmeasured startup leads, which need measured cardinality before selection.

Memory's active source path deduplication has quadratic source comparison, but file and index rebuilds
dominate the measured fixture. The SQL projection and repeated reconciliation are the selected fixes.
Notification state, limited notice history, delayed interrupt gate, and attention projection provide
no measured case for replacing their architecture.

## Future compatibility

The proposed fixes retain typed host UI, provider-owned records, scoped capabilities, and plugin
storage ownership. They reduce projection work without pulling workflow tables or file authority
into core. This leaves compiled-to-loaded plugin movement and worker containment viable.

The dashboards programme records taskless SQL and provider write-back as proposals. Fresh authority,
schema revision, completeness, and post-mutation forced reads remain necessary if those proposals
ship. A saved permission decision, credential, refusal, or pre-action forced refresh is excluded.

Node-qualified workflow clients and recovery make multiple independent Nodes and remote hosts easier
to support. Compact read models leave full execution definitions in durable storage. Incremental
Memory keeps external files authoritative. Tail budgets apply to disposable display state. None of
these changes requires discarding offline rows, approved history, unsent work, or exact-once state.

## Implementation order and handoff

Implement source-owned compact workflow selects first, then processing page detail reads. Both have
direct row and byte gates. Implement Memory index deltas and joined reconciliation separately, with
filesystem freshness tests. Bind workflow authoring to its Node before changing async reuse. Follow
with client refresh joining and unused stream-copy removal. Coordinate shared lifecycle changes with
reports 07 and 12, and keep each fix reviewable on its own.

Use these commands sequentially while builds and other probes are idle:

```sh
rtk proxy node --expose-gc --import tsx plans/performance/14-node-probe.mjs memory coordinator
rtk proxy node --expose-gc --import tsx plans/performance/14-node-probe.mjs workflow coordinator
rtk proxy node --expose-gc --import tsx plans/performance/14-node-probe.mjs processing coordinator
rtk proxy env ACORN_PERF_TAG=coordinator pnpm exec vitest run --config plans/performance/14-probe.config.ts
rtk proxy pnpm exec vitest run --config plans/performance/14-existing.config.ts
```

Node probes default to `sample` without a tag. Renderer probes use `ACORN_PERF_TAG`, also defaulting
to `sample`. Before tags reject overwrite. The renderer assertions characterize the baseline and
need the stated invariant changes for after verification. A coalesced scheduler probe must drain
the dirty follow-up, rather than release only the baseline's batch of concurrent promises.

After each implementation, point the probe at the production owner if code moves. Record rows,
selected bytes, file reads and writes, CPU, and retained heap as appropriate with a distinct after
tag. Preserve exact answers and behavioral gates before interpreting timing. Run relevant owner
tests and `pnpm lint`, then use the isolated real Tauri window for visible interaction and Node-switch
checks. Finish with a bounded mixed-workload soak that alternates tasks, run histories, workspaces,
and plugin panes; compare settled CPU and retained memory at repeated plateaus.

The audit did not call providers, run model turns, collect a release-correlated Sentry trace, measure
visible desktop latency, or complete a multi-day soak. Sentry's uncertain release attribution and
the hidden live renderer do not establish checkout performance. Those limits leave the measured
operation reductions actionable while keeping all-day and visible snappiness claims for verification.
