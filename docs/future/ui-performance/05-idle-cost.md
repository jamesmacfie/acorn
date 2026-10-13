# Phase 05: idle cost

Status: planned, October 13, 2026.

Read the [programme page](./README.md) first. This phase starts by measuring with phase 01's idle
phases.

## Deliverable

A focused desktop window with nothing changing stops waking on every frame. Timers and socket frames
that change nothing on screen stop causing work. The phase ends with idle numbers recorded with
telemetry on and off.

## The problem

Nobody has measured what the desktop costs while it sits still. The October 9, 2026,
[performance baseline](../../testing/performance-baseline-2026-10-09.md) covers startup and bundle
size only.

Zeron measured this and found most of its idle cost in work that changed nothing visible. Not
redrawing on heartbeats that changed no label, and stopping its frame loop when no frame was needed,
cut idle CPU by 64% and idle wakeups by 96% in its two-minute comparison
(`references/zeron/docs/performance-idle-presence.md`).

## Suspects

Check these in order. The first is the most likely.

1. **The frame-gap sampler.** `startResponsivenessMonitor` in
   `packages/client-core/src/infra/telemetry/responsiveness.ts` requests an animation frame every
   frame while telemetry is on and the window is focused and visible, to record `ui.frame.gap`. That
   wakes the renderer at the display's refresh rate, 60 to 120 times a second, even when nothing
   changes. The monitor's once-a-second pulse to the helper is cheap beside it.
2. **Interval timers.** The client starts intervals for the telemetry flush, page facts, chrome data
   refresh, and schedules, plus polls in Settings pages, the usage store, the workflow run pane's
   one-second clock, and the tool card's one-minute clock. Most run only while their surface is open.
   Check which run in an idle window and whether each tick changes anything on screen.
3. **Socket frames that change nothing.** Node status, usage, and presence frames can set a signal to
   a value equal to the one it holds. Count renders and effects during an idle minute to find them.
4. **Endless animations.** `primitives.css` and `base.css` define spinners and a pulsing dot that loop
   forever. They're correct while something works. Check that none stays on screen once work stops,
   such as on a session that waits for you.

## Change

Fix each suspect the measurement confirms:

- For the frame-gap sampler, sample frame gaps only for a bounded window after activity: input,
  telemetry activity the monitor already hears, or a streaming frame. Two seconds is a starting
  value. Keep the event-loop delay check on its one-second timer, so a stall in an idle window is
  still reported.
- For a timer or frame that changes nothing, compare before setting the signal, or stop the timer
  while its surface is hidden.
- For an animation, stop it when its state ends.

Keep what each diagnostic is for. `ui.frame.gap` has to keep catching dropped frames during
interaction and streaming. [Diagnosis](../../telemetry/diagnosis.md) lists what it answers.

## Implementation steps

1. Record the idle phases with phase 01, with telemetry on and off: focused, blurred, and hidden.
2. Fix the frame-gap sampler if the focused-idle numbers with telemetry on are above those with it
   off.
3. Count renders, effects, and timer ticks in an idle minute, and fix each that changes nothing.
4. Audit the endless animations.
5. Record the after numbers, and update [diagnosis](../../telemetry/diagnosis.md) with the sampler's
   new window.

## Acceptance

- In a focused idle window, renderer wakeups and CPU with telemetry on are within the spread of the
  same measurement with telemetry off.
- `ui.frame.gap` still records during the `streaming` phase and during scrolling.
- An idle minute shows no render or effect caused by a value that didn't change.
