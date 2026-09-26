# Refused: approaches this programme does not take

Status: decisions recorded 2026-09-26.

Part of [docs/future/git-inspired/](./README.md). These options are plausible enough to recur. Reopen
one with new evidence against the reason here, rather than quietly adding it beside the planned
architecture.

## Treating provider prefixes as a rendering limit

Refused. Rendering the first 100 files or 50 threads quickly would hide data while presenting the
result as a pull request. GitHub's documented 3,000-file ceiling is unavoidable through that
endpoint, but the UI must call it incomplete. Acorn's own fixed `first` values are implementation
bugs, not product limits.

## Publishing pages into the live mirror as they arrive

Refused for a new revision. A failure on page 12 would combine a new prefix with an old tail or erase
the old complete resource. Pages are staged, validated, and swapped atomically. Compact topology may
be transported progressively later, but one revision/readiness boundary still decides when it is a
document.

## Keying a patch by the head file SHA

Refused. A patch describes a base-to-head change, while the SHA identifies only the head blob. Two
different bases can produce different patches ending at the same blob. Patch and parsed-segment keys
come from the patch content or an equivalent full diff revision. New-side file-body keys remain blob
SHA keys.

## Fixing only DOM virtualization

Refused because Acorn already virtualizes the DOM. The expensive remaining path queues every file,
parses and enriches each one, builds one combined row array, allocates all identity keys, and scans
the whole document. Changing overscan or row components leaves that work intact.

## Letting idle hydration drain the document

Refused. Moving total-document work to idle time delays the cost and competes with later interaction;
it does not bound it. The segment loader has a visible and near-visible demand set. Work outside that
set is removed from the queue until navigation makes it relevant.

## Waiting for syntax and word diff before showing text

Refused. Plain code is correct and useful. Highlighting and word spans are enrichment, run off the
main thread and published later under the same row identity. A dead or slow worker cannot leave a
visible segment blank.

## One global variable-height row table

Refused for the diff. Exact fixed code geometry should not be rebuilt because one comment changes
height. Dynamic blocks have a separate prefix index bounded by blocks/segments, and code retains its
own exact topology.

## Fixed-height comment slots

Refused. Markdown, images, disclosures, suggestions, and composers have unbounded combinations. A
large estimate creates whitespace; a small one clips or adds nested scrolling. Estimates are only a
temporary reservation until near-viewport measurement.

## A `ResizeObserver` that writes height immediately

Refused. Read-observe-write around the same element creates a feedback loop and allows a burst of
blocks to commit repeatedly in one frame. The observer marks blocks dirty. One scheduler batches
reads and commits. Visible growth has a coalesced before-paint exception and active scroll still wins.

## Inferring user interaction from `scroll` events

Refused. Programmatic correction, navigation, browser clamps, and reader input all emit scroll.
Input events arm reader activity; layout writes are marked as Acorn's own; corrections use those
causes rather than the timestamp of any scroll event.

## Pixel offsets as durable reading state

Refused. A pixel is invalidated by body loading, a resize, a disclosure, collapse, or a changed
document. Store a stable row/block/turn identity and the offset within it. A pixel may be a fast hint
for an unchanged geometry, not the authority.

## An imperative recycled DOM renderer for the diff

Refused for this programme. GitHub's renderer is a useful proof of the fixed-geometry model, but
Acorn's Solid row components already own accessibility, comment interactions, annotations, editor
actions, plugin seams, and two projections. Segmented data and diff-specific geometry remove the
document-sized work without recreating that behavior in a second imperative UI system. Reconsider
only if the canonical profile remains over budget after phases 2 and 3 and a profile attributes the
remaining cost to mounted component overhead.

## Provider-specific document types in client-core

Refused. The shared diff viewer serves GitHub PRs, GitHub compares, and local Changes. Its topology
describes files, fixed rows, anchors, blocks, and capabilities. GitHub cursor, review, and REST types
stay in the GitHub plugin; local staging/worktree types stay in Changes.

## A permanent old-and-new `DiffSource` adapter

Refused. Building whole patches and segmented documents together doubles memory and leaves two
behaviors to maintain. Migrate every first-party source and fixture in one production switch, apply
the plugin API major rule where needed, and delete the adapter. Temporary branch/test scaffolding is
allowed.

## Caching whole documents by count alone

Refused. One document may be 50 rows and another one million. The cache uses segment-level row and
byte weights. “The last few diffs” is a likely outcome under ordinary sizes, not the admission rule.

## Persisting parsed rows, tokens, heights, or DOM

Refused. These values are reconstructable, large, and tied to parser, tokenizer, width, and rendering
versions. They remain in a bounded renderer-memory cache. The Node's content-addressed raw/plain
segment blobs and normal query summaries provide the durable layers.

## A generic variable-height Timeline virtualizer

Refused for this programme. The previous Agent transcript implementation cleared measurement caches
on events and replaced DOM under text selection. Stage A uses stable identity, containment, and lazy
bodies. If construction remains too expensive, callers use a fixed logical window with **Show
earlier**. A continuous variable-height virtualizer may be reconsidered only when a product
requirement rejects that interaction and a prototype proves selection, focus, reading place,
streaming, and measurement on the canonical real-engine fixture.

## Windowing a timeline before measuring containment and construction

Refused. A fixed window changes native page-find and hidden-history behavior. Stable keys, lazy PR
snippets/bodies, and verified browser containment land first. Windowing ships only if phase 0 shows
that component/Markdown construction still misses the accepted budget.

## Removing old events or comments to meet a UI budget

Refused. The underlying transcript and pull-request data remain complete. A logical window changes
which turns are mounted and gives an explicit way to reveal hidden history; it does not truncate the
model.

## A production diagnostics endpoint with document details

Refused. Diffs and timelines can contain proprietary source, prompts, tool output, identities, and
comments. Permanent health signals are numeric with fixed labels. Exact local snapshots use the
existing bounded performance-timeline diagnostic path and contain no content or resource IDs.

## Timing budgets copied from GitHub or one developer machine

Refused. Hardware, WebKit, build mode, and fixture shape affect milliseconds. Phase 0 first asserts
scaling/lifecycle invariants and records a dated Acorn baseline. Absolute budgets are then chosen from
supported-host evidence and stored with their environment.

## A canonical stress test only in jsdom

Refused. Pure geometry, loader, cache, and component behavior belong in fast tests. Scroll momentum,
ResizeObserver timing, content visibility, fractional pixels, layout, and paint must also run in the
real Tauri/WebKit window. One layer cannot replace the other.

## A new streaming transport before measuring compact topology

Refused as the starting point. A compact descriptor set for a few thousand files/segments may fit the
existing bounded JSON routes. Phase 2 begins there and measures response size and first content. Add a
stream only if topology transfer remains the observed blocker, while preserving revision and ready
boundaries.

## Verify before building

- Read this file before adding a second diff renderer, a compatibility path, a persistent parsed
  cache, or a Timeline virtualizer.
- Compare any proposed exception with the canonical phase 0 report, not an isolated microbenchmark.
- Recheck the relevant owning docs after earlier phases ship; a refusal may have moved there with the
  final contract.
- If new evidence overturns a decision, update this file with the evidence and replacement before
  implementation so later phases do not follow contradictory rules.
