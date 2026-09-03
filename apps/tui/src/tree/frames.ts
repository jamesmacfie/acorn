// One frame per turn of the event loop, at most.
//
// Every operation that changes the tree asks for a frame, and a burst of signal writes in one update
// pass therefore costs one paint rather than one paint each. `setImmediate` rather than a timer,
// because there is no frame rate here: nothing runs when nothing changed, which is what the current
// renderer's `requestRender` gives us and what we are keeping.
//
// The paint pass registers the callback (a later slice). Until it does, asking for a frame is a flag
// and a scheduled no-op, which is exactly what the tree's own tests want to read.

let pending = false
let draw: (() => void) | null = null

/** What paint installs to be told a frame is due. One subscriber, because there is one painter. */
export const onFrame = (fn: (() => void) | null): void => {
  draw = fn
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

/** Is a frame on its way? The tree operations have no return value to assert on, so this is how a
 *  test sees that one of them marked the frame dirty. */
export const frameRequested = (): boolean => pending
