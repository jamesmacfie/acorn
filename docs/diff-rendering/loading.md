# Diff loading and highlighting

This page covers how the viewer loads segments near the viewport, colors them in workers, and keeps
them in memory for the next visit. It's part of [diff rendering](../diff-rendering.md).

## Parsing and highlighting

The Node parses. The renderer builds rows only for segments it has, and colors them afterward.

The viewer's list holds items, not rows (`packages/client-core/src/features/diff/documentView.ts`):
one per file header, one per segment, one per file with no diff, and one per 64-row slice of an
expanded gap, all built from the topology.

### The segment loader

`packages/client-core/src/features/diff/segmentLoader.ts` learns, every time the visible range moves,
which segments are on screen and which are near: the range plus two segments beyond each end. It
asks the source for missing segments in batches of eight, on-screen ones first, with at most two
requests in flight. It drops anything queued that has left the range, and aborts a request whose
every segment has left. There's no background loading. A new revision stops every request in flight.
A stale answer can't publish into the new document, because segments publish by content key and the
new topology doesn't ask for the old key.

A loaded segment publishes its plain rows at once, with each code line as one token of raw text. Then
the segment is queued for color, in the same order, one segment at a time: syntax tokens for each hunk
side from the highlight worker, and word spans for paired changes from the word-diff worker
(`enrichDiffRows`). The colored rows replace the plain ones under the same index, so no row remounts
and nothing moves. The swap happens only if the segment still holds the rows coloring started from. An
oversize segment stays plain. A dead or slow worker leaves plain text, which is correct and readable.

The loader keeps no rows itself. They go into the resident cache below, which is how a pane opened
again draws without asking the source.

## Syntax highlighting

Highlighting runs in `highlighter.worker.ts` (`packages/client-core/src/infra/highlight/`), off the
thread that draws. Tokenizing a 45-file diff on the main thread cost about two seconds, in blocks of
up to 325 ms per file.

The worker also solves a content security policy problem. Shiki's fast path compiles Oniguruma to
WebAssembly, and `script-src` gates `WebAssembly.instantiate`. The renderer's policy is `'self'`
without `wasm-unsafe-eval` (`apps/desktop/src-tauri/src/app_scheme.rs`), so Shiki would fall back to
its JavaScript regex engine, measured at 4.6 times slower. A worker loaded from a same-origin URL takes
its policy from its own response headers, so `app_scheme.rs` serves `highlighter.worker.ts`, and only
that file, with `wasm-unsafe-eval` added. In every other direction the worker's policy is stricter
than the document's (`default-src 'none'`, `connect-src 'none'`), because it has no DOM, no bridge,
and no network, and only turns strings into colors. Keep `shiki/wasm` on the inlined build, 622 KB of
base64 inside the module. A build that fetches its `.wasm` file would need a network permission.

Every call into the worker sends a whole document, never a line. A message per line is about 2,600
round trips for a 45-file diff, slower than the main thread. A whole document also lets Shiki carry
grammar state from line to line, so a block comment, a template literal, or a docstring across lines
colors correctly. A request that hasn't returned after 10 seconds counts as stuck. The slowest real
document measured took about 110 ms, and the first request of a session also pays about 340 ms to
start the worker and the WebAssembly engine.

Each window owns one lazy syntax worker, and concurrent callers share its start-up. The deadline
covers start-up and the work. An import, construction, script, or send failure retires that worker
generation and settles its requests through the JavaScript fallback. A grammar failure for one
document uses the fallback without retiring a healthy worker. Messages from a retired generation
can't affect its replacement.

When the 10-second deadline passes, the owner retires the blocked worker and returns plain tokens for
every waiting document. Later requests in that window stay plain, and the blocked regex work never
replays on the renderer. Closing one pane leaves a healthy worker for the others.

Grammars load lazily. They total about 1.7 MB, and a diff touches two or three, so a TypeScript-only
pull request doesn't pay for the C++ grammar, the largest at 419 KB. `messages.ts` defines the wire
format both sides share and imports nothing from either. The worker mustn't import
`packages/client-core/src/kit/diff/diffModel.ts`, which would pull `diff` and `gitdiff-parser` into
it. The client mustn't import the worker's Shiki modules, which would put the WebAssembly engine on
the main thread.

### Word-level diffs

Paired delete and insert lines use a second worker, `wordDiff.worker.ts`. Patch parsing and row
building stay on the main thread. One segment's pairs go as one batch, so the comparison can't block
scrolling. Its request owner follows the same lifecycle rules without sharing Shiki's engine or its
wider policy. If the worker is unavailable, the main thread computes the words. After a deadline or a
reset, word marks are left out and the complete lines stay.

### Code fences in Markdown

Markdown skips fences that were removed after its lazy import and before dispatch. The same language
and source share one in-flight highlight through grammar loading and rendering, and a removed block
can't cancel a surviving identical one. If every block waiting on a highlight leaves while the grammar
loads, it renders nothing. The completed cache in
`packages/client-core/src/infra/highlight/shiki.ts` holds 200 entries and skips fences over 16 KB.
Large changing fences still render in full.

## Resident segments

A segment's rows outlive the pane that loaded them.
`packages/client-core/src/features/diff/segmentCache.ts` keeps each Node's recently read segments in
memory, so a diff you return to draws its last rows at once, already colored, and asks the source only
for what the cache dropped.

**One cache per Node.** The pane's query client finds the cache (`segmentCacheFor`), and there's one
query client per Node ([caching](../caching.md) § Renderer query cache). A Node switch mounts the
other Node's client and cache. `dropNode` clears a removed Node's cache at once. Unmounting a pane
leaves the cache alone. The terminal client has its own diff loader and no resident cache.

**Keys.** An entry is one segment of one file, keyed by `residentKey`: the segment's content key, the
path, and the `sha`. Rows are a pure function of these. The path picks the grammar and the `sha` is
how a gap reads the file, so two files with the same patch never share rows. The key holds no source,
route, pane, revision, or mode, so the same patch on a task's pull request and the repository's view
is one entry. Review threads aren't in the key, so resolving a thread leaves code rows alone. Theme
isn't either, because every token carries both themes' colors.

**Plain rows and color.** An entry holds its plain rows and, once coloring lands, its colored rows,
weighed apart by `plainWeight` and `enrichmentWeight`. If a segment's color was evicted, you see plain
rows at once and the loader colors it again. If the worker timed out, the entry marks its fallback
color `provisional`. The pane that got it doesn't retry, and the next pane colors it again, because a
timeout can come from a busy worker.

**Budget.** Two limits cover every entry: 40,000 rows (`SEGMENT_CACHE_ROWS`) and 32 MiB of estimated
bytes (`SEGMENT_CACHE_BYTES`). The byte estimate is a fixed allowance per row, array, and token, plus
two bytes a character for text the entry owns, not a heap measurement. The row limit stops an
underestimate from growing the cache without bound. Both numbers were chosen by hand. When a write
leaves either limit exceeded, the cache walks from the least recently wanted segment. For each segment
no pane holds, it drops the color first, then the plain rows, and stops once both limits hold.

**Holds.** Each pane's loader holds the segments on screen, the two either side, and whatever it's
loading or coloring, and replaces that claim on every range change. A held segment is never evicted.
A batch is held until its request ends. Unmounting releases everything the pane held. When two panes
load the same segment at once, the first entry stays.

**Oversize.** If held segments alone exceed a limit, the cache keeps them, counts an oversize insert,
and evicts them once nothing holds them. With 64-row, 32 KiB segments, that takes a row of about 16
million characters.

**Revisions.** An entry never changes content, because a changed file has a new patch digest and key.
When the file set stays the same and a file's patch moves, as a working tree's does on every save,
the pane drops the old segments of that file at once (`supersede`), unless a second pane holds them.
When the file set changes, as with a new pull request commit, old entries stay until the budget takes
them, because another view may still show that revision.

Heights, DOM nodes, Solid state, composers, drafts, observers, and requests stay with the pane.
Nothing in the cache goes to disk or to the query cache's persisted snapshot. The health reading's
`resident` group reports the cache's weight, inserts, evictions, and oversize inserts, and the pane's
hits and misses ([renderer telemetry](../telemetry/renderer.md)).
