# Performance candidate ledger

Status: investigations complete; selections grouped in `implementation-plan.md`. The area reports own
the evidence, invariants, limitations, and replay instructions; this ledger groups handoffs and
dependencies. A correctness prerequisite is part of its performance fix, not a reason to weaken
isolation or persisted-state guarantees.

## Measured handoffs from completed areas

| Area | Owner and candidate | Evidence to preserve |
| --- | --- | --- |
| 01 | Skip unchanged bundled-state commits | Eight unchanged packages caused eight durable writes and fsyncs |
| 01 | Batch client index and trust commits | Seven packages caused fourteen fsyncs on fresh custody |
| 02 | Scope invocation RPC references and reuse stable exports | About 40 MiB retained per additional 10,000 context calls in the fixture |
| 02 | Dispose rejected reload candidates | Three rejected reloads left three extra workers |
| 02 | Preserve forwarded Request cancellation | Pre-aborted Request arrived with an un-aborted signal |
| 03 | Own frame ports and subscriptions explicitly | Forty disposed frames retained forty subscriptions and ports |
| 03 | Release obsolete remote event handlers | Removed/replaced closures retained about 45 MB until root disposal |
| 03 | Reconcile loaded contributions by semantic changes | Twenty unchanged panes unmounted and mounted again |
| 04 | Bound PTY ring objects with segmented storage | One-byte ring fixture retained 262,144 Buffer objects; tiny-chunk overflow was expensive |
| 04 | Serialize run-target lifecycle by task and target | Eight overlapping starts left eight sessions |
| 04 | Publish structural terminal roster changes centrally | Direct creation/removal emitted no roster change |
| 04 | Dispose engine callbacks, timers and attachment clients | Late output could schedule work after engine disposal |
| 05 | Declare renderer Node event interests explicitly | Fleet reads changed event forwarding and suppressed the selected Node |
| 05 | Use native compatible helper base64 encoding | Eight-MiB fixture was about 191 ms versus 0.6 ms CPU in coordinator replay |
| 05 | Remove the response-body clone | Current response construction allocates a second body-sized byte array |
| 05 | Reject pre-aborted transport reads | Pre-aborted read still performed a fetch |
| 05 | Abort renderer-owned requests on disconnect | Disconnected renderer retained an active request |
| 05 | Coalesce disconnected terminal controls by owner | One thousand obsolete attach/detach pairs replayed one thousand screen restorations |
| 06 | Coalesce dehydration at the production persistence owner | Three thousand query invalidations caused nine million predicate checks |
| 06 | Retire persistence before deleting a Node partition | A trailing write could restore a removed partition |
| 06 | Observe preference slices independently | One slice change serialized three thousand bindings across all slices |
| 06 | Bind queued saves and rollback queues to originating QueryClient/Node | Deferred writes used the later active Node; reverting a queued value did not cancel it |
| 06 | Read only the finite device preference key set | Twenty observers scanned 40,040 unrelated storage keys |
| 07 | Qualify pane models by their owning Node and order teardown | Colliding task/pane IDs reused the outgoing Node model |
| 07 | Detach terminal sinks from their originating Node | Inactive sink remained and prevented a fresh return snapshot |
| 07 | Share parsed rail ordering and pin membership | Three hundred rows parsed the same preference 601 times on mount |
| 08 | Fence asynchronous managed-store reads by Node/generation | Late reads repopulated a replacement Node store |
| 08 | Capture composer operation/draft custody before awaits | Deferred attachment work affected the replacement session |
| 08 | Deduplicate bounded attachment media reads | Eight image cards read eight copies of the same one-MiB image |
| 09 | Own provider processes from spawn through bounded shutdown | Failed initialization and hanging close left owned processes; native PTY descendant remained |
| 09 | Admit queued turns before cold provider startup | Twenty queued turns started twenty handles while only two could execute |
| 09 | Read durable queue heads without history-sized session scans | Empty queue with 5,000 sessions performed 5,001 statements |
| 09 | Project searchable stream heads without repeated full-head indexing | Four-MiB synthetic head consumed about ten seconds CPU while growing |
| 09 | Wait on narrow execution facts and read complete turn results | Waiter mapped 104,000 old turns; bounded prefix omitted completion after 500 events |
| 09 | Join in-flight provider discovery | Twenty concurrent cold readers started twenty probes |
| 09 | Append daily usage records without argument spreading | A valid 200,000-record file failed despite being within the byte limit |
| 09 | Seek tied session timestamps with a deterministic cursor | Twenty tied sessions returned only the first five |
| 10 | Own cold worker startup and retire work safely | Eight concurrent builds created eight syntax and eight word-diff workers |
| 10 | Preserve overlapping virtual-row DOM identity | One-row window shift retained zero of 199 overlapping DOM rows |
| 10 | Skip obsolete fence work and join identical highlighting | Replaced/disposed fences still highlighted; eight identical callers highlighted eight times |
| 10 | Version expanded context and reject stale gap completions | Late context from an old revision entered the refreshed diff |
| 11 | Fence Node HEAD observations by task | Overlapping invalidated reads emitted B, A, B for one transition |
| 11 | Bound admission of fresh filesystem stamps | Four readers of 3,000 files reached 12,004 outstanding lstat requests |
| 11 | Join overlapping PR common-comparison resolution | Eight marker reads ran 48 commands, including 32 common operations |
| 11 | Retire expired cached Git stdout | Twenty-four synthetic large outputs retained about 16 MB after TTL and directory removal |
| 11 | Decode exact Git path records | Quoted names had no content keys and produced empty patches with changing poll keys |
| 11 | Reject incomplete untracked diff bodies | A 17 MiB file returned a successful partial 16 MiB patch |
| 12 | Pin and serialize file saves before releasing drafts | Outgoing A text targeted B; reversed writes restored stale text; failed close removed the draft |
| 12 | Acknowledge host document flushes and retain failed teardown text | A second flush resolved before its write; failed flush reported success |
| 12 | Fence reloads and markers by document revision | A held focus read replaced a later edit; stale disk ranges decorated unsent text |
| 12 | Release superseded clean preview documents | One preview tab retained 24 document states and saved-text references |
| 12 | Bound search production and cancel superseded work | A 100,000-match search buffered 32 MiB then returned a false empty result |
| 12 | Use the kit viewport for file trees | A 2,001-row root created 8,005 elements |
| 12 | Revalidate affected mounted tree listings | Collapse/reopen retained an obsolete listing; no event subscriber exists |
| 12 | Preserve honest body-load failures and exact text | Failed reads became editable saved empty files; invalid UTF-8 changed on unchanged save |
| 13 | Join and retire per-task database pool creation | Twenty cold queries created twenty pools; nineteen survived disconnect |
| 13 | Join and batch fresh catalog reads | Eight readers over 100 tables generated 1,608 statements |
| 13 | Cap returned SQL rows before normalization | 250,000 cells were normalized for 200 returned rows |
| 13 | Finish Docker child ownership on error/close | Thirty-two actual failed spawns permanently occupied all stream slots |
| 13 | Join Docker health and skip empty-inventory matcher work | Sixteen cold health calls ran sixteen commands; zero containers still caused 301 config reads |
| 13 | Maintain bounded Docker tails without per-chunk full projection | Eight prefilled tails consumed about two CPU seconds for 24,000 small chunks |
| 13 | Capture Docker Node/store/subscription ownership | Departing A cleanup targeted B, and B output entered A history |
| 13 | Decode HTTP bytes without iterable character mapping | Five-MiB V8/jsdom decode used about 250 ms CPU and large transient allocation |
| 13 | Qualify HTTP draft operations and forward caller cancellation | A response attached to B's draft; caller abort did not reach outbound fetch |
| 13 | Align SQL scratch byte limits with retained failed edits | Four-MiB Unicode write succeeded but could not load; refused edit disappeared on remount |
| 13 | Reserve and retire pending preview tunnels | Twenty-four listeners bypassed cap sixteen; pending close/dispose still published |
| 13 | Join overlapping preview URL resolution | Eight same-task readers ran eight script operations; disposed refresh still announced |
| 14 | Reconcile Memory index deltas and join current passes | Five unchanged reads made 3,000 inserts and 10 deletes; overlapping readers repeated file/index work |
| 14 | Select compact workflow history/navigation columns | Navigation materialized 33.3 MB of strings for 200 descendants |
| 14 | Page workflow detail before materializing outputs | A 50-record page read 22.3 MB from 300 child runs and 1,200 steps |
| 14 | Coalesce client schedule and run-pane refreshes | Thirty edges admitted 31 simultaneous schedule runs and 60 pane detail reads |
| 14 | Remove unused stdout copies and scope live run state | Twelve run selections retained 4.93 million text characters in unused event arrays |
| 14 | Bind authoring saves/acknowledgements to originating Node/entity | Outgoing A cleanup was delivered to B; a reused store accepted an obsolete revision |
| 15 | Capture the active collection key before movement scans | Five thousand items caused about 25 million disabled-property reads per key |
| 15 | Bound virtual Rows before layout and while hidden | Hiding a 24-row window mounted and retained all 2,000 logical rows |
| 15 | Wrap oversized words in one pass | One-million-character ASCII word consumed about four CPU seconds |
| 15 | Avoid processing clipped cell-text tails | Twenty 80-cell paints scanned one-million-character tails |
| 15 | Window terminal Log nodes | Ten thousand source lines retained 20,005 tree nodes and 10,004 Yoga handles |
| 15 | Compose the active TUI Node's cache and lifecycle | A remained observed; refreshing A fetched B into A's cache |
| 15 | Admit graphical editor state only for graphical consumers | Undrawn remembered file fetched body/markers and retained CodeMirror state |
| 16 | Scope pooled tree authority independently of shared module state | Desktop and TUI warm slots retained A's document, Node, cache and focus container |
| 16 | Preserve logical viewer ownership through custody | A detach stopped B; final viewer disconnect left terminal/Docker resources alive |
| 16 | Consume captured TUI worker output without retaining it | Actual permission worker stalled at 64 KiB until host drain |
| 16 | Dispose partially started UI workers and ports | Ten bridge failures left ten workers and forty endpoints outside pool cleanup |
| 16 | Fence helper telemetry lifecycle and adoption | A delayed preference answer reinstalled a sink after disposal |

## Dependencies and decisions

- Explicit renderer event interests precede targeted outgoing-Node terminal detach. Cleanup sends
  must not change which Node's events the renderer receives.
- Preference write custody precedes pane teardown changes. Notes also need a captured Node API
  for their delayed body saves. Cleanup must complete writes to the original owner.
  Pane model and drawn-view keys must identify their Node. Verify component cleanup after model
  retirement cannot reinsert old document state or decrement a replacement Node's drawn count.
- RPC invocation reference ownership precedes forwarding Request signals, so signal listeners do
  not introduce a new unbounded reference lifetime. Registered callbacks and returned functions
  need explicit longer ownership.
- Shared terminal subscription cleanup must account for other live renderer viewers; area 16
  owns that characterization. Input and action frames remain ordered and reliable.
- Search projection is a derived-index change with migration, query barriers, crash recovery,
  ranking, phrase, tokenizer and scope gates. Canonical event storage remains authoritative.
- Queue admission must cover both public enqueue and the pump while preserving explicit session
  prewarming, durable acceptance, fairness and independent workspace/provider limits.
- Media deduplication initially preserves the existing data-URL contract and sanitizer policy.
- New pane, composer and draft ownership must preserve unsent work and the supported offline view.
- Editor save custody integrates with preference and pane scope ownership before preview release.
  Failed writes retain full text and history; host flush success requires acknowledgement.
- File-tree consumers use the shared kit viewport after its overlapping-row identity repair.
  Search cancellation uses the transport and RPC signal owners rather than a second process path.
- Marker comparisons remain Node-owned; renderer marker admission needs a real document revision,
  not a fabricated match between independently read bodies. Body failure never means empty text.
- Docker streams join the transport/viewer ownership work. A generic seam must preserve another
  renderer's stream without hard-coding plugin channel names into custody. Same-Node hidden tails
  remain available; optimize append/projection rather than discard their history.
- Pool generation ownership precedes catalog joining. SQL normalization can be bounded independently
  of driver production; arbitrary statements still complete with existing transaction semantics.
- Scratch byte validation follows host failed-draft retention. Existing oversized stored SQL needs
  a recoverable opening or export path, never silent truncation or an inaccessible validator-only fix.
- HTTP cancellation and draft acknowledgement use request/subject ownership. A transmitted mutation
  can already have occurred; cancellation never authorizes automatic replay.
- Memory keeps files authoritative. Fresh source discovery and delta index writes precede any
  optional parsed-file reuse. Explicit writes require a post-write reconciliation barrier;
  recall touches and approved Findings receipts survive overlapping reads.
- Workflow list/detail projections remain separate from full execution and recovery data. Exact
  global processing counts precede page detail reads. Client coalescing retains a dirty follow-up
  for events after a read snapshot, independent of other observers' requests.
- Workflow authoring follows the same Node/save custody rules as Notes and editor documents.
  Only disposable display state can lose unused stream copies; canonical results and recovery
  retain their complete contents.
- TUI Node selection follows shared cache/pref and pane custody. Process supervision retains the
  opened Node identity while active presentation, connection, provider, restore, persistence, and
  status select the current Node. Replays must invoke the changed composition owner.
- Cell rendering bounds preserve complete logical content and keyboard selection. Wrapped text
  uses exact grapheme/cell semantics; clipped writers retain their full-width return contract.
  A hidden zero-height viewport must retain a bounded capacity, never admit all logical rows.

## Conditional work

These require further evidence or a product retention policy before choosing implementation:
terminal parser/transport credits, broad content-cache eviction, transcript virtualization,
append-aware Markdown parsing, deep task hierarchy restructuring, large settled-fence rendering,
and daily usage file caching. Current performance and future-plan boundaries must remain explicit.
Driver-level SQL buffering, native preview retention/navigation and HTTP saved-request list/detail
projection also need their report's missing measurements and compatible recovery/offline behavior.

The consolidated implementation plan records selections, deferred work, and measured acceptance
gates. The total histogram capacity gap is selected as a documented bound repair. Returned telemetry
handles extend area 02's tests; the synthetic full-queue copying cost remains conditional.
