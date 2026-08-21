# Diff rendering

The shared diff viewer is in client-core and is used by the GitHub PR pane and Changes pane. It
renders provider patches and local Git diffs through the same row model.

## Data flow

The GitHub plugin returns file metadata plus an optional patch. Large or missing patch bodies are
loaded lazily from the blob route. The Changes plugin obtains a local diff through the core Git
service. Both paths normalize into file/hunk/line rows before rendering.

The row types (`DiffFile`, `DiffThread`, and their siblings, in `ui/diff/model.ts`) are structural
rather than named after either plugin's wire types. GitHub's `PullFile`/`Thread` and Changes' local
rows both satisfy them without either plugin importing the other, so the renderer describes what it
needs to render rather than one caller's type. `ui/diff/synth.ts` follows the same reasoning: a
GitHub per-file patch is hunks-only, so it synthesizes a header for gitdiff-parser, shared here
because both GitHub's PR file payloads and local `git diff` output reach this parser.

## Parsing and highlighting

Patch parsing produces file headers, hunks, additions, deletions, context, and expandable gaps.
Syntax highlighting is performed with Shiki on demand. Visible files and lines are prioritized; the
viewer does not parse or highlight every file before first paint. Virtualizers keep long diffs within
the renderer budget.

Highlighting runs in a dedicated worker (`client-core/src/highlight/`), off the thread that draws.
Tokenizing a 45-file diff on the main thread cost about 2 seconds of work in unbroken per-file blocks
of up to 325ms; that work now happens in `highlighter.worker.ts`.

The worker exists for a second reason beyond thread placement. Shiki's fast path compiles Oniguruma to
WebAssembly, and `WebAssembly.instantiate` is gated by `script-src`. The renderer's content security
policy is `'self'` with no `wasm-unsafe-eval` (`main/appScheme.ts`), so the WASM engine throws at
startup there and Shiki falls back to its JavaScript regex engine, measured at 4.6x slower on the same
input. A dedicated worker loaded from a same-origin URL takes its CSP from that script's own response
headers rather than inheriting the document's, so `appScheme.ts` serves `highlighter.worker.ts`, and
only that file, with `wasm-unsafe-eval` added. This widens nothing else: the worker's own policy is
otherwise stricter than the document's in every direction (`default-src 'none'`, `connect-src 'none'`),
since it has no DOM, no bridge to main, and no network, and it only ever needs to take strings and
return colours. `shiki/wasm` has to stay the inlined build (622 KB of base64 inside the module) rather
than a build that fetches its `.wasm` at runtime, or the worker would need a network permission it is
better off without.

Every call into the worker sends a whole document, never a line. The obvious per-line port is a
`postMessage` per line, and for a 45-file diff that is roughly 2,600 round trips, slower than the
main-thread code it replaces. Batching by document is also what lets Shiki thread grammar state from
line to line, so a block comment, a template literal, or a docstring spanning several lines colours
correctly; the previous per-line calls started every line from a cold grammar state and got all three
wrong. A request that never returns is treated as stuck rather than slow after 10 seconds: the slowest
real document measured was about 110ms, and the first request of a session also pays for spawning the
worker and instantiating the WASM engine (about 340ms end to end), so 10 seconds is a generous
backstop rather than a budget.

The worker tracks one of three states: `cold` (nothing tried yet), `live` (spawned and answering), or
`dead` (unavailable, or it failed its first request). Once `dead`, every later call skips straight to
the main-thread fallback rather than retrying, because the two ways this fails, no `Worker` in the
environment or the CSP not applying to the worker script, are both permanent for the life of the
window. The fallback logs loudly: the failure it replaces was silent for months, because the WASM
engine's rejection landed inside the highlighter's own promise and every surface simply rendered grey
with no error anywhere a developer would see it.

Grammars load lazily rather than up front. They total about 1.7 MB across the set, and a given diff
touches only two or three of them, so a TypeScript-only pull request does not pay for the C++ grammar
(419 KB, the largest single one). `protocol.ts` defines the wire format the worker and the main thread
share; it imports nothing from either side. The worker must not pull in `ui/diff/model.ts` (which
would drag `diff` and `gitdiff-parser` into the worker bundle), and the client must not pull in the
worker's Shiki imports (which would put the WASM engine back on the main thread).

## Row geometry

Code lines do not soft-wrap. A long line scrolls sideways instead, and the line numbers and the +/-
marker stay pinned to the left edge while it does.

That is a rendering decision the virtualizer depends on, not a preference. Every code row is exactly
one line tall, so `estimateRowSize` is always right and no code row is ever measured — only threads
are, because only they vary. When lines did wrap, a row's height was a layout question: each one
painted at its 20px estimate and was corrected a frame later, and a first-ever correction above the
scroll offset makes the virtualizer write `scrollTop` to compensate. Scrolling flashed and stuttered.

Because nothing wraps, something has to be wide enough to hold the widest line, and unified and split
answer that differently.

In unified the canvas itself is that wide, and the whole pane scrolls sideways. The width comes from
the row model (`maxLineCols`, handed to CSS as `--diff-cols` in columns, since the font is monospace
and one column is 1ch) rather than from `max-content`: rows are absolutely positioned, so only the
ones inside the virtual window have boxes, and a layout-derived width would change as you scrolled
vertically and drag the horizontal scroll position with it.

In split the pair always fits the pane — half the pane stays half the pane however long a line gets —
and each column scrolls horizontally inside itself. The scroller is each row's own code box, so there
is one per row and `splitScrollSync.ts` keeps a column's rows in step. Their scrollbars are hidden
(forty stacked would be noise, not navigation), so a column scrolls by trackpad or shift+wheel.

## Modes

- Unified mode renders old/new lines in one stream and is the default.
- Split mode renders old and new columns with its own row virtualization.
- Word-level spans are attached only to paired delete/insert runs, preserving unchanged text.
- Gap rows request additional context by file SHA/path and keep the current anchor stable.

## Review threads and state

Inline thread anchors use file path, side, and line coordinates. Thread state is fetched with the
PR detail and updates through GitHub mutations. Viewed-file state is local app data and is merged into
the file projection; it is not sent to GitHub.

The `?file=` route/query anchor is resolved after the file model is available, then scrolls to the
file and line without forcing all other files to hydrate.
