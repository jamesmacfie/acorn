# Phase 3: separate dynamic-block geometry and identity anchoring

Status: not started, 2026-09-26. Waits on phase 2.

## Goal

Fixed diff rows keep exact geometry that never changes when a comment, note, composer, disclosure, or
image resizes. Variable content lives in a separate index keyed by stable identity and structural
anchor. Measurement work is near the viewport, paused during reader scrolling, read in one batch,
and committed at most once per frame. Height corrections keep the same row or block under the reader
by identity.

## Why this phase

Phase 2 reduces a million rows to several thousand compact segment descriptors and a viewport-sized
set of row objects. It may still let a variable-height segment measurement invalidate every segment
after it. The installed TanStack virtualizer's single-lane path stores offsets efficiently, but a
size change rebuilds the suffix from the earliest changed index and may adjust scrolling from the
measurement callback.

That behavior is reasonable for a normal variable-height list. It is the wrong cost model for an
exact code document with comparatively few comments. A dynamic block should update work bounded by
the number of blocks or segments, not by the number of code rows below it.

## Scope

In:

- A diff-specific `DiffLayoutIndex` with exact fixed geometry and a separate dynamic-height index.
- Stable block descriptors, content/state fingerprints, local layout revisions, and width buckets.
- One measurement scheduler per mounted diff surface.
- A shared `ResizeObserver` that marks mounted blocks dirty and never writes geometry directly.
- Near-viewport batched reads, one bounded offscreen measurement fallback, and one commit per frame.
- A before-paint path for visible growth when the reader is not actively scrolling, still coalesced
  to one frame.
- Identity-based scroll anchors and explicit reader-input versus programmatic-scroll state.
- Dynamic block and height-cache lifecycle probes from phase 0.
- Unified and split projection support, file collapse, gap overlays, thread collapse/resolve, line
  extras, annotations, and composers.

Out:

- A generic replacement for TanStack Virtual. This index is specific to diff topology and its two
  geometry domains.
- Soft-wrapped code. Code rows remain exact by staying one line high with horizontal scrolling.
- Timeline geometry. Phase 5 uses a fixed logical window if needed.
- Cross-document retention of segment payloads (phase 4). Active-document measured heights may be
  handed to that cache later, under a separate budget.
- Synchronous geometry writes during active wheel, pointer, touch, or keyboard scrolling.

## Geometry model

The layout equation is:

```text
document height
  = exact fixed height from file/segment topology
  + sum of effective dynamic-block heights
  + scroll padding
```

The fixed side uses the exact per-segment unified or split height from phase 2. Store segment starts
in a compact prefix representation, using typed arrays when the phase 0 profile justifies them. A
bounded segment may keep a small local row-offset table; there is never a global entry per code row.

The dynamic side contains only blocks whose height can change:

- GitHub review threads,
- Changes review notes and source-owned line extras,
- extension annotations with nonzero body height,
- open line and reply composers,
- disclosures, suggested-change context, reactions, and async media inside those blocks.

Each block has:

```ts
type DiffDynamicBlock = {
  id: string
  kind: 'thread' | 'note' | 'annotation' | 'line-composer' | 'reply-composer'
  anchor: DiffRowAnchor
  fingerprint: string
  layoutRevision: number
  estimatedHeight: number
}
```

`id` survives body loading and state changes. The anchor is file/side/line or another stable
structural row identity, never a global index or pixel. The fingerprint covers source content and
stable state that can change height: body revision, comment identities, resolved/collapsed state,
disclosures, and source-owned banners. Local edits that would make hashing every keystroke wasteful
bump `layoutRevision`. Neither value is emitted to telemetry.

A cached measurement is valid only for `(document revision, block id, fingerprint, layoutRevision,
width bucket, projection)`. A width bucket is a named constant chosen from phase 0 resize evidence.
Visible blocks are always re-read when dirty, even if a cache entry exists.

The effective height is measured height when the key matches, a valid cached height otherwise, and
the kind/state estimate as the final fallback.

## Index structure

Use two levels rather than a flat million-entry prefix sum:

1. A fixed segment prefix index supplies exact base positions and total fixed height.
2. A Fenwick tree or equivalent prefix-sum index stores each segment's total dynamic contribution.
   Updating one block changes one segment contribution in `O(log segments)`.
3. Each segment has a bounded local list of anchored blocks and their effective-height prefix. A
   resize moves later rows only within that bounded segment calculation; global segment starts read
   the dynamic prefix tree.

Conceptually:

```text
segmentTop(i) = fixedPrefix(i) + dynamicPrefix(i)
rowTop(i, localRow) = segmentTop(i) + localFixedOffset + localDynamicPrefix
```

Finding the visible segment binary-searches the monotonic `segmentTop`. Finding a row or block within
it searches bounded local geometry. `offsetForAnchor` and `anchorAtOffset` are inverse operations
within the documented pixel tolerance.

Collapsing a file, changing projection, or inserting a user-requested gap overlay may rebuild the
fixed segment prefix because those are explicit low-frequency document changes. A dynamic block
resize may not. Record fixed-index rebuilds separately so a regression cannot hide them under normal
measurement metrics.

This index becomes the diff's range and scroll authority. Keep TanStack Virtual for surfaces where it
fits; do not wrap it around a second contradictory set of diff offsets. Existing Solid row
components still render the mounted range.

## Measurement scheduler

One surface scheduler owns the observer, dirty set, offscreen measurer, frame handles, idle handle,
and active-input state.

### Candidate range

- Mounted dynamic blocks in or near the viewport are always candidates.
- The runway is a named pixel budget measured from the viewport, not a count of total blocks.
- A nearby unmounted block may use the offscreen measurer. Render at most one such block per pass.
- Skip offscreen measurement for a block estimated taller than the viewport; its correction can wait
  until it mounts.
- Distant blocks retain an estimate or valid cached height and create no DOM.

### Read and commit phases

1. The observer callback maps changed elements to block IDs, marks them dirty, and schedules work. It
   performs no layout read and no geometry write.
2. Once the range has settled and reader scrolling is inactive, one pass gathers candidates.
3. Read every connected candidate's rectangle in one batch, with no writes between reads.
4. Compare the readings with effective heights and build one change set.
5. Capture the current identity anchor.
6. Commit the change set once, update the dynamic prefix index, resolve the anchor, and make at most
   one scroll correction.

An on-screen block that visibly changes may request the before-paint lane. It still joins one
`requestAnimationFrame` batch and one commit. If reader scrolling is active, it falls back to the
normal post-scroll pass. A burst of image, disclosure, and composer resizes cannot produce multiple
commits in one frame.

Mounted ground truth wins over a cache or estimate. Never filter a mounted dirty block out because
another candidate has a seemingly newer cached measurement; that creates the blank strip failure the
GitHub article describes.

### Scroll state

Do not infer reader activity from the latest `scroll` event. Programmatic corrections and browser
clamps also emit scroll events and would keep the guard active against its own work.

Follow the proven distinction in `Timeline.tsx`:

- wheel, pointer, touch, and relevant keyboard input arm reader activity,
- a recent input plus resulting scroll is reader-driven,
- writes made by the layout index are marked as applying until their event has passed,
- browser clamps are neither a reader gesture nor a layout command,
- momentum keeps the reader-active window open for a measured settling interval,
- a programmatic file/search jump has its own state and can request measurement needed to land.

Use one shared input-state helper if the semantics can genuinely be identical for Timeline and diff.
Do not create two helpers with the same timers and different edge cases.

## Identity-based correction

Before a geometry commit, capture:

```ts
type DiffReadingPlace =
  | { at: 'row'; anchor: DiffRowAnchor; offset: number }
  | { at: 'block'; id: string; offset: number }
  | { at: 'end' }
```

After the commit, resolve the same identity in the new geometry and adjust `scrollTop` by the
difference. Follow these rules:

- A block entirely above the viewport changes height: correct by the delta so the reading place
  stays fixed.
- Content below the viewport changes: do not move the viewport.
- The visible block the reader directly opened or edited grows: keep that block's own top/offset and
  let later content move naturally; do not apply a second above-block correction to it.
- An anchor removed by a source refresh falls back to the nearest surviving structural neighbor,
  using stored file/segment order, and records a substitute-anchor outcome.
- Active reader momentum delays the correction. A programmatic scroll does not.
- Corrections use integer-independent CSS pixels and accept fractional WebKit positions; tests use a
  tolerance rather than rounding the model.

Scroll restoration stores an identity place plus projection and document revision. A pixel may be
kept as a fast hint, but it is not the authority after dynamic content or width changes.

## Resize and width buckets

A pane resize changes code canvas width but not fixed row height because code does not wrap. It can
change every Markdown block. On resize:

- compute the new width bucket,
- keep measurements whose bucket is unchanged,
- invalidate other block measurements lazily,
- retain their previous height as a temporary estimate when the content fingerprint still matches,
- prioritize mounted blocks, then the near range,
- and preserve the identity reading place through the resulting corrections.

Do not synchronously read all 400 blocks after a sidebar or window resize.

## Observer and cleanup contract

Prefer one `ResizeObserver` observing all mounted dynamic elements for a diff surface. Keep a map from
element to block ID and unobserve on row unmount. If WebKit behavior requires another arrangement,
the health counters still track observed elements and observer instances separately.

On surface cleanup:

- disconnect the observer,
- remove offscreen measurement DOM,
- cancel animation, idle, and settle timers,
- clear dirty elements and pending changes,
- release document-local height entries unless phase 4 has accepted them into its bounded cache,
- unregister the phase 0 health source before its final teardown snapshot.

An inactive pull-request tab observes nothing.

## Code touched

- New diff layout/index modules under `packages/client-core/src/features/diff/` or
  `kit/diff/` according to whether they import application state. Keep pure geometry in `kit`.
- `DiffPane.tsx` and `DiffCanvas.tsx`: range selection, anchor capture/restore, input state, and
  dynamic block registration.
- `virtualization.ts`: remove or narrow the diff-specific TanStack adapter; retain unrelated users.
- `parsedPublisher.ts` or its phase 2 replacement: notify range settling without owning geometry.
- `scrollRestoration.ts` and view-state types: identity places instead of authoritative pixels.
- Thread, note, annotation, composer, disclosure, and image row components: fingerprints,
  layout-revision bumps, and explicit direct-interaction causes.
- Phase 0 probes and focused tests.

## Tests

### Pure geometry

- Generate one million fixed rows represented by segment descriptors and 400 dynamic blocks. Random
  height updates change no fixed prefix entry and touch only logarithmic/global plus bounded local
  index nodes.
- Property-test `anchorAtOffset(offsetForAnchor(anchor) + x)` for fixed rows and dynamic blocks in
  unified and split modes.
- Insert, resize, remove, collapse, expand, and change projection; totals and anchors match a slow
  reference implementation on small generated documents.
- Two blocks sharing display text or line number retain distinct identities.

### Scheduler

- A burst of observer notifications performs one read batch and at most one commit in a frame.
- No normal commit runs while reader scrolling is active; programmatic scroll events do not extend
  the reader guard.
- Mounted dirty blocks are read even when cached; distant blocks are not mounted or measured.
- At most one offscreen block is rendered per pass, and a viewport-tall estimate skips that path.
- Disconnect returns observer, dirty, timer, and offscreen counts to zero.

### Reading place

- A resize above the viewport keeps the same row identity and offset.
- A resize below does not move `scrollTop`.
- Opening a visible disclosure or composer moves following content once, without a two-step frame.
- Reader momentum wins over a pending correction; the correction runs after settle.
- A removed anchor substitutes the nearest surviving identity and reports the outcome.
- Sidebar/window width changes preserve place even when programmatic scroll events fire.

### Real engine

Run the phase 0 canonical flow with delayed images, `<details>`, reply typing, resolve/collapse, file
collapse, sidebar resize, unified/split changes, deep bidirectional sweeps, and teardown. Assert one
commit per frame, zero source blocks inserted after ready, zero blank/uncovered ranges, bounded
mounted/measurement counts, and the recorded anchor-drift budget.

## Docs owed

Per [docs-migration.md](./docs-migration.md): `docs/diff-rendering.md`, `docs/telemetry.md`,
`docs/state-ownership.md`, and `docs/testing.md`.

## Done when

- Resizing any dynamic block does not rebuild fixed code geometry or perform work proportional to
  the code rows below it.
- Measurement is near-viewport, read-batched, scroll-gated, and capped at one commit per frame.
- Cold, resize, and direct-interaction flows retain the same identity reading place within the
  phase 0 budget and contain no blank mounted blocks.
- Leaving the diff returns all observer and scheduler counts to baseline.
- Unified/split, collapse, gap expansion, comments, annotations, and navigation still work.
- `pnpm lint`, pure geometry and client-core suites, the canonical real-window flow, and
  `pnpm test` pass.

## Verify before building

- Reinspect the locked `@tanstack/virtual-core` implementation. Record the suffix-rebuild evidence
  against the installed version before removing its diff adapter.
- Confirm phase 2 topology supplies exact fixed heights and both projection counts; phase 3 must not
  infer them by loading payloads.
- Trace every current `measureElement`, `measure()`, `ResizeObserver`, scroll write, and scroll-event
  handler in the diff and Timeline.
- Confirm all dynamic content kinds, including source line extras and extension annotations, before
  closing the `DiffDynamicBlock.kind` union.
- Re-run WebKit resize and fractional-scroll probes before choosing the width bucket and tolerance.
- Check whether `Timeline.tsx` input-state semantics can be extracted without importing application
  state into `kit`; share only the truly generic part.
