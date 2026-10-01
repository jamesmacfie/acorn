# Terminal client performance investigation

Baseline: `f8e4b59caadfe846a9e2c6491ac42b91ec3cf66f`. Application source remains unchanged.
This audit uses the TUI's universal Solid transform, actual cell renderer, shared collection owner,
and real file cache adapter. Fixtures contain synthetic records and use disposable directories.

Seven concrete handoffs address keyboard scans, virtual list admission, wrapping, clipped painting,
log windows, Node custody, and editor warm-up. The first two affect repeated navigation directly.
An overlay can turn a 24-row virtual list into 2,000 mounted rows while the list is hidden.

## Runtime and ownership

| Owner | Responsibility |
| --- | --- |
| `apps/tui/src/node/{open,attach,pair,supervise,paths}.ts` | Resolves the selected Node, attaches with a remembered device token, or starts and supervises a standalone Node. |
| `apps/tui/src/platform.ts`, `packages/custody/src/broker/` | In-process custody, pinned TLS, device authentication, fleet records, HTTP aborts, WebSocket frames, and plugin custody. Drawing code cannot import custody. |
| `apps/tui/src/main.tsx`, `App.tsx` | Installs the host seam and cache adapter, restores a Node partition, creates the renderer, and registers the roster after the first frame. |
| `apps/tui/src/chrome/` | Workspace/task selection, routing, remembered place, pane strip, palette, overlays, Node status, and notification chrome. |
| `apps/tui/src/tree/`, `layout/`, `paint/` | Solid's universal node operations, Yoga allocation and ownership, layout read-back, cell painting, front/back buffers, and terminal diff output. |
| `apps/tui/src/input/`, `keys/`, shared `kit/keys/` | Terminal byte parsing, keymap tiers, focus regions, collection movement, typing, paste, and rectangle delegation. |
| `apps/tui/src/kit/`, `layouts/` | Terminal projections of the portable kit and layouts. Host aliases replace browser-only adapters. |
| `apps/tui/src/plugins/` and shared `host/tree/` | Permission-scoped worker threads, shared worker pooling, bridge checks, validated remote trees, host actions, and cleanup. |

Data follows these paths:

1. `openNode` resolves the Node's stable identity and custody records. A previously opened but stopped
   Node returns its identity before its handshake. First-ever startup and pairing wait because no
   identity/cache or stdin interaction is ready for the renderer.
2. `installPlatform` creates `NodeBroker` in process. The host facade supplies requests, aborts,
   authenticated event frames, and sanitized fleet records. Tokens remain behind this module seam.
3. `main.tsx` installs `fileCacheStorage` before `clientFor`, selects the opened Node, and awaits the
   persisted partition restore. That restore performs one synchronous file read and JSON hydration
   before drawing. Queries use client-core's keys and shared cache policies.
4. Compiled plugins and loaded component trees produce the same closed-kit components. Solid writes
   plain nodes. Yoga owns their geometry; `readBack` writes screen rectangles; paint reads nodes into
   a reused back buffer; `flush` writes changed cell runs under synchronized terminal output.
5. The byte parser emits input events into the same dispatcher the test harness drives. The region
   store owns focus. Collections own logical active/selected keys. An entered PTY rectangle intercepts
   all keys, including Ctrl+C, and delegates them to its Node-owned process.
6. A PTY rectangle owns a headless xterm and its 1,000-line scrollback. Binary Node output feeds its
   parser; parser completion requests a frame. Attachment disposal releases the channel and emulator.
7. Loaded plugins run in workers with filesystem access to their bootstrap and accepted bundle only.
   The shared tree worker host owns slots, heartbeats, grace, and failure fanout. Remote tree state
   validates batches before the terminal's tree renderer draws them.

The tree has explicit owners. `createElement` frees each Yoga handle with its Solid owner;
`removeNode` preserves an owned node across Suspense detachment. Collection row refs and handlers
remove their map entries on cleanup. The measured Rows cases retain zero row owners after disposal.
No finding here proposes destroying detached Suspense nodes or replacing Yoga.

## Contracts and prior work

Read `docs/README.md`, architecture/conventions, `tui.md`, `tui/interaction.md`,
`tui/chrome-and-plugins.md`, editor/cache ownership, and relevant future records for bundle shipping,
remote clients, replaceable chrome, and terminal rail markers. The Improve performance and finding
sections supplied the audit format. The Readable skill supplied the report style.

Git history and source confirm the previous terminal rewrite replaced OpenTUI painting with plain
nodes, Yoga wasm, reused cell buffers, synchronized diffs, and one coalesced frame request per event
loop turn. The roster and loaded-worker factory load after the first frame. DiffPane already has a
bounded assumed initial window, 20-row overscan, and spacers. `keyedRows` preserves unchanged data
objects. September changes moved more plugin UI behind loaders and preserve slot identity. Those
mechanisms remain useful and are not replacement candidates.

Keep portable kit semantics, host aliases, one Solid graph, Node-specific caches, the plugin bridge,
and worker permissions. The future remote-client proposal relies on independent Node partitions.
Replaceable chrome proposals rely on host projections of common contracts. None of these fixes
requires a terminal-only plugin API, a direct plugin import of core services, or weaker isolation.

## Evidence and reproducibility

The authoritative measurements are the `15-*-before.json` files, except collection timings use
`15-collection-before-v2.json`. The earlier collection file measured counting getters only;
`before-v2` adds ordinary objects to separate operation counts from instrumentation cost.
`sample` files are harness development/replay artifacts, not the selected baseline.

The first five-file run passed nine characterizations in 13.16 seconds. Two additional retained-pane
cases passed independently: hidden log/spinner and Rows visibility. There are 11 unique probe cases
in the completed configuration. The collection case also passed its corrected plain-object lane.
Seven existing TUI files passed 147 tests in 4.07 seconds.

The coordinator announced a short native baseline startup during source reading. It did not send a
completion notice before measurement. The timed run occurred several minutes after the stated
startup window. Operation counts and own-process CPU are the primary evidence; wall times are local
fixtures, not visible product navigation latency. No TUI full-process first-frame claim is made.

Run a replay with a fresh tag:

```sh
rtk proxy env ACORN_PERF_TAG=sample pnpm exec vitest run --config plans/performance/15-probe.config.mts
```

The `.mts` config imports the TUI's real Vite/Vitest host configuration. It adds absolute aliases for
dependencies the repository root does not expose, preserving one Solid and query runtime. An initial
`.ts` config attempt could not evaluate `import.meta.resolve`; it produced no baseline evidence.
Two fixture response shapes were corrected before the Node-switch baseline.

| Probe | Before result |
| --- | --- |
| Collection, 1,000 ordinary rows near the tail | Next/page/type-ahead: 21.7/21.0/23.8 CPU ms. |
| Collection, 5,000 ordinary rows near the tail | Next/page/type-ahead: 287.4/280.8/283.5 CPU ms. Counting lane: about 25 million disabled-property reads per operation. |
| Virtual Rows, 2,000 items at 80 by 24 | Builds 2,000 rows, disposes 1,976, retains 24; 460.7 CPU ms. |
| Virtual Rows, 10,000 items at 80 by 24 | Builds 10,000 rows, disposes 9,976, retains 24; 2,534.7 CPU ms, 1,917.4 wall ms. |
| Hide a retained 2,000-item virtual list | Builds another 1,976 rows; retains all 2,000 while hidden, with 22,005 tree nodes and 12,004 Yoga handles; 366.8 CPU ms. Revealing disposes the extra rows again. |
| Unbroken ASCII word wrap, width 80 | 100,000 characters: 44.7 CPU ms; 1,000,000: 4,131.0 CPU ms. The complete output is retained. |
| Clipped cell writer, 20 writes to 80 visible cells | 80-character input: 0.12 CPU ms; 1,000,000-character input: 288.1 CPU ms. Visible cells match. |
| Log, 10,000 unique lines | Retains 20,005 tree nodes and 10,004 Yoga handles; mount 368.8 CPU ms. Thirty unchanged warm frames cost 189.4 CPU ms versus 25.1 with 1,000 lines. |
| Remembered terminal editor file | Reads one 1.5-million-character file and its markers; constructs and retains one CodeMirror state/saved document, about 39.6 CPU ms. No graphical view or PTY mounts; cells show the placeholder. |
| Node A to B in real App and shell model | Provider remains A; A task observer 1, B 0. Refreshing A fetches B and writes B's tasks into A's cache. |
| Forget Node through real TUI file adapter | Throws `indexedDB is not defined` synchronously and leaves the partition file present. Fresh in-memory client is empty. |
| Mounted hidden spinner | Ten frames and zero sink writes over 800 ms, 4.2 CPU ms. With an actual 10,000-line Log hidden behind it: 69.8 CPU ms. |

These are operation counts and fixture timings, not retained-heap measurements. Tree/Yoga counts
identify strongly held objects. CPU includes garbage collection and fixture instrumentation where
specified. The 800 ms case does not establish a day-long CPU percentage.

## Handoffs

### PERF-15-01: Read the active collection key once per movement

- Evidence: `packages/client-core/src/kit/keys/collectionIntents.ts:70` filters enabled items;
  `:79` scans them to resolve the active key; `:102`, `:122`, and `:185` call that resolver inside
  each `findIndex` predicate for movement, page movement, and type-ahead.
- Impact: a near-tail key traverses the list quadratically. Virtual drawing does not remove this
  cost. Ordinary 5,000-item arrays consume about 280 CPU ms per operation in the actual owner.
- Effort: S. Risk: LOW. Confidence: HIGH.
- Fix sketch: capture the active key before each `findIndex`. Keep `active()` fresh once per logical
  operation. Memoizing enabled items is unnecessary to remove the quadratic work and needs separate
  evidence for mutation/identity semantics.
- After gates: replay the actual shared owner with ordinary objects and the counting lane. Require
  disabled reads to scale linearly, with a generous bound of eight times the item count for these
  cases. Preserve disabled filtering, controlled selection, wrapping arrows, page-edge bubbling,
  first/last behavior, type-ahead timeout and case matching, and empty lists. Run shared collection
  tests plus terminal key and reachability tests. This improvement also reaches desktop collections.

### PERF-15-02: Bound virtual Rows before layout and while hidden

- Evidence: `apps/tui/src/kit/showing.tsx:355` returns all items whenever measured height is zero;
  `:433` constructs the returned window. The size callback writes zero when an ancestor becomes
  `visible=false`. `apps/tui/src/chrome/Shell.tsx:223` retains its main row behind overlays.
- Impact: the first mount builds and tears down the full list. Opening an overlay repeats that
  admission and retains all rows while hidden. The actual 2,000-row visibility case costs 367 CPU ms
  to hide, despite drawing no rows.
- Effort: S to M. Risk: MED because keyboard landing and reveal depend on window geometry.
  Confidence: HIGH.
- Fix sketch: use a bounded assumed initial capacity, as TUI DiffPane does, and keep the last valid
  capacity when a retained list measures zero. Preserve authoritative logical selection separately
  from the drawn slice. A zero-sized hidden window must not mean an unbounded window.
- After gates: first admission remains bounded for 200/2,000/10,000 items; no full expansion on
  hide/reveal; scrolling still creates/disposes only the entering/leaving rows. Require bounded
  owners before the first corrective frame, 24 retained rows at 80 by 24, and zero row owners after
  disposal. Test initial selection outside the assumed slice, Home/End/page keys, empty responses,
  delayed lists, shrink/grow, wheel movement away from selection, focus fallback, and overlay return.
  Preserve unchanged row object identity and data refresh behavior. Do not drop authoritative items.

### PERF-15-03: Wrap oversized words in one pass

- Evidence: `apps/tui/src/layout/measure.ts:61` repeatedly calls `stringWidth(rest)` and
  `sliceToWidth(rest)` on a shrinking remainder. `apps/tui/src/width.ts:117` and `:130` scan the
  remainder with the ASCII regexp before taking the cheap length/slice path.
- Impact: 10 times more unbroken text costs about 100 times more CPU at 100,000 to 1,000,000
  characters. A long URL, encoded payload, or tool output can block the terminal renderer for seconds.
- Effort: S to M. Risk: MED because wrap boundaries use cells and grapheme clusters. Confidence: HIGH.
- Fix sketch: identify widths/breaks once and advance offsets through the word. Keep the ASCII path
  linear and segment non-ASCII text once where needed. Continue producing the complete wrapped
  document; a truncation or smaller content cap does not fix the algorithm.
- After gates: replay 10,000/100,000/1,000,000 characters and require near-linear growth. Compare
  complete line arrays for spaces, consecutive spaces, explicit/empty paragraphs, combining marks,
  astral characters, CJK widths, a cluster wider than the limit, control characters, and zero or
  infinite limits. Run width/layout/paint/markdown tests. Keep measured and painted lines identical.

### PERF-15-04: Stop allocating and painting clipped text tails

- Evidence: `apps/tui/src/paint/buffer.ts:143` asks `graphemes` for the entire input and visits every
  cluster after the right edge; `apps/tui/src/width.ts:110` returns a full split/segment array.
  `apps/tui/src/paint/paint.ts:144` also visits every wrapped line before cell clipping rejects it.
- Impact: twenty paints of one long line cost 288 CPU ms to change the same 80 cells. The array of
  all clusters is transient allocation, not a proven leak. Repeated unrelated frames can pay again.
- Effort: M. Risk: MED because the writer returns total occupied width for subsequent styled pieces.
  Confidence: HIGH for the measured horizontal writer; vertical-loop benefit needs its own after probe.
- Fix sketch: iterate clusters lazily and limit actual cell writes to the visible interval. Preserve
  the full-width return contract, using the ASCII width shortcut or a prepared run measurement when
  appropriate. Bound wrapped-row painting to the vertical clip. Keep any prepared cache under the
  measured run's owner and invalidate it on content, style, or width changes.
- After gates: replay real `writeRun`, preserve the returned width and exact buffers, and add actual
  `screen.frame()` cases for long styled runs and wrapped paragraphs. Test negative origins, left and
  right clipping, wide continuation cells, half-visible wide glyphs, zero-width clusters, spans
  crossing a wrap, and Unicode. No unbounded global text cache; measure transient allocations if a
  cache is introduced. Keep terminal control bytes filtered rather than writing raw input strings.

### PERF-15-05: Window retained terminal Log lines

- Evidence: `apps/tui/src/kit/showing.tsx:645` wraps a `For` over every line in `ScrollViewport`;
  `apps/tui/src/layout/pass.ts:81` reads every retained Yoga rectangle on each frame, including
  display-none descendants. `:124` performs the layout/read-back pass.
- Impact: 10,000 lines retain 20,005 tree nodes and 10,004 Yoga handles for a 24-row terminal.
  Thirty unchanged frames cost 189 CPU ms. Hiding the pane stops cell output, but retains traversal.
- Effort: M. Risk: MED. Confidence: HIGH.
- Fix sketch: window the one-cell-high log rows using the TUI DiffPane spacer pattern and the
  viewport's authoritative offset/height. Keep all bounded source text available to find/copy and
  preserve the find bar outside the scrolling region. Use line indices to distinguish duplicate
  strings; do not use log text as a unique row identity.
- After gates: retained tree/Yoga counts scale with viewport plus bounded overscan, including the
  first layout and hidden state. Replay mount and 30-frame CPU evidence. Test duplicate lines,
  empty logs, append, clear, changing tail bounds, Home/End/page keys, wheel movement, scrollbar
  geometry, find/reveal, and return after overlay/pane switches. Preserve source retention budgets.
  Review the `follow` contract explicitly: this implementation accepts it but does not pass it to a
  follow helper. Do not silently define follow behavior as part of a benchmark optimization.

### PERF-15-06: Switch TUI cache and lifecycle custody with the selected Node

- Evidence: `apps/tui/src/chrome/navigationCommands.ts:135` changes `activeNodeId`;
  `apps/tui/src/main.tsx:98` persists the opened Node only, `:205` invalidates that same client on
  recovery, and `:302` passes it permanently to App. `apps/tui/src/App.tsx:122` uses the fixed
  provider. `apps/tui/src/platform.ts:61` initially connects the opened Node only.
- Impact: a cache hit after switching displays A's rows. A later refresh addresses B and stores
  its result in A's partition. B has no observer in the actual App/shell-model probe. Footer,
  recovery reset, restore, persistence, and previously remembered remote connections need the same
  composition follow-through. Wrong cache ownership undermines fast cached navigation.
- Effort: M to L. Risk: HIGH because persistence, drafts, pane models, subscriptions, and commands
  cross the handoff. Confidence: HIGH for provider/cached-write reproduction.
- Fix sketch: separate supervised-process identity from active presentation identity. Compose the
  active Node's query provider, restoration, persistence owner, recovery invalidation, status chrome,
  and selected connection together. Reuse the shared ownership work from areas 06/07 rather than
  introducing another query client or a TUI-only partition model. Connect remembered Nodes on
  selection through custody's fleet seam. Capture outgoing cleanup destinations before the switch.
- After gates: the fixture shows B cache immediately, B observer 1/A 0, and B refreshes leave A
  unchanged. Extend through the real main composition and two disposable authenticated Nodes:
  switching, reconnect, offline B cache, permission changes, forget/re-pair, same task IDs, archive,
  pane/draft return, remote plugin bridge, and quit. Test return to A with its intact cached state.
  Ensure command registrations dispose before replacement registrations. Supervised A remains the
  process quit/restart owns even while B is visible. Add active B persistence/restore evidence and
  preserve the terminal's deliberately limited restored slices; no automatic opt-in of every
  desktop slice. Dependency: shared cache/pref custody and pane lifecycle fixes from 06/07.
  If provider selection moves into a main composition factory, adapt the replay to invoke that
  production owner. Leaving the fixture's constant `client={a}` around a fixed-prop App would keep
  testing the replaced composition even after main selects the correct client.

### PERF-15-07: Materialize graphical editor states only for a graphical consumer

- Evidence: `plugins/editor/src/client/EditorPane.tsx:250` warms the remembered path on mount;
  `:334` creates a CodeMirror state and `:350` retains it in the pane pool.
  `apps/tui/src/kit/rectangle.tsx` projects the editor rectangle without calling its DOM mount.
  `docs/tui.md` says direct CodeMirror imports are lazy bytes with no work on this host.
- Impact: the actual terminal host reads a 1.5-million-character remembered file, reads optional
  markers, constructs CodeMirror state, and retains the state/saved text after unmount. The displayed
  rectangle remains a placeholder. The fixture costs about 40 CPU ms without a graphical consumer.
- Effort: S to M. Risk: MED. Confidence: HIGH.
- Fix sketch: place graphical state admission behind the host's editor adapter/capability and
  graphical mode. Preserve desktop parallel root/file warm-up and terminal `$EDITOR` handoff.
  A terminal text preview, if provided later, should request its own read model rather than requiring
  DOM-specific save listeners, decorations, and undo state to show text.
- After gates: terminal host does not materialize CodeMirror state or fetch a body/markers solely
  for an undrawn graphical consumer. Test remembered and newly opened files, `$EDITOR` start/exit,
  tab changes during a pending read, mode changes, and remount. Desktop warm-file tests preserve
  one parallel read and dirty/undo/view state. Correct the owning doc's claim using implementation
  evidence. Dependency: area12 read generations, dirty custody, and preview-pool retirement. Keep
  this separate from a bundle rewrite; imported lazy bytes alone were not selected as a CPU finding.

## Dependencies and conditional work

Area06 owns adapter-based partition retirement. `15-cache-before.json` supplies its TUI fail-before
gate: `dropNode` calls browser IndexedDB synchronously, throws before its `.catch`, and leaves the
real file snapshot. Require no exception, no file after removal, no trailing resurrection, and safe
same-ID replacement. Continue using atomic mode-0600 files in a mode-0700 directory. Do not implement
an independent deletion path in the terminal host.

Hidden spinner work is conditional after Log and Rows bounds. `startSpinner` ticks every 80 ms,
and a hidden mounted Spinner still changes its node and requests full frames. With the retained log,
ten unchanged frames cost 69.8 CPU ms over 800 ms; the small hidden spinner costs 4.2 CPU ms. Replay
after windowing. A residual cost may justify visibility-aware decoration invalidation, but the
evidence does not select a global frame clock or a new visibility context. Preserve current data
updates and immediate repaint when the pane returns.

Area03/16 own remote handler retention and pooled worker context custody. The terminal host shares
the worker pool but has its own bridge closure in `apps/tui/src/plugins/RemoteTree.tsx`; include its
Node/task/document/query-client bindings in the warm reuse gate. `workerFactory.ts` captures worker
stdout/stderr and leaves them unconsumed. A chatty plugin is a stream/backpressure lead for area16,
requiring an actual permission-worker probe. It is not a measured leak in this report.

TUI Markdown/Timeline still retain content blocks outside the visible clip. Shared agent lifecycle,
projection, snapshots, and draft work from areas08/09 applies here. Transcript virtualization is a
separate change with follow/anchor semantics; the Log fixture does not establish its performance.

## Verification and boundaries

Run these existing drawing/adapter checks:

```sh
rtk proxy pnpm --filter @acorn/tui exec vitest run src/input/parser.test.ts src/width.test.ts src/tree/tree.test.ts src/paint/paint.test.ts src/node/cache.test.ts src/kit/scrolling.test.tsx src/keys/keys.test.tsx --maxWorkers 1
```

They passed 7 files/147 cases. The audit did not start a provider, PTY program, real standalone Node,
or normal profile. The Node-switch test substitutes chrome with the real shell model to isolate the
actual App/provider; it is not a full fleet integration test. The editor sidebar and API use synthetic
fixtures while the real pane, pool, CodeMirror state, and terminal aliases run. The cell writer and
wrap tests invoke production owners directly. No copies of their implementations are timed.

After selected fixes, run `pnpm lint`, relevant shared/client/TUI tests, `pnpm --filter @acorn/tui test`,
and the coordinator's bounded `pnpm test`. Build the terminal bundle and run its startup graph check
after source changes. A visible fake-TTY or PTY session must cover actual startup, cached/offline
restore, input modes, Node switching, pane/overlay cycling, `$EDITOR`, loaded trees, and shutdown.
Preserve frame buffers/screenshots and resource samples from a repeated-use run. The checkout had
no `apps/tui/dist` during this audit; source transform time is excluded from product startup claims.

Rejected candidates include replacing Yoga, introducing a permanent repaint timer, dropping
scrollback/source text, reducing undo history, bypassing the bridge, broad worker permission grants,
another query client, and indiscriminate cache expiry. The source already coalesces synchronous tree
bursts, skips hidden subtrees in paint, diffs terminal cells, and bounds PTY scrollback. The tests
show row cleanup rather than a row-owner leak. A screen root lasts for one TUI process, so repeated
test renderer roots do not establish a production navigation leak.

Remaining evidence gaps: full bundled TUI startup latency, real-terminal sink backpressure and
emulator behavior, authenticated two-Node integration, remote plugin worker output stress, retained
heap under day-long active use, and transcript windowing. Sentry records were not queried here:
`tui.frame` is a histogram, not a trace span, and absent release identifiers would not establish
checkout causality. The local probes identify CPU algorithms and ownership failures without relying
on pre-fix production traces.
