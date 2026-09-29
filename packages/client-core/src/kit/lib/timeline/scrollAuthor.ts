// Who moved a scroller: the reader, or the surface itself.
//
// A scroll event says the position changed and nothing about why. A surface that corrects its own
// scroll has to tell its writes apart from the reader's, or a correction reads as the reader choosing
// a new place and the next correction chases it. Comparing positions does not work: a WebView reports
// fractional device pixels, and the browser clamps a write to what the content can reach. Two facts
// do work, and this module holds both:
//
// - A write this surface made is marked until the frame after it, because its scroll event arrives
//   after the write that caused it.
// - The reader's input (a wheel, a touch, a pointer, a key) is timestamped, and a move within
//   `GESTURE_MS` of it is theirs to explain.
//
// Shared by the Timeline (../../components/content/Timeline.tsx) and the diff
// (features/diff/diffLayout.ts). What each does with the answer differs and stays with it: the
// Timeline spends one arm per gesture, the diff keeps a settling window open through momentum.

/**
 * How long the reader's input stays the explanation for a move.
 *
 * Input arms a gesture and the next scroll event spends it, which is right when the input scrolls.
 * Plenty of it does not: a click to put the caret in a card, a drag to select a line, a key the list
 * ignores. That arm then sat there, and whatever moved the view next (a clamp, a card re-rendering
 * shorter, the browser putting something on screen) was written down as the place the reader chose.
 *
 * A scroll caused by input arrives within a frame or two. A second is long enough to cover a slow one
 * and short enough that a click the reader has forgotten about cannot claim the next move.
 */
export const GESTURE_MS = 1000

export function createScrollAuthor() {
  let applying = false
  // The frame that clears `applying`, held so teardown can cancel it rather than leave it to run
  // against a surface that has gone.
  let releasing = 0
  let lastInput = 0

  return {
    /** The reader touched the scroller. */
    input: () => {
      lastInput = Date.now()
    },
    /** The reader's last input is recent enough to explain a move. */
    fresh: () => Date.now() - lastInput < GESTURE_MS,
    /** A scroll event now is the echo of this surface's own write. */
    applying: () => applying,
    /** Move the scroller, marked as this surface's own doing until the next frame. */
    write: (element: HTMLElement, top: number) => {
      applying = true
      element.scrollTop = top
      // One release for however many writes are in flight. Scheduling one each would let the first
      // frame clear the guard while a later write's scroll event is still on its way, and that event
      // would then read as the reader moving.
      if (releasing) return
      releasing = requestAnimationFrame(() => {
        applying = false
        releasing = 0
      })
    },
    /** 1 while the release frame is requested. */
    pendingFrames: () => (releasing ? 1 : 0),
    dispose: () => {
      if (releasing) cancelAnimationFrame(releasing)
      releasing = 0
      applying = false
    },
  }
}

export type ScrollAuthor = ReturnType<typeof createScrollAuthor>
