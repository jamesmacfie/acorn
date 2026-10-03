# Rendered-surface health

This page covers the numbers a large diff or timeline keeps about itself, how to read them, and which
of them reach telemetry. Read it when you change how a large surface mounts, measures, or holds
content, or when a test asserts on these numbers. It's part of [telemetry](../telemetry.md).

## The registry

One registry owns the numbers: `packages/client-core/src/kit/lib/telemetry/surfaceHealth.ts`. A
surface registers when it mounts, hands over a reader, and disposes the registration when it unmounts.
Two surfaces register:

- The shared diff viewer, as `diff` (`packages/client-core/src/features/diff/diffHealth.ts`). Its
  layout counts measurement and corrections in `features/diff/diffLayout.ts` and
  `kit/diff/measureScheduler.ts`.
- Every `Timeline`, as `timeline` (`packages/client-core/src/kit/components/content/Timeline.tsx`). A
  caller passes `total`, the number of turns in its list, drawn or not, and `hidden`, the older turns
  its window isn't drawing.

The reader runs only when someone asks for a snapshot, so an open surface pays nothing between
requests. Disposal takes one final reading after the surface's own cleanups and keeps it as that kind's
`retired` entry, which shows whether observers, frames, and queued work reached zero.

| Group | Fields | Meaning |
| --- | --- | --- |
| `topology` | `files`, `segments`, `fixedRows`, `dynamicBlocks`, `ready`, `lateSourceBlocks` | The whole document. Fixed rows are code and structural rows with exact heights. Dynamic blocks are a diff's threads and a timeline's projected turns. `ready` means the source-owned structure is complete. `lateSourceBlocks` counts threads that arrived after that. |
| `mounted` | `segments`, `fixedRows`, `dynamicBlocks`, `blankBlocks`, `uncoveredRanges`, `bodies` | What's in the DOM. A blank block is a visible item with neither placeholder nor content. An uncovered range is visible space no item covers, measured from real rects. `bodies` is deferred content a timeline has built. |
| `work` | `queuedSegments`, `queuedEnrichment`, `furthestQueueDistance`, `unvisitedSegments`, `scheduledFrames`, `heldPublications`, `prepareMs` | Work still owed. The queue distance is in segments from the ones on screen, never a path. `unvisitedSegments` is the loader's runway. `prepareMs` sums row building and colouring time. |
| `measurement` | `candidates`, `reads`, `commits`, `maxCommitsInFrame`, `readMs`, `commitMs`, `fixedRebuilds`, `activeObservers`, `observedElements` | Size reads and the geometry commits they caused, since mount. `fixedRebuilds` counts rebuilds of the exact fixed geometry, which only a change to the item list may cause. |
| `correction` | `count`, `failed`, `substituted`, `maxPixels`, `maxAnchorDrift` | Scroll writes that kept a reading place. `failed` fell back to the live end, `substituted` used a neighbour, and `maxAnchorDrift` is the furthest the browser left the view from the place. |
| `resident` | `documents`, `segments`, `rows`, `estimatedBytes`, `plainBytes`, `enrichmentBytes`, `hits`, `misses`, `inserts`, `evictions`, `oversize`, `rowCeiling`, `byteCeiling` | For a diff, the Node's shared segment cache and its two ceilings. `hits` and `misses` are this pane's own. The bytes are the cache's budget estimate, not the heap. |
| `window` | `hiddenEarlier`, `expansions`, `trims`, `pinned` | A timeline drawn through a fixed window (`kit/lib/timeline/timelineWindow.ts`): turns not drawn, growths, trims while following, and turns a trim kept for a selection or focus. |

A field a surface has no concept of stays zero. The timeline has no segments. The diff has no window
and no live end, so it never fails a correction and substitutes instead. `heldPublications` is always
zero for the diff, because a segment publishes when it arrives and arrives only when near.

The snapshot holds numbers, one boolean, and the two kind labels. The registry copies only the fields
the template names, and only finite numbers, so a reader that returned a path or an ID would lose it.
`surfaceHealth.test.ts` and the diff probe test feed canary strings through and check none come out.

## What reaches telemetry

Telemetry gets a fixed handful of these numbers as histograms at a diff's `ready` and at any surface's
`teardown`: `ui.surface.topology.fixed_rows`, `ui.surface.mounted.fixed_rows`,
`ui.surface.mounted.dynamic_blocks`, `ui.surface.measurement.max_commits_in_frame`,
`ui.surface.measurement.active_observers`, `ui.surface.correction.max_pixels`,
`ui.surface.work.prepare_ms`, and `ui.surface.resident.estimated_bytes`. Their only labels are
`surface` and `checkpoint`.

## Read a snapshot

The whole snapshot is a local read on the performance timeline. Dispatch an `acorn:surface-health`
event on `window`, then read the `detail` of the `acorn:surface.health` mark:

```js
dispatchEvent(new Event('acorn:surface-health'))
performance.getEntriesByName('acorn:surface.health').at(-1).detail
```

The desktop answers from boot, whatever the `acorn.perf` switch says
(`packages/client-core/src/infra/telemetry/surfaceHealth.ts`), because the automation window shares
WebKit storage with a developer's own app. Each answer replaces the previous mark. Nothing is put on
`window`, and no HTTP route exposes it. The large-surface flow reads it this way
([agent drivers](../local-development/agent-drivers.md#large-surface-flow)).

## Reading a timeline

- `topology.dynamicBlocks` is the caller's turns and `mounted.dynamicBlocks` the turns in the DOM.
  With a window they differ by `window.hiddenEarlier`. The large-surface flow counts a timeline as
  mounted when every turn is drawn or hidden, and asserts the 400-turn ceiling on open.
- A followed transcript opens on 200 turns and trims back to 200 once it draws 400 while following, so
  `mounted.dynamicBlocks` stays under 400 unless the reader pressed **Show earlier**, went to the top,
  or held a selection or focus. `window.pinned` says how many turns a hold kept.
- `mounted.bodies` grows as disclosures open and deferred bodies come near, never with list length.
- `correction.substituted` counts places whose turn left the list. A turn the window hides is revealed
  instead and doesn't count.
- `measurement.activeObservers` is two on a followed timeline, plus one while any turn has a deferred
  body, and zero after teardown.

## Reading a diff

The diff measures only its dynamic blocks, threads and whatever a line draws under itself, through one
observer ([row geometry](../diff-rendering.md#row-geometry)). Its topology is complete before any row
loads, and its queue is the segments on screen and two either side.

- `activeObservers` is one while the pane is mounted and zero after. `observedElements` is the
  scroller plus the mounted blocks, so it tracks `mounted.dynamicBlocks`.
- `candidates` and `reads` grow with blocks mounted and resized, not with rows. A read that finds the
  height the geometry holds commits nothing.
- `maxCommitsInFrame` stays at one, because a frame's second commit waits for the next frame.
- `fixedRebuilds` rises when the item list changes, such as a collapsed file or an opened gap, and
  never when a block resizes.
- `correction.count` and `maxPixels` are the scroll writes that kept the reader's row in place. Blocks
  above a scrolling reader wait until the scroll settles. `maxAnchorDrift` should stay under a pixel.
- `mounted.blankBlocks` and `uncoveredRanges` come from real rects, so a fixed row height that
  `diff.css` stopped honouring shows up there first.
