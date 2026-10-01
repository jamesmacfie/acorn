# Performance implementation sequence

All 16 investigations are complete. The area reports and candidate ledger own the preserved
measurements and behavioral gates. This plan selects their measured handoffs and groups them by
production owner and dependency. Run one implementation specialist at a time, with coordinator
review between units. The user requests a commit after the active unit 08 on October 1, 2026.
Units 09–28 remain pending at this stopping checkpoint; no new branch is created.

## Selection

Prioritize removed work and bounded lifetimes: duplicate durable writes, invocation references,
retired resources, repeated cache serialization, unnecessary backend projections, row admission,
and quadratic algorithms. Correct origin and acknowledgement failures before increasing reuse or
releasing state. These repairs preserve the data needed for fast and correct return navigation.

The sequence covers the 85 measured handoffs from the 16 reports. Some handoffs share one repair;
they are not 85 independent changes. The telemetry series-cap fixture is also selected because the
documented 200-series bound fails for unlabeled names. It must refuse additional series explicitly
rather than combine unrelated operations or units.

Conditional work remains outside this selection: transcript virtualization, append-aware Markdown,
large settled fence rendering, deep hierarchy restructuring, transport/parser credits, broad cache
eviction, daily transcript caching, SQL driver streaming, native preview retention/navigation, HTTP
list/detail splitting, and telemetry queue representation. Their reports identify missing evidence
or product-policy gates. Revisit hidden TUI decoration work after viewport fixes only if a measured
residual remains. Preserve supported content, offline rows, canonical results, and unsent drafts.

## Sequential units

| Unit | Owner and scope | Reports | Acceptance evidence | Status |
| --- | --- | --- | --- | --- |
| 01 | [Bundled Node state and batched client custody commits](./implementation-01-startup.md) | 01 | Unchanged writes zero; bounded cold/version commits; repair/tombstone/trust tests | Reviewed; cumulative gates pending |
| 02 | [Node plugin RPC function lifetimes, rejected reload disposal, Request cancellation](./implementation-02-node-plugins.md) | 02, 16 | Retained references plateau; no rejected workers; forwarded abort; persistent callback/span leases | Reviewed; cumulative gates pending |
| 03 | [Broker event interests, viewer ownership, reconnect controls, fetch ownership and byte copies](./implementation-03-transport.md) | 05, 07, 13, 16 | One physical authenticated socket; independent viewers; fresh terminal restore; shared Docker producer; final cleanup; byte equality | Reviewed; cumulative and native gates pending |
| 04 | [Query persistence, partition retirement, preferences and device keys](./implementation-04-cache.md) | 06, 15 | Dehydrate once per flush; no resurrected partitions; exact origin/reversion/rollback; file-adapter parity | Reviewed; cumulative and native gates pending |
| 05 | [Pane/visibility scope, Node switch ordering, Notes save custody, outgoing Node terminal cleanup, rail ordering](./implementation-05-navigation.md) | 07 | No cross-Node model/query/drawn-count reuse; outgoing cleanup targets origin; bounded terminal sinks; stable rail DOM | Reviewed; cumulative desktop and native functional checkpoint pass; final gates pending |
| 06 | [Client frame resources, remote handlers, contribution reconciliation, tree bridge ownership and TUI worker output](./implementation-06-client-plugins.md) | 03, 16 | Closed frame ports; obsolete handlers freed; unchanged identity; scoped concurrent/warm SDK calls; transactional worker start; noisy worker completes boundedly | Reviewed; cumulative desktop gate passes; native functional observation recorded with focus limitation; final gates pending |
| 07 | [Terminal ring, run-target lifecycle, roster events and engine disposal](./implementation-07-terminals.md) | 04 | Exact bounded ring with few objects; one owned run target; structural notifications; timers/clients retired | Reviewed; independent 47-test/process replay and cumulative lint pass; final gates pending |
| 08 | [Highlight/word workers, virtual row identity, fence work, diff context generations and collection movement](./implementation-08-diff-highlight.md) | 10, 15 | One cold worker; settled failure paths; stable overlapping DOM with fresh data; one identical highlight; linear keyboard scans | Reviewed; 60 manifest entries match; full repository tests/lint pass; native functional checkpoint and cleanup pass |
| 09 | Managed client read generations, composer custody and bounded media joining | 08 | No stale Node/session publication; intact unsent draft; one body read per shared image; bounded idle bytes | Pending |
| 10 | Agent protocol/process ownership through startup and shutdown | 09 | Zero owned synthetic descendants after failure/cancel/stop; bounded acknowledged exit; no ambient process killing | Pending |
| 11 | Durable queue admission/read projection, discovery, pagination and daily append | 09 | Provider starts follow admission; constant queue-head statements; one discovery; complete tied cursor pages and usage file | Pending |
| 12 | Derived streamed search projection and recovery | 09 | Growing-head CPU/rewrites reduced; exact phrase/rank/tokenizer/current-head search barrier; canonical ledger/restart/migration | Pending |
| 13 | Agent wait projection and complete result capture | 09 | Narrow checks; complete late completion/results; no listener gap; cancellation and delegation contracts | Pending |
| 14 | Node Git/HEAD observation, filesystem stamps, cache expiry, exact paths and untracked completeness | 11 | No stale HEAD; bounded fresh lstat; expired stdout released; exact path keys; incomplete output refused | Pending |
| 15 | Shared PR comparison waves and marker identity | 11, 12 | Common commands joined; fresh refs/disk guards; body revision gates; preserved marker meaning | Pending |
| 16 | File editor and host document save acknowledgement, recovery, reloads, pool lifetime and honest loads | 12 | Ordered origin writes; failed text/undo retained; exact ack; stale reads rejected; clean previews released; valid UTF-8 preserved | Pending |
| 17 | Bounded editor search, tree viewport/freshness and terminal graphical-state admission | 12, 15 | Capped incremental rg; owned abort; bounded tree DOM; fresh affected listings; no undrawn CodeMirror state | Pending |
| 18 | Database pool generation, compact catalog and returned-row normalization | 13 | One cold pool and fresh catalog wave; discarded rows not normalized; disposable real-PG SQL/close gate | Pending |
| 19 | Docker spawn/health ownership, bounded tail representation and Node-qualified client stores | 13, 16 | Failed slots reclaimed; joined health; no empty matcher fanout; exact tail with lower CPU; origin-qualified streams | Pending |
| 20 | HTTP byte decoding, draft operation custody and outbound cancellation | 13 | Exact byte/error semantics with lower CPU/allocation; stale drafts unchanged; caller abort reaches outbound request | Pending |
| 21 | SQL scratch UTF-8 limits and recoverable oversized data | 12, 13 | Wire/host byte agreement; failed full edits retained; stored oversize remains recoverable/exportable | Pending |
| 22 | Preview tunnel admission/retirement and URL resolution joining | 13 | Published plus pending cap; no post-close listener; one resolution per wave; stale owner cannot publish | Pending |
| 23 | Memory delta indexing and joined fresh reconciliation | 14 | Zero unchanged index/FTS writes; joined readers; fresh external/source authority; recall/write/approval barriers | Pending |
| 24 | Compact workflow history/navigation and page detail projection | 14 | Same exact lineage/counts/cursors with fewer selected bytes; full execution/detail data intact | Pending |
| 25 | Workflow authoring custody, refresh coalescing and disposable stream copies | 14 | Origin-bound saves/acks/recovery; one active plus dirty follow-up; unused text released; exact tail/full canonical output | Pending |
| 26 | TUI viewport admission, word wrapping, clipped painting and Log windowing | 15 | Bounded hidden/initial owners; linear complete wrapping; exact clipped cells/full widths; bounded log nodes/find/scroll | Pending |
| 27 | Active TUI Node presentation and lifecycle composition | 06, 07, 15, 16 | Two disposable authenticated Nodes; correct provider/cache/restore/persistence/status; supervised process identity preserved | Pending |
| 28 | Helper telemetry retirement and total histogram capacity | 16 | No late sink/queue resurrection; admitted aggregates exact; explicit bounded overflow with unit/owner separation | Pending |

Each specialist reads `implementation-contract.md`, this plan, and its owning reports before editing.
If a unit reveals a stronger dependency, record it and adjust the sequence without undoing earlier
work. Split a large unit into consecutive reviewable deliveries when needed; do not expand scope to
unmeasured refactors.

## Architecture checkpoints

Tree worker module state and mounted authority have different lifetimes. Prefer a typed per-slot
bridge that captures its Node, cache, document grant, and focus container before asynchronous work.
SDK compatibility must prevent a bundle-global bridge from lending the first slot's authority to
another slot. Authority-context pooling is an alternative only with explicit sharing, grant,
document-identity, surviving-slot, and idle-worker bounds. Do not silently create one worker per tree.

Unit06's accepted proposal uses additive SDK acknowledgement capability metadata and per-slot ports
for updated tree bundles. Their module worker stays shared by hash; retired slots release authority
and ports. Legacy SDKs retain their handshake in immutable authority contexts with equivalent live
leases, immediate last-lease retirement, and no double evaluation of module-level effects. Affinity
includes effective permissions, captured Node/cache, surface/task/project, and document grant.
Document accessors cannot follow a replacement grant. The specialist must prove the actual service
closures, first-lease retirement, module-level legacy metadata/API, and transactional startup before
coordinator acceptance. Legacy process cost and updated idle bounds remain separate measurements.

Viewer ownership travels through custody as a generic transport identity, never a credential or
plugin name. One physical Node socket keeps its authentication, sequence, heartbeat, revocation,
and binary behavior. Logical retirement cleans only its resources. A joining terminal obtains its
own canonical restore; Docker sharing belongs to Docker and must not multiply continuous readers.
Define versioning and old-peer behavior before choosing the envelope. Keep maps and replay bounded.

The baseline versioning doc explicitly has no capability negotiation or feature handshake. A
viewer codec cannot assume that every independently upgraded protocol-1 Node supports it. Unit 03
must resolve that checkpoint explicitly: preserve legacy raw frames and binary layout, introduce
only additive opt-in fields/channels, and verify both older-client/new-Node and new-client/older-Node
behavior. If an optional advertisement is needed, use the broker's already-owned `/v1/node` probe,
document the deliberate contract extension, and avoid another startup round trip or silent loss.
Do not solve this by making all previously paired Nodes incompatible.

Search remains a recoverable derived projection of complete durable events. Coalesce index work,
but catch up all ranking-relevant dirty documents before a search returns. Migrate forward rather
than changing applied SQL. Phrase/prefix/tokenizer/rank/scope and current-head completeness are gates.

Dirty save state survives teardown independently of drawn DOM. Acknowledgement describes the exact
submitted revision and originating Node. Serialization must preserve edits made while saving and
failed text/undo/view state. Limits apply at established boundaries; no supported body is truncated
or recast as an editable empty file to reduce memory.

## Verification and finish

Preserve every before artifact. Use fresh after tags, adapt fail-before assertions explicitly, and
invoke the changed production owner. Record operation counts, bytes, CPU, allocations, retained
heap, and native timings separately. Coordinator review checks diff shape, meaningful regression
tests, owning docs, and the before/after result before advancing.

Run relevant unit gates, then cumulative `pnpm lint` and bounded `pnpm test`, including desktop and
TUI gates. Stop the baseline test app before replacement staging. Launch a fresh isolated Tauri
session, exercise representative task/workspace/pane/plugin/terminal navigation, inspect screenshots,
and repeat mixed-use cycles with settled resource plateaus. Run a disposable TUI PTY/fake-TTY session
for real composition and input. No paid provider runs or normal profile modifications are required.

Native Computer Use is unavailable after two long stalled calls. A separate test-only capability
bundle verifies real native and document visibility/focus through installed Tauri SDK verbs. Its
baseline terminal transition times out in the renderer driver; the native validation notes preserve
that open limitation. Repeat focused functional checks at final staging. Hidden-window timings
cannot establish visible latency, and a bounded soak cannot prove several days of active use.
Report measured gains and those limits separately. Stop all test sessions, fixture services, and
owned children before handing back.

[The sustained validation plan](./sustained-validation-plan.md) defines the final repeated-use
workload, settlement samples, two-Node ownership checks, measurement limits, and cleanup gate.
