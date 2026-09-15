// Where a reader is in a followed list, and the rules that decide it.
//
// Not a scroll offset. "Two thousand pixels down" only means something while everything above those
// two thousand pixels keeps its height, and in a live agent transcript nothing does: a message keeps
// streaming, a code fence grows, an image loads, highlighting settles a frame or two after the paint.
// A place is therefore a turn and how far into it the viewport starts, which survives all of that, or
// it is the live end of the list, which has no offset to be wrong about.
//
// One value rather than a flag beside an offset. Those were two representations of one fact, kept in
// agreement by hand at seven call sites, and every defect found in this code was the two disagreeing.
// It also means following is a value rather than an absence: the old code said "following" by deleting
// the saved offset, so every path that pinned erased a place.

export type ReadingPlace =
  /** Glued to the newest turn, and pulled along as the list grows. */
  | { at: 'live' }
  /**
   * This turn's top edge sits `offset` pixels above the viewport's top edge.
   *
   * `index` is where the turn was in the list, and it is only read when the turn itself has gone: a
   * permission card resolving takes its row out of the middle of the list, and the reader has to land
   * somewhere.
   */
  | { at: 'turn'; key: string; index: number; offset: number }

export const LIVE: ReadingPlace = { at: 'live' }

/** Within this of the foot is the foot. A turn's last line and the end of the list are the same
 *  reading position to a person, and the gap between them is whatever padding the pane has. */
export const LIVE_SLACK = 96

/** What a scroller reports about itself. Named rather than taking the element, so the rules below can
 *  be exercised without a layout engine. */
export type ScrollGeometry = { scrollTop: number; scrollHeight: number; clientHeight: number }

export const atLive = (geometry: ScrollGeometry): boolean =>
  geometry.scrollHeight - geometry.scrollTop - geometry.clientHeight < LIVE_SLACK

/** Two places that would put the reader in the same spot. The pixel tolerance is what stops a
 *  correction that lands half a device pixel out from reporting a move nobody made. */
export const samePlace = (a: ReadingPlace, b: ReadingPlace): boolean =>
  a.at === 'live'
    ? b.at === 'live'
    : b.at === 'turn' && a.key === b.key && Math.abs(a.offset - b.offset) < 1

/**
 * The place a scroll event leaves the reader in.
 *
 * Position alone cannot answer that. When the list shrinks, because a card collapsed, a filter dropped
 * rows, or a card re-rendered shorter, the browser clamps scrollTop and fires a scroll event that by
 * position is indistinguishable from the reader moving the view themselves. So the place only changes
 * on the reader's own gesture; a scroll event with no gesture behind it keeps the place it had,
 * whatever the new position says, and the caller puts the view back.
 *
 * A gesture reads the place off the geometry: at the foot, live; away from it, whichever turn the
 * viewport now starts in. That is what stops "collapse the tools" and "show chats only" jumping to the
 * bottom, and what stops the end of a turn losing the tail.
 *
 * Ceiling: on a touchscreen, momentum after the finger lifts scrolls without re-arming the gesture, so
 * a hard flick that coasts to the foot will not resume following. Desktop wheel and trackpad scrolling
 * re-arm on every step, so they are unaffected; add a momentum-phase signal if a touch host needs it.
 */
export function placeAfterScroll(state: {
  place: ReadingPlace
  gesture: boolean
  geometry: ScrollGeometry
  /** The turn the viewport now starts in, measured by the caller. Asked for only when the answer is
   *  needed, because measuring costs a layout. */
  anchor: () => ReadingPlace | null
}): ReadingPlace {
  if (!state.gesture) return state.place
  if (atLive(state.geometry)) return LIVE
  return state.anchor() ?? state.place
}

/**
 * Which turn a restore should aim at, given the keys the list is drawing now.
 *
 * The anchor is usually still there. When it is not, the turn that has taken its position is one row
 * out at worst, which is a place. A list too short to hold that position is not a near miss: it is a
 * different list, so the reader is treated as arriving fresh and sent to the live end, which is where
 * a first visit goes. The one thing this never does is leave them at the top, which is the answer a
 * pixel offset gave whenever the list came back shorter than the number.
 */
export function resolveAnchor(
  place: Extract<ReadingPlace, { at: 'turn' }>,
  keys: readonly string[],
): { key: string; offset: number } | null {
  if (keys.includes(place.key)) return { key: place.key, offset: place.offset }
  const substitute = keys[place.index]
  return substitute === undefined ? null : { key: substitute, offset: 0 }
}
