// Which part of a long timeline is drawn: the newest turns, and as many older ones as the reader asked
// for (docs/managed-agents/client-surfaces.md § Client surfaces).
//
// A fixed logical window, not a virtualizer. It counts turns and never measures one, so nothing here
// can feed back into layout the way the transcript's old virtualizer did
// (../components/content/Timeline.tsx says what that broke). The caller draws `keys()` and hands the Timeline `hidden()`;
// the Timeline keeps the reader's place by identity while the window changes under it.
//
// The window is held by its oldest drawn key. A streamed turn joins the window rather than sliding it,
// so an arriving event never removes a card. The only things that make it smaller are `reset`, for a
// different list, and `trim`, which the Timeline calls while the reader follows the live end and holds
// nothing in the turns it would drop.

import { createMemo, createSignal, untrack, type Accessor } from 'solid-js'

/**
 * Turns drawn when a windowed timeline opens, and how many "Show earlier" adds.
 *
 * A followed Timeline trims back to this once it draws twice as many, so a transcript left following
 * a live session stays under the 400 mounted turns the large-surface flow allows
 * (apps/desktop/scripts/agent/flow.mjs § MOUNTED_CEILING). Chosen from card construction in jsdom:
 * the canonical 7,012-event session built 3,387 cards in about 840 ms, 0.25 ms a card, so a page is
 * about 50 ms there. No real-window timing was available to refine it.
 */
export const TIMELINE_PAGE = 200

/**
 * Where the drawn part starts. `first` is the oldest key drawn last time and `count` how many turns
 * were drawn. When that key has gone, because a filter dropped it or a request resolved, the same
 * number of newest turns is drawn instead, so the window keeps its size rather than collapsing to one
 * turn or opening onto the whole list.
 */
export function windowStart(keys: readonly string[], first: string | null, count: number): number {
  if (first !== null) {
    const at = keys.indexOf(first)
    if (at >= 0) return at
  }
  return Math.max(0, keys.length - count)
}

/** Where a page-aligned reveal of the turn at `index` starts, given the window starts at `start`. */
export const revealStart = (start: number, index: number): number =>
  Math.max(0, start - Math.ceil((start - index) / TIMELINE_PAGE) * TIMELINE_PAGE)

export type TimelineWindow = {
  /** The keys to draw, oldest first. */
  keys: Accessor<string[]>
  /** The logical index of the first key drawn, which is also how many older turns are hidden. */
  start: Accessor<number>
  /** Draw one more page of older turns. */
  showEarlier: () => void
  /** Draw every turn. The explicit escape hatch for reading from the start or finding text in it. */
  showAll: () => void
  /** Make a hidden turn present. True when the window changed; false when the key is already drawn or
   *  is not in the list, which is the Timeline's cue to fall back to another turn. */
  reveal: (key: string) => boolean
  /** Stop drawing every turn older than `key`. */
  trim: (key: string) => void
  /** Back to the newest page. A caller that passes `list` does not need it. */
  reset: () => void
}

/**
 * `list` names which list `keys` belongs to. When it changes, the window starts again on the newest
 * page in the same pass that reads the new keys, so the old window's size never reaches the new list.
 */
export function createTimelineWindow(keys: Accessor<readonly string[]>, list?: Accessor<unknown>): TimelineWindow {
  // Bookkeeping, not state anything draws from: the oldest key drawn and how many turns that was, as
  // of the last time the window was worked out. `moved` is what makes a reader's action recompute.
  let first: string | null = null
  let count = TIMELINE_PAGE
  let listed: unknown
  const [moved, setMoved] = createSignal(0)
  const move = (next: string | null, size = count) => {
    first = next
    count = size
    setMoved((tick) => tick + 1)
  }

  const start = createMemo(() => {
    moved()
    const id = list?.()
    if (id !== listed) {
      listed = id
      first = null
      count = TIMELINE_PAGE
    }
    const current = keys()
    // An empty list has no oldest key to hold, and holding "none" would draw nothing once turns arrive.
    if (!current.length) return 0
    const at = windowStart(current, first, count)
    first = current[at] ?? null
    count = current.length - at
    return at
  })
  const drawn = createMemo(() => keys().slice(start()))

  return {
    keys: drawn,
    start,
    showEarlier: () => {
      const list = untrack(keys)
      move(list[Math.max(0, untrack(start) - TIMELINE_PAGE)] ?? null)
    },
    showAll: () => move(untrack(keys)[0] ?? null),
    reveal: (key) => {
      const list = untrack(keys)
      const index = list.indexOf(key)
      const at = untrack(start)
      if (index < 0 || index >= at) return false
      move(list[revealStart(at, index)] ?? null)
      return true
    },
    trim: (key) => {
      const index = untrack(keys).indexOf(key)
      if (index > untrack(start)) move(key)
    },
    reset: () => move(null, TIMELINE_PAGE),
  }
}
