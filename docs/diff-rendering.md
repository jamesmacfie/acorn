# Diff rendering

The shared diff viewer is in client-core and is used by the GitHub PR pane and Changes pane. It
renders provider patches and local Git diffs through the same row model.

## Data flow

The GitHub plugin returns file metadata plus an optional patch. Large or missing patch bodies are
loaded lazily from the blob route. The Changes plugin obtains a local diff through the core Git
service. Both paths normalize into file/hunk/line rows before rendering.

## Parsing and highlighting

Patch parsing produces file headers, hunks, additions, deletions, context, and expandable gaps.
Syntax highlighting is performed with Shiki on demand. Visible files and lines are prioritized; the
viewer does not parse or highlight every file before first paint. Virtualizers keep long diffs within
the renderer budget.

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
