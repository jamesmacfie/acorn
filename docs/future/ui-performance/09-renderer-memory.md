# Phase 09: renderer memory

Status: planned, October 13, 2026.

Read the [programme page](./README.md) first. Phase 04 landed first. The transcript store keeps each
of the three most recent sessions' projections (`managedAgentStore.projection`), so count those in
the answer.

## Deliverable

A written answer to what holds the desktop window's memory at its peak, and a fix for whatever grows
without bound. The phase can end with "no leak, the peak is one heavy screen" written down.

## The problem

The [Sentry baseline](../../testing/sentry-baseline-2026-10-13.md) shows the window's
`runtime.memory.footprint` at 800 MB on average, 1.5 GB at p95, and 2.6 GB at its peak. It stayed near
2 GB for the last hour of the day.

The worst query-cache saves fell in the same minutes. `cache.dehydrate` took 101 s and `cache.write`
took 16 s, against 14 ms for a typical save. The cache is the same size as usual, 1.9 million
characters, so those saves were slow because of memory pressure. They didn't cause it.

The page gauges don't explain the peak either. `ui.page.elements` peaked at 17,708 and sat near 6,000
late in the day. `ui.page.timeline_turns` peaked at 399, and `ui.page.diff_cache.bytes` at about
1 MB. The page gauges sample only while the window is visible, so a peak while it was hidden leaves
no page numbers beside it. [Memory over a day](../../telemetry/diagnosis.md#memory-over-a-day) lists them and
explains why most of the footprint is WebKit's memory, not the page's heap.

## Change

Measure first:

1. Keep a working session open until the footprint passes 1.5 GB. Take a heap snapshot in Web
   Inspector and note what's on screen and how many sessions you've opened.
2. Close every pane, wait a minute, and take a second snapshot. What's still there is what nothing
   frees.
3. Compare the largest retainers. Suspects to check first:
   - Transcripts that `managedAgentStore` holds for sessions that are no longer on screen, and the
     store's bound.
   - Terminal scrollback in xterm buffers for terminals that are closed or hidden.
   - The Shiki color cache and the plugin tree workers that `ui.page.workers.tree` counts.
   - The strings each query-cache save makes. A 2 MB `JSON.stringify` runs up to every five seconds,
     1,830 times in the day. Phase 10 shrinks it.

Then fix whatever grows without bound, and add a gauge for it so a regression shows in Sentry.

## Implementation steps

1. Take the two snapshots and write down the top retainers.
2. Fix each unbounded one, with a test that checks the bound.
3. Add a page gauge for the largest retainer if
   [Memory over a day](../../telemetry/diagnosis.md#memory-over-a-day) has none for it.
4. Record a day of use and compare the footprint with the baseline.

## Acceptance

- The second snapshot, after you close every pane, holds no transcript, terminal buffer, or diff
  that isn't on screen.
- Over a comparable day, the footprint's p95 is below 1.2 GB, or the write-up says why the remaining
  memory is WebKit's and outside the page's control.
