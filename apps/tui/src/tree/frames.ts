// One frame per turn of the event loop, at most.
//
// Every operation that changes the tree asks for a frame, and a burst of signal writes in one update
// pass therefore costs one paint rather than one paint each. `setImmediate` rather than a timer,
// because there is no frame rate here: nothing runs when nothing changed, which is what the current
// renderer's `requestRender` gives us and what we are keeping.
//
// The paint pass registers the callback. Where none is registered, asking for a frame is a flag and a
// scheduled no-op, which is exactly what the tree's own tests want to read.
//
// **A hold is for what the tree cannot see coming.** Everything above is synchronous: an operation
// changes the tree and the next turn draws it. One thing is not — a `pty` rectangle's emulator parses
// the bytes it is written on a queue of its own, a macrotask later — and the difference matters to
// anything that draws when nothing is left to do, which is both harnesses. So a source that knows a
// frame is owed and cannot yet ask for one holds instead, and `frameRequested` stays true until it
// lets go (../kit/rectangle.tsx § write, ../harness.tsx § flush).

let pending = false
let held = 0
let draw: (() => void) | null = null

/** What paint installs to be told a frame is due. One subscriber, because there is one painter.
 *
 *  The holds go with it: a surface being replaced is a new screen, and a hold left over from the last
 *  one would leave every later `frameRequested` answering yes forever. */
export const onFrame = (fn: (() => void) | null): void => {
  draw = fn
  held = 0
}

/**
 * Say that a frame is owed for something that has not happened yet, and hand back the way to say it
 * has.
 *
 * Idempotent, because the release is a callback somebody else's library calls and a library calling
 * one twice must not take the count below nought.
 */
export const holdFrame = (): (() => void) => {
  held += 1
  let gone = false
  return () => {
    if (gone) return
    gone = true
    held -= 1
    requestFrame()
  }
}

/** Something in the tree changed. Coalesced: the second call in the same turn is free. */
export const requestFrame = (): void => {
  if (pending) return
  pending = true
  setImmediate(() => {
    pending = false
    draw?.()
  })
}

/** How long `framesSettled` waits for a hold nobody released. A hold that never comes back is a bug
 *  in whoever took it, and hanging the caller forever is a worse way to find out than drawing one
 *  frame early. Generous against the couple of milliseconds a real parse takes. */
const HOLD_DEADLINE_MS = 200

/**
 * Wait for everything that has held a frame to let go.
 *
 * For a caller that draws when there is nothing left to do rather than on a clock, which is both test
 * harnesses. A hold is released from somebody else's queue — xterm parses what it was written on a
 * timer — and a loop over `frameRequested` cannot outwait one, because twenty turns of `setImmediate`
 * go by in two milliseconds and a zero-delay timer is a millisecond (../harness.tsx § flush).
 *
 * Polled rather than promised, because the release is a callback a library calls and a waiter list
 * would be a second thing that has to be got right for the same one-line answer.
 */
export async function framesSettled(): Promise<void> {
  const until = Date.now() + HOLD_DEADLINE_MS
  while (held > 0 && Date.now() < until) await new Promise((done) => setTimeout(done, 1))
}

/** Is a frame on its way, or owed? The tree operations have no return value to assert on, so this is
 *  how a test sees that one of them marked the frame dirty — and how a harness knows to keep turning
 *  the loop for something that has not arrived yet (§ holdFrame). */
export const frameRequested = (): boolean => pending || held > 0
