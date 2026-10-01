# Diff rendering and highlighting investigation

The audit finds four immediate handoffs: serialize cold worker creation, preserve overlapping diff
DOM rows, skip obsolete fence highlights and share identical work in flight, and qualify expanded
context by the file version. Large fence highlighting has a measured main-thread cost, but choosing
a degradation threshold or a worker HTML path needs a visible renderer check. The append parser
follow-up remains the area 08 finding and is not a second implementation request.

Application source remains unchanged. Measurements use synthetic source, the production owners,
and the prepared dependencies at baseline `f8e4b59c`. Ten probe cases pass in the coordinator's
independent replay. Browser worker constructors are simulated for ownership counts. DOM and fence
measurements use Solid's development browser build and jsdom, so their elapsed times do not establish
visible Tauri latency or WebKit memory use.

## Source ownership and flow

| Stage | Owner and inspected paths | Contract and lifetime |
| --- | --- | --- |
| Local source | `plugins/changes/src/server/localDiff.ts`, `client/changesClient.ts`, `client/changesModel.tsx`, `client/model.ts` | The Node owns status, patches, and new-side file reads. `LocalChange.contentKey` combines object and working-tree stat evidence. The client model supplies one staging area's files through `DiffSource`, and separates file-set identity from content identity. Hidden model refreshes are owed until shown. Git subprocesses, filesystem cost, and polling remain area 11. |
| Pull-request source | `plugins/github/src/server/routes/pulls/pullFiles.ts`, `pullBlob.ts`, `client/queries.ts`, `DiffForPull.tsx` | Task views read summaries, then batches of patch bodies. Browse can read full files. Patch entries must match the current SHA. GitHub's blob query is immutable by SHA and has infinite stale time. The Node authenticates and owns the mirror and blob storage. |
| Compare source | `plugins/github/src/client/ComparePreview.tsx` | Compare payloads carry inline patches and use the same `DiffPane`; gap expansion, comments, and threads are omitted. The owning doc's older description of an independent compare toolkit renderer no longer matches this source. |
| Client transport and cache | Plugin `readJson` and `writeJson` wrappers, host QueryClient, platform broker | Product reads cross the platform WebSocket, helper custody broker, and authenticated Node API. The viewer receives structural data and callbacks, not credentials or Node storage. Query persistence and broad cache retention remain area 06. |
| Hydration | `kit/diff/hydration.ts`, `features/diff/parsedPublisher.ts`, `DiffPane.tsx` | Four-file fetch batches, sequential parsing within each hydrator, priority publication, per-path reactive statuses, content-version checks, and a generation/controller for reset and dispose. The publisher holds off-screen parses during scrolling and flushes on idle. |
| Model | `kit/diff/diffModel.ts`, `synth.ts`, `wordDiff.ts` | Parser output becomes file, hunk, code, gap, load, and thread rows. A hunk's old and new documents tokenize separately, with new-side context winning. Word diffs pair delete/insert runs and preserve both texts. Threads interleave after parsing, so thread changes do not repeat syntax work. |
| Workers | `infra/highlight/worker.ts`, `highlighter.worker.ts`, `wordDiffWorker.ts`, `wordDiff.worker.ts`, `messages.ts`, `wordDiffMessages.ts`, `langs.ts` | Window-level syntax and word-diff singletons accept document or file batches. Lazy Shiki grammars and themes live inside the syntax worker under Oniguruma. Grammar errors degrade one request; infrastructure errors mark the owner dead. Both clients use a 10-second timeout. |
| Viewer and DOM | `features/diff/DiffCanvas.tsx`, `stickyFile.ts`, `findController.ts`, `scrollRestoration.ts`, `viewState.ts`, `kit/diff/DiffRows.tsx`, `virtualization.ts`, `find.ts`, `splitScrollSync.ts` | Fixed 20-pixel unwrapped code rows, stable model keys, overscan of 80 rows, and variable-height measurements for threads and annotations. Find searches the model, including off-screen code. Split columns share offsets through one delegated listener. The viewer owns reading place, collapsed files, and the one open line composer. |
| Markdown | `kit/lib/markdown.ts`, `kit/components/content/Markdown.tsx`, `infra/highlight/shiki.ts`, `kit/components/primitives.tsx`, `content/Log.tsx` | The pure parser emits escaped HTML and block keys. Markdown reuses unchanged block DOM, owns copy controls, and applies asynchronous dual-theme fence HTML only to live blocks. Shiki's HTML cache already holds at most 200 inputs of at most 16,384 code units each. `CodeBlock` is a plain excerpt and does not automatically tokenize. |
| Plugin and terminal hosts | `packages/plugin-api/src/ui/diff.ts`, `client-core/src/host/tree/components.ts`, `host/frames/remoteSolid.ts`, `kit/tokens/support.ts`, `apps/tui/src/kit/showing.tsx`, `markdown.ts`, `shiki.ts`, `apps/tui/src/diffLong.test.tsx` | Compiled callers use the public diff port. Loaded trees lazily resolve the host viewer; frames use their kit realm. The terminal host uses the shared plain model with its own bounded row window, 20 rows of overscan and a 60-row initial estimate. Markdown goes through the same sanitizer, then cell conversion. Syntax color and intra-line word highlighting are reduced terminal contracts. Frame lifetime defects remain area 03. |

`docs/README.md`, `architecture-overview.md`, `conventions.md`, `frontend.md`, and `diff-rendering.md`
anchor this map. The proposed client plugins and remote topology keep the source port, public kit,
and host boundaries relevant. `docs/future/scoll_fix.md` preserves reading place, stable identity,
and selection across changes; its proposed filter and disclosure additions do not authorize a diff
or Markdown rewrite.

## Shipped work to preserve

Git history includes `48fe8e50` for large diff rendering and word-diff workers, `53b6fb96` for
conditional patch hydration, `9efd756c` for hydration, `9e5d90ca` for incremental streaming surfaces,
and the architecture and lazy loading changes represented by `efddc3b0` and the September 25-26 work.
The checkout already has the following behavior:

- Unchanged local content keys cause zero patch reads; moved files refresh without dropping their
  siblings to short placeholders. Shared numstat reads belong to the Node owner.
- Parsed rows and hydration statuses are keyed by file, with raw rows unwrapped from Solid stores.
  Completed fetch batches publish together, and active scrolling defers off-screen publication.
- Diff syntax work and word comparisons run in separate lazy workers. Whole hunk sides preserve
  grammar state. Large patch syntax skips coloring above 120,000 characters or 2,000 lines, though
  this guard does not bound word-diff work or gap expansion.
- Model identity keys preserve virtualizer measurements. Code rows do not wrap, unified width comes
  from the complete model, and split bands remain cold in unified mode.
- Markdown preserves unchanged paragraphs and closed fences. Grammar loading and the highlighter
  instance share promises. The exact-text HTML cache is already bounded.

These are not additional cache or worker migration findings. F10-1 and F10-2 repair ownership and
DOM behavior around those shipped mechanisms.

## Before measurements

The retained artifacts are `10-workers-before.json`, `10-workers-before-lifecycle.json`,
`10-canvas-before.json`, `10-markdown-before.json`, and `10-gaps-before.json`. The coordinator's
`10-*-coordinator-before.json` artifacts independently reproduce the ten cases.

| Actual owner workload | Recorded result | What it establishes |
| --- | --- | --- |
| Eight simultaneous `buildDiffRowsAsync` calls, production tokenizer and word-diff clients | Eight syntax and eight word-diff constructors. Each reset terminates one and leaves seven simulated workers live. | A concurrent cold import does not serialize singleton construction. A single hydrator parses its files sequentially; this is not eight workers for one ordinary eight-file hydration. Concurrent panes, expansions, or public toolkit calls can overlap. |
| Four cold syntax calls, first constructed worker reports an error | The last worker terminates; the erroring first worker remains unterminated. | An old worker's handler controls the shared pointer and unrelated pending calls. |
| Four cold syntax calls, first constructor throws | Four constructor attempts, three workers constructed after the failure, three still live; later calls create no worker because state is dead. | Import continuations do not recheck failure ownership after the await. |
| Two requests to each unresponsive worker, fake time advanced through both deadlines | One worker per kind, neither terminated, second calls reuse them. | A timeout resolves the waiting caller but leaves stuck worker ownership and future work intact. |
| Reset both owners with one request pending each | Neither promise settles at reset; two timers remain. Both settle only after the timeout. | The test-only reset clears entries without invoking their resolvers. |
| Actual unified `DiffCanvas`, window shifts from indexes 0-199 to 1-200 | 199 overlapping rows, zero preserved elements. The selected old row detaches. 27.09 ms synchronous elapsed and 50.64 ms process CPU in this development/jsdom run. | Fresh wrapper identities remount every overlapping row even when the model and virtual identity keys are stable. The mock virtualizer controls window input, not row markup. |
| Actual Markdown and warm TypeScript Shiki, four successive 20,000-character fences | 80,044 highlighted characters, 346.39 ms cumulative Shiki elapsed, 967.78 ms total process CPU, 3,280 final elements. | Each changed large fence repeats full synchronous highlighting and DOM construction. |
| Same owner, four successive 80,000-character fences | 320,044 highlighted characters, 1,038.59 ms cumulative Shiki elapsed, 2,142.30 ms total process CPU. Each HTML result has 641,680 characters; final fence has 13,097 elements. | Highlight calls take 244.99-272.14 ms individually in this fixture. The total also includes Markdown and jsdom work. These are CPU and allocation leads, not native-frame timings. |
| Eight identical simultaneous 10,000-character `highlightToHtml` calls | Eight `codeToHtml` calls, 80,000 processed characters. | The completed cache does not share a miss while `getHighlighter` is awaited, even when the grammar is warm. |
| Eight same-tick Markdown fence replacements | Eight highlights for one surviving block, 160,088 processed characters, 498.74 ms cumulative highlighting. | Seven obsolete blocks still consume work. This burst is distinct from the settled four-frame measurements. |
| Markdown disposal before the highlight import resumes | One highlight processes 20,012 characters after disposal. | The liveness check prevents insertion but does not prevent dispatch. |
| Actual `DiffPane` gap owner, delayed old read and changed signature | Two old context rows appear under active SHA B. | Expansion completion lacks the hydrator's generation guard. |
| Expanded gap followed by changed content key with the same gap coordinates | Two old context rows remain; the top gap is no longer present. | Content refresh retains expanded old context and removes the affordance to reread it. |
| Pane disposal before the gap body arrives | One tokenization starts after disposal. | The late completion still spends worker/main-thread work despite having no live consumer. |

The settled fence fixture changes a short frame comment after each complete highlight; it proves
full work for changed fence content without making claims about a 25 Hz event queue. The burst
fixture proves stale work separately. No retained heap, actual browser worker RSS, sustained queue
growth, or visible renderer latency is measured here.

## Immediate handoffs

### F10-1 Serialize cold workers and make failure cleanup belong to that instance

- Evidence: `packages/client-core/src/infra/highlight/worker.ts:58` awaits the constructor import
  before assigning the singleton at `:78`. `wordDiffWorker.ts:31` and `:46` repeat the pattern.
  Syntax `onerror` at `worker.ts:77` kills the shared pointer through `:35`; the handler has no
  worker identity check. Timeout at `:130` removes one pending entry without retiring the worker.
  Reset at `:151`, and the sibling reset at `wordDiffWorker.ts:83`, clear pending maps without
  settling requests.
- Impact: Concurrent cold callers construct and initialize extra workers, each with its own Shiki
  engine and grammar memory. The probe establishes constructor and orphan counts, not the bytes per
  browser worker. Failure of an orphan terminates another worker. A failed cold constructor can be
  followed by live workers that the dead state never uses. Timeout reuse keeps feeding a stuck
  worker, then sends the same workload to a synchronous fallback.
- Effort: M, including failure, deadline, cleanup, and production-owner tests.
- Risk: Medium. Per-document grammar failures must keep a healthy worker usable. Retirement must
  settle every affected request and preserve the documented degradation policy.
- Confidence: High for construction and ownership defects. Medium for their frequency in ordinary
  single-pane use and the real resource cost per orphan.
- Fix sketch: Hold one in-flight spawn promise per worker owner and qualify its continuation,
  handlers, and pending requests with an instance generation. Recheck that generation after import
  and before assignment, terminate a superseded instance, and resolve pending entries through their
  timer-clearing completion function. Handle `postMessage` exceptions at the same boundary so the
  public non-rejection contract is meaningful.

Do the cold-start and failure repairs first. Treat timeout policy explicitly: a worker deadline
must not leave an indefinitely blocked instance accepting more requests, and retiring it must not
move an entire pathological document or word-diff batch onto the renderer. Syntax fallback is
documented as JavaScript-engine, per-line degradation; word-diff fallback repeats the comparison
synchronously. A bounded plain-token or omitted-word-mark degradation for a confirmed deadline
requires an owning-doc update and source fidelity tests. Keep generic startup failure separate from
per-document grammar failure. Do not widen CSP as a startup repair.

Reset is exported for tests only. Its unresolved requests are not claimed as a pane disposal path;
the failing case is a cleanup contract needed to test and maintain the production owner. Normal pane
disposal presently leaves a shared window worker available for other callers.

After gates:

1. Eight concurrent actual row builds construct one syntax and one word worker. Cleanup leaves zero
   workers. A warm repeat constructs none.
2. Hold the import, reset or fail its generation, then release it. No worker can revive that owner.
   Fail construction, script startup, dispatch, and individual grammar requests separately.
3. An obsolete worker's message and error handlers cannot settle or kill the replacement owner.
   Pending reset/failure promises settle, timers clear, and no unhandled rejection remains.
4. Deadline retirement follows the chosen documented policy. Another outstanding viewer receives a
   valid completion or degradation, and later work is never posted to the retired worker.
5. Keep plain/unknown-language behavior, multiline hunk-side coloring, word text fidelity, lazy
   imports, fallback telemetry without source content, and the separate worker security policies.

### F10-2 Preserve DOM rows while a virtual window moves

- Evidence: `packages/client-core/src/features/diff/DiffCanvas.tsx:54` creates a new `{ vi, row }`
  object on each window read. `:73` uses those objects as Solid `For` identities. Split mode repeats
  this at `:58` and `:158`. Stable keys are supplied to the virtualizer by
  `kit/diff/virtualization.ts:25`, but do not become identities for the DOM list.
- Impact: The one-row shift remounts all 199 overlapping rows. Syntax spans, copy buttons, thread
  bodies, composers, and annotations repeat mounting work. Selection anchored in an overlapping row
  is lost. Variable-height measurement can recreate the same wrappers even without intentional
  navigation, which is why the pane already avoids measuring on composer keystrokes.
- Effort: M, including unified/split row identity and focused composer tests.
- Risk: Medium. Reusing an element must still update its index, position, content, handlers, file
  identity, annotations, and measurement after real content or geometry changes.
- Confidence: High for DOM churn and selection loss. Medium for visible scrolling cost until replay
  in optimized, visible WebKit.
- Fix sketch: Let the DOM list iterate stable virtual identity keys and read the live row/band and
  geometry through accessors, or retain equivalent stable entries for the mounted window. Release
  entries when they leave that window. Do not freeze the destructured row or virtual item, and do
  not retain a DOM entry for every row in the complete model.

After gates:

1. The 200-row shift preserves all 199 common elements. Updating geometry for the same keys mounts
   zero rows and changes their transform and index correctly.
2. Repeat with split bands and with a thread whose height changes above an open composer. Preserve
   the textarea, caret, busy/error state, selection, and adopted horizontal column offsets.
3. A rehydrated file shows its actual changed text even when row identities stay the same; unchanged
   sibling rows survive. Find marks, thread resolution, annotations, collapse, gap expansion,
   deep restoration, and intentional mode changes still work.
4. Keep the 80-row overscan, fixed row estimates, no wrapping, row measurement cache, stable model
   keys, and progressive publication. A whole virtualizer replacement is unnecessary.

### F10-3 Skip obsolete fence work and share identical highlights in flight

- Evidence: `packages/client-core/src/kit/components/content/Markdown.tsx:146` awaits its lazy
  import, then `:151` dispatches every captured fence. `:155` checks `block.live` only after all
  those calls start. `infra/highlight/shiki.ts:59` checks only completed HTML, then awaits the shared
  highlighter at `:63` and always calls `codeToHtml` at `:64`.
- Impact: Eight replacements tokenize eight fences although only one can be displayed. Disposal
  still tokenizes. Eight identical simultaneous cache misses also tokenize eight times. The shipped
  cache prevents repeat work after completion and remains useful; it does not cover this interval.
- Effort: S for pre-dispatch liveness, M for shared in-flight ownership and rejection tests.
- Risk: Low to medium. Dropping one block must not cancel the same text needed by another live
  block. A block retained across updates must still receive its initial highlight.
- Confidence: High for redundant calls and the source mechanism. Medium for the amount of burst
  work in a real workload.
- Fix sketch: Check block liveness after the import and before requesting highlighting. Share the
  whole highlight promise by exact language/text identity, remove it on settlement, and retain the
  completed cache's size policy. If work is queued across a grammar wait or a worker boundary,
  qualify consumers by liveness and skip work with no consumer before execution.

After gates:

1. The eight-replacement burst dispatches only the one live fence. Disposal before import resumes
   dispatches zero. Disposal after dispatch never inserts the result.
2. Eight identical simultaneous live callers perform one `codeToHtml` operation. Rejection clears
   shared work and permits retry. A separate language or text remains distinct.
3. Two duplicate blocks keep two distinct DOM elements and copy controls while sharing source work.
   Disposing one leaves the other's completion intact. Closed fences survive prose streaming and
   do not repeat work. Keep lazy grammar loads and dual-theme colors.
4. Preserve the 200-entry and 16,384-code-unit completed cache bounds. Do not retain resolved or
   rejected promises, growing fence versions, detached wrappers, or source text indefinitely.

### F10-4 Qualify expanded context by the current file version

- Evidence: `packages/client-core/src/features/diff/DiffPane.tsx:264` begins expansion. `:269`
  awaits the source body and tokenization without capturing a generation, then `:273` writes the
  expanded map. Content refresh at `:229` updates only hydration, while expanded state is cleared
  only for file-set changes at `:202`. `kit/diff/diffModel.ts:91` keys gaps by path and coordinates,
  not SHA or content key.
- Impact: A delayed expansion from A fills a matching gap in B, and already-expanded working-tree
  context remains from A after its patch refreshes to B. The latter hides the gap control, so the
  reader cannot request the updated lines. Disposal still spends tokenization work. This is a
  correctness gate for expansion and worker optimizations, not proof of a large typical CPU tail.
- Effort: M, including file refresh and deferred-read lifecycle tests.
- Risk: Medium. Unchanged siblings must keep expanded context and reading place; immutable blob
  sharing must remain valid. A working-tree `sha` is the staging area and cannot identify content.
- Confidence: High. All three actual pane-owner cases reproduce.
- Fix sketch: Capture a pane generation and the file's content version before reading. Check both
  after each await and before writing. Invalidate expanded entries only for files whose content key
  moved, and all entries on file-set reset. Skip tokenization if the body arrives for an obsolete or
  disposed consumer. An optional abort signal can save reads, but cannot replace version checks.

After gates:

1. A late old body after signature change adds zero stale rows and performs zero obsolete
   tokenization. Do the same with disposal and with identical path/coordinates in different content.
2. A changed content key removes or refreshes that file's old expansion; the reader can expand the
   updated gap. Another file's expansion survives. Cover Nodes and staging areas with colliding
   paths if the surface can be swapped without remounting.
3. Legitimate expansion preserves line numbers, source bytes, comments, annotations, and scroll
   anchor. Multiple immutable GitHub gaps share their blob read. Failed expansion remains retryable.
4. Keep `DiffSource` provider-neutral. Cancellation or version metadata belongs in the shared viewer
   and source contract, not in a GitHub-only row component or core filesystem bypass.

## Conditional work and deduplication

### Bound large changing fences before selecting an off-thread HTML path

`shiki.ts:64` calls synchronous `codeToHtml`, and `Markdown.tsx:157` parses the result into DOM and
replaces the fence's `<pre>`. There is no Markdown size/line guard equivalent to the diff's guard.
Four 80,000-character variants require about 1,039 ms of cumulative Shiki work and about 2,142 ms of
total process CPU in this fixture. F10-3 removes obsolete and duplicate work; it cannot remove the
four settled, distinct computations. The final highlighted fence has 13,097 elements, so moving
tokenization alone cannot eliminate its DOM cost.

Confidence is high for CPU and allocation work, medium for native latency and the right threshold.
Effort is M for bounded scheduling/plain degradation and L if adding worker-produced HTML plus
policy and host validation. The risk is medium because code bytes, copy, themes, selection, and
frame compatibility must survive.

First verify the same owner in an optimized visible renderer. Consider a character/line bound and
latest-live scheduling for changing fences, rendering the already escaped plain code when the
budget is exceeded. Document any coloring degradation. If retaining large-fence coloring is needed,
evaluate a narrow worker HTML request under the same language/theme contract. Keep grammar state
across the whole fence and bound HTML application too. Do not move the JavaScript regex fallback's
whole pathological input onto the renderer after a timeout. Do not increase the completed HTML
cache bound to solve growing inputs, whose exact keys all differ.

Bundle and CSP feasibility is partially verified by source and prepared artifacts. The renderer
Vite config emits module workers under `assets/worker-[name]-[hash].js`. The prepared artifact is
`worker-highlighter.worker-CcI2tOi8.js`; `app_scheme.rs:17` matches exactly that naming family and
`:24` gives it `script-src 'self' 'wasm-unsafe-eval'` with `connect-src 'none'`. The word-diff worker
receives the narrower renderer policy. Shiki WASM stays inline and grammars remain local chunks.
This demonstrates a compatible built asset and policy selection, not that this webview instantiated
it successfully. A frame has a distinct origin and policy; do not assume its realm can use the
desktop worker URL or widen frame/loaded-plugin permissions. Keep the JavaScript/plain fallback.

### Keep append-aware parsing as F08-4, with parser-owned checkpoints

Area 08 already measured 5,001,950 reparsed characters for 150 appended characters in a growing
200,000-character message. It also verified stable old paragraph DOM and cheap transcript
projection. This audit confirms that `renderBlocks` still normalizes, splits, scans, escapes, and
hashes the whole message, while code highlighting is an additional owner and cost. Rewriting
transcript projection or adding a general virtualizer does not address either mechanism.

A conservative kit-owned append parser is feasible, but the authoritative parser must expose its
source boundaries or checkpoints. Its public result supplies only `{ key, html }`; reconstructing
boundaries from HTML or hashes would create a second parser. Retain rendered closed blocks and
reparse the last affected block plus required line lookahead. Preserve exact keys and spare queues.
Fallback to full parsing on replacement or image-policy change. A long open paragraph, quote, list,
table, or fence still requires open-block work, so expected savings depend on the closed prefix. This
is M to L effort with medium to high semantic risk, and remains conditional on visible evidence.

Equivalence cases must follow this parser's actual semantics: triple-backtick fence recognition and
closing behavior, hashes over normalized source, headings, the supported horizontal rules,
contiguous lists and quotes, table separator lookahead and ragged/escaped cells, blank lines,
sentinel stripping, and CRLF including chunks split between `\r` and `\n`. Test every character
boundary for a corpus, arbitrary non-append replacements, duplicate blocks, unterminated fences,
and policy switches among inline, thumb, and placeholder images. Preserve URL/image allowlists,
attribute escaping, copy controls, inline token protection, stable selection, and remote/TUI output.
Do not promise general CommonMark behavior that this parser does not implement.

The after replay must invoke `AgentTranscript` and its actual Markdown owner from area 08, alongside
the kit parser equivalence cases. Benchmarking an obsolete `renderBlocks` import after production
switches owners would not verify the change. Append parsing is one shared implementation, not a
second area 10 transcript migration.

## Other reviewed paths and rejected changes

| Path or idea | Decision |
| --- | --- |
| Hydrator cancellation | Fetch/reset/dispose and per-path refresh generations already suppress stale parse publication. Per-hydrator parsing is sequential. A fetch may ignore its signal, notably Changes' injected patch callback, but its publication still has checks. Keep these controls; broader Node/signal ownership remains areas 05, 07, 08, and 11. |
| Hidden viewer work | Hidden task region disposal disposes its hydrator, publisher timers, command registrations, split listener, and measurement frames. Shared worker lifetime intentionally spans panes. In-flight parse work can finish without publication; this audit does not justify per-pane worker termination that would harm another viewer. Markdown/gap dispatch gaps are covered by F10-3/F10-4. |
| Thread projection | `buildRenderableRows` groups by path, then `pushCodeRow` scans that file's threads per code row. Large per-file thread counts have multiplicative work. No representative thread-count timing or occurrence evidence was measured, so there is no ranked indexing change. If it becomes a tail, index path/side/line while preserving null-side RIGHT semantics, context anchors, duplicate threads, and order. |
| Find | Search is cold while closed. Opening/query changes scan raw model text and index ranges by row. Split match navigation finds a band linearly. `markTokens` scans ranges for each token. No measured typing or many-occurrence tail justifies a debounce, separate worker, or semantic cap here. Keep off-screen reach, case behavior, both sides, and syntax/word text fidelity. |
| Unified and split geometry | Stable model keys, fixed rows, cached measurements, and cold split construction are shipped. F10-2 changes DOM identity around them. Reducing overscan or replacing the virtualizer without a visible momentum-scroll test is rejected. |
| Gap size | Expansion tokenizes an entire selected run and does not apply the patch-size guard. Very large gaps need separate measured budget evidence after F10-4. Full-blob reads already share by immutable GitHub SHA; Changes reads a mutable new side. No global blob cache or first-N truncation is proposed. |
| HTML cache enlargement | Rejected. Exact text changes each frame, and bounds already exist. F10-3 shares in-flight work and keeps those bounds. |
| Eager grammars and worker consolidation | Rejected. Lazy vocabularies, separate Oniguruma and JavaScript engines, and separate syntax/word workers preserve bundle and policy boundaries. |
| TUI | Its row window is already bounded, and Markdown uses the host sanitizer. Terminal cell rendering and startup remain area 15. F10-2 concerns the DOM feature canvas, not terminal window objects. Preserve reduced host contracts. |
| Sentry attribution | `highlight.main_thread` has 59 spans with median 244 ms and p95 1,282.2 ms, and `diff.segments.enrich` has 78 with median 210 ms and p95 1,147.2 ms in the supplied lead. Inspected records lack release IDs. The latter name has no source emitter in this checkout. Historical/suspended elapsed tails cannot establish checkout attribution or explain these mechanisms. |

## Replay and execution gates

Run the bounded probes from the repository root:

```bash
rtk proxy env ACORN_PERF_TAG=sample pnpm exec vitest run --config plans/performance/10-probe.config.ts
```

Every output defaults to `sample`, and `ACORN_PERF_TAG` selects a separate filename. Keep all
`before` and `coordinator-before` artifacts. The coordinator replay command uses
`ACORN_PERF_TAG=coordinator-before` and passed four files and ten cases in 10.03 seconds. The initial
four worker cases, canvas case, Markdown case, and three gap cases also passed separately. The
pending-reset case has an additional `before-lifecycle` record. One isolated early reset probe
timed out because its fake clock advanced before a cold constructor import completed; the harness
now waits for both worker constructions before advancing the deadline.

These audit probes assert the observed failures so baseline reproduction passes. Before after-fix
replay, change assertions to the intended result and adapt them to the final production owner:

| Probe | Required assertion adaptation |
| --- | --- |
| `10-worker-probe.test.tsx` | One constructor per kind, zero orphans, no revival after failed/import-reset generation, instance-safe old errors, promptly settled reset requests, zero retained timers, and no posts to a retired deadline worker. Replace fixtures that depend on four orphan workers with an explicit old-generation replacement case. Test both siblings. |
| `10-canvas-probe.test.tsx` | Preserve 199 common DOM rows and the selection, with live geometry and content updates. Add split and focused composer cases against the production canvas. If its inputs change, adapt the probe rather than benchmarking the old wrappers. |
| `10-markdown-probe.test.tsx` | One shared identical highlight; one live burst dispatch; zero pre-dispatch disposed highlights. Keep the settled distinct-frame measurements as CPU evidence. A new worker/scheduler must be invoked through actual Markdown rather than calling old `highlightToHtml` alone. |
| `10-gap-probe.test.tsx` | Zero stale rows after signature/content changes, a usable refreshed gap, unchanged sibling expansion, and zero tokenizations after disposal. Its canvas is an observation seam only; it invokes actual `DiffPane` expansion and hydration. Add deferred-tokenization completion and source version cases. |

Move lasting behavior tests beside their owners. Run the highlighter, diff model, hydration,
publisher, viewer, Markdown, kit, and relevant host suites, then `rtk proxy pnpm lint` and
`rtk proxy pnpm test`. The source-read-only investigation relies on the coordinator's already-green
baseline gates and adds only audit probes/documents; it does not rerun the full application suite.

Renderer acceptance requires a separate isolated visible Tauri session and the documented
snapshot/click/fill/screenshot/stop workflow. Verify cold simultaneous viewers, long diffs,
momentum scrolling, split horizontal scrolling, deep return restoration, typing and selecting in
comments, thread mutations, annotations, find, expansions during refresh/navigation, and code fence
streaming/remount/disposal. Check the built worker request succeeds under `app://` and its intended
CSP, along with unavailable and grammar-error degradation. The baseline window is hidden/unfocused
and cannot supply that acceptance evidence.

Remaining validation gaps are optimized WebKit timings, actual worker heap/RSS, retained JavaScript
heap after many navigation cycles, full-day use, representative large thread/search workloads,
pathological grammar/word inputs, loaded-frame worker feasibility, and append-parser equivalence.
The owning source paths and concrete candidates are covered. No source change, branch, commit,
normal-profile inspection, or paid session was needed.
