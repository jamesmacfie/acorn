# Editor documents, file trees, search, and view retention

Investigated October 1, 2026, against `f8e4b59c`. Application source remains unchanged.
Eight handoffs cover document custody, refresh correctness, avoidable retention, search production,
tree rendering, tree freshness, and safe text loading. Document custody is a prerequisite for
retention or body limits: a faster editor must preserve the person's unsent text.

## Ownership and data flow

The editor plugin owns task file selection, tabs, lazy directory listings, project search, the
file document pool, and its Node routes. Client-core owns the engine utilities, kit collections,
host document surfaces, and loaded UI document grants. The Node owns task roots, confinement,
filesystem reads and writes, formatter hooks, marker providers, and ripgrep. The helper owns
authenticated transport. Rust owns the window and does no editor or filesystem work here.

The inspected paths are:

| Path | Responsibility |
| --- | --- |
| `plugins/editor/src/node/index.ts` | Route and WebSocket registration, editor/search capabilities, the before-save hook, and the marker extension point. |
| `plugins/editor/src/server/routes/editor.ts`, `routes/search.ts`, and `contract/api.ts` | Task-scoped routes, body validation, bridge capabilities, and wire shapes. |
| `plugins/editor/src/server/editor.ts` and `search.ts` | Fresh root resolution, directory/file bodies, marker providers, writes, and bundled ripgrep. |
| `packages/node-core/src/server/core/fs.ts` | Lexical and realpath confinement. Safety checks remain fresh. |
| `plugins/editor/src/client/editorClient.ts` and `search/searchClient.ts` | API requests and the one-minute checkout-root query. Bodies are not query-cache entries. |
| `packages/client-core/src/infra/node/apiClient.ts`, `packages/custody/src/broker/nodeBroker.ts`, and `nodeRequest.ts` | Request Node selection, offline mutation refusal, custody forwarding, pinned TLS/device authentication, and buffered response delivery. |
| `plugins/editor/src/client/EditorPane.tsx`, `editorState.ts`, `editorViewState.ts`, and `openFilesSlice.ts` | Reused CodeMirror view, retained states/history, saved baselines, dirty/preview tabs, cursor/scroll, and persisted tab descriptors. |
| `packages/client-core/src/host/registries/panes/paneModels.ts` | One retained model per pane; task replacement and scope eviction. Generic Node identity and teardown defects belong to area 07. |
| `plugins/editor/src/client/FileTree.tsx`, `editorTreeState.ts`, and `fileTreeReveal.ts` | Lazy listings, retained expansion, flat visible projection, and reveal intent. |
| `plugins/editor/src/client/search/SearchPanel.tsx` and `commands.ts` | Debounced find-in-files, retained hidden results, and per-command quick-open listing reuse. |
| `plugins/editor/src/client/lineMarkerExtension.ts` | Range decorations and transaction mapping. |
| `packages/client-core/src/features/editor/DocumentSurface.tsx`, `documentModel.ts`, `language.ts`, `theme.ts`, `viewState.ts`, and `embed.ts` | Host editor, declared routes/completions, Node-qualified view state, grammar policy, and embedded code boxes. |
| `packages/client-core/src/host/frames/register.ts`, `frameServices.ts`, and `broker.ts` | Lazy host region composition and the structurally granted document handle for frames and remote trees. |
| `packages/client-core/src/kit/components/layout/Rows.tsx`, `DocumentTabs.tsx`, and `apps/tui/src/kit/{editor.ts,rectangle.tsx}` | Collection keyboard/virtualization, tabs, and terminal host projection. |
| `plugins/editor/src/client/EditorTerminal.tsx`, `wsChannel.ts`, and `server/wsChannel.ts` | Disposable `$EDITOR` PTY and return-to-disk behavior. |

The main flows are:

1. A task opens the lazy editor contribution. The pane paints a truthy cached root and refreshes
   through the Node API; it awaits a missing root rather than treating cached absence as final.
   Remembered-file text and grammar start while root resolution runs. Hover prefetch warms the
   root only. File reads go through the platform WebSocket and custody broker to the authenticated
   editor route. Each service call resolves the authorized task root and confines the path.
2. The pane joins a same-mount read by relative path. It constructs a CodeMirror `EditorState`,
   stores it and its saved `Text`, and swaps that state into one reused `EditorView`. Reconfiguration
   replaces mount closures while preserving state fields, including undo. Pane close/remount keeps
   the model; another task replacing the pane model does not retain every previous task's documents.
   Tab descriptors persist to Node preferences, but full text and undo do not persist across restart.
3. Edits derive dirty status from the saved text, promote previews, and schedule a 1.5-second save.
   Saves pass through the Node's `editor:before-save` hook, then write confined text, invalidate
   shared worktree status, and announce the ordinary worktree change. Marker providers resolve
   through the extension point, with provider failures isolated. Ranges return to the renderer;
   decorations already map through subsequent CodeMirror transactions.
4. Tree listings fetch only the root and expanded directories. Session expansion survives remount,
   while listing bodies are local to a tree mount. Find-in-files debounces text for 200 milliseconds,
   posts validated options, resolves the root, and runs bundled ripgrep. The parser groups hits,
   converts UTF-8 offsets to UTF-16 columns, and caps the response at 2,000 hits with 300-character
   previews. Both sidebar panels remain mounted when hidden to preserve their state.
5. A loaded plugin declares a document region, routes, and a language identifier. The host lazily
   creates `DocumentSurface`, pins the Node, substitutes encoded task/project values, checks the
   body, and owns CodeMirror, saves, completions, view state, and actions. A sibling frame or remote
   tree receives read/write/flush access through an accessor. This structural grant does not expose
   engine instances or let plugin UI choose a Node, arbitrary route, or filesystem path.

The report reads the docs index, architecture, conventions, editor, frontend, panes,
state ownership, caching, plugin map, future index, client-plugin replaceable surfaces/hosts,
and compiled-tier proposal. `docs/editor.md` contains the historical Monaco comparison,
CodeMirror migration, and multi-document design record. The compiled-tier proposal's Monaco
editor row is historical; it is not evidence about the shipped engine.

## Shipped work and boundaries to preserve

History and source confirm these changes:

- `41fb22d3` omits grammar above 256 Ki characters and skips state construction after a pane
  unmount. Both the file editor and host document surface use the size guard. This is a syntax
  threshold, not permission to trim body text.
- `db10dc97` changes selection before asynchronous loading, rejects obsolete active-tab
  completions, stabilizes tab definitions, and restores nested retained tree expansion.
- `a9cd78a1` contributes changed-line markers through the provider seam.
- Editor panes, host document surfaces, grammars, terminal editor mode, and kit heavy imports
  already have lazy boundaries. Neither Monaco replacement nor generic startup splitting is a
  finding. The pane already joins its warm-up and visible read in flight.
- Quick-open keeps one successful file-list promise per command execution context, bounds its
  projection to 100, and uses the host command session's bounded rows and abort lifecycle.
- `Rows` already reconciles unchanged items by key. The tree probe retained its first row when a
  folder opened. Area 10 owns virtual-row identity repairs; area 12 needs to select virtualization
  and pass row placement rather than invent a second collection.
- Git status already joins running reads, has a two-second window, shares numstat, and bounds its
  sweep. Area 11 owns the 48-command/eight-read PR marker common-comparison reduction. The
  findings here concern renderer admission and document/range identity.

The terminal host aliases editor grammar/theme utilities to no-ops and projects the kit editor
rectangle without mounting a graphical CodeMirror view. Direct CodeMirror imports remain in a lazy
editor chunk. The rectangle implementation is a placeholder rather than a measured complete text
viewer; `$EDITOR` PTY mode is the editing handoff. Do not change portable tree/command contracts to
require browser DOM objects. Terminal fallback and keyboard/reveal behavior need terminal validation
after implementation. The remembered-file warm-up at `EditorPane.tsx:249` can call `stateFor` before
a graphical view exists, so the facade comment's claim that this always waits for a view is too broad.
Area 15 can characterize that terminal path; no terminal CPU probe selects a bundle/engine rewrite here.

## Measurements

Renderer probes import the actual components, CodeMirror, stores, document handle, and pane model
under the Solid browser build. Transport and unrelated sidebar panels are synthetic where stated.
The custody case uses the actual API client and Node/QueryClient swap with a synthetic platform
transport. The Node probes invoke the actual editor/search services and fresh confinement on
disposable non-Git files. They do not include HTTP serialization, broker copies, TLS, or webview
rendering in their CPU measurements.

The authoritative renderer baseline is tag `before7`: four files, 11 characterization tests passed,
with no unhandled errors, in 7.81 seconds. Passing means the workload completed and recorded the
bad behavior, not that the behavior satisfies the desired invariants. Node evidence uses `before`.
The hidden/unfocused Tauri session was left unchanged. No elapsed time below is a visible UI claim.

| Workload | Before observation | Evidence |
| --- | --- | --- |
| 24 sequential clean previews, each about 64 Ki characters | One open tab retained 24 states and 24 saved texts, containing 1,573,430 characters. Those references remained after pane unmount. Total synthetic workload used 841.139 ms process CPU. | `12-preview-retention-before7.json` |
| Focus read held while the person types | Completion replaced the unsent edit with external disk text, cleared dirty, and subsequent blur wrote that disk text. | `12-focus-read-race-before7.json` |
| Close a dirty tab after `{ok:false}` | Tabs and both document maps became empty; the error remained but the draft did not. | `12-failed-close-before7.json` |
| Two held saves completed in reverse order | Two writes were admitted together. The first snapshot became disk content after the later snapshot had completed. | `12-save-order-before7.json` |
| Node A editor teardown during a switch to B | A PUT for `node-a-task` and its unsent text targeted `node-b`. Task IDs were different, so this does not depend on pane-model ID collision. | `12-save-custody-before7.json` |
| Disk marker response held across an inserted first line | Disk line 1 decorated the unsent first line rather than the disk text it described. | `12-marker-revision-before7.json` |
| Text ready while optional markers remain pending | The pane stayed empty and read-only, with no pooled state, until markers completed. | `12-marker-gate-before7.json` |
| File body read rejects | The pane created an editable, saved empty document without showing the read error; typing then saving sent replacement text. | `12-failed-read-before7.json` |
| Second host document flush during an identical pending write | The second promise resolved before acknowledgement; one pinned-Node write was still pending. | `12-surface-flush-pending-before7.json` |
| Host document write rejects | `flush()` resolved while displaying an error and retaining the visible edit. | `12-surface-flush-failed-before7.json` |
| Root directory with 200 files plus one folder | 201 tree rows, 805 elements, 62.420 ms process CPU to the measured mount observation. | `12-tree-before7.json` |
| Root directory with 2,000 files plus one folder | 2,001 tree rows, 8,005 elements, 476.362 ms process CPU. Opening the folder retained the first row. | `12-tree-before7.json` |
| Synthetic Node listing changes during the tree mount | Collapse/reopen used only the original root read plus folder read; the added root file remained absent. No worktree-event injection was measured. | `12-tree-before7.json` |
| One file with 2,000 search matches | 786,960 stdout bytes for 2,000 hits and a 504,956-byte response; 13.628 ms Node CPU. | `12-search-before.json` |
| One file with 8,000 search matches | 3,154,156 stdout bytes for the same 2,000-hit response; 12.771 ms Node CPU and 4,756,960-byte post-GC heap delta. | `12-search-before.json` |
| One file with 100,000 search matches | 32 MiB stdout hit `ERR_CHILD_PROCESS_STDIO_MAXBUFFER`; the service returned zero hits and `truncated:false`. Node CPU was 65.463 ms; post-GC heap delta was 27,369,928 bytes. | `12-search-before.json` |
| Whole 17 MiB text body plus sentinel | Service returned all 17,825,807 characters; JSON projection was 17,843,227 bytes. CPU was 35.322 ms. | `12-bodies-before.json` |
| Six invalid UTF-8/binary bytes read and written unchanged by the caller | Three invalid bytes became replacement characters; the successful write expanded the six-byte file to 12 bytes. | `12-bodies-before.json` |

Preview retention is a count of strong references and character content, not a retained-heap estimate.
Saved and current `Text` can share structure; do not count them as independent full string copies.
Search CPU excludes ripgrep CPU. Its heap deltas come from single runs with explicit GC and include
process-output machinery; they establish the workload's retention at that observation, not a lasting
application leak. The body probe releases its text before the final heap reading, so its 41,424-byte
delta does not measure whole-document residency. Search's cold 215 ms wall result is not comparable
to warm spawns and is not a proposed latency gain.

Earlier artifacts remain for provenance. `12-tree-before.json` used a mutable listing fixture,
so its added-file observation is invalid; `before7` uses copied Node answers. The custody `before5`
run lacked an online fleet fixture and observed offline refusal; `before7` is authoritative.
Earlier harness attempts needed one Solid/browser build and one CodeMirror module instance.

## Findings

### [PERF12-01] Pin and serialize file saves before releasing a draft

- **Evidence**: `plugins/editor/src/client/editorClient.ts:30` creates one API whose requests omit
  Node identity. `packages/client-core/src/infra/node/apiClient.ts:143` chooses the active Node at
  request delivery. The actual keyed swap probe sends Node A's outgoing save to Node B.
- **Evidence**: `plugins/editor/src/client/EditorPane.tsx:440` admits every save independently and
  updates the global tab store after awaiting. `EditorPane.tsx:454` closes and deletes state after
  `save()` returns, including a refused save. Reversed successful writes restore an earlier body.
- **Impact**: Navigation can misroute text, close can discard a refused draft, and overlapping
  saves can write stale text. Repeated clean flushes also perform unnecessary writes, hooks,
  worktree invalidation, and marker refresh.
- **Effort**: M, about one to two days including lifecycle tests and the shared custody integration.
- **Risk**: HIGH. Teardown must save to the outgoing owner without mutating an incoming store or
  disposing a newer edit. Global serialization would also stall independent documents.
- **Confidence**: HIGH. Three actual-owner cases reproduce the failures.
- **Fix sketch**: Capture the originating Node through the public client facade and give each
  document an acknowledged snapshot plus one admitted write and a coalesced latest snapshot.
  Make close await successful custody of its current revision, retaining the full dirty state on
  refusal/rejection or edits during the wait. Fence completion bookkeeping by the owning scope,
  and skip acknowledged clean snapshots while still joining a matching pending write.

Unacknowledged snapshots need an owner beyond a retiring pane/model so navigation failure can retry
to the same Node. A cancelled read can be discarded; a save snapshot cannot be discarded merely
because the view or QueryClient changed.

Integrate with area 06's originating-Node custody and area 07's model identity/teardown ordering.
Those generic fixes do not serialize editor writes or repair failed close. Catch transport errors
as well as `{ok:false}`. Preserve format-on-save/veto behavior; the Node can transform text at
`server/editor.ts:100` but returns only `{ok:true}`. Validate the acknowledged body when a formatter
changes it, rather than assuming submitted text equals disk. This formatter case is source evidence,
with the fail-before recipe in the validation section.

### [PERF12-02] Make host document flush acknowledge the current text

- **Evidence**: `packages/client-core/src/features/editor/DocumentSurface.tsx:145` treats pending
  text as saved because line 147 assigns `saved` before the write acknowledges. A second flush
  returns while the first is pending. `DocumentSurface.tsx:156` catches failure without rejecting.
- **Evidence**: `DocumentSurface.tsx:194` runs a surface command after resolved flush.
  `packages/client-core/src/host/frames/broker.ts:516` already awaits the document operation and
  can return failure; a swallowed surface error bypasses that mechanism.
- **Impact**: An execute action or frame flush can claim the write route has the text while the
  save is pending or failed. Further edits can also admit overlapping writes. Cleanup destroys
  the view after starting a save; only cursor/scroll survives in `documentModel.ts`, so failed
  teardown has no owned full-text retry buffer.
- **Effort**: M, about one day for save admission, flush semantics, and failed-teardown retention.
- **Risk**: HIGH. Surface actions depend on exact ordering, and autosave must handle rejection
  without producing an unhandled promise or dropping the dirty document.
- **Confidence**: HIGH for premature/success-on-failure flush, reproduced through `DocumentHandle`;
  failed-unmount draft loss is source-confirmed and needs its lifecycle case before implementation.
- **Fix sketch**: Advance the saved baseline after acknowledgement and join or queue writes per
  document. Resolve explicit flush only after its current snapshot is acknowledged, reject failure,
  and keep a Node/scope/URI-qualified unsent snapshot for retry when the surface goes away.
  Autosave and cleanup catch and display/retain failures; commands and bridge flush receive them.

This is the host document owner. Do not push save semantics into each loaded plugin or change the
structural document grant. Its Node is already pinned and its document write ceiling already exists.

### [PERF12-03] Fence reloads and markers by document revision

- **Evidence**: `plugins/editor/src/client/EditorPane.tsx:469` checks dirty before awaiting a focus
  read, but line 476 only checks mount/path on completion. A later edit is overwritten and marked clean.
- **Evidence**: `EditorPane.tsx:354` applies a marker response to whichever pooled/live document
  exists when it completes. There is no document revision or request generation check.
  `plugins/editor/src/client/lineMarkerExtension.ts:34` maps accepted decorations through later
  transactions, but cannot repair ranges first applied to a different body.
- **Evidence**: `EditorPane.tsx:313` includes optional marker work in the text/grammar `Promise.all`.
  The ready-text probe stays empty until the marker response arrives.
- **Impact**: Focus can lose unsent text; markers can identify the wrong lines. A slow optional
  provider delays usable text, and overlapping refreshes perform work that can finish obsolete.
- **Effort**: M, about one to two days; a provider/body revision contract requires coordinated tests.
- **Risk**: MED. Dropping stale markers is safe, but revision changes must preserve provider
  isolation, transaction mapping, and external-file discovery.
- **Confidence**: HIGH. Held completion probes reproduce all three cases.
- **Fix sketch**: Capture Node/task/path, read generation, and document identity, then recheck them
  and dirty status after each await before applying a reload. Show usable text independently of
  optional markers, join matching marker refreshes, and accept disk ranges only for the body
  revision they describe, mapping subsequent edits or deferring them while text diverges.

A renderer generation alone does not prove that the Node's marker provider and body read saw the
same disk revision. Preserve a provider snapshot/version contract or verify the body's revision
at the owning Node; do not stamp unrelated reads as consistent. Keep fresh safety checks. Do not
cache Git provenance here; area 11 owns common comparison joining. Avoid scheduling a write merely
because an acknowledged external reload uses a CodeMirror transaction.

### [PERF12-04] Release superseded clean preview documents

- **Evidence**: `plugins/editor/src/client/editorState.ts:19` removes the previous clean ephemeral
  tab. `plugins/editor/src/client/EditorPane.tsx:350` adds every loaded preview to the retained pool,
  while explicit close at line 459 is the path that removes it. The tab and pool memberships diverge.
- **Evidence**: `EditorPane.tsx:106` says remember is only for open files, but checks pool presence,
  not open-tab membership. Pane cleanup intentionally retains the pool. The preview fixture keeps
  24 documents after 23 preview tabs have disappeared.
- **Impact**: Browsing files increases retained text, undo/extension state, saved baselines, and
  old mount closures despite one visible/open preview. There is no per-pool byte budget.
- **Effort**: S, several hours for membership reconciliation and pending-preview lifecycle tests.
- **Risk**: MED. A preview promoted by editing or a later completion must keep its text and undo.
- **Confidence**: HIGH. Actual pool references remain before and after unmount.
- **Fix sketch**: Reconcile file/saved/read admission with the canonical open-tab set and retire
  superseded clean previews once their required save custody finishes. Fence removed-preview read
  completions so they cannot reinsert a discarded state, and make remember check membership.

Retain kept and dirty tabs, undo, selection, and scroll across same-task pane toggles. Releasing
closed previews is an immediate ownership repair. An LRU or hard byte bound that evicts open/dirty
documents is conditional on an explicit retention policy and draft protection; it is not selected.

### [PERF12-05] Bound search production and cancel superseded work

- **Evidence**: `plugins/editor/src/server/search.ts:109` buffers the entire ripgrep output before
  parsing; `search.ts:52` splits that whole string. The 2,000-hit cap bounds only the later response.
  At line 113, all process failures become an empty successful result.
- **Evidence**: `plugins/editor/src/client/search/SearchPanel.tsx:25` debounces text but provides no
  cancellation or cleanup of the debounce. `search/searchClient.ts:9` and `server/routes/search.ts:12`
  carry neither the observer signal nor process lifetime. The 100,000-match fixture reports no hits
  after the 32 MiB process buffer cap.
- **Impact**: Searches produce and retain discarded output, and superseded/disposed searches can
  run until the ten-second timeout. Overflow, invalid regex, and execution failure masquerade as
  no matches. The measured output grows fourfold from 2,000 to 8,000 matches for the same response.
- **Effort**: M, about one to two days for incremental parsing, cancellation, and error cases.
- **Risk**: MED. Child shutdown, chunk boundaries, ignore rules, UTF-16 columns, and truthful
  truncation must survive; cancelling one observer must not abort another if work is shared later.
- **Confidence**: HIGH for unbounded-to-cap production and empty overflow result, measured through
  actual ripgrep; absent cancellation is source-confirmed rather than a child-CPU measurement.
- **Fix sketch**: Parse bounded stdout chunks/events while ripgrep runs, retain at most the
  accepted result plus evidence of another hit, and terminate owned work once truncation is known.
  Forward a pinned observer signal from the panel through the route/bridge to the child, cancelling
  it on query replacement/disposal, and classify no-match separately from failure.

Preserve 2,000 hits, 300-character previews, UTF-8 to UTF-16 conversion, regex/word/case options,
ignore behavior, and task authorization. Bound a single oversized JSON line too. Cancellation
depends on area 05's transport and area 02's forwarded Request signal ownership when the loaded
path is used. Retain hidden-panel query/results as designed; hiding alone need not discard them.
Search row virtualization is a secondary source lead: the response is bounded, and this report
does not measure its DOM cost or select a result-layout rewrite.

### [PERF12-06] Render the file tree through the kit viewport

- **Evidence**: `plugins/editor/src/client/FileTree.tsx:93` uses `Rows` without `virtual`.
  Its row callback at line 116 ignores the placement argument. `packages/client-core/src/kit/components/layout/Rows.tsx:42`
  already exposes the viewport path and placement contract.
- **Evidence**: `FileTree.tsx:47` projects visible branches into a flat array. The actual tree/kit
  fixture renders 2,001 rows and 8,005 elements for a wide root; the same workload at 201 rows has
  805 elements. The first row survives expansion, so generic reconciliation is already working.
- **Impact**: Every visible entry produces DOM even when outside the sidebar viewport. A tenfold
  directory width increases the measured row/element count tenfold and process mount CPU from
  62.420 to 476.362 ms in jsdom.
- **Effort**: S, several hours for the virtual option, TreeRow placement, reveal, and host checks.
- **Risk**: MED. Keyboard active descendant, reveal scrolling, row density, and terminal projection
  must still use the shared collection contract.
- **Confidence**: HIGH for the DOM bound and source ownership; visible webview latency is unmeasured.
- **Fix sketch**: Select the kit's virtual collection path and pass its offset/height to `TreeRow`.
  Preserve stable keys, expansion, selection, and reveal; use the portable kit rather than a plugin
  DOM virtualizer.

The flat projection and expansion scan remain proportional to loaded visible entries. Do not add
an incremental tree index until a representative post-virtualization profile identifies that as
the remaining cost. Integrate area 10's `Rows` identity repair instead of duplicating it.

### [PERF12-07] Revalidate affected mounted tree listings

- **Evidence**: `plugins/editor/src/client/FileTree.tsx:26` returns for every previously loaded
  directory. Line 30 installs responses without a disposal/request generation check. The component
  has no worktree, reconnect, or focus invalidation subscription.
- **Evidence**: `plugins/editor/src/server/editor.ts:111` announces the ordinary worktree change
  after save. A changed synthetic Node answer does not enter the mounted tree on collapse/reopen.
  `FileTree.tsx:76` also lets a reveal chain finish without checking a newer reveal revision.
- **Impact**: Files created/removed by an agent or another client remain stale until remount.
  A cached parent can prevent reveal of a newly created path. Overlapping refresh/reveal work needs
  explicit generation ownership before adding revalidation.
- **Effort**: M, about one day for scoped invalidation, joining, and stale completion cases.
- **Risk**: MED. A broad tree refetch would turn every status ping into a filesystem walk and
  disrupt expansion/selection. Offline failure must leave the last usable listing visible.
- **Confidence**: HIGH for cache lifetime and absent subscriptions; the probe measures cached return,
  not event fanout or all external mutation sources.
- **Fix sketch**: Mark loaded directories stale on task-scoped worktree/reconnect changes and pay
  one coalesced refresh for mounted visible/expanded branches, with a focus freshness fallback
  appropriate to external edits. Join per-directory reads, fence completion/reveal by mount and
  request generation, and preserve usable rows and expansion until a fresh answer succeeds.

Use the Node event and authorized list route, not a renderer filesystem watcher. Do not refresh
collapsed, never-loaded subtrees or cache the Node's root/realpath guards. A reveal for an unknown
child needs a fresh parent before treating absence as final. This complements area 11's Node event
and freshness work; it does not introduce a second Git cache.

### [PERF12-08] Reject unusable bodies without creating an editable empty file

- **Evidence**: `plugins/editor/src/server/editor.ts:66` performs an unbounded whole UTF-8 read.
  Invalid bytes decode with replacement characters; writing the returned text succeeds and changes
  the bytes. The 17 MiB synthetic text remains whole, including its sentinel.
- **Evidence**: `plugins/editor/src/client/EditorPane.tsx:314` catches read failure as `''` and
  pools it as a successful saved document. The failed-read case sends typed replacement text.
  `packages/client-core/src/features/editor/DocumentSurface.tsx:268` instead refuses a body above
  the wire's 2 MiB limit, but checks only after transfer/decoding.
- **Impact**: An unreadable, offline, or future size-refused file can become an empty editable
  replacement. Invalid binary bytes can be irreversibly changed by an apparently unchanged save.
  Whole bodies also traverse buffered transport before grammar skipping reduces engine work.
- **Effort**: M, about one day for honest read errors and exact text decoding; L if selecting a
  new large-document storage/transport policy.
- **Risk**: HIGH. A borrowed Git or host-document cap would remove supported large file behavior,
  and trimming text or evicting dirty text can lose data.
- **Confidence**: HIGH for silent read failure, lossy decode, and whole-body service behavior;
  peak broker/webview memory and an appropriate file-editor ceiling remain unmeasured.
- **Fix sketch**: Keep read failure as an explicit noneditable load error, retaining any usable
  prior buffer. Validate exact supported text bytes at the Node owner and reject unsupported
  encoding/binary input honestly, using fresh confinement and a bounded-read policy that never
  returns a successful partial document. Select any file-editor size ceiling only with explicit
  support and draft-retention requirements.

Valid text containing a literal replacement character is not evidence of invalid encoding; validate
the original bytes. Preserve whole supported large text and full dirty text/history. The host's
2 MiB bridge limit is an established loaded-document contract; it is not the file editor's limit.
Area 11's `localNewSideText` also uses whole `readFile`; a safe text policy can be shared through a
narrow Node capability/helper if both owners need it, without plugin-to-plugin imports. Its Git
patch truncation fix remains separate. Area 05 owns response-copy reduction.

## Replay and acceptance gates

All probes default to `sample`. A `before` tag refuses to overwrite an existing baseline. Run:

```sh
rtk proxy pnpm exec vitest run --config plans/performance/12-probe.config.ts
rtk proxy node --expose-gc --import tsx plans/performance/12-node-probe.mjs search
rtk proxy node --expose-gc --import tsx plans/performance/12-node-probe.mjs bodies
```

Use `ACORN_PERF_TAG=after12` through the environment for tagged renderer output, or run
`rtk proxy env ACORN_PERF_TAG=after12 pnpm exec vitest run --config plans/performance/12-probe.config.ts`.
Pass a final tag argument for Node probes. The config uses one worker and the production Solid
browser/CodeMirror modules. The tree probe supplies a 300-pixel viewport for replay of the virtual
path and waits for usable rows rather than requiring the bad full row count.

The probes are characterization workloads, not assertions that bless the baseline. Promote these
conditions to focused regression tests while implementing:

- One clean preview remains in both document maps after 24 sequential previews. Kept and dirty
  files retain full text, undo, and view state across same-task close/remount. Hold a preview read,
  replace that preview, release the read, and verify it cannot reenter the pool.
- The outgoing Node A save targets A after switching to B, including colliding task/path IDs,
  late completion, failed transport, and scope eviction. No completion changes B's tabs/dirty state.
- Failed close retains the dirty tab, document, and history. Type again while close awaits a save;
  the later edit must be acknowledged before removal or remain available. Reverse admitted save
  completions and verify the latest text lands. In the baseline two are admitted together.
- For the formatter fail-before case, contribute a before-save handler returning different text,
  save, and compare the acknowledged baseline/visible text with the actual file. The baseline
  assigns the submitted document as saved despite the transformed disk body.
- Both pending host flushes remain unsettled until acknowledgement. Failure rejects explicit flush
  and prevents action/bridge success; autosave handles the error. For failed teardown, edit the
  host surface, reject cleanup's write, remount the same Node/scope/URI, and verify the unsent text
  can be recovered. The baseline only remembers cursor/scroll and rereads disk.
- A focus read cannot overwrite an edit made while it waits. Reverse two focus completions and
  reject the obsolete one. Pending optional markers do not delay text. A disk-line response held
  across an inserted first line is mapped to the correct revision or declined, never applied to
  the inserted line. Provider failures and absence leave the text usable.
- Tree DOM is bounded by viewport plus overscan at both directory widths. Preserve keyboard
  navigation, selected key, density changes, nested reveal, and overlapping row identity. Inject
  a task-scoped worktree event after adding/removing a synthetic listing entry; baseline has no
  tree subscriber and retains the prior listing. Reconnect/focus, held obsolete responses, deleted
  expanded folders, and a newer reveal replacing a held reveal need the same tests.
- Search over 100,000 matches returns its bounded prefix with truthful truncation, without a
  32 MiB buffered result or false no-match. Instrument both `spawn` and `execFile` if implementation
  changes process admission; the probe must count the new production owner, not its retired seam.
  Hold/supersede/dispose searches and verify child exit/listener cleanup. Test chunk splits, a huge
  single line, multiple matches per line, Unicode, ignore rules, invalid regex, and true no-match.
- Rejected bodies never become editable empty files. Invalid UTF-8 is refused without changing
  disk. A supported 17 MiB body retains its sentinel, and edits beyond any rendering threshold
  survive save and navigation. Size-policy changes must test growth during read and full refusal,
  with an explicit supported limit; no successful prefix or dirty-buffer truncation is accepted.
  Cover valid multibyte text and edits crossing the loaded document limit: database scratch's
  route validates character count at `plugins/database/src/server/routes/database.ts:72`, while
  host read and frame write limits count UTF-8 bytes. Area 13 can validate that route's consistency.

If document storage moves out of `EditorPane`, update the pool observation to the actual new
production owner while retaining the component-driven navigation workload. If range wire shapes
change, update the synthetic provider's revision fields so the held-response case remains realistic.
If read refusal becomes a typed error, record that error in the Node body probe and verify the file
bytes remain unchanged rather than allowing the script to stop before recording the safe outcome.

Baseline `pnpm lint` and bounded `pnpm test` passed in the coordinator's setup. The area 12 handoff
attempt of `rtk proxy pnpm lint` stopped in oxlint on the unused `taskHierarchy` import in
`plans/performance/07-rail-probe.mts:3`; package type checks did not run. A focused oxlint invocation
over the area 12 TypeScript/JavaScript probes passed without diagnostics. The source-owner
characterizations above are the focused audit checks, and the tree
viewport replay adjustment passed a separate one-test `sample` run. Application implementation
must run lint, the owning tests, bounded full tests, and real Tauri validation. This report makes
no claim that jsdom CPU predicts webview input latency.

## Invariants and future compatibility

Nodes remain independent. Every file/search/PTY call uses the authenticated task capability and
fresh Node root/confinement; stale observations cannot authorize a write. Mutation failure keeps
unsent text. Offline reads can show their last usable content with stale status, but a missing read
is not a successful empty file and an offline mutation is not queued for another Node.

Document engine ownership remains in the host/client document layer. Plugins supply routes,
language identifiers, completions, hooks, and marker contributions through their contracts. A
loaded UI receives only the document handle belonging beside it. Preserve `services.document`,
route confinement, Node pinning, the wire write ceiling, and frame/tree accessor lifetime.

The future multi-document/open-document contract can adopt an explicit Node/scope/URI document
session with acknowledged text, admitted writes, revisioned reads, and retained dirty data. Keep
that bookkeeping separate from mounted engine/theme/keybinding closures. Do not introduce a
singleton global engine, a plugin filesystem watcher, or a shared dirty-text cache across Nodes.
File-tree virtualization belongs in the portable kit; process bounds belong in the Node search
owner. `kit/` must not import feature stores, custody, plugin registries, or filesystem services.

## Considered and rejected work

- Generic startup/language splitting, syntax threshold tuning, and duplicate warm-up-read caches:
  shipped guards and lazy boundaries already cover these paths.
- Clearing the document pool on every unmount: loses the documented text/history/view continuity.
- A hard LRU of open/dirty documents or copying the host/Git cap into file editing: requires a
  supported-body and draft-retention decision. Clean superseded previews can be released first.
- Caching root, realpath, branch, or refusal facts: weakens safety or external-edit correctness.
- Caching marker Git comparisons in the renderer: wrong owner and duplicates area 11.
- Replacing CodeMirror, reducing undo history, or stripping `basicSetup`: no measured remaining
  engine bottleneck justifies changing typing/undo behavior. The pool keeps state fields by design.
- Rewriting flattening or quick-open ranking: source shows full projections, but the bounded
  command session and stable tree rows already exist. Profile after DOM bounds before selecting it.
- Broad completion caching or a completion protocol rewrite: requests include whole document text
  and lack forwarded cancellation at `DocumentSurface.tsx:217`, but no representative completion
  workload was measured. Preserve the per-view completion source and bounded items.
- Persisting full dirty documents to preferences/query cache: changes recovery/privacy/retention
  contracts and would duplicate area 06. A scoped session retry buffer is distinct from durable drafts.

## Validation gaps and handoff

The measured synthetic cases establish ownership failures, row/output bounds, and service behavior.
They do not establish visible Tauri timing, long-session peak heap, remote link transfer costs,
terminal host rendering, every formatter/marker plugin, or actual search-child CPU. No private
documents or paid provider work were used, and the live session was left unchanged.

Area 07 must establish Node-qualified model identity and ordered teardown before document custody
integration. Areas 02/05 own end-to-end signal/transport disposal; area 10 owns the kit virtual-row
identity repair; area 11 owns marker common comparisons and complete diff bodies. Area 12 adds the
editor-specific writer, dirty retention, revision admission, and portable tree consumers.

The immediate measured performance work is preview membership, incremental bounded search, and
tree virtualization. Save acknowledgement, safe load failure, and revision fencing are required
correctness work around those changes. A total open-document byte budget, broad completion work,
and larger document transport/storage changes remain conditional on the stated product and live
measurement gates.
