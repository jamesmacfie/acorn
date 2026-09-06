import { createMemo, type Accessor } from 'solid-js'

/** A `<Show>` child's accessor that keeps the last value instead of throwing.
 *
 *  Solid's narrowed accessor throws "Stale read from <Show>" when a child computation re-runs in
 *  the same tick the `when` value goes away. That happens on this screen whenever a subtree under
 *  the Show is rebuilt by the write that also clears the session, because Solid's owner walk stops at
 *  the rebuilt node and never reaches the Show that would have disposed it first. Reading the source
 *  through this memo returns the previous value for that one tick, and the Show disposes it a moment
 *  later.
 *
 *  Use it as `const session = hold(model.selected, narrowed())`. */
export function hold<T>(read: Accessor<T | undefined | null | false>, initial: T): Accessor<T> {
  return createMemo<T>((previous) => read() || previous, initial)
}
