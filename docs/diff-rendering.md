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
