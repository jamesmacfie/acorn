# Phase 09: renderer memory

Status: built October 13, 2026. The heap snapshots and a working day in Sentry are still open.

## Completion note

October 13, 2026. Nothing in the page's own data grows into gigabytes. Two query cache entries grew
with use and now leave memory soon after their screen closes, and the transcript store reports what
it keeps. No heap snapshot of the real window was taken, because an agent-launched window is hidden
and Web Inspector needs a person.

### What I measured

All of it in Node, with seeded or real data read without writing. None of it in WebKit.

| What | Size | How it's bounded |
| --- | --- | --- |
| One canonical transcript, 7,011 events, 3.27 million characters of JSON | 4.1 MB of heap parsed, plus 1.3 MB for its projection of 4,125 items | Sessions on screen plus the three drawn last (`KEEP_RECENT`) |
| One terminal at 200 columns and 1,000 lines of scrollback, in `@xterm/headless` | 3.7 MB, counting the buffer's typed arrays | Until its tab closes, by design ([terminals outlive their task view](../../terminal/client.md#terminals-outlive-their-task-view)) |
| The session roster, as full rows for James's 73 sessions that changed in the last 24 hours | 3.27 million characters of JSON, 5.4 MB of heap | Every session the window has seen, until a Node switch |
| The persisted query cache, from the baseline | 147 entries, 1.9 million characters | One day per entry (`gcTime`) |

The other caches I read in code have a fixed ceiling: the Shiki HTML cache holds 200 fences of up
to 16 KB, diff segments 32 MiB, idle media previews 16 MB, Docker logs eight streams, and Git explain
results 16. Pull request, PR tab, and Docker pane models keep one at a time. Editor documents go when
nothing reads them and they hold no unsaved edit. Tree workers stop when their last lease goes, and
there's one highlight worker.

Added up for a heavy afternoon, with two sessions on screen, three kept, and 10 terminals, the
page's own data is around 100 MB. That's far below the 2.6 GB peak. So the likely answer is that
most of the footprint is WebKit's own memory: layer backing stores, decoded images, the four
terminals' WebGL contexts, compiled code, and heap the JavaScript engine hasn't handed back. Only a
Web Inspector memory timeline can confirm it.

The 101-second `cache.dehydrate` fits pressure on the whole machine. The baseline's agent processes
reached 3.2 GB at p95 and 8 GB at their peak the same afternoon. Phase 08 limits those.

### What landed

- **Dashboard panel previews.** The preview's key holds the whole plan, so each edit, down to a
  keystroke in the title, made a cache entry that stayed a day and went into every five-second save.
  The query sets `gcTime: 0` and `meta: { persist: false }`, so only the preview on screen stays.
  `PanelStudio.test.tsx` checks that after a view change one preview with rows remains and that it
  isn't saved. The test fails on the old code.
- **GitHub job logs.** A job log is the whole CI log. GitHub doesn't cap it and the Node doesn't trim
  it. It stayed a day and went into every save. It sets `gcTime` to five minutes and
  `meta: { persist: false }`. No test, because the change is two query options.
- **A gauge, `agents.snapshots.events`.** After each transcript load and release, the store reports
  how many events its kept transcripts hold. At about 600 bytes of heap per event, it's the store's
  memory in a number. [Memory over a day](../../telemetry/diagnosis.md#memory-over-a-day) lists it.
  A test in `managedStore.test.ts` checks it stops at the three kept sessions' events.
- [The renderer query cache](../../caching.md#renderer-query-cache) names both shorter-lived queries.

### Decisions and deviations

- Steps 1 and 4, the snapshots and a day of use, need a person. The steps are below.
- The acceptance asks that the second snapshot hold no transcript or terminal buffer that isn't on
  screen. Two designs contradict that on purpose. Phase 04 keeps three transcripts after their pane
  closes, and a terminal keeps its xterm until its tab closes. I left both alone. Expect up to three
  transcripts and every open terminal tab in the second snapshot. If the snapshot shows terminals are
  large, a smaller scrollback or freeing hidden xterms is a product decision.
- The roster isn't fixed. It grows by about 5 MB of heap a day of sessions and clears on a Node
  switch. Archived tasks' sessions stay in it. Dropping them touches the archive page and the
  attention gate, which isn't worth it at that size.
- GitHub file blobs and pull request diff documents keep the one-day lifetime. They're kilobytes per
  file.
- The gauge goes through `telemetryFor('agents').gauge` rather than a 30-second page fact, because
  `registerPageFact` isn't on the plugin API. It also reports while the window is hidden, where page
  facts don't. Terminals got no gauge. `heldTerminalCount` exists if one is wanted.

### What a person still needs to measure

1. Start `pnpm dev`, and work as usual until Activity Monitor shows the window's web content process
   past 1.5 GB in the **Memory** column.
2. Right-click in the window, choose **Inspect Element**, and open **Timelines**. Record the
   **Memory** timeline for a few seconds. Write down its split into JavaScript, Images, Layers, and
   Page, and how many sessions, tasks, and terminal tabs you've opened.
3. In **Timelines** > **JavaScript Allocations**, take a heap snapshot.
4. Close every pane, wait one minute, and take a second snapshot. Compare the largest retainers. If
   the JavaScript heap is a few hundred MB while the footprint is over 1.5 GB, the rest is WebKit's.
5. After a full working day on this build, compare these in Sentry with the
   [baseline](../../testing/sentry-baseline-2026-10-13.md), and record them under `docs/testing/`:
   - `runtime.memory.footprint` with `runtime: renderer`. Baseline 800 MB average, 1.5 GB p95, and
     2.6 GB peak. The target is a p95 under 1.2 GB.
   - The maximum of `agents.snapshots.events`. With canonical-size sessions it stays under about
     35,000. A higher number means a session is held that shouldn't be.
   - `cache.characters.max` and `cache.dehydrate` during the footprint's peak minutes.
   - Whether the footprint's peaks fall in the same minutes as `agent.processes.memory` peaks.

For later phases: the page's memory gauges sample only while the window is visible, but
`agents.snapshots.events` reports whenever the store changes. Read the footprint against both.

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
