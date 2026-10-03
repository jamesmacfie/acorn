# Diff rendering

The shared diff viewer lives in client-core. The GitHub pull request pane, the GitHub compare
preview, and the Changes pane all use it. Read this page to find how a diff is described, loaded,
colored, laid out, and annotated. All three callers hand the viewer the same thing: a document, laid
out by a topology with no source text in it, and filled in segment by segment as you scroll near.

The viewer comes in three layers, and `tools/arch/boundaries.test.ts` enforces the split:

- `packages/diff-document/` (`@acorn/diff-document`) is the document: the patch parser, the
  segmenter, the descriptors, search, and a parse cache. It has no DOM, Node, Solid, database, or
  transport dependency, because the Node builds documents and the renderer reads them
  ([package boundaries](./architecture/packages.md) § Shared libraries).
- `packages/client-core/src/kit/diff/` is the toolkit: the row model, the row components, the layout
  index and its measure scheduler, and the find marks. It takes props and draws DOM, with no
  application state, so a plugin can use a piece of it for a simpler view. `StackedDiff` is the
  simplest: one file's patch, read-only, in normal flow, for a patch shown inside something else,
  such as an agent's step.
- `packages/client-core/src/features/diff/` is the viewer: `DiffPane` and the parts only it uses. This
  layer reads preferences, registers a command and a keybinding, and keeps session scroll state, none
  of which `kit/` can do.

`DiffPane` is the whole viewer as one component, and a caller drives it through a `DiffSource`
(`packages/client-core/src/features/diff/source.ts`). `DiffPane` is on `@acorn/plugin-api/ui`, and
the port type and the document types are on `@acorn/plugin-api/ui/diff`.

## Pages

<a id="the-document"></a>
<a id="the-source-port"></a>
<a id="data-flow"></a>

[The diff document](./diff-rendering/document.md) covers the topology and its segments, find, the
`DiffSource` port, and how each caller's document is built on the Node.

<a id="parsing-and-highlighting"></a>
<a id="resident-segments"></a>

[Loading and highlighting](./diff-rendering/loading.md) covers the segment loader, syntax and word
highlighting in workers, the resident segment cache, and code fences in Markdown.

<a id="row-geometry"></a>
<a id="modes"></a>

[Row geometry and modes](./diff-rendering/geometry.md) covers fixed and dynamic heights, measurement,
keeping your place, horizontal scrolling, unified and split modes, gaps, and find.

<a id="review-threads-and-state"></a>
<a id="marks-from-other-plugins"></a>
<a id="retained-row-and-fence-work"></a>

[Review threads and marks](./diff-rendering/review.md) covers inline threads, the file filter,
remembered view state, line drafts, and marks other plugins draw under a code row.

<a id="what-the-changes-panel-refuses"></a>

[The Changes pane](./diff-rendering/changes-pane.md) covers `LocalStatus`, the file list, staging,
discard, the branch bar, and what the panel refuses.

## What large-surface rendering refuses

The document, the segment loader, the dynamic-block layout, and the resident cache keep a
2,200-file, million-row pull request bounded. They were built on September 26, 2026, after GitHub's
account of
[rendering huge pull requests](https://github.blog/engineering/user-experience/rendering-huge-pull-requests-in-the-github-copilot-app/).
Each alternative below will be suggested again. Reopen one only with evidence against its reason:

- **Treating a provider's first page as the whole.** A fast view of a truncated pull request is wrong
  ([GitHub integration](./github-integration.md) § Pull request detail and files).
- **Keying a patch by the head blob SHA.** Two bases can produce different patches that end at the
  same blob.
- **Fixing only the DOM.** The DOM was already virtualized. The cost was parsing, coloring, keying,
  and scanning every file.
- **Draining the document in idle time.** It delays the cost without bounding it, so work outside the
  demand range is dropped.
- **Waiting for color before showing text.** Plain rows are correct and readable.
- **One variable-height table for every row.** A comment changing height mustn't rebuild exact code
  geometry.
- **Fixed-height comment slots.** Comment content has no fixed height, so a slot either clips or
  leaves space.
- **A `ResizeObserver` that writes heights.** Reading and writing around one element feeds back.
- **Inferring your input from `scroll` events.** Corrections, navigation, and browser clamps all emit
  `scroll`.
- **A pixel as the reading place.** Loading, resizing, and collapsing all move pixels.
- **An imperative recycled-DOM renderer.** The Solid rows own accessibility, comments, annotations,
  and plugin seams. Reopen only if a real-window profile of the `canonical` fixture puts the cost in
  mounted components.
- **Provider types in client-core.** The document describes files, rows, anchors, and threads only.
- **An old-and-new `DiffSource` adapter.** Two shapes side by side double memory and behavior
  ([the plugin API](./plugins/plugin-api.md)).
- **Caching whole documents by count.** Documents range from 50 rows to a million, so the cache
  weighs segments.
- **Persisting parsed rows, tokens, heights, or DOM.** They're large and cheap to rebuild. The Node's
  patch and descriptor blobs are the durable layer ([caching](./caching.md) § Immutable blob cache).
- **Document content in diagnostics.** Diffs hold proprietary source
  ([rendered-surface health](./telemetry/surface-health.md)).
- **Timing budgets from one machine, or stress tests only in jsdom.** The tests assert scaling and
  lifecycle, and absolute budgets wait for a real-window run
  ([the large-surface fixture](./testing/desktop.md#the-large-surface-fixture)).
- **A streaming transport for the topology.** The `canonical` topology is about 2.5 MB over the JSON
  route. Add a stream only if a real-window run shows people waiting on it.
