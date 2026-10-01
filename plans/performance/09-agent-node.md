# Agent Node performance audit

Baseline: `f8e4b59c`, October 1, 2026. Application source remained read-only. The probes use synthetic
records, disposable plugin databases, fake harnesses, and disposable executables. They never invoke
a real provider, inspect a normal profile or private transcript, or perform paid agent work. The
isolated Tauri session was left alone. All ten synthetic child and grandchild processes from the
native process probe were explicitly cleaned up; its final live-PID count is zero.

The main handoffs are to make process ownership survive startup failure, admit queued work before
starting a provider, query the durable queue without visiting every idle session, and reduce repeated
indexing of growing message heads while preserving exact active-session search. The wait path needs
both narrower reads and a correctness repair for completion outside its bounded first event page.

## Scope and source-to-consumer flow

The Agents Node plugin owns agent profiles, harness drivers, its runtime, `agents.sqlite`, durable
session events and projections, delegation, artifacts, and plan-usage collectors. Core owns tasks,
worktrees, user preferences, credentials, identity, environment resolution, and schedules. The plugin
uses CoreServices and contribution/capability contracts; these databases must not be joined across
the boundary. A Node owns its execution environment and data independently of the current client pane.

The inspected flow is:

1. `plugins/agents/src/node/index.ts:119` constructs the usage service and `:150` supplies the runtime
   with the current Node owner. Its routes and capabilities expose managed agents, execution,
   delegation, local usage, and contributed harnesses. Registration and disposal belong to this
   plugin owner, rather than to an individual conversation mount.
2. `server/drivers/registry.ts`, `server/harnessRegistry.ts`, and `server/profiles/` resolve built-in
   and contributed harnesses. Contributed probes have a five-second abort budget. Built-in Codex
   startup also probes executable/authentication status; ACP imports its SDK lazily when starting.
   The scoped environment and MCP servers arrive through the existing Node/tool seams.
3. `server/sessions/runtime.ts` accepts commands and writes durable queue state before asynchronous
   startup. `runtimeEngine.ts:358` owns live handles, startup promises, active turns, reconnects,
   quiet-child timers, and queue wakeups. `:587` pumps durable heads and enforces shared workspace
   and provider limits. Fairness gives workflow work a chance after five interactive/automation turns.
4. ACP and Codex adapters normalize provider events and tool/MCP interactions. ACP awaits event
   callbacks; Codex notifications initiate callbacks without awaiting them. The runtime's durable
   buffer serializes persistence. Parked ACP requests drain on cancellation, completion, and stop;
   JSON-RPC requests have timers and reject on closure. F09-1 concerns the actual process owner and
   startup boundary, not worker IPC or terminal sessions owned by areas 02 and 04.
5. `server/sessions/providerEventMaterializer.ts:6` limits inline tool data to 64 KiB and promotes
   oversized output/patches to artifacts; generated artifacts have a 16 MiB bound. Assistant and
   reasoning streams have no corresponding whole-message cap. `durableEventBuffer.ts:95` persists
   compatible text together after 40 ms or 16 KiB, flushing before incompatible events and at stop.
6. `sessionRepository.ts:94` records canonical normalized `eventJson`, sequences, session state,
   turn/request projections, and search text transactionally. `:183` appends continuing text to a
   previous message head's `search_text`. Migration `0005_agent_events_fts_messages.sql:82` deletes
   and reinserts that entire head in FTS on every search-text update. Continuing canonical event rows
   still exist; their search text is null. The index stores full message documents, not independent
   text fragments, with Porter/unicode61 tokenization and lower tool-text ranking weight.
7. `store.ts:160` snapshots return a bounded event prefix but all session turns and requests.
   `:205` supplies bounded, sequence-keyed event pages. Search uses the plugin's FTS tables and
   CoreServices to scope task/workspace visibility. `runtime.ts:875` waits by repeatedly reading a
   snapshot; execution and delegation consume the resulting records and state.
8. `runtimeEngine.ts:756` persists an event, broadcasts its event frame and changed turn/request,
   and broadcasts a session row only when the projection changes. `:808` strips search text for
   clients. `server/routes/managedBridge.ts:116` folds usage, optionally folds tool updates, and strips
   search text from HTTP snapshot/event replies. Raw workflow/export owners deliberately keep their
   distinct contracts. Node HTTP/WS replies pass through authentication/TLS custody, the helper
   broker, client-core, and the Agents store. Area 08 owns client asynchronous completion and DOM costs;
   area 05 owns transport encoding and fanout.
9. `server/usage/service.ts:105` keys usage by user and pricing fingerprint, already shares matching
   in-flight refreshes, and has a five-minute TTL. It preserves previous success on collector errors.
   Quota continuation uses a fresh provider collector through `:126`, rather than a stale TTL read.
   `node/index.ts:263` registers unattended refresh every 30 minutes, disabled by default. Visible
   client usage consumers poll on a five-minute interval and release their timer when unused.
10. `usage/claudeUsage.ts:330` captures a `/usage` PTY session, then analyzes local daily usage.
    `claudeDailyUsage.ts:163` recursively lists/stats recent JSONL files, accepts at most 2,000 files
    and 32 MiB per file, then reads/parses every selected file, deduplicates messages globally, and
    sorts/aggregates today's and yesterday's records. Codex usage owns a separate read-only
    app-server RPC capture with time/byte bounds and a PTY fallback.

Inspected modules also include `boundProviderEvent.ts`, `sessionExecute.ts`, `managed.ts`,
`delegation/service.ts`, `delegation/readProjection.ts`, `delegation/reports.ts`, `usage/collectors.ts`,
`usage/codexUsage.ts`, `usage/processRunner.ts`, the driver protocol/normalization modules, MCP tool
integration, plugin schema/migrations, and relevant owner tests. Documents read include the index,
architecture, conventions, data layer, managed agents, agent tools/MCP, schedules/client surfaces,
and indexed future Kimi, message, and sandbox material.

## Prior work retained

The inspected history includes `b59f530b` lazy ACP loading, `027d3f47` conditional session-row
publication, `1048c4ab` roster isolation from streamed events, `10408650` removal of search text from
client events, `d7edb5d5` optional Node tool folding, and the bounded snapshot/resume work present on
the baseline. The current source already coalesces text at 40 ms/16 KiB, folds tool/usage replies,
bounds event pages to 2,000, loads provider implementations lazily, and bounds usage PTY output to
2 MiB with 20-second total and three-second idle deadlines. Its shipped SIGHUP then two-second
SIGKILL escalation fixes an ignored polite signal for the directly owned PTY child.

None of these is proposed again. F09-1 identifies startup cleanup, acknowledged exit, and a measured
grandchild that survives the existing native PTY escalation. It does not claim the old direct-child
escalation is absent. Event page indexes and current client event stripping also work as intended.

## Reproducible evidence

All probes import production owners. The runtime probe uses the real store/runtime/migrated SQLite
database with a fake driver; it counts actual prepared statements and live handles. The ledger probe
calls actual `recordEvent` for already coalesced-size chunks. The wait probe calls actual `wait` and
counts actual snapshot reads/mapped rows. The daily probe reads synthetic files through the actual
analyzer/parser. The native process probe uses actual ACP, JSON-RPC, Codex startup, and the default
`node-pty` spawner with disposable Node children; only the separate argv probe injects a fake PTY.

Run from the repository root:

```sh
rtk proxy env ACORN_PERF_TAG=sample pnpm exec vitest run --config plans/performance/09-probe.config.ts
```

The default output tag is `sample`; replay does not overwrite preserved `before` results. The
configuration limits execution to one worker. Files `09-*-probe.test.ts`, `09-owned-child.mjs`, and
`09-probe.config.ts` are the retained harness. `09-verification-before.txt` records the audit runs.
The coordinator independently replayed all seven cases in four files with tag `coordinator-before`:
all passed in 19.62 seconds. Those seven JSON outputs are also preserved. Current characterization
assertions deliberately demonstrate baseline behavior; implementation regressions must assert the
corrected invariant instead of preserving the bug.

Selected before results:

| Actual owner and synthetic load | Preserved observation |
| --- | --- |
| `queuedHeads`, no queued turns, 100 / 1,000 / 5,000 sessions | 101 / 1,001 / 5,001 statements each pass; median wall 13.17 / 81.42 / 415.83 ms across three reads. |
| Runtime with 20 queued cold sessions, limit two | 20 fake handles launched and held, two active turns; canceling a blocked queued turn does not dispose its handle. |
| Concurrent provider discovery, one fake harness | 20 callers cause 20 probes on a cache miss; a subsequent completed-cache read causes none. Fake delay is not real provider latency. |
| Message head, 16 / 64 / 256 commits of 16 KiB | 256 KiB / 1 MiB / 4 MiB final text; actual record wall 52.07 / 625.36 / 11,385.77 ms; process CPU 50.58 / 534.06 / 9,756.76 ms. |
| Same growing head | Logical cumulative text presented to head rewrites: 2.23 / 34.08 / 538.97 MB. These are derived string sizes, not measured disk or syscall bytes. |
| Indexed event page for the above loads | 0.53 / 1.66 / 5.22 ms wall; plan uses `agent_events_session_seq_idx`. Four-MiB raw page JSON is 8,447,920 bytes; existing client stripping reduces it to 4,249,010 bytes. |
| Wait, 101 event frames, zero / 1,000 prior completed turns | Both cause 105 snapshot reads and 5,153 event-row mappings. With prior turns, 104,000 turn-row mappings; wall 84.55 / 327.93 ms; returned JSON 23,471 / 1,345,140 bytes. |
| Wait after 502 committed events | Only first 500 events returned; terminal completion beyond that prefix is absent. |
| Session roster, 20 rows with same timestamp, page limit five | First page five, cursor `1000`, next page zero; 15 existing sessions omitted. |
| Daily usage, unchanged 1 / 40 / 200 files of 1,000 records each | Before-v3 median wall 3.01 / 63.64 / 346.52 ms; 0.18 / 7.25 / 36.54 MB read and 1,000 / 40,000 / 200,000 records parsed on every refresh. |
| Daily usage, same 200-file history, one append / one replacement | 326.64 / 328.68 ms wall; 338.50 / 340.38 ms process CPU. Both mutation answers are asserted. |
| Daily usage, one accepted 19,000,000-byte file, 200,000 valid compact records | Parser returns 200,000 records; analyzer reports one skipped file and no sessions, due to the spread argument limit. |
| Actual RPC stop; synthetic child ignores SIGTERM | Returns in 0.16 ms marked closed; child and grandchild still alive 150 ms later. |
| Actual ACP stop; synthetic child ignores SIGTERM | Stop still unsettled at 150 ms; child and grandchild alive until explicit audit cleanup. |
| Actual ACP/Codex initialize rejected | Startup rejects while its owned child and grandchild remain alive. Codex executable is the disposable fake. |
| Actual native usage PTY escalation | Child gone after escalation; synthetic grandchild still alive. Shortened 30 ms grace exercises the same owner path. |
| Separate audit cleanup | Ten recorded processes, ten explicit final SIGKILL attempts, zero remaining live PIDs. |

Queue results above use `09-runtime-before-v2.json`; ledger results use `09-ledger-before.json`;
wait/cursor results use `09-wait-before.json`; daily timings use `09-daily-before-v3.json`, with
argument-limit evidence in `09-daily-spread-before.json`; process results use
`09-process-before-v4.json`. Earlier before/v2/v3 files remain intact. Measurements are short source
stress tests, not a day of use or visible UI latency. Process CPU includes associated callbacks/GC;
RSS differences are endpoint samples, not peak allocation or retained heap measurements.

## Findings and implementation handoffs

### F09-1 — Own provider processes before initialization, through bounded teardown

**Priority high; confidence high; effort medium to large; risk medium.**

`drivers/acpDriver.ts:256` spawns before `:295` initialization, with no enclosing startup cleanup.
`drivers/codexDriver.ts:256` initializes before the later thread-start cleanup catches. Both actual
startup paths leave the synthetic process pair alive after rejection. `jsonRpcProcess.ts:118` marks
itself closed and sends one child signal without joining exit or escalation. ACP `:468` can wait for
closeSession before signaling, and `:472` waits without a deadline for connection closure. Codex
`:436` can spend the default request timeout waiting to unsubscribe before its similarly incomplete
stop. Runtime `runtimeEngine.ts:863` awaits these handles, so a hanging owner can delay Node teardown.

The actual native `capturePty` probe also proves a normal, non-detached synthetic grandchild survives
the directly owned child's escalation on this macOS/node-pty build. It does not characterize detached
descendants, Windows jobs, or every provider's process topology. No fake `child.kill` wrapper is used
for that result. The ten-PID explicit audit cleanup is separate from production stop behavior.

**Fix sketch:** create a lifecycle owner at the actual spawn boundary, accessible before a ready
driver handle exists. Join all startup throw/timeout/abort paths to its cleanup. Bound protocol close
and unsubscribe separately, then signal, escalate if needed, and join actual exit. Preserve pending
request rejection and ACP parked-request draining. Define an owned process-group/job contract in the
platform launcher for provider and read-only usage children; do not kill arbitrary ambient processes
by command name or infer ownership by a broad PID search. Keep task environment/MCP capabilities
scoped and account for process reuse. Include the Codex usage app-server owner (`usage/codexUsage.ts`)
in the implementation review; its one-signal cleanup is source evidence, not separately measured here.

**Fail-before gate:** rejected initialize, hanging initialize/close, ignored SIGTERM/SIGHUP, pending
RPC/request state, and teardown during startup must leave zero owned children and timer/listener
state within the chosen documented shutdown budget. Exercise actual native launchers and assert
real exit acknowledgment, including a normal grandchild. Use platform-specific tests for supported
groups/jobs. Do not substitute `closed === true` for process exit or rely on the audit's external
cleanup to pass. Preserve cancellation versus unknown provider acceptance/recovery semantics.

### F09-2 — Admit queued turns before starting cold provider handles

**Priority high; confidence high; effort medium; risk medium.**

`runtimeEngine.ts:624` calls `ensureSession` before the workspace/provider checks at `:634`.
The public enqueue path also calls `ensureSession` directly at `runtime.ts:424` before pumping;
changing only the pump would leave that queue-driven eager startup in place. The probe seeds durable
turns through the store and exercises the real pump. Twenty cold queued sessions launch 20 held
handles while only two turns are active (provider ceiling two, workspace ceiling three). Raising
both ceilings to four dispatches two more. After completions, the fifth
interactive turn precedes workflow `s19`, demonstrating the existing fairness policy. Canceling a
blocked turn leaves all 20 handles held with no stop calls. Lowering limits to one leaves four
already accepted turns running and dispatches no additional work. These are virtual handle counts,
not measured native RSS or a claim that 20 real processes were launched by this fixture.

**Fix sketch:** route queue-driven cold starts, including enqueue and restart recovery, through one
admission owner. Resolve workspace identity through core, check/reserve both ceilings before startup,
and release reservations on failure, cancellation, or teardown.
Account for pending starts and active turns consistently so concurrent commands cannot exceed the
same ceilings. Recheck durable eligibility before send. Preserve the API's explicit ready-on-return
session creation and configuration negotiation; they can legitimately start an interactive handle
without a queued turn. Enqueue remains accepted once its turn is durable; later startup failure must
not turn that accepted command into a false HTTP failure. This fix should avoid unnecessary cold
starts, not indiscriminately terminate every idle handle and risk provider context/session loss.

**Fail-before gate:** the 20-session fixture launches only admitted cold handles, and the public
enqueue path obeys the same gate; queue cancellation before admission launches none. Cover shared
workspace and provider ceilings, pending-start races,
raises, non-destructive lowering, `notBefore`, mixed sources, startup rejection, and Node stop.
Retain one active turn per session and the measured five-interactive fairness rule. A restart must
recover durable queue state without making queued work depend on a mounted Agent pane.

### F09-3 — Read queued heads from the durable queue in bounded query work

**Priority high; confidence high; effort medium; risk low to medium.**

`store.ts:610` fetches every nonarchived Acorn-controlled session and calls `nextQueuedTurn` once per
row. Empty queue reads therefore use `1 + N` statements and exceed 400 ms for 5,000 synthetic sessions.
The pump is **edge triggered**, on enqueue, provider startup/turn settlement, startup reconciliation,
limit raises, and timed queue/usage wakeups. Ordinary text frames do not invoke this scan. Multiple
passes can still occur for one edge; `pumpRequested` deliberately rescans when work arrives during a
scan. The measured cost must not be described as a full-session scan on every text frame.

**Fix sketch:** query eligible queued turn heads and their owning plugin sessions together, choosing
the earliest queued ordinal per session, with a bounded number of statements. Inspect the resulting
plan before adding an index; the existing session/status index supports current per-session lookups.
An alternative filter using maintained `queuedTurns` needs a specified durable recount/recovery
path, since drift must not hide work. Keep workspace resolution in core and do not introduce a
cross-database join or an in-memory-only authority.

**Fail-before gate:** empty queues with 100/1,000/5,000 idle sessions require a constant number of
statements; compare actual query wall/CPU. Mixed queued/running/completed/canceled turns produce
exactly one correct head per eligible session. Preserve archived/controller filtering and the earliest
queued ordinal even when that head is deferred; do not dispatch a later turn around `notBefore`.
An enqueue during an empty scan must trigger the existing rescan. Replay fairness/admission tests.

### F09-4 — Remove repeated full-head indexing without weakening live search

**Priority high for large streams; confidence high in cost, medium in proposed design; effort large;
risk high because search and migration semantics cross persisted projections.**

`sessionRepository.ts:210` concatenates a delta onto the full head. The update trigger at
`migrations/0005_agent_events_fts_messages.sql:82` deletes and reinserts that full document. For fixed
16-KiB commits, cumulative head sizes grow as `chunkBytes × n(n+1)/2`: a four-MiB message presents
538.97 MB of text to repeated head/index rewrites. Actual production repository writes take 11.39 s
wall and 9.76 s process CPU in this stress case. Search after the fixture completes takes only 1.87 ms
for three documents, and event reads use the expected sequence index. The evidence concerns write
amplification of a long head, not a generally slow FTS query or a missing event-page index.

The measured cadence is one sequential production repository write per already coalesced-size chunk,
then a search after each completed fixture. It does not measure a real provider rate or a query on
every commit. Whole-message assistant text is not capped by the tool materializer, so this input is
accepted, but the fixture is a stress envelope rather than a typical response.

**Fix sketch:** give the derived message/search projection one controlled owner. One design to
evaluate stores append progress and a durable dirty sequence, coalesces projection work, and catches
up through the committed sequence before *every* search that could include the active head. Stream
close also flushes. This can reduce repeated work when persistence outpaces actual searches; if
search occurs on every commit, its barrier may retain the same cost. Measure that tradeoff before
claiming a throughput improvement. A different representation must prove equivalent full-document
semantics before replacing this design.

The owner must preserve canonical durable event rows and all text, manage the FTS content and
insert/update/delete triggers together in a new appended migration, retain head/event/session
identity, and rebuild from the ledger after interrupted projection or corrupt/missing derived data.
Do not edit an applied migration. Inventory raw/internal `searchText` consumers and exports before
moving its storage contract; client stripping alone does not prove every internal reader is free to
change. A query barrier must account for all dirty documents affecting ranking, not only the first
matching session.

**Fail-before gate:** benchmark the replacement production writer/projector/query path with the same
16/64/256 chunks and actual query cadence, plus queries between mutations. Assert words split across
delta boundaries, phrases, prefixes, tokenization/Porter stemming, active-head freshness, exact result/order
and previews, tool-versus-conversation weighting, task/workspace/archive scope, and tie behavior.
Cover interleaved streams, turn/message boundaries, tool events, delete/clear, restart before/after
projection commit, old database migration, and index recovery. Canonical events and sequence/page
reach must match before and after. Final-only indexing, arbitrary chunk rollover, or an asynchronous
delay without a query barrier are not equivalent fixes: they can change phrases, ranking, or current
head results. The current timing probe alone does not establish those equivalences.

### F09-5 — Narrow wait checks and preserve completion/result reach beyond one page

**Priority high; confidence high; effort medium; risk medium.**

`runtime.ts:901` reads a full snapshot on each relevant session event/turn/request/row notification.
Each read fetches all turns and requests (`store.ts:160`) and the same event prefix after the original
cursor. With 101 synthetic frames and 1,000 prior turns, 105 reads map 104,000 turn rows and 5,153
event rows, costing 327.93 ms wall/345.54 ms process CPU. This applies to active wait/execution or
delegation consumers, not every idle session. Concurrent checks can overlap, and timeout/gap closure
add reads. Existing snapshot bounds limit event rows but do not limit repeated turn hydration.

Separately, `runtimeEngine.ts:828` detects completion in `snapshot.events`; the fixed default prefix
holds only 500 events. The 502-event fixture contains terminal completion but the returned prefix
does not. `sessionExecute.ts:201` waits from the same pre-turn cursor, and `:35` builds its result from
that returned prefix. Delegation `service.ts:254` uses the same wait and recomputes matched status from
its returned records. A faster implementation must not retain missed completion or truncated result
capture as its contract.

**Fix sketch:** check wait conditions through narrow authoritative state and qualifying event facts
after the requested cursor, with at most one check in flight and a dirty/rescan flag. Preserve the
initial-read/listener gap closure. Read a return snapshot only when the condition/timeout warrants it,
with an explicit result/completeness contract. Execution must collect the complete target turn's
assistant/result stream through bounded pages before capture/schema parsing, rather than raising a
global snapshot limit or treating the first prefix as the whole answer. Review delegation matched
calculation together with the wait contract; don't hide a terminal fact solely in a server-only flag.

**Fail-before gate:** the wait fixture has bounded checks independent of irrelevant prior-turn count;
completion after 500 and after 2,000 rows resolves correctly. A result spanning the boundary is exact
before schema parsing. Cover request/attention/ready/stopped conditions, late usage, timeout, initial
gap, deletion, cancellation, teardown, multiple waiters, and events after an old completed turn.
Do not resolve a cursor-based wait merely because *some earlier* turn is already completed. Preserve
bounded page reads and allow callers to observe completeness explicitly.

### F09-6 — Share concurrent provider discovery misses

**Priority medium; confidence high; effort small; risk low to medium.**

`runtimeEngine.ts:263` already caches completed descriptors for 15 seconds, but concurrent misses
each create/probe every driver before `:290` sets that cache. Twenty concurrent requests cause twenty
actual calls to the fake driver's probe. Built-in probes can launch executable/auth status processes;
the experiment demonstrates multiplication, not twenty real provider processes or an explanation of
the Sentry latency tail.

**Fix sketch:** own one in-flight discovery promise per appropriate registry/freshness generation,
release it in `finally`, and define how forced refresh joins or supersedes it. Prevent a superseded
generation from repopulating current descriptors after harness registration/removal or teardown.
Keep each provider's existing error descriptor and authentication authority semantics. This is
separate from the already implemented usage-service in-flight sharing.

**Fail-before gate:** twenty simultaneous ordinary misses cause one probe per registered provider;
completed-cache reads cause none; expiry/force/change causes the intended fresh generation. Cover
individual rejection, disappearing contributed harness, retry, concurrent forced reads, and disposal.
Provider startup still obtains authoritative readiness/configuration and does not trust a stale
discovery result as proof of authentication or accepted execution.

### F09-7 — Do not discard a valid accepted usage file at JavaScript's argument limit

**Priority high for correctness; confidence high; effort small; risk low.**

`claudeDailyUsage.ts:215` spreads all parsed records into one `records.push` call. A compact
19,000,000-byte fixture is below the 32-MiB accepted-file cap and parses into 200,000 valid records,
but the analyzer catches the argument-limit error as a skipped file and returns no sessions. This
is silent loss of a valid history file, not a malformed-file recovery case.

**Fix sketch:** append through a loop or a deliberately bounded batch; retain existing parsing,
cross-file last-winner deduplication, partial-line tolerance, local-day aggregation, and pricing.
Do not silently reduce the accepted-record limit to avoid the argument limit. Longer term, the
per-file and file-count caps do not constitute a small aggregate memory budget; a streaming/compact
representation would need to preserve the global duplicate winner and chronological session gaps.

**Fail-before gate:** the retained compact fixture contributes its expected sessions/model state and
has zero skipped files through the actual analyzer. Keep malformed/partial records, empty files,
cross-file duplicate updates, append, truncate, replace, mtime cutoff, local-day rollover, pricing
override/unknown models, and max-file handling. No provider invocation is needed.

### F09-8 — Make session pagination deterministic at equal timestamps

**Priority medium; confidence high; effort small to medium; risk medium because cursor is public.**

`store.ts:145` uses a strict timestamp-only `<` cursor, while `:153` orders only by that timestamp.
The 20-equal-timestamp fixture returns five rows and then zero; 15 rows are unreachable. This is a
correctness prerequisite for roster performance work, not evidence that the current bounded event
page cursor is faulty. Event pages use distinct sequence numbers and are unaffected.

**Fix sketch:** introduce a deterministic `(updatedAt, id)` order and compatible opaque composite
cursor, with matching seek predicate and an explicit version/legacy transition for protocol and
clients. Preserve task/workspace/archive/attention/title filtering and Node ownership. Verify the
resulting plan before proposing a new index.

**Fail-before gate:** page all 20 tied rows exactly once, including limits one/five/100, mixed timestamp
groups, both archive modes, and scoped filters. Cover legacy cursor behavior and updates between
pages under the chosen documented consistency model. Do not promise snapshot-consistent pagination
without defining how concurrent updates are handled.

## Usage collector costs and configuration lead

The analyzer's repeated work is measured, including mutations before any cache suggestion. In the
before-v3 200-file fixture, three unchanged reads take 328.33–371.38 ms wall and 340.19–429.19 ms
process CPU. One duplicate update appended to one file costs 326.64 ms; replacing one file costs
328.68 ms. It still reparses all selected histories. Endpoint RSS changes vary substantially with GC
(including a 167.46-MB increase on one large run); they do not establish peak or retained memory.

The mutation checks preserve input totals 10 initially, 19 after duplicate update/new record/partial
line, 106 after a cross-file last-winner update, 99 after truncation, and eight after replacement. On
local day rollover those eight move to yesterday. A pricing override recomputes cost to $0.000056,
and an old mtime excludes the file. Large-history append/replacement totals are also asserted.

At one refresh every five minutes, a roughly 350-ms CPU calculation alone averages about 0.12% of
one core, before quota-triggered fresh reads or manual refresh. The normal unattended schedule is
off. Thus F09-7 is an immediate correction; a daily-history cache is a conditional follow-up, not a
generic fix for the observed usage route's long tail. If sustained usage measurements justify it,
cache bounded compact per-file parse results, not raw transcript strings. Fingerprints must detect
append, truncate, inode replacement, same-size mutation, deletion, and changing selected files;
partial tails and duplicate winner ordering must survive. Reaggregate for local-day/pricing changes,
and specify root/account lifetime and a total byte/record eviction bound. Append-only assumptions
and caching the aggregate solely by file count/mtime are insufficient.

The fake argv probe records `claude /usage --allowed-tools ''` and performs no real CLI call. Current
official Claude documentation describes allowed-tools as automatic approval, while `--tools ''`
disables built-in tools and `--strict-mcp-config` restricts loaded MCP configuration. Empty allowed
tools therefore does not establish that ambient MCP startup is excluded.
[Claude Code CLI reference](https://code.claude.com/docs/en/cli-reference),
[MCP configuration documentation](https://code.claude.com/docs/en/mcp).

This remains a compatibility lead. Evaluate a supported-version, explicitly empty MCP configuration
with strict loading and the minimum settings needed for read-only quota capture, using an isolated
synthetic configuration. Verify current help and startup behavior before adding flags. Managed
configuration, subscription authentication, trust prompts, fallback, and quota parsing must still
work; do not mutate or read a user's normal configuration to perform that experiment. No actual
minimal configuration or real CLI behavior was verified here, so this report does not claim the
argv alone caused the earlier live MCP grandchildren or that a particular flag combination is ready
to ship. Process ownership in F09-1 is independently proven with synthetic native children.

## Lifecycle, query ownership, and rejected ideas

| Concern | Inspection result and decision |
| --- | --- |
| Startup/imports | ACP/provider implementations are already lazy. Built-in Codex startup probes readiness and option lists; force-skipping auth/config negotiation would weaken contracts. F09-1/F09-6 address measured owners. No startup bundle rebuild is requested. |
| Idle Node with no Agent pane | Live provider handles deliberately remain available across client navigation; the Node owns execution. There is no per-frame pump polling loop. General idle TTL or process eviction needs provider-session/context semantics and actual RSS evidence; F09-2 avoids unnecessary queue starts without inventing that policy. |
| Reconnect/disposal | Runtime owns bounded 1/2/5-second reconnect timers, tracked queue/quiet timers, a stopped guard, startup joins, durable buffer flush, and listener cleanup. Fake runtime disposal finishes with zero live entries, callbacks, or timers; the separately measured native process owner is the outstanding weakness. |
| Event/search reads | Page plan uses session/sequence index; measured four-MiB page read is 5.22 ms. Small-fixture FTS reads are fast. Do not add a generic event/search cache or duplicate index. Request ordering uses a temporary B-tree, but no large-request workload was measured to justify an index change. |
| Snapshots/export | Event limits and HTTP resume/folding are shipped. Export intentionally reads the whole ledger. Repeated wait hydration is measured in F09-5; wholesale pagination of every turn/request API is a larger contract change, not established by this audit. |
| Long tool output | Materialization/artifact bounds and folds already exist. Further tool payload or client transport work belongs to areas 05/08 and needs its own accepted-output contract. Assistant text/FTS growth is distinct. |
| Usage service | Five-minute TTL, pricing-aware key, matching in-flight dedupe, stale-success fallback, and collector registration already exist. Fresh quota continuation must remain fresh. Recommending another service cache would duplicate shipped work. |
| Delegation/MCP | Durable idempotency, cancellation, report bounds, contribution seams, and recovery are intentional. Full-history fork followed by a bounded tail is a source lead, but no additional benchmark was run or optimization ranked after the concrete owning candidates were covered. |
| Miscellaneous maps | Materializer state clears at stop; session-row and redaction/minted-secret lifetimes serve distinct contracts. No day-long retained-heap measurement demonstrates a general leak. Arbitrary cache deletion can discard state or weaken redaction. |

## Behavioral invariants and future compatibility

Every implementation must preserve:

- Complete canonical durable events, sequences, restart recovery, bounded event-page reach, late usage,
  and current-head search. FTS is a recoverable derived projection; index savings must not remove
  ledger text or change exact search behavior without an explicit product contract change.
- One active turn per session; independent workspace/provider ceilings; shared limit changes;
  interactive/workflow fairness; earliest queued ordinal; `notBefore`; cancellation before and after
  acceptance; unknown provider acceptance and reconnect behavior.
- Authentication/status authority, provider option negotiation, Node/account separation, scoped MCP
  and tool capability grants, external/internal controller distinctions, and CoreServices ownership
  of task/workspace identity. No renderer-held credential or cross-Node process/cache ownership.
- Startup errors, cancellation, teardown, and registry removal release actual owned resources within
  the specified lifecycle budget. Queued work does not depend on an Agent pane being mounted.
- Full execution/delegation result capture before schema parsing; cursor-based waits do not match old
  completion; pagination never silently treats a bounded prefix as complete.
- Daily accounting retains duplicate winner rules, partial files, append/truncate/replace, local day
  boundaries, pricing changes, unknown models, and bounded memory ownership if caching is later added.

Future Kimi support uses the shared harness/ACP seams, so process lifecycle and discovery should live
at those seams instead of hard-coded CLI conditionals. The future sandbox programme extends per-task
environment and platform isolation: an owned process-group/job abstraction fits that boundary, while
ambient descendant killing or normal-profile caching does not. Future message/report work shares the
durable queue and fairness policy, so F09-2/F09-3 must support additional sources without a second
admission scheduler. Proposed isolation is not a shipped authority to weaken existing permissions.

## Verification and limits

The retained runs and independently confirmed results are listed in `09-verification-before.txt`.
The current all-case coordinator replay passed seven tests in four files. Application lint and the
bounded full suite had already passed under the coordinator; this source-read-only audit did not
repeat those heavyweight gates or edit application code. No builds competed with the probes.

For implementation, promote meaningful fail-before cases into existing driver/runtime/store/usage
owner suites. Replay these probes through the **replacement production owner** if a projector,
process launcher, or query path moves. Run focused suites, `rtk proxy pnpm lint`, and
`rtk proxy pnpm test` under the repository's concurrency bound. Migration tests must exercise both
new and pre-existing plugin databases. Desktop-visible changes require a separate isolated visible
Tauri session and the documented snapshot/click/fill/screenshot/stop workflow, coordinated with the
owner of the live fixture; hidden/unfocused elapsed timings are not visible-latency evidence.

Sentry supplied provider-route `n=379`, median 218 ms/p95 1,589.5 ms; usage-route `n=574`, median
0.7 ms/p95 9,695.5 ms; event-page `n=32`, median 133.4 ms/p95 1,247 ms. Release IDs are absent and
suspension may contribute to long tails. These are investigation leads, not attribution to this
checkout or proof that daily parsing, MCP configuration, or FTS explains those tails.

Unmeasured scope includes real provider startup/authentication/quota capture, actual configured MCP
descendants, Windows/Linux native group behavior, detached descendants, real native provider RSS,
retained JavaScript heap and a full day of use, large global search corpora, realistic continuous
search cadence, and visible WebKit latency. Synthetic native process results apply to the exercised
macOS launch owners; virtual driver counts do not substitute for native resource measurement. The
source flow, owning lifecycle, queue/query/write paths, and concrete candidates are covered. Further
optional benchmarking is not needed before selecting implementation handoffs.
