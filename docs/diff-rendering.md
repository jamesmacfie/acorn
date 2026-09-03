# Diff rendering

The shared diff viewer is in client-core and is used by the GitHub PR pane and Changes pane. It
renders provider patches and local Git diffs through the same row model.

It arrives in two layers, and the split is enforced (`tools/arch/boundaries.test.ts`, "client-core
kit/ is pure presentation"):

- `kit/diff/` is the toolkit: the row model, the row components, the virtualizer, the find pass, the
  hydrator. Props in, DOM out, no application state, so a plugin can reach for a piece of it to build
  a simpler surface. The compare preview does exactly that.
- `features/diff/` is the viewer: `DiffPane` and the parts only it uses. This layer reads
  preferences, registers a command and a keybinding, and keeps session scroll state, none of which
  `kit/` may do.

`DiffPane` is the whole viewer as one component, and a caller drives it through a `DiffSource`
(`features/diff/source.ts`). Both are on the plugin API, `DiffPane` on `@acorn/plugin-api/ui` and the port
type on `@acorn/plugin-api/ui/diff`.

## The source port

`DiffSource` is how the viewer knows nothing about pull requests or working trees. The caller resolves
its own queries and hands over accessors and callbacks: which files, where the patch bodies come from,
which threads to interleave, what a comment does. Two rules keep the seam honest. The members are
plain functions rather than a provider object the viewer could reach through, and an omitted optional
member hides its affordance rather than needing a stub, so a source with no `fileText` renders gaps
that cannot be expanded and a source with no `reply` gets thread rows whose reply box is disabled.

`signature` and `contentSignature` are separate on purpose. The first says which files are on screen,
and changing it drops the remembered scroll offset and the collapsed files. The second says what those
files currently claim, and changing it re-reads the patches while leaving the reader where they were. A
working tree needs the two apart, because an agent saving a file mid-review moves the content every
poll and treating that as a new diff would throw the reader back to the top each time. A pull request
does not: a new commit is both, so the GitHub pane sets only `signature`.

Two members exist for what a caller draws that the viewer has no concept of: `lineExtra` puts content
under a code row, inside the virtualized row so its height is measured, and `lineAction` adds a click
affordance on a code line. The changes pane uses the first for review notes and the second for
Alt-click to send a line reference to the agent.

`plugins/github/src/client/DiffForPull.tsx` and `plugins/changes/src/client/ChangesPane.tsx` are the
two implementations, and both are short enough to read in one sitting. That is the measure of whether
the port is the right size.

## Data flow

The GitHub plugin returns file metadata plus an optional patch. Large or missing patch bodies are
loaded lazily from the blob route. The Changes plugin obtains a local diff through the core Git
service. Both paths normalize into file/hunk/line rows before rendering.

The changes pane's list is a navigator, not a selector: every file's hunks are stacked in one
scroller and clicking a row scrolls to it, the way the pull-request pane's list works. The per-file
git actions stay on the rows.

It stacks one staging area at a time, and `stackFor` in `plugins/changes/src/client/model.ts` says
why: a file staged and then edited again appears in both groups, and the row model keys a file by its
path alone, so a combined stack would hold two files claiming the same identity. Which area is on
screen is the group the highlighted row sits in, and the default is the first unstaged change, because
one staged file should not hide twenty unstaged ones from a reader who has not clicked anything.

Filling a gap needs the new side of the diff, and for a working tree that is not a ref: `git show`
reads objects, and the new side of an unstaged diff has never been written to one. `localNewSideText`
serves both cases, the index for a staged diff and the file on disk for an unstaged one, and refuses a
symlink because a repo can hold one pointing anywhere and the path arrives over HTTP. The pane carries
the staging area in `DiffFile.sha`, which the viewer never reads and hands straight back through
`fileText`. A deleted file gets a null `sha`, which is how its gaps render inert: there is no new side
of a file that is gone.

The row types (`DiffFile`, `DiffThread`, and their siblings, in `kit/diff/diffModel.ts`) are structural
rather than named after either plugin's wire types. GitHub's `PullFile` and `Thread` and Changes'
local rows all satisfy them without either plugin importing the other, so the renderer describes what
it needs rather than one caller's type. `kit/diff/synth.ts` follows the same reasoning. A GitHub
per-file patch is hunks-only, so it synthesizes a header for gitdiff-parser, and it lives here
because both GitHub's PR file payloads and local `git diff` output reach that parser.

## Parsing and highlighting

Patch parsing produces file headers, hunks, additions, deletions, context, and expandable gaps.
Syntax highlighting is performed with Shiki on demand. Visible files and lines are prioritized; the
viewer does not parse or highlight every file before first paint. Virtualizers keep long diffs within
the renderer budget.

Highlighting runs in `highlighter.worker.ts` (`client-core/src/infra/highlight/`), off the thread that
draws. Tokenizing a 45-file diff on the main thread cost about 2 seconds, in unbroken per-file blocks
of up to 325ms.

The worker also solves a content security policy problem. Shiki's fast path compiles Oniguruma to
WebAssembly, and `WebAssembly.instantiate` is gated by `script-src`. The renderer's policy is
`'self'` with no `wasm-unsafe-eval` (`apps/desktop/src-tauri/src/app_scheme.rs`), so the WASM engine
throws at startup there and Shiki falls back to its JavaScript regex engine, measured at 4.6x slower
on the same input. A worker loaded from a same-origin URL takes its policy from that script's own
response headers rather than from the document, so `app_scheme.rs` serves `highlighter.worker.ts`,
and only that file, with `wasm-unsafe-eval` added. Nothing else widens: the worker's own policy is
stricter than the document's in every other direction (`default-src 'none'`, `connect-src 'none'`),
because it has no DOM, no bridge to the shell, and no network, and it only takes strings and returns
colours. Keep `shiki/wasm` on the inlined build (622 KB of base64 inside the module); a build that
fetches its `.wasm` at runtime would need a network permission the worker is better off without.

Every call into the worker sends a whole document, never a line. A `postMessage` per line is roughly
2,600 round trips for a 45-file diff, slower than the main-thread code it replaces. Batching by
document also lets Shiki thread grammar state from line to line, so a block comment, a template
literal, or a docstring spanning several lines colours correctly. Per-line calls started every line
from a cold grammar state and got all three wrong. A request that has not returned after 10 seconds
counts as stuck rather than slow. The slowest real document measured was about 110ms, and the first
request of a session also pays for spawning the worker and instantiating the WASM engine, about 340ms
end to end, so 10 seconds is a backstop rather than a budget.

The worker tracks one of three states: `cold` (nothing tried), `live` (spawned and answering), or
`dead` (unavailable, or it failed its first request). Once `dead`, every later call goes straight to
the main-thread fallback instead of retrying, because both failure modes, no `Worker` in the
environment and the policy not applying to the worker script, last for the life of the window. The
fallback logs loudly. The failure it replaces was silent, because the WASM engine's rejection landed
inside the highlighter's own promise and every surface rendered grey with no error a developer would
see.

Grammars load lazily. They total about 1.7 MB across the set, and a given diff touches two or three,
so a TypeScript-only pull request does not pay for the C++ grammar (419 KB, the largest single one).
`protocol.ts` defines the wire format the worker and the main thread share, and imports nothing from
either side. The worker must not pull in `kit/diff/diffModel.ts`, which would drag `diff` and
`gitdiff-parser` into the worker bundle, and the client must not pull in the worker's Shiki imports,
which would put the WASM engine back on the main thread.

**Hydration state is per file, and read per row.** The hydrator keeps each file's status —
`idle`, `queued`, `loading`, `loaded`, `error` — in a Solid store keyed by path, and a load row reads
its own key. It used to keep them in a `Map` behind one version counter, which made every publish look
like a change to every file: `DiffPane` reads a status per file, so each of the two or three publishes
per file rebuilt the row model for the whole diff. On a 200-file pull request that was 226 rebuilds of
every file's rows during load, against 102 now — one per file that actually arrives, which is the floor
for a row model built over all files ([performance.md](./performance.md) § 2026-09-03 — phase 8).

The hydrator keeps a plain `Map` beside the store for its own queue, and that is deliberate: its pump
reads statuses synchronously from whatever reactive scope called `reset()`, and reading the store there
would subscribe that scope to every path in the diff.

Parsed files are keyed the same way, one store key per path, because the map used to be copied whole on
every parse — one full copy per file in the diff. The one full copy left is the expanded-gap map, which
is written once per gap a reader clicks open and is handed to `buildRenderableRows`, a published
function that takes a `Map`.

## Row geometry

Code lines do not soft-wrap. A long line scrolls sideways instead, and the line numbers and the +/-
marker stay pinned to the left edge while it does.

The virtualizer depends on that. Every code row is exactly one line tall, so `estimateRowSize` is
always right and no code row is measured. Only threads are, because only they vary. When lines
wrapped, a row's height was a layout question: each one painted at its 20px estimate and was
corrected a frame later, and a first correction above the scroll offset makes the virtualizer write
`scrollTop` to compensate. Scrolling flashed and stuttered.

Because nothing wraps, something has to be wide enough to hold the widest line, and unified and split
answer that differently.

In unified the canvas itself is that wide, and the whole pane scrolls sideways. The width comes from
the row model (`maxLineCols`, handed to CSS as `--diff-cols` in columns, since the font is monospace
and one column is 1ch) rather than from `max-content`: rows are absolutely positioned, so only the
ones inside the virtual window have boxes, and a layout-derived width would change as you scrolled
vertically and drag the horizontal scroll position with it.

File headers stay visible while the wide canvas scrolls sideways, the same way the gutters do:
each head is `position: sticky; left: 0` inside its canvas-wide row, sized to the visible
scrollport with `100cqw` (`.diff` is an inline-size container). That is also why the sticky
current-file header renders inside the row canvas rather than as a direct child of the scroller —
a sticky element can only travel within its containing block, and the scroller's content box is
only one scrollport wide. Hunk headers and expand bands scroll away with the code, as they do on
GitHub.

In split the pair always fits the pane, so half the pane stays half the pane however long a line
gets, and each column scrolls horizontally inside itself. The scroller is each row's own code box, so
there is one per row and `splitScrollSync.ts` keeps a column's rows in step. Their scrollbars are
hidden, since forty stacked would be noise rather than navigation, so a column scrolls by trackpad or
shift+wheel.

## Modes

- Unified mode renders old/new lines in one stream and is the default.
- Split mode renders old and new columns with its own row virtualization.
- Word-level spans are attached only to paired delete/insert runs, preserving unchanged text.
- Gap rows request additional context by file SHA/path and keep the current anchor stable.

## Review threads and state

Inline thread anchors use file path, side, and line coordinates. Thread state is fetched with the
PR detail and updates through GitHub mutations. Viewed-file state is local app data and is merged into
the file projection; it is not sent to GitHub.

The source's selected path is resolved after the file model is available, then scrolls to that file
without forcing all other files to hydrate. The GitHub pane reads it from `?file=`.

Scroll position and collapsed files are remembered per scope for the session (`diff/viewState.ts`): a
task and the classic browser keep separate entries for the same content, and a task's entries are
evicted when it is archived. Both are tied to the files signature, so new commits drop the stale
position and collapse choices instead of restoring them against a different diff. An explicit file
navigation wins over a saved scroll position.

### Marks from other plugins

A diff pane may name an `annotation` extension point, and the host draws every contributor's marks under
the code row they name ([plugins.md](./plugins.md) § Cooperative extension points). The two owners are
`changes:diff-line` and `github:diff-line`, both keyed `{ file, line, side }`, and `side` is the row's
own kind rather than the view mode: a mark on "line 42 as it will be" means the new side whether the
reader is in split or unified.

The marks compose with the source's own `lineExtra` rather than replacing it, in that order, because
the source's annotation is the one the person using the pane wrote. They ride the same measurement path
review threads do — drawn inside the virtualized row, counted by `hasLineExtra`, and invalidated
through `lineExtraSignature` — so a mark arriving for a row already on screen grows it instead of
overlapping the rows below.

Every code row in the diff is asked about at once, in one request per contributor: a coverage plugin on
a two-thousand-line diff answers once. The host compares the key set before asking, so the effect
re-running on every scroll and every thread toggle costs a string compare.

Two owners open a line point: `changes:diff-line` over the working tree, and `github:diff-line` over a
pull request. Both declare the same three fields in the same order, both hand the point's name to
`DiffPane`, and a contributor that answers one can answer the other without knowing which pane it is
drawing in.

The pull-request navigator keeps no scroll entry of its own any more. It used to, in a
`reviewViewState.ts` beside the pane; the navigator is a region of a host layout now, and the diff
column's own position and collapsed files are still the viewer's, in `diff/viewState.ts`, keyed by the
same scope.
