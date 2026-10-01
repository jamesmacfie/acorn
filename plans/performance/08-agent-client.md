# Agent client performance audit

Audit baseline: `f8e4b59c`, October 1, 2026. Application source remained read-only. No agent sessions,
private transcripts, normal profiles, paid agent work, branches, or commits were created. All probe
records contain synthetic text, IDs, metadata, and bytes. The isolated Tauri session was left alone.

The strongest handoffs are to bind asynchronous work to its originating Node and session, and to
share repeated media reads through a bounded feature owner. Streaming already preserves established
rows and updates one Markdown block in the measured fixtures. Large initial histories and large
growing messages still have measurable costs, but they warrant focused follow-ups before changing
the transcript architecture.

## Scope and source-to-consumer flow

The Agents plugin owns its protocol, Node routes, client store, conversation projection, composer,
session roster, and media cards. The shared client owns Node selection, HTTP and WebSocket transport,
query context, the pane model host, the kit, and DOM scrolling. Rust owns the window. The desktop
helper and custody broker own endpoint selection, authentication, TLS pins, multiplexing, and
delivery. Keep those boundaries intact.

The inspected flow is:

1. A harness produces normalized events. `plugins/agents/src/server/sessions/runtimeEngine.ts:756`
   records an event through the Node store, emits `agent:event`, emits a changed turn or request, and
   emits a session row only when its projected contents change. `:808` strips the event's search text
   before publication. Server ledger, driver, process, and usage costs belong to area 09.
2. The Node WebSocket delivers through custody and the host platform bridge.
   `packages/client-core/src/infra/node/wsClient.ts:102` rejects frames whose Node does not match the
   active Node, and `:132` routes the channel prefix. `plugins/agents/src/client/sessions/wsChannel.ts:13`
   registers `agent` and fans out to its subscribers. The feature receives an agent frame after the
   transport has filtered it; the frame itself does not carry an origin Node for later asynchronous
   work.
3. `plugins/agents/src/client/sessions/managedStore.ts:445` dispatches session, event, turn, request,
   and deletion frames. Events append into held snapshots in sequence order, deduplicate through a
   set, fold usage, and advance a separate per-session sequence signal. Roster writes batch a page
   and update narrow task slices. Agent notifications retain one application-lifetime subscription,
   including while no transcript is mounted.
4. HTTP reads use `managedClient.ts` and the shared `apiClient.ts`. A request resolves its Node at
   `packages/client-core/src/infra/node/apiClient.ts:143` before transport delivery. A promise already
   sent to Node A therefore returns A's answer even after selection changes. A subsequent request
   resolves the ambient Node again unless supplied an explicit target. Agent snapshot and event-page
   methods supply no explicit Node or abort signal. Snapshot HTTP reads opt into tool folding and
   resume from a completeness mark. `managedSnapshot.ts` unions returned rows with streamed rows.
5. `agentPaneModel.ts` derives one task's roster and selected session, holds the provider resource,
   and schedules shown-gated read marks. `AgentConversation.tsx:54` narrows the global snapshot
   signal to one session. `:78` owns its hold, snapshot read, telemetry view, and reconnect callback,
   with cleanup per selected session. The same conversation is used by the Agents pane and the
   Workflows conversation capability.
6. `AgentTranscript.tsx:49` retains `createConversationProjection()`. The fold projects text,
   tools, plans, subagents, requests, and completion context into stable card IDs. Turn and request
   maps depend on their array identities. Visible items, key arrays, a key-to-item map, and per-row
   setters feed `For` over stable keys. `AgentEventCard.tsx` renders the event branch, built-in or
   contributed tool card, nested subagent content, attachment, artifact, and Markdown.
7. The shared `Markdown.tsx:76` parses the changed message in full, then reuses unchanged block DOM.
   Its trailing block changes in a stream. Grammar loads and code highlighting are lazy. Timeline
   owns scrolling, anchors, restoration, and controls. The Agent feature's `readingPlaceStore.ts`
   stores up to 50 places, keyed by session, subagent, and drawing surface, and clears on a Node
   switch or session deletion.
8. Composer text lives in `managedDrafts.ts`. Attachments, contexts, and in-flight guards live in
   `composerState.ts`, shared by the session's composers. View controls and picker state stay per
   mount. Device storage holds the unsent text, attachment IDs, and captured context. Media cards
   load metadata and bytes through the broker, convert bytes to data URLs, and draw kit Markdown.
   An `<img loading="lazy">` delays image decoding or browser loading; it does not defer the
   feature's preceding broker byte read.

Inspected modules include the owners above, `managedSelection.ts`, `sessionRoster.ts`,
`AgentTaskSidebar.tsx`, `AgentCenter.tsx`, `AgentPane.tsx`, `toolRendererRegistry.tsx`,
`ManagedAgentMarkdown.tsx`, `AgentArtifactCard.tsx`, `AgentAttachmentCard.tsx`, `inlineImage.ts`,
`worktreeFiles.ts`, `automaticTaskContext.ts`, `turnSender.ts`, `usageFold.ts`, `toolFold.ts`, and
their relevant source-owner tests. The review read the architecture, frontend, conventions, pane,
cache, state-ownership, managed-agent surface, and future-plan documents. The scroll proposal is
partly shipped and is not authority to rebuild the transcript.

## Prior work retained

The inspected history includes `723e2c9c` incremental projection, `78aa0072` narrow row updates,
`22a7fd98` the held-plus-three snapshot bound, `1048c4ab` roster isolation from streamed sequences,
`027d3f47` conditional session publication, `0f100365` snapshot resume, `d7edb5d5` server tool fold,
`51706d0c` first-selection alignment, `aadd9f07` focus-triggered worktree files, `a7d82d71` held-pane
shown state, and the stable Markdown blocks and reading-position repairs present on the baseline.

The audit does not propose those changes again. Areas 03, 06, and 07 own loaded handler and registry
work, query and preference persistence, and Node/pane navigation lifetime respectively. F08-1
addresses asynchronous completions after eviction even when the shell's navigation ordering is
correct. It does not replace area 07's atomic navigation work.

## Reproducible evidence

The probes import production owners from source. Only transport replies, resize notifications, and
synthetic records are supplied. The render probe wraps the original parser and telemetry measurement
functions to count calls and bracket elapsed work; it executes their original implementations.
The browser condition selects Solid's real reactive browser build. The DOM environment is jsdom,
not an optimized WebKit renderer.

Run the probes from the repository root:

```bash
rtk proxy env ACORN_PERF_TAG=sample pnpm exec vitest run --config plans/performance/08-probe.config.ts
```

The default output tag is `sample`. Change the tag for a replay. Baseline evidence is preserved as
`08-*-before.json` and `08-*-before-v2.json`. The second run adds `process.cpuUsage()` brackets. Its
original `before2` output filenames were renamed to `before-v2`; no measured values changed. The
first run's incorrectly named CPU fields were corrected to synchronous wall fields without changing
their values. Results distinguish synchronous wall elapsed time from process CPU usage. Process
CPU brackets can include V8 worker and garbage-collection activity; they are not precise attribution
to one JavaScript function.

| Probe | Owner and evidence | Baseline result |
| --- | --- | --- |
| `08-store-probe.test.tsx` | Actual transport, scoped eviction, store, and agent WebSocket | Three roster loaders accept Node A after switching to B. Colliding snapshots retain both Nodes' event text. A paged load sends its first read to A and its next page to B. |
| `08-composer-probe.test.tsx` | Actual composer, shared state, persistence, and deferred attachment metadata | A's attachment resolves after switching to B, appears in B's DOM, and persists under B's attachment-draft key. |
| Draft case in store probe | Actual draft, removal, scope eviction, and bounded reading-place owner | Text survives deletion and wins over B's attempted hydration for a colliding ID. Composer context clears. The oldest of 51 reading places evicts. |
| Render case in `08-render-probe.test.tsx` | WebSocket to store to full transcript, cards, Markdown, and Timeline | The first row and first paragraph retain identity during all 25 updates. Each update parses one message and replaces one trailing block. |
| Media case in render probe | Actual attachment card, API, FileReader, data URL, and Markdown | Eight mounts of one 1 MiB image make eight metadata reads and eight full content reads. They request 8,388,608 bytes and emit 11,185,008 source-attribute characters. |
| Live tools case in store probe | WebSocket dispatch and append owner | 8,000 1 KiB updates remain as 8,000 raw records for one tool. Store-only append elapsed stays below 0.0014 ms per update in this fixture. |

All six probe cases pass their baseline characterization assertions. A passing audit probe explicitly
asserts the observed failure; it does not indicate that the intended isolation invariant passes.
Turn those assertions into the opposite expected behavior in permanent regression tests.

### Transcript measurements

These are the `before-v2` measurements. Initial history uses synthetic assistant cards with a short
paragraph containing emphasis and inline code. The last message receives 25 six-character deltas.
This is an operation and CPU stress fixture, not a visible navigation-latency measurement.

| Cards | Last message characters | Initial elements | Initial synchronous wall ms | Initial process CPU ms | Stream median/p95 wall ms | Stream process CPU ms for 25 frames | Parser elapsed ms for 25 frames |
| --- | --- | --- | --- | --- | --- | --- | --- |
| 40 | 80 | 683 | 63.58 | 86.99 | 0.321 / 1.363 | 33.61 | 0.367 |
| 400 | 80 | 6,803 | 226.54 | 505.27 | 0.300 / 0.403 | 13.36 | 0.266 |
| 2,000 | 80 | 34,003 | 1,121.86 | 1,602.09 | 0.548 / 0.752 | 26.60 | 0.273 |
| 400 | 20,000 | 7,682 | 221.47 | 319.92 | 1.723 / 2.369 | 225.27 | 26.32 |
| 400 | 200,000 | 15,623 | 520.70 | 664.25 | 9.060 / 10.399 | 252.03 | 178.98 |

For every fixture, 25 frames produce exactly 25 parser calls, 25 added nodes, and 25 removed nodes.
Unchanged history stays mounted. At 2,000 short cards, all 25 projections total only 0.268 ms and
visibility filtering totals 1.173 ms. The dominant initial cost is creating cards and DOM, not the
incremental fold. In the 200,000-character fixture, the parser reads 5,001,950 characters while the
stream adds only 150 characters. Its accumulated elapsed time is 178.98 ms out of 229.13 ms of
synchronous update elapsed time. This identifies a remaining parser cost despite stable block DOM.

The first run independently shows the same shape: 34,003 initial elements for 2,000 cards, preserved
row and paragraph identity, and a 200,000-character stream median of 9.370 ms. Absolute times are
host and environment dependent. No GPU, image pixel decoding, paint, actual network delay, or
visible WebKit response time is measured.

## Ranked handoffs

| Rank | Finding | Category | Impact | Effort | Fix risk | Confidence |
| --- | --- | --- | --- | --- | --- | --- |
| 1 | F08-1 Bind asynchronous store reads to their originating scope | Correctness | Old Node data merges into the active Node; one walk can combine two Nodes | M | Medium | High |
| 2 | F08-2 Bind draft operations and retained state to their session scope | Correctness and lifetime | A delayed hydration persists another session's attachment; deleted text remains retained | M | Medium | High for reproduced mechanisms; medium for durable-key policy |
| 3 | F08-3 Deduplicate repeated media reads under a bounded owner | Performance | Every repeated card reads and encodes the full same image again | M | Low to medium | High for operation cost; medium for user frequency |

### F08-1 Bind asynchronous store reads to their originating scope

- Evidence: `plugins/agents/src/client/sessions/managedStore.ts:522`, `:535`, and `:541` write a
  returned page into the singleton roster without checking the request's generation or Node.
- Evidence: `managedStore.ts:564` checks deletion immediately after the snapshot read but does not
  check a scope token before paging, merging, indexing, marking completeness, touching recency, or
  upserting the session. `:277` invokes each event page through the ambient API.
- Evidence: `managedStore.ts:637` clears maps and timers, including in-flight map entries at `:651`,
  but it does not invalidate the already executing asynchronous bodies. `managedClient.ts:67`
  accepts an explicit Node for roster reads; snapshot and event-page wrappers at `:92` do not.
- Impact: A delayed roster read from A replaces B's colliding row when A's sequence or update time
  is newer. Without colliding IDs it still repopulates B's roster with A's unrelated sessions. A
  delayed snapshot unions A's events into B's cached transcript. A paged read can combine the first
  page from A and a continuation from B. Cleanup of a promise map only prevents sharing the stale
  promise; it does not prevent its completion from writing.
- Effort: M, including production-owner lifecycle tests and the narrow API option surface.
- Risk: Medium. Cancellation must preserve valid same-Node in-flight deduplication, event-page
  reach, reconnect recovery, late usage union, and held snapshot reads.
- Confidence: High. The actual transport and store probes record all three failures.
- Fix sketch: Capture an owner token with Node ID and store generation before starting each
  operation. Increment the generation on scope clear. Give snapshot and event-page calls an explicit
  Node and signal, and check the token after every await and before every store mutation. Apply the
  same discipline to delegation refreshes, priming, start-session completions, and the Agent Center
  resource fetcher that calls `upsertSessions` at `AgentCenter.tsx:81`. Cancellation saves work but
  cannot replace the token check.

The held-counter experiment deliberately overlaps A's and B's colliding session holds. While both
hold, the cache keeps that session plus three idle snapshots. Releasing A leaves B held. Releasing B
returns the cache to three snapshots. That arithmetic works. Do not clear `holds` without assigning
release tokens to a generation: an old cleanup could then decrement an incoming hold. Keep the
shipped bound. A generation-qualified hold token can provide isolation if area 07's disposal order
requires it; this audit does not establish a separate hold-count failure.

Execution gates:

1. Start `loadTask`, `loadAll`, and `loadAttention` on A, clear on switch to B, load a B row with a
   colliding ID, and resolve A last. Only B's roster, delegation, and attention data may remain.
2. Start snapshots for the same ID on A and B and resolve in both orders. Neither response may
   merge across generations. A stale promise must not delete B's in-flight entry in `finally`.
3. Switch while snapshot or continuation-page replies wait. Every page must retain A as its
   request target, and the completion must leave B untouched. Cover a resumed partial read too.
4. Delete the session during paging and verify it cannot reinsert a snapshot. This extension is an
   unexecuted gate; the baseline probes establish Node eviction, not this deletion timing.
5. Preserve two same-Node readers sharing one load, gap recovery, fold reach, three idle snapshots,
   active holds, and cleanup releases from the outgoing generation.

### F08-2 Bind draft operations and retained state to their session scope

- Evidence: `plugins/agents/src/client/composer/AgentComposer.tsx:87` follows the session through a
  shared-state memo. `:90` setters resolve that memo at the time of writing. Hydration at `:211`
  fetches the captured session's attachment IDs but passes its result to the dynamic setter at
  `:212`.
- Evidence: `AgentComposer.tsx:361` and `:362` have the same completion shape for uploaded files.
  `:274` through `:305` uses dynamic session and draft reads across awaits during send and clears
  draft keys after enqueue. Automatic context refresh at `:258` already checks session and version,
  which is a useful local pattern, but it does not scope the rest of the operation.
- Evidence: `plugins/agents/src/client/sessions/managedDrafts.ts:3` holds an unbounded record with
  no deletion or eviction API. `:8` refuses a hydration once an ID exists. Store deletion at
  `managedStore.ts:217` clears shared composer state and reading places but leaves text in that
  record. The Node clear at `:637` also leaves text there.
- Evidence: `AgentComposer.tsx:39` through `:41` use bare session IDs for durable text, attachment,
  and context keys. The stored attachment ID references a Node-owned row. Composer state clears on
  a Node switch because its IDs belong to the outgoing Node.
- Impact: After switching from session A to B in the same mounted composer, A's delayed hydration
  assigns `attachment-a` to B, draws it there, and stores `["attachment-a"]` under B's durable key.
  Deletion leaves synthetic text in the module map. A Node switch followed by hydration for a
  colliding session ID returns A's text rather than B's supplied text. These are reproduced facts.
  Upload, send, replacement, and capture paths have similar asynchronous risks by inspection;
  their individual outcomes were not exercised by this probe.
- Effort: M, including captured-operation ownership, deletion, durable-key handling, and tests.
- Risk: Medium. Two composers must retain shared send/upload/replace guards, return navigation must
  preserve unsent work, and a delayed completion must not clear another draft or strand its guard.
- Confidence: High for hydration and module retention. Medium for the durable-key policy until the
  owner explicitly reconciles the draft convention described below.
- Fix sketch: Capture the originating Node, session, shared draft object, and operation token before
  awaits. Complete and release guards on that captured state, and write through that operation's
  captured persistence key. Define whether an operation finishing after navigation updates its
  original retained draft or is abandoned; it must never update the replacement session. Add an
  explicit text-draft removal method for deletion. Preserve drafts across return navigation using
  Node/session-qualified retained state, with hydration that cannot overwrite a newer edit.

`docs/state-ownership.md:132` deliberately omits Node IDs for generic device-local task text drafts,
while `:121` requires module state to be keyed by Node or cleared on a switch and `:128` distinguishes
live rosters from durable memory. Do not silently rewrite the generic convention. Agent session
drafts include Node-owned attachment IDs and captured context, so their isolation rule needs an
explicit owning-document decision. The proposed agent-specific Node/session key preserves unsent
work when returning to either Node. Clearing all drafts on switch would lose that behavior.

Handle legacy keys without copying an ambiguous attachment ID into every Node's draft. A migration
can claim a legacy draft for the selected Node once while preserving the legacy record until it has
been written safely. Confirm that policy before deleting old keys. Empty in-memory entries can be
reaped after use, and archived sessions can use a bounded inactive state policy while retaining their
durable unsent draft. No measured retained-heap size establishes an urgent general map-bound fix.

Execution gates:

1. Replay the deferred hydration case. B must remain empty; A may receive its attachment only under
   the chosen retained-draft policy. B's storage and DOM must contain no A attachment.
2. Start upload, attachment replacement, context capture, and send under A. Switch to B before each
   await settles. B's text, attachments, contexts, errors, and guards must remain its own. Capture
   the target Node for every subsequent read, enqueue, and cleanup mutation.
3. Mount the same session in two surfaces. One hydrate and one upload remain shared, and sending or
   replacing in one continues to block the other.
4. Switch between two Nodes with colliding IDs and return to each. Their unsent text and complete
   draft payload restore independently. Delete a session and verify its module entry disappears.
5. Preserve mid-text caret/selection, focus, offline draft retention, attachment limits, replacement
   compare-and-swap ordering, and the lazy worktree-file trigger.

### F08-3 Deduplicate repeated media reads under a bounded owner

- Evidence: `plugins/agents/src/client/sessions/AgentAttachmentCard.tsx:34` owns a resource per
  mount, and `:38` reads full image bytes after metadata. Its source comment explicitly states
  there is no cache beyond the card. The modal reuses its source but download at `:48` fetches bytes
  again.
- Evidence: `AgentArtifactCard.tsx:36` through `:41` follows the same full image read and conversion.
  `inlineImage.ts:19` converts a Blob to a base64 data URL per caller. Markdown then hashes and
  parses a string containing that URL.
- Impact: Eight mounts of one synthetic 1 MiB image perform eight metadata and content requests,
  requesting 8 MiB for one immutable image and producing 11,185,008 source-attribute characters.
  Repeated attachment IDs can arise from retrying a turn, forks that reuse input, or multiple
  conversation surfaces. Eight simultaneous repeats are a stress fixture; the frequency in a normal
  day is unmeasured. The result is logical transfer and string count, not retained heap or image
  decoding cost. Separate cards of distinct images still need distinct reads.
- Effort: M for a feature-owned shared read owner, bounded idle retention, and lifecycle tests.
- Risk: Low to medium. Cache identity and stale completions must be Node-qualified. Preserve full
  resolution and download behavior, format allowlisting, and plugin/frame isolation.
- Confidence: High for repeated requests and conversion. Medium for its incidence in typical use.
- Fix sketch: Introduce a narrow media owner inside the Agents client that shares in-flight metadata
  and immutable content/source reads by Node, media kind, and ID. Let mounted cards hold entries and
  bound idle retention by bytes, not just entry count. Clear or partition by Node, reject stale
  completion, and reuse the held bytes for download. Keep broker byte transport and authentication
  custody intact.

The least invasive first implementation can retain data URLs and remove repeated fetch and conversion
work. A Blob URL is a separate choice: `packages/client-core/src/kit/lib/markdown.ts:18` permits
HTTP(S) and `data:image/`, not `blob:`; sandboxed frames use a data-only image policy described by
that parser and the shell docs. A Blob-based owner needs a supported kit media surface or carefully
scoped URL policy, a frame-compatible data representation, and reference-counted revoke-on-eviction
cleanup. Do not broaden every Markdown URL policy as an incidental cache change. A thumbnail or
viewport-aware image surface also changes kit and terminal contracts, so neither is assumed here.

Execution gates:

1. Replay eight same-image card mounts. One in-flight metadata/content read and one source conversion
   serve the mounts. Two different Nodes or media kinds with the same ID remain isolated.
2. Unmount and remount within the retained bound. No repeated content read occurs. Exceed a chosen
   byte ceiling with distinct images and verify idle eviction. Held images and open modals survive.
3. Switch Nodes during metadata, byte reads, and conversion. The old completion may not populate the
   active scope. Broken reads can retry and do not become permanent rejected-cache entries.
4. Download uses the correct filename, media type, and bytes. Verify attachment and artifact cards,
   workflow conversation reuse, terminal fallback, and a loaded tool card using the kit.

## Conditional performance follow-ups

These are measured costs with a narrower implementation recommendation than a transcript rewrite.
Do F08-1 through F08-3 first, then validate the following in a visible optimized renderer.

### F08-4 Reuse parsed closed blocks in very long growing messages

- Evidence: `packages/client-core/src/kit/components/content/Markdown.tsx:76` parses the entire
  changed message. `packages/client-core/src/kit/lib/markdown.ts:120` normalizes and splits every
  line, and `:129` hashes each block's source while rebuilding its HTML. DOM reuse happens after
  that work at `Markdown.tsx:80`.
- Impact: A 200,000-character multi-paragraph synthetic message parses 5,001,950 characters for 150
  new characters. It takes 178.98 ms accumulated parser elapsed time across 25 frames. Its stream
  median is 9.060 ms, versus 0.300 ms with the same 400-card history and an 80-character tail.
  Stable DOM avoids replacing older paragraphs, but it does not avoid parsing them. The 20,000
  character fixture measures a smaller 1.723 ms median.
- Effort: M to L, including parser equivalence and shared-host tests.
- Risk: Medium to high. Tables need following-line lookahead, lists and quotes continue across
  lines, a code fence can remain open, and arbitrary source replacement must rebuild correctly.
- Confidence: High for the measured cost, medium that typical messages justify the complexity.
- Fix sketch: If a visible source-owner replay confirms this tail, let a kit-owned append-aware
  parser retain closed block render output and reparses only the open block plus required lookahead.
  Fall back to the authoritative full parser on source replacement or policy change. Preserve the
  established block keys, sanitization, image placeholder policy, duplicate-block identity, code
  copy controls, and asynchronous highlight liveness.

Do not remove the projection's identity check to address this result: its measured cost is tiny here.
Keep the baseline function and add equivalence tests for every parser block kind, CRLF, sentinels,
append boundaries, reopened tables/fences, and non-append replacement. The post-fix replay must run
through `AgentTranscript` and its production Markdown owner. Add a visible test for selection across
closed blocks while a later block grows. Code-fence highlighting and its queued allocations were
inspected but not measured; the fixture uses inline code only.

### F08-5 Limit initial DOM for exceptionally long histories

- Evidence: `plugins/agents/src/client/sessions/AgentTranscript.tsx:201` renders every visible key.
  The owning client-surfaces doc explicitly chooses an unvirtualized Timeline and suggests a fixed
  last-N window with a **Show earlier** control if opening becomes slow.
- Impact: The 2,000-card fixture creates 34,003 elements and 2,000 Markdown surfaces on mount. Its
  synchronous elapsed mount is 1,121.86 ms in jsdom, while initial projection is 0.689 ms. The 400-card
  fixture creates 6,803 elements. Stream updates remain narrow and stable. These counts establish
  proportional initial DOM work; they do not establish a one-second visible Tauri open.
- Effort: M to L, including reveal, reading-place, and subagent semantics.
- Risk: Medium to high. A fixed window must reveal remembered history and targeted requests, retain
  anchors when adding older cards, and expose the complete transcript without a measurement loop.
- Confidence: High for DOM work, medium for a threshold and user impact until visible measurement.
- Fix sketch: If visible measurements confirm the cost, implement the documented fixed history
  window in the Agent feature, with **Show earlier** and an explicit expansion path for a remembered
  anchor or request. Keep stable row keys and kit scroll authority. Start with the drawn window;
  server pagination or tail-first reads are a separate area-09 contract discussion.

A mounted window must expand for a pending question, a selected subagent, or a remembered historical
anchor before claiming restoration complete. Preserve independent reading place per surface, active
following, chats-only behavior, disclosure state, and request reveal. Do not restore the discarded
measurement-reset virtualizer or retain every hidden transcript's DOM.

## Retention, timers, and considered/rejected ideas

| Owner or candidate | Observed behavior and decision |
| --- | --- |
| Snapshot retention | Held snapshots plus three idle snapshots are implemented and pass the overlapping-hold probe. Dropped events, seen IDs, usage indexes, and completeness marks are cleared together. Retain this behavior. |
| Hidden pane models | Pane models can remain held while region DOM is disposed. `pane.shown()` gates read/attention scheduling, and conversation holds/reconnect subscriptions clean up with the mounted region. General model lifetime and atomic Node transitions remain area 07. |
| Shared socket | Per-mount activation counts are released with cleanup. The feature intentionally keeps one application-lifetime notification subscription. Removing background agent delivery would break attention. |
| Tool clocks | Built-in open tool bodies share one 60-second clock. The reader count starts it on the first open body and clears it on the last cleanup. No per-card interval leak is evidenced. Closed bodies defer mounting until first opened and preserve their local state across toggles. |
| Reading place | The map caps at 50, evicts oldest insertion, and clears session/Node scope. The owner probe confirms the bound. Filter/disclosure persistence and repeat-reveal tokens remain proposed in the scroll plan; they are not a measured performance finding here. |
| Composer retention | Non-empty unsent drafts intentionally outlive a mount. Shared payload/guards prevent two surface copies from drifting. The text-map deletion and completion failures are F08-2. An arbitrary blanket draft eviction would discard work and is rejected. |
| Many tasks | `taskSlices` deliberately retains signal identity for readers. It is not cleared as a map by `clear()`; values become empty through `setRoster`. `taskLoads`, delegation loads, event sequence maps, and composer maps have distinct lifetimes. No retained-heap or steady many-task cost was measured, so there is no general map-size fix in this report. F08-1 still guards later writes into these maps. |
| Ongoing tool streams | Live tool rows remain unfolded until eviction, as the owning doc states. 8,000 synthetic updates serialize to 10,060,680 bytes, while the shared fold produces one record of 8,192,250 bytes. Store-only append takes 7.50 ms synchronous elapsed and 11.13 ms process CPU across all 8,000 frames. The raw-row overhead is real, but append cost is low in this probe, output itself remains large, and no retained-heap benefit was measured. Defer client live-tool folding; it would also require projection support for replaced tool rows, seen-ID reach, and correct output replacement semantics. |
| Projection dependencies | The projection checks old record identity, and visibility/key/map/setter passes remain linear in cards. At 2,000 short cards the actual 25-frame projection total is 0.268 ms and overall stream median is 0.548 ms. Do not trade replay correctness for an unmeasured shortcut. |
| Sidebar and Center | Sidebar task slices and stable roster keys, batched page upserts, keyed Center maps, lazy archived reads, and separate fleet queries are shipped. Request lists still depend on snapshot writes, and workspace search issues a resource read per changed query. No many-request or typing-load measurement justifies another cache or debounce here. |
| Media URL and resolution | Browser-fetching Node URLs bypasses the broker contract and is rejected. Thumbnail dimensions alone do not reduce the preceding full byte read. Keep immutable full-resolution bytes and the image allowlist; F08-3 shares repeated work. Blob policy changes need explicit kit/frame compatibility. |
| Read-mark timer | The source shows a 350 ms pending read timer can outlive a `shown()` transition because the effect returns before canceling a timer, while root cleanup cancels it. This was not exercised here. Hand it to area 07's shown/lifetime tests if those tests do not cover pending timers; it is not a ranked claim or a duplicate request to rebuild shown gating. |

## Future compatibility and behavioral invariants

`docs/future/scoll_fix.md` marks reading place, stable row identity, and consumable intent as shipped;
filter and disclosure state remains proposed. Keep the same reading-place owner and leave room for
that view state. A cache or parser change must not mount hidden transcript DOM to retain it.

`docs/future/client-plugins/` proposes more replaceable surfaces, while tool cards and conversation
capabilities already cross contribution boundaries. Put scope tokens and media reads in the feature
owners, not in core-specific pane DOM. Preserve compiled and loaded tool renderers, and the Workflows
conversation capability. Keep Markdown parsing and DOM reconciliation in the kit so both hosts and
remote trees use the same component contract.

`docs/future/remote.md` extends the client topology. Explicit Node targets, serializable byte replies,
no renderer-held credentials, and scope-safe completion remain compatible with that design. No
Node-to-Node shared cache or database is proposed.

Required invariants across all handoffs are:

- A Node's rows, events, attachment IDs, contexts, and asynchronous writes never enter another Node's
  store or draft, including colliding IDs and return navigation.
- The complete durable transcript remains available. Sequence gaps, folded reach, out-of-order
  frames, reconnect reads, and late usage remain correct.
- Rows and established Markdown blocks preserve DOM, focus, and selection during streaming.
- Mounted conversations and attention request lists keep their snapshots. Idle snapshot retention
  remains bounded, and outgoing releases cannot decrement an incoming generation's ownership.
- Two composers share one session draft and its guards while keeping view state and reading place
  independent. Offline errors preserve unsent work.
- Images retain allowlisted formats, correct download bytes, and broker authentication custody.
  Any media cache is bounded and owns disposal of every retained resource.

## Verification and limits

The initial store run passed three cases in 1.99 seconds. The initial composer/render run passed
three cases in 7.15 seconds. The CPU-instrumented replay passed all six cases in 7.64 seconds with
one worker. `08-verification-before.txt` records the commands and results. Application lint and the
bounded full suite had already passed under the coordinator; this source-read-only audit did not
repeat those gates or change application code.

For implementation, move meaningful cases into the colocated owner suites, following existing
`managedStore.test.tsx`, `AgentComposer.attach.test.tsx`, `AgentTranscript.test.tsx`, and
`Markdown.test.tsx` patterns. Run the focused host and logic suites, `rtk proxy pnpm lint`, and
`rtk proxy pnpm test`. The harness imports private source to inspect owners; production must keep
the package export and plugin boundaries. If implementation changes the owner, update the probe to
invoke the replacement production path before replaying.

UI changes require a separate isolated, visible Tauri session through `pnpm dev:agent` and the
documented snapshot/click/fill/screenshot/stop workflow. Cover simultaneous streaming, historical
anchors, request reveal, mid-text selection, two conversation surfaces, images, modal/download,
session navigation, Node collision, and disposal. Coordinate the fixture changes with the audit
coordinator. The existing hidden/unfocused session provides no visible-latency acceptance evidence.

Sentry's `agents.session.open` aggregate has 574 spans, median 157.9 ms, and p95 30,000.8 ms, matching
the 30-second fallback in `agentTelemetry.ts`. The inspected records lack a release ID. Sparse very
long transcript spans and the renderer's visibility state make elapsed telemetry unsuitable for
attributing CPU to this checkout. These leads do not prove this audit's mechanisms explain the
production tail.

Unmeasured scope includes a full day of actual use, optimized WebKit timing, real image decode/RSS,
retained JavaScript heap, large syntax-highlighting streams, real many-task sidebar load, fleet
search request frequency, loaded remote tool payload costs already owned by area 03, and server
ledger/process/usage work owned by area 09. The source owners and concrete client candidates are
covered; no further benchmark expansion is required before selecting implementations.
