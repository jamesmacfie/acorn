// One tick for every spinner on screen.
//
// `Spinner` drew a static frame through phase 1, with the reason written next to it: a spinner that
// redraws on a timer of its own keeps the renderer awake for as long as anything on screen is busy,
// and five spinners would be five timers. So the shell starts one interval and every spinner reads
// the same counter — the same argument the DOM makes by putting the animation in CSS, where the
// compositor owns the clock.
//
// Off until the shell starts it, which means a suite that renders one node draws frame zero and
// asserts on a stable cell. That is deliberate: a test of a spinner should be a test of what it draws,
// not of when.

import { createSignal } from 'solid-js'

/** Slow enough to read, fast enough to look alive. Ten frames at 80ms is a turn every 800ms, which is
 *  what every terminal spinner in the wild settles on. */
const FRAME_MS = 80

const [frame, setFrame] = createSignal(0)

/** Which frame every spinner is on. */
export const spinnerFrame = frame

/** Start the shell's tick. Returns the stop, which the caller's scope owns. */
export function startSpinner(): () => void {
  const timer = setInterval(() => setFrame((at) => at + 1), FRAME_MS)
  // Nothing here should hold the process open: a tick is decoration, and a terminal that will not
  // exit because a spinner is still turning is a bug people spend an afternoon on.
  timer.unref?.()
  return () => clearInterval(timer)
}

// When a remote tree flushes a queued batch. The DOM host coalesces on a frame; there is no frame
// here, so a batch lands on the next timer turn and the renderer redraws off the signals it moved
// (../plugins/TreeHost.tsx). Unref'd for the reason the spinner is: a plugin sending batches must not
// be the reason `acorn` will not exit.
export const nextTick = {
  schedule: (run: () => void): number => {
    const timer = setTimeout(run, 0)
    timer.unref?.()
    return timer as unknown as number
  },
  cancel: (handle: number): void => clearTimeout(handle),
}
